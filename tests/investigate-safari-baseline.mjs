#!/usr/bin/env node
/*
 * CONTROL: is Safari's resume hitching caused by WarpDiff, or by Safari?
 *
 * Serves a bare page — two <video> elements, a play() call, nothing else. No
 * drift lock, no pause snap, no loop enforcement, no overlays, no app code at
 * all. Measures the same frame-presentation cadence the app harness measures.
 *
 * Read it as:
 *   bare page hitches too  → Safari can't start two decodes smoothly; there is
 *                            no app-level fix and we should stop changing the
 *                            sync logic.
 *   bare page is smooth    → something WarpDiff does is responsible, and the
 *                            app harness (investigate-safari.mjs section 4)
 *                            can be used to find which.
 *
 * Also runs a ONE-video arm, to separate "two simultaneous decodes" from
 * "decoding this file at all".
 *
 * Usage: node tests/investigate-safari-baseline.mjs <clipA> <clipB>
 * Env:   SECS=5
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, resolve as resolvePath } from 'node:path';

const [fileA, fileB] = process.argv.slice(2).map(f => resolvePath(f));
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-safari-baseline.mjs <a.mp4> <b.mp4>'); process.exit(1); }
const SECS = +(process.env.SECS || 5);
for (const f of [fileA, fileB]) {
  try { await stat(f); } catch {
    console.error(`Cannot read: ${f}\n` +
      `Run this FROM the repo and pass real paths, e.g.\n` +
      `  cd /path/to/warpdiff && node tests/investigate-safari-baseline.mjs ~/Downloads/"a (1).mp4" ~/Downloads/"b (1).mp4"`);
    process.exit(1);
  }
}

const PAGE = (n) => `<!doctype html><meta charset=utf-8>
<style>body{margin:0;background:#111;display:flex;gap:4px}video{width:${n === 1 ? 100 : 49}vw}</style>
<video id=a src="/a.mp4" muted playsinline></video>
${n === 2 ? '<video id=b src="/b.mp4" muted playsinline></video>' : ''}
<script>
window.__vids = [...document.querySelectorAll('video')];
window.__ready = () => window.__vids.every(v => v.readyState >= 2);
// Deliberately naive: play both, measure. No syncing of any kind.
// Native loop wrap: one element, browser-owned looping, nothing else running.
window.__runLoop = (ms) => new Promise(res => {
  const v = window.__vids[0];
  v.loop = true;
  v.pause();
  v.currentTime = Math.max(0, v.duration - 1.2);
  setTimeout(() => {
    const gaps = [], marks = [];
    let last = null, lastMt = null;
    const on = (now, md) => {
      if (last !== null) {
        gaps.push(+(now - last).toFixed(1));
        // A wrap shows up as mediaTime jumping backwards.
        if (lastMt !== null && md.mediaTime < lastMt) marks.push(gaps.length - 1);
      }
      last = now; lastMt = md.mediaTime;
      v.requestVideoFrameCallback(on);
    };
    v.requestVideoFrameCallback(on);
    v.play().catch(() => {});
    setTimeout(() => { v.pause(); v.loop = false; res({ gaps, marks }); }, ms);
  }, 500);
});
window.__run = (ms) => new Promise(res => {
  const vids = window.__vids;
  vids.forEach(v => { v.pause(); v.currentTime = 1.0; });
  setTimeout(() => {
    const rec = vids.map(() => []);
    vids.forEach((v, i) => {
      let last = null;
      const on = (now, md) => {
        if (last !== null) rec[i].push(+(now - last).toFixed(1));
        last = now;
        v.requestVideoFrameCallback(on);
      };
      v.requestVideoFrameCallback(on);
    });
    vids.forEach(v => v.play().catch(() => {}));
    setTimeout(() => { vids.forEach(v => v.pause()); res(rec); }, ms);
  }, 500);
});
</script>`;

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/one' || url === '/two') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE(url === '/one' ? 1 : 2));
      return;
    }
    const fp = url === '/a.mp4' ? fileA : url === '/b.mp4' ? fileB : null;
    if (!fp) { res.writeHead(404).end(); return; }
    const st = await stat(fp);
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': st.size });
    res.end(await readFile(fp));
  } catch { res.writeHead(404).end(); }
});
const port = await new Promise(r => server.listen(0, () => r(server.address().port)));

const DRIVER_PORT = 4601;
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
const exec = (script) => wd('POST', S('/execute/sync'), { script, args: [] });
const execAsync = (script) => wd('POST', S('/execute/async'), { script, args: [] });

function report(label, rec) {
  console.log(`\n  --- ${label} ---`);
  rec.forEach((gaps, i) => {
    const g = gaps.filter(x => x > 0);
    if (!g.length) { console.log(`    ${'AB'[i]}: no frames presented`); return; }
    const s = g.slice().sort((a, b) => a - b);
    const med = s[s.length >> 1];
    const hitches = g.filter(x => x > med * 1.5);
    // Where do the hitches fall? Early = start-up contention.
    const firstQuarter = hitches.filter(x => g.indexOf(x) < g.length / 4).length;
    console.log(`    ${'AB'[i]}: ${g.length} frames  median ${med.toFixed(1)}ms  ` +
                `p95 ${s[Math.floor(s.length * 0.95)].toFixed(1)}ms  max ${s[s.length - 1].toFixed(1)}ms`);
    console.log(`        hitches >1.5x median: ${hitches.length}/${g.length}` +
                `${hitches.length ? `   (${firstQuarter} in the first quarter of the run)` : ''}` +
                `${hitches.length > g.length * 0.05 ? '   ← HITCHY' : ''}`);
  });
}

try {
  console.log(`\n[control] bare two-<video> page, NO WarpDiff code`);
  console.log(`[control] ${basename(fileA)} + ${basename(fileB)}`);

  for (const [label, path] of [['TWO videos (bare page)', '/two'], ['ONE video (bare page)', '/one']]) {
    await wd('POST', S('/url'), { url: `http://localhost:${port}${path}` });
    for (let i = 0; i < 60; i++) {
      if (await exec('return window.__ready && window.__ready()')) break;
      await sleep(500);
    }
    await wd('POST', S('/timeouts'), { script: 60000 });
    const rec = await execAsync(
      `const done = arguments[arguments.length - 1]; window.__run(${SECS * 1000}).then(done);`);
    report(label, rec);
  }
  // Native-loop arm — the newly reported symptom: one video, freeze at wrap.
  await wd('POST', S('/url'), { url: `http://localhost:${port}/one` });
  for (let i = 0; i < 60; i++) {
    if (await exec('return window.__ready && window.__ready() && window.__vids[0].duration > 0')) break;
    await sleep(500);
  }
  const lp = await execAsync(
    `const done = arguments[arguments.length - 1]; window.__runLoop(${SECS * 1000}).then(done);`);
  const g = lp.gaps.filter(x => x > 0);
  const srt = g.slice().sort((a, b) => a - b);
  const med = srt[srt.length >> 1] || 0;
  console.log(`\n  --- ONE video, NATIVE loop (bare page) ---`);
  console.log(`    ${g.length} frames  median ${med.toFixed(1)}ms  max ${srt[srt.length - 1].toFixed(1)}ms` +
              `   wraps observed: ${lp.marks.length}`);
  lp.marks.forEach(i => {
    const around = g.slice(Math.max(0, i - 2), i + 4).map((x, k) =>
      `${k + Math.max(0, i - 2) === i ? '[' : ''}${x}${k + Math.max(0, i - 2) === i ? ']' : ''}`).join(' ');
    console.log(`      wrap gap ${g[i]}ms (${(g[i] / med).toFixed(1)}x median)   around: ${around}`);
  });
  if (!lp.marks.length) console.log(`      (no wrap seen — clip may be too long for the ${SECS}s window)`);
  console.log(`\n  Compare with the app's numbers from investigate-safari.mjs section 3.`);
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
