#!/usr/bin/env node
/*
 * A/B: does WarpDiff freeze at the loop wrap where a bare page doesn't?
 *
 * Same clip, ONE video, native loop, measured across the wrap — first in a bare
 * page (no app code), then in WarpDiff. With a single video the drift lock, the
 * pause snap and the RVFC loop chain are all inactive (videos.length < 2 and
 * _getLoopBounds() → null → native .loop), so in principle the app should wrap
 * exactly like the bare page. If it doesn't, whatever WarpDiff runs per frame is
 * the cause, and the event log says what fired near the freeze.
 *
 * Usage: node tests/investigate-safari-loop.mjs <clip>
 * Env:   SECS=8
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve as resolvePath } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clip = process.argv[2] && resolvePath(process.argv[2]);
if (!clip) { console.error('Usage: node tests/investigate-safari-loop.mjs <clip.mp4>'); process.exit(1); }
try { await stat(clip); } catch { console.error(`Cannot read: ${clip}`); process.exit(1); }
const SECS = +(process.env.SECS || 8);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

// Measures cadence across a native loop wrap. Shared by both arms so the two
// numbers are directly comparable.
const PROBE = `
window.__loopProbe = (ms, v) => new Promise(res => {
  const keepMuted = v.muted;
  v.loop = true;
  v.pause();
  v.muted = keepMuted;
  v.currentTime = Math.max(0, v.duration - 1.2);
  setTimeout(() => {
    const gaps = [], marks = [];
    let last = null, lastMt = null;
    const on = (now, md) => {
      if (last !== null) {
        gaps.push(+(now - last).toFixed(1));
        if (lastMt !== null && md.mediaTime < lastMt) marks.push(gaps.length - 1);
      }
      last = now; lastMt = md.mediaTime;
      v.requestVideoFrameCallback(on);
    };
    v.requestVideoFrameCallback(on);
    v.play().catch(() => {});
    setTimeout(() => { v.pause(); res({ gaps, marks, ev: window.__ev || [] }); }, ms);
  }, 600);
});`;

const BARE = `<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#111}video{width:100vw}</style>
<video id=a src="/__clip.mp4" muted playsinline></video>
<script>${PROBE}
window.__ready = () => document.querySelector('video').readyState >= 2 && document.querySelector('video').duration > 0;
window.__go = (ms) => window.__loopProbe(ms, document.querySelector('video'));
</script>`;

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/__bare') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(BARE); return; }
    if (url === '/__clip.mp4') {
      const st = await stat(clip);
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': st.size });
      res.end(await readFile(clip)); return;
    }
    const fp = join(ROOT, url === '/' ? '/index.html' : url);
    if (!fp.startsWith(ROOT) || !(await stat(fp)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch { res.writeHead(404).end(); }
});
const port = await new Promise(r => server.listen(0, () => r(server.address().port)));

const DRIVER_PORT = 4603;
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

function report(label, r) {
  const g = r.gaps.filter(x => x > 0);
  if (!g.length) { console.log(`\n  --- ${label} ---\n    no frames presented`); return; }
  const s = g.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const freezes = g.filter(x => x > med * 1.5).length;
  console.log(`\n  --- ${label} ---`);
  console.log(`    ${g.length} frames  median ${med.toFixed(1)}ms  max ${s[s.length - 1].toFixed(1)}ms  ` +
              `freezes >1.5x: ${freezes}/${g.length}   wraps: ${r.marks.length}`);
  r.marks.forEach(i => {
    const win = g.slice(Math.max(0, i - 3), i + 5)
      .map((x, k) => (k + Math.max(0, i - 3) === i ? `[${x}]` : `${x}`)).join(' ');
    const mult = (g[i] / med).toFixed(1);
    console.log(`      WRAP gap ${g[i]}ms = ${mult}x median${g[i] > med * 1.5 ? '   ← FREEZE' : '   (clean)'}`);
    console.log(`        gaps around wrap: ${win}`);
    if (r.ev && r.ev.length) {
      const near = r.ev.filter(e => e.i >= i - 3 && e.i <= i + 5).map(e => e.what);
      if (near.length) console.log(`        app work near wrap: ${[...new Set(near)].join(', ')}`);
    }
  });
}

try {
  await wd('POST', S('/timeouts'), { script: 120000 });
  console.log(`\n[loop A/B] ${basename(clip)}   one video, native loop, ${SECS}s window`);

  // ── arm 1: bare page ───────────────────────────────────────────────────────
  await wd('POST', S('/url'), { url: `http://localhost:${port}/__bare` });
  for (let i = 0; i < 60; i++) { if (await exec('return window.__ready && window.__ready()')) break; await sleep(500); }
  report('BARE PAGE, muted (no WarpDiff)', await execAsync(
    `const d = arguments[arguments.length-1];
     const v = document.querySelector('video'); v.muted = true;
     window.__loopProbe(${SECS * 1000}, v).then(d);`));
  // The decisive control: same bare page, audio ON. If this freezes too, the
  // wrap stall is Safari restarting audio at a loop boundary — nothing WarpDiff
  // does — and no app change can remove it.
  report('BARE PAGE, UNMUTED (no WarpDiff)', await execAsync(
    `const d = arguments[arguments.length-1];
     const v = document.querySelector('video');
     // Autoplay policy blocks an unmuted play() without a gesture, so start
     // muted and unmute once it is actually running — the element is then a
     // genuinely unmuted, playing, looping video, which is what we need to test.
     v.muted = true; v.loop = true; v.currentTime = 0;
     v.play().then(() => {
       v.muted = false; v.volume = 1;
       setTimeout(() => window.__loopProbe(${SECS * 1000}, v).then(r => { r.wasMuted = v.muted; d(r); }), 300);
     }).catch(e => d({ gaps: [], marks: [], err: String(e) }));`));

  // ── arm 2: WarpDiff, same clip, one video ──────────────────────────────────
  await wd('POST', S('/url'), { url: `http://localhost:${port}/` });
  const input = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  await wd('POST', S(`/element/${Object.values(input)[0]}/value`), { text: clip });
  for (let i = 0; i < 90; i++) {
    if (await exec(`return (() => { const v = document.querySelector('.asset-layer video');
      return !!v && !isNaN(v.duration) && v.duration > 0 && v.readyState >= 2; })()`).catch(() => false)) break;
    await sleep(500);
  }
  // Log what the app runs per frame, so a freeze can be attributed.
  // Time every rAF callback and media event so a stall can be attributed to the
  // app work that caused it, rather than guessed at.
  await exec(`${PROBE}
    window.__ev = [];
    window.__slow = [];
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return origRaf(function (t) {
        const t0 = performance.now();
        try { cb(t); } finally {
          const d = performance.now() - t0;
          if (d > 5) window.__slow.push({ kind: 'rAF', ms: +d.toFixed(1), at: +performance.now().toFixed(0) });
        }
      });
    };
    const v = document.querySelector('.asset-layer video');
    ['seeking','seeked','waiting','stalled','ended','ratechange','play','pause','timeupdate'].forEach(t =>
      v.addEventListener(t, () => {
        const t0 = performance.now();
        window.__ev.push({ what: t, at: +t0.toFixed(0) });
        // measure how long the app's own handlers for this event take
        setTimeout(() => {}, 0);
      }, true));
    return 1;`);
  const appInfo = await exec(`return (() => {
    const v = document.querySelector('.asset-layer video');
    return { loopFlag: v.loop, bounds: (window._getLoopBounds ? window._getLoopBounds() : 'n/a'),
             nVideos: document.querySelectorAll('.asset-layer video').length,
             muted: v.muted, volume: v.volume };
  })()`);
  console.log(`\n  [app state] videos=${appInfo.nVideos}  native .loop=${appInfo.loopFlag}  ` +
              `_getLoopBounds()=${JSON.stringify(appInfo.bounds)}  muted=${appInfo.muted} volume=${appInfo.volume}`);
  const appRes = await execAsync(
    `const d = arguments[arguments.length-1];
     window.__go = (ms) => window.__loopProbe(ms, document.querySelector('.asset-layer video'));
     window.__go(${SECS * 1000}).then(r => { r.slow = window.__slow; r.evAt = window.__ev; d(r); });`);
  report('WARPDIFF (same clip)', appRes);
  const slow = (appRes.slow || []).sort((a, b) => b.ms - a.ms);
  console.log(`\n  slow rAF callbacks (>5ms): ${slow.length}`);
  slow.slice(0, 8).forEach(x => console.log(`      ${x.ms}ms at t=${x.at}`));
  const evc = {};
  (appRes.evAt || []).forEach(e => { evc[e.what] = (evc[e.what] || 0) + 1; });
  console.log(`  media events during run: ${JSON.stringify(evc)}`);

  // ── arm 3: WarpDiff with the per-frame progress loop stopped ───────────────
  // Same page, same DOM, same CSS — only the app's rAF work is removed. If the
  // stall survives this it is the page's structure/compositing, not the script.
  const arm3 = await execAsync(
    `const d = arguments[arguments.length-1];
     if (window.globalAnimationId != null) { cancelAnimationFrame(window.globalAnimationId); }
     const origStart = window.startProgressUpdateLoop;
     window.startProgressUpdateLoop = function () {};
     window.__go(${SECS * 1000}).then(r => { window.startProgressUpdateLoop = origStart; d(r); });`);
  report('WARPDIFF, progress rAF loop DISABLED', arm3);

  // ── arm 4: WarpDiff with the video hoisted out of the app's DOM ────────────
  // Reparent the same <video> element to a bare body. Same element, same
  // decoder, none of the app's wrapper/CSS/compositing around it.
  const arm4 = await execAsync(
    `const d = arguments[arguments.length-1];
     const v = document.querySelector('.asset-layer video');
     const holder = document.createElement('div');
     holder.setAttribute('style','position:fixed;inset:0;background:#111;z-index:99999');
     const plain = document.createElement('video');
     plain.src = v.src; plain.muted = true; plain.playsInline = true;
     plain.setAttribute('style','width:100vw');
     holder.appendChild(plain); document.body.appendChild(holder);
     const ready = () => plain.readyState >= 2 && plain.duration > 0;
     const wait = () => ready() ? start() : setTimeout(wait, 200);
     const start = () => window.__loopProbe(${SECS * 1000}, plain).then(r => { holder.remove(); d(r); });
     wait();`);
  report('BARE <video> inside the app page (same DOM, plain element)', arm4);

  // Which compositing-relevant styles differ on the app's video vs a plain one?
  const styles = await exec(`return (() => {
    const props = ['filter','transform','clipPath','mixBlendMode','opacity','willChange',
                   'backdropFilter','isolation','maskImage','objectFit','position','zIndex',
                   'borderRadius','overflow','contain','backfaceVisibility','perspective'];
    const out = [];
    let el = document.querySelector('.asset-layer video');
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const interesting = {};
      props.forEach(p => {
        const v = cs[p];
        if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '1' &&
            v !== 'visible' && v !== 'static' && v !== '0px' && v !== 'fill') interesting[p] = v;
      });
      out.push({ tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
                 styles: interesting });
      el = el.parentElement;
    }
    return out;
  })()`);
  console.log(`\n  compositing-relevant styles on the app's video and ancestors:`);
  styles.forEach(s2 => {
    const keys = Object.keys(s2.styles);
    if (keys.length) console.log(`      ${s2.tag.padEnd(28)} ${JSON.stringify(s2.styles)}`);
  });

  // ── bisect the app video's own styling ────────────────────────────────────
  // Same element, same decoder, same page — one style neutralised per arm.
  const variants = [
    ['MUTED (app video normally has audio)', "v.muted = true"],
    ['unmuted (control for the above)',      "v.muted = false"],
  ];
  for (const [label, mutate] of variants) {
    const r = await execAsync(
      `const d = arguments[arguments.length-1];
       const v = document.querySelector('.asset-layer video');
       const snap = { muted: v.muted };
       ${mutate};
       window.__loopProbe(${SECS * 1000}, v).then(res => {
         v.muted = snap.muted;
         d(res);
       });`);
    report(`APP VIDEO, ${label}`, r);
  }
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
