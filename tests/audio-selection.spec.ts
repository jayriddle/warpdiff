import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareAudioSelectionFiles} from './helpers/audio-selection-files.mjs';

test.use({serviceWorkers:'block'});
let directory:string,files:ReturnType<typeof prepareAudioSelectionFiles>;
test.beforeAll(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-audio-selection-'));files=prepareAudioSelectionFiles(directory);});
test.afterAll(()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('lastSeenVersion','999.0.0');localStorage.setItem('pref_audioVizVisible','true');
    const w=window as any;w.audioErrors=[];w.replies=[];
    addEventListener('error',e=>w.audioErrors.push(e.message));
    addEventListener('unhandledrejection',e=>w.audioErrors.push(String(e.reason)));
    addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.replies.push(e.data);});
  });
  await page.goto('/');
});
test.afterEach(async({page})=>{expect(await page.evaluate(()=>(window as any).audioErrors)).toEqual([]);});
const state=(page:Page)=>page.evaluate(()=>(window as any).eval(`({
  metrics:!!audioMetrics.editA,preview:!!_videoAudioBuffers.editA,slotViz:!!_audioSlotVizData.editA,
  opus:!!_opusSyncSlots.editA,pending:!!_opusSyncPending.editA,
  muted:getLayer('editA').querySelector('video,audio').muted,
  direct:_nativeDirectOutputs.size,issue:_audioTrackIssues.editA||null})`));
async function loadDecoded(page:Page,file:string) {
  await page.locator('#multiFileInput').setInputFiles(file);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect.poll(async()=>(await state(page)).preview,{timeout:15000}).toBe(true);
}

for(const kind of ['multi','mixed','audio'] as const) test(`${kind} WebM keeps browser track choice and withholds decoded tools`,async({page,browserName})=>{
  // A WebM audio-only source must exercise the audio loader as well as the lazy W-panel owner.
  const input=kind==='audio'?{name:'two-audio.weba',mimeType:'audio/webm',buffer:fs.readFileSync(files.audio)}:files[kind];
  await page.locator('#multiFileInput').setInputFiles(input);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect(page.locator('#audioTrackAlert')).toContainText('Multiple WebM audio tracks');
  expect(await state(page)).toMatchObject({metrics:false,preview:false,slotViz:false,opus:false,pending:false,muted:false});
  expect(await page.evaluate(()=>(window as any).eval('_getMediaInputReport("editA").capabilities.decodedAnalysis.state'))).toBe('unavailable');
  await page.evaluate(()=>(window as any).playAllMedia());
  await expect.poll(()=>page.evaluate(()=>(document.querySelector('#layerEditA video,audio') as HTMLMediaElement).currentTime)).toBeGreaterThan(.1);
  if(kind==='multi' && browserName==='chromium') {
    const amplitudes=await page.evaluate(async()=>{
      // Observe the actual native soundtrack after app loading, not decodeAudioData.
      const ctx=new AudioContext(),media=document.querySelector('#layerEditA video') as HTMLVideoElement;
      const source=ctx.createMediaElementSource(media),analyser=ctx.createAnalyser();analyser.fftSize=16384;
      source.connect(analyser);analyser.connect(ctx.destination);await ctx.resume();
      try {
        const samples=new Float32Array(analyser.fftSize),deadline=performance.now()+3000;
        while(performance.now()<deadline) {
          analyser.getFloatTimeDomainData(samples);
          const values=[440,880].map(hz=>{let re=0,im=0;for(let i=0;i<samples.length;i++){re+=samples[i]*Math.cos(2*Math.PI*hz*i/ctx.sampleRate);im+=samples[i]*Math.sin(2*Math.PI*hz*i/ctx.sampleRate);}return 2*Math.hypot(re,im)/samples.length;});
          if(Math.max(...values)>.05)return values;
          await new Promise(resolve=>setTimeout(resolve,30));
        }
        throw Error('Native playback supplied no signal');
      } finally {source.disconnect();analyser.disconnect();await ctx.close();}
    });
    expect(amplitudes[0]).toBeGreaterThan(.05);expect(amplitudes[1]).toBeLessThan(.005);
    await test.info().attach('native-default-track-signal',{body:JSON.stringify(amplitudes),contentType:'application/json'});
  }
});

test('single-track WebM restores the intended 440 Hz analysis and clear retires the warning',async({page,browserName})=>{
  await page.locator('#multiFileInput').setInputFiles(files.multi);
  await expect(page.locator('#audioTrackAlert')).toBeVisible();
  await loadDecoded(page,files.single);
  await expect(page.locator('#audioTrackAlert')).toBeHidden();
  expect(await state(page)).toMatchObject({metrics:true,opus:browserName==='chromium',issue:null});
  const amplitudes=await page.evaluate(()=>(window as any).eval(`(() => {
    const b=_videoAudioBuffers.editA,d=b.getChannelData(0),n=Math.floor(b.sampleRate*.5),start=Math.floor(b.sampleRate*.25);
    return [440,880].map(hz=>{let re=0,im=0;for(let i=0;i<n;i++){re+=d[start+i]*Math.cos(2*Math.PI*hz*i/b.sampleRate);im+=d[start+i]*Math.sin(2*Math.PI*hz*i/b.sampleRate);}return 2*Math.hypot(re,im)/n;});
  })()`));
  expect(amplitudes[0]).toBeGreaterThan(.1);expect(amplitudes[1]).toBeLessThan(.001);
  await page.locator('#multiFileInput').setInputFiles(files.multi);await expect(page.locator('#audioTrackAlert')).toBeVisible();
  await page.evaluate(()=>(window as any).clearAllMedia());await expect(page.locator('#audioTrackAlert')).toBeHidden();
});

for(const fallback of [false,true]) test(`AAC with an Opus comment retains native output${fallback?' after native decode failure':''}`,async({page})=>{
  if(fallback)await page.evaluate(()=>{AudioContext.prototype.decodeAudioData=()=>Promise.reject(Error('Exercise AAC WebCodecs fallback'));});
  for(const file of [files.aac,files.comment]) {
    await loadDecoded(page,file);
    expect(await state(page)).toMatchObject({metrics:true,opus:false,pending:false,muted:false,direct:1,issue:null});
    await expect(page.locator('#layerEditA .asset-audio-format')).toContainText('AAC');
  }
});

test('a pending flag alone cannot publish replacement without an Opus decode',async({page})=>{
  await loadDecoded(page,files.aac);
  await page.evaluate(()=>(window as any).eval(`(async()=>{
    const pcm=_videoAudioBuffers.editA;_opusSyncPending.editA=true;
    await _finalizeAudioViz('editA',pcm,undefined,0,null,'mp4a.40.2');
  })()`));
  expect(await state(page)).toMatchObject({metrics:true,opus:false,pending:false,muted:false,direct:1});
});

for(const kind of ['short','delayed','long'] as const) test(`Opus ${kind} soundtrack preserves media duration and seeking`,async({page,browserName})=>{
  await loadDecoded(page,files[kind]);
  expect((await state(page)).opus).toBe(browserName==='chromium');
  const timing=await page.evaluate(()=>(window as any).eval(`({native:getLayer('editA').querySelector('video').duration,
    effective:_getEffectiveDuration(getLayer('editA').querySelector('video')),audio:_videoAudioBuffers.editA.duration,start:_audioTimelineStarts.editA})`));
  expect(timing.native).toBeGreaterThan(4.9);expect(timing.effective).toBe(timing.native);
  if(kind!=='long')expect(timing.audio).toBeLessThan(2.1);
  if(kind==='delayed')expect(timing.start).toBeGreaterThan(.9);
  const bar=(await page.locator('#videoProgressContainer').boundingBox())!;
  await page.mouse.click(bar.x+bar.width*.9,bar.y+bar.height/2);
  await expect.poll(()=>page.evaluate(()=>(document.querySelector('#layerEditA video') as HTMLVideoElement).currentTime)).toBeGreaterThan(4.4);
  await page.evaluate(()=>(window as any).setLoopPoint('out'));
  expect(await page.evaluate(()=>(window as any).__testAPI._loopOutPoint)).toBeGreaterThan(4.4);
});

test('short Opus audio cannot wrap the picture before its native end',async({page,browserName})=>{
  await loadDecoded(page,files.short);
  await page.evaluate(()=>{const w=window as any;const v=document.querySelector('#layerEditA video') as HTMLVideoElement;v.currentTime=1.6;w.playAllMedia();});
  await expect.poll(()=>page.evaluate(()=>(document.querySelector('#layerEditA video') as HTMLVideoElement).currentTime),{timeout:5000}).toBeGreaterThan(3);
  await expect.poll(()=>page.evaluate(()=>(document.querySelector('#layerEditA video') as HTMLVideoElement).currentTime),{timeout:4000}).toBeLessThan(1);
  if(browserName==='chromium')await expect.poll(()=>page.evaluate(()=>(window as any).eval('!!_opusSyncSources.editA'))).toBe(true);
});

test('Solo and custom loops can inspect the picture after its Opus audio ends',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles([files.short,files.aac]);
  // Metrics can finish before the scrub preview buffer is stored. WebKit sometimes
  // needs longer than the default 5s poll; the required count stays two.
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('Object.keys(_videoAudioBuffers).length')),{timeout:15000}).toBe(2);
  await page.keyboard.press('Shift+s');
  const bounds=await page.evaluate(()=>(window as any).eval(`(() => {
    const slot=assetOrder.find(s=>mediaData[s]?.name==='opus-short.mp4');selectAudioSource(slot);
    const v=getLayer(slot).querySelector('video');v.currentTime=3.5;setLoopPoint('in');v.currentTime=4.5;setLoopPoint('out');
    return {scope:_playbackScope,duration:_getEffectiveDuration(v),bounds:_getLoopBounds()};
  })()`));
  expect(bounds).toMatchObject({scope:'solo',duration:5,bounds:{inP:3.5,outP:4.5}});
  await page.evaluate(()=>(window as any).restartAllVideos());
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('getTransportVideos()[0].currentTime'))).toBeGreaterThan(3.7);
});

for(const kind of ['video','audio']) test(`host ${kind} WebM load respects the single-track boundary`,async({page})=>{
  const audio=kind==='audio',file=audio?files.audio:files.multi;
  await page.evaluate(({name,contentType,base64})=>window.postMessage({type:'WARPDIFF_LOAD',requestId:'webm-tracks',files:[{name,contentType,base64}]},location.origin),
    {name:audio?'two-audio.weba':'two-audio.webm',contentType:audio?'audio/webm':'video/webm',base64:fs.readFileSync(file).toString('base64')});
  await expect.poll(()=>page.evaluate(()=>(window as any).replies.length),{timeout:15000}).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).replies)).toEqual([expect.objectContaining({requestId:'webm-tracks',type:audio?'WARPDIFF_LOAD_FAILED':'WARPDIFF_LOAD_READY'})]);
});
