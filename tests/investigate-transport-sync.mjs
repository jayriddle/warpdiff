#!/usr/bin/env node
/*
 * Sync under the TRANSPORT controls, at review-grade resolutions.
 *
 * Covers the paths the play/pause and frame-step harnesses don't:
 *   1. Playback RATE (J/K, 0.25×–2×). The drift-lock trim is a fraction of the
 *      base rate, so its convergence time works out to TAU/base — 0.4 s at 1×
 *      but 1.6 s at 0.25×. Whether that matters depends on whether the startup
 *      offset scales down with rate too, which is what this measures.
 *   2. SCRUBBING forward and backward. During a drag the drift lock stands down
 *      (isDragging) and the pause snap is skipped, and the overlay path doesn't
 *      seek the hidden <video>s at all — so alignment afterwards rests entirely
 *      on where the final seeks land.
 *   3. Mid-playback ASSET SWITCHING, which historically promoted a laggard
 *      follower to clock master and dragged the cluster backward.
 *
 * Run it at 1080p and again at 3840×2160 — up-res review work compares at those
 * sizes, and decode cost is what drives the start race in the first place.
 *
 * Usage:
 *   node tests/investigate-transport-sync.mjs <clipA> <clipB>
 * Env: PW_HEADLESS=1
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-transport-sync.mjs <a.mp4> <b.mp4>'); process.exit(1); }

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(ROOT, p);
    if (!fp.startsWith(ROOT) || !(await stat(fp)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch { res.writeHead(404).end(); }
});
const port = await new Promise(r => server.listen(0, () => r(server.address().port)));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome',
  headless: process.env.PW_HEADLESS === '1', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
let fpsResolved = 0;
page.on('console', m => { if (m.text().startsWith('[fps]')) fpsResolved++; });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}`);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 60000 });
await page.waitForFunction(() => {
  const v = [...document.querySelectorAll('.asset-layer video')];
  return v.length === 2 && v.every(x => !isNaN(x.duration));
}, {}, { timeout: 30000 });

// Resolve fps before measuring: anything fps-derived (half-frame bands, the
// snap's grid) is wrong while the clips sit on the 30 default.
await page.evaluate(() => window.playAllMedia());
for (let i = 0; i < 80 && fpsResolved < 2; i++) {
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const v = [...document.querySelectorAll('.asset-layer video')];
    if (v.some(x => x.currentTime > x.duration - 0.5)) v.forEach(x => { x.currentTime = 0; });
  });
}
await page.evaluate(() => window.pauseAllMedia());
await page.waitForTimeout(300);
const fps = await page.evaluate(() => window.__testAPI._videoFps);
const halfFrameMs = 1000 * 0.5 / Math.min(...fps);
console.log(`\n[setup] ${basename(fileA)} + ${basename(fileB)}  fps=[${fps.join(', ')}]  ` +
            `½ frame = ${halfFrameMs.toFixed(1)}ms  (fps resolved: ${fpsResolved}/2)`);
const res = await page.evaluate(() => {
  const v = document.querySelector('.asset-layer video');
  return `${v.videoWidth}×${v.videoHeight}`;
});
console.log(`[setup] resolution ${res}`);

// ── 1. playback rate ─────────────────────────────────────────────────────────
console.log('\n===== 1. PLAYBACK RATE (drift during playback, and at pause) =====');
const RATES = [0.25, 0.5, 1, 1.5, 2];
const rateRows = [];
for (const rate of RATES) {
  const r = await page.evaluate(async (rate) => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    // Drive the rate the way J/K does, so PLAYBACK_RATES/playbackRateIndex (the
    // drift lock's notion of "base") agrees with the elements.
    const idx = PLAYBACK_RATES.indexOf(rate);
    playbackRateIndex = idx;
    vids.forEach(v => { v.currentTime = 0; v.playbackRate = rate; });
    await new Promise(r => setTimeout(r, 300));
    window.playAllMedia();
    const t0 = performance.now();
    const samples = [];
    while (performance.now() - t0 < 3000) {
      await new Promise(r => requestAnimationFrame(r));
      if (vids.some(v => v.paused)) break;
      samples.push({ ms: Math.round(performance.now() - t0),
                     d: (vids[1].currentTime - vids[0].currentTime) * 1000 });
    }
    window.pauseAllMedia();
    await new Promise(r => setTimeout(r, 250));
    return { rate, samples,
             atPause: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2),
             effRates: vids.map(v => v.playbackRate) };
  }, rate);
  // Convergence: first moment |drift| goes under half a frame and stays there.
  let conv = null;
  for (let i = 0; i < r.samples.length; i++) {
    if (r.samples.slice(i).every(s => Math.abs(s.d) < halfFrameMs)) { conv = r.samples[i].ms; break; }
  }
  const peak = r.samples.length ? Math.max(...r.samples.map(s => Math.abs(s.d))) : 0;
  rateRows.push({ rate, peak, conv, atPause: r.atPause });
  const ok = Math.abs(r.atPause) <= halfFrameMs;
  console.log(`${ok ? '  ok ' : 'WARN '}${(String(rate) + '×').padEnd(6)}` +
    `peak |drift| ${peak.toFixed(1).padStart(5)}ms   converged ${(conv === null ? 'NEVER(<3s)' : conv + 'ms').padStart(10)}` +
    `   at pause ${String(r.atPause).padStart(7)}ms   elementRates [${r.effRates.join(', ')}]`);
}

// ── 2. scrubbing ─────────────────────────────────────────────────────────────
console.log('\n===== 2. SCRUB (drag forward, then backward) =====');
const bar = await page.locator('#videoProgressContainer').boundingBox();
async function dragScrub(fromPct, toPct, steps) {
  const y = bar.y + bar.height / 2;
  const x = p => bar.x + bar.width * p;
  await page.mouse.move(x(fromPct), y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x(fromPct + (toPct - fromPct) * (i / steps)), y);
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    const fr = window.__testAPI._videoFps;
    return {
      drift: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2),
      frames: vids.map((v, i) => Math.floor(v.currentTime * fr[i] + 0.01)),
      dragging: window.__testAPI.isDragging,
    };
  });
}
const scrubs = [
  ['forward  20%→75%', await dragScrub(0.20, 0.75, 10)],
  ['backward 75%→15%', await dragScrub(0.75, 0.15, 10)],
  ['forward  15%→90%', await dragScrub(0.15, 0.90, 14)],
  ['backward 90%→05%', await dragScrub(0.90, 0.05, 14)],
];
for (const [label, s] of scrubs) {
  const ok = Math.abs(s.drift) <= halfFrameMs && !s.dragging;
  console.log(`${ok ? '  ok ' : 'WARN '}${label.padEnd(20)} drift ${String(s.drift).padStart(8)}ms   ` +
              `frames [${s.frames.join(', ')}]${s.dragging ? '   isDragging STUCK' : ''}`);
}

// Scrub while playing: mousedown pauses, mouseup resumes.
const playScrub = await (async () => {
  await page.evaluate(() => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    vids.forEach(v => { v.currentTime = 0; });
    playbackRateIndex = PLAYBACK_RATES.indexOf(1);
    vids.forEach(v => { v.playbackRate = 1; });
    window.playAllMedia();
  });
  await page.waitForTimeout(700);
  const s = await dragScrub(0.30, 0.65, 8);
  await page.waitForTimeout(1200);   // let the drift lock settle after resume
  const after = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    const d = +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2);
    const playing = vids.every(v => !v.paused);   // read BEFORE pausing
    window.pauseAllMedia();
    return { d, playing };
  });
  return { s, after };
})();
console.log(`${Math.abs(playScrub.after.d) <= halfFrameMs ? '  ok ' : 'WARN '}` +
  `while playing       drift ${String(playScrub.after.d).padStart(8)}ms after resume+settle ` +
  `(resumed playing: ${playScrub.after.playing})`);

// ── 3. asset switching mid-playback ──────────────────────────────────────────
console.log('\n===== 3. ASSET SWITCH mid-playback (Stack, the seamless-switch path) =====');
const sw = await page.evaluate(async () => {
  const vids = [...document.querySelectorAll('.asset-layer video')];
  vids.forEach(v => { v.currentTime = 0; });
  if (isGridMode) setViewMode('overlay');           // Stack
  await new Promise(r => setTimeout(r, 400));
  window.playAllMedia();
  await new Promise(r => setTimeout(r, 900));
  const out = [];
  for (let i = 0; i < 6; i++) {
    switchToAsset(i % 2);
    await new Promise(r => setTimeout(r, 500));
    out.push({ d: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2),
               t: +vids[0].currentTime.toFixed(3) });
  }
  window.pauseAllMedia();
  await new Promise(r => setTimeout(r, 250));
  return { out, final: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2) };
});
const backward = sw.out.some((x, i) => i > 0 && x.t < sw.out[i - 1].t - 0.05);
sw.out.forEach((x, i) => console.log(`   switch #${i + 1}: drift ${String(x.d).padStart(8)}ms   clock ${x.t}s`));
console.log(`${Math.abs(sw.final) <= halfFrameMs && !backward ? '  ok ' : 'WARN '}` +
  `after 6 switches: drift ${sw.final}ms${backward ? '   CLOCK WENT BACKWARD' : ''}`);

// ── 4. zoomed switching ──────────────────────────────────────────────────────
// The actual up-res review workflow: zoom into a detail, then A/B back and
// forth. Heaviest compositor case — a zoomed 4K layer per slot, with the
// seamless switch briefly compositing two of them.
console.log('\n===== 4. ZOOMED switching (zoom in, then A/B while playing) =====');
const zoomed = await page.evaluate(async () => {
  const vids = [...document.querySelectorAll('.asset-layer video')];
  vids.forEach(v => { v.currentTime = 0; });
  if (isGridMode) setViewMode('overlay');
  await new Promise(r => setTimeout(r, 400));
  zoomLevel = Math.min(fitZoom * 6, 12);        // deep zoom into detail
  applyZoom();
  await new Promise(r => setTimeout(r, 400));
  window.playAllMedia();
  await new Promise(r => setTimeout(r, 900));
  const out = [];
  for (let i = 0; i < 6; i++) {
    switchToAsset(i % 2);
    await new Promise(r => setTimeout(r, 500));
    out.push({ d: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2),
               t: +vids[0].currentTime.toFixed(3) });
  }
  const playing = vids.every(v => !v.paused);
  window.pauseAllMedia();
  await new Promise(r => setTimeout(r, 250));
  return { out, zoom: +zoomLevel.toFixed(2), playing,
           final: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2) };
});
const zBackward = zoomed.out.some((x, i) => i > 0 && x.t < zoomed.out[i - 1].t - 0.05);
console.log(`   zoom ${zoomed.zoom}× — still playing through all switches: ${zoomed.playing}`);
zoomed.out.forEach((x, i) => console.log(`   switch #${i + 1}: drift ${String(x.d).padStart(8)}ms   clock ${x.t}s`));
console.log(`${Math.abs(zoomed.final) <= halfFrameMs && !zBackward ? '  ok ' : 'WARN '}` +
  `after 6 zoomed switches: drift ${zoomed.final}ms${zBackward ? '   CLOCK WENT BACKWARD' : ''}`);

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('\n===== SUMMARY =====');
const rateBad = rateRows.filter(r => Math.abs(r.atPause) > halfFrameMs);
const scrubBad = scrubs.filter(([, s]) => Math.abs(s.drift) > halfFrameMs || s.dragging);
console.log(`rate:   ${rateBad.length ? `${rateBad.length}/${RATES.length} rates end a pause >½ frame apart (${rateBad.map(r => r.rate + '×').join(', ')})` : `all ${RATES.length} rates pause within ½ frame`}`);
console.log(`scrub:  ${scrubBad.length ? `${scrubBad.length}/${scrubs.length} drags end >½ frame apart` : `all ${scrubs.length} drags end within ½ frame`}`);
console.log(`switch: ${Math.abs(sw.final) <= halfFrameMs && !backward ? 'holds sync across 6 mid-playback switches' : 'PROBLEM — see above'}`);
console.log(`zoom:   ${Math.abs(zoomed.final) <= halfFrameMs && !zBackward ? `holds sync across 6 switches at ${zoomed.zoom}× zoom` : 'PROBLEM — see above'}`);

await browser.close();
server.close();
