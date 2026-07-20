#!/usr/bin/env node
/*
 * Does the follower get WORSE over successive plays in Safari?
 *
 * Reported: with two clips the first play is smooth and stuttering appears on
 * the follower on later plays. That shape means state accumulating across play
 * sessions, so this runs N play/pause cycles and reports, per cycle:
 *
 *   - peak A/B drift and how many ticks the drift lock trimmed
 *   - correction seeks issued on the follower
 *   - v._seekLead — per-element, grows when a correction lands behind, capped at
 *     250 ms, and NEVER reset. If it ratchets up, every later hard-seek aims
 *     further ahead of the primary, which would show up as growing stutter.
 *   - the follower's frame cadence (wall gaps + mediaTime steps), since a
 *     stutter the user can SEE is more likely a position discontinuity than a
 *     timing gap.
 *
 * Usage: node tests/investigate-safari-successive.mjs <clipA> <clipB>
 * Env:   CYCLES=6  SECS=3.5
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve as resolvePath } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [fileA, fileB] = process.argv.slice(2).map(f => f && resolvePath(f));
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-safari-successive.mjs <a.mp4> <b.mp4>'); process.exit(1); }
for (const f of [fileA, fileB]) { try { await stat(f); } catch { console.error(`Cannot read: ${f}`); process.exit(1); } }
const CYCLES = +(process.env.CYCLES || 6);
// MODE: baseline | noTrim | oneShot  (in-page patch of the recovery policy)
const MODE = process.env.MODE || 'baseline';
const SECS = +(process.env.SECS || 3.5);
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

const DRIVER_PORT = 4605;
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
  await wd('POST', S('/timeouts'), { script: 120000 });
  await wd('POST', S('/url'), { url: `http://localhost:${port}/` });
  const input = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  await wd('POST', S(`/element/${Object.values(input)[0]}/value`), { text: `${fileA}\n${fileB}` });
  for (let i = 0; i < 90; i++) {
    if (await exec(`return (() => { const v=[...document.querySelectorAll('.asset-layer video')];
      return v.length===2 && v.every(x=>!isNaN(x.duration) && x.videoWidth>0 && x.readyState>=2); })()`).catch(() => false)) break;
    await sleep(500);
  }
  // Let fps detection resolve so the half-frame bands are right.
  await exec('window.playAllMedia(); return 1;');
  await sleep(3000);
  await exec('window.pauseAllMedia(); return 1;');
  await sleep(400);
  const fps = await exec('return window.__testAPI._videoFps');
  // Patch the recovery policy in-page. _driftLockTick is a classic-script
  // top-level function: assigning window._driftLockTick shadows it for the
  // updateLoop call site (resolved via the global object at call time).
  if (MODE === 'noTrim') {
    await exec(`[...document.querySelectorAll('.asset-layer video')].forEach(v => { v.playbackRate = 1; });
      window._driftLockTick = function () {}; return 1;`);
  } else if (MODE === 'oneShot') {
    await exec(`
      // One-shot re-align: no rate trims. When the follower sits >1.5 frames
      // off for 8 consecutive ticks (a real, settled offset - not read noise)
      // and hasn't been seeked in 800ms, hard-seek it once with the seek lead.
      [...document.querySelectorAll('.asset-layer video')].forEach(v => { v.playbackRate = 1; });
      window._driftLockTick = function (primary) {
        if (hasAudios || !primary || primary.paused) return;
        if (isDragging || _bulkSyncActive) return;
        const videos = getAllVideos();
        if (videos.length < 2) return;
        const primaryFps = videoFrameRates[primary.src] || 30;
        for (const v of videos) {
          if (v === primary) continue;
          if (v.paused || v.ended || v.readyState < 2 || v.seeking) continue;
          if (v._seekIssued) {
            v._seekIssued = false;
            const err = v.currentTime - primary.currentTime;
            v._seekLead = Math.min(0.25, Math.max(0, (v._seekLead || 0) - err * 0.8));
          }
          const fps2 = Math.min(primaryFps, videoFrameRates[v.src] || 30);
          const drift = v.currentTime - primary.currentTime;
          const mag = Math.abs(drift);
          if (mag > 1.5 / fps2) { v._offTicks = (v._offTicks || 0) + 1; }
          else v._offTicks = 0;
          const now = performance.now();
          if (v._offTicks >= 8 && (!v._lastRealign || now - v._lastRealign > 800)) {
            v._lastRealign = now;
            v._offTicks = 0;
            v._seekIssued = true;
            v.currentTime = primary.currentTime + (v._seekLead || 0);
          }
        }
      }; return 1;`);
  }
  console.log(`  MODE: ${MODE}`);
  console.log(`\n[successive] ${basename(fileA)} + ${basename(fileB)}   fps=${JSON.stringify(fps)}   ${CYCLES} cycles\n`);
  console.log('  cycle  peakDrift  trims  seeks  seekLead(A/B)   follower: badSteps  hitches');

  for (let c = 1; c <= CYCLES; c++) {
    const r = await execAsync(`
      const done = arguments[arguments.length - 1];
      const vids = [...document.querySelectorAll('.asset-layer video')];
      const F = vids[1]; // follower = non-selected slot (selection defaults to the first)
      vids.forEach(v => { v.currentTime = 1.0; ${MODE !== 'baseline' ? 'v.playbackRate = 1;' : ''} });
      let seeks = 0;
      const onSeek = () => seeks++;
      F.addEventListener('seeking', onSeek);
      setTimeout(() => {
        const samples = [], gaps = [], steps = [];
        let last = null, lastMt = null;
        const onFrame = (now, md) => {
          if (last !== null) { gaps.push(now - last); steps.push((md.mediaTime - lastMt) * 1000); }
          last = now; lastMt = md.mediaTime;
          F.requestVideoFrameCallback(onFrame);
        };
        F.requestVideoFrameCallback(onFrame);
        const tick = () => {
          if (vids.some(v => v.paused)) return;
          samples.push({ d: (vids[1].currentTime - vids[0].currentTime) * 1000,
                         r: vids[1].playbackRate });
          requestAnimationFrame(tick);
        };
        window.playAllMedia();
        requestAnimationFrame(tick);
        setTimeout(() => {
          window.pauseAllMedia();
          F.removeEventListener('seeking', onSeek);
          setTimeout(() => {
            const lock = window.__testAPI._driftLock;
            done({ samples, gaps, steps, seeks, lock });
          }, 250);
        }, ${Math.round(SECS * 1000)});
      }, 500);`);

    const drift = r.samples.map(s => Math.abs(s.d));
    const peak = drift.length ? Math.max(...drift) : 0;
    const trims = r.samples.filter(s => Math.abs(s.r - 1) > 1e-6).length;
    const g = r.gaps.filter(x => x > 0);
    const gs = g.slice().sort((a, b) => a - b);
    const gmed = gs[gs.length >> 1] || 0;
    const hitches = g.filter(x => x > gmed * 1.5).length;
    const st = r.steps.filter(x => x !== undefined);
    const ss = st.slice().sort((a, b) => a - b);
    const smed = ss[ss.length >> 1] || 0;
    // A "bad step" is the picture not advancing by one frame — repeated or
    // skipped content, which is what actually reads as a stutter.
    const badSteps = st.filter(x => Math.abs(x - smed) > smed * 0.4).length;
    const leads = (r.lock || []).map(l => (l.seekLead * 1000).toFixed(0));
    console.log(`   ${String(c).padStart(3)}   ${peak.toFixed(1).padStart(7)}ms ` +
                `${String(trims).padStart(6)} ${String(r.seeks).padStart(6)}   ` +
                `${leads.join(' / ').padEnd(12)}  ${String(badSteps).padStart(9)}/${st.length}` +
                `${String(hitches).padStart(8)}/${g.length}`);
  }
  console.log(`\n  seekLead grows when a correction seek lands behind; it caps at 250ms and is never reset.`);
  console.log(`  If it climbs across cycles while badSteps/seeks rise with it, that is the accumulating state.`);
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
