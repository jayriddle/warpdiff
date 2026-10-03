import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const layers = ['layerOriginal', 'layerEditA', 'layerEditB', 'layerEditC'];

async function visibleCells(page: Page) {
  return page.locator('.asset-container > .asset-layer').evaluateAll(nodes => nodes
    .filter(node => getComputedStyle(node).display !== 'none')
    .map(node => {
      const r = node.getBoundingClientRect();
      const picture = node.querySelector('.video-wrapper')!.getBoundingClientRect();
      return { id: node.id, label: node.querySelector('.asset-name')!.textContent,
        x: r.x, y: r.y, width: r.width, height: r.height,
        picture: { x: picture.x, y: picture.y, width: picture.width, height: picture.height } };
    })
    .sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y));
}

async function expectOrder(page: Page, numbers: number[]) {
  await expect.poll(async () => (await visibleCells(page)).map(cell => cell.id))
    .toEqual(numbers.map(n => layers[n - 1]));
  const cells = await visibleCells(page);
  expect(cells.map(cell => cell.label)).toEqual(numbers.map(n => `Video-${n}`));
  for (const cell of cells) {
    expect(cell.picture.width).toBeGreaterThan(30);
    expect(cell.picture.height).toBeGreaterThan(30);
  }
}

async function loadFourVideos(page: Page, mixed = false) {
  await page.goto('/');
  const files = mixed ? ['landscape_a.mp4', 'portrait.mp4', 'side_lr.mp4', 'landscape_b.mp4']
    : Array(4).fill('landscape_a.mp4');
  await page.locator('#multiFileInput').setInputFiles([1, 2, 3, 4].map(n => ({
    name: `video-${n}.mp4`, mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', files[n - 1])),
  })));
  await expect(page.locator('#comparisonView.active')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/quad-grid/);
  await page.waitForFunction(() => [...document.querySelectorAll('.asset-container > .asset-layer')]
    .every(layer => Number(getComputedStyle(layer).opacity) > .99));
  await expectOrder(page, [1, 2, 3, 4]);
}

for (const axis of ['columns', 'rows']) {
  test(`hiding each of four videos preserves Inline ${axis} order and restoration`, async ({ page }) => {
    await page.setViewportSize(axis === 'columns' ? { width: 1920, height: 1080 } : { width: 960, height: 1200 });
    await loadFourVideos(page);
    for (const hidden of [1, 2, 3, 4]) {
      await page.locator(`#${layers[hidden - 1]} .asset-name`).click();
      await expect(page.locator('body')).toHaveClass(axis === 'columns' ? /inline-cols/ : /inline-rows/);
      const remaining = [1, 2, 3, 4].filter(n => n !== hidden);
      await expectOrder(page, remaining);
      // The same visible order survives Stack/Grid and viewport reflow.
      await page.locator('#stackIconBtn').click();
      await page.locator('#gridIconBtn').click();
      await expectOrder(page, remaining);
      const alternate = axis === 'columns' ? { width: 960, height: 1200 } : { width: 1920, height: 1080 };
      await page.setViewportSize(alternate);
      await expect(page.locator('body')).toHaveClass(axis === 'columns' ? /inline-rows/ : /inline-cols/);
      await expectOrder(page, remaining);
      await page.setViewportSize(axis === 'columns' ? { width: 1920, height: 1080 } : { width: 960, height: 1200 });
      await expect(page.locator('body')).toHaveClass(axis === 'columns' ? /inline-cols/ : /inline-rows/);
      await expectOrder(page, remaining);
      await page.locator(`#modeStrip .hidden-slot-pill[title="Show Video-${hidden}"]`).click();
      await expect(page.locator('body')).toHaveClass(/quad-grid/);
      await expectOrder(page, [1, 2, 3, 4]);
    }
    // Collapse further and restore in a different order using the keyboard.
    for (const hidden of [1, 3, 2]) await page.keyboard.press(`Shift+${hidden}`);
    await expectOrder(page, [4]);
    for (const [shown, expected] of [[1, [1, 4]], [2, [1, 2, 4]], [3, [1, 2, 3, 4]]] as const) {
      await page.keyboard.press(`Shift+${shown}`);
      await expectOrder(page, [...expected]);
    }
  });
}

for (const mixed of [false, true]) test(`Offset assigns its three positions to the remaining ${mixed ? 'mixed-aspect' : 'landscape'} videos in order`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loadFourVideos(page, mixed);
  for (const hidden of [1, 2, 3, 4]) {
    await page.keyboard.press(`Shift+${hidden}`);
    await page.locator('#offsetModeBtn').click();
    await expect(page.locator('body')).toHaveClass(/offset/);
    const remaining = [1, 2, 3, 4].filter(n => n !== hidden);
    await expectOrder(page, remaining);
    // Offset positions are committed by the queued layout pass after the class
    // changes. Wait for rendered geometry, not just the synchronous mode class.
    await expect.poll(async () => {
      const [first, second, third] = await visibleCells(page);
      return first.x < second.x && Math.abs(second.x - third.x) < .5
        && second.y < third.y && first.height > second.height + third.height;
    }).toBe(true);
    const areas = (await visibleCells(page)).map(cell => cell.picture.width * cell.picture.height);
    expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.03);
    await page.locator('#inlineModeBtn').click();
    await expectOrder(page, remaining);
    await page.keyboard.press(`Shift+${hidden}`);
    await expectOrder(page, [1, 2, 3, 4]);
  }
});
