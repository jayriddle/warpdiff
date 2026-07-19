#!/usr/bin/env node
/*
 * REAL Safari diagnostics, driven through safaridriver's W3C WebDriver endpoint
 * over plain HTTP — no selenium/playwright dependency (Playwright can't drive
 * shipping Safari at all, and its bundled WebKit is a different engine build).
 *
 * Requires (one time, needs admin):  safaridriver --enable
 *
 * Reports:
 *   1. LAYOUT GEOMETRY — layer / wrapper / video rects per slot, the intrinsic
 *      video size, and whether the painted picture actually sits inside the
 *      layer box that carries the click-to-select listener. A picture that
 *      overhangs its layer is why "clicking A selects B, but clicking to the
 *      LEFT of A works".
 *   2. PLAYBACK SYNC — A/B drift, the drift lock's playbackRate trims, and
 *      DROPPED FRAME counts per element during a forward play.
 *
 * Usage: node tests/investigate-safari.mjs <clipA> <clipB>
 * Env:   VIEWPORT=1650x1550   SECS=8
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-safari.mjs <a.mp4> <b.mp4>'); process.exit(1); }
const [VW, VH] = (process.env.VIEWPORT || '1650x1550').split('x').map(Number);
const SECS = +(process.env.SECS || 8);

// ── static server ────────────────────────────────────────────────────────────
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

// ── minimal W3C WebDriver client ─────────────────────────────────────────────
const DRIVER_PORT = 4599;
const driver = spawn('safaridriver', ['-p', String(DRIVER_PORT)], { stdio: 'ignore' });
const base = `http://localhost:${DRIVER_PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (j.value && j.value.error) {
    throw new Error(`${j.value.error}: ${j.value.message || ''}`.slice(0, 300));
  }
  return j.value;
}

// safaridriver takes a moment to bind its port.
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { await fetch(base + '/status'); up = true; } catch { await sleep(250); }
}
if (!up) { console.error('safaridriver did not start. Run: safaridriver --enable'); process.exit(1); }

let sessionId;
try {
  const v = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  sessionId = v.sessionId;
} catch (e) {
  console.error('Could not start a Safari session:', e.message);
  console.error('Enable it with:  safaridriver --enable   (and allow Remote Automation in Safari > Develop)');
  driver.kill(); server.close(); process.exit(1);
}
const S = p => `/session/${sessionId}${p}`;
const exec = (script, args = []) => wd('POST', S('/execute/sync'), { script, args });

async function cleanup() {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

try {
  await wd('POST', S('/window/rect'), { x: 0, y: 0, width: VW, height: VH });
  await wd('POST', S('/url'), { url: `http://localhost:${port}` });
  // Safari's window rect is the OS window, not the viewport, and it clamps to
  // the display. Converge on the requested innerWidth/innerHeight so the grid
  // layout sees the same space the user's window gives it — the whole point is
  // that pickBestGridLayout's choice depends on viewport aspect.
  for (let i = 0; i < 6; i++) {
    const got = await exec('return [innerWidth, innerHeight]');
    const dw = VW - got[0], dh = VH - got[1];
    if (Math.abs(dw) <= 2 && Math.abs(dh) <= 2) break;
    const rect = await wd('GET', S('/window/rect'));
    await wd('POST', S('/window/rect'),
      { x: rect.x, y: rect.y, width: Math.round(rect.width + dw), height: Math.round(rect.height + dh) });
    await sleep(250);
  }
  const vp = await exec('return [innerWidth, innerHeight]');
  if (Math.abs(vp[0] - VW) > 2 || Math.abs(vp[1] - VH) > 2) {
    console.log(`[warn] wanted viewport ${VW}x${VH}, Safari settled at ${vp[0]}x${vp[1]} ` +
                `(display too small?) — layout choice may not match the reported case`);
  }

  // Load the two clips through the file input.
  const input = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  const inputId = Object.values(input)[0];
  await wd('POST', S(`/element/${inputId}/value`), { text: `${fileA}\n${fileB}` });

  // Wait for both videos to report metadata.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await exec(`return (() => {
      const v = [...document.querySelectorAll('.asset-layer video')];
      return v.length === 2 && v.every(x => !isNaN(x.duration) && x.videoWidth > 0);
    })()`).catch(() => false);
    if (!ready) await sleep(500);
  }
  const engine = await exec('return navigator.userAgent');
  console.log(`\n[setup] ${basename(fileA)} + ${basename(fileB)}  viewport ${VW}x${VH}`);
  console.log(`[setup] ${engine}`);
  console.log(`[setup] metadata ready: ${ready}`);

  // ── 1. layout geometry ─────────────────────────────────────────────────────
  const geo = await exec(`return (() => {
    const r = el => { const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const out = { grid: typeof isGridMode !== 'undefined' && isGridMode,
                  bodyClass: document.body.className,
                  vw: innerWidth, vh: innerHeight, slots: [] };
    for (const slot of assetOrder) {
      const layer = typeof getLayer === 'function' ? getLayer(slot) : null;
      if (!layer) continue;
      const vid = layer.querySelector('video');
      const wrap = layer.querySelector('.video-wrapper');
      if (!vid) continue;
      const md = (typeof mediaData !== 'undefined' && mediaData[slot]) || {};
      out.slots.push({
        slot, layer: r(layer), wrapper: wrap ? r(wrap) : null, video: r(vid),
        intrinsic: { w: vid.videoWidth, h: vid.videoHeight },
        mediaDims: { w: md.width || md.w || null, h: md.height || md.h || null },
        wrapperInline: wrap ? { left: wrap.style.left, top: wrap.style.top,
                                width: wrap.style.width, height: wrap.style.height } : null,
        pe: getComputedStyle(layer).pointerEvents,
      });
    }
    return out;
  })()`);

  console.log(`\n===== 1. LAYOUT GEOMETRY =====`);
  console.log(`viewport ${geo.vw}x${geo.vh}   isGridMode=${geo.grid}   body.class="${geo.bodyClass}"`);
  for (const s of geo.slots) {
    const L = s.layer, V = s.video;
    const inside = V.x >= L.x - 1 && V.y >= L.y - 1 &&
                   V.x + V.w <= L.x + L.w + 1 && V.y + V.h <= L.y + L.h + 1;
    console.log(`\n  ${s.slot}`);
    console.log(`    layer    x=${L.x} y=${L.y} w=${L.w} h=${L.h}   pointer-events:${s.pe}`);
    console.log(`    wrapper  ${s.wrapper ? `x=${s.wrapper.x} y=${s.wrapper.y} w=${s.wrapper.w} h=${s.wrapper.h}` : '(none)'}`);
    console.log(`    inline   ${JSON.stringify(s.wrapperInline)}`);
    console.log(`    video    x=${V.x} y=${V.y} w=${V.w} h=${V.h}   intrinsic ${s.intrinsic.w}x${s.intrinsic.h}` +
                `  (aspect ${(s.intrinsic.w / s.intrinsic.h).toFixed(3)})`);
    console.log(`    rendered aspect ${(V.w / V.h).toFixed(3)}` +
                `${Math.abs(V.w / V.h - s.intrinsic.w / s.intrinsic.h) > 0.02 ? '   ← does NOT match the source aspect' : ''}`);
    console.log(`    ${inside ? 'video is INSIDE its layer (clicking the picture selects it)'
                              : `video OVERHANGS its layer by dx=${V.x - L.x} — clicking the picture can hit the WRONG slot`}`);
  }

  // Does clicking the centre of each painted video select that slot?
  console.log(`\n  click test (centre of each painted picture):`);
  for (const s of geo.slots) {
    const cx = Math.round(s.video.x + s.video.w / 2), cy = Math.round(s.video.y + s.video.h / 2);
    const hit = await exec(`return (() => {
      const el = document.elementFromPoint(${cx}, ${cy});
      const layer = el && el.closest ? el.closest('.asset-layer') : null;
      return layer ? layer.id : (el ? el.tagName + '.' + el.className : 'null');
    })()`);
    console.log(`    centre of ${s.slot} (${cx},${cy}) → topmost .asset-layer = ${hit}`);
  }

  // ── 1b. raw requestVideoFrameCallback timing ───────────────────────────────
  // _setupFpsDetection infers fps from consecutive metadata.mediaTime deltas.
  // Safari reported a 24 fps clip as 60, so look at the deltas it actually
  // produces rather than trusting the snapped result.
  console.log(`\n===== 1b. RAW requestVideoFrameCallback DELTAS =====`);
  const rvfc = await exec(`return (() => new Promise(resolve => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    const out = vids.map(() => ({ mt: [], pres: [], expected: [] }));
    let done = 0;
    vids.forEach((v, i) => {
      if (!v.requestVideoFrameCallback) { out[i].unsupported = true; if (++done === vids.length) resolve(out); return; }
      let n = 0;
      const on = (now, md) => {
        out[i].mt.push(md.mediaTime);
        out[i].pres.push(md.presentedFrames);
        out[i].expected.push(md.expectedDisplayTime);
        if (++n < 25 && !v.paused) v.requestVideoFrameCallback(on);
        else if (++done === vids.length) resolve(out);
      };
      v.requestVideoFrameCallback(on);
    });
    vids.forEach(v => { v.currentTime = 0; });
    window.playAllMedia();
    setTimeout(() => { try { window.pauseAllMedia(); } catch (e) {} resolve(out); }, 4000);
  }))()`);
  rvfc.forEach((r, i) => {
    const slot = 'AB'[i];
    if (r.unsupported) { console.log(`  ${slot}: requestVideoFrameCallback UNSUPPORTED`); return; }
    const d = [];
    for (let k = 1; k < r.mt.length; k++) d.push(+((r.mt[k] - r.mt[k - 1]) * 1000).toFixed(2));
    const pos = d.filter(x => x > 0);
    const uniq = [...new Set(d)].slice(0, 10);
    console.log(`  ${slot}: ${r.mt.length} callbacks, ${d.length} deltas`);
    console.log(`      mediaTime deltas (ms): [${d.slice(0, 12).join(', ')}]`);
    console.log(`      distinct: [${uniq.join(', ')}]   min>0 = ${pos.length ? Math.min(...pos).toFixed(2) : 'n/a'}ms` +
                `  → implies ${pos.length ? (1000 / Math.min(...pos)).toFixed(1) : '?'} fps`);
    console.log(`      presentedFrames: [${r.pres.slice(0, 8).join(', ')}]` +
                `${r.pres.every(p => p === undefined) ? '  (not reported)' : ''}`);
    const zeros = d.filter(x => x === 0).length;
    if (zeros) console.log(`      ${zeros}/${d.length} deltas are ZERO — the same frame reported repeatedly ` +
                           `(callback firing at DISPLAY rate, not frame rate)`);
  });

  // ── 2. playback sync + dropped frames ──────────────────────────────────────
  console.log(`\n===== 2. FORWARD PLAYBACK (${SECS}s) =====`);
  await exec(`(() => {
    const v = [...document.querySelectorAll('.asset-layer video')];
    v.forEach(x => { x.currentTime = 0; });
    window.__q0 = v.map(x => (x.getVideoPlaybackQuality && x.getVideoPlaybackQuality()) || {});
    window.__samples = [];
    window.playAllMedia();
    window.__t0 = performance.now();
    const tick = () => {
      if (v.some(x => x.paused)) return;
      window.__samples.push({
        ms: Math.round(performance.now() - window.__t0),
        d: +((v[1].currentTime - v[0].currentTime) * 1000).toFixed(1),
        rA: +v[0].playbackRate.toFixed(3), rB: +v[1].playbackRate.toFixed(3),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  await sleep(SECS * 1000);
  const run = await exec(`return (() => {
    const v = [...document.querySelectorAll('.asset-layer video')];
    const q = v.map((x, i) => {
      const now = (x.getVideoPlaybackQuality && x.getVideoPlaybackQuality()) || {};
      const was = window.__q0[i] || {};
      return { dropped: (now.droppedVideoFrames || 0) - (was.droppedVideoFrames || 0),
               total: (now.totalVideoFrames || 0) - (was.totalVideoFrames || 0) };
    });
    const beforePause = (v[1].currentTime - v[0].currentTime) * 1000;
    window.pauseAllMedia();
    return { samples: window.__samples, quality: q, fps: window.__testAPI ? window.__testAPI._videoFps : null,
             beforePause: +beforePause.toFixed(2) };
  })()`);
  await sleep(500);
  const settled = await exec(`return (() => {
    const v = [...document.querySelectorAll('.asset-layer video')];
    const fr = window.__testAPI._videoFps;
    return { drift: +((v[1].currentTime - v[0].currentTime) * 1000).toFixed(2),
             frames: v.map((x, i) => Math.floor(x.currentTime * fr[i] + 0.01)),
             paused: v.map(x => x.paused) };
  })()`);
  console.log(`  PAUSE SNAP: drift ${run.beforePause}ms before pause → ${settled.drift}ms after` +
              `   frames [${settled.frames.join(', ')}]${settled.frames[0] === settled.frames[1] ? '  SAME FRAME' : '  ← DIFFERENT FRAMES'}`);

  const S2 = run.samples || [];
  const drift = S2.map(s => Math.abs(s.d));
  const trims = S2.filter(s => s.rA !== 1 || s.rB !== 1);
  const half = run.fps ? 1000 * 0.5 / Math.min(...run.fps) : 20.8;
  console.log(`  detected fps: ${JSON.stringify(run.fps)}   (½ frame = ${half.toFixed(1)}ms)`);
  console.log(`  drift |B−A|: peak ${Math.max(...drift, 0).toFixed(1)}ms  ` +
              `final ${(S2.length ? S2[S2.length - 1].d : 0)}ms  ` +
              `over ½ frame on ${drift.filter(d => d > half).length}/${drift.length} ticks`);
  console.log(`  drift-lock trims applied on ${trims.length}/${S2.length} ticks` +
              (trims.length ? `   e.g. ${JSON.stringify(trims.slice(0, 3).map(t => `${t.ms}ms A=${t.rA} B=${t.rB}`))}` : ''));
  console.log(`  DROPPED FRAMES:`);
  run.quality.forEach((q, i) => console.log(
    `    ${'AB'[i]}: ${q.dropped} dropped / ${q.total} total` +
    `${q.total ? `  (${(100 * q.dropped / q.total).toFixed(1)}%)` : ''}`));
  const marks = [200, 500, 1000, 2000, 4000, 6000];
  const at = ms => { let r = null; for (const s of S2) { if (s.ms <= ms) r = s; else break; } return r; };
  console.log(`  drift curve: ` + marks.map(m => { const s = at(m); return s ? `@${m}=${s.d}` : null; })
    .filter(Boolean).join('  '));
  console.log(`  rate curve:  ` + marks.map(m => { const s = at(m); return s ? `@${m}=${s.rA}/${s.rB}` : null; })
    .filter(Boolean).join('  '));
  // ── 3. resume smoothness ───────────────────────────────────────────────────
  // The follower is the ONLY element the drift lock trims, and it sits at the
  // trim cap for seconds after a resume. If Safari renders playbackRate != 1
  // unevenly, that alone would make the unselected clip play jerkily while the
  // selected one is fine. A/B it: same resume, drift lock on vs stubbed out.
  console.log(`\n===== 3. RESUME SMOOTHNESS (frame cadence per clip) =====`);
  async function cadence(label, disableLock) {
    const r = await exec(`return (() => new Promise(resolve => {
      const vids = [...document.querySelectorAll('.asset-layer video')];
      // Restore first so each arm starts from the shipping lock, then stub if asked.
      if (window.__savedLock) { window._driftLockTick = window.__savedLock; window.__savedLock = null; }
      if (${disableLock}) { window.__savedLock = window._driftLockTick; window._driftLockTick = function () {}; }
      try { window.pauseAllMedia(); } catch (e) {}
      // Clear any trim left over from a previous arm so the rate seen is this
      // arm's doing, and start both clips from the same instant.
      vids.forEach(v => { v.playbackRate = 1; v.currentTime = 1.0; });
      setTimeout(() => {
        const rec = vids.map(() => ({ wall: [], media: [], rate: [], _lastMt: null }));
        vids.forEach((v, i) => {
          let last = null;
          const on = (now, md) => {
            if (last !== null) {
              rec[i].wall.push(+(now - last).toFixed(2));
              rec[i].media.push(+((md.mediaTime - rec[i]._lastMt) * 1000).toFixed(2));
            }
            last = now; rec[i]._lastMt = md.mediaTime;
            rec[i].rate.push(+v.playbackRate.toFixed(3));
            v.requestVideoFrameCallback(on);   // run for the whole window, not a frame budget
          };
          v.requestVideoFrameCallback(on);
        });
        window.playAllMedia();
        // Fixed 4 s observation window regardless of how many frames land —
        // a frame budget made a stalling clip look like a short clean run.
        setTimeout(() => { try { window.pauseAllMedia(); } catch (e) {} resolve(rec); }, 4000);
      }, 500);
    }))()`);
    console.log(`\n  --- ${label} ---`);
    r.forEach((c, i) => {
      const w = c.wall.filter(x => x > 0);
      if (!w.length) { console.log(`    ${'AB'[i]}: no frames presented`); return; }
      const sorted = w.slice().sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      // A hitch = a gap more than 1.5x the median presentation interval, i.e.
      // the picture visibly held longer than one frame.
      const hitches = w.filter(x => x > med * 1.5).length;
      const rates = [...new Set(c.rate)];
      console.log(`    ${'AB'[i]}: ${w.length} frames   wall gap median ${med.toFixed(1)}ms  ` +
                  `p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms  max ${sorted[sorted.length - 1].toFixed(1)}ms`);
      // mediaTime deltas: a smooth run advances exactly one frame each time.
      // Values at 2x (skipped a frame) or 0 (same frame presented twice) are
      // what actually reads as jerk, independent of wall-clock spacing.
      const md = c.media.filter(x => x !== undefined);
      const mdSorted = md.slice().sort((a, b) => a - b);
      const mdMed = mdSorted[mdSorted.length >> 1] || 0;
      const irregular = md.filter(x => Math.abs(x - mdMed) > mdMed * 0.4).length;
      console.log(`        hitches >1.5x median: ${hitches}/${w.length}` +
                  `   frame-step irregular: ${irregular}/${md.length}` +
                  `${(hitches + irregular) > w.length * 0.08 ? '   ← JERKY' : ''}`);
      console.log(`        playbackRate seen: [${rates.slice(0, 6).join(', ')}]`);
    });
    return r;
  }
  for (let i = 1; i <= 3; i++) {
    await cadence(`run ${i}: drift lock ACTIVE (shipping)`, false);
    await cadence(`run ${i}: drift lock STUBBED (no rate trims)`, true);
  }
  await exec('if (window.__savedLock) { window._driftLockTick = window.__savedLock; window.__savedLock = null; } return 1;');

  // ── 4. hitch attribution ───────────────────────────────────────────────────
  // Where do the resume/loop-start hitches actually come from? Log every seek,
  // snap, loop wrap and drift-lock correction alongside per-frame presentation
  // cadence, then line the hitches up against the events.
  console.log(`\n===== 4. HITCH ATTRIBUTION (resume + loop wraps) =====`);
  const attr = await exec(`return (() => new Promise(resolve => {
    const vids = [...document.querySelectorAll('.asset-layer video')];
    const ev = [];
    const t0ref = { t: 0 };
    const now = () => +(performance.now() - t0ref.t).toFixed(0);
    // Instrument the seek-issuing paths.
    const origSnap = window._snapAllVideosToFrame;
    window._snapAllVideosToFrame = function () {
      const before = vids.map(v => v.currentTime);
      origSnap.apply(this, arguments);
      const after = vids.map(v => v.currentTime);
      vids.forEach((v, i) => { if (Math.abs(after[i] - before[i]) > 1e-4)
        ev.push({ t: now(), what: 'SNAP-SEEK', clip: 'AB'[i], delta: +((after[i]-before[i])*1000).toFixed(1) }); });
    };
    const origWrap = window._loopWrapToInPoint;
    if (origWrap) window._loopWrapToInPoint = function () { ev.push({ t: now(), what: 'LOOP-WRAP', clip: '-' }); return origWrap.apply(this, arguments); };
    vids.forEach((v, i) => {
      v.addEventListener('seeking', () => ev.push({ t: now(), what: 'seeking', clip: 'AB'[i] }));
      v.addEventListener('seeked',  () => ev.push({ t: now(), what: 'seeked',  clip: 'AB'[i] }));
      v.addEventListener('waiting', () => ev.push({ t: now(), what: 'WAITING(stall)', clip: 'AB'[i] }));
      v.addEventListener('ratechange', () => ev.push({ t: now(), what: 'rate=' + v.playbackRate.toFixed(3), clip: 'AB'[i] }));
    });
    try { window.pauseAllMedia(); } catch (e) {}
    // Tight loop region so wraps happen quickly and repeatedly.
    window._loopInPoint = 1.0; window._loopOutPoint = 3.0;
    if (window.updateLoopMarkerUI) window.updateLoopMarkerUI();
    if (window._applyNativeLoopPolicy) window._applyNativeLoopPolicy();
    vids.forEach(v => { v.playbackRate = 1; v.currentTime = 1.0; });
    setTimeout(() => {
      t0ref.t = performance.now();
      const frames = vids.map(() => []);
      vids.forEach((v, i) => {
        let last = null;
        const on = (n, md) => {
          if (last !== null) frames[i].push({ t: now(), gap: +(n - last).toFixed(1) });
          last = n;
          v.requestVideoFrameCallback(on);
        };
        v.requestVideoFrameCallback(on);
      });
      window.playAllMedia();
      setTimeout(() => {
        try { window.pauseAllMedia(); } catch (e) {}
        window._snapAllVideosToFrame = origSnap;
        if (origWrap) window._loopWrapToInPoint = origWrap;
        window._loopInPoint = null; window._loopOutPoint = null;
        resolve({ ev, frames, tRange: vids.map(v => v.currentTime), loopBounds: (window._getLoopBounds ? window._getLoopBounds() : null) });
      }, 8000);
    }, 500);
  }))()`);
  attr.frames.forEach((f, i) => {
    const gaps = f.map(x => x.gap).filter(x => x > 0).sort((a, b) => a - b);
    const med = gaps[gaps.length >> 1] || 0;
    const hitches = f.filter(x => x.gap > med * 1.5);
    console.log(`\n  ${'AB'[i]}: ${f.length} frames, median gap ${med.toFixed(1)}ms, ${hitches.length} hitches`);
    hitches.slice(0, 12).forEach(h => {
      const near = attr.ev.filter(e => Math.abs(e.t - h.t) < 260)
        .map(e => `${e.what}${e.clip !== '-' ? '/' + e.clip : ''}@${e.t}`);
      console.log(`      hitch @${h.t}ms gap ${h.gap}ms   nearby: [${near.join(' ') || 'nothing'}]`);
    });
  });
  const counts = {};
  attr.ev.forEach(e => { counts[e.what] = (counts[e.what] || 0) + 1; });
  console.log(`\n  event totals: ${JSON.stringify(counts)}`);
  console.log(`  loop bounds: ${JSON.stringify(attr.loopBounds)}   clocks ended at ${JSON.stringify(attr.tRange)}` +
              `${!counts['LOOP-WRAP'] ? '   <- NO WRAPS OBSERVED (loop did not engage)' : ''}`);
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  await cleanup();
}
