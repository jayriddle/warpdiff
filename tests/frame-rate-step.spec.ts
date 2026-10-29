import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareFrameRateFixture } from './helpers/frame-rate-fixture.mjs';

let directory: string;
let fixture: string;

test.beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-frame-rate-'));
  fixture = prepareFrameRateFixture(directory);
});

test.afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

test('frame stepping uses a constant 24 fps sample table before playback', async ({ page }) => {
  let measured = false;
  page.on('console', message => { if (message.text().startsWith('[fps]')) measured = true; });
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(fixture);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const video = document.querySelector('.asset-layer video') as HTMLVideoElement | null;
    const rates = (window as any).__testAPI?._videoFps;
    return !!video && video.readyState >= 2 && rates && rates[0] === 24;
  }, null, { timeout: 15000 });

  const stepped = await page.evaluate(async () => {
    const video = document.querySelector('.asset-layer video') as HTMLVideoElement;
    const read = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return -1;
      context.drawImage(video, 0, 0);
      let number = 0;
      for (let bit = 0; bit < 6; bit++) {
        const pixel = context.getImageData(bit * 40 + 15, 20, 1, 1).data;
        if (pixel[0] > 100) number |= 1 << bit;
      }
      return number;
    };
    const settle = () => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1500);
      video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    (window as any).stepFrame(1);
    await settle();
    (window as any).stepFrame(1);
    await settle();
    return { time: video.currentTime, frame: read(), rate: (window as any).__testAPI._videoFps[0] };
  });

  expect(stepped.rate).toBe(24);
  expect(stepped.time).toBeCloseTo(2.5 / 24, 4);
  expect(stepped.frame).toBe(2);

  await page.evaluate(() => (window as any).playAllMedia());
  await expect.poll(() => measured, { timeout: 8000 }).toBe(true);
  await page.evaluate(() => (window as any).pauseAllMedia());
  expect(await page.evaluate(() => (window as any).__testAPI._videoFps[0])).toBe(24);
});

// Inspect the composited picture too: drawImage(video) and currentTime can both
// advance while Chrome's visible paused layer still shows an older frame.
import { prepareFrameStepPair } from './helpers/frame-rate-fixture.mjs';
const { PNG } = require('playwright-core/lib/utilsBundle');

async function visibleFrameIds(page: any) {
  const image = PNG.sync.read(await page.screenshot());
  const boxes = await page.locator('.asset-layer video').evaluateAll((videos: HTMLVideoElement[]) =>
    videos.map(video => { const r = video.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }));
  return boxes.map((box: any) => {
    const pixel = (sourceX: number) => {
      const x = Math.round(box.x + sourceX / 320 * box.w);
      const y = Math.round(box.y + 20 / 180 * box.h);
      return image.data[(y * image.width + x) * 4];
    };
    let frame = 0;
    for (let bit = 0; bit < 7; bit++) if (pixel(bit * 40 + 15) > 100) frame |= 1 << bit;
    return pixel(300) > 180 ? frame : -1;
  });
}

for (const rates of [[24,24], [24,30], [30,24]]) {
  test(`two ${rates.join('/')} fps videos display the requested frames through taps and bursts`, async ({page}, info) => {
    const filesDir = path.join(info.outputDir, 'pair');
    fs.mkdirSync(filesDir, {recursive:true});
    const files = prepareFrameStepPair(filesDir, rates);
    await page.goto('/');
    await page.locator('#multiFileInput').setInputFiles(files);
    await page.locator('#comparisonView.active').waitFor();
    await expect.poll(() => page.evaluate(() => (window as any).__testAPI._videoFps)).toEqual(rates);
    if (!await page.evaluate(() => (window as any).__testAPI.isGridMode)) await page.locator('#gridIconBtn').click();
    await expect.poll(() => visibleFrameIds(page)).toEqual([0,0]);
    const observations: any[] = [];
    let reference = 0;
    const assertPictures = async (label: string) => {
      const expected = rates.map(fps => Math.floor((reference + 0.5) / rates[0] * fps + 0.01));
      // Accept native presentation latency, but never accept a stale picture
      // merely because its time or separately copied pixels look correct.
      await expect.poll(() => visibleFrameIds(page), {timeout:3000, message:label}).toEqual(expected);
      const decoded = await page.evaluate(() => Array.from(document.querySelectorAll('.asset-layer video')).map((element:any) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(element,0,0,320,180);
        let frame = 0;
        for (let bit=0;bit<7;bit++) if(ctx.getImageData(bit*40+15,20,1,1).data[0]>100)frame|=1<<bit;
        return {frame,time:element.currentTime,paused:element.paused};
      }));
      expect(decoded.map(x=>x.frame), label + ' decoded frames').toEqual(expected);
      expect(decoded.every(x=>x.paused), label + ' stays paused').toBe(true);
      observations.push({label,expected,decoded,visible:await visibleFrameIds(page)});
    };
    for (let i=0;i<5;i++) { await page.keyboard.press('.'); reference++; await assertPictures('slow forward '+reference); }
    // Outlive the short burst cursor without losing the settled position.
    await page.waitForTimeout(800);
    for (let i=0;i<3;i++) { await page.keyboard.press(','); reference--; await assertPictures('slow backward '+reference); }
    for (let round=0;round<4;round++) {
      for(let i=0;i<16;i++) await page.keyboard.press('.');
      reference += 16; await assertPictures('forward burst '+round);
      for(let i=0;i<16;i++) await page.keyboard.press(',');
      reference -= 16; await assertPictures('backward burst '+round);
    }
    await info.attach('displayed-frame-observations', {body:JSON.stringify(observations,null,2),contentType:'application/json'});
    await info.attach('final-two-video-picture', {body:await page.screenshot(),contentType:'image/png'});
  });
}

test('two-video stepping yields to playback, Stack, scrub, scope changes and replacement', async ({page}, info) => {
  const dir=path.join(info.outputDir,'lifecycle');fs.mkdirSync(dir,{recursive:true});
  const files=prepareFrameStepPair(dir);
  await page.goto('/');await page.locator('#multiFileInput').setInputFiles(files);
  await page.locator('#comparisonView.active').waitFor();
  await expect.poll(()=>page.evaluate(()=>(window as any).__testAPI._videoFps)).toEqual([24,24]);
  if(!await page.evaluate(()=>(window as any).__testAPI.isGridMode))await page.locator('#gridIconBtn').click();
  const play=await page.evaluate(()=>{
    for(let i=0;i<16;i++)(window as any).stepFrame(1);
    const pending=window.eval('_frameStepSeeks.size');
    (window as any).playAllMedia();
    return {pending,remaining:window.eval('_frameStepSeeks.size'),times:Array.from(document.querySelectorAll('.asset-layer video')).map((v:any)=>v.currentTime)};
  });
  expect(play.pending).toBe(2);expect(play.remaining).toBe(0);
  play.times.forEach(time=>expect(time).toBeCloseTo(16.5/24,4));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.asset-layer video')).every((v:any)=>!v.paused&&v.currentTime>.8));
  await page.evaluate(()=>(window as any).pauseAllMedia());
  await page.locator('#stackIconBtn').click();
  await page.evaluate(()=>Array.from(document.querySelectorAll('.asset-layer video')).forEach((v:any)=>v.currentTime=10.5/24));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.asset-layer video')).every((v:any)=>!v.seeking));
  for(let i=0;i<8;i++)await page.keyboard.press('.');
  await page.waitForFunction(()=>window.eval('_frameStepSeeks.size')===0);
  await page.locator('#gridIconBtn').click();
  await expect.poll(()=>visibleFrameIds(page)).toEqual([18,18]);
  const scope=await page.evaluate(()=>{
    for(let i=0;i<8;i++)(window as any).stepFrame(1);
    const pending=window.eval('_frameStepSeeks.size');
    (window as any).__testAPI.togglePlaybackScope();
    const slots=(window as any).__testAPI._transportSlots;
    return {pending,remaining:window.eval('_frameStepSeeks.size'),slots};
  });
  expect(scope.pending).toBe(2);expect(scope.remaining).toBe(0);expect(scope.slots).toHaveLength(1);
  const scrub=await page.evaluate(()=>{
    for(let i=0;i<4;i++)(window as any).stepFrame(1);
    const pending=window.eval('_frameStepSeeks.size');
    const slider=document.getElementById('videoProgressContainer')!,r=slider.getBoundingClientRect();
    slider.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+r.width*.25,clientY:r.y+r.height/2}));
    const remaining=window.eval('_frameStepSeeks.size');
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
    return {pending,remaining};
  });
  expect(scrub.pending).toBe(1);expect(scrub.remaining).toBe(0);
  const cleared=await page.evaluate(()=>{
    for(let i=0;i<4;i++)(window as any).stepFrame(1);
    const pending=window.eval('_frameStepSeeks.size');
    (window as any).clearAllMedia();return {pending,remaining:window.eval('_frameStepSeeks.size')};
  });
  expect(cleared.pending).toBe(1);expect(cleared.remaining).toBe(0);
  await page.locator('#multiFileInput').setInputFiles(files);
  await page.locator('#comparisonView.active').waitFor();
  await expect.poll(()=>visibleFrameIds(page)).toEqual([0,0]);
  await page.waitForTimeout(250);
  expect(await visibleFrameIds(page),'retired callbacks cannot seek the replacement').toEqual([0,0]);
});
