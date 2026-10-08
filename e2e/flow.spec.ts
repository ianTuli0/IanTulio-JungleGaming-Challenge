// 9. Abandoning a match, going back and forth between screens, and the touch controls.
import { expect, test } from '@playwright/test';
import { CFG, KEYS, advance, collectErrors, pressKey, readStorage, showsWhenFrozen, startMatch, state, touchHold, waitFor, waitMatchRunning } from './helpers.ts';

const noMatchLeft = (page: import('@playwright/test').Page) => page.evaluate(() => ({ handle: window.__pirateBattle, canvases: document.querySelectorAll('canvas').length }));

test('leaving a battle abandons it: nothing is recorded in the ranking or the history', async ({ page }) => {
  await startMatch(page);
  await advance(page, 5);
  await pressKey(page, 'Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'Main Menu' }).click();
  await showsWhenFrozen(page, 'the main menu', page.getByRole('button', { name: 'Play', exact: true }));
  await expect.poll(() => noMatchLeft(page)).toEqual({ handle: undefined, canvases: 0 });
  expect(await readStorage(page, KEYS.lastResult)).toBeNull();
  expect(await readStorage(page, KEYS.pending)).toBeNull();

  await page.getByRole('button', { name: 'Match History' }).click();
  await showsWhenFrozen(page, 'the empty history', page.getByText('No battles recorded yet. Set sail!'));
  await expect(page.getByText('Last battle:')).toHaveCount(0);
});

test('restarting abandons the previous battle too', async ({ page }) => {
  await startMatch(page);
  await advance(page, 3);
  await pressKey(page, 'Escape');
  await page.getByRole('button', { name: 'Restart' }).click();
  await waitMatchRunning(page);
  expect(await readStorage(page, KEYS.lastResult)).toBeNull();
  expect(await readStorage(page, KEYS.pending)).toBeNull();
});

test('reloading the page ends the battle in progress and lands on the menu', async ({ page }) => {
  await startMatch(page);
  await advance(page, 3);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/play/);
  expect(await readStorage(page, KEYS.lastResult)).toBeNull();
  expect(await noMatchLeft(page)).toEqual({ handle: undefined, canvases: 0 });
});

test('going back and forth between every screen leaves no errors, canvases or stuck state behind', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page).then(async () => {
    await pressKey(page, 'Escape');
    await page.getByRole('dialog').getByRole('button', { name: 'Main Menu' }).click();
  });
  const menu = page.getByRole('button', { name: 'Play', exact: true });
  await showsWhenFrozen(page, 'the main menu', menu);
  for (let lap = 0; lap < 3; lap++) {
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByRole('heading', { name: 'Options' })).toBeFocused();
    await page.getByRole('button', { name: 'Main Menu' }).click();

    await page.getByRole('button', { name: 'Ranking' }).click();
    await showsWhenFrozen(page, 'the ranking rows', page.locator('.ranking-table tbody tr').first());
    await page.getByRole('tab', { name: 'Match History' }).click();
    await showsWhenFrozen(page, 'the history message', page.getByText('No battles recorded yet. Set sail!'));
    await page.getByRole('button', { name: 'Main Menu' }).click();

    await menu.click();
    await waitMatchRunning(page);
    await advance(page, 0.5);
    await expect(page.locator('canvas')).toHaveCount(1);
    await pressKey(page, 'Escape');
    await page.getByRole('dialog').getByRole('button', { name: 'Main Menu' }).click();
    await showsWhenFrozen(page, 'the main menu', menu);
    await expect.poll(() => noMatchLeft(page)).toEqual({ handle: undefined, canvases: 0 });
  }
  expect(errors, 'no uncaught errors or console errors').toEqual([]);
});

test.describe('touch controls', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout: mobile project only');

  test('the six on-screen buttons are there and big enough to hit', async ({ page }) => {
    await startMatch(page);
    for (const name of ['Sail forward', 'Turn left', 'Turn right', 'Fire bow cannon', 'Fire left broadside', 'Fire right broadside']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(Math.min(box!.width, box!.height), `${name} is a usable touch target`).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.hud')).toBeVisible();
  });

  test('two fingers at once: sailing while firing, and letting go stops both', async ({ page }) => {
    const start = await startMatch(page);
    const lift = await touchHold(page, [page.getByRole('button', { name: 'Sail forward' }), page.getByRole('button', { name: 'Fire bow cannon' })]);
    await advance(page, 1);
    const moving = await state(page);
    expect(moving.player.y, 'sailing north').toBeLessThan(start.player.y - 40);
    expect(moving.projectiles, 'firing at the same time').toBeGreaterThanOrEqual(1);
    await lift();
    await advance(page, 3); // drag stops the ship, the cooldown and the balls run out
    const rest = await state(page);
    await advance(page, 1);
    const later = await state(page);
    expect(later.player.y).toBeCloseTo(rest.player.y, 1);
    expect(later.projectiles).toBe(0);
  });

  test('a turn button rotates the ship, and a broadside button fires three balls', async ({ page }) => {
    const start = await startMatch(page);
    let lift = await touchHold(page, [page.getByRole('button', { name: 'Turn right' })]);
    await advance(page, 0.5);
    await lift();
    expect((await state(page)).player.angle - start.player.angle).toBeCloseTo(CFG.player.turnSpeed * 0.5, 1);
    lift = await touchHold(page, [page.getByRole('button', { name: 'Fire left broadside' })]);
    await advance(page, 0.05);
    await lift();
    expect((await state(page)).projectiles).toBe(CFG.player.broadside.count);
  });

  test('every round button of the match is 60px, with tight gaps inside each cluster', async ({ page }) => {
    await startMatch(page);
    const buttons = page.locator('.hud .round-btn:visible, .touch-btn');
    expect(await buttons.count(), 'pause, fullscreen and the six touch buttons').toBe(8);
    for (const box of await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
      expect([box.width, box.height]).toEqual([60, 60]);
    }
    for (const side of ['left', 'right']) {
      const [a, b] = await page.locator(`.touch-cluster.${side} .touch-btn`).evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect().toJSON()));
      expect(Math.abs(a.x - b.x) - 60 < 4 || Math.abs(a.y - b.y) - 60 < 4, `${side} cluster: neighbouring buttons almost touch`).toBe(true);
    }
  });

  test('the sailing stick ring is centred on the left buttons and covers all three', async ({ page }) => {
    const start = await startMatch(page);
    const box = (await page.locator('.touch-cluster.left').boundingBox())!;
    const [x, y] = [box.x + 20, box.y + 20]; // the empty top-left corner of the cluster
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await waitFor(page, 'the stick circle', () => page.locator('.stick-base').isVisible());
    const base = (await page.locator('.stick-base').boundingBox())!;
    const [cx, cy, radius] = [base.x + base.width / 2, base.y + base.height / 2, base.width / 2];
    expect(cx, 'ring centre x = cluster centre x').toBeCloseTo(box.x + box.width / 2, 0);
    expect(cy, 'ring centre y = cluster centre y').toBeCloseTo(box.y + box.height / 2, 0);
    for (const name of ['Sail forward', 'Turn left', 'Turn right']) {
      const b = (await page.getByRole('button', { name }).boundingBox())!;
      const reach = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy) + b.width / 2;
      expect(reach, `the ring covers "${name}"`).toBeLessThanOrEqual(radius);
    }

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 50, id: 1 }] });
    await waitFor(page, 'the knob to follow the finger', async () => ((await page.locator('.stick-knob').getAttribute('style')) ?? '').includes('-50px'));
    await advance(page, 1);
    expect((await state(page)).player.y, 'sailing north').toBeLessThan(start.player.y - 40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(page, 'the stick to disappear', async () => !(await page.locator('.stick-base').isVisible()));
    await cdp.detach();
  });

  test('held fingers do not leak across a pause', async ({ page }) => {
    await startMatch(page);
    const lift = await touchHold(page, [page.getByRole('button', { name: 'Sail forward' })]);
    await advance(page, 0.3);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    const resumed = await state(page);
    await advance(page, 1);
    expect(resumed.player.y - (await state(page)).player.y, 'the finger still on the screen is not thrust').toBeLessThan(40);
    await lift();
  });
});

test('the touch buttons stay hidden on a computer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop project only');
  await startMatch(page);
  await expect(page.getByRole('button', { name: 'Sail forward' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test.describe('phone held upright', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');
  test.use({ viewport: { width: 412, height: 915 } });

  test('the match pauses and only a big rotate message with Options, Controls and Main Menu is offered', async ({ page }) => {
    await startMatch(page);
    const dialog = page.getByRole('dialog', { name: 'Rotate your phone to play' });
    await showsWhenFrozen(page, 'the rotate message', dialog);
    expect((await state(page)).paused).toBe(true);
    await expect(dialog.getByRole('button')).toHaveText(['Options', 'Controls', 'Main Menu']);
    await expect(dialog.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Restart' })).toHaveCount(0);
    const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialog: (document.querySelector('dialog[open]') as HTMLElement).scrollWidth - (document.querySelector('dialog[open]') as HTMLElement).clientWidth }));
    expect(overflow, 'nothing scrolls sideways').toEqual({ page: 0, dialog: 0 });

    const buttons = await dialog.getByRole('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(buttons).size, 'all buttons share one centred column').toBeLessThanOrEqual(3);

    const open = page.getByRole('dialog'); // its name follows the sub-view (Controls, Options)
    await dialog.getByRole('button', { name: 'Controls' }).click();
    await expect(open.getByRole('button', { name: 'Back' })).toBeVisible();
    await open.getByRole('button', { name: 'Back' }).click();
    await open.getByRole('button', { name: 'Options' }).click();
    await expect(open.getByLabel('Game session time', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('dialog[open]')!.scrollWidth - document.querySelector('dialog[open]')!.clientWidth)).toBe(0);
  });

  test('rotating to landscape brings back the normal pause menu', async ({ page }) => {
    await startMatch(page);
    await showsWhenFrozen(page, 'the rotate message', page.getByRole('dialog', { name: 'Rotate your phone to play' }));
    await page.setViewportSize({ width: 915, height: 412 });
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    await showsWhenFrozen(page, 'the pause menu', dialog);
    await expect(dialog.getByRole('button', { name: 'Resume' })).toBeVisible();
  });

  test('the sea is sized for the landscape screen once the phone is turned, not for the upright one', async ({ page }) => {
    await startMatch(page);
    await showsWhenFrozen(page, 'the rotate message', page.getByRole('dialog', { name: 'Rotate your phone to play' }));
    await page.setViewportSize({ width: 915, height: 412 });
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    await showsWhenFrozen(page, 'the pause menu', dialog);
    await dialog.getByRole('button', { name: 'Resume' }).click();
    const { bounds } = await state(page);
    expect((bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0)).toBeCloseTo(915 / 412, 1);
  });
});
