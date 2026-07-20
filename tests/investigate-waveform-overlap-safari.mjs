#!/usr/bin/env node
/* Waveform-panel overlap check in REAL Safari (safaridriver), the reported env.
 * Loads two clips with the panel already open (the reported trigger) and after a
 * resize-drag, and reports video-vs-panel overlap in px.
 * Usage: node tests/investigate-waveform-overlap-safari.mjs [a.mp4] [b.mp4] */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve as resolvePath } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(ROOT, 'tests', 'fixtures');
let [fa, fb] = process.argv.slice(2).map(f => f && resolvePath(f));
fa = fa || join(fx, 'qhd_a.mp4'); fb = fb || join(fx, 'qhd_b.mp4');
for (const f of [fa, fb]) if (!existsSync(f)) { console.error('Cannot read ' + f); process.exit(1); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => { try { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const fp = join(ROOT, p); if (!fp.startsWith(ROOT) || !(await stat(fp)).isFile()) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' }); res.end(await readFile(fp)); } catch { res.writeHead(404).end(); } });
const port = await new Promise(r => server.listen(0, () => r(server.address().port)));
const DP = 4611; const driver = spawn('safaridriver', ['-p', String(DP)], { stdio: 'ignore' });
const base = `http://localhost:${DP}`; const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wd(m, path, body) { const r = await fetch(base + path, { method: m, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (j.value && j.value.error) throw new Error(`${j.value.error}: ${j.value.message || ''}`.slice(0, 200)); return j.value; }
let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(base + '/status'); up = true; } catch { await sleep(250); } }
if (!up) { console.error('safaridriver not up'); process.exit(1); }
const { sessionId } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = p => `/session/${sessionId}${p}`; const exec = s => wd('POST', S('/execute/sync'), { script: s, args: [] });
const GEO = `return (() => { const panel = document.getElementById('spectrogramPanel'); const pr = panel ? panel.getBoundingClientRect() : null; const vids = [...document.querySelectorAll('.asset-layer video')].map((v,i)=>{const r=v.getBoundingClientRect();return{slot:'AB'[i],bottom:Math.round(r.bottom),h:Math.round(r.height)};}); const ov = vids.map(v => (pr && pr.height>0 ? Math.max(0, v.bottom - Math.round(pr.top)) : 0)); return { grid: isGridMode, panelH: pr?Math.round(pr.height):0, panelTop: pr?Math.round(pr.top):0, vids, overlap: Math.max(...ov, 0), active: panel?panel.classList.contains('active'):false }; })()`;
try {
  await wd('POST', S('/timeouts'), { script: 120000 });
  await wd('POST', S('/window/rect'), { x: 0, y: 0, width: 1600, height: 1050 });
  await wd('POST', S('/url'), { url: `http://localhost:${port}/` });
  const input = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  await wd('POST', S(`/element/${Object.values(input)[0]}/value`), { text: `${fa}\n${fb}` });
  for (let i = 0; i < 60; i++) { if (await exec(`return (()=>{const v=[...document.querySelectorAll('.asset-layer video')];return v.length===2&&v.every(x=>!isNaN(x.duration)&&x.videoWidth>0);})()`).catch(()=>false)) break; await sleep(500); }
  console.log('\n[safari overlap] two 2K clips, 1600x1050');
  // ensure Grid
  await exec(`if (!isGridMode) setViewMode('grid'); return 1;`); await sleep(500);
  // open panel
  await exec(`if (!audioVizVisible) toggleAudioViz(); return 1;`); await sleep(1000);
  console.log('  (toggle open, settled):', JSON.stringify(await exec(GEO)));
  // reported trigger: clear + reload WITH panel open
  await exec(`clearAllMedia(); return 1;`); await sleep(500);
  const input2 = await wd('POST', S('/element'), { using: 'css selector', value: '#multiFileInput' });
  await wd('POST', S(`/element/${Object.values(input2)[0]}/value`), { text: `${fa}\n${fb}` });
  for (let i = 0; i < 60; i++) { if (await exec(`return (()=>{const v=[...document.querySelectorAll('.asset-layer video')];return v.length===2&&v.every(x=>!isNaN(x.duration)&&x.videoWidth>0);})()`).catch(()=>false)) break; await sleep(500); }
  await sleep(300);
  console.log('  (load WITH panel open, +300ms):', JSON.stringify(await exec(GEO)));
  await sleep(1200);
  console.log('  (load WITH panel open, settled): ', JSON.stringify(await exec(GEO)));
} catch (e) { console.error('[error]', e.message); } finally { try { await wd('DELETE', S('')); } catch {} driver.kill(); server.close(); }
