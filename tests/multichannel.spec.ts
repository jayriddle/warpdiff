import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('multichannel listening output', () => {
  test('normal playback keeps native channel mixing until decoded channels are known', async ({ page }) => {
    await page.goto('/');
    // Hold publication of a real decode, without extending decodeAudioData's
    // promise past the application's fallback timeout or intercepting native APIs.
    await page.evaluate(() => (window as any).eval(`(() => {
      const finalize = _finalizeAudioViz;
      _finalizeAudioViz = (...args) => {
        window.__releaseChannelDecode = () => {
          _finalizeAudioViz = finalize;
          finalize(...args);
        };
      };
    })()`));
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
    await page.waitForFunction(() => (window as any).__releaseChannelDecode && document.querySelector('video')?.readyState);
    const pending = await page.evaluate(() => (window as any).eval(`({
      routes:_nativeAudioRoutes.size, decoded:!!_videoAudioBuffers.editA,
      ready:getLayer('editA').querySelector('video').readyState
    })`));
    expect(pending.ready).toBeGreaterThan(0);
    expect(pending.decoded).toBe(false);
    expect(pending.routes).toBe(0);
    await page.evaluate(() => (window as any).__releaseChannelDecode());
    await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
    expect(await page.evaluate(() => (window as any).eval('_nativeAudioRoutes.size'))).toBe(1);
  });

  test('scrubbing preserves 7.1 center and surrounds without changing source channels', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => (window as any).eval(`(async () => {
      const savedContext = getAudioContext;
      const slot = 'editA';
      currentAudioSource = slot; isMuted = false; audioMuteStates[slot] = false;
      _audioTimelineStarts[slot] = 0.166;
      const rms = samples => Math.sqrt(samples.reduce((s, v) => s + v*v, 0) / samples.length);
      const renders = [];
      try {
        for (const channels of [1, 2, 6, 8]) {
          for (let channel = 0; channel < channels; channel++) {
            const ctx = new OfflineAudioContext(2, 12000, 48000);
            const buffer = ctx.createBuffer(channels, 12000, 48000);
            buffer.getChannelData(channel).fill(0.1);
            getAudioContext = () => ctx;
            _videoAudioBuffers[slot] = buffer;
            _scrubSource = null; _scrubGain = null; _scrubSourceBuffer = null;
            playScrubSnippet(0.216);
            const source = _scrubSource;
            const out = await ctx.startRendering();
            renders.push({ channels, channel, output:[rms(out.getChannelData(0)), rms(out.getChannelData(1))],
              sourceUnchanged:source.buffer === buffer && buffer.numberOfChannels === channels && buffer.getChannelData(channel)[100] > 0.099 });
          }
        }
        // The leading edit remains silence, and anti-phase stereo remains audible.
        const ctx = new OfflineAudioContext(2, 12000, 48000);
        const buffer = ctx.createBuffer(2, 12000, 48000);
        buffer.getChannelData(0).fill(0.1); buffer.getChannelData(1).fill(-0.1);
        getAudioContext = () => ctx; _videoAudioBuffers[slot] = buffer;
        _scrubSource = null; _scrubGain = null; _scrubSourceBuffer = null;
        playScrubSnippet(0.1);
        const silentBeforeStart = !_scrubSource;
        playScrubSnippet(0.216);
        const out = await ctx.startRendering();
        const left = out.getChannelData(0), right = out.getChannelData(1);
        return { renders, silentBeforeStart, stereoRms:[rms(left),rms(right)], stereoSumPeak:Math.max(...left.map((v,i)=>Math.abs(v+right[i]))) };
      } finally { getAudioContext = savedContext; }
    })()`));
    const channel = (count: number, index: number) => result.renders.find((r: any) => r.channels === count && r.channel === index).output;
    const reference = channel(2, 0)[0];
    expect(reference).toBeGreaterThan(0.01); // Positive control: real scrub sound was rendered.
    expect(channel(1, 0)).toEqual([reference, reference]);
    expect(channel(2, 0)[1]).toBe(0);
    expect(channel(2, 1)).toEqual([0, reference]);
    for (const count of [6, 8]) {
      expect(channel(count, 2)[0] / reference).toBeCloseTo(Math.SQRT1_2, 5);
      expect(channel(count, 2)[1] / reference).toBeCloseTo(Math.SQRT1_2, 5);
      expect(channel(count, 3)).toEqual([0, 0]); // LFE is excluded from the monitoring mix.
    }
    for (const index of [4, 6]) {
      expect(channel(8, index)[0] / reference).toBeCloseTo(Math.SQRT1_2 * 0.5, 5);
      expect(channel(8, index)[1]).toBe(0);
    }
    for (const index of [5, 7]) {
      expect(channel(8, index)[1] / reference).toBeCloseTo(Math.SQRT1_2 * 0.5, 5);
      expect(channel(8, index)[0]).toBe(0);
    }
    expect(result.renders.every((r: any) => r.sourceUnchanged)).toBe(true);
    expect(result.silentBeforeStart).toBe(true);
    expect(result.stereoRms[0]).toBeGreaterThan(0.01);
    expect(result.stereoRms[1]).toBeGreaterThan(0.01);
    expect(result.stereoSumPeak).toBe(0);
  });

  test('7.1 FLAC dialogue survives normal playback, mute, and decoded replacement', async ({ page }) => {
    await page.goto('/');
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
    await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'), null, { timeout: 30000 });
    const source = await page.evaluate(() => (window as any).eval(`(() => {
      const video = getLayer('editA').querySelector('video');
      const route = _nativeAudioRoutes.get(video);
      if (!route) throw new Error('Decoded media has no output route');
      const analyser = route.ctx.createAnalyser(); analyser.fftSize = 2048;
      route.gain.connect(analyser);
      window.__channelAnalyser = analyser;
      const buffer = _videoAudioBuffers.editA;
      const center = buffer.getChannelData(2);
      return { channels:buffer.numberOfChannels, centerPeak:Math.max(...center.subarray(4800,9600)),
        start:_audioTimelineStarts.editA, metrics:JSON.stringify(audioMetrics.editA) };
    })()`));
    expect(source.channels).toBe(8);
    expect(source.centerPeak).toBeGreaterThan(0.1);
    expect(source.start).toBeCloseTo(0.166, 3);
    const outputRms = () => page.evaluate(() => {
      const a = (window as any).__channelAnalyser;
      const samples = new Float32Array(a.fftSize); a.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0) / samples.length);
    });
    await page.evaluate(() => (window as any).eval("selectAudioSource('editA'); playAllMedia()"));
    await expect.poll(outputRms).toBeGreaterThan(0.04);
    await page.evaluate(() => (window as any).eval("_setNativeAudioMuted(getLayer('editA').querySelector('video'), true, true)"));
    await expect.poll(outputRms).toBeLessThan(0.00001);
    await page.evaluate(() => (window as any).eval("_setNativeAudioMuted(getLayer('editA').querySelector('video'), false, true)"));
    await expect.poll(outputRms).toBeGreaterThan(0.04);

    // Drain the real pause event before substituting an offline context. A late
    // native pause must not stop the synthetic replacement being measured.
    await page.evaluate(() => (window as any).eval(`(async () => {
      const video = getLayer('editA').querySelector('video');
      const paused = video.paused ? Promise.resolve() : new Promise(resolve => video.addEventListener('pause', resolve, {once:true}));
      pauseAllMedia();
      await paused;
    })()`));
    const replacement = await page.evaluate(() => (window as any).eval(`(async () => {
      const savedContext = getAudioContext;
      const context = new OfflineAudioContext(2, 12000, 48000);
      const originalBuffer = _videoAudioBuffers.editA;
      const buffer = context.createBuffer(8, 24000, 48000);
      buffer.getChannelData(2).fill(0.1);
      getAudioContext = () => context; _videoAudioBuffers.editA = buffer;
      try {
        _startOpusSyncAudio('editA', 0.216);
        const out = await context.startRendering();
        return { peak:Math.max(...out.getChannelData(0)), rightPeak:Math.max(...out.getChannelData(1)),
          originalChannels:originalBuffer.numberOfChannels, metrics:JSON.stringify(audioMetrics.editA) };
      } finally { getAudioContext = savedContext; _videoAudioBuffers.editA = originalBuffer; }
    })()`));
    expect(replacement.peak).toBeCloseTo(0.1 * Math.SQRT1_2, 5);
    expect(replacement.rightPeak).toBeCloseTo(replacement.peak, 6);
    expect(replacement.originalChannels).toBe(8);
    expect(replacement.metrics).toBe(source.metrics);
    await page.evaluate(() => (window as any).clearAllMedia());
    expect(await page.evaluate(() => (window as any).eval('_nativeAudioRoutes.size'))).toBe(0);
  });

  test('audio-only 7.1 keeps center output and original analysis channels', async ({ page }) => {
    await page.goto('/');
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.wav'));
    await page.waitForFunction(() => (window as any).eval('Object.values(_audioSlotVizData).some(v => v.audioBuffer.numberOfChannels === 8)'));
    const channels = await page.evaluate(() => (window as any).eval(`(() => {
      const slot = assetOrder.find(s => _audioSlotVizData[s]), media = getLayer(slot).querySelector('audio');
      const route = _nativeAudioRoutes.get(media);
      const analyser = route.ctx.createAnalyser(); analyser.fftSize = 2048;
      route.gain.connect(analyser); window.__channelAnalyser = analyser;
      selectAudioSource(slot); playAllMedia();
      return _audioSlotVizData[slot].audioBuffer.numberOfChannels;
    })()`));
    expect(channels).toBe(8);
    await expect.poll(() => page.evaluate(() => {
      const a = (window as any).__channelAnalyser;
      const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, v) => sum + v*v, 0) / data.length);
    })).toBeGreaterThan(0.04);
  });
});
