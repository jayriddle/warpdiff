import { test, expect, Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '3.19.28'));
  await page.goto('/');
});

async function ring(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => {
    const style = getComputedStyle(el);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    };
  });
}

function expectNoRing(info: { outlineStyle: string; outlineWidth: number; boxShadow: string }) {
  expect(info.outlineStyle).toBe('none');
  expect(info.outlineWidth).toBe(0);
  expect(info.boxShadow).toBe('none');
}

test('play, What\'s New, and Settings tabs show no focus ring', async ({ page }) => {
  await page.evaluate(() => {
    const controls = document.getElementById('videoControls')!;
    controls.classList.add('active');
    controls.classList.remove('images-only');
  });
  const play = page.locator('#playPauseBtn');
  await play.click();
  await expect(play).toBeFocused();
  expectNoRing(await ring(page, '#playPauseBtn'));

  await page.locator('#volumeSlider').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(play).toBeFocused();
  expectNoRing(await ring(page, '#playPauseBtn'));

  await page.setViewportSize({ width: 390, height: 640 });
  await page.locator('#appVersion').click();
  const notes = page.locator('#changelogPopup .quick-start-body');
  await expect(notes).toBeFocused();
  expectNoRing(await ring(page, '#changelogPopup .quick-start-body'));
  const before = await notes.evaluate(el => el.scrollTop);
  await page.keyboard.press('ArrowDown');
  expect(await notes.evaluate(el => el.scrollTop)).toBeGreaterThan(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('#changelogPopup')).toBeHidden();

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.locator('#infoEditorButton').click();
  await expect(page.locator('#infoEditorDialog')).toBeVisible();
  const info = page.locator('#settingsTabInfo');
  await info.click();
  await expect(info).toBeFocused();
  expectNoRing(await ring(page, '#settingsTabInfo'));
  await page.keyboard.press('ArrowRight');
  const hotkeys = page.locator('#settingsTabHotkeys');
  await expect(hotkeys).toBeFocused();
  await expect(hotkeys).toHaveAttribute('aria-selected', 'true');
  expectNoRing(await ring(page, '#settingsTabHotkeys'));
  await page.keyboard.press('ArrowRight');
  const colors = page.locator('#settingsTabColors');
  await expect(colors).toBeFocused();
  await expect(colors).toHaveAttribute('aria-selected', 'true');
  expectNoRing(await ring(page, '#settingsTabColors'));
});
