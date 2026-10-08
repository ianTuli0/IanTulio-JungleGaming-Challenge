// 7. Pausing, losing focus and resuming without the clock jumping ahead.
import { expect, test, type Page } from '@playwright/test';
import { CFG, advance, advanceUntil, hold, hud, pressKey, release, showsWhenFrozen, startMatch, state, tap, turnTo } from './helpers.ts';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Paused' });

/** Frames keep rendering while paused: push real ticker time through (each frame is a real WebGL render) and compare. */
async function expectFrozen(page: Page, seconds = 0.6) {
  const before = await state(page);
  const clock = await hud(page).time.innerText();
  await page.clock.runFor(seconds * 1000);
  expect(await state(page)).toEqual(before);
  expect(await hud(page).time.innerText()).toBe(clock);
}

test('Esc pauses: clock, enemies and balls freeze until the player resumes', async ({ page }) => {
  await startMatch(page);
  await advanceUntil(page, 'an enemy to spawn', (s) => s.enemies.length > 0);
  await tap(page, 'fireFront');
  await pressKey(page, 'Escape');
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  expect((await state(page)).paused).toBe(true);
  await expectFrozen(page);

  await pressKey(page, 'Escape'); // Esc inside the dialog is an explicit player action
  expect((await state(page)).paused).toBe(false);
  await expect(dialog(page)).toBeHidden();
});

test('the pause button pauses and Resume continues from the same instant', async ({ page }) => {
  await startMatch(page);
  await advance(page, 1);
  await page.getByRole('button', { name: 'Pause' }).click();
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  await expectFrozen(page);
  const paused = await state(page);
  await page.getByRole('button', { name: 'Resume' }).click();
  expect((await state(page)).paused).toBe(false);
  await advance(page, 0.5);
  const resumed = await state(page);
  expect(resumed.elapsed - paused.elapsed, 'the seconds spent paused are not simulated').toBeCloseTo(0.5, 1);
});

test('cooldowns are suspended while paused', async ({ page }) => {
  await startMatch(page);
  await turnTo(page, () => 0); // east: open water, no fortress wall eats the ball
  await tap(page, 'fireFront'); // starts the 0.35 s cooldown
  await pressKey(page, 'Escape');
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  await page.clock.runFor(600); // longer than the 0.35 s cooldown, in real frames
  await page.getByRole('button', { name: 'Resume' }).click();
  await hold(page, 'fireFront');
  await advance(page, 0.1);
  expect((await state(page)).projectiles, 'still cooling down: no second ball yet').toBe(1);
  await advance(page, CFG.player.front.cooldown);
  expect((await state(page)).projectiles).toBe(2);
  await release(page, 'fireFront');
});

test('what was held down before the pause does not leak into the resume', async ({ page }) => {
  await startMatch(page);
  await hold(page, 'forward');
  await hold(page, 'fireFront');
  await advance(page, 0.4);
  await pressKey(page, 'Escape');
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  await page.clock.runFor(600);
  await page.getByRole('button', { name: 'Resume' }).click(); // W and Space are still physically down
  const resumed = await state(page);
  await advance(page, 1);
  const after = await state(page);
  expect(resumed.player.y - after.player.y, 'no thrust: the ship only coasts to a stop').toBeLessThan(40);
  expect(after.projectiles, 'no shots from the key held across the pause').toBeLessThanOrEqual(resumed.projectiles);
  await release(page, 'forward');
  await release(page, 'fireFront');
});

test('losing focus pauses the match, and getting focus back does not resume it', async ({ page }) => {
  await startMatch(page);
  await advance(page, 1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  await expect(dialog(page)).toContainText('Paused while the game was in the background.');
  await expectFrozen(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(300);
  expect((await state(page)).paused, 'resuming needs an explicit action').toBe(true);
  const before = await state(page);
  await page.getByRole('button', { name: 'Resume' }).click();
  await advance(page, 0.5);
  expect((await state(page)).elapsed - before.elapsed).toBeCloseTo(0.5, 1);
});

test('hiding the tab pauses the match too', async ({ page }) => {
  await startMatch(page);
  await advance(page, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await showsWhenFrozen(page, 'the pause dialog', dialog(page));
  await expect(dialog(page)).toContainText('Paused while the game was in the background.');
  await expectFrozen(page);
});
