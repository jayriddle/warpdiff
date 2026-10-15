import {test, expect} from '@playwright/test';
import path from 'node:path';
import {statSync} from 'node:fs';

const videoFile=path.join(__dirname,'fixtures/landscape_a.mp4');
test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(videoFile);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
});

test('small real video retains one bounded input and releases it on invalidation',async ({page})=>{
  const ready=await page.evaluate(async()=>!!await (window as any)._scrubOverlayGetSession('editA'));
  expect(ready).toBe(true);
  const size=statSync(videoFile).size;
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.inputBudget())).toMatchObject({bytes:size,inputs:1});
  await page.evaluate(async()=>{await (window as any)._scrubOverlayGetSession('editA');(window as any)._suspendScrubSessions();});
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.inputBudget().bytes)).toBe(size);
  await page.evaluate(()=>(window as any)._invalidateScrubSession('editA'));
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.inputBudget())).toMatchObject({bytes:0,inputs:0});
});

test('oversized encoded input uses native seek without a scrub fetch',async ({page})=>{
  const result=await page.evaluate(async()=>{
    const w=window as any,original=window.fetch.bind(window);let fetches=0;
    w.eval('mediaData.editA.size = 256 * 1024 * 1024 + 1');
    window.fetch=(...args)=>{fetches++;return original(...args);};
    const session=await w._scrubOverlayGetSession('editA');
    window.fetch=original;
    return {session:!!session,fetches,budget:w.__testAPI.scrubVideo.inputBudget()};
  });
  expect(result).toMatchObject({session:false,fetches:0,budget:{bytes:0,inputs:0}});
  const bar=await page.locator('#videoProgressContainer').boundingBox();
  await page.mouse.click(bar!.x+bar!.width*.65,bar!.y+bar!.height/2);
  const video=page.locator('.asset-layer video');
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(1);
  expect(await video.evaluate(v=>v.paused)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.overlayLive())).toBe(false);
});

test('clearing pending input aborts it and fences a late completion',async ({page})=>{
  await page.evaluate(()=>{
    const w=window as any,original=window.fetch.bind(window),src=w.eval('mediaData.editA.src');
    w.decoderCreations=0;const factory=w._createScrubVideoSession;
    w._createScrubVideoSession=(bytes:any)=>{w.decoderCreations++;return factory(bytes);};
    window.fetch=(input,init)=>String(input)===src?new Promise(resolve=>{
      w.pendingSignal=init?.signal;
      w.finishScrub=()=>resolve(new Response(new Uint8Array(4)));
    }):original(input,init);
    w.pendingScrub=w._scrubOverlayGetSession('editA');
  });
  await page.waitForFunction(()=>!!(window as any).finishScrub);
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.sessionState('editA'))).toBe('pending');
  await page.evaluate(()=>(window as any).clearAllMedia());
  expect(await page.evaluate(()=>(window as any).pendingSignal.aborted)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.inputBudget().bytes)).toBe(statSync(videoFile).size);
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/green.png'));
  await page.evaluate(async()=>{const w=window as any;w.finishScrub();await w.pendingScrub;});
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.inputBudget())).toMatchObject({bytes:0,inputs:0});
  expect(await page.evaluate(()=>(window as any).decoderCreations)).toBe(0);
  expect(await page.evaluate(()=>(window as any).__testAPI.scrubVideo.sessionState('editA'))).toBe('none');
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
});

test('overlong response falls back and releases its reservation',async ({page})=>{
  const result=await page.evaluate(async()=>{
    const w=window as any,original=window.fetch.bind(window),src=w.eval('mediaData.editA.src');
    w.eval('mediaData.editA.size = 4');
    window.fetch=(input,init)=>String(input)===src?Promise.resolve(new Response(new Uint8Array(5))):original(input,init);
    const session=await w._scrubOverlayGetSession('editA');window.fetch=original;
    return {session:!!session,state:w.__testAPI.scrubVideo.sessionState('editA'),budget:w.__testAPI.scrubVideo.inputBudget()};
  });
  expect(result).toMatchObject({session:false,state:'failed',budget:{bytes:0,inputs:0}});
});
