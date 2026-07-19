#!/usr/bin/env node
/*
 * Grid-mode pause "follower hop" investigation harness.
 * See docs/pause-hop-investigation-2026-07.md for the full context.
 *
 * Drives REAL Chrome (channel: 'chrome', headed) so hardware-decode timing is
 * representative — the bug does NOT reproduce in headless CI Chromium.
 *
 * Usage:
 *   node tests/investigate-pause-hop.mjs                       # repo H.264 fixtures
 *   node tests/investigate-pause-hop.mjs /path/a.mp4 /path/b.mp4   # your own videos
 *
 * Env overrides (for validating the harness logic off-Mac):
 *   PW_CHANNEL=chromium|chrome   (default: chrome)
 *   PW_EXECUTABLE=/path/to/browser   (overrides channel)
 *   PW_HEADLESS=1                (default: headed, so you can watch the hop)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };

// ── fixtures ──────────────────────────────────────────────────────────────────
let [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  const fx = join(ROOT, 'tests', 'fixtures');
  fileA = join(fx, 'landscape_a.mp4'); fileB = join(fx, 'landscape_b.mp4');
  if (!existsSync(fileA) || !existsSync(fileB)) {
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
      console.log('[setup] generating fixtures via tests/fixtures/generate.sh …');
      spawnSync('bash', [join(fx, 'generate.sh')], { stdio: 'inherit' });
    }
  }
  if (!existsSync(fileA) || !existsSync(fileB)) {
    console.error('No fixtures and none provided. Pass two video paths, or install ffmpeg so\n' +
      'tests/fixtures/generate.sh can build them: node tests/investigate-pause-hop.mjs a.mp4 b.mp4');
    process.exit(1);
  }
}
console.log(`[setup] clips:\n  A = ${fileA}\n  B = ${fileB}`);

// ── static server ─────────────────────────────────────────────────────────────
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
console.log(`[setup] serving ${ROOT} at ${base}`);

// ── the instrumentation (runs in-page) ──────────────────────────────────────────
const INSTRUMENT = () => {
  const vids = [...document.querySelectorAll('.asset-layer video')];
  const fr = (typeof videoFrameRates !== 'undefined' && videoFrameRates[vids[0].src]) || 24;
  const F = t => Math.floor(t * fr + 0.01);
  window.__hop = { fr, pauses: [] };
  const orig = window.pauseAllMedia;
  window.pauseAllMedia = function () {
    const before = vids.map(v => v.currentTime);
    orig.apply(this, arguments);
    const after = vids.map(v => v.currentTime);
    const rec = { fr, clips: vids.map((v, i) => ({
      slot: 'AB'[i], frameBefore: F(before[i]),
      seeked: Math.abs(after[i] - before[i]) > 1e-4, frameAfter: F(after[i]), presented: [] })),
      driftFrames: +(((before[1] - before[0])) * fr).toFixed(2) };
    window.__hop.pauses.push(rec);
    vids.forEach((v, i) => {
      if (!v.requestVideoFrameCallback) return;
      const t0 = performance.now();
      const on = (now, md) => {
        // Only capture frames PRESENTED during the paused window (≤250 ms). Without
        // this the callback bleeds into the next play cycle and logs playback frames.
        if (performance.now() - t0 > 250 || !v.paused) return;
        rec.clips[i].presented.push({ f: F(md.mediaTime), ms: Math.round(performance.now() - t0) });
        v.requestVideoFrameCallback(on);
      };
      v.requestVideoFrameCallback(on);
    });
  };
};

// ── run ──────────────────────────────────────────────────────────────────────
const channel = process.env.PW_CHANNEL || 'chrome';
const launch = process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE }
  : { channel };
const browser = await chromium.launch({ ...launch, headless: process.env.PW_HEADLESS === '1',
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(base);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 20000 });
await page.waitForFunction(() => { const v = document.querySelector('.asset-layer video'); return v && !isNaN(v.duration); }, {}, { timeout: 8000 });
await page.evaluate(INSTRUMENT);

async function cyclesSelecting(which, rounds) {
  // which: 0 = leave default (A), 1 = select the second slot (B)
  for (let i = 0; i < rounds; i++) {
    await page.evaluate((sel) => {
      const slots = (typeof assetOrder !== 'undefined' ? assetOrder : []).filter(s => {
        const l = (typeof getLayer === 'function') && getLayer(s); return l && l.querySelector('video'); });
      if (sel === 1 && slots[1]) { currentAudioSource = slots[1]; }
      else if (slots[0]) { currentAudioSource = slots[0]; }
      window.playAllMedia();
    }, which);
    await page.waitForFunction(() => { const v = document.querySelector('.asset-layer video'); return v && !v.paused && v.currentTime > 0.3; }, {}, { timeout: 5000 });
    await page.waitForTimeout(1500);           // reach steady state (past drift-lock convergence)
    await page.evaluate(() => window.pauseAllMedia());
    await page.waitForTimeout(220);            // capture presented-frame catch-up
  }
}

console.log('\n[run] 5 pauses with A selected, then 5 with B selected …');
await cyclesSelecting(0, 5);
await cyclesSelecting(1, 5);

const out = await page.evaluate(() => window.__hop);
console.log(`\n===== RESULTS (fps ${out.fr}) =====`);
out.pauses.forEach((p, i) => {
  const clip = c => `${c.slot}: frame ${c.frameBefore}${c.seeked ? ` → SEEKED to ${c.frameAfter}` : ' (kept)'}` +
    (c.presented.length ? `  shown:[${c.presented.map(x => `${x.f}@${x.ms}ms`).join(' ')}]` : '');
  console.log(`\nPAUSE #${i + 1}  clockDrift=${p.driftFrames}f`);
  p.clips.forEach(c => console.log('   ' + clip(c)));
});
// verdict helper
const anySeek = out.pauses.some(p => p.clips.some(c => c.seeked));
const keptButMoved = out.pauses.some(p => p.clips.some(c => !c.seeked && new Set(c.presented.map(x => x.f)).size > 1));
console.log('\n===== READING =====');
console.log(anySeek
  ? '→ A clip was SEEKED on pause ⇒ H1: follower sits >½ frame off. Tighten the Grid drift lock.'
  : '→ No clip was seeked on pause.');
console.log(keptButMoved
  ? '→ A "kept" clip\'s PRESENTED frame still advanced after pause ⇒ H2: decode-pipeline catch-up, not the snap.'
  : '→ "kept" clips held their presented frame steady.');
console.log('\n(See docs/pause-hop-investigation-2026-07.md for what each verdict implies.)');

await browser.close();
server.close();
