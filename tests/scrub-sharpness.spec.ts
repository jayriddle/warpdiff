import { test, expect } from '@playwright/test';
import path from 'path';

// 1956×432 High-profile H.264 with 1px vertical stripes and a real BT.709 colr
// box. Linux Chrome takes the ordinary ImageBitmap scrub cache (not the
// software-AVC planar path, and not macOS native fallback). One keyframe means
// a back-and-forth drag revisits cached frames. The old 1280px width cap
// stretched those frames and dropped stripe contrast from about 255 to about 4.
const fixture = path.join(__dirname, 'fixtures', 'stripes_wide.mp4');

test('wide stripe scrub stays sharp when the frame comes from the cache', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '3.19.30'));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(fixture);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('.asset-layer.active video') as HTMLVideoElement | null;
    return !!video && video.videoWidth === 1956 && video.videoHeight === 432 && video.readyState >= 2;
  }, {}, { timeout: 20000 });

  const before = await page.evaluate(() => {
    const video = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { contrast: 0, width: 0 };
    ctx.drawImage(video, 0, 0);
    const y = canvas.height >> 1;
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    let acc = 0;
    for (let x = 1; x < canvas.width; x++) acc += Math.abs(row[x * 4] - row[(x - 1) * 4]);
    return { contrast: acc / (canvas.width - 1), width: canvas.width };
  });
  expect(before.width).toBe(1956);
  expect(before.contrast).toBeGreaterThan(100);

  const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
  expect(supported, 'CI Chrome provides VideoDecoder').toBe(true);
  const probe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 1.2));
  expect(probe, 'tagged High-profile stripes must use the decoder cache, not native seeking').toBeTruthy();
  expect(probe.dead).toBe(false);
  await page.waitForFunction(() => {
    const stats = (window as any).__testAPI.scrubVideo.cacheStats('editA');
    return !!stats && stats.frames >= 8 && stats.width === 1956 && stats.height === 432;
  }, {}, { timeout: 8000 });

  const bar = page.locator('#videoProgressContainer');
  const box = await bar.boundingBox();
  expect(box).toBeTruthy();
  const y = box!.y + box!.height / 2;
  const xAt = (fraction: number) => box!.x + box!.width * fraction;
  await page.mouse.move(xAt(0.7), y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(xAt(0.7 - 0.08 * i), y);
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(() => {
    const stats = (window as any).__testAPI.scrubVideo.cacheStats('editA');
    return !!stats && stats.hits >= 1 && document.querySelector('.scrub-overlay-canvas');
  }, {}, { timeout: 5000 });
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(xAt(0.22 + 0.08 * i), y);
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(() => {
    const stats = (window as any).__testAPI.scrubVideo.cacheStats('editA');
    return !!stats && stats.hits >= 3;
  }, {}, { timeout: 5000 });

  const during = await page.evaluate(() => {
    const canvas = document.querySelector('.scrub-overlay-canvas') as HTMLCanvasElement | null;
    const stats = (window as any).__testAPI.scrubVideo.cacheStats('editA');
    if (!canvas) return { contrast: 0, width: 0, height: 0, hits: stats?.hits || 0, cacheWidth: stats?.width || 0 };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { contrast: 0, width: canvas.width, height: canvas.height, hits: stats?.hits || 0, cacheWidth: stats?.width || 0 };
    const y = canvas.height >> 1;
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    let acc = 0;
    for (let x = 1; x < canvas.width; x++) acc += Math.abs(row[x * 4] - row[(x - 1) * 4]);
    return {
      contrast: acc / (canvas.width - 1),
      width: canvas.width,
      height: canvas.height,
      hits: stats?.hits || 0,
      cacheWidth: stats?.width || 0,
    };
  });
  await page.mouse.up();

  expect(during.hits).toBeGreaterThanOrEqual(3);
  expect(during.cacheWidth).toBe(1956);
  expect(during.width).toBe(1956);
  expect(during.height).toBe(432);
  expect(during.contrast).toBeGreaterThan(100);
  expect(during.contrast).toBeGreaterThan(before.contrast * 0.75);
});
