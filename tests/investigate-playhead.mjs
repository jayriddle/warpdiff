// Isolated, muted playback measurement; retains timing only, never media content.
// node tests/investigate-playhead.mjs --clip /path/to/movie.mp4 --out /tmp/playhead.json
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
if (!args.includes('--clip') || !args.includes('--out')) throw new Error('--clip and --out are required');
const clip = path.resolve(value('--clip'));
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const report = { at: new Date().toISOString(), file: path.basename(clip), browser: browser.version(), arms: [], errors: [] };
const quantile = (values, q) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
try {
  for (const count of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.goto(args.includes('--url') ? value('--url') : 'http://localhost:8080');
    report.appVersion = await page.evaluate(() => window.eval('APP_VERSION'));
    await page.locator('#multiFileInput').setInputFiles(Array(count).fill(clip));
    await page.waitForFunction(count => window.eval(`assetOrder.filter(s => mediaData[s]).length === ${count} && assetOrder.filter(s => mediaData[s]).every(s => !!_videoAudioBuffers[s])`), count, { timeout: 60000 });
    await page.evaluate(() => {
      window.pauseAllMedia();
      window.eval('if (!audioVizVisible) toggleAudioViz()');
      window.restartAllVideos();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.asset-layer video')].every(v => !v.paused && v.currentTime > 0.6));
    const samples = await page.evaluate(async () => {
      const video = document.querySelector('#layerEditA video');
      const bar = document.querySelector('.video-progress-bar');
      const cursor = document.getElementById('waveformCursor');
      const container = document.getElementById('videoProgressContainer');
      const samples = [];
      const start = performance.now();
      const span = Math.min(4000, (video.duration - video.currentTime - 0.3) * 1000);
      await new Promise(resolve => {
        const tick = now => {
          const fps = window.eval('videoFrameRates')[video.src] || 30;
          const native = video.currentTime;
          samples.push({ now, native, display: Number(container.getAttribute('aria-valuenow')),
            seeking: video.seeking, fps, scale: new DOMMatrix(getComputedStyle(bar).transform).a,
            cursor: Number(cursor.style.getPropertyValue('--cursor-pct')) });
          if (now - start >= span) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      window.pauseAllMedia();
      return samples;
    });
    const steps = samples.slice(1).map((s, i) => ({ dt: (s.now - samples[i].now) / 1000,
      display: s.display - samples[i].display, native: s.native - samples[i].native }));
    const regular = steps.filter(s => s.dt > 0.005 && s.dt < 0.05);
    const summarize = field => ({ held: regular.filter(s => s[field] < 0.001).length,
      backward: regular.filter(s => s[field] < -0.00001).length,
      speedP05: quantile(regular.map(s => s[field] / s.dt), 0.05),
      speedP50: quantile(regular.map(s => s[field] / s.dt), 0.5),
      speedP95: quantile(regular.map(s => s[field] / s.dt), 0.95) });
    report.arms.push({ count, frames: samples.length, regularFrames: regular.length,
      frameGapP95Ms: quantile(steps.map(s => s.dt * 1000), 0.95),
      display: summarize('display'), native: summarize('native'), samples });
    await context.close();
  }
} finally {
  writeFileSync(value('--out'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ ...report, arms: report.arms.map(({ samples, ...summary }) => summary) }, null, 2));
