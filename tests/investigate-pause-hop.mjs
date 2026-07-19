#!/usr/bin/env node
/*
 * Grid-mode pause "follower hop" investigation harness.
 * See docs/pause-hop-investigation-2026-07.md for the full context.
 *
 * Drives REAL Chrome (channel: 'chrome', headed) so hardware-decode timing is
 * representative — the bug does NOT reproduce in headless CI Chromium.
 *
 * Measures, per play/pause cycle:
 *   - the DRIFT-VS-TIME curve from play start (the real quantity: the hop is a
 *     per-play-session startup offset the drift lock is too weak to close, not
 *     steady-state drift), plus the follower's playbackRate so you can see the
 *     nudge engage and release,
 *   - each clip's frame at pause and whether _snapAllVideosToFrame SEEKED it,
 *   - each clip's PRESENTED frame for ~250 ms after pause (H2 check: does the
 *     displayed frame advance even when the clock was left alone?).
 *
 * Every cycle seeks back to 0 first: the repo fixtures are 3 s / 4 s, which
 * defaults _loopRangeMode to 'full', and the Full-mode tail (short clip holds on
 * its last frame while the long one plays on) otherwise shows up as 8–24 frames
 * of fake "drift". fps is read LIVE per clip — _setupFpsDetection needs a full
 * playback pass, so a value read at load time is still the 30 default.
 *
 * Usage:
 *   node tests/investigate-pause-hop.mjs                       # repo H.264 fixtures
 *   node tests/investigate-pause-hop.mjs /path/a.mp4 /path/b.mp4   # your own videos
 *
 * Env overrides (for validating the harness logic off-Mac):
 *   PW_CHANNEL=chromium|chrome   (default: chrome)
 *   PW_EXECUTABLE=/path/to/browser   (overrides channel)
 *   PW_HEADLESS=1                (default: headed, so you can watch the hop)
 *   DWELL=700                    (ms of playback before each pause; default 700
 *                                 = the user's real "tap space" cadence)
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
  // Live per-clip fps: _setupFpsDetection only resolves after a full playback
  // pass, so anything sampled at load time is still the 30 default.
  const fpsOf = v => (typeof videoFrameRates !== 'undefined' && videoFrameRates[v.src]) || 30;
  const F = (v, t) => Math.floor(t * fpsOf(v) + 0.01);
  window.__hop = { cycles: [] };
  let cur = null;

  const origPlay = window.playAllMedia;
  window.playAllMedia = function () {
    origPlay.apply(this, arguments);
    const t0 = performance.now();
    cur = { selected: (typeof currentAudioSource !== 'undefined' && currentAudioSource) || '?',
            samples: [], clips: null, drift: null };
    window.__hop.cycles.push(cur);
    const rec = cur;
    const tick = () => {
      const ms = performance.now() - t0;
      if (ms > 3000 || vids.some(v => v.paused)) return;
      rec.samples.push({
        ms: Math.round(ms),
        // B − A in ms. Sign is stable within a session and flips between them
        // (whichever element wins the decoder start race leads).
        d: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(1),
        rA: +vids[0].playbackRate.toFixed(3),
        rB: +vids[1].playbackRate.toFixed(3),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // Hook the SNAP itself, not pauseAllMedia: sampling currentTime before
  // pauseAllMedia reads a still-running clock, so "it changed" conflates real
  // seeks with ordinary playback advance during the pause() calls. Wrapping the
  // snap brackets exactly the code under investigation — every element is
  // already paused, so any delta here IS a seek.
  const origSnap = window._snapAllVideosToFrame;
  window._snapAllVideosToFrame = function () {
    const rec = cur || (window.__hop.cycles[window.__hop.cycles.length - 1] || {});
    const before = vids.map(v => v.currentTime);
    const ref = (typeof primaryVideoRef !== 'undefined' && primaryVideoRef) || vids[0];
    const refTime = ref.currentTime;
    origSnap.apply(this, arguments);
    const after = vids.map(v => v.currentTime);
    rec.fps = vids.map(fpsOf);
    rec.refSlot = 'AB'[vids.indexOf(ref)];
    rec.clips = vids.map((v, i) => ({
      slot: 'AB'[i], frameBefore: F(v, before[i]),
      seeked: Math.abs(after[i] - before[i]) > 1e-4, frameAfter: F(v, after[i]),
      // What the v3.12.4 tolerance guard should have decided for this clip.
      offRefMs: +((before[i] - refTime) * 1000).toFixed(1),
      tolMs: +(1000 * 0.5 / fpsOf(v)).toFixed(1),
      presented: [] }));
    rec.drift = +(((before[1] - before[0])) * Math.min(...rec.fps)).toFixed(2);
  };

  const origPause = window.pauseAllMedia;
  window.pauseAllMedia = function () {
    origPause.apply(this, arguments);
    const rec = cur || (window.__hop.cycles[window.__hop.cycles.length - 1] || {});
    if (!rec.clips) return;
    vids.forEach((v, i) => {
      if (!v.requestVideoFrameCallback) return;
      const t0 = performance.now();
      const on = (now, md) => {
        // Only capture frames PRESENTED during the paused window (≤250 ms). Without
        // this the callback bleeds into the next play cycle and logs playback frames.
        if (performance.now() - t0 > 250 || !v.paused) return;
        rec.clips[i].presented.push({ f: F(v, md.mediaTime), ms: Math.round(performance.now() - t0) });
        v.requestVideoFrameCallback(on);
      };
      v.requestVideoFrameCallback(on);
    });
    cur = null;
  };
};

// ── run ──────────────────────────────────────────────────────────────────────
const channel = process.env.PW_CHANNEL || 'chrome';
const dwell = +(process.env.DWELL || 700);
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

async function cyclesSelecting(which, rounds, dwellMs) {
  // which: 0 = leave default (A), 1 = select the second slot (B)
  for (let i = 0; i < rounds; i++) {
    await page.evaluate((sel) => {
      const slots = (typeof assetOrder !== 'undefined' ? assetOrder : []).filter(s => {
        const l = (typeof getLayer === 'function') && getLayer(s); return l && l.querySelector('video'); });
      if (sel === 1 && slots[1]) { currentAudioSource = slots[1]; }
      else if (slots[0]) { currentAudioSource = slots[0]; }
      // Always start from 0: with unequal-length clips _loopRangeMode is 'full',
      // and the Full-mode tail (short clip frozen on its last frame) reads as
      // many frames of "drift" that has nothing to do with the lock.
      [...document.querySelectorAll('.asset-layer video')].forEach(v => { v.currentTime = 0; });
      window.playAllMedia();
    }, which);
    await page.waitForFunction(() => { const v = document.querySelector('.asset-layer video'); return v && !v.paused && v.currentTime > 0.05; }, {}, { timeout: 5000 });
    await page.waitForTimeout(dwellMs);
    await page.evaluate(() => window.pauseAllMedia());
    await page.waitForTimeout(300);            // capture presented-frame catch-up
  }
}

console.log(`\n[run] dwell=${dwell}ms — 4 pauses with A selected, then 4 with B selected …`);
await cyclesSelecting(0, 4, dwell);
await cyclesSelecting(1, 4, dwell);
console.log('[run] 2 long cycles (2500 ms) to show full convergence …');
await cyclesSelecting(0, 1, 2500);
await cyclesSelecting(1, 1, 2500);

const out = await page.evaluate(() => window.__hop);

// ── report ───────────────────────────────────────────────────────────────────
const at = (s, ms) => { // last sample at or before ms — null past the end of the
  // data, so a short-dwell cycle doesn't report its final sample repeated across
  // every later mark (which reads as a flat, never-converging plateau).
  if (!s.length || ms > s[s.length - 1].ms) return null;
  let r = null; for (const x of s) { if (x.ms <= ms) r = x; else break; } return r;
};
// ms until |drift| drops below half a frame and STAYS there (convergence time).
const convergedAt = (s, halfFrameMs) => {
  for (let i = 0; i < s.length; i++) {
    if (s.slice(i).every(x => Math.abs(x.d) < halfFrameMs)) return s[i].ms;
  }
  return null;
};
const MARKS = [50, 100, 200, 400, 700, 1000, 1500, 2000, 2500];
console.log('\n===== RESULTS =====');
console.log('drift = B − A in ms (>0: B ahead). rB = follower playbackRate (nudge visible as ±trim).');
out.cycles.forEach((c, i) => {
  if (!c.clips) return;
  const fpsLine = c.fps ? ` fps=[${c.fps.join(',')}]` : '';
  console.log(`\nCYCLE #${i + 1}  selected=${c.selected}${fpsLine}`);
  const curve = MARKS.map(m => { const s = at(c.samples, m); return s ? `@${m}=${s.d}` : null; })
    .filter(Boolean).join('  ');
  console.log(`   drift(ms): ${curve}`);
  const rates = MARKS.map(m => { const s = at(c.samples, m); return s ? `@${m}=${s.rA}/${s.rB}` : null; })
    .filter(Boolean).join('  ');
  console.log(`   rate A/B:  ${rates}`);
  const halfFrameMs = c.fps ? 1000 * 0.5 / Math.min(...c.fps) : 20.8;
  const conv = convergedAt(c.samples, halfFrameMs);
  const peak = c.samples.length ? Math.max(...c.samples.map(s => Math.abs(s.d))) : 0;
  console.log(`   peak |drift| = ${peak.toFixed(1)}ms; converged <½frame(${halfFrameMs.toFixed(1)}ms) ` +
              `${conv === null ? 'NEVER within this cycle' : `at ${conv}ms`}`);
  console.log(`   PAUSE drift=${c.drift}f  ref=${c.refSlot}`);
  c.clips.forEach(cl => console.log(
    `     ${cl.slot}: frame ${cl.frameBefore}${cl.seeked ? ` → SEEKED to ${cl.frameAfter}` : ' (kept)'}` +
    `  offRef=${cl.offRefMs}ms tol=±${cl.tolMs}ms` +
    (Math.abs(cl.offRefMs) <= cl.tolMs ? ' [guard: SKIP]' : ' [guard: snap]') +
    (cl.presented.length ? `  shown:[${cl.presented.map(x => `${x.f}@${x.ms}ms`).join(' ')}]` : '')));
});

const done = out.cycles.filter(c => c.clips);
const seeks = done.filter(c => c.clips.some(cl => cl.seeked)).length;
const keptButMoved = done.some(c => c.clips.some(cl => !cl.seeked && new Set(cl.presented.map(x => x.f)).size > 1));
const absDrift = done.map(c => Math.abs(c.drift));
const meanDrift = absDrift.reduce((a, b) => a + b, 0) / (absDrift.length || 1);
console.log('\n===== READING =====');
console.log(`seeked on ${seeks}/${done.length} pauses; mean |drift| at pause = ${meanDrift.toFixed(2)} frames ` +
            `(max ${Math.max(...absDrift).toFixed(2)})`);
console.log(seeks
  ? '→ H1: follower sits >½ frame off at pause. Read the drift curve — if it plateaus\n' +
    '  well above 0, the lock is converging too slowly (startup offset, not steady drift).'
  : '→ No clip was seeked on pause: the pair is landing on the same frame.');
console.log(keptButMoved
  ? '→ A "kept" clip\'s PRESENTED frame still advanced after pause ⇒ H2: decode-pipeline catch-up.'
  : '→ "kept" clips held their presented frame steady.');
console.log('\n(See docs/pause-hop-investigation-2026-07.md for what each verdict implies.)');

await browser.close();
server.close();
