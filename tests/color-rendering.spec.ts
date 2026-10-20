import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {makeFixtures, makeDecoderFixtures} from '../tools/investigations/sdr-color/fixtures.mjs';
import {difference} from '../tools/investigations/sdr-color/native.mjs';
import {readSamples, screenshotSamples} from '../tools/investigations/sdr-color/sampling.mjs';
import {installLegacyFilter} from '../tools/investigations/sdr-color/legacy-filter.mjs';

let fixtures: any, decoderFixtures: any;
test.use({viewport:{width:1280,height:850}, serviceWorkers:'block'});
test.beforeAll(async ({browserName}, info) => {
  const directory = path.join(info.project.outputDir, 'color-fixtures-' + info.workerIndex);
  fs.mkdirSync(directory, {recursive:true});
  // Hosted WebKit's native player does not present these High 4:4:4 inputs.
  // Native tests use the same authored patches/tags in ordinary High; Chrome
  // retains the lossless High 4:4:4 software-path and compensation controls.
  fixtures = makeFixtures(directory,{nativeAvc:browserName==='webkit'});
  if(process.platform==='darwin')decoderFixtures=makeDecoderFixtures(directory);
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

test('scrub color survives a release base with document query and fragment',async({page})=>{
  await page.route('**/release-runtime/**',async route=>{
    const response=await route.fetch({url:route.request().url().replace('/release-runtime/','/')});
    await route.fulfill({response});
  });
  await page.route('**/?staged-color=1',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('<head>','<head><base href="./release-runtime/">')});
  });
  await page.goto('/?staged-color=1#frame');
  await load(page,fixtures.hardwareCases.find(c=>c.name==='nv12-709-limited').file);
  const video=page.locator('#layerEditA video'),native=await screenshotSamples(video,test.info().outputPath('staged-native.png'));
  expect(Math.max(...native.flatMap(p=>p.rgb))).toBeGreaterThan(200);
  const bar=(await page.locator('#videoProgressContainer').boundingBox())!;
  await page.mouse.move(bar.x+bar.width*.4,bar.y+bar.height/2);await page.mouse.down();
  try{
    if(await page.evaluate(()=>window.eval('_scrubUseDecoder()'))){
      await page.waitForFunction(()=>window.eval('_scrubVideoSessions.editA === "failed" || _scrubOverlayLive.editA?.framesPainted>0'));
      if(await page.evaluate(()=>window.eval('_scrubVideoSessions.editA === "failed"'))){
        expect(await page.evaluate(()=>matchMedia('(color-gamut: p3)').matches),'wide-gamut NV12 uses native seeking').toBe(true);
        expect(await page.evaluate(()=>window.eval('_scrubVideoInputBudget.state.bytes'))).toBe(0);
        await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).seeking);
        expect(difference(await screenshotSamples(video,test.info().outputPath('staged-native-fallback.png')),native)).toBeLessThanOrEqual(2);
        return;
      }
      const canvas=page.locator('.scrub-overlay-canvas'),filter=await canvas.evaluate(c=>c.style.filter);
      if(filter)expect(filter).toContain('/?staged-color=1#scrubOverlayColorFix');
      expect(difference(await screenshotSamples(canvas,test.info().outputPath('staged-scrub.png')),native)).toBeLessThanOrEqual(2);
    }else{
      await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).seeking);
      expect(difference(await screenshotSamples(video,test.info().outputPath('staged-native-seek.png')),native)).toBeLessThanOrEqual(2);
    }
  }finally{await page.mouse.up();}
});

for(const name of ['matrix709-limited','matrix601-limited','matrix709-full','srgb-transfer','untagged',
  'nv12-709-limited','nv12-601-limited','nv12-709-full','nv12-srgb','nv12-untagged']) {
  test('SDR scrub preserves native picture: '+name, async ({page}, info) => {
    await load(page,[...fixtures.cases,...fixtures.hardwareCases].find(c=>c.name===name).file);
    await page.mouse.move(2,840);
    const video=page.locator('#layerEditA video');
    const native=await video.evaluate(readSamples,{});
    const nativeShot=await screenshotSamples(video,info.outputPath('native.png'));
    expect(Math.max(...nativeShot.flatMap(p=>p.rgb)),'native screenshot contains the authored picture').toBeGreaterThan(200);
    const bar=(await page.locator('#videoProgressContainer').boundingBox())!;
    await page.mouse.move(bar.x+bar.width*.3,bar.y+bar.height/2);await page.mouse.down();
    try {
      await page.mouse.move(bar.x+bar.width*.4,bar.y+bar.height/2);
      if(await page.evaluate(()=>window.eval('_scrubUseDecoder()'))) {
        await page.waitForFunction(()=>window.eval('_scrubVideoSessions.editA === "failed" || !!_scrubOverlayLive.editA && (_scrubOverlayLive.editA.dead || _scrubOverlayLive.editA.framesPainted > 0)'));
        const paints=await page.evaluate(()=>window.eval('!!_scrubOverlayLive.editA && !_scrubOverlayLive.editA.dead'));
        if (!paints) {
          const wideGamut=await page.evaluate(()=>matchMedia('(color-gamut: p3)').matches);
          expect(name.includes('untagged') || name==='nv12-601-limited' || name.startsWith('nv12-') && wideGamut,'verified tagged controls must exercise the decoder or its explicit native policy').toBe(true);
          expect(await page.evaluate(()=>window.eval('_scrubVideoInputBudget.state.bytes')),'rejected color releases encoded input').toBe(0);
          await page.mouse.move(bar.x+bar.width*.45,bar.y+bar.height/2);
          await page.waitForFunction(()=>!document.querySelector('#layerEditA video')!.seeking);
          if(name.includes('untagged'))expect(await page.locator('.scrub-overlay-canvas').count(),'untagged native path does not replace the picture').toBe(0);
          expect(difference((await video.evaluate(readSamples,{})).samples,native.samples),'native fallback preserves picture').toBe(0);
          expect(difference(await screenshotSamples(video,info.outputPath('native-fallback.png')),nativeShot),'native fallback preserves displayed color').toBeLessThanOrEqual(2);
          return;
        }
        const canvas=page.locator('.scrub-overlay-canvas');
        expect(difference((await canvas.evaluate(readSamples,{})).samples,native.samples)).toBeLessThanOrEqual(2);
        expect(difference(await screenshotSamples(canvas,info.outputPath('scrub.png')),nativeShot),'scrub compositor matches native video').toBeLessThanOrEqual(2);
        const filter=await canvas.evaluate(c=>c.style.filter);
        if(filter) {
          await canvas.evaluate(c=>c.style.filter='');
          expect(difference(await screenshotSamples(canvas,info.outputPath('missing-compensation.png')),nativeShot),'NV12 compensation is necessary on this path').toBeGreaterThan(8);
          await canvas.evaluate((c,f)=>c.style.filter=f,filter);
        }
        // Cached ImageBitmaps must retain the same presentation correction.
        await page.waitForFunction(()=>window.eval('_scrubOverlayLive.editA.cacheStats.frames > 0'));
        const hits=await page.evaluate(()=>window.eval('_scrubOverlayLive.editA.cacheStats.hits'));
        await page.mouse.move(bar.x+bar.width*.2,bar.y+bar.height/2);
        await page.waitForFunction(h=>window.eval('_scrubOverlayLive.editA.cacheStats.hits')>h,hits);
        expect(difference(await screenshotSamples(canvas,info.outputPath('cached-scrub.png')),nativeShot),'cached compositor matches native video').toBeLessThanOrEqual(2);
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


// This policy belongs to the macOS compositor. Linux CI still exercises the
// platform-independent rejection/lifetime checks through ownership; these real
// Main10 and software-output regressions run on macOS without capability skips.
if(process.platform==='darwin') {
  for(const kind of ['opaque-hevc-main10','ordinary-avc-software','hardware-to-software']) {
    test('macOS decoder color fallback: '+kind,async({page,browserName},info)=>{
      if(browserName==='chromium')await page.evaluate(({software})=>{
        const Original=VideoDecoder;
        (window as any).__preferSoftware=software;(window as any).__colorOutputs=[];
        (window as any).VideoDecoder=class extends Original {
          constructor(options:VideoDecoderInit){super({...options,output(frame){
            (window as any).__colorOutputs.push({format:frame.format,color:frame.colorSpace.toJSON()});
            options.output(frame);
          }});}
          configure(config:VideoDecoderConfig){
            // Real decoding with only its permitted preference changed; no
            // native-video changes and no fabricated frames or color metadata.
            super.configure((window as any).__preferSoftware?{...config,hardwareAcceleration:'prefer-software'}:config);
          }
        };
      },{software:kind==='ordinary-avc-software'});
      await load(page,decoderFixtures[kind==='opaque-hevc-main10'?kind:'ordinary-avc-software'].file);
      const video=page.locator('#layerEditA video'),native=await screenshotSamples(video,info.outputPath('native.png'));
      expect(Math.max(...native.flatMap(p=>p.rgb)),'visible authored native picture').toBeGreaterThan(200);
      const raw=await video.evaluate(readSamples,{}),bar=(await page.locator('#videoProgressContainer').boundingBox())!;
      for(let drag=0;drag<3;drag++){
        if(drag){
          if(browserName==='chromium')await page.evaluate(()=>{(window as any).__preferSoftware=true;});
          await page.locator('#playPauseBtn').click();
          await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).paused);
          await page.locator('#playPauseBtn').click();
        }
        const previousOutputs=browserName==='chromium'?await page.evaluate(()=>(window as any).__colorOutputs.length):0;
        await page.mouse.move(bar.x+bar.width*(drag===0?.06:drag===1?.7:.8),bar.y+bar.height/2);await page.mouse.down();
        try {
          const retained=kind==='hardware-to-software' && drag===0;
          if(browserName==='chromium'){
            await page.waitForFunction(()=>window.eval('_scrubVideoSessions.editA === "failed" || _scrubOverlayLive.editA?.framesPainted>0'));
            const p3=await page.evaluate(()=>matchMedia('(color-gamut: p3)').matches);
            if(kind==='hardware-to-software' && drag===1 && !p3)await page.waitForFunction(n=>(window as any).__colorOutputs.length>n,previousOutputs);
            const outputs=await page.evaluate(()=>(window as any).__colorOutputs);
            expect(outputs.length,'real decoder output reached the policy').toBeGreaterThan(0);
            if(retained){
              expect(outputs[0].format,'hardware control actually uses NV12').toBe('NV12');
              // P3 deliberately declines this control; sRGB retains its cache.
              if(!p3){
                await page.waitForFunction(()=>window.eval('_scrubOverlayLive.editA.cacheStats.frames > 0'));
                expect(difference(await screenshotSamples(page.locator('.scrub-overlay-canvas'),info.outputPath('hardware-scrub.png')),native)).toBeLessThanOrEqual(2);
                continue;
              }
            } else if(kind!=='hardware-to-software' || !await page.evaluate(()=>matchMedia('(color-gamut: p3)').matches)) {
              expect(outputs.at(-1).format,'regression exercises its actual decoder format').toBe(kind==='opaque-hevc-main10'?null:'I420');
            }
            await expect.poll(()=>page.evaluate(()=>window.eval('_scrubVideoSessions.editA === "failed"')),{message:'unverified output must use native seeking'}).toBe(true);
            expect(await page.evaluate(()=>window.eval('_scrubVideoInputBudget.state.bytes')),'rejection releases encoded reservation').toBe(0);
            expect(await page.evaluate(()=>window.eval('!_scrubOverlayLive.editA || _scrubOverlayLive.editA.dead && _scrubOverlayLive.editA.cacheStats.bytes === 0')),'no retired overlay can resume').toBe(true);
          } else expect(await page.evaluate(()=>window.eval('_scrubUseDecoder()'))).toBe(false);
          await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).seeking);
          expect(difference((await video.evaluate(readSamples,{})).samples,raw.samples)).toBe(0);
          expect(difference(await screenshotSamples(video,info.outputPath('fallback-'+drag+'.png')),native),'native picture survives repeated drag and playback/resume').toBeLessThanOrEqual(2);
        } finally {await page.mouse.up();}
      }
    });
  }
}
