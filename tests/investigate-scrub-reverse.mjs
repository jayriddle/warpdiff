#!/usr/bin/env node
/*
 * Why is BACKWARD scrubbing glitchy?
 *
 * Forward scrubbing decodes in the direction the decoder naturally runs. Going
 * backward, a VideoDecoder can't step back — every target that isn't already
 * cached forces reset() + a re-decode from the GOP keyframe. This measures what
 * the user actually sees during the drag (the pause-hop harness only checked
 * where a scrub LANDS, which is exact either way):
 *
 *   - per-request paint latency (request → the canvas actually changing),
 *   - cache hit rate and decoder resets per request,
 *   - painted frames per request: <1 means requests are producing no new
 *     picture (the drag looks frozen), and the canvas-hash trace shows whether
 *     the picture moves monotonically or jumps around.
 *
 * Usage: node tests/investigate-scrub-reverse.mjs <clipA> <clipB>
 * Env:   PW_HEADLESS=1, STEPS=24
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
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-scrub-reverse.mjs <a.mp4> <b.mp4>'); process.exit(1); }
const STEPS = +(process.env.STEPS || 24);
// A real mouse fires mousemove at 60–125 Hz. 50 ms (20 Hz) understates the load
// badly — it gives the decoder time to finish between requests.
const MOVE_MS = process.env.MOVE_MS === undefined ? 8 : +process.env.MOVE_MS;

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
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}`);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 60000 });
await page.waitForFunction(() => {
  const v = [...document.querySelectorAll('.asset-layer video')];
  return v.length === 2 && v.every(x => !isNaN(x.duration));
}, {}, { timeout: 30000 });

const meta = await page.evaluate(() => {
  const v = document.querySelector('.asset-layer video');
  return { res: `${v.videoWidth}×${v.videoHeight}`, dur: +v.duration.toFixed(2), grid: isGridMode };
});
console.log(`\n[setup] ${basename(fileA)} + ${basename(fileB)}  ${meta.res}  ${meta.dur}s  ` +
            `${meta.grid ? 'Grid' : 'Stack'} mode`);

// Wrap every session's request() so we can time request → paint, and count
// cache hits / resets from the session's own diagnostic surface.
const INSTRUMENT = () => {
  window.__scrub = { events: [], sessions: {} };
  const wrap = (slot, s) => {
    if (!s || s.__wrapped) return;
    s.__wrapped = true;
    window.__scrub.sessions[slot] = s;
    const origReq = s.request.bind(s);
    s.request = (t, direct) => {
      const before = s.cacheStats;
      const painted0 = s.framesPainted;
      const t0 = performance.now();
      origReq(t, direct);
      // Paint happens on the next rAF at the earliest; poll a couple of frames.
      let ticks = 0;
      const check = () => {
        const dp = s.framesPainted - painted0;
        if (dp > 0 || ++ticks > 12) {
          const after = s.cacheStats;
          window.__scrub.events.push({
            slot, t: +t.toFixed(4), direct: !!direct,
            ms: +(performance.now() - t0).toFixed(1),
            painted: dp,
            hit: after.hits > before.hits,
            cacheFrames: after.frames,
          });
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    };
  };
  // Sessions are created lazily on first drag; re-wrap on each pass.
  window.__scrubWrapAll = () => {
    for (const slot of Object.keys(_scrubVideoSessions || {})) {
      const s = _scrubVideoSessions[slot];
      if (s && s !== 'failed') wrap(slot, s);
    }
    return Object.keys(window.__scrub.sessions).length;
  };
  return window.__scrubWrapAll();
};

const bar = await page.locator('#videoProgressContainer').boundingBox();
const y = bar.y + bar.height / 2;
const X = p => bar.x + bar.width * p;

// Prime: one full drag so sessions exist and are wrapped, then instrument.
await page.mouse.move(X(0.1), y); await page.mouse.down();
await page.mouse.move(X(0.9), y); await page.waitForTimeout(600); await page.mouse.up();
await page.waitForTimeout(800);
await page.evaluate(INSTRUMENT);
const nWrapped = await page.evaluate(() => window.__scrubWrapAll());
console.log(`[setup] instrumented ${nWrapped} scrub session(s)`);

async function drag(label, fromPct, toPct, steps) {
  await page.evaluate(() => { window.__scrub.events.length = 0; });
  await page.mouse.move(X(fromPct), y);
  await page.mouse.down();
  await page.evaluate(() => window.__scrubWrapAll());
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(X(fromPct + (toPct - fromPct) * (i / steps)), y);
    if (MOVE_MS) await page.waitForTimeout(MOVE_MS);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const ev = await page.evaluate(() => window.__scrub.events.slice());
  const bySlot = {};
  for (const e of ev) (bySlot[e.slot] ||= []).push(e);
  console.log(`\n--- ${label} (${steps} moves) ---`);
  for (const [slot, es] of Object.entries(bySlot)) {
    const lat = es.map(e => e.ms).sort((a, b) => a - b);
    const p50 = lat[Math.floor(lat.length * 0.5)] || 0;
    const p95 = lat[Math.floor(lat.length * 0.95)] || 0;
    const hits = es.filter(e => e.hit).length;
    const blank = es.filter(e => e.painted === 0).length;
    // >33 ms = the picture held still for 2+ display frames: a visible hitch.
    const stalls = es.filter(e => e.ms > 33).length;
    console.log(`  ${slot.padEnd(8)} ${String(es.length).padStart(3)} req   ` +
      `p50 ${String(p50).padStart(6)}ms  p95 ${String(p95).padStart(7)}ms  max ${String(lat[lat.length - 1] || 0).padStart(7)}ms   ` +
      `cacheHit ${String(Math.round(100 * hits / (es.length || 1))).padStart(3)}%   ` +
      `stalls>33ms ${String(stalls).padStart(3)}/${es.length}   noPaint ${String(blank).padStart(3)}`);
  }
  return ev;
}

console.log('\n===== SCRUB REQUEST → PAINT LATENCY =====');
console.log('noPaint = requests that produced no new picture within ~12 frames (drag looks frozen).');
await drag('FORWARD   10% → 90%', 0.10, 0.90, STEPS);
await drag('BACKWARD  90% → 10%', 0.90, 0.10, STEPS);
await drag('FORWARD   20% → 60%  (short)', 0.20, 0.60, STEPS);
await drag('BACKWARD  60% → 20%  (short)', 0.60, 0.20, STEPS);

// GOP structure — the thing that governs reverse cost.
const gop = await page.evaluate(async () => {
  const md = mediaData[assetOrder.find(s => mediaData[s] && mediaData[s].type === 'video')];
  const buf = new Uint8Array(await (await fetch(md.src)).arrayBuffer());
  const info = _demuxMP4Video(buf);
  if (!info) return null;
  const keys = info.samples.map((s, i) => [i, s.key]).filter(([, k]) => k).map(([i]) => i);
  const gaps = keys.slice(1).map((k, i) => k - keys[i]);
  return { total: info.samples.length, keyframes: keys.length,
           maxGop: gaps.length ? Math.max(...gaps) : info.samples.length,
           avgGop: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : info.samples.length };
});
if (gop) {
  console.log(`\n===== SOURCE GOP =====`);
  console.log(`  ${gop.total} frames, ${gop.keyframes} keyframes, avg GOP ${gop.avgGop}, max GOP ${gop.maxGop}`);
  const cacheInfo = await page.evaluate(() => {
    const s = Object.values(window.__scrub.sessions)[0];
    return s ? s.cacheStats : null;
  });
  if (cacheInfo) {
    console.log(`  cache holds ${cacheInfo.frames} frames (${(cacheInfo.bytes / 1048576).toFixed(1)} MB)`);
    console.log(`  → a backward step outside the cached window re-decodes up to ${gop.maxGop} frames.`);
  }
}

await browser.close();
server.close();
