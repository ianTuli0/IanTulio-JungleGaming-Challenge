// 4. Front and side shots, damage, cooldowns and scoring without duplication.
// Every shot comes from the keyboard; the tests read the effects from the simulation state.
import { expect, test, type Page } from '@playwright/test';
import { CFG, advance, advanceUntil, engage, hold, nearestEnemy, press, release, startMatch, state, tap, turnTo, type GameState } from './helpers.ts';

const EAST = 0; // open water in front of the start position: no fortress walls in the way

test('the bow cannon fires one ball per shot and respects its cooldown', async ({ page }) => {
  await startMatch(page);
  await turnTo(page, () => EAST);
  await hold(page, 'fireFront');
  await advance(page, 0.05);
  expect((await state(page)).projectiles).toBe(1);
  await advance(page, CFG.player.front.cooldown - 0.15); // still cooling down
  expect((await state(page)).projectiles).toBe(1);
  await advance(page, 0.25); // cooldown over: the held key fires again
  expect((await state(page)).projectiles).toBe(2);
  await release(page, 'fireFront');
  await advance(page, 2); // every ball ends at its range
  expect((await state(page)).projectiles).toBe(0);
});

test('a broadside fires three balls per side, and each side has its own cooldown', async ({ page }) => {
  await startMatch(page); // heading north: the sides face open water to the west and east
  await tap(page, 'fireLeft');
  expect((await state(page)).projectiles).toBe(CFG.player.broadside.count);
  await advance(page, 0.3);
  await tap(page, 'fireLeft'); // same side, still cooling down
  expect((await state(page)).projectiles).toBe(CFG.player.broadside.count);
  await tap(page, 'fireRight'); // the other side is ready
  expect((await state(page)).projectiles).toBe(CFG.player.broadside.count * 2);
  await advance(page, CFG.player.broadside.cooldown); // balls are gone and the left cannons reloaded
  expect((await state(page)).projectiles).toBe(0);
  await tap(page, 'fireLeft');
  expect((await state(page)).projectiles).toBe(CFG.player.broadside.count);
});

test('sailing and firing work at the same time', async ({ page }) => {
  const start = await startMatch(page);
  await turnTo(page, () => EAST);
  await press(page, ['forward', 'fireFront'], 1);
  const s = await state(page);
  expect(s.player.x).toBeGreaterThan(start.player.x + 40);
  expect(s.projectiles).toBeGreaterThanOrEqual(2); // fired while the ship was moving
});

test('a front shot sinks a Chaser and scores exactly one point', async ({ page }) => {
  await startMatch(page);
  const spawned = await advanceUntil(page, 'a Chaser to spawn', (s) => s.enemies.some((e) => e.kind === 'chaser'));
  const chaser = nearestEnemy(spawned, 'chaser')!;
  expect(chaser.hp).toBe(CFG.chaser.maxHp);
  await engage(page, { id: chaser.id });
  const sunk = await advanceUntil(page, 'the Chaser to sink', (s) => !s.enemies.some((e) => e.id === chaser.id), { maxSeconds: 3 });
  expect(sunk.score).toBe(1);
  expect(sunk.player.hp, 'it was sunk before it could ram').toBe(CFG.player.maxHp);
  await advance(page, 3);
  expect((await state(page)).score, 'a sunk ship never scores again').toBe(1);
});

/** Takes down the opening Chaser, then waits for the next Shooter and returns its id. */
async function clearChaserAndFindShooter(page: Page): Promise<number> {
  const chaser = nearestEnemy(await advanceUntil(page, 'a Chaser to spawn', (s) => s.enemies.some((e) => e.kind === 'chaser')), 'chaser')!;
  await engage(page, { id: chaser.id });
  await advanceUntil(page, 'the Chaser to sink', (s) => s.score === 1 && !s.enemies.some((e) => e.id === chaser.id), { maxSeconds: 3 });
  const withShooter = await advanceUntil(page, 'a Shooter to spawn', (s) => s.enemies.some((e) => e.kind === 'shooter'), { maxSeconds: 8 });
  return nearestEnemy(withShooter, 'shooter')!.id;
}

const hpOf = (s: GameState, id: number) => s.enemies.find((e) => e.id === id)?.hp;

test('a Shooter takes two bow hits, each ball applying its damage once', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: 4 } });
  const id = await clearChaserAndFindShooter(page);

  await engage(page, { id });
  const hit = await advanceUntil(page, 'the first ball to land', (s) => (hpOf(s, id) ?? 0) < CFG.shooter.maxHp, { maxSeconds: 2 });
  expect(hpOf(hit, id)).toBe(CFG.shooter.maxHp - CFG.player.front.damage);
  expect(hit.score, 'a damaged ship has not been destroyed yet').toBe(1);
  await advance(page, 1); // one ball, one hit: the hp must not keep dropping
  expect(hpOf(await state(page), id)).toBe(CFG.shooter.maxHp - CFG.player.front.damage);

  await advance(page, CFG.player.front.cooldown);
  await engage(page, { id });
  const dead = await advanceUntil(page, 'the Shooter to sink', (s) => hpOf(s, id) === undefined, { maxSeconds: 3 });
  expect(dead.score).toBe(2);
  await advance(page, 2);
  expect((await state(page)).score).toBe(2);
});

test('a broadside lands its balls one by one against a Shooter', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: 4 } });
  const id = await clearChaserAndFindShooter(page);

  await engage(page, { id, weapon: 'left' });
  await advance(page, 1);
  const after = await state(page);
  const lost = CFG.shooter.maxHp - (hpOf(after, id) ?? 0);
  expect(lost % CFG.player.broadside.damage, 'only whole 20-damage balls land').toBe(0);
  expect(lost).toBeGreaterThanOrEqual(CFG.player.broadside.damage * 2); // the parallel balls cover the hull
  if (hpOf(after, id) === undefined) {
    expect(after.score, 'sunk by one volley: one kill, one point').toBe(2);
    await advance(page, 2);
    expect((await state(page)).score).toBe(2);
  }
});
