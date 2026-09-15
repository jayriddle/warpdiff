import { test, expect } from '@playwright/test';
import path from 'node:path';

test('slow pointer motion keeps preview audio alive while the picture holds a frame', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  const warm = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2));
  expect(warm && !warm.dead && warm.framesPainted > 0).toBeTruthy();
  await page.evaluate(() => (window as any).eval(`(() => {
    pauseAllMedia();
    window.__cadence = [];
    const play = playScrubSnippet;
    playScrubSnippet = time => {
      play(time);
      window.__cadence.push({ at:performance.now(), time, audible:!!_scrubSource });
    };
  })()`));
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  expect(box.width).toBeGreaterThan(400);
  const duration = await page.evaluate(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).duration);
  const x = box.x + box.width * 2 / duration, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Less than one video frame of travel per 90 ms grain. The pointer remains
  // active, but successive presentation callbacks frequently have identical PTS.
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(x + box.width * (i * 0.0015) / duration, y);
    await page.waitForTimeout(20);
  }
  const moving = await page.evaluate(() => ({
    trace:(window as any).__cadence.slice(),
    dragging:(window as any).__testAPI.isDragging,
    overlay:(window as any).__testAPI.scrubVideo.overlayLive(),
  }));
  expect(moving.dragging && moving.overlay).toBe(true);
  const audible = moving.trace.filter((e: any) => e.audible);
  expect(new Set(audible.map((e: any) => e.time)).size).toBeGreaterThan(1);
  expect(audible.length).toBeGreaterThan(15);
  const gaps = audible.slice(1).map((e: any, i: number) => e.at - audible[i].at);
  expect(Math.max(...gaps)).toBeLessThan(150);
  expect(audible.some((e: any, i: number) => i > 0 && e.time === audible[i - 1].time)).toBe(true);

  // A held button is not perpetual audition. Late frame callbacks and duplicate
  // mouse positions at a clamped edge must not keep old audio playing.
  await page.waitForTimeout(250);
  const idle = await page.evaluate(() => (window as any).__cadence.length);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => (window as any).__cadence.length)).toBe(idle);
  expect(await page.evaluate(() => (window as any).eval('!!_scrubSource'))).toBe(false);
  await page.evaluate(() => (window as any).eval('_feedScrubAudio(2.05)'));
  expect(await page.evaluate(() => (window as any).__cadence.length)).toBe(idle);

  // Reverse motion resumes the same audition owner after an idle hold.
  for (let i = 60; i >= 30; i--) {
    await page.mouse.move(x + box.width * (i * 0.0015) / duration, y);
    await page.waitForTimeout(20);
  }
  expect(await page.evaluate(() => (window as any).__cadence.length)).toBeGreaterThan(idle + 8);

  // Pointer events keep arriving outside the timeline, but its clamped target
  // stays at the end. After the idle window, no further snippets may be emitted.
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box.x + box.width + 5 + i, y);
    await page.waitForTimeout(25);
  }
  const edge = await page.evaluate(() => (window as any).__cadence.length);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.width + 20 + i, y);
    await page.waitForTimeout(25);
  }
  expect(await page.evaluate(() => (window as any).__cadence.length)).toBe(edge);
  await page.mouse.up();
});

test('overlapping held-frame grains retain level, channels, volume, and idle silence', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => (window as any).eval(`(async () => {
    const savedContext = getAudioContext;
    const savedTimeout = window.setTimeout;
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = ctx.createBuffer(8, 48000, 48000);
    buf.getChannelData(2).fill(0.1); // center-only constant signal exposes level holes
    getAudioContext = () => ctx;
    window.setTimeout = () => 1; // source duration/automation still run on the audio clock
    _videoAudioBuffers.editA = buf;
    _audioTimelineStarts.editA = 0.166;
    currentAudioSource = 'editA'; isMuted = false; audioMuteStates.editA = false;
    _prefs.save('volume', 50);
    const stops = [];
    try {
      for (let i = 1; i <= 10; i++) {
        stops.push(ctx.suspend(i * 0.05).then(() => {
          if (i < 10) playScrubSnippet(0.416); else stopScrubSnippet();
          return ctx.resume();
        }));
      }
      playScrubSnippet(0.416);
      const out = await ctx.startRendering();
      await Promise.all(stops);
      const left = out.getChannelData(0), right = out.getChannelData(1);
      const steady = left.subarray(4800, 21000);
      let min = Infinity, max = 0, channelError = 0, idlePeak = 0;
      for (let i = 0; i < steady.length; i++) { min = Math.min(min, steady[i]); max = Math.max(max, steady[i]); }
      for (let i = 0; i < left.length; i++) channelError = Math.max(channelError, Math.abs(left[i] - right[i]));
      for (let i = 28800; i < left.length; i++) idlePeak = Math.max(idlePeak, Math.abs(left[i]));
      return { min, max, channelError, idlePeak, channels:buf.numberOfChannels };
    } finally { getAudioContext = savedContext; window.setTimeout = savedTimeout; }
  })()`));
  expect(r.channels).toBe(8);
  expect(r.min).toBeCloseTo(0.1 * Math.SQRT1_2 * 0.5, 4);
  expect(r.max).toBeCloseTo(r.min, 4);
  expect(r.channelError).toBe(0);
  expect(r.idlePeak).toBe(0);
});
