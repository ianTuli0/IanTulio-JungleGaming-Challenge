// Shared E2E helpers.
//
// Time model: game tests freeze the page clock (Playwright `page.clock`) before anything loads, so the Pixi
// ticker, timers and Date only move when a test says so. Battles are driven through the `?debug` handle
// (`window.__pirateBattle`): `advance(s)` feeds the real simulation whole fixed steps with the keys that are
// really held down, and `runFor(ms)` pushes real frames through the real ticker (pause, result hand-off).
import { expect, type Locator, type Page } from '@playwright/test';
import { insideArena, obstacleDistance, type Bounds, type Collider } from '../src/game/arena.ts';
import { GAME_CONFIG } from '../src/game/config.ts';
import { KEY_BINDINGS, type Control } from '../src/game/input.ts';

export const CFG = GAME_CONFIG;
export { insideArena, obstacleDistance };

export interface Pose {
  x: number;
  y: number;
  angle: number;
  hp: number;
}
export interface EnemyPose extends Pose {
  id: number;
  kind: string;
}
export interface GameState {
  status: string;
  paused: boolean;
  elapsed: number;
  score: number;
  player: Pose;
  enemies: EnemyPose[];
  projectiles: number;
  islands: Collider[];
  bounds: Bounds;
}

declare global {
  interface Window {
    __pirateBattle?: { state(): GameState; advance(seconds: number): void };
  }
}

export const KEYS = {
  settings: 'pirate-battle:settings',
  player: 'pirate-battle:player',
  lastResult: 'pirate-battle:last-result',
  pending: 'pirate-battle:pending-matches',
  mockDb: 'pirate-battle:mock-db',
};

// -- storage seeding ---------------------------------------------------------------------

/** Writes localStorage keys before the app boots, only when absent (so a reload keeps what the app saved). */
export async function seedStorage(page: Page, entries: Record<string, unknown>): Promise<void> {
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, entries);
}

export const PLAYER_ID = 'e2e-player';

/** Options for a battle (sound off keeps the runs quiet). */
export const seedSettings = (page: Page, s: { sessionSeconds?: number; spawnIntervalSeconds?: number }) =>
  seedStorage(page, {
    [KEYS.settings]: { sessionSeconds: CFG.session.defaultSeconds, spawnIntervalSeconds: CFG.spawn.defaultIntervalSeconds, soundEnabled: false, ...s },
  });

export function matchRecord(over: Record<string, unknown> = {}) {
  return {
    matchId: 'e2e-match-1',
    playerId: PLAYER_ID,
    playerName: '',
    ranked: false,
    playedAt: '2026-01-01T12:00:00.000Z',
    score: 7,
    durationMs: 120_000,
    endReason: 'time-up',
    config: { sessionSeconds: CFG.session.defaultSeconds, spawnIntervalSeconds: CFG.spawn.defaultIntervalSeconds },
    ...over,
  };
}

/** A finished battle waiting on the result screen, as the app stores it. */
export const seedFinishedBattle = (page: Page, record = matchRecord(), confirmed = false) =>
  seedStorage(page, { [KEYS.player]: { id: PLAYER_ID }, [KEYS.lastResult]: { record, confirmed } });

export const readStorage = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

// -- clock -----------------------------------------------------------------------------

const T0 = new Date('2026-01-01T00:00:00Z');

/** Freezes the page clock before anything loads; call it before `page.goto`. */
export async function freezeClock(page: Page): Promise<void> {
  // Tracks held keys inside the page, so a test can wait until the page has really seen a key event.
  await page.addInitScript(() => {
    const held = new Set<string>();
    (window as unknown as { __heldKeys: Set<string> }).__heldKeys = held;
    window.addEventListener('keydown', (e) => held.add(e.code), true);
    window.addEventListener('keyup', (e) => held.delete(e.code), true);
    const pointers = { down: 0, up: 0 };
    (window as unknown as { __pointers: typeof pointers }).__pointers = pointers;
    window.addEventListener('pointerdown', () => pointers.down++, true);
    window.addEventListener('pointerup', () => pointers.up++, true);
  });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(new Date(T0.getTime() + 1000));
}

/** Pushes frozen time forward in small chunks until `check` holds, so timers, rAF and effects can run. */
export async function waitFor(page: Page, what: string, check: () => Promise<boolean>, { stepMs = 100, maxSteps = 400 } = {}): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if (await check()) return;
    await page.clock.runFor(stepMs);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export const showsWhenFrozen = (page: Page, what: string, locator: Locator) => waitFor(page, what, () => locator.isVisible());

// -- game ------------------------------------------------------------------------------

export const state = (page: Page) => page.evaluate(() => window.__pirateBattle!.state());
export const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__pirateBattle!.advance(s), seconds);
export const playButton = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });

/** Opens the menu with the clock frozen. */
export async function openMenu(page: Page, query = ''): Promise<void> {
  await freezeClock(page);
  await page.goto(`/${query}`);
  await showsWhenFrozen(page, 'the main menu', playButton(page));
}

/** Menu -> Play -> a running match (a few milliseconds old, frozen). */
export async function startMatch(page: Page, { seed = 7, settings }: { seed?: number; settings?: { sessionSeconds?: number; spawnIntervalSeconds?: number } } = {}): Promise<GameState> {
  await seedSettings(page, settings ?? {});
  await openMenu(page, `?seed=${seed}&debug`);
  await playButton(page).click();
  await waitMatchRunning(page);
  return state(page);
}

/** The debug handle appears early; the HUD only once init() finished, i.e. the ticker runs and input is attached. */
export const waitMatchRunning = (page: Page) =>
  waitFor(
    page,
    'a running match',
    async () => (await page.getByRole('meter', { name: 'Ship health' }).isVisible()) && (await page.evaluate(() => window.__pirateBattle?.state().status === 'running')),
    { maxSteps: 600 },
  );

const CODE = Object.fromEntries(Object.entries(KEY_BINDINGS).map(([control, codes]) => [control, codes[0]])) as Record<Control, string>;
/** Resolves once the page itself has seen the key go down (true) or up (false): CDP acknowledges input early. */
const seen = (page: Page, code: string, down: boolean) =>
  page.evaluate(
    ([c, d]) =>
      new Promise<void>((resolve) => {
        const held = (window as unknown as { __heldKeys: Set<string> }).__heldKeys;
        if (held.has(c as string) === d) return resolve();
        const type = d ? 'keydown' : 'keyup';
        const on = () => {
          if (held.has(c as string) !== d) return;
          window.removeEventListener(type, on, true);
          resolve();
        };
        window.addEventListener(type, on, true); // registered after the tracker, so it runs after it
      }),
    [code, down] as const,
  );

export async function hold(page: Page, control: Control): Promise<void> {
  await page.keyboard.down(CODE[control]);
  await seen(page, CODE[control], true);
}
export async function release(page: Page, control: Control): Promise<void> {
  await page.keyboard.up(CODE[control]);
  await seen(page, CODE[control], false);
}

/** Holds the controls for `seconds` of game time, then lets go. */
export async function press(page: Page, controls: Control[], seconds: number): Promise<void> {
  for (const c of controls) await hold(page, c);
  await advance(page, seconds);
  for (const c of controls) await release(page, c);
}

/**
 * Puts one finger on each locator (a real multi-touch gesture over CDP) and returns a function that lifts
 * them all. Waits until the page itself has seen the pointer events.
 */
export async function touchHold(page: Page, targets: Locator[]): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  const points = await Promise.all(
    targets.map(async (t, i) => {
      const box = (await t.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: i + 1 };
    }),
  );
  const count = (kind: 'down' | 'up') => page.evaluate((k) => (window as unknown as { __pointers: Record<string, number> }).__pointers[k], kind);
  const reached = (kind: 'down' | 'up', n: number) =>
    page.evaluate(
      ([k, goal]) =>
        new Promise<void>((resolve) => {
          const pointers = (window as unknown as { __pointers: Record<string, number> }).__pointers;
          if (pointers[k as string] >= (goal as number)) return resolve();
          const on = () => pointers[k as string] >= (goal as number) && (window.removeEventListener(k === 'down' ? 'pointerdown' : 'pointerup', on, true), resolve());
          window.addEventListener(k === 'down' ? 'pointerdown' : 'pointerup', on, true);
        }),
      [kind, n] as const,
    );
  const down = await count('down');
  const up = await count('up');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await reached('down', down + points.length);
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await reached('up', up + points.length);
    await cdp.detach();
  };
}

/** One keyboard press that is not a game control (Esc), delivered and seen by the page. */
export async function pressKey(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await seen(page, code, true);
  await page.keyboard.up(code);
  await seen(page, code, false);
}

/** A key press as short as one simulation step. */
export const tap = (page: Page, control: Control) => press(page, [control], 1 / 60);

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const bearing = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(to.y - from.y, to.x - from.x);
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Smallest distance from any of the three hull circles (bow, centre, stern) to the nearest island. */
export function hullClearance(s: GameState): number {
  const { halfLength } = CFG.player.hull;
  return Math.min(...[-1, 0, 1].map((k) => obstacleDistance(s.islands, s.player.x + Math.cos(s.player.angle) * halfLength * k, s.player.y + Math.sin(s.player.angle) * halfLength * k)));
}
export const nearestEnemy = (s: GameState, kind?: string) =>
  s.enemies.filter((e) => !kind || e.kind === kind).sort((a, b) => dist(s.player, a) - dist(s.player, b))[0];

/** Advances in small steps until `done` holds; returns the state it held in. Fails after `maxSeconds`. */
export async function advanceUntil(page: Page, what: string, done: (s: GameState) => boolean, { maxSeconds = 30, step = 0.1 } = {}): Promise<GameState> {
  for (let t = 0; t <= maxSeconds; t += step) {
    const s = await state(page);
    if (done(s)) return s;
    if (s.status !== 'running') break;
    await advance(page, step);
  }
  const s = await state(page);
  if (done(s)) return s;
  throw new Error(`Timed out (${maxSeconds}s of game time) waiting for ${what}: ${JSON.stringify({ elapsed: s.elapsed, status: s.status, score: s.score, hp: s.player.hp, enemies: s.enemies.map((e) => [e.kind, Math.round(e.hp)]) })}`);
}

/**
 * Closed-loop steering on the real input path: holds A/D until the bow points at `target(state)` (radians).
 * The ship turns in place, so this never moves it.
 */
export async function turnTo(page: Page, target: (s: GameState) => number, { tolerance = 0.03, maxSeconds = 8 } = {}): Promise<GameState> {
  let held: Control | null = null;
  const hold_ = async (next: Control | null) => {
    if (next === held) return;
    if (held) await release(page, held);
    if (next) await hold(page, next);
    held = next;
  };
  try {
    for (let t = 0; t < maxSeconds; ) {
      const s = await state(page);
      const error = wrap(target(s) - s.player.angle);
      if (Math.abs(error) <= tolerance || s.status !== 'running') return s;
      await hold_(error > 0 ? 'turnRight' : 'turnLeft');
      const dt = Math.min(0.05, (Math.abs(error) / CFG.player.turnSpeed) * 0.9 + 0.003);
      await advance(page, dt);
      t += dt;
    }
    throw new Error('turnTo: never reached the requested heading');
  } finally {
    await hold_(null);
  }
}

type Weapon = 'front' | 'left' | 'right';
const WEAPON = {
  front: { control: 'fireFront', offset: 0, reach: () => CFG.player.front.range },
  left: { control: 'fireLeft', offset: -Math.PI / 2, reach: () => CFG.player.broadside.range },
  right: { control: 'fireRight', offset: Math.PI / 2, reach: () => CFG.player.broadside.range },
} as const;

/**
 * Aims `weapon` at the nearest enemy of `kind` with the turn keys, then taps its fire key once the target is
 * lined up and inside 85% of the weapon range. Returns the state at the moment of the shot.
 */
export async function engage(page: Page, { kind, id, weapon = 'front', maxSeconds = 20 }: { kind?: string; id?: number; weapon?: Weapon; maxSeconds?: number }): Promise<GameState> {
  const w = WEAPON[weapon];
  for (let t = 0; t < maxSeconds; ) {
    const s = await state(page);
    const target = id === undefined ? nearestEnemy(s, kind) : s.enemies.find((e) => e.id === id);
    if (s.status !== 'running') break;
    if (!target) {
      await advance(page, 0.1);
      t += 0.1;
      continue;
    }
    const heading = () => bearing(s.player, target) - w.offset;
    if (Math.abs(wrap(heading() - s.player.angle)) > 0.025) {
      await turnTo(page, (cur) => {
        const enemy = cur.enemies.find((e) => e.id === target.id) ?? target;
        return bearing(cur.player, enemy) - w.offset;
      }, { tolerance: 0.02, maxSeconds: 3 });
      t += 0.2;
    } else if (dist(s.player, target) <= w.reach() * 0.85) {
      const shot = await state(page);
      await tap(page, w.control);
      return shot;
    } else {
      await advance(page, 0.05);
      t += 0.05;
    }
  }
  throw new Error(`engage: no ${id ?? kind ?? 'enemy'} could be shot with the ${weapon} weapon`);
}

/**
 * Auto-pilot for whole matches: aims the bow at the nearest enemy and fires when lined up.
 * It uses nothing but held keys, so it plays through the real input path.
 */
export async function autopilot(page: Page, seconds: number): Promise<GameState> {
  const held = new Set<Control>();
  const sync = async (want: Control[]) => {
    for (const c of [...held]) {
      if (want.includes(c)) continue;
      await release(page, c);
      held.delete(c);
    }
    for (const c of want) {
      if (held.has(c)) continue;
      await hold(page, c);
      held.add(c);
    }
  };
  try {
    const end = (await state(page)).elapsed + seconds;
    for (;;) {
      const s = await state(page);
      if (s.status !== 'running' || s.elapsed >= end) return s;
      const target = nearestEnemy(s);
      const want: Control[] = [];
      if (target) {
        const error = wrap(bearing(s.player, target) - s.player.angle);
        if (error > 0.04) want.push('turnRight');
        else if (error < -0.04) want.push('turnLeft');
        if (Math.abs(error) < 0.1 && dist(s.player, target) < CFG.player.front.range - 40) want.push('fireFront');
      }
      await sync(want);
      await advance(page, 0.1);
    }
  } finally {
    await sync([]);
  }
}

// -- HUD ---------------------------------------------------------------------------------

export const hud = (page: Page) => ({
  health: page.getByRole('meter', { name: 'Ship health' }),
  score: page.locator('.hud .counter').nth(0),
  time: page.locator('.hud .counter').nth(1),
});

export async function expectHud(page: Page, { hp, score }: { hp?: number; score?: number }): Promise<void> {
  const h = hud(page);
  if (hp !== undefined) await expect(h.health).toHaveAttribute('aria-valuenow', String(hp));
  if (score !== undefined) await expect(h.score).toContainText(String(score));
}

export const pauseDialog = (page: Page) => page.getByRole('dialog', { name: /paused|options|controls|rotate/i });

// -- misc --------------------------------------------------------------------------------

/** Collects uncaught page errors and console errors (e.g. to assert a navigation loop stays clean). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}
