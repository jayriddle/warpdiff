import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
const broken = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('not a png') });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '3.19.20'));
});

async function loadGreen(page: Page) {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
}

async function contrastOf(page: Page) {
  return page.evaluate(() => {
    const nums = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const over = (fg: number[], bg: number[]) => {
      const alpha = fg.length > 3 ? (fg[3] > 1 ? fg[3] / 255 : fg[3]) : 1;
      return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha));
    };
    const ratio = (fg: number[], bg: number[]) => {
      const hi = Math.max(lum(fg), lum(bg));
      const lo = Math.min(lum(fg), lum(bg));
      return (hi + 0.05) / (lo + 0.05);
    };
    const header = document.querySelector('.header') as HTMLElement;
    const button = document.getElementById('helpBtn') as HTMLElement;
    const field = document.querySelector('#layerEditA .asset-resolution') as HTMLElement;
    const bar = field.closest('.asset-info-bar') as HTMLElement;
    const headerBg = nums(getComputedStyle(header).backgroundColor);
    const barBg = nums(getComputedStyle(bar).backgroundColor);
    return {
      button: ratio(nums(getComputedStyle(button).color), headerBg),
      field: ratio(over(nums(getComputedStyle(field).color), barBg), barBg),
      fieldText: field.textContent || ''
    };
  });
}

test('first-visit Help takes focus and keeps Tab inside', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('lastSeenVersion'));
  await page.goto('/');
  const popup = page.locator('#quickStartPopup');
  await expect(popup).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const dialog = document.getElementById('quickStartPopup');
    return !!dialog && dialog.getAttribute('role') === 'dialog' && dialog.contains(document.activeElement);
  })).toBe(true);
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('quickStartPopup')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.getElementById('quickStartPopup')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
});

test('What\'s New keeps Tab inside the popup', async ({ page }) => {
  await page.goto('/');
  await page.locator('#appVersion').click();
  const popup = page.locator('#changelogPopup');
  await expect(popup).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getElementById('changelogPopup')!.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('changelogPopup')!.contains(document.activeElement))).toBe(true);
});

test('volume, picture name, header and metadata meet the accessible-name and contrast bar', async ({ page }) => {
  await loadGreen(page);
  await expect(page.locator('#volumeSlider')).toHaveAttribute('aria-label', 'Volume');
  await page.evaluate(() => {
    const controls = document.getElementById('videoControls')!;
    controls.classList.add('active');
    controls.classList.remove('images-only');
  });
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeVisible();
  const image = page.locator('#layerEditA img');
  await expect(image).toHaveAttribute('alt', 'green.png, A');
  await expect(page.getByRole('img', { name: 'green.png, A' })).toBeVisible();
  await expect.poll(async () => {
    const sample = await contrastOf(page);
    return sample.fieldText.includes('×') && sample.button >= 4.5 && sample.field >= 4.5;
  }).toBe(true);
});

for (const width of [320, 375]) {
  test(`Media status, Reset and Help stay on screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await loadGreen(page);
    await expect(page.locator('#mediaStatusBtn')).toBeVisible();
    await expect(page.locator('#resetBtn')).toBeVisible();
    await expect(page.locator('#helpBtn')).toBeVisible();
    const placed = await page.evaluate(() => {
      return ['#mediaStatusBtn', '#resetBtn', '#helpBtn'].every(selector => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8
          && rect.left >= -1 && rect.right <= window.innerWidth + 1
          && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
      });
    });
    expect(placed).toBe(true);
  });
}

test('a failed image replacement keeps the current comparison', async ({ page }) => {
  await loadGreen(page);
  await page.locator('#multiFileInput').setInputFiles(broken('broken.png'));
  const notice = page.locator('#imageLoadNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('broken.png');
  await expect(notice).toContainText('unchanged');
  await expect(notice.getByRole('button', { name: 'Load files' })).toBeVisible();
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect(page.locator('#layerEditA img')).toHaveAttribute('alt', /green\.png/);
  expect(await page.evaluate(() => (document.querySelector('#layerEditA img') as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('opening no pictures shows a lasting error instead of a blank comparison', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles([broken('bad-1.png'), broken('bad-2.png')]);
  const notice = page.locator('#imageLoadNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('bad-1.png');
  await expect(notice).toContainText('Nothing was loaded');
  await expect(notice.getByRole('button', { name: 'Load files' })).toBeVisible();
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
  await page.waitForTimeout(300);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('a picture that fails beside a good one stays marked', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles([
    { name: 'green.png', mimeType: 'image/png', buffer: fs.readFileSync(fixture('green.png')) },
    broken('broken.png'),
  ]);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  const failed = page.locator('.slot-load-error');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText('broken.png');
  await expect(failed.getByRole('button', { name: 'Load files' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#comparisonView img')].some(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
});
