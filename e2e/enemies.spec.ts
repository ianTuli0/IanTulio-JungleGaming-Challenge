// 5. Chaser and Shooter behaviour, and the spawn interval.
import { expect, test } from '@playwright/test';
import { CFG, advance, advanceUntil, dist, obstacleDistance, startMatch, state, nearestEnemy, type GameState } from './helpers.ts';

test('enemies spawn on the configured interval, both kinds appear, and never next to the player', async ({ page }) => {
  const interval = 4;
  await startMatch(page, { settings: { spawnIntervalSeconds: interval } });
  const first = await state(page);
  const spawns: { id: number; kind: string; at: number; x: number; y: number }[] = [];
  const known = new Set<number>();
  while ((await state(page)).elapsed < interval * 3 + CFG.spawn.firstSpawnDelaySeconds + 0.5) {
    const s = await state(page);
    for (const e of s.enemies) {
      if (known.has(e.id)) continue;
      known.add(e.id);
      spawns.push({ id: e.id, kind: e.kind, at: s.elapsed, x: e.x, y: e.y });
    }
    await advance(page, 0.05);
  }
  expect(spawns.length).toBeGreaterThanOrEqual(4);
  // first spawn after min(2 s, interval), then one every interval (to within one 50 ms sampling step)
  expect(spawns[0].at).toBeCloseTo(Math.min(CFG.spawn.firstSpawnDelaySeconds, interval), 1);
  for (let i = 1; i < spawns.length; i++) expect(spawns[i].at - spawns[i - 1].at).toBeCloseTo(interval, 1);
  expect(spawns.slice(0, 2).map((s) => s.kind)).toEqual(CFG.spawn.opening); // both kinds in every match
  for (const s of spawns) {
    expect(dist(first.player, s), 'no unavoidable damage right after a spawn').toBeGreaterThanOrEqual(CFG.spawn.minPlayerDistance - 10);
    expect(obstacleDistance(first.islands, s.x, s.y), 'spawn points are free water').toBeGreaterThan(0);
    expect(s.x).toBeGreaterThanOrEqual(first.bounds.x0);
    expect(s.x).toBeLessThanOrEqual(first.bounds.x1);
  }
});

test('a Chaser hunts the player down, rams once, explodes and does not score', async ({ page }) => {
  // Interval 10 s: a Shooter only shows up after the Chaser had time to arrive.
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.maxIntervalSeconds } });
  const spawned = await advanceUntil(page, 'a Chaser to spawn', (s) => s.enemies.some((e) => e.kind === 'chaser'));
  const chaser = nearestEnemy(spawned, 'chaser')!;
  const startDistance = dist(spawned.player, chaser);

  // Step until that very Chaser is gone; the damage taken in that step is its ram. The player never fires.
  let before: GameState;
  let after = spawned;
  do {
    before = after;
    await advance(page, 0.05);
    after = await state(page);
  } while (after.enemies.some((e) => e.id === chaser.id) && after.elapsed - spawned.elapsed < 14 && after.status === 'running');

  expect(after.enemies.some((e) => e.id === chaser.id), 'it exploded on impact').toBe(false);
  const loss = before.player.hp - after.player.hp;
  expect(loss, 'the ram hurts').toBeGreaterThanOrEqual(CFG.chaser.ramDamage);
  expect(loss, 'and only a Shooter ball could add to it in the same step').toBeLessThanOrEqual(CFG.chaser.ramDamage + CFG.shooter.cannon.damage);
  expect(after.score, 'self-destruction against the player does not score').toBe(0);
  expect(after.elapsed - spawned.elapsed, 'it covered the distance at its own speed').toBeGreaterThan((startDistance - 80) / CFG.chaser.maxSpeed);
  await advance(page, 1); // the wreck is gone: nothing rams a second time
  expect((await state(page)).player.hp).toBeGreaterThanOrEqual(after.player.hp - CFG.shooter.cannon.damage);
});

test('a Shooter closes in, holds its distance and fires at its own cooldown', async ({ page }) => {
  const interval = CFG.spawn.maxIntervalSeconds; // the next spawn (a second Shooter, maybe) only comes after the window
  await startMatch(page, { settings: { spawnIntervalSeconds: interval } });
  const { shooter: cfg } = CFG;
  const withShooter = await advanceUntil(page, 'a Shooter to spawn', (s) => s.enemies.some((e) => e.kind === 'shooter'), { maxSeconds: 14 });
  const id = nearestEnemy(withShooter, 'shooter')!.id;

  const shots: number[] = []; // the player never fires here, so every new ball is the Shooter's
  const drops: number[] = [];
  let inRange = false;
  let closest = Infinity;
  let balls = withShooter.projectiles;
  let hp = withShooter.player.hp;
  const stop = withShooter.elapsed + interval - 0.3;
  for (;;) {
    const s = await state(page);
    const e = s.enemies.find((x) => x.id === id);
    if (!e || s.elapsed >= stop || s.status !== 'running') break;
    const d = dist(s.player, e);
    inRange ||= d <= cfg.attackRange;
    if (inRange) {
      closest = Math.min(closest, d);
      expect(d, 'once in range it stays in range').toBeLessThanOrEqual(cfg.attackRange + 15);
    }
    if (s.projectiles > balls) shots.push(s.elapsed);
    balls = s.projectiles;
    if (s.player.hp < hp) drops.push(hp - s.player.hp);
    hp = s.player.hp;
    await advance(page, 0.05);
  }
  expect(inRange, 'it came within attack range').toBe(true);
  expect(closest, 'it holds its range instead of ramming').toBeGreaterThanOrEqual(cfg.holdRange - 30);
  for (const drop of drops) expect([cfg.cannon.damage, CFG.chaser.ramDamage]).toContain(drop); // a ball hurts exactly once; a late Chaser may ram
  expect(drops.filter((d) => d === cfg.cannon.damage).length, 'its balls reached the player').toBeGreaterThanOrEqual(1);
  expect(shots.length, 'it keeps firing').toBeGreaterThanOrEqual(2);
  for (let i = 1; i < shots.length; i++) {
    expect(shots[i] - shots[i - 1]).toBeGreaterThanOrEqual(cfg.cannon.cooldown - 0.06);
    expect(shots[i] - shots[i - 1]).toBeLessThanOrEqual(cfg.cannon.cooldown + 0.5);
  }
});
