// 10. Ranking and Match History tabs: loading, empty, error, pagination.
import { expect, test, type Page } from '@playwright/test';
import { KEYS, PLAYER_ID, matchRecord, seedStorage } from './helpers.ts';

const rankingRows = (page: Page) => page.locator('.ranking-table tbody tr');
const historyRows = (page: Page) => page.locator('.history-table tbody tr');
const next = (page: Page) => page.getByRole('button', { name: 'Next page' });
const previous = (page: Page) => page.getByRole('button', { name: 'Previous page' });
const ranks = (page: Page) => rankingRows(page).locator('.rank').allTextContents();

test.describe('Ranking tab', () => {
  test('lists the league in score order, five per page, with working pagination', async ({ page }) => {
    await page.goto('/#/log/ranking');
    await expect(page.getByText('120 second battles · 3 second spawn interval')).toBeVisible();
    await expect(rankingRows(page)).toHaveCount(5);
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
    expect(await ranks(page)).toEqual(['01', '02', '03', '04', '05']);
    const scores = (await rankingRows(page).locator('.score').allTextContents()).map(Number);
    expect(scores, 'highest score first').toEqual([...scores].sort((a, b) => b - a));
    await expect(previous(page)).toBeDisabled();

    await next(page).click();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
    await expect.poll(() => ranks(page)).toEqual(['06', '07', '08', '09', '10']);
    await next(page).click();
    await expect(page.getByText('Page 3 of 3')).toBeVisible();
    await expect.poll(() => ranks(page)).toEqual(['11', '12', '13', '14']);
    await expect(next(page)).toBeDisabled();

    await previous(page).click();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
  });

  test('shows a loading state, then the rows', async ({ page }) => {
    await page.goto('/?scenario=slow#/log/ranking');
    await expect(page.getByRole('status').filter({ hasText: 'Loading ranking…' })).toBeVisible();
    await expect(rankingRows(page)).toHaveCount(5, { timeout: 10_000 });
  });

  test('a league with no matches shows the empty message', async ({ page }) => {
    await page.goto('/?scenario=empty#/log/ranking');
    await expect(page.getByText('No battles recorded with this configuration yet. Be the first!')).toBeVisible();
    await expect(rankingRows(page)).toHaveCount(0);
  });

  test('many pages: the pager keeps counting', async ({ page }) => {
    await page.goto('/?scenario=many-pages#/log/ranking');
    await expect(page.getByText(/Page 1 of 15/)).toBeVisible();
    for (const n of [2, 3, 4]) {
      await next(page).click();
      await expect(page.getByText(`Page ${n} of 15`)).toBeVisible();
    }
  });

  test('a failing ranking shows an error with Try again, while the other tab keeps working; switching the scenario recovers', async ({ page }) => {
    await page.goto('/?scenario=ranking-down#/log/ranking');
    const alert = page.getByRole('alert').filter({ hasText: 'Could not load the ranking.' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('The server answered with an error (HTTP 503).');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(page.getByText('No battles recorded yet. Set sail!')).toBeVisible();

    await page.getByRole('tab', { name: 'Ranking' }).click();
    await page.getByRole('button', { name: /^Network:/ }).click();
    await page.getByRole('radio', { name: /^Normal/ }).check();
    await page.getByRole('button', { name: 'Close' }).click();
    const again = page.getByRole('button', { name: 'Try again' });
    if (await again.isVisible()) await again.click();
    await expect(rankingRows(page)).toHaveCount(5, { timeout: 15_000 });
  });
});

test.describe('Match History tab', () => {
  test('a new player has an empty history', async ({ page }) => {
    await page.goto('/#/log/history');
    await expect(page.getByText('No battles recorded yet. Set sail!')).toBeVisible();
    await expect(historyRows(page)).toHaveCount(0);
  });

  test('lists the player matches newest first, five per page', async ({ page }) => {
    const matches = Array.from({ length: 7 }, (_, i) =>
      matchRecord({ matchId: `e2e-history-${i}`, score: i + 1, playedAt: `2026-01-0${i + 1}T12:00:00.000Z`, ranked: i % 2 === 0, playerName: i % 2 === 0 ? 'Captain Jack' : '' }),
    );
    await seedStorage(page, { [KEYS.player]: { id: PLAYER_ID }, [KEYS.mockDb]: matches });
    await page.goto('/#/log/history');
    await expect(historyRows(page)).toHaveCount(5);
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    expect((await historyRows(page).locator('.score').allTextContents()).map(Number)).toEqual([7, 6, 5, 4, 3]); // newest first
    await expect(historyRows(page).first()).toContainText('Captain Jack'); // ranked
    await expect(historyRows(page).nth(1)).toContainText('Not ranked');
    await expect(historyRows(page).first()).toContainText('02:00');
    await expect(historyRows(page).first()).toContainText('Time up');

    await next(page).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect.poll(async () => (await historyRows(page).locator('.score').allTextContents()).map(Number)).toEqual([2, 1]);
    await expect(next(page)).toBeDisabled();
  });

  test('a failing history shows an error, and the ranking tab is unaffected', async ({ page }) => {
    await page.goto('/?scenario=history-down#/log/history');
    const alert = page.getByRole('alert').filter({ hasText: 'Could not load the match history.' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.getByRole('tab', { name: 'Ranking' }).click();
    await expect(rankingRows(page)).toHaveCount(5);
  });

  test('a loading history is announced', async ({ page }) => {
    await page.goto('/?scenario=slow#/log/history');
    await expect(page.getByRole('status').filter({ hasText: 'Loading match history…' })).toBeVisible();
    await expect(page.getByText('No battles recorded yet. Set sail!')).toBeVisible({ timeout: 10_000 });
  });
});

test('the tabs follow the WAI-ARIA keyboard pattern', async ({ page }) => {
  await page.goto('/#/log/ranking');
  const ranking = page.getByRole('tab', { name: 'Ranking' });
  const history = page.getByRole('tab', { name: 'Match History' });
  await expect(ranking).toHaveAttribute('aria-selected', 'true');
  await ranking.focus();
  await page.keyboard.press('ArrowRight');
  await expect(history).toHaveAttribute('aria-selected', 'true');
  await expect(history).toBeFocused();
  await expect(page).toHaveURL(/#\/log\/history$/);
  await page.keyboard.press('Home');
  await expect(ranking).toHaveAttribute('aria-selected', 'true');
});
