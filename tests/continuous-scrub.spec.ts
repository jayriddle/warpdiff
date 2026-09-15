import { test, expect } from '@playwright/test';
import path from 'node:path';

test('continuous scrub is standard, retains center dialogue, and releases its stream', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pref_scrubAudioMode', JSON.stringify('snippets')));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  await expect(page.locator('#scrubModeBtn')).toHaveCount(0);
  await page.waitForFunction(() => (window as any).eval('!!_continuousScrubEngine.state.node'));
  const warm = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2));
  expect(warm.framesPainted).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as any).eval(`({
    channels:_videoAudioBuffers.editA.numberOfChannels, metrics:JSON.stringify(audioMetrics.editA),
    start:_audioTimelineStarts.editA, bytes:_continuousScrubEngine.state.bytes
  })`));
  expect(before.channels).toBe(2);
  expect(JSON.parse(before.metrics).channels).toBe(8);
  expect(before.start).toBeCloseTo(0.166, 3);
  expect(before.bytes).toBeGreaterThan(0);
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  const duration = await page.evaluate(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).duration);
  const x = box.x + box.width * 2 / duration, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 45; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  const playing = await page.evaluate(() => (window as any).eval(`(() => {
    const state = _continuousScrubEngine.state;
    const analyser = state.ctx.createAnalyser(); analyser.fftSize = 2048;
    state.gain.connect(analyser); window.__continuousAnalyser = analyser;
    return {active:state.active, sameChannels:_videoAudioBuffers.editA.numberOfChannels,
      metrics:JSON.stringify(audioMetrics.editA), gain:state.gain.gain.value};
  })()`));
  expect(playing.active).toBe(true);
  expect(playing.sameChannels).toBe(before.channels);
  expect(playing.metrics).toBe(before.metrics);
  for (let i = 46; i <= 55; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  const rms = await page.evaluate(() => {
    const a = (window as any).__continuousAnalyser;
    const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((s, v) => s + v*v, 0) / data.length);
  });
  expect(rms).toBeGreaterThan(0.01);
  const node = await page.evaluate(() => (window as any).eval(`(window.__scrubNode = _continuousScrubEngine.state.node, true)`));
  expect(node).toBe(true);
  for (let i = 54; i >= 20; i--) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubCursor.direction'))).toBe(-1);
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.node === window.__scrubNode'))).toBe(true);
  await page.evaluate(() => (window as any).eval('toggleMute()'));
  await expect.poll(() => page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.evaluate(() => (window as any).eval('toggleMute()'));
  for (let i = 21; i <= 35; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(true);
  await page.waitForTimeout(250); // holding a drag still must stop the continuous stream
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.evaluate(() => (window as any).clearAllMedia());
  expect(await page.evaluate(() => (window as any).eval('({bytes:_continuousScrubEngine.state.bytes, node:!!_continuousScrubEngine.state.node})'))).toEqual({bytes:0,node:false});
});

test('old snippet preferences are ignored and failed loading retains click and drag previews', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('pref_scrubAudioMode', JSON.stringify('snippets')));
  await page.reload();
  await expect(page.locator('#scrubModeBtn')).toHaveCount(0);
  // A real failed module URL exercises the fallback; page routing does not
  // intercept AudioWorklet fetches consistently across Chromium versions.
  await page.evaluate(() => (window as any).eval(`(() => {
    const prototype = Object.getPrototypeOf(getAudioContext().audioWorklet), add = prototype.addModule;
    prototype.addModule = function() { return add.call(this, '/missing-scrub-module.js'); };
    window.__fallbackGrains = [];
    const play = playScrubSnippet;
    playScrubSnippet = time => { play(time); window.__fallbackGrains.push({time,source:!!_scrubSource}); };
  })()`));
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  const duration = await page.evaluate(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).duration);
  const x = box.x + box.width * 2 / duration, y = box.y + box.height / 2;
  await page.mouse.move(x,y); await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(x + box.width * i * 0.003 / duration,y);
    await page.waitForTimeout(20);
  }
  const fallback = await page.evaluate(() => (window as any).eval(`({
    error:_continuousScrubEngine.state.error, grains:window.__fallbackGrains.filter(g => g.source).length,
    node:!!_continuousScrubEngine.state.node, bytes:_continuousScrubEngine.state.bytes
  })`));
  expect(fallback.error).toBeTruthy(); expect(fallback.node).toBe(false);
  expect(fallback.bytes).toBe(0); expect(fallback.grains).toBeGreaterThan(5);
  await page.mouse.up();
  await page.evaluate(() => (window as any).eval('playScrubSnippet(2)'));
  expect(await page.evaluate(() => (window as any).eval('!!_scrubSource'))).toBe(true);
});

test('Grid source changes retain only the selected continuous buffer and clear pending work', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles([
    path.join(__dirname, 'fixtures/surround_71.mp4'),
    path.join(__dirname, 'fixtures/landscape_a.mp4'),
    path.join(__dirname, 'fixtures/landscape_b.mp4'),
  ]);
  await page.waitForFunction(() => (window as any).eval('Object.keys(_videoAudioBuffers).length >= 3'));
  await page.evaluate(() => (window as any).eval(`if (!isGridMode) _toggleStackGridMode();`));
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const slots = assetOrder.filter(slot => _videoAudioBuffers[slot]);
    const counts = [];
    for (const slot of slots) {
      selectAudioSource(slot); await _prepareContinuousScrub();
      const state = _continuousScrubEngine.state;
      counts.push({selected:state.buffer === _videoAudioBuffers[slot], channels:state.node.numberOfOutputs,
        bytes:state.bytes, expected:Math.ceil(_videoAudioBuffers[slot].duration * state.ctx.sampleRate) * Math.min(2, _videoAudioBuffers[slot].numberOfChannels) * 4});
    }
    // Start another request and clear immediately. Its completion cannot republish.
    const wasGrid = isGridMode; selectAudioSource(slots[0]); const pending = _prepareContinuousScrub(); clearAllMedia(); await pending;
    return {wasGrid, grid:counts, bytes:_continuousScrubEngine.state.bytes, node:!!_continuousScrubEngine.state.node};
  })()`));
  expect(result.wasGrid).toBe(true);
  expect(result.grid).toHaveLength(3);
  for (const row of result.grid) { expect(row.selected).toBe(true); expect(row.bytes).toBe(row.expected); }
  expect(result.bytes).toBe(0); expect(result.node).toBe(false);
});
