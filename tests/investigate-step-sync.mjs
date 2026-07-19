#!/usr/bin/env node
/*
 * Frame-step (, and .) + long-run sync across mixed frame rates and durations.
 *
 * The pause-time drift lock only runs while PLAYING, so once you stop and start
 * stepping, alignment depends entirely on stepFrame(). This harness checks that
 * stepping keeps clips on the same instant when they have DIFFERENT frame rates
 * (24 / 25 / 29.97 / 30 all mix in practice) and different durations, and that a
 * long playback run doesn't accumulate drift.
 *
 * Reports per pair:
 *   - step drift: |clipB.currentTime - clipA.currentTime| after N forward steps,
 *     N backward steps, and a round trip (should return to the start frame),
 *   - long-run drift: |B - A| sampled through a long continuous playback.
 *
 * Usage:
 *   node tests/investigate-step-sync.mjs [fixtureDir]
 * Env: PW_HEADLESS=1, STEPS=24
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FX = process.argv[2] || join(ROOT, 'tests', 'fixtures');
const STEPS = +(process.env.STEPS || 24);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

const PAIRS = [
  ['matched 24/24',        'f24_a.mp4',     'f24_b.mp4'],
  ['matched 25/25',        'f25_a.mp4',     'f25_b.mp4'],
  ['matched 29.97/29.97',  'f2997_a.mp4',   'f2997_b.mp4'],
  ['matched 30/30',        'f30_a.mp4',     'f30_b.mp4'],
  ['MIXED 24/30',          'f24_a.mp4',     'f30_b.mp4'],
  ['MIXED 25/30',          'f25_a.mp4',     'f30_b.mp4'],
  ['MIXED 29.97/30',       'f2997_a.mp4',   'f30_b.mp4'],
  ['MIXED 24/29.97',       'f24_a.mp4',     'f2997_b.mp4'],
  ['long 50s 24/24',       'f24_50s_a.mp4', 'f24_50s_b.mp4'],
  ['long 50s MIXED 24/30', 'f24_50s_a.mp4', 'f30_50s.mp4'],
].filter(([, a, b]) => existsSync(join(FX, a)) && existsSync(join(FX, b)));

if (!PAIRS.length) { console.error(`No fixtures found in ${FX}`); process.exit(1); }

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
const base = `http://localhost:${port}`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome',
  headless: process.env.PW_HEADLESS === '1', args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
for (const [label, fa, fb] of PAIRS) {
  // Fresh context per pair: each one spins up two 1080p decoders, and reusing a
  // context across the whole matrix builds up enough pressure that a later load
  // never reports duration.
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  try {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  // _setupFpsDetection logs "[fps] <slot>: raw=… → snapped=…" exactly when it
  // resolves. Counting those is unambiguous; watching videoFrameRates can't tell
  // "detected 30" from "still the 30 default".
  let fpsResolved = 0;
  page.on('console', m => { if (m.text().startsWith('[fps]')) fpsResolved++; });
  await page.goto(base);
  await page.locator('#multiFileInput').setInputFiles([join(FX, fa), join(FX, fb)]);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const v = [...document.querySelectorAll('.asset-layer video')];
    return v.length === 2 && v.every(x => !isNaN(x.duration));
  }, {}, { timeout: 15000 });

  // Play until fps detection actually resolves for BOTH clips — it needs
  // _FPS_SAMPLE_COUNT presented frames, and two 1080p decoders in a headed
  // browser present well under real time, so a fixed short warm-up leaves the
  // clips on the 30 fps default and we'd be measuring detection latency instead
  // of the stepping logic.
  await page.evaluate(() => window.playAllMedia());
  for (let waited = 0; fpsResolved < 2 && waited < 40000; waited += 250) {
    await page.waitForTimeout(250);
    // Loop back to the start rather than running off the end of a short clip.
    await page.evaluate(() => {
      const v = [...document.querySelectorAll('.asset-layer video')];
      if (v.some(x => x.currentTime > x.duration - 0.5)) v.forEach(x => { x.currentTime = 0; });
    });
  }
  if (fpsResolved < 2) console.log(`  [warn] fps detection did not resolve for both clips (${fpsResolved}/2)`);
  await page.evaluate(() => window.pauseAllMedia());
  await page.waitForTimeout(400);

  const r = await page.evaluate(async (steps) => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    const fps = vids.map(v => videoFrameRates[v.src] || 30);
    const settle = () => new Promise(r => setTimeout(r, 55));
    // Start from a clean shared instant.
    vids.forEach(v => { v.currentTime = 1.0; });
    await new Promise(r => setTimeout(r, 300));
    // Establish the baseline THROUGH the alignment path. Assigning the same
    // currentTime to both clips does NOT put them on corresponding frames when
    // the rates differ: t=1.0 is the start of frame 30 on a 30 fps clip but
    // sits inside frame 29 on a 29.97 fps one. Measuring a round trip from that
    // un-aligned state reports a phantom 1-frame error that stepping didn't
    // cause. One step out and back lands both on the canonical aligned position.
    window.stepFrame(1); await settle(); window.stepFrame(-1); await settle();
    // Compare round trips by FRAME NUMBER, not raw time: stepping deliberately
    // lands on the frame MIDPOINT ((frame+0.5)/fps, to dodge IEEE-754 boundary
    // rounding), so returning to the same frame from an arbitrary start time
    // legitimately shifts currentTime by up to half a frame. Only a frame-number
    // change is a real round-trip error.
    const frameOf = (v, i) => Math.floor(v.currentTime * fps[i] + 0.01);
    const t0 = vids.map(v => v.currentTime);
    const f0 = vids.map(frameOf);

    const drifts = [];
    for (let i = 0; i < steps; i++) { window.stepFrame(1); await settle();
      drifts.push(+((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2)); }
    const afterFwd = vids.map(v => v.currentTime);

    for (let i = 0; i < steps; i++) { window.stepFrame(-1); await settle();
      drifts.push(+((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2)); }
    const afterRound = vids.map(v => v.currentTime);

    return {
      fps,
      maxStepDrift: Math.max(...drifts.map(Math.abs)),
      endFwdDrift: +((afterFwd[1] - afterFwd[0]) * 1000).toFixed(2),
      roundTripFrames: vids.map((v, i) => frameOf(v, i) - f0[i]),
      roundTripErr: afterRound.map((t, i) => +((t - t0[i]) * 1000).toFixed(2)),
    };
  }, STEPS);

  // Long-run playback drift (only meaningful on the long pairs, cheap elsewhere).
  const longRun = await page.evaluate(async () => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    vids.forEach(v => { v.currentTime = 0; });
    await new Promise(r => setTimeout(r, 300));
    window.playAllMedia();
    const samples = [];
    const dur = Math.min(...vids.map(v => v.duration));
    const runMs = Math.min(20000, Math.max(4000, (dur - 1) * 1000));
    const t0 = performance.now();
    while (performance.now() - t0 < runMs) {
      await new Promise(r => setTimeout(r, 250));
      if (vids.some(v => v.paused)) break;
      samples.push(+((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(1));
    }
    window.pauseAllMedia();
    await new Promise(r => setTimeout(r, 200));
    return { runMs: Math.round(runMs), samples,
             pauseDrift: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(2) };
  });

  results.push({ label, ...r, longRun });
  await page.close();
  } catch (e) {
    console.log(`  [error] ${label}: ${e.message.split('\n')[0]}`);
    results.push({ label, error: e.message.split('\n')[0] });
  } finally { await ctx.close(); }
}
await browser.close();
server.close();

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n===== FRAME-STEP SYNC (${STEPS} steps forward, then ${STEPS} back) =====`);
console.log('stepDrift = B−A clock difference in ms. A frame is 41.7ms @24, 33.3ms @30.\n');
let bad = 0;
for (const r of results) {
  if (r.error) { bad++; console.log(`ERR  ${r.label.padEnd(22)} ${r.error}`); continue; }
  const halfFrame = 1000 * 0.5 / Math.min(...r.fps);
  const ok = r.maxStepDrift <= halfFrame && r.roundTripFrames.every(f => f === 0);
  if (!ok) bad++;
  console.log(`${ok ? '  ok ' : 'FAIL '}${r.label.padEnd(22)} fps=[${r.fps.join(', ')}]`);
  console.log(`        max step drift ${r.maxStepDrift.toFixed(2)}ms (½ frame = ${halfFrame.toFixed(1)}ms)` +
              `  after ${STEPS} fwd: ${r.endFwdDrift}ms`);
  console.log(`        round trip: ${r.roundTripFrames.join(' / ')} frames off start ` +
              `(time delta [${r.roundTripErr.join(', ')}]ms — ≤½ frame is the midpoint landing, expected)`);
  const lr = r.longRun;
  if (lr.samples.length) {
    const mx = Math.max(...lr.samples.map(Math.abs));
    console.log(`        long run ${lr.runMs}ms: max |drift| ${mx.toFixed(1)}ms, at pause ${lr.pauseDrift}ms` +
                `${mx > halfFrame ? '   ← exceeds ½ frame' : ''}`);
  }
}
console.log(`\n${bad ? `${bad}/${results.length} pairs FAIL` : `all ${results.length} pairs hold sync`}`);
