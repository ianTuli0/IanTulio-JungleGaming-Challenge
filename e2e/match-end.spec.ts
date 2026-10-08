// 6. Ending by time and by death, the simulation stopping, and a clean restart.
import { expect, test } from '@playwright/test';
import { CFG, KEYS, advance, advanceUntil, autopilot, hold, hud, pressKey, readStorage, showsWhenFrozen, startMatch, state, tap, waitMatchRunning } from './helpers.ts';

test('time up ends the match, freezes the simulation and hands over to the result screen', async ({ page }) => {
  await startMatch(page, { settings: { sessionSeconds: CFG.session.minSeconds, spawnIntervalSeconds: CFG.spawn.maxIntervalSeconds } });
  const almost = await autopilot(page, CFG.session.minSeconds - 2);
  expect(almost.status, 'the auto-pilot is still afloat').toBe('running');
  const ended = await autopilot(page, 5);
  expect(ended.status).toBe('ended');
  expect(ended.elapsed).toBe(CFG.session.minSeconds);
  await expect(page.getByText('Time up!')).toBeVisible();
  await expect(hud(page).time).toContainText('00:00');

  // Real frames keep coming, and keys keep being pressed, but nothing moves, fires, hurts or scores.
  await hold(page, 'forward');
  await hold(page, 'fireFront');
  await page.clock.runFor(300);
  expect(await state(page)).toEqual(ended);

  await page.clock.fastForward(1700); // the 1.8 s beat on the final explosion is over
  await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
  const saved = await readStorage(page, KEYS.lastResult);
  expect(saved.record).toMatchObject({ score: ended.score, durationMs: CFG.session.minSeconds * 1000, endReason: 'time-up' });
});

test('dying ends the match early and freezes the simulation', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.minIntervalSeconds } });
  const dead = await advanceUntil(page, 'the ship to sink', (s) => s.status === 'ended', { maxSeconds: CFG.session.minSeconds });
  expect(dead.player.hp).toBeLessThanOrEqual(0);
  expect(dead.elapsed).toBeLessThan(CFG.session.defaultSeconds);
  await expect(page.getByText('Ship sunk!')).toBeVisible();
  await expect(hud(page).health).toHaveAttribute('aria-valuenow', '0');

  await page.clock.runFor(300);
  expect(await state(page), 'enemies, balls and clock all stopped').toEqual(dead);

  await page.clock.fastForward(1700);
  await expect(page.getByRole('heading', { name: 'Ship sunk' })).toBeVisible();
  const saved = await readStorage(page, KEYS.lastResult);
  expect(saved.record).toMatchObject({ score: dead.score, endReason: 'destroyed', durationMs: Math.round(dead.elapsed * 1000) });
});

test('restarting builds a brand new match: health, score, clock and entities are all restored', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.minIntervalSeconds } });
  const dirty = await advanceUntil(page, 'damage and enemies', (s) => s.player.hp < CFG.player.maxHp && s.enemies.length > 1, { maxSeconds: 20 });
  await tap(page, 'fireFront');
  expect(dirty.elapsed).toBeGreaterThan(2);

  await pressKey(page, 'Escape');
  await page.getByRole('button', { name: 'Restart' }).click();
  await waitMatchRunning(page);
  const fresh = await state(page);
  expect(fresh.elapsed).toBeLessThan(0.5);
  expect(fresh.score).toBe(0);
  expect(fresh.player.hp).toBe(CFG.player.maxHp);
  expect(fresh.enemies).toHaveLength(0);
  expect(fresh.projectiles).toBe(0);
  expect(fresh.paused).toBe(false);
  await expect(page.locator('canvas'), 'the old renderer was torn down').toHaveCount(1);
  await expect(hud(page).time).toContainText('02:00');
  await expect(hud(page).health).toHaveAttribute('aria-valuenow', String(CFG.player.maxHp));
  await advance(page, 1);
  expect((await state(page)).elapsed).toBeCloseTo(fresh.elapsed + 1, 1); // and it runs
});

test('Play Again after a defeat starts a clean match', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.minIntervalSeconds } });
  await advanceUntil(page, 'the ship to sink', (s) => s.status === 'ended', { maxSeconds: CFG.session.minSeconds });
  await page.clock.fastForward(2000);
  await page.getByRole('button', { name: 'Continue' }).click(); // the ranking-name step, left empty
  await showsWhenFrozen(page, 'the result actions', page.getByRole('button', { name: 'Play Again' }));
  await page.getByRole('button', { name: 'Play Again' }).click();
  await waitMatchRunning(page);
  const fresh = await state(page);
  expect(fresh).toMatchObject({ score: 0, status: 'running', projectiles: 0 });
  expect(fresh.player.hp).toBe(CFG.player.maxHp);
  expect(fresh.enemies).toHaveLength(0);
  await expect(page.locator('canvas')).toHaveCount(1);
});
