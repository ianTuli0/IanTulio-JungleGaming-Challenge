// 2. Asset loading: visible progress, failure, retry.
import { expect, test, type Page } from '@playwright/test';
import { playButton } from './helpers.ts';

// page.route() cannot see requests an active Service Worker handles, and MSW is one: these tests do not
// need the mocked API, so the worker is blocked and the textures can really be held back or failed.
test.use({ serviceWorkers: 'block' });

const matchRunning = (page: Page) => page.waitForFunction(() => window.__pirateBattle?.state().status === 'running');

test('shows a loading state while the textures download, then starts the battle', async ({ page }) => {
  await page.route('**/*tiles_sheet*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('/?debug');
  await playButton(page).click();
  await expect(page.getByRole('heading', { name: 'Preparing the fleet…' })).toBeVisible();
  await expect(page.getByText(/Loading assets \d+%/)).toBeVisible();
  await expect(page.locator('progress')).toBeVisible();
  await matchRunning(page);
  await expect(page.getByRole('meter', { name: 'Ship health' })).toBeVisible();
});

test('a failed texture download is reported, can be retried, and the retry works', async ({ page }) => {
  let blocked = true;
  await page.route('**/*tiles_sheet*', (route) => (blocked ? route.abort() : route.continue()));
  await page.goto('/?debug');
  await playButton(page).click();
  await expect(page.getByRole('heading', { name: 'Could not load the battle' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Some game assets failed to load');
  await expect(page.getByRole('button', { name: 'Main Menu' })).toBeVisible();

  blocked = false; // the network is back
  await page.getByRole('button', { name: 'Retry' }).click();
  await matchRunning(page);
  await expect(page.getByRole('heading', { name: 'Could not load the battle' })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('after a failure the player can still go back to the menu and try again later', async ({ page }) => {
  let blocked = true;
  await page.route('**/*tiles_sheet*', (route) => (blocked ? route.abort() : route.continue()));
  await page.goto('/?debug');
  await playButton(page).click();
  await expect(page.getByRole('heading', { name: 'Could not load the battle' })).toBeVisible();
  await page.getByRole('button', { name: 'Main Menu' }).click();
  await expect(playButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Options' }).click(); // the rest of the app is unaffected
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await page.getByRole('button', { name: 'Main Menu' }).click();

  blocked = false;
  await playButton(page).click();
  await matchRunning(page);
});

test('a failed download of the game code itself offers Retry too', async ({ page }) => {
  let blocked = true;
  await page.route('**/assets/GameScreen-*.js', (route) => (blocked ? route.abort() : route.continue()));
  await page.goto('/?debug');
  await playButton(page).click();
  await expect(page.getByRole('heading', { name: 'Could not load the battle' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('The game failed to download');
  blocked = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await matchRunning(page);
});
