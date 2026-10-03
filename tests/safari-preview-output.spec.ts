import { test, expect, Page } from '@playwright/test';
import path from 'path';

// These are Chromium scheduling/PCM tests of the Safari policy, not speaker
// listening tests. Native Safari audibility is recorded separately.
test.use({ serviceWorkers: 'block' });

async function load(page: Page, safari = true, fallback = false, files = ['landscape_a.mp4', 'landscape_b.mp4']) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.addInitScript(({ safari, fallback }) => {
    if (safari) {
      Object.defineProperty(HTMLMediaElement.prototype, 'fastSeek', { configurable: true, value() {} });
      (window as any).GestureEvent = class {};
    }
    if (fallback) (window as any).AudioWorkletNode = class { constructor() { throw new Error('test processor unavailable'); } };
    // Simulate a direct speaker path that is silent while Web Audio renders.
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination: any, ...ports: any[]) {
      if (destination instanceof AudioDestinationNode && this.context instanceof AudioContext) {
        const silent = this.context.createGain(); silent.gain.value = 0;
        (connect as any).call(silent, destination);
        return (connect as any).call(this, silent, ...ports);
      }
      return (connect as any).call(this, destination, ...ports);
    } as any;
  }, { safari, fallback });
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(files.map(file => path.join(__dirname, 'fixtures', file)));
  await expect(page.locator('#comparisonView.active')).toBeVisible();
  await page.waitForFunction(() => ['editA','editB'].every(slot => (window as any).__testAPI.scrubAudioInfo(slot)));
  if (!fallback) await page.waitForFunction(() => !!(window as any).__testAPI.continuousScrubState.node);
  await page.evaluate(() => (window as any).pauseAllMedia());
}

async function start(page: Page, fraction = .15) {
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  return box;
}

async function meter(page: Page) {
  await page.evaluate(() => {
    const app = window as any, output = app.__testAPI.scrubPreviewOutput;
    const source = output.context.createMediaStreamSource(output.stream);
    const analyser = output.context.createAnalyser(); analyser.fftSize = 1024;
    const silent = output.context.createGain(); silent.gain.value = 0;
    source.connect(analyser); analyser.connect(silent); silent.connect(output.context.destination);
    app.previewMeter = { source, analyser, silent };
    app.previewRms = () => {
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum: number, value: number) => sum + value * value, 0) / data.length);
    };
  });
}

async function sweep(page: Page, box: {x:number,y:number,width:number,height:number}, reverse = false) {
  let peak = 0;
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(box.x + box.width * (reverse ? .72 - i * .035 : .15 + i * .035), box.y + box.height / 2);
    await page.waitForTimeout(45);
    peak = Math.max(peak, await page.evaluate(() => (window as any).previewRms()));
  }
  return peak;
}

for (const fallback of [false, true]) {
  test(`${fallback ? 'snippet fallback' : 'Continuous'} reaches the native stream when the direct destination is silent`, async ({ page }) => {
    await load(page, true, fallback);
    expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput)).toBeNull();
    const box = await start(page);
    await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(1);
    await meter(page);
    expect(await sweep(page, box)).toBeGreaterThan(.01);
    expect(await sweep(page, box, true)).toBeGreaterThan(.01);
    expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput.audio.paused)).toBe(false);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput.audio.paused)).toBe(true);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).previewRms())).toBeLessThan(.001);
    expect(await page.evaluate(() => (window as any).__testAPI.continuousScrubState.error !== null)).toBe(fallback);
  });
}

for (const channels of [6, 8]) for (const codec of ['FLAC', 'Opus']) {
  const suffix = channels === 6 ? '51' : '71';
  test(`${codec} ${suffix} preserves center listening through the Safari stream output`, async ({ page }) => {
    // Exercise Safari's preview preparation instead of Chrome's full-original
    // Opus replacement buffers. Codec execution remains Chromium/WebCodecs.
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {
      configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
    }));
    await load(page, true, false, ['landscape_a.mp4', `dialogue_${suffix}${codec === 'Opus' ? '_opus' : ''}.mp4`]);
    await page.evaluate(async () => {
      const app = window as any;
      app.selectAudioSource('editB');
      await app._prepareContinuousScrub();
    });
    await expect(page.locator('[data-listening-mode="center"]')).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__testAPI.scrubAudioInfo('editB').channels)).toBe(3);
    expect(await page.evaluate(() => (window as any).eval('audioMetrics.editB.channels'))).toBe(channels);
    const box = await start(page);
    await meter(page);
    expect(await sweep(page, box)).toBeGreaterThan(.01);
    await page.evaluate(() => (window as any).setAudioListening({mode:'center'}));
    await page.waitForTimeout(250);
    expect(await sweep(page, box, true)).toBeGreaterThan(.01);
    await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Center Only');
    expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput.stream.getAudioTracks().length)).toBe(1);
    await page.mouse.up();
    await page.evaluate(() => (window as any).clearAllMedia());
    await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(0);
  });
}

test('idle, mute, volume, rapid re-entry and hidden-tab cancellation keep one output', async ({ page }) => {
  await load(page);
  const box = await start(page);
  await meter(page);
  const full = await sweep(page, box);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput.audio.paused)).toBe(true);
  expect(await page.evaluate(() => (window as any).previewRms())).toBeLessThan(.001);
  // A held pointer can resume after idle without allocating another sink.
  expect(await sweep(page, box, true)).toBeGreaterThan(.01);
  await page.evaluate(() => (window as any).setVolume(25));
  // Drain the prior full-level media-stream output and let the held pointer
  // go idle before measuring a new quarter-level sweep.
  await page.waitForTimeout(250);
  const quarter = await sweep(page, box);
  expect(quarter / full).toBeGreaterThan(.12);
  expect(quarter / full).toBeLessThan(.45);
  await page.keyboard.press('m');
  await page.waitForTimeout(150);
  expect(await sweep(page, box, true)).toBeLessThan(.001);
  await page.keyboard.press('m');
  await page.evaluate(() => (window as any).setVolume(100));
  expect(await sweep(page, box)).toBeGreaterThan(.01);
  await page.evaluate(() => {
    const app = window as any, timeout = window.setTimeout;
    app.retiredPreviewPauses = [];
    window.setTimeout = ((callback: TimerHandler, ms?: number, ...args: any[]) => {
      // Hold the real output owner's 40ms pause, then deliver it after a new
      // gesture even though clearTimeout would normally cancel it.
      if (ms === 40) app.retiredPreviewPauses.push(callback);
      return timeout(callback, ms, ...args);
    }) as typeof window.setTimeout;
  });
  await page.mouse.up();
  await start(page, .7);
  expect(await page.evaluate(() => {
    const app = window as any, held = app.retiredPreviewPauses.splice(0);
    held.forEach((callback: Function) => callback());
    return { delivered: held.length, paused: app.__testAPI.scrubPreviewOutput.audio.paused,
      requested: app.__testAPI.scrubPreviewOutput.requested };
  })).toEqual({ delivered: 1, paused: false, requested: true });
  expect(await sweep(page, box, true)).toBeGreaterThan(.01);
  await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => ({
    paused: (window as any).__testAPI.scrubPreviewOutput.audio.paused,
    requested: (window as any).__testAPI.scrubPreviewOutput.requested,
    dragging: (window as any).__testAPI.isDragging,
  }))).toEqual({ paused: true, requested: false, dragging: false });
  await page.mouse.up();
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).previewRms())).toBeLessThan(.001);
  await start(page);
  expect(await sweep(page, box)).toBeGreaterThan(.01);
  await page.mouse.up();
});

test('clear during a drag ends the stream and replacement creates a fresh sink', async ({ page }) => {
  await load(page);
  const box = await start(page);
  await meter(page);
  expect(await sweep(page, box)).toBeGreaterThan(.01);
  await page.evaluate(() => {
    const app = window as any;
    app.retiredPreview = app.__testAPI.scrubPreviewOutput;
    app.clearAllMedia();
  });
  await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const app = window as any, old = app.retiredPreview;
    return { output: app.__testAPI.scrubPreviewOutput, paused: old.audio.paused,
      detached: !old.audio.isConnected, stream: old.audio.srcObject,
      tracks: old.stream.getTracks().map((track: MediaStreamTrack) => track.readyState) };
  })).toEqual({ output: null, paused: true, detached: true, stream: null, tracks: ['ended'] });
  await page.mouse.up();
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', 'landscape_a.mp4'));
  await expect(page.locator('#comparisonView.active')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__testAPI.continuousScrubState.node);
  await start(page);
  expect(await page.evaluate(() => {
    const app = window as any;
    return app.__testAPI.scrubPreviewOutput.audio !== app.retiredPreview.audio &&
      app.__testAPI.scrubPreviewOutput.context !== app.retiredPreview.context;
  })).toBe(true);
  await meter(page);
  expect(await sweep(page, (await page.locator('#videoProgressContainer').boundingBox())!)).toBeGreaterThan(.01);
  await page.mouse.up();
});

test('loop-marker adjustment does not start a preview output', async ({ page }) => {
  await load(page);
  await page.evaluate(() => (window as any).__testAPI.setLoopPoints(.5, 2));
  const marker = page.locator('#loopInMarker');
  await expect(marker).toBeVisible();
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y + box.height / 2);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput)).toBeNull();
});

test('tab hiding settles a released fade and a stale play rejection cannot affect replacement', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const app = window as any, play = HTMLMediaElement.prototype.play;
    app.previewPlayHeld = false;
    HTMLMediaElement.prototype.play = function() {
      if (this.hasAttribute('data-scrub-preview-output') && !app.previewPlayHeld) {
        app.previewPlayHeld = true;
        return new Promise<void>((_resolve, reject) => { app.rejectRetiredPreview = reject; });
      }
      return play.call(this);
    };
  });
  await start(page);
  await page.mouse.up();
  await page.evaluate(() => {
    const app = window as any;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    app.releasedPreviewPaused = app.__testAPI.scrubPreviewOutput.audio.paused;
    app.clearAllMedia();
    app.rejectRetiredPreview(new DOMException('test canceled', 'AbortError'));
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (window as any).releasedPreviewPaused)).toBe(true);
  await expect(page.getByText('Scrub audio could not start. Try dragging again.', {exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput)).toBeNull();
});

test('ordinary Chromium keeps its direct preview output', async ({ page }) => {
  await load(page, false);
  await start(page);
  await page.mouse.move(600, 650);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__testAPI.scrubPreviewOutput)).toBeNull();
  await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(0);
});
