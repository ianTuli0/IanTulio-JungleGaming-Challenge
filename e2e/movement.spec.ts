// 3. Match start, movement, rotation, arena limits and island collisions.
import { expect, test } from '@playwright/test';
import { CFG, advance, advanceUntil, bearing, expectHud, hold, hud, hullClearance, insideArena, press, release, startMatch, state, turnTo } from './helpers.ts';

const NORTH = -Math.PI / 2;

test('a match starts with full health, no score and a running clock', async ({ page }) => {
  const s = await startMatch(page);
  expect(s.status).toBe('running');
  expect(s.paused).toBe(false);
  expect(s.elapsed).toBeLessThan(0.5);
  expect(s.score).toBe(0);
  expect(s.player.hp).toBe(CFG.player.maxHp);
  expect(s.player.angle).toBeCloseTo(NORTH, 3);
  expect(s.enemies).toHaveLength(0);
  expect(s.projectiles).toBe(0);
  expect(s.islands.length).toBeGreaterThan(0); // at least one island blocks ships (balls fly over)
  await expectHud(page, { hp: CFG.player.maxHp, score: 0 });
  await expect(hud(page).time).toContainText('02:00');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('sails forward with W and keeps going while the key is held', async ({ page }) => {
  const start = await startMatch(page);
  await press(page, ['forward'], 1);
  const a = await state(page);
  expect(a.player.y).toBeLessThan(start.player.y - 40); // heading north: y decreases
  expect(Math.abs(a.player.x - start.player.x)).toBeLessThan(1);
  await press(page, ['forward'], 0.5);
  const b = await state(page);
  expect(b.player.y).toBeLessThan(a.player.y - 30);
  // let go: the ship coasts to a stop (drag), it does not keep its speed
  await advance(page, 3);
  const stopped = await state(page);
  await advance(page, 1);
  expect((await state(page)).player.y).toBeCloseTo(stopped.player.y, 1);
});

test('turns left and right at the configured rate', async ({ page }) => {
  const start = await startMatch(page);
  await press(page, ['turnRight'], 0.5);
  const right = await state(page);
  expect(right.player.angle - start.player.angle).toBeCloseTo(CFG.player.turnSpeed * 0.5, 1); // clockwise on screen
  await press(page, ['turnLeft'], 1);
  const left = await state(page);
  expect(left.player.angle - right.player.angle).toBeCloseTo(-CFG.player.turnSpeed * 1, 1);
  // rotating alone does not move the ship
  expect(left.player.x).toBeCloseTo(start.player.x, 1);
  expect(left.player.y).toBeCloseTo(start.player.y, 1);
});

test('sails and turns at the same time, along a curve', async ({ page }) => {
  const start = await startMatch(page);
  await press(page, ['forward', 'turnRight'], 0.6);
  const s = await state(page);
  expect(s.player.angle - start.player.angle).toBeCloseTo(CFG.player.turnSpeed * 0.6, 1);
  expect(s.player.x).toBeGreaterThan(start.player.x + 3); // veered east while moving
  expect(s.player.y).toBeLessThan(start.player.y - 10); // and still made headway north
});

test('cannot leave the arena: the ship stops at the border', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.maxIntervalSeconds } });
  const { bounds } = await state(page);
  // Turn south (clear water below the start) and keep the throttle down against the border.
  await turnTo(page, () => Math.PI / 2);
  await hold(page, 'forward');
  const seen: number[] = [];
  for (let i = 0; i < 40; i++) {
    await advance(page, 0.25);
    const s = await state(page);
    seen.push(s.player.y);
    expect(insideArena(bounds, s.player.x, s.player.y)).toBe(true);
  }
  await release(page, 'forward');
  const end = await state(page);
  expect(end.player.y).toBeGreaterThan(bounds.y1 - 60); // it did reach the edge...
  expect(end.player.y).toBeLessThanOrEqual(bounds.y1); // ...and never crossed it
  expect(Math.max(...seen.slice(-8)) - Math.min(...seen.slice(-8))).toBeLessThan(1); // pinned there
});

test('islands block the ship: it touches the shore but never enters', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.maxIntervalSeconds } });
  const first = await state(page);
  const island = [...first.islands].sort((a, b) => Math.hypot(a.cx - first.player.x, a.cy - first.player.y) - Math.hypot(b.cx - first.player.x, b.cy - first.player.y))[0];
  await turnTo(page, (s) => bearing(s.player, { x: island.cx, y: island.cy }));
  await hold(page, 'forward');
  const radius = CFG.player.hull.radius;
  let closest = Infinity;
  for (let i = 0; i < 60; i++) {
    await advance(page, 0.2);
    const clearance = hullClearance(await state(page));
    closest = Math.min(closest, clearance);
    expect(clearance, 'no part of the hull may enter an island').toBeGreaterThanOrEqual(radius - 0.5);
  }
  await release(page, 'forward');
  expect(closest, 'the ship really reached the island').toBeLessThan(radius + 4);
  // pushing against the shore leaves it stopped, not drifting through
  const rest = await state(page);
  await advanceUntil(page, 'the ship to come to rest', (s) => Math.hypot(s.player.x - rest.player.x, s.player.y - rest.player.y) < 5, { maxSeconds: 3 });
});
