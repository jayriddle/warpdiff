import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareFrameRateFixture } from './helpers/frame-rate-fixture.mjs';

let directory: string;
let fixture: string;

test.beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-frame-rate-'));
  fixture = prepareFrameRateFixture(directory);
});

test.afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

test('frame stepping uses a constant 24 fps sample table before playback', async ({ page }) => {
  let measured = false;
  page.on('console', message => { if (message.text().startsWith('[fps]')) measured = true; });
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(fixture);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const video = document.querySelector('.asset-layer video') as HTMLVideoElement | null;
    const rates = (window as any).__testAPI?._videoFps;
    return !!video && video.readyState >= 2 && rates && rates[0] === 24;
  }, null, { timeout: 15000 });

  const stepped = await page.evaluate(async () => {
    const video = document.querySelector('.asset-layer video') as HTMLVideoElement;
    const read = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return -1;
      context.drawImage(video, 0, 0);
      let number = 0;
      for (let bit = 0; bit < 6; bit++) {
        const pixel = context.getImageData(bit * 40 + 15, 20, 1, 1).data;
        if (pixel[0] > 100) number |= 1 << bit;
      }
      return number;
    };
    const settle = () => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1500);
      video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    (window as any).stepFrame(1);
    await settle();
    (window as any).stepFrame(1);
    await settle();
    return { time: video.currentTime, frame: read(), rate: (window as any).__testAPI._videoFps[0] };
  });

  expect(stepped.rate).toBe(24);
  expect(stepped.time).toBeCloseTo(2.5 / 24, 4);
  expect(stepped.frame).toBe(2);

  await page.evaluate(() => (window as any).playAllMedia());
  await expect.poll(() => measured, { timeout: 8000 }).toBe(true);
  await page.evaluate(() => (window as any).pauseAllMedia());
  expect(await page.evaluate(() => (window as any).__testAPI._videoFps[0])).toBe(24);
});
