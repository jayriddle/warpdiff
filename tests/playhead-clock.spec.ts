import { test, expect } from '@playwright/test';
import path from 'node:path';

// Replay a steady media timeline with audio-clock sampling jitter and a slower
// video-frame cadence. Drive the real progress loop and inspect its rendered UI.
// This makes uneven motion reproducible without depending on decoder scheduling.
for (const scenario of [
  { mode: 'single', count: 1, fps: 24, hz: 60, rate: 1 },
  { mode: 'Stack', count: 2, fps: 24, hz: 60, rate: 1 },
  { mode: 'Grid', count: 2, fps: 30, hz: 120, rate: 0.5 },
  { mode: 'single fast', count: 1, fps: 60, hz: 120, rate: 2 },
]) {
  test(`${scenario.mode} playheads advance evenly and stop when the media clock stops`, async ({ page }) => {
    await page.goto('/');
    const clip = path.join(__dirname, 'fixtures', 'landscape_a.mp4');
    await page.locator('#multiFileInput').setInputFiles(Array(scenario.count).fill(clip));
    await page.locator('#comparisonView.active').waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('.asset-layer video')].every(v => !(v as HTMLVideoElement).seeking));
    const result = await page.evaluate(async scenario => {
      const app = window as any;
      app.pauseAllMedia();
      app.setViewMode(scenario.mode === 'Grid' ? 'horizontal' : 'overlay');
      if (!app.eval('audioVizVisible')) app.toggleAudioViz();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      app.stopProgressUpdateLoop();
      const videos = [...document.querySelectorAll('.asset-layer video')] as HTMLVideoElement[];
      const originalRaf = window.requestAnimationFrame;
      const originalNow = performance.now;
      let callback: FrameRequestCallback = () => {};
      let now = 1000, mediaTime = 0.4, paused = false;
      const samples: { time: number; scale: number; cursor: number }[] = [];
      const bar = document.querySelector('.video-progress-bar') as HTMLElement;
      const cursor = document.getElementById('waveformCursor')!;
      const timeline = document.getElementById('videoProgressContainer')!;
      const duration = videos[0].duration;
      try {
        performance.now = () => now;
        window.requestAnimationFrame = fn => { callback = fn; return -1; };
        app.eval(`playbackRateIndex = PLAYBACK_RATES.indexOf(${scenario.rate})`);
        for (const video of videos) {
          Object.defineProperty(video, 'currentTime', { configurable: true, get: () => mediaTime });
          Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
          Object.defineProperty(video, 'seeking', { configurable: true, get: () => false });
          Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
          video.playbackRate = scenario.rate;
          app.eval('videoFrameRates')[video.src] = scenario.fps;
        }
        app._resolveVideoProgressTime(null);
        app.startProgressUpdateLoop();
        let lastFrame = -1;
        for (let i = 1; i <= 48; i++) {
          now = 1000 + i * 1000 / scenario.hz;
          // Alternating clock samples model sub-frame native audio-clock noise.
          const jitter = [0, 0.24, 0, -0.24][i % 4] * scenario.rate / scenario.hz;
          mediaTime = 0.4 + i * scenario.rate / scenario.hz + jitter;
          const frame = Math.floor((mediaTime - 0.4) * scenario.fps);
          if (frame !== lastFrame) {
            videos.forEach(video => Object.assign(video, {
              _visualPresentedTime: 0.4 + frame / scenario.fps, _visualPresentedAt: now,
            }));
            lastFrame = frame;
          }
          callback(now);
          samples.push({ time: Number(timeline.getAttribute('aria-valuenow')),
            scale: new DOMMatrix(getComputedStyle(bar).transform).a,
            cursor: Number(cursor.style.getPropertyValue('--cursor-pct')) });
        }
        const stoppedAt = mediaTime;
        const stalled: number[] = [];
        for (let i = 0; i < 24; i++) {
          now += 1000 / scenario.hz;
          callback(now);
          stalled.push(Number(timeline.getAttribute('aria-valuenow')));
        }
        // A delayed refresh must not reverse a cursor that was held for a stall.
        now += 500;
        callback(now);
        stalled.push(Number(timeline.getAttribute('aria-valuenow')));
        // A seek may finish entirely between refreshes, including a tiny move.
        mediaTime += 0.01;
        videos.forEach(video => video.dispatchEvent(new Event('seeking')));
        now += 1000 / scenario.hz;
        callback(now);
        const seekTime = Number(timeline.getAttribute('aria-valuenow'));
        // A paused inspection position is exact, including backward motion.
        paused = true;
        mediaTime = 0.2;
        callback(now + 1000 / scenario.hz);
        return { samples, stalled, stoppedAt, duration, seekTime,
          pausedTime: Number(timeline.getAttribute('aria-valuenow')),
          animations: bar.getAnimations().length + cursor.getAnimations().length };
      } finally {
        window.requestAnimationFrame = originalRaf;
        performance.now = originalNow;
        videos.forEach(video => {
          delete (video as any).currentTime;
          delete (video as any).paused;
          delete (video as any).seeking;
          delete (video as any).readyState;
        });
        app.stopProgressUpdateLoop();
      }
    }, scenario);
    const step = scenario.rate / scenario.hz;
    for (let i = 1; i < result.samples.length; i++) {
      const current = result.samples[i];
      const advance = current.time - result.samples[i - 1].time;
      expect(advance).toBeGreaterThan(step * 0.89);
      expect(advance).toBeLessThan(step * 1.11);
      expect(Math.abs(current.time - (0.4 + (i + 1) * step))).toBeLessThan(0.025 * scenario.rate);
      expect(current.scale).toBeCloseTo(current.time / result.duration, 5);
      expect(current.cursor).toBeCloseTo(current.time / result.duration * 100, 5);
    }
    expect(Math.max(...result.stalled) - result.stoppedAt).toBeLessThanOrEqual(0.025 * scenario.rate + 1e-6);
    expect(result.stalled.at(-1)).toBeCloseTo(result.stalled.at(-5)!, 8);
    expect(result.seekTime).toBeCloseTo(result.stoppedAt + 0.01, 8);
    expect(result.pausedTime).toBe(0.2);
    expect(result.animations).toBe(0);
  });
}
