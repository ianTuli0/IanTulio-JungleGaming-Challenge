// 8. The result screen: what it shows, and that it survives refreshes.
import { expect, test } from '@playwright/test';
import { CFG, KEYS, advanceUntil, matchRecord, readStorage, seedFinishedBattle, startMatch } from './helpers.ts';

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

test('a real defeat shows its score, time and reason, and all of it survives refreshes', async ({ page }) => {
  await startMatch(page, { settings: { spawnIntervalSeconds: CFG.spawn.minIntervalSeconds } });
  const dead = await advanceUntil(page, 'the ship to sink', (s) => s.status === 'ended', { maxSeconds: CFG.session.minSeconds });
  await page.clock.fastForward(2000); // the beat on the final explosion, then the result screen
  const durationMs = Math.round(dead.elapsed * 1000);

  await expect(page.getByRole('heading', { name: 'Ship sunk' })).toBeFocused();
  await expect(page.locator('.big-score')).toHaveText(String(dead.score));
  await expect(page.locator('.result-line')).toHaveText(`Points · ${clock(durationMs)} · Defeated`);
  await expect(page.getByText(`${dead.score} points`)).toBeAttached(); // screen-reader summary
  await expect(page.getByText(clock(durationMs), { exact: true })).toBeAttached();
  await expect(page.getByText(`${CFG.session.defaultSeconds} s battle · enemy every ${CFG.spawn.minIntervalSeconds} s`)).toBeVisible();
  await expect(page.getByText('Captain name for the ranking (optional)')).toBeVisible();

  await page.reload(); // refresh before answering the ranking-name step
  await expect(page.getByRole('heading', { name: 'Ship sunk' })).toBeVisible();
  await expect(page.locator('.big-score')).toHaveText(String(dead.score));
  await expect(page.locator('.result-line')).toHaveText(`Points · ${clock(durationMs)} · Defeated`);
  await expect(page.getByText('Captain name for the ranking (optional)')).toBeVisible();
  expect((await readStorage(page, KEYS.lastResult)).record).toMatchObject({ score: dead.score, durationMs, endReason: 'destroyed' });

  await page.getByLabel('Captain name for the ranking (optional)').fill('Captain Jack');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Entered in the ranking as')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeFocused();

  await page.reload(); // and after answering it
  await expect(page.getByRole('heading', { name: 'Ship sunk' })).toBeVisible();
  await expect(page.locator('.big-score')).toHaveText(String(dead.score));
  await expect(page.getByText('Entered in the ranking as')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Main Menu' })).toBeVisible();
});

test('a battle won on time is reported as complete, with its configuration', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 7, durationMs: 120_000, endReason: 'time-up', config: { sessionSeconds: 120, spawnIntervalSeconds: 3 } }));
  await page.goto('/#/result');
  await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
  await expect(page.locator('.big-score')).toHaveText('7');
  await expect(page.locator('.result-line')).toHaveText('Points · 02:00 · Time up');
  await expect(page.getByText('120 s battle · enemy every 3 s')).toBeVisible();
});

test('a defeat after 83 seconds is reported with that exact time', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 3, durationMs: 83_000, endReason: 'destroyed', config: { sessionSeconds: 90, spawnIntervalSeconds: 2.5 } }), true);
  await page.goto('/#/result');
  await expect(page.getByRole('heading', { name: 'Ship sunk' })).toBeVisible();
  await expect(page.locator('.result-line')).toHaveText('Points · 01:23 · Defeated');
  await expect(page.getByText('90 s battle · enemy every 2.5 s')).toBeVisible();
  await expect(page.getByText('Not ranked (no name entered).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Main Menu' })).toBeVisible();
});

test('with no battle yet, the result screen says so and still leads back to the menu', async ({ page }) => {
  await page.goto('/#/result');
  await expect(page.getByRole('heading', { name: 'No battle yet' })).toBeVisible();
  await expect(page.getByText('Finish a battle to see its result here.')).toBeVisible();
  await page.getByRole('button', { name: 'Main Menu' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
