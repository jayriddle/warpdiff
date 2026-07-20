#!/usr/bin/env node
/*
 * Safari Stack-mode A/B switch hesitation — which mechanism?
 *
 * Reported: in Stack mode, switching between A and B hesitates. Three
 * candidates, each isolated by a single-variable in-app arm (the only
 * measurement style that has held up on Safari):
 *
 *   baseline   — shipping behaviour.
 *   muted      — master-mute both elements across switches. selectAudioSource
 *                unmutes the incoming element on every switch, and starting
 *                Safari's audio pipeline is PROVEN to stall the same element's
 *                video (the loop-wrap finding, user-verified). If hesitation
 *                vanishes muted, it's the audio pipeline.
 *   noLock     — drift lock stubbed (rates reset). Stack's hidden follower is
 *                trimmed at a flat ±10% inside an 8 ms engage band, on a clock
 *                signal that wanders ±20 ms on WebKit — i.e. nearly constant
 *                rate churn on the element you're about to reveal. If
 *                hesitation shrinks here, the hidden-follower trims are hurting
 *                after all ("invisible, so no cost" fails on WebKit).
 *   noOverlay  — _beginSeamlessSwitch stubbed. Its RVFC wait was designed
 *                around Chrome's unhide behaviour with a 300 ms fallback; if a
 *                hidden Safari <video> doesn't present, every switch waits out
 *                the timeout.
 *
 * Per switch: time until the incoming video PRESENTS its first new frame,
 * its presented cadence for the next ~1 s (bad frame-steps = repeated/skipped
 * content — the metric that tracks perception), its clock stall, and the pair
 * drift + rates at the switch moment.
 *
 * Usage: node tests/investigate-safari-switch.mjs <clipA> <clipB>
 * Env:   ARMS=baseline,muted,noLock,noOverlay  SWITCHES=8  DWELL=900
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve as resolvePath } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [fileA, fileB] = process.argv.slice(2).map(f => f && resolvePath(f));
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-safari-switch.mjs <a.mp4> <b.mp4>'); process.exit(1); }
for (const f of [fileA, fileB]) { try { await stat(f); } catch { console.error(`Cannot read: ${f}`); process.exit(1); } }
const ARMS = (process.env.ARMS || 'baseline,muted,noLock,noOverlay').split(',');
const SWITCHES = +(process.env.SWITCHES || 8);
const DWELL = +(process.env.DWELL || 900);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    const fp = join(ROOT, url === '/' ? '/index.html' : url);
    if (!fp.startsWith(ROOT) || !(await stat(fp)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch { res.writeHead(404).end(); }
});
const port = await new Promise(r => server.listen(0, () => r(server.address().port)));

const DRIVER_PORT = 4609;
const driver = spawn('safaridriver', ['-p', String(DRIVER_PORT)], { stdio: 'ignore' });
const base = `http://localhost:${DRIVER_PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wd(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.value && j.value.error) throw new Error(`${j.value.error}: ${j.value.message || ''}`.slice(0, 200));
  return j.value;
}
let up = false;
for (let i = 0; i < 40 && !up; i++) { try { await fetch(base + '/status'); up = true; } catch { await sleep(250); } }
if (!up) { console.error('safaridriver did not start. Run: safaridriver --enable'); process.exit(1); }
const { sessionId } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = p => `/session/${sessionId}${p}`;
const exec = s => wd('POST', S('/execute/sync'), { script: s, args: [] });
const execAsync = s => wd('POST', S('/execute/async'), { script: s, args: [] });

try {
  await wd('POST', S('/timeouts'), { script: 180000 });
  await wd('POST', S('/url'), { url: `http://localhost:${port}/` });
  const input = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  await wd('POST', S(`/element/${Object.values(input)[0]}/value`), { text: `${fileA}\n${fileB}` });
  for (let i = 0; i < 90; i++) {
    if (await exec(`return (() => { const v=[...document.querySelectorAll('.asset-layer video')];
      return v.length===2 && v.every(x=>!isNaN(x.duration) && x.videoWidth>0 && x.readyState>=2); })()`).catch(() => false)) break;
    await sleep(500);
  }
  // Stack mode + fps warm-up.
  await exec(`if (isGridMode) setViewMode('overlay'); return 1;`);
  await sleep(400);
  await exec('window.playAllMedia(); return 1;');
  await sleep(3000);
  await exec('window.pauseAllMedia(); return 1;');
  await sleep(400);
  const mode = await exec('return { grid: isGridMode, fps: window.__testAPI._videoFps }');
  console.log(`\n[switch] ${basename(fileA)} + ${basename(fileB)}   Stack=${!mode.grid}  fps=${JSON.stringify(mode.fps)}`);
  console.log(`[switch] ${SWITCHES} switches per arm, ${DWELL} ms dwell\n`);

  // Persistent per-arm instrumentation state lives on window.__sw.
  await exec(`
    window.__sw = {};
    window.__swSetup = (arm) => {
      const w = window.__sw;
      // restore any previous arm's patches
      if (w.origLock) { window._driftLockTick = w.origLock; w.origLock = null; }
      if (w.origSwitchFx) { window._beginSeamlessSwitch = w.origSwitchFx; w.origSwitchFx = null; }
      if (w.origSelect) { window.selectAudioSource = w.origSelect; w.origSelect = null; }
      const vids = [...document.querySelectorAll('.asset-layer video')];
      vids.forEach(v => { v.playbackRate = 1; });
      if (w.styleEl) { w.styleEl.remove(); w.styleEl = null; }
      if (arm === 'opacity' || arm === 'opacityNoLock') {
        // Keep the inactive Stack layer COMPOSITED (opacity:0) instead of
        // display:none, so its element never stops presenting and a switch
        // reveals a live surface instead of waiting for Safari to resume one.
        w.styleEl = document.createElement('style');
        w.styleEl.textContent =
          'body:not(.grid-mode) .asset-layer:not(.active) .video-wrapper {' +
          ' display: block !important; opacity: 0 !important;' +
          ' pointer-events: none !important; z-index: 1 !important; }';
        document.head.appendChild(w.styleEl);
        if (arm === 'opacityNoLock') {
          w.origLock = window._driftLockTick;
          window._driftLockTick = function () {};
        }
      } else if (arm === 'noLock') {
        w.origLock = window._driftLockTick;
        window._driftLockTick = function () {};
      } else if (arm === 'noOverlay') {
        w.origSwitchFx = window._beginSeamlessSwitch;
        window._beginSeamlessSwitch = function () {};
      } else if (arm === 'muted') {
        w.origSelect = window.selectAudioSource;
        window.selectAudioSource = function (s) { w.origSelect(s);
          [...document.querySelectorAll('.asset-layer video')].forEach(v => { v.muted = true; }); };
        vids.forEach(v => { v.muted = true; });
      }
      // one persistent RVFC per element recording presented frames
      if (!w.pres) {
        w.pres = [[], []];
        vids.forEach((v, i) => {
          const on = (now, md) => { w.pres[i].push({ w: now, mt: md.mediaTime }); v.requestVideoFrameCallback(on); };
          v.requestVideoFrameCallback(on);
        });
      }
      w.pres[0].length = 0; w.pres[1].length = 0;
      return arm;
    };`);

  for (const arm of ARMS) {
    await exec(`return window.__swSetup(${JSON.stringify(arm)})`);
    const r = await execAsync(`
      const done = arguments[arguments.length - 1];
      const w = window.__sw;
      const vids = [...document.querySelectorAll('.asset-layer video')];
      const loaded = assetOrder.map((s, i) => mediaData[s] ? i : -1).filter(i => i >= 0);
      vids.forEach(v => { v.currentTime = 1.0; });
      const events = [];
      setTimeout(() => {
        window.playAllMedia();
        let k = 0;
        const doSwitch = () => {
          if (k >= ${SWITCHES}) {
            setTimeout(() => {
              try { window.pauseAllMedia(); } catch (e) {}
              done({ events, pres: [w.pres[0].slice(-400), w.pres[1].slice(-400)] });
            }, 400);
            return;
          }
          const idx = loaded[(k + 1) % loaded.length];
          const slot = assetOrder[idx];
          const layer = getLayer(slot);
          const vin = layer.querySelector('video');
          const vi = vids.indexOf(vin);
          const t0 = performance.now();
          events.push({ t0, vi,
            driftMs: +((vids[1].currentTime - vids[0].currentTime) * 1000).toFixed(1),
            rates: vids.map(v => +v.playbackRate.toFixed(3)),
            ctIn: vin.currentTime });
          switchToAsset(idx);
          k++;
          setTimeout(doSwitch, ${DWELL});
        };
        setTimeout(doSwitch, 800);
      }, 500);`);

    // Analyse: per switch, incoming element's first presented frame after t0,
    // then its frame-step regularity for the next ~800 ms.
    const rows = [];
    for (const ev of r.events) {
      const stream = r.pres[ev.vi];
      const after = stream.filter(f => f.w >= ev.t0);
      const first = after.length ? after[0].w - ev.t0 : null;
      const win = after.filter(f => f.w < ev.t0 + 800);
      let bad = 0, steps = 0;
      for (let i = 1; i < win.length; i++) {
        const st = (win[i].mt - win[i - 1].mt) * 1000;
        steps++;
        if (st <= 1 || st > 1000 / (24 / 1.6)) bad++;  // repeat or >1.6-frame skip @24fps
      }
      rows.push({ first, bad, steps, drift: ev.driftMs, rates: ev.rates });
    }
    const firsts = rows.map(x => x.first).filter(x => x !== null).sort((a, b) => a - b);
    const p50 = firsts[firsts.length >> 1] || 0;
    const worst = firsts[firsts.length - 1] || 0;
    const badTot = rows.reduce((a, x) => a + x.bad, 0);
    const stepTot = rows.reduce((a, x) => a + x.steps, 0);
    const trimmed = rows.filter(x => x.rates.some(rr => Math.abs(rr - 1) > 1e-6)).length;
    const driftAbs = rows.map(x => Math.abs(x.drift)).sort((a, b) => a - b);
    console.log(`  --- ${arm} ---`);
    console.log(`    first new frame after switch: p50 ${p50.toFixed(0)}ms  worst ${worst.toFixed(0)}ms   ` +
                `(per switch: ${rows.map(x => x.first === null ? '?' : x.first.toFixed(0)).join(' ')})`);
    console.log(`    bad frame-steps in the 800ms after switch: ${badTot}/${stepTot}` +
                `   switches with a trim active: ${trimmed}/${rows.length}` +
                `   |drift| at switch p50 ${driftAbs[driftAbs.length >> 1] || 0}ms max ${driftAbs[driftAbs.length - 1] || 0}ms\n`);
  }
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
