#!/usr/bin/env node
/*
 * HOW does Safari's ~130ms startup offset form?
 *
 * The follower's judder was traced to the drift lock trimming flat-out because
 * the pair comes up ~3 frames apart (tests/investigate-safari-successive.mjs).
 * This looks at the moment of play() at rAF resolution to find the mechanism:
 * does one element start advancing late, does one jump, or do both start
 * together and diverge?
 *
 * Per cycle it reports, for each clip:
 *   - when its clock first advances after play() (the start latency)
 *   - its readyState at play() time
 *   - when its play() promise resolves and when 'playing' fires
 *   - the A/B offset over the first second
 *
 * Usage: node tests/investigate-safari-startup.mjs <clipA> <clipB>
 * Env:   CYCLES=5
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve as resolvePath } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [fileA, fileB] = process.argv.slice(2).map(f => f && resolvePath(f));
if (!fileA || !fileB) { console.error('Usage: node tests/investigate-safari-startup.mjs <a.mp4> <b.mp4>'); process.exit(1); }
for (const f of [fileA, fileB]) { try { await stat(f); } catch { console.error(`Cannot read: ${f}`); process.exit(1); } }
const CYCLES = +(process.env.CYCLES || 5);
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

const DRIVER_PORT = 4607;
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
  await exec('window.playAllMedia(); return 1;');
  await sleep(3000);
  await exec('window.pauseAllMedia(); return 1;');
  await sleep(400);
  console.log(`\n[startup] ${basename(fileA)} + ${basename(fileB)}   ${CYCLES} cycles\n`);

  for (let c = 1; c <= CYCLES; c++) {
    const r = await execAsync(`
      const done = arguments[arguments.length - 1];
      const vids = [...document.querySelectorAll('.asset-layer video')];
      vids.forEach(v => { v.currentTime = 1.0; });
      setTimeout(() => {
        const ev = [];
        const t0ref = {};
        const mark = (what, i) => ev.push({ what, clip: 'AB'[i], at: +(performance.now() - t0ref.t).toFixed(1) });
        const onPlaying = [];
        vids.forEach((v, i) => {
          const h = () => mark('playing', i);
          v.addEventListener('playing', h, { once: true });
          onPlaying.push(h);
        });
        const start = vids.map(v => v.currentTime);
        const rs0 = vids.map(v => v.readyState);
        const samples = [];
        // Presented-frame track: RVFC gives (wall now, mediaTime) per presented
        // frame — the actual content on screen, independent of currentTime's
        // read granularity. If currentTime says 100ms apart while the presented
        // frames say ~0, the drift signal is noise, not real desync.
        const pres = [[], []];
        vids.forEach((v, i) => {
          const on = (now, md) => { pres[i].push({ w: now, mt: md.mediaTime }); v.requestVideoFrameCallback(on); };
          v.requestVideoFrameCallback(on);
        });
        t0ref.t = performance.now();
        // Patch play() so each element's own call time and promise resolution
        // are visible — playAllMedia calls them in a loop, and the question is
        // whether the gap opens before or after those calls.
        vids.forEach((v, i) => {
          const p = v.play();
          mark('play()called', i);
          if (p && p.then) p.then(() => mark('play()resolved', i)).catch(() => mark('play()rejected', i));
        });
        window.startProgressUpdateLoop && window.startProgressUpdateLoop();
        const tick = () => {
          const ms = performance.now() - t0ref.t;
          samples.push({ ms: +ms.toFixed(1), a: vids[0].currentTime, b: vids[1].currentTime,
                         ra: vids[0].readyState, rb: vids[1].readyState });
          if (ms < 1000) requestAnimationFrame(tick);
          else {
            try { window.pauseAllMedia(); } catch (e) {}
            done({ samples, ev, start, rs0, pres });
          }
        };
        requestAnimationFrame(tick);
      }, 600);`);

    // When did each clock first move past its starting value?
    const firstMove = i => {
      const key = i === 0 ? 'a' : 'b';
      const s0 = r.start[i];
      const hit = r.samples.find(s => s[key] > s0 + 0.004);
      return hit ? hit.ms : null;
    };
    const mvA = firstMove(0), mvB = firstMove(1);
    const last = r.samples[r.samples.length - 1];
    const offsetEnd = ((last.b - last.a) * 1000);
    const maxOff = Math.max(...r.samples.map(s => Math.abs((s.b - s.a) * 1000)));
    console.log(`  cycle ${c}:  readyState at play A=${r.rs0[0]} B=${r.rs0[1]}`);
    console.log(`     first clock movement:  A @${mvA === null ? 'never' : mvA + 'ms'}   ` +
                `B @${mvB === null ? 'never' : mvB + 'ms'}   ` +
                `stagger ${mvA !== null && mvB !== null ? Math.abs(mvB - mvA).toFixed(0) + 'ms' : '?'}`);
    console.log(`     A/B offset:  peak ${maxOff.toFixed(1)}ms   at 1s ${offsetEnd.toFixed(1)}ms`);
    const evs = r.ev.filter(e => /playing|resolved|rejected/.test(e.what))
      .map(e => `${e.what}/${e.clip}@${e.at}ms`).join('  ');
    console.log(`     events: ${evs || '(none)'}`);
    // Offset trace over the first 500ms
    const marks = [0, 50, 100, 150, 200, 300, 400, 600, 800, 1000];
    const at = ms => { let r2 = null; for (const s of r.samples) { if (s.ms <= ms) r2 = s; else break; } return r2; };
    console.log(`     offset trace: ` + marks.map(m => {
      const s = at(m); return s ? `@${m}=${((s.b - s.a) * 1000).toFixed(0)}` : null;
    }).filter(Boolean).join(' '));
    // True presented-content offset: for each of A's presented frames, find
    // B's presented frame nearest in wall time and compare their mediaTimes.
    const [pa, pb] = r.pres;
    if (pa.length > 5 && pb.length > 5) {
      const offs = [];
      for (const fa of pa) {
        let best = null, bd = 1e9;
        for (const fb of pb) { const d = Math.abs(fb.w - fa.w); if (d < bd) { bd = d; best = fb; } }
        if (best && bd < 30) offs.push((best.mt - fa.mt) * 1000);
      }
      if (offs.length) {
        const so = offs.slice().sort((a, b) => a - b);
        console.log(`     PRESENTED-frame offset (RVFC): median ${so[so.length >> 1].toFixed(1)}ms  ` +
                    `p90 ${so[Math.floor(so.length * 0.9)].toFixed(1)}ms  ` +
                    `range ${so[0].toFixed(0)}..${so[so.length - 1].toFixed(0)}ms  (n=${offs.length})`);
      }
    }
    console.log('');
  }
} catch (e) {
  console.error('\n[error]', e.message);
} finally {
  try { await wd('DELETE', S('')); } catch {}
  driver.kill();
  server.close();
}
