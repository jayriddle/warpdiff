#!/usr/bin/env node
/*
 * Does the audio-viz panel overlap the video when two clips are loaded?
 *
 * Measures, for each combination of view mode (Grid / Stack) and panel state
 * (closed / open), the video rects vs the panel rect, and reports the overlap
 * in px. Also samples DURING the 300 ms max-height transition, since the panel
 * lives inside #videoControls and layout reads controlsEl.offsetHeight — a
 * mid-transition read under-reports the final height.
 *
 * Usage: node tests/investigate-waveform-overlap.mjs [clipA] [clipB]
 * Env:   PW_HEADLESS=1  VIEWPORT=1600x1000
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename, resolve as resolvePath } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(ROOT, 'tests', 'fixtures');
let [fileA, fileB] = process.argv.slice(2).map(f => f && resolvePath(f));
if (!fileA) fileA = join(fx, 'qhd_a.mp4');
if (!fileB) fileB = join(fx, 'qhd_b.mp4');
for (const f of [fileA, fileB]) if (!existsSync(f)) { console.error(`Cannot read: ${f}`); process.exit(1); }
const [VW, VH] = (process.env.VIEWPORT || '1600x1000').split('x').map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

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

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome',
  headless: process.env.PW_HEADLESS === '1', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}`);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 30000 });
await page.waitForFunction(() => {
  const v = [...document.querySelectorAll('.asset-layer video')];
  return v.length === 2 && v.every(x => !isNaN(x.duration) && x.videoWidth > 0);
}, {}, { timeout: 20000 });

const GEO = `(() => {
  const panel = document.getElementById('spectrogramPanel');
  const controls = document.getElementById('videoControls');
  const pr = panel ? panel.getBoundingClientRect() : null;
  const vids = [...document.querySelectorAll('.asset-layer video')].map((v, i) => {
    const r = v.getBoundingClientRect();
    return { slot: 'AB'[i], top: Math.round(r.top), bottom: Math.round(r.bottom),
             h: Math.round(r.height), w: Math.round(r.width) };
  });
  return {
    grid: typeof isGridMode !== 'undefined' && isGridMode,
    bodyClass: document.body.className,
    panelActive: panel ? panel.classList.contains('active') : null,
    panel: pr ? { top: Math.round(pr.top), bottom: Math.round(pr.bottom), h: Math.round(pr.height) } : null,
    controlsH: controls ? Math.round(controls.getBoundingClientRect().height) : null,
    controlsActive: controls ? controls.classList.contains('active') : null,
    vids,
    zoom: typeof zoomLevel !== 'undefined' ? +zoomLevel.toFixed(3) : null,
    fitZoom: typeof fitZoom !== 'undefined' ? +fitZoom.toFixed(3) : null,
    innerH: innerHeight,
  };
})()`;

function report(label, g) {
  const p = g.panel;
  console.log(`\n  --- ${label} ---`);
  console.log(`    mode=${g.grid ? 'Grid' : 'Stack'}  panelActive=${g.panelActive}  ` +
              `panel h=${p ? p.h : '?'} (top ${p ? p.top : '?'})  controlsH=${g.controlsH}  ` +
              `zoom=${g.zoom}/fit=${g.fitZoom}`);
  for (const v of g.vids) {
    const ov = p && p.h > 0 ? Math.max(0, v.bottom - p.top) : 0;
    console.log(`    video ${v.slot}: top=${v.top} bottom=${v.bottom} (h=${v.h})` +
                (ov > 0 ? `   OVERLAPS panel by ${ov}px` : `   clear`));
  }
  return g.vids.map(v => (p && p.h > 0 ? Math.max(0, v.bottom - p.top) : 0));
}

async function setMode(grid) {
  await page.evaluate((g) => { if (isGridMode !== g) setViewMode(g ? 'grid' : 'overlay'); }, grid);
  await page.waitForTimeout(500);
}
async function setPanel(on) {
  const isOn = await page.evaluate(() => audioVizVisible);
  if (isOn !== on) await page.evaluate(() => toggleAudioViz());
  await page.waitForTimeout(700);           // past the 300ms transition + 350ms redraw
}

console.log(`\n[overlap] ${basename(fileA)} + ${basename(fileB)}   viewport ${VW}x${VH}`);
const results = {};
for (const grid of [true, false]) {
  const modeName = grid ? 'Grid' : 'Stack';
  await setPanel(false); await setMode(grid);
  results[`${modeName} panel CLOSED`] = report(`${modeName}, panel closed`, await page.evaluate(GEO));
  await setPanel(true);
  results[`${modeName} panel OPEN`] = report(`${modeName}, panel open (settled)`, await page.evaluate(GEO));

  // Sample mid-transition: the panel is inside #videoControls, so a layout that
  // reads controlsEl.offsetHeight while max-height is still animating sees a
  // smaller height than the final one.
  await setPanel(false);
  await page.evaluate(() => toggleAudioViz());
  await page.waitForTimeout(120);
  report(`${modeName}, 120ms into the open transition`, await page.evaluate(GEO));
  await page.waitForTimeout(900);
  report(`${modeName}, after transition settles`, await page.evaluate(GEO));
  await setPanel(false);
}

// ── matrix: the settled case is clean, so vary what the first pass didn't ──
// The zoom clamp in toggleAudioViz that exists so "the panel doesn't overlap
// the video" is gated `if (!isGridMode)`, i.e. Stack only. Grid is what two
// clips default to. Test zoomed states, and viewport/orientation variants.
console.log('\n===== MATRIX =====');
const worst = [];
for (const grid of [true, false]) {
  for (const zoomMul of [1, 1.5, 2.5]) {
    await setPanel(false);
    await setMode(grid);
    await page.evaluate((m) => {
      // Zoom relative to fit, the way +/- does.
      zoomLevel = fitZoom * m;
      if (typeof applyZoom === 'function') applyZoom();
    }, zoomMul);
    await page.waitForTimeout(350);
    const pre = await page.evaluate(GEO);
    await setPanel(true);
    const g = await page.evaluate(GEO);
    const p = g.panel;
    const ov = Math.max(...g.vids.map(v => (p && p.h > 0 ? Math.max(0, v.bottom - p.top) : 0)), 0);
    console.log(`  ${grid ? 'Grid ' : 'Stack'}  zoom ${zoomMul}x fit  ` +
                `(pre-open zoom ${pre.zoom}/fit ${pre.fitZoom} -> post ${g.zoom})  ` +
                `overlap ${ov}px${ov > 2 ? '   <-- OVERLAP' : ''}`);
    if (ov > 2) worst.push({ mode: grid ? 'Grid' : 'Stack', zoomMul, ov });
    await setPanel(false);
  }
}
await page.evaluate(() => { zoomLevel = fitZoom; if (typeof applyZoom === 'function') applyZoom(); });

console.log('\n===== VIEWPORT / ORIENTATION =====');
for (const [w, h] of [[1600, 1000], [1400, 780], [1200, 700], [1800, 1400]]) {
  await ctx.pages()[0].setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await setPanel(false); await setMode(true);
  await page.evaluate(() => { zoomLevel = fitZoom; if (typeof applyZoom === 'function') applyZoom(); });
  await page.waitForTimeout(300);
  await setPanel(true);
  const g = await page.evaluate(GEO);
  const p = g.panel;
  const ov = Math.max(...g.vids.map(v => (p && p.h > 0 ? Math.max(0, v.bottom - p.top) : 0)), 0);
  console.log(`  ${w}x${h} Grid: panel h=${p.h} top=${p.top}  ` +
              `videos bottom=${g.vids.map(v => v.bottom).join('/')}  overlap ${ov}px${ov > 2 ? '   <-- OVERLAP' : ''}`);
  if (ov > 2) worst.push({ viewport: `${w}x${h}`, ov });
  await setPanel(false);
}
await ctx.pages()[0].setViewportSize({ width: VW, height: VH });
console.log(`\n  matrix overlaps: ${worst.length ? JSON.stringify(worst) : 'none'}`);

// ── UNTESTED PATHS: resize-drag, window-resize-while-open, load-with-panel-open ──
console.log('\n===== UNTESTED TRIGGER PATHS (Grid, two clips) =====');
const ovOf = g => { const p = g.panel; return Math.max(...g.vids.map(v => (p && p.h > 0 ? Math.max(0, v.bottom - p.top) : 0)), 0); };

// (1) Drag the panel resize handle TALLER (onMove has no video relayout).
await setMode(true); await setPanel(true);
const handle = await page.$('#audioVizResizeHandle');
if (handle) {
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // drag UP (grow the panel) in steps, sampling mid-drag
  let midOv = 0;
  for (let dy = 20; dy <= 200; dy += 40) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - dy);
    await page.waitForTimeout(60);
    midOv = Math.max(midOv, ovOf(await page.evaluate(GEO)));
  }
  console.log(`  (1) DURING resize-taller drag: max overlap ${midOv}px${midOv > 2 ? '   <-- OVERLAP (onMove never relayouts video)' : ''}`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  console.log(`      after mouseup (onUp relayouts): overlap ${ovOf(await page.evaluate(GEO))}px`);
}

// (2) Resize the WINDOW while the panel is open.
await setPanel(true); await setMode(true);
for (const [w, h] of [[1600, 1000], [1500, 760], [1700, 900]]) {
  await ctx.pages()[0].setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  const ov = ovOf(await page.evaluate(GEO));
  console.log(`  (2) after window resize to ${w}x${h} (panel open): overlap ${ov}px${ov > 2 ? '   <-- OVERLAP' : ''}`);
}
await ctx.pages()[0].setViewportSize({ width: VW, height: VH });
await page.waitForTimeout(300);

// (3) Panel open, then clear + reload the two clips (load-time layout with panel active).
await setPanel(true); await setMode(true);
await page.evaluate(() => { if (typeof clearAllMedia === 'function') clearAllMedia(); });
await page.waitForTimeout(400);
await page.locator('#multiFileInput').setInputFiles([fileA, fileB]);
await page.waitForFunction(() => {
  const v = [...document.querySelectorAll('.asset-layer video')];
  return v.length === 2 && v.every(x => !isNaN(x.duration) && x.videoWidth > 0);
}, {}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);
let ld = ovOf(await page.evaluate(GEO));
console.log(`  (3) two clips loaded WITH panel already open: overlap ${ld}px${ld > 2 ? '   <-- OVERLAP' : ''}`);
await page.waitForTimeout(800);
ld = ovOf(await page.evaluate(GEO));
console.log(`      after settle: overlap ${ld}px${ld > 2 ? '   <-- OVERLAP' : ''}`);

// Does a manual relayout after settling fix it? (i.e. is it a stale-layout race
// rather than a missing term in the height budget?)
await setMode(true);
await setPanel(true);
const before = await page.evaluate(GEO);
await page.evaluate(() => { if (typeof applyZoom === 'function') applyZoom();
                            if (typeof positionLabelsToMedia === 'function') positionLabelsToMedia(); });
await page.waitForTimeout(400);
const after = await page.evaluate(GEO);
console.log('\n===== does a forced relayout clear it? =====');
report('Grid, panel open, BEFORE forced relayout', before);
report('Grid, panel open, AFTER forced relayout', after);

console.log('\n===== READING =====');
const gridOpen = results['Grid panel OPEN'] || [];
const stackOpen = results['Stack panel OPEN'] || [];
console.log(`  Grid  overlap when open: ${gridOpen.join(' / ')} px`);
console.log(`  Stack overlap when open: ${stackOpen.join(' / ')} px`);
console.log(gridOpen.some(x => x > 2) && !stackOpen.some(x => x > 2)
  ? '  → Grid-only overlap: the height budget / zoom clamp differs by mode.'
  : gridOpen.some(x => x > 2)
    ? '  → Overlaps in both modes: the panel height is missing from the shared budget.'
    : '  → No settled overlap; check the mid-transition samples above.');

await browser.close();
server.close();
