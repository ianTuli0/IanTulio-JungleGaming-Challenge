// Visual regression: the menu, the arena in a steady state and the result screen.
// Baselines live in e2e/visual.spec.ts-snapshots (one per project and OS); refresh them with
// `npm run test:e2e:update` after an intentional change of look.
import { expect, test } from '@playwright/test';
import { matchRecord, openMenu, playButton, seedFinishedBattle, seedSettings, waitFor } from './helpers.ts';

const shot = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.03 } as const;

test('main menu', async ({ page }) => {
  await page.goto('/');
  await expect(playButton(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('menu.png', shot);
});

test('arena in a steady state: fresh match, nothing moving yet', async ({ page }) => {
  // No ?debug here: that flag draws the colliders over the map. The clock stays frozen on the first frames.
  await seedSettings(page, { spawnIntervalSeconds: 10 });
  await openMenu(page, '?seed=7');
  await playButton(page).click();
  await waitFor(page, 'the HUD', () => page.getByRole('meter', { name: 'Ship health' }).isVisible());
  await page.clock.runFor(100);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page).toHaveScreenshot('arena.png', shot);
});

test('result screen', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 12, durationMs: 120_000 }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('result.png', shot);
});

test('result screen after the ranking name was entered', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 12, durationMs: 120_000, ranked: true, playerName: 'Captain Jack' }), true);
  await page.goto('/#/result');
  await expect(page.getByText('Entered in the ranking as')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('main')).toHaveScreenshot('result-confirmed.png', { ...shot, mask: [page.locator('.sync')] }); // the save status flips while the request runs
});
