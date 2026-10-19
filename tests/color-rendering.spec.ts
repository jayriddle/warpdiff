import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {makeFixtures} from '../tools/investigations/sdr-color/fixtures.mjs';
import {difference} from '../tools/investigations/sdr-color/native.mjs';
import {readSamples, screenshotSamples} from '../tools/investigations/sdr-color/sampling.mjs';
import {installLegacyFilter} from '../tools/investigations/sdr-color/legacy-filter.mjs';

let fixtures: any;
test.use({viewport:{width:1280,height:850}, serviceWorkers:'block'});
test.beforeAll(async ({}, info) => {
  const directory = path.join(info.project.outputDir, 'color-fixtures-' + info.workerIndex);
  fs.mkdirSync(directory, {recursive:true});
  fixtures = makeFixtures(directory);
});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion','999.0.0'));
  await page.goto('/');
});
async function load(page, files) {
  await page.locator('#multiFileInput').setInputFiles(files);
  await page.locator('#comparisonView.active').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.asset-layer video')].every((v:any) => v.readyState >= 2) &&
    getComputedStyle(document.querySelector('.asset-layer.active')!).opacity === '1');
  await page.locator('#stackIconBtn').click();
  await page.waitForFunction(() => !window.eval('isGridMode'));
  // Decode a presented frame before sampling; no changes to the app's owners.
  await page.locator('#playPauseBtn').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.asset-layer video')].every((v:any) => v.currentTime > .05));
  await page.locator('#playPauseBtn').click();
}
test('video Difference follows RGB subtraction and retires its staging buffer', async ({page, browserName}) => {
  await load(page, fixtures.cases.slice(0,2).map(c => c.file));
  const sources = await page.locator('.asset-layer video').evaluateAll(vs => vs.map(v => {
    const c = document.createElement('canvas'); c.width=640; c.height=360;
    const ctx=c.getContext('2d')!;ctx.drawImage(v as HTMLVideoElement,0,0);
    return Array.from({length:32},(_,i)=>({name:'patch-'+i,rgb:[...ctx.getImageData((i%8+.5)*80,(Math.floor(i/8)+.5)*90,1,1).data].slice(0,3)}));
  }));
  const expected=sources[0].map((p,i)=>({name:p.name,rgb:p.rgb.map((v,k)=>Math.abs(v-sources[1][i].rgb[k]))}));
  expect(Math.max(...expected.flatMap(p=>p.rgb))).toBeGreaterThan(20);
  await page.keyboard.press('d');
  await page.waitForFunction(() => window.eval('_diffMode && _diffOffscreen?.width > 0'));
  const actual=await page.evaluate(() => {
    const c=window.eval('_diffOffscreen'),ctx=c.getContext('2d');
    return Array.from({length:32},(_,i)=>({name:'patch-'+i,rgb:[...ctx.getImageData((i%8+.5)*80,(Math.floor(i/8)+.5)*90,1,1).data].slice(0,3)}));
  });
  expect(difference(actual,expected),'nonidentical video RGB subtraction').toBeLessThanOrEqual(1);
  if(browserName==='webkit') {
    expect(await page.evaluate(() => window.eval('_diffVideoFrame.width'))).toBe(640);
    expect(await page.evaluate(() => {const c=window.eval('_diffVideoFrame');window.eval('drawDiffComposite()');return c===window.eval('_diffVideoFrame');})).toBe(true);
  }
  await page.keyboard.press('d');
  expect(await page.evaluate(() => window.eval('!_diffVideoFrame || _diffVideoFrame.width === 0 && _diffVideoFrame.height === 0'))).toBe(true);
  await load(page, [fixtures.cases[0].file,fixtures.cases[0].file]);
  await page.keyboard.press('d');
  await page.waitForFunction(() => window.eval('_diffMode && _diffOffscreen?.width > 0'));
  expect(await page.evaluate(() => {const c=window.eval('_diffOffscreen');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.reduce((max,n,i)=>i%4===3?max:Math.max(max,n),0);})).toBe(0);
  page.once('dialog', dialog=>dialog.accept());
  await page.locator('#resetBtn').click();
  await page.locator('#comparisonView.active').waitFor({state:'hidden'});
  expect(await page.evaluate(() => window.eval('_diffVideoFrame === null'))).toBe(true);
});

for(const name of ['matrix709-limited','matrix601-limited','matrix709-full','srgb-transfer','untagged']) {
  test('SDR scrub preserves native picture: '+name, async ({page}, info) => {
    await load(page,fixtures.cases.find(c=>c.name===name).file);
    await page.mouse.move(2,840);
    const video=page.locator('#layerEditA video');
    const native=await video.evaluate(readSamples,{});
    const nativeShot=await screenshotSamples(video,info.outputPath('native.png'));
    const bar=(await page.locator('#videoProgressContainer').boundingBox())!;
    await page.mouse.move(bar.x+bar.width*.3,bar.y+bar.height/2);await page.mouse.down();
    try {
      await page.mouse.move(bar.x+bar.width*.4,bar.y+bar.height/2);
      if(await page.evaluate(()=>window.eval('_scrubUseDecoder()'))) {
        await page.waitForFunction(()=>window.eval('_scrubVideoSessions.editA === "failed" || !!_scrubOverlayLive.editA && (_scrubOverlayLive.editA.dead || _scrubOverlayLive.editA.framesPainted > 0)'));
        const paints=await page.evaluate(()=>window.eval('!!_scrubOverlayLive.editA && !_scrubOverlayLive.editA.dead'));
        if (!paints) {
          expect(name,'tagged controls must exercise the decoder').toBe('untagged');
          expect(await page.evaluate(()=>window.eval('_scrubVideoInputBudget.state.bytes')),'rejected color releases encoded input').toBe(0);
          await page.mouse.move(bar.x+bar.width*.45,bar.y+bar.height/2);
          expect(difference((await video.evaluate(readSamples,{})).samples,native.samples),'native fallback preserves picture').toBe(0);
          return;
        }
        const canvas=page.locator('.scrub-overlay-canvas');
        expect(difference((await canvas.evaluate(readSamples,{})).samples,native.samples)).toBeLessThanOrEqual(2);
        expect(difference(await screenshotSamples(canvas,info.outputPath('scrub.png')),nativeShot),'scrub compositor matches native video').toBeLessThanOrEqual(2);
        if(name==='matrix709-limited') {
          await page.evaluate(installLegacyFilter);
          await canvas.evaluate(c=>c.style.filter='url(#legacy-color-negative-control)');
          expect(difference(await screenshotSamples(canvas,info.outputPath('legacy-negative-control.png')),nativeShot),'retired filter must create a detectable shift').toBeGreaterThan(2);
          await canvas.evaluate(c=>c.style.filter='');
        }
      } else {
        expect(await page.locator('.scrub-overlay-canvas').count()).toBe(0);
        expect(difference((await video.evaluate(readSamples,{})).samples,native.samples)).toBe(0);
      }
    } finally {await page.mouse.up();}
  });
}
