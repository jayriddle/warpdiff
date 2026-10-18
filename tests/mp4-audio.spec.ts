import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareMp4AudioFiles} from './helpers/mp4-audio-files.mjs';

test.use({serviceWorkers:'block'});
let directory:string,files:ReturnType<typeof prepareMp4AudioFiles>;
test.beforeAll(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-mp4-audio-'));files=prepareMp4AudioFiles(directory,path.join(__dirname,'..'));});
test.afterAll(()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lastSeenVersion','999.0.0');const w=window as any;w.audioErrors=[];w.replies=[];addEventListener('error',e=>w.audioErrors.push(e.message));addEventListener('unhandledrejection',e=>w.audioErrors.push(String(e.reason)));addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.replies.push(e.data);});});
  await page.goto('/');
});
async function openCommandFallback(page:any) {
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await page.locator('#localPreparationDialog summary').click();
  await page.locator('#localPreparationManual').click();
  await expect(page.locator('#ffmpegPanel')).toBeVisible();
}
for(const kind of['video','audio'])test('multiple MP4 audio tracks keep native '+kind+' playback without selecting analysis',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(kind==='video'?files.multi:files.audio);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect(page.locator('#audioTrackAlert')).toBeVisible();await expect(page.locator('#audioTrackAlert')).toContainText('Multiple MP4 audio tracks');
  if(kind==='video')await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('2 audio tracks');
  const state=await page.evaluate(()=>(window as any).eval(`({metrics:audioMetrics.editA||null,preview:!!_videoAudioBuffers.editA,opus:!!_opusSyncSlots.editA,pending:!!_opusSyncPending.editA,noAudio:_noAudioSlots.has('editA'),wave:!!waveformData.editA,slotViz:!!_audioSlotVizData.editA,media:getLayer('editA').querySelector('video,audio').muted,audioTracksAPI:'audioTracks' in getLayer('editA').querySelector('video,audio')})`));
  expect(state).toMatchObject({metrics:null,preview:false,opus:false,pending:false,noAudio:false,wave:false,slotViz:false,media:false});
  await test.info().attach('native-track-capability',{body:JSON.stringify(state),contentType:'application/json'});
  await page.evaluate(()=>(window as any).eval('playAllMedia()'));
  await expect.poll(()=>page.evaluate(()=>(window as any).eval("getLayer('editA').querySelector('video,audio').currentTime"))).toBeGreaterThan(.05);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('reloading a single-track copy restores analysis and retires the warning',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(files.multi);await expect(page.locator('#audioTrackAlert')).toBeVisible();
  await page.locator('#multiFileInput').setInputFiles(files.single);await expect(page.locator('#audioTrackAlert')).toBeHidden();
  await expect(page.locator('#layerEditA .asset-audio-format')).toContainText('AAC');
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('!!audioMetrics.editA && !!waveformData.editA'))).toBe(true);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('clearing a blocked analysis retires its comparison-scoped message',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(files.multi);await expect(page.locator('#audioTrackAlert')).toBeVisible();
  await page.evaluate(()=>(window as any).eval('clearAllMedia()'));await expect(page.locator('#audioTrackAlert')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).eval('Object.keys(_audioTrackIssues)'))).toEqual([]);
});

test('an unverifiable MP4 track leaves native video usable and withholds metrics',async({page})=>{
  await page.evaluate(()=>(window as any)._demuxMP4Audio=()=>null);
  await page.locator('#multiFileInput').setInputFiles(files.single);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);await expect(page.locator('#audioTrackAlert')).toContainText('could not be verified');
  expect(await page.evaluate(()=>(window as any).eval('audioMetrics.editA||null'))).toBeNull();
  await page.evaluate(()=>(window as any).eval('playAllMedia()'));await expect.poll(()=>page.evaluate(()=>(window as any).eval("getLayer('editA').querySelector('video').currentTime"))).toBeGreaterThan(.05);
});

test('a rejected MP4 packet map is not labelled no audio after native decode failure',async({page})=>{
  // Loading clears the old context. Patch the native prototype so the new
  // context takes the intended failure path without creating a disposable one.
  await page.evaluate(()=>{(window as any).forcedDecodeFailures=0;AudioContext.prototype.decodeAudioData=()=>{(window as any).forcedDecodeFailures++;return Promise.reject(Error('Force packet fallback for the controlled malformed table'));};});
  await page.locator('#multiFileInput').setInputFiles(files.malformed);
  await openCommandFallback(page);
  expect(await page.evaluate(()=>(window as any).forcedDecodeFailures)).toBe(1);
  expect(await page.evaluate(()=>(window as any).eval("_noAudioSlots.has('editA')"))).toBe(false);
  expect(await page.evaluate(()=>(window as any).eval('_webcodecsPending.size'))).toBe(0);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('single-track AAC fallback receives the selected codec configuration',async({page,browserName})=>{
  const support=await page.evaluate(async()=>typeof AudioDecoder!=='undefined'&&
    (await AudioDecoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])})).supported);
  if(browserName==='chromium')expect(support,'System Chrome must exercise actual AAC WebCodecs decoding').toBe(true);
  await page.evaluate(()=>{AudioContext.prototype.decodeAudioData=()=>Promise.reject(Error('Force selected AAC packet decoding'));});
  await page.locator('#multiFileInput').setInputFiles(files.single);
  if(support) {
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('!!audioMetrics.editA && !!waveformData.editA'))).toBe(true);
    await expect(page.locator('#ffmpegPanel')).toBeHidden();
  } else {
    await openCommandFallback(page);
  }
  expect(await page.evaluate(()=>(window as any).eval("_noAudioSlots.has('editA')"))).toBe(false);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
  await test.info().attach('aac-decoder-support',{body:JSON.stringify({supported:support,decoded:!!support}),contentType:'application/json'});
});

test('known MP4 audio is not called absent when WebCodecs is unavailable',async({page})=>{
  await page.evaluate(()=>{
    Object.defineProperty(window,'AudioDecoder',{configurable:true,value:undefined});
    AudioContext.prototype.decodeAudioData=()=>Promise.reject(Error('Force native failure without WebCodecs'));
  });
  await page.locator('#multiFileInput').setInputFiles(files.single);
  await openCommandFallback(page);
  expect(await page.evaluate(()=>(window as any).eval("_noAudioSlots.has('editA')"))).toBe(false);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('a stale multi-track read cannot block a replacement single-track comparison',async({page})=>{
  await page.evaluate(()=>{
    const w=window as any,read=File.prototype.arrayBuffer,decode=w.decodeAndComputeAudioViz;
    File.prototype.arrayBuffer=function(){const ready=read.call(this);return this.name==='two-audio.mp4'
      ? new Promise(resolve=>{w.releaseOldAudioRead=()=>ready.then(resolve);}) : ready;};
    w.decodeAndComputeAudioViz=(slot:string,source:File)=>{const pending=decode(slot,source);if(source.name==='two-audio.mp4')w.oldAudioDecode=pending;return pending;};
  });
  await page.locator('#multiFileInput').setInputFiles(files.multi);
  await page.waitForFunction(()=>typeof(window as any).releaseOldAudioRead==='function');
  await page.locator('#multiFileInput').setInputFiles(files.single);
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('!!audioMetrics.editA && !!waveformData.editA'))).toBe(true);
  await page.evaluate(async()=>{const w=window as any;await w.releaseOldAudioRead();await w.oldAudioDecode;});
  await expect(page.locator('#audioTrackAlert')).toBeHidden();
  await expect(page.locator('#layerEditA .asset-audio-format')).toContainText('AAC');
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('track and timing notices remain readable together in a narrow comparison',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.locator('#multiFileInput').setInputFiles([files.multi,files.single]);
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('Object.keys(audioMetrics).length')),{timeout:15000}).toBe(1);
  await page.evaluate(()=>(window as any).eval("_setAudioTimelineMetadata(assetOrder.find(s=>mediaData[s]?.name==='one-audio.mp4'),null)"));
  const timing=page.locator('#audioTimingAlert'),track=page.locator('#audioTrackAlert');
  await expect(timing).toBeVisible();await expect(track).toBeVisible();
  const a=(await timing.boundingBox())!,b=(await track.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y+a.height+5);
  for(const rect of[a,b]){expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(390);}
  await test.info().attach('stacked-audio-notices',{body:await page.screenshot(),contentType:'image/png'});
});

async function expectHostTerminal(page:any,requestId:string,type:string,timeout:number) {
  const replies=()=>page.evaluate((id:string)=>(window as any).replies.filter((reply:any)=>reply.requestId===id),requestId);
  // The video verifier owns a 10-second deadline. Await its terminal decision,
  // then assert the exact result without polling through an incorrect FAILED.
  await expect.poll(async()=>(await replies()).length,{timeout}).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).replies)).toEqual([expect.objectContaining({requestId,type})]);
}

for(const kind of['video','audio'])test('host '+kind+' readiness respects the single-track analysis boundary',async({page})=>{
  const file=kind==='video'?files.multi:files.audio;
  await page.evaluate(({name,type,base64})=>window.postMessage({type:'WARPDIFF_LOAD',requestId:'multi-audio',files:[{name,contentType:type,base64}]},location.origin),{name:path.basename(file),type:kind==='video'?'video/mp4':'audio/mp4',base64:fs.readFileSync(file).toString('base64')});
  await expectHostTerminal(page,'multi-audio',kind==='video'?'WARPDIFF_LOAD_READY':'WARPDIFF_LOAD_FAILED',kind==='video'?15000:5000);
  if(kind==='audio') {await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);await expect(page.locator('#audioTrackAlert')).toBeHidden();}
  else {await expect(page.locator('#audioTrackAlert')).toBeVisible();await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('2 audio tracks');}
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

for(const kind of['video','audio'])test('leading MP4 padding cannot bypass the '+kind+' single-track gate',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(kind==='video'?files.paddedMulti:files.paddedAudio);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect(page.locator('#audioTrackAlert'),'Padding must retain the multiple-track notice').toContainText('Multiple MP4 audio tracks');
  const state=await page.evaluate(()=>(window as any).eval(`({metrics:!!audioMetrics.editA,wave:!!waveformData.editA,slotViz:!!_audioSlotVizData.editA,preview:!!_videoAudioBuffers.editA,opus:!!_opusSyncSlots.editA,noAudio:_noAudioSlots.has('editA'),muted:getLayer('editA').querySelector('video,audio').muted})`));
  expect(state).toEqual({metrics:false,wave:false,slotViz:false,preview:false,opus:false,noAudio:false,muted:false});
  if(kind==='video')await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('2 audio tracks');
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

for(const kind of['video','audio'])test('host readiness applies the same track policy after leading MP4 padding for '+kind,async({page})=>{
  const file=kind==='video'?files.paddedMulti:files.paddedAudio;
  await page.evaluate(({name,type,base64})=>window.postMessage({type:'WARPDIFF_LOAD',requestId:'padded-multi',files:[{name,contentType:type,base64}]},location.origin),{name:path.basename(file),type:kind==='video'?'video/mp4':'audio/mp4',base64:fs.readFileSync(file).toString('base64')});
  await expectHostTerminal(page,'padded-multi',kind==='video'?'WARPDIFF_LOAD_READY':'WARPDIFF_LOAD_FAILED',kind==='video'?15000:5000);
  if(kind==='video') {
    await expect(page.locator('#audioTrackAlert')).toContainText('Multiple MP4 audio tracks');
    expect(await page.evaluate(()=>(window as any).eval('!!audioMetrics.editA || !!_videoAudioBuffers.editA'))).toBe(false);
  } else await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
});

test('padded single-track AAC uses MP4 fallback after native decode failure',async({page,browserName})=>{
  const support=await page.evaluate(async()=>typeof AudioDecoder!=='undefined'&&
    (await AudioDecoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([0x12,0x10])})).supported);
  if(browserName==='chromium')expect(support).toBe(true);
  await page.evaluate(()=>{AudioContext.prototype.decodeAudioData=()=>Promise.reject(Error('Force padded MP4 packet decoding'));});
  await page.locator('#multiFileInput').setInputFiles(files.paddedSingle);
  if(support) {
    await expect.poll(()=>page.evaluate(()=>(window as any).eval('!!audioMetrics.editA && !!waveformData.editA')),'Padded MP4 must reach actual AAC packet decoding').toBe(true);
    await expect(page.locator('#ffmpegPanel')).toBeHidden();
  } else await openCommandFallback(page);
  expect(await page.evaluate(()=>(window as any).eval("_noAudioSlots.has('editA')"))).toBe(false);
  await expect(page.locator('#audioTrackAlert')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);
  await test.info().attach('padded-aac-decoder-support',{body:JSON.stringify({supported:support,decoded:!!support}),contentType:'application/json'});
});
