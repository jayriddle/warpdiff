import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

async function loadPaused(page: Page, files = ['landscape_a.mp4']) {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(files.map(file => path.join(__dirname, 'fixtures', file)));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await page.waitForFunction(() => {
    const videos = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
    return videos.length && videos.every(v => v.readyState >= 2 && !v.seeking && v.paused);
  });
}

async function scrubPaused(page: Page, slots: string[]) {
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, y, { steps: 24 });
  // Wait inside the gesture so the test exercises a live decoder retained by
  // mouseup, rather than an initialization that finishes late and self-suspends.
  await page.waitForFunction(slots => slots.every(slot => {
    const scrub = (window as any).__testAPI.scrubVideo;
    return scrub.sessionState(slot) === 'ready' && scrub.cacheStats(slot)?.frames > 0;
  }), slots);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const app = window as any;
    return !app.__testAPI.isDragging && app.getTransportPlayableMedia().every((v: HTMLMediaElement) => v.paused && !v.seeking);
  });
  await page.evaluate(async slots => {
    const app = window as any;
    app.__restartSessions = await Promise.all(slots.map(slot => app._scrubOverlayGetSession(slot)));
  }, slots);
  const cache = await page.evaluate(slots => slots.map(slot => {
    const scrub = (window as any).__testAPI.scrubVideo;
    return { state: scrub.sessionState(slot), cache: scrub.cacheStats(slot) };
  }), slots);
  cache.forEach(s => expect(s.state).toBe('ready'));
  return cache.map(s => s.cache);
}

async function expectRetainedAndSuspended(page: Page, slots: string[], cache: unknown[]) {
  const actual = await page.evaluate(async slots => {
    const app = window as any;
    return Promise.all(slots.map(async (slot, index) => ({
      state: app.__testAPI.scrubVideo.sessionState(slot),
      cache: app.__testAPI.scrubVideo.cacheStats(slot),
      sameSession: await app._scrubOverlayGetSession(slot) === app.__restartSessions[index],
    })));
  }, slots);
  expect(actual).toEqual(cache.map(cache => ({ state: 'suspended', cache, sameSession: true })));
}

async function watchWraps(page: Page) {
  await page.evaluate(() => {
    const app = window as any;
    app.__restartWraps = app.getTransportVideos().map((video: HTMLVideoElement) => {
      const state = { last: -1, wraps: 0, first: -1, lowestWrap: Infinity };
      const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        const time = metadata.mediaTime;
        if (state.first < 0) state.first = time;
        if (time < state.last - 0.3) {
          state.wraps++;
          state.lowestWrap = Math.min(state.lowestWrap, time);
        }
        state.last = time;
        video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      return state;
    });
  });
}

for (const key of ['Space', 'r']) {
  test(`${key} after a paused scrub restores native looping and suspends retained decoders`, async ({ page }) => {
    await loadPaused(page);
    const cache = await scrubPaused(page, ['editA']);
    expect(await page.locator('#layerEditA video').evaluate((v: HTMLVideoElement) => v.loop)).toBe(false);
    await watchWraps(page);
    await page.keyboard.press(key);
    await page.waitForFunction(() => !(document.querySelector('#layerEditA video') as HTMLVideoElement).paused);
    expect(await page.locator('#layerEditA video').evaluate((v: HTMLVideoElement) => v.loop)).toBe(true);
    await expectRetainedAndSuspended(page, ['editA'], cache);
    // Observe actual presented frames crossing the end twice, not just .loop.
    await page.waitForFunction(() => (window as any).__restartWraps[0].wraps >= 2, null, { timeout: 12000 });
    const frames = await page.evaluate(() => (window as any).__restartWraps[0]);
    expect(frames.lowestWrap).toBeLessThan(0.2);
    if (key === 'r') expect(frames.first).toBeLessThan(0.2);
    expect(await page.locator('#layerEditA video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

    // The next drag can resume the retained session and reuse its frame cache.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).paused);
    await scrubPaused(page, ['editA']);
    const resumed = await page.evaluate(() => (window as any).__testAPI.scrubVideo.cacheStats('editA'));
    expect(resumed.hits).toBeGreaterThan(cache[0].hits);
  });
}

test('R after a Grid scrub preserves the shared custom loop', async ({ page }) => {
  await loadPaused(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  await page.evaluate(() => (window as any).__testAPI.setLoopPoints(0.5, 1.5));
  const cache = await scrubPaused(page, ['editA', 'editB']);
  await watchWraps(page);
  await page.keyboard.press('r');
  await expectRetainedAndSuspended(page, ['editA', 'editB'], cache);
  await page.waitForFunction(() => (window as any).__restartWraps.every((s: any) => s.wraps >= 2));
  const result = await page.evaluate(() => ({
    frames: (window as any).__restartWraps,
    bounds: (window as any).__testAPI._loopBounds,
    videos: (window as any).getTransportVideos().map((v: HTMLVideoElement) => ({ paused: v.paused, nativeLoop: v.loop })),
  }));
  expect(result.bounds).toEqual({ inP: 0.5, outP: 1.5 });
  expect(result.videos).toEqual([{ paused: false, nativeLoop: false }, { paused: false, nativeLoop: false }]);
  for (const frame of result.frames) {
    expect(frame.first).toBeGreaterThanOrEqual(0.45);
    expect(frame.first).toBeLessThan(0.7);
    expect(frame.lowestWrap).toBeGreaterThanOrEqual(0.45);
    expect(frame.lowestWrap).toBeLessThan(0.7);
  }
});

test('R after a Solo scrub loops only the selected video and suspends all retained decoders', async ({ page }) => {
  await loadPaused(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  await scrubPaused(page, ['editA', 'editB']);
  await page.keyboard.press('Shift+s');
  await page.evaluate(() => (window as any).selectAudioSource('editA'));
  const cache = await scrubPaused(page, ['editA', 'editB']);
  await watchWraps(page);
  await page.keyboard.press('r');
  await expectRetainedAndSuspended(page, ['editA', 'editB'], cache);
  await page.waitForFunction(() => (window as any).__restartWraps[0].wraps >= 2, null, { timeout: 12000 });
  const result = await page.evaluate(() => ({
    scope: (window as any).__testAPI._playbackScope,
    slots: (window as any).__testAPI._transportSlots,
    videos: Array.from(document.querySelectorAll('.asset-layer video')).map((v: HTMLVideoElement) => ({ paused: v.paused, nativeLoop: v.loop })),
  }));
  expect(result.scope).toBe('solo');
  expect(result.slots).toEqual(['editA']);
  expect(result.videos).toEqual([{ paused: false, nativeLoop: true }, { paused: true, nativeLoop: false }]);
});
