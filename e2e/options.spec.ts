// 1. Options: navigation, validation, persistence, and the per-match snapshot.
import { expect, test, type Page } from '@playwright/test';
import { CFG, KEYS, hud, pressKey, readStorage, showsWhenFrozen, startMatch, waitMatchRunning } from './helpers.ts';

const sessionField = (page: Page) => page.getByLabel('Game session time', { exact: true });
const spawnField = (page: Page) => page.getByLabel('Enemy spawn time', { exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save' });

async function setField(field: ReturnType<typeof sessionField>, value: string) {
  await field.fill(value);
  await field.blur();
}

test('Options opens from the main menu, with the keyboard too, and goes back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Options' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Options' })).toBeFocused();
  await expect(page).toHaveURL(/#\/options$/);
  await expect(sessionField(page)).toHaveValue(String(CFG.session.defaultSeconds));
  await expect(spawnField(page)).toHaveValue(String(CFG.spawn.defaultIntervalSeconds));
  await page.getByRole('button', { name: 'Main Menu' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('session time must be a whole number between 60 and 180 seconds', async ({ page }) => {
  await page.goto('/#/options');
  const cases: [string, string][] = [
    ['59', 'Choose between 60 and 180 seconds.'],
    ['181', 'Choose between 60 and 180 seconds.'],
    ['100.5', 'Enter a whole number of seconds.'],
    ['', 'Enter a whole number of seconds.'],
  ];
  for (const [value, message] of cases) {
    await setField(sessionField(page), value);
    await expect(sessionField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  }
  for (const ok of ['60', '180']) {
    await setField(sessionField(page), ok);
    await expect(sessionField(page)).toHaveAttribute('aria-invalid', 'false');
  }
});

test('spawn interval must be positive, between 1 and 10 seconds, with at most one decimal', async ({ page }) => {
  await page.goto('/#/options');
  const cases: [string, string][] = [
    ['0', 'Enter a positive number of seconds.'],
    ['-2', 'Enter a positive number of seconds.'],
    ['0.5', 'Choose between 1 and 10 seconds.'],
    ['10.5', 'Choose between 1 and 10 seconds.'],
    ['2.55', 'Use at most one decimal place.'],
  ];
  for (const [value, message] of cases) {
    await setField(spawnField(page), value);
    await expect(spawnField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  }
  for (const ok of ['1', '2.5', '10']) {
    await setField(spawnField(page), ok);
    await expect(spawnField(page)).toHaveAttribute('aria-invalid', 'false');
  }
  // the documented limits are on screen
  await expect(page.getByText(`One enemy every ${CFG.spawn.minIntervalSeconds}–${CFG.spawn.maxIntervalSeconds} seconds`)).toBeVisible();
});

test('invalid values are refused: nothing is saved, focus lands on the broken field', async ({ page }) => {
  await page.goto('/#/options');
  await sessionField(page).fill('10');
  await save(page).click();
  await expect(sessionField(page)).toBeFocused();
  await expect(page.getByText('Options saved')).toHaveCount(0);
  expect(await readStorage(page, KEYS.settings)).toBeNull();
  await page.reload();
  await expect(sessionField(page)).toHaveValue(String(CFG.session.defaultSeconds));
});

test('saved options survive a refresh and drive the ranking league', async ({ page }) => {
  await page.goto('/#/options');
  await setField(sessionField(page), '90');
  await setField(spawnField(page), '2.5');
  await page.getByLabel('Sound effects').uncheck();
  await save(page).click();
  await expect(page.getByText('Options saved. They apply to your next battle.')).toBeVisible();
  expect(await readStorage(page, KEYS.settings)).toEqual({ sessionSeconds: 90, spawnIntervalSeconds: 2.5, soundEnabled: false });

  await page.reload();
  await expect(sessionField(page)).toHaveValue('90');
  await expect(spawnField(page)).toHaveValue('2.5');
  await expect(page.getByLabel('Sound effects')).not.toBeChecked();
  await page.goto('/#/log/ranking');
  await expect(page.getByText('90 second battles · 2.5 second spawn interval')).toBeVisible();
});

test('the +/- buttons step by 10 s and 0.5 s and stop at the limits', async ({ page }) => {
  await page.goto('/#/options');
  await page.getByRole('button', { name: 'Increase game session time' }).click();
  await expect(sessionField(page)).toHaveValue('130');
  await page.getByRole('button', { name: 'Decrease enemy spawn time' }).click();
  await expect(spawnField(page)).toHaveValue('2.5');
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Increase game session time' }).click();
  await expect(sessionField(page)).toHaveValue(String(CFG.session.maxSeconds));
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Decrease enemy spawn time' }).click();
  await expect(spawnField(page)).toHaveValue(String(CFG.spawn.minIntervalSeconds));
});

test('a match keeps the options it started with; the next one uses the new ones', async ({ page }) => {
  await startMatch(page); // default 120 s
  await expect(hud(page).time).toContainText('02:00');

  await pressKey(page, 'Escape');
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(page.getByText('Changes apply to your next battle; this one keeps its settings.')).toBeVisible();
  await setField(sessionField(page), '60');
  await save(page).click();
  await expect(page.getByText('Options saved.')).toBeVisible();
  expect(await readStorage(page, KEYS.settings)).toMatchObject({ sessionSeconds: 60 });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(hud(page).time, 'the running match still has 120 s').toContainText('02:00');

  await pressKey(page, 'Escape');
  await page.getByRole('button', { name: 'Restart' }).click();
  await waitMatchRunning(page);
  await expect(hud(page).time, 'the new match uses the saved 60 s').toContainText('01:00');
  await showsWhenFrozen(page, 'the HUD', hud(page).time);
});
