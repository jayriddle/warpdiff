import { test, expect } from '@playwright/test';

test('video preview keeps full-rate high frequencies and stereo phase', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const ctx = getAudioContext(), input = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate);
    for (let i = 0; i < input.length; i++) {
      input.getChannelData(0)[i] = 0.2 * Math.sin(2 * Math.PI * 16000 * i / input.sampleRate);
      input.getChannelData(1)[i] = -input.getChannelData(0)[i];
    }
    await _finalizeAudioViz('editA', input);
    const output = _videoAudioBuffers.editA;
    const amplitude = hz => {
      let real = 0, imag = 0, data = output.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        real += data[i] * Math.cos(2 * Math.PI * hz * i / output.sampleRate);
        imag += data[i] * Math.sin(2 * Math.PI * hz * i / output.sampleRate);
      }
      return 2 * Math.hypot(real, imag) / data.length;
    };
    return {rate:output.sampleRate, expectedRate:ctx.sampleRate, channels:output.numberOfChannels,
      same:output === input, high:amplitude(16000), alias:amplitude(6050),
      phase:Math.max(...output.getChannelData(0).subarray(0,1000).map((v,i) => Math.abs(v + output.getChannelData(1)[i])))};
  })()`));
  expect(result.rate).toBe(result.expectedRate);
  expect(result.channels).toBe(2); expect(result.same).toBe(true);
  expect(result.high).toBeCloseTo(0.2, 4);
  expect(result.alias).toBeLessThan(0.00001); expect(result.phase).toBe(0);
});

test('surround listening folds center while both analysis views retain original inputs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const ctx = getAudioContext(), input = ctx.createBuffer(8, ctx.sampleRate, ctx.sampleRate);
    input.getChannelData(2).fill(0.1);
    await _finalizeAudioViz('editA', input);
    _populateNoVideoSlotData('editA');
    const out = _videoAudioBuffers.editA, viz = _audioSlotVizData.editA;
    return {channels:out.numberOfChannels, rate:out.sampleRate, expectedRate:ctx.sampleRate,
      left:out.getChannelData(0)[100], right:out.getChannelData(1)[100],
      originalChannels:audioMetrics.editA.channels, originalCenter:input.getChannelData(2)[100],
      waveformPeak:waveformData.editA.peak, noVideoPeak:viz.waveform.peak,
      sameWaveform:viz.waveform === waveformData.editA, sameSpectrogram:viz.spectrogram === spectrogramData.editA};
  })()`));
  expect(result.channels).toBe(2); expect(result.rate).toBe(result.expectedRate);
  expect(result.left).toBeCloseTo(0.1 * Math.SQRT1_2, 6); expect(result.right).toBe(result.left);
  expect(result.originalChannels).toBe(8); expect(result.originalCenter).toBeCloseTo(0.1, 6);
  expect(result.waveformPeak).toBe(0); expect(result.noVideoPeak).toBe(0);
  expect(result.sameWaveform && result.sameSpectrogram).toBe(true);
});

test('a preview budget uses filtered, audible fallback and leaves analysis available', async ({ page }) => {
  // Scale only the shipped budget down to exercise the real allocation/fallback
  // owners with a one-second signal, without a large allocation in CI.
  await page.route('**/js/scrub-audio.js', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('const _SCRUB_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;');
    await route.fulfill({response, body:source.replace('const _SCRUB_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;', 'const _SCRUB_PREVIEW_MAX_BYTES = 64000;')});
  });
  await page.goto('/');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const ctx = getAudioContext(), source = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate);
    currentAudioSource = 'editA'; isMuted = false; audioMuteStates.editA = false;
    for (let i = 0; i < source.length; i++) {
      const value = 0.1 * Math.sin(2 * Math.PI * 500 * i / source.sampleRate) + 0.1 * Math.sin(2 * Math.PI * 15000 * i / source.sampleRate);
      source.getChannelData(0)[i] = value; source.getChannelData(1)[i] = -value;
    }
    await _finalizeAudioViz('editA', source);
    await _prepareContinuousScrub();
    const preview = _videoAudioBuffers.editA, status = _videoScrubStatus.editA;
    const amplitude = hz => {
      let real = 0, imag = 0, data = preview.getChannelData(0);
      for (let i = 1000; i < data.length - 1000; i++) {
        real += data[i] * Math.cos(2 * Math.PI * hz * i / preview.sampleRate);
        imag += data[i] * Math.sin(2 * Math.PI * hz * i / preview.sampleRate);
      }
      return 2 * Math.hypot(real, imag) / (data.length - 2000);
    };
    const audible = !_playContinuousScrub(0.3); if (audible) playScrubSnippet(0.3);
    const fallback = {rate:preview.sampleRate, bytes:preview.length * preview.numberOfChannels * 4,
      limited:status.limited, streamBytes:_continuousScrubEngine.state.bytes, error:_continuousScrubEngine.state.error,
      low:amplitude(500), alias:amplitude(1000), snippet:!!_scrubSource,
      phase:Math.max(...preview.getChannelData(0).map((v,i) => Math.abs(v + preview.getChannelData(1)[i]))),
      originalRate:spectrogramData.editA.sampleRate};
    stopScrubSnippet();
    // No preview fits this deliberately tiny budget; analysis must still draw.
    const plan = _scrubPreviewPlan; _scrubPreviewPlan = () => null;
    await _finalizeAudioViz('editB', source); _populateNoVideoSlotData('editB');
    _scrubPreviewPlan = plan;
    const unavailable = {buffer:!!_videoAudioBuffers.editB, flagged:_videoScrubStatus.editB.unavailable,
      waveform:!!_audioSlotVizData.editB.waveform, duration:_audioSlotVizData.editB.duration,
      metrics:audioMetrics.editB.channels};
    clearAllMedia();
    return {fallback, unavailable, cleared:Object.keys(_videoScrubStatus).length};
  })()`));
  expect(result.fallback).toMatchObject({rate:8000, bytes:64000, limited:true, streamBytes:0, snippet:true, phase:0, originalRate:48000});
  expect(result.fallback.error).toContain('memory budget');
  expect(result.fallback.low).toBeCloseTo(0.1, 3); expect(result.fallback.alias).toBeLessThan(0.001);
  expect(result.unavailable).toEqual({buffer:false, flagged:true, waveform:true, duration:1, metrics:2});
  expect(result.cleared).toBe(0);
});

test('clearing during listening preparation skips queued work and fences old publication', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const ctx = getAudioContext(), old = ctx.createBuffer(8, 4800, 48000), newer = ctx.createBuffer(2, 2400, 48000);
    let release, entered, calls = 0;
    const started = new Promise(resolve => { entered = resolve; });
    const real = window.OfflineAudioContext;
    window.OfflineAudioContext = class extends real {
      async startRendering() { calls++; entered(); await new Promise(resolve => { release = resolve; }); return super.startRendering(); }
    };
    const pending = _finalizeAudioViz('editA', old); await started;
    const queued = _finalizeAudioViz('editB', old);
    clearAllMedia();
    const current = _finalizeAudioViz('editA', newer);
    release(); await Promise.all([pending, queued, current]);
    window.OfflineAudioContext = real;
    const state = {calls, same:_videoAudioBuffers.editA === newer,
      stale:!!_videoAudioBuffers.editB, analysisChannels:audioMetrics.editA.channels,
      statusSlots:Object.keys(_videoScrubStatus)};
    clearAllMedia(); return state;
  })()`));
  expect(result).toEqual({calls:1, same:true, stale:false, analysisChannels:2, statusSlots:['editA']});
});
