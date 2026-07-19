#!/usr/bin/env node
/*
 * Safari/WebKit: forward playback losing sync + dropping frames on the
 * unselected clip, and click-to-select hitting the wrong area.
 *
 * NOTE: this drives Playwright's WebKit build, which is the same engine family
 * as Safari but NOT the shipping browser (different version, different media
 * stack). Treat it as a strong signal, not proof — confirm anything actionable
 * in real Safari.
 *
 * Reports:
 *   1. SYNC — drift between the clips through a play, each element's
 *      playbackRate (the drift lock trims the FOLLOWER, and WebKit may handle a
 *      non-1.0 rate very differently from Chrome), and dropped-frame counts per
 *      slot from getVideoPlaybackQuality(). The v3.12.5 Grid trim is
 *      proportional up to ±12%, well beyond the old flat ±2% — if WebKit drops
 *      frames when asked to play off-rate, that trim is the suspect.
 *   2. HIT AREA — the click-to-select listener is bound to .asset-layer, so its
 *      hit box is the layer's LAYOUT box, while applyZoom() transforms the inner
 *      .video-wrapper. Compares the two rects per slot; a horizontal offset is
 *      exactly the "have to click left of the video" symptom.
 *
 * Usage: node tests/investigate-webkit-sync.mjs <clipA> <clipB>
 * Env:   PW_BROWSER=webkit|chromium (default webkit)
 *
 * To A/B the drift-lock trim strength, edit _DRIFT_NUDGE_MAX in js/transport.js
 * and re-run — the _DRIFT_* values are module-scope consts in a classic script,
 * so there is no runtime override to inject.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { webkit, chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-webkit-sync.mjs <a.mp4> <b.mp4>'); process.exit(1); }

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

const engine = process.env.PW_BROWSER === 'chromium' ? chromium : webkit;
const browser = await engine.launch({ headless: process.env.PW_HEADLESS === '1' });
// Viewport drives pickBestGridLayout's horizontal-vs-vertical choice, which is
// exactly what changes between a wide window (bands) and a tall one (columns).
const [vw, vh] = (process.env.VIEWPORT || '1600x1000').split('x').map(Number);
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}`);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 60000 });
const ok = await page.waitForFunction(() => {
  const v = [...document.querySelectorAll('.asset-layer video')];
  return v.length === 2 && v.every(x => !isNaN(x.duration) && x.videoWidth > 0);
}, {}, { timeout: 30000 }).then(() => true).catch(() => false);
if (!ok) {
  const diag = await page.evaluate(() => [...document.querySelectorAll('.asset-layer video')]
    .map(v => ({ dur: v.duration, w: v.videoWidth, err: v.error && v.error.code, rs: v.readyState })));
  console.log('[fail] clips did not decode in this engine:', JSON.stringify(diag));
  console.log('       (WebKit builds vary in MP4/H.264 support — try the webm fixtures.)');
  await browser.close(); server.close(); process.exit(1);
}
console.log(`\n[setup] engine=${process.env.PW_BROWSER || 'webkit'}  ${basename(fileA)} + ${basename(fileB)}`);
console.log(`[setup] UA: ${(await page.evaluate(() => navigator.userAgent)).slice(0, 110)}`);

// ── 1. sync + dropped frames ────────────────────────────────────────────────
const quality = () => page.evaluate(() => [...document.querySelectorAll('.asset-layer video')].map(v => {
  const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
  return q ? { dropped: q.droppedVideoFrames, total: q.totalVideoFrames }
           : { dropped: v.webkitDroppedFrameCount ?? -1, total: v.webkitDecodedFrameCount ?? -1 };
}));

const before = await quality();
const run = await page.evaluate(async () => {
  const vids = [...document.querySelectorAll('.asset-layer video')];
  vids.forEach(v => { v.currentTime = 0; });
  await new Promise(r => setTimeout(r, 400));
  window.playAllMedia();
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 6000) {
    await new Promise(r => requestAnimationFrame(r));
    if (vids.some(v => v.paused)) break;
    samples.push({
      ms: Math.round(performance.now() - t0),
      d: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(1),
      r0: +vids[0].playbackRate.toFixed(3),
      r1: +vids[1].playbackRate.toFixed(3),
    });
  }
  window.pauseAllMedia();
  await new Promise(r => setTimeout(r, 300));
  return { samples, selected: (typeof currentAudioSource !== 'undefined' && currentAudioSource) || '?',
           fps: window.__testAPI._videoFps };
});
const after = await quality();

const marks = [200, 500, 1000, 2000, 3000, 4000, 5000, 6000];
const at = (s, ms) => { if (!s.length || ms > s[s.length - 1].ms) return null;
  let r = null; for (const x of s) { if (x.ms <= ms) r = x; else break; } return r; };
console.log(`\n===== 1. FORWARD PLAYBACK SYNC (selected=${run.selected}, fps=[${run.fps.join(', ')}]) =====`);
console.log('  drift(ms):  ' + marks.map(m => { const s = at(run.samples, m); return s ? `@${m}=${s.d}` : null; }).filter(Boolean).join('  '));
console.log('  rate A/B:   ' + marks.map(m => { const s = at(run.samples, m); return s ? `@${m}=${s.r0}/${s.r1}` : null; }).filter(Boolean).join('  '));
const peak = run.samples.length ? Math.max(...run.samples.map(s => Math.abs(s.d))) : 0;
const halfFrame = 1000 * 0.5 / Math.min(...run.fps);
const offRate = run.samples.filter(s => Math.abs(s.r0 - 1) > 1e-3 || Math.abs(s.r1 - 1) > 1e-3).length;
console.log(`  peak |drift| ${peak.toFixed(1)}ms (½ frame = ${halfFrame.toFixed(1)}ms)` +
            `   ticks with a trim applied: ${offRate}/${run.samples.length}`);
console.log('  dropped frames (during this run):');
after.forEach((q, i) => {
  const dd = q.dropped - before[i].dropped, dt = q.total - before[i].total;
  console.log(`    ${'AB'[i]}: +${dd} dropped / +${dt} decoded` +
              `${dt > 0 ? `  (${(100 * dd / dt).toFixed(1)}%)` : ''}`);
});

// ── 2. click hit area vs painted video ──────────────────────────────────────
console.log('\n===== 2. CLICK-TO-SELECT HIT AREA =====');
console.log('The click listener is on .asset-layer, so its hit box is the layer rect.');
console.log('If the painted <video> sits elsewhere, you must click the LAYER, not the picture.\n');
const rects = await page.evaluate(() => {
  const out = [];
  for (const slot of assetOrder) {
    const layer = getLayer(slot);
    if (!layer) continue;
    const v = layer.querySelector('video');
    if (!v) continue;
    const wrap = layer.querySelector('.video-wrapper');
    const r = e => { const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    out.push({ slot, layer: r(layer), wrapper: wrap ? r(wrap) : null, video: r(v),
               layerCss: getComputedStyle(layer).transform,
               wrapCss: wrap ? getComputedStyle(wrap).transform : null,
               pointer: getComputedStyle(layer).pointerEvents });
  }
  return out;
});
for (const q of rects) {
  console.log(`  ${q.slot}`);
  console.log(`    layer   ${JSON.stringify(q.layer)}   pointer-events:${q.pointer}`);
  console.log(`    wrapper ${JSON.stringify(q.wrapper)}`);
  console.log(`    video   ${JSON.stringify(q.video)}`);
  const dx = q.video.x - q.layer.x, dy = q.video.y - q.layer.y;
  const covers = q.video.x >= q.layer.x && q.video.y >= q.layer.y &&
                 q.video.x + q.video.w <= q.layer.x + q.layer.w &&
                 q.video.y + q.video.h <= q.layer.y + q.layer.h;
  console.log(`    video offset from layer: dx=${dx} dy=${dy}` +
              `   ${covers ? 'video is INSIDE the layer box (clicking the picture hits it)'
                           : 'video EXTENDS OUTSIDE the layer box — clicking the picture can MISS'}`);
}

// Does a click at the centre of each painted video actually select that slot?
console.log('\n  click test (centre of each painted video):');
for (let i = 0; i < rects.length; i++) {
  const q = rects[i];
  await page.mouse.click(q.video.x + q.video.w / 2, q.video.y + q.video.h / 2);
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => assetOrder[currentAssetIndex]);
  console.log(`    clicked centre of ${q.slot} → selected ${sel}  ${sel === q.slot ? 'ok' : 'MISS'}`);
}

await browser.close();
server.close();
