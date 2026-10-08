// 11 and 12. Registering a finished match, recovery after failures and refreshes, no duplicates,
// and late answers never overwriting newer data. These run on the real clock: the HTTP timeout is the
// browser's own, so it cannot be fast-forwarded.
import { expect, test, type Page } from '@playwright/test';
import { KEYS, PLAYER_ID, matchRecord, readStorage, seedFinishedBattle, seedStorage } from './helpers.ts';

const rankingRows = (page: Page) => page.locator('.ranking-table tbody tr');
const historyRows = (page: Page) => page.locator('.history-table tbody tr');
const nameField = (page: Page) => page.getByLabel('Captain name for the ranking (optional)');
const goTo = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash);
const mockDb = async (page: Page): Promise<{ matchId: string }[]> => (await readStorage(page, KEYS.mockDb)) ?? [];

test('a finished match is registered once and shows up in both tabs', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 999 }));
  await page.goto('/'); // an unanswered ranking-name step brings the player back to the result
  await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();

  // Prime both tabs' caches before registering: they must refresh afterwards.
  await goTo(page, '#/log/ranking');
  await expect(rankingRows(page)).toHaveCount(5);
  await expect(page.getByText('Captain Jack')).toHaveCount(0);
  await goTo(page, '#/log/history');
  await expect(page.getByText('No battles recorded yet. Set sail!')).toBeVisible();

  await goTo(page, '#/result');
  await nameField(page).fill('Captain Jack');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Entered in the ranking as')).toBeVisible();
  await expect(page.getByText("✔ Saved to the Captain's Log.")).toBeVisible();

  await goTo(page, '#/log/ranking');
  await expect(rankingRows(page).first()).toContainText('Captain Jack');
  await expect(rankingRows(page).first()).toContainText('999');
  await expect(rankingRows(page).first().locator('.badge')).toHaveText('You');
  await goTo(page, '#/log/history');
  await expect(historyRows(page)).toHaveCount(1);
  await expect(historyRows(page).first()).toContainText('999');
  await expect(historyRows(page).first()).toContainText('Captain Jack');

  expect(await mockDb(page)).toHaveLength(1);
  expect(await readStorage(page, KEYS.pending)).toEqual([]);
});

test('Continue with an empty name files the match in the history only', async ({ page, isMobile }) => {
  await seedFinishedBattle(page, matchRecord({ score: 999 }));
  await page.goto('/');
  // The phone layout hides this note to save height.
  const note = page.getByText('Without a name, this battle is saved to your Match History only');
  await (isMobile ? expect(note).toBeHidden() : expect(note).toBeVisible());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Not ranked (no name entered).')).toBeVisible();
  await expect(page.getByText("✔ Saved to the Captain's Log.")).toBeVisible();

  await goTo(page, '#/log/history');
  await expect(historyRows(page)).toHaveCount(1);
  await expect(historyRows(page).first()).toContainText('Not ranked');
  await goTo(page, '#/log/ranking');
  await expect(rankingRows(page)).toHaveCount(5);
  await expect(page.locator('.ranking-table .badge')).toHaveCount(0); // not in the ranking
});

test('an invalid captain name is refused with an accessible message', async ({ page }) => {
  await seedFinishedBattle(page);
  await page.goto('/');
  await nameField(page).fill('a');
  // The error appears when the field loses focus and pushes the button down: on a touch screen the first tap
  // then misses it. Leave the field first, as a person who reads the error would, then tap Continue.
  await nameField(page).blur();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText("Use 2–16 letters, numbers, spaces or . ' _ -");
  await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(nameField(page)).toBeFocused();
  expect((await readStorage(page, KEYS.lastResult)).confirmed, 'nothing was filed').toBe(false);
  expect(await readStorage(page, KEYS.pending)).toBeNull();
});

test('a save that fails is kept across a refresh and registered once the API is back', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 999 }));
  await page.goto('/?scenario=submit-unavailable');
  await nameField(page).fill('Captain Jack');
  await page.getByRole('button', { name: 'Continue' }).click();
  const failed = page.getByRole('status').filter({ hasText: 'Not saved yet' });
  await expect(failed).toContainText('The server answered with an error (HTTP 503).', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Again' }), 'the player can start another battle meanwhile').toBeVisible();
  expect(await readStorage(page, KEYS.pending)).toHaveLength(1);
  expect(await mockDb(page)).toHaveLength(0);

  await page.reload(); // the queue survives a refresh
  expect(await readStorage(page, KEYS.pending)).toHaveLength(1);
  await goTo(page, '#/log/history');
  await expect(page.getByText('1 finished battle is waiting to be saved (kept on this device).')).toBeVisible();

  await page.goto('/?scenario=normal#/log/history'); // the API is back; the app retries on start
  await expect(page.getByText(/waiting to be saved/)).toHaveCount(0, { timeout: 20_000 });
  await expect(historyRows(page)).toHaveCount(1);
  await expect(historyRows(page).first()).toContainText('Captain Jack');
  expect(await readStorage(page, KEYS.pending)).toEqual([]);
  expect(await mockDb(page)).toHaveLength(1);
  await goTo(page, '#/log/ranking');
  await expect(rankingRows(page).first()).toContainText('Captain Jack'); // the ranking tab saw it too
});

test('clicking Retry while a save is in flight sends one request and stores one match', async ({ page }) => {
  const record = matchRecord({ score: 999, ranked: true, playerName: 'Captain Jack' });
  await seedStorage(page, { [KEYS.player]: { id: PLAYER_ID }, [KEYS.pending]: [record], [KEYS.lastResult]: { record, confirmed: true } });
  const puts: string[] = [];
  page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/api/matches/') && puts.push(r.url()));
  await page.goto('/?scenario=slow#/log/history'); // the start-up sync takes 2.5–3.5 s
  const retry = page.getByRole('button', { name: 'Retry now' });
  await retry.click();
  await retry.click({ force: true }).catch(() => undefined); // a second click on the (disabled) button
  await expect(page.getByText(/waiting to be saved/)).toHaveCount(0, { timeout: 20_000 });
  await expect(historyRows(page)).toHaveCount(1);
  expect(puts, 'one in-flight request per match').toHaveLength(1);
  expect(await mockDb(page)).toHaveLength(1);
});

test('a save that times out after reaching the server is recovered without duplicating it', async ({ page }) => {
  await seedFinishedBattle(page, matchRecord({ score: 999 }));
  await page.goto('/?scenario=submit-timeout');
  await nameField(page).fill('Captain Jack');
  await page.getByRole('button', { name: 'Continue' }).click();
  // the server stored it, but its answer comes after the client gave up: the retry must find it, not add a copy
  await expect(page.getByText(/Saving to the Captain's Log… \(attempt 2\)/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("✔ Saved to the Captain's Log.")).toBeVisible({ timeout: 20_000 });
  expect(await mockDb(page)).toHaveLength(1);
  expect(await readStorage(page, KEYS.pending)).toEqual([]);

  await goTo(page, '#/log/history');
  await expect(historyRows(page)).toHaveCount(1);
  await goTo(page, '#/log/ranking');
  await expect(rankingRows(page).filter({ hasText: 'Captain Jack' })).toHaveCount(1);
});

test('a late answer never overwrites the page the player moved on to', async ({ page }) => {
  // out-of-order: answers alternate between 2.2 s and 0.2 s, so older requests finish last
  await page.goto('/?scenario=out-of-order#/log/ranking');
  const next = page.getByRole('button', { name: 'Next page' });
  const previous = page.getByRole('button', { name: 'Previous page' });
  await expect(page.getByText('Page 1 of 3')).toBeVisible({ timeout: 10_000 });
  await next.click(); // 0.2 s answer
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
  await expect.poll(() => rankingRows(page).locator('.rank').allTextContents()).toEqual(['06', '07', '08', '09', '10']);
  await next.click(); // page 3: the slow 2.2 s answer
  await previous.click(); // the player goes back to page 2 before it arrives
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
  await page.waitForTimeout(3000); // the late page-3 answer lands now
  await expect(page.getByText('Page 2 of 3'), 'the late answer did not take over the screen').toBeVisible();
  expect(await rankingRows(page).locator('.rank').allTextContents()).toEqual(['06', '07', '08', '09', '10']);
});
