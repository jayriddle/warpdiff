import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
const broken = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('not a png') });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '3.19.28'));
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
  await expect(page.locator('#quickStartPopup .quick-start-close')).toBeFocused();
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
  await expect(page.locator('#changelogVersion')).toHaveText('v3.19.28');
  await expect(popup).toContainText('Highlights from the last two months');
  await expect(popup).toContainText('Compare two videos with a draggable wipe to see changes side by side.');
  await expect(popup).toContainText('Updates no longer interrupt an open comparison, and the app keeps your last full offline copy.');
  await expect.poll(() => page.evaluate(() => document.getElementById('changelogPopup')!.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('changelogPopup')!.contains(document.activeElement))).toBe(true);
});

for (const width of [320, 390]) {
  test(`What's New stays on screen and scrolls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/');
    await page.locator('#appVersion').click();
    const popup = page.locator('#changelogPopup');
    await expect(popup).toBeVisible();
    const fit = await popup.evaluate(dialog => {
      const body = dialog.querySelector('.quick-start-body') as HTMLElement;
      const rect = dialog.getBoundingClientRect();
      const items = [...body.querySelectorAll('li')];
      const last = items[items.length - 1] as HTMLElement;
      body.scrollTop = body.scrollHeight;
      const lastRect = last.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      return {
        scrolls: body.scrollHeight > body.clientHeight + 1,
        noHorizontal: body.scrollWidth <= body.clientWidth + 1,
        within: rect.top >= -1 && rect.left >= -1
          && rect.bottom <= window.innerHeight + 1
          && rect.right <= window.innerWidth + 1,
        lastText: last.textContent,
        lastVisible: lastRect.top >= bodyRect.top - 1 && lastRect.bottom <= bodyRect.bottom + 1,
        headings: [...body.querySelectorAll('h3')].map(node => node.textContent)
      };
    });
    expect(fit.scrolls).toBe(true);
    expect(fit.noHorizontal).toBe(true);
    expect(fit.within).toBe(true);
    expect(fit.lastText).toBe('Updates no longer interrupt an open comparison, and the app keeps your last full offline copy.');
    expect(fit.lastVisible).toBe(true);
    expect(fit.headings).toEqual([
      'Video and comparing',
      'Audio',
      'Layout and settings',
      'Opening files and reliability'
    ]);
  });
}

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
  test(`Reset and Help stay on screen at ${width}px, and Media status joins them when needed`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await loadGreen(page);
    await expect(page.locator('#mediaStatusBtn')).toBeHidden();
    await expect(page.locator('#resetBtn')).toBeVisible();
    await expect(page.locator('#helpBtn')).toBeVisible();
    const onScreen = (selector: string) => page.evaluate(sel => {
      const rect = document.querySelector(sel)!.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8
        && rect.left >= -1 && rect.right <= window.innerWidth + 1
        && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
    }, selector);
    expect(await onScreen('#resetBtn')).toBe(true);
    expect(await onScreen('#helpBtn')).toBe(true);
    await page.evaluate(() => {
      const token = (window as any).eval('_loadingProgressToken');
      (window as any)._mediaInputObserve('editA', token, {mediaFailed: true});
    });
    await expect(page.locator('#mediaStatusBtn')).toBeVisible();
    expect(await onScreen('#mediaStatusBtn')).toBe(true);
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

test('a first-visit failure closes Help and leaves the error in front', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('lastSeenVersion'));
  await page.goto('/');
  await expect(page.locator('#quickStartPopup')).toBeVisible();
  await page.locator('#multiFileInput').setInputFiles(broken('bad.png'));
  const notice = page.locator('#imageLoadNotice');
  await expect(page.locator('#quickStartPopup')).toBeHidden();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Nothing was loaded');
  await expect(notice.getByRole('button', { name: 'Load files' })).toBeFocused();
  expect(await page.evaluate(() => {
    const noticeEl = document.getElementById('imageLoadNotice')!;
    const popup = document.getElementById('quickStartPopup')!;
    return Number(getComputedStyle(noticeEl).zIndex) > Number(getComputedStyle(popup).zIndex)
      && (document.getElementById('multiFileInput') as HTMLInputElement).value === '';
  })).toBe(true);
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

function imageFiles(names: string[]) {
  return names.map(name => ({
    name,
    mimeType: 'image/png',
    buffer: fs.readFileSync(fixture(name)),
  }));
}

async function stackImages(page: Page, names: string[]) {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(imageFiles(names));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  if (await page.evaluate(() => (window as any).__testAPI.isGridMode)) {
    await page.locator('#stackIconBtn').click();
    await page.waitForFunction(() => !(window as any).__testAPI.isGridMode);
  }
  await page.keyboard.press('q');
  await expect(page.locator('body')).toHaveClass(/wipe-mode/);
  await expect(page.locator('#wipePairHost.wipe-pair-chooser')).toBeVisible();
}

function headerFit(page: Page) {
  return page.evaluate(() => {
    const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    const inside = (rect: DOMRect) => rect.width > 8 && rect.height > 8
      && rect.left >= -1 && rect.right <= window.innerWidth + 1
      && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const host = box('wipePairHost');
    const header = document.querySelector('.header')!.getBoundingClientRect();
    const balance = box('balanceModeBtn');
    const wave = box('waveformToggleBtn');
    const guards = ['wipeToggleBtn', 'waveformToggleBtn', 'scopesToggleBtn', 'infoEditorButton', 'appearanceButton'];
    return {
      below: document.body.classList.contains('wipe-pair-below'),
      hostBelowHeader: host.top >= header.bottom - 1,
      hostInside: inside(host),
      guards: guards.every(id => inside(box(id))),
      coversBalance: overlaps(host, balance),
      coversWave: overlaps(host, wave),
      chooserAfterBalance: host.left >= balance.right - 1,
      chooserBeforeWave: host.right <= wave.left + 1,
      name: document.querySelector('#stackInfoStrip .sih-name')!.textContent,
      labels: [...document.querySelectorAll('.wipe-pair-option')].map(button => button.textContent),
    };
  });
}

test('two images keep the wipe switch in the header row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await stackImages(page, ['red.png', 'green.png']);
  const fit = await headerFit(page);
  expect(fit.below).toBe(false);
  expect(fit.guards).toBe(true);
  expect(fit.chooserAfterBalance).toBe(true);
  expect(fit.chooserBeforeWave).toBe(true);
  expect(fit.coversBalance).toBe(false);
  expect(fit.coversWave).toBe(false);
  expect(fit.labels).toEqual(['A–B']);
  expect(fit.name).not.toBe('');
});

test('three images at 800px drop the wipe switch under the header', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await stackImages(page, ['red.png', 'green.png', 'blue.png']);
  const fit = await headerFit(page);
  expect(fit.below).toBe(true);
  expect(fit.hostBelowHeader).toBe(true);
  expect(fit.hostInside).toBe(true);
  expect(fit.guards).toBe(true);
  expect(fit.coversBalance).toBe(false);
  expect(fit.labels).toEqual(['Ref–A', 'Ref–B', 'A–B']);
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('wipe-pair-below'))).toBe(false);
  const wide = await headerFit(page);
  expect(wide.chooserAfterBalance).toBe(true);
  expect(wide.chooserBeforeWave).toBe(true);
  expect(wide.guards).toBe(true);
});

test('four images at 1280px drop the wipe switch under the header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await stackImages(page, ['red.png', 'green.png', 'blue.png', 'fourth.png']);
  const fit = await headerFit(page);
  expect(fit.below).toBe(true);
  expect(fit.hostBelowHeader).toBe(true);
  expect(fit.hostInside).toBe(true);
  expect(fit.guards).toBe(true);
  expect(fit.coversBalance).toBe(false);
  expect(fit.labels).toEqual([
    'Image-1–Image-2', 'Image-1–Image-3', 'Image-1–Image-4',
    'Image-2–Image-3', 'Image-2–Image-4', 'Image-3–Image-4',
  ]);
});

test('What\'s New scrolls from the keyboard and keeps Tab and Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  await page.locator('#appVersion').click();
  const notes = page.locator('#changelogPopup .quick-start-body');
  await expect(notes).toBeFocused();
  await expect(notes).toHaveAttribute('aria-label', "What's new highlights");
  // The list stays focused so the keys below can scroll it, without a focus ring.
  expect(await notes.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  const scroll = () => notes.evaluate(el => el.scrollTop);
  expect(await scroll()).toBe(0);
  await page.keyboard.press('End');
  expect(await scroll()).toBeGreaterThan(100);
  const lastVisible = await notes.evaluate(el => {
    const last = el.querySelectorAll('li')[el.querySelectorAll('li').length - 1];
    const body = el.getBoundingClientRect();
    const item = last.getBoundingClientRect();
    return item.top >= body.top - 1 && item.bottom <= body.bottom + 2;
  });
  expect(lastVisible).toBe(true);
  await page.keyboard.press('Home');
  expect(await scroll()).toBe(0);
  await page.keyboard.press('PageDown');
  const paged = await scroll();
  expect(paged).toBeGreaterThan(40);
  await page.keyboard.press('PageUp');
  expect(await scroll()).toBeLessThan(paged);
  await page.keyboard.press('ArrowDown');
  expect(await scroll()).toBeGreaterThan(0);
  await page.keyboard.press('ArrowUp');
  expect(await scroll()).toBe(0);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('changelogPopup')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#changelogPopup')).toBeHidden();
});

test('H in a Settings field does not open Hotkeys', async ({ page }) => {
  await page.goto('/');
  await page.locator('#infoEditorButton').click();
  await expect(page.locator('#infoEditorDialog')).toBeVisible();
  await page.locator('#infoEditorPreset').focus();
  await page.keyboard.press('h');
  await expect(page.locator('#settingsTabInfo')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#infoEditorPreset')).toBeFocused();
  await page.locator('#settingsTabColors').click();
  await page.locator('#settingsPanelColors input[type="color"]').first().focus();
  await page.keyboard.press('h');
  await expect(page.locator('#settingsTabColors')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settingsPanelColors input[type="color"]').first()).toBeFocused();
  await page.evaluate(() => {
    const panel = document.getElementById('settingsPanelColors')!;
    const text = document.createElement('input');
    text.id = 'settingsTextProbe';
    text.type = 'text';
    panel.appendChild(text);
    const editable = document.createElement('div');
    editable.id = 'settingsEditableProbe';
    editable.contentEditable = 'true';
    editable.tabIndex = 0;
    editable.textContent = 'note';
    panel.appendChild(editable);
  });
  await page.locator('#settingsTextProbe').focus();
  await page.keyboard.press('h');
  await expect(page.locator('#settingsTabColors')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settingsTextProbe')).toBeFocused();
  await page.locator('#settingsEditableProbe').focus();
  await page.keyboard.press('h');
  await expect(page.locator('#settingsTabColors')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settingsEditableProbe')).toBeFocused();
  await page.locator('#settingsTabInfo').focus();
  await page.keyboard.press('h');
  await expect(page.locator('#settingsTabHotkeys')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#infoEditorDialog')).toBeVisible();
});
