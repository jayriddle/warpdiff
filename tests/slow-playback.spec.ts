import {test, expect, Page} from '@playwright/test';
import path from 'node:path';

async function setup(page:Page, files=['dialogue_71.mp4']) {
  // Isolated historical injection; never edits the served source or user tab.
  if(process.env.SLOW_PLAYBACK_REGRESSION==='handoff') await page.route('**/js/slow-playback.js',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace('next.connected = true;','')
      .replace('!selected.connected || !engine.state.ready','!engine.state.ready')
      .replace('if (selected.connected) ++revision;','if (engine.state.ready) ++revision;');
    await route.fulfill({response,body});
  });
  await page.goto('/?slowAudio=signalsmith');
  await page.locator('#multiFileInput').setInputFiles(files.map(file=>path.join(__dirname,'fixtures',file)));
  await page.waitForFunction(()=> (window as any).eval('assetOrder.filter(slot=>mediaData[slot]).every(slot=>!!_videoAudioBuffers[slot])'));
}
async function state(page:Page) {
  return page.evaluate(()=> (window as any).eval(`(() => {
    const s=_slowPlayback.state, media=getLayer(s.slot)?.querySelector('video, audio'), route=_nativeAudioRoutes.get(media);
    return {enabled:s.enabled,status:s.status,slot:s.slot,ready:s.ready,bytes:s.bytes,retiringBytes:s.retiringBytes,
      latency:s.latency,anchor:s.anchor,error:s.error,mediaTime:media?.currentTime,rate:media?.playbackRate,
      native:route?.nativeGain?.gain.value,slow:route?.slowGain?.gain.value,
      scrubBytes:_continuousScrubEngine.state.bytes};
  })()`));
}
async function start(page:Page) {
  await page.keyboard.press('j'); await page.keyboard.press('j');
  await page.evaluate(()=> (window as any).eval('playAllMedia()'));
  await expect.poll(async()=> (await state(page)).status).toBe('playing');
  await expect.poll(async()=> (await state(page)).native).toBe(0);
}
async function bands(page:Page) {
  // Flush the processor history (120 ms) plus the analyser window (171 ms).
  await page.waitForTimeout(400);
  return page.evaluate(()=> {
    const a=(window as any).__slowAnalyser, data=new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
    const amplitude=(hz:number)=> {
      let re=0,im=0;
      for(let i=0;i<data.length;i++){let angle=2*Math.PI*hz*i/a.context.sampleRate;re+=data[i]*Math.cos(angle);im+=data[i]*Math.sin(angle);}
      return 2*Math.hypot(re,im)/data.length;
    };
    return {center:amplitude(1500),front:amplitude(375),halfPitch:amplitude(750)};
  });
}

test('slow playback: pitch, verified center controls, original analysis, and shared stream budget', async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await setup(page);
  const before=await page.evaluate(()=> (window as any).eval('JSON.stringify(audioMetrics.editA)'));
  await start(page);
  const first=await state(page);
  expect(first.rate).toBe(.5);expect(first.bytes).toBeGreaterThan(0);expect(first.scrubBytes).toBe(0);
  await page.evaluate(()=> (window as any).eval(`(() => {
    const a=getAudioContext().createAnalyser(); a.fftSize=8192;window.__slowAnalyser=a;
    _nativeAudioRoutes.get(getLayer('editA').querySelector('video')).gain.connect(a);
  })()`));
  const full=await bands(page);
  expect(full.center).toBeGreaterThan(.04);expect(full.front).toBeGreaterThan(.012);
  await page.evaluate(()=> (window as any).eval("setAudioListening({mode:'center'})"));
  const center=await bands(page);
  expect(center.halfPitch/center.center).toBeLessThan(.03);
  expect(center.center/full.center).toBeCloseTo(1,1);expect(center.front/full.front).toBeLessThan(.03);
  await page.evaluate(()=> (window as any).eval("setAudioListening({mode:'full'})"));
  expect((await bands(page)).front/full.front).toBeCloseTo(1,1);
  await page.evaluate(()=> (window as any).eval('setVolume(50)'));
  expect((await bands(page)).center/full.center).toBeCloseTo(.5,1);
  await page.evaluate(()=> (window as any).eval('toggleMute()'));
  expect((await bands(page)).center).toBeLessThan(1e-5);
  await page.evaluate(()=> (window as any).eval('toggleMute();setVolume(100)'));
  expect(await page.evaluate(()=> (window as any).eval('JSON.stringify(audioMetrics.editA)'))).toBe(before);
  await page.evaluate(()=> (window as any).eval('clearAllMedia()'));
  await expect.poll(async()=> {const s=await state(page);return s.bytes+s.retiringBytes;}).toBe(0);
  expect((await state(page)).bytes).toBe(0);expect(errors).toEqual([]);
});

test('slow playback follows pause, seek, restart, speed, source changes, and scrub handoff',async({page})=>{
  await setup(page,['dialogue_71.mp4','dialogue_51.mp4']);await start(page);
  await page.evaluate(()=> (window as any).eval('pauseAllMedia()'));
  await expect.poll(async()=> (await state(page)).anchor).toBeNull();
  await page.evaluate(()=> (window as any).eval("getTransportPlayableMedia().forEach(m=>m.currentTime=4); playAllMedia()"));
  await expect.poll(async()=> (await state(page)).anchor?.offset ?? 0).toBeGreaterThan(4);
  await page.evaluate(()=> (window as any).eval('restartAllVideos()'));
  await expect.poll(async()=> (await state(page)).anchor?.offset ?? 100).toBeLessThan(1);
  const original=(await state(page)).slot;
  await page.evaluate(()=> (window as any).eval('selectAudioSource(assetOrder.find(s=>mediaData[s] && s!==currentAudioSource))'));
  await expect.poll(async()=> (await state(page)).slot).not.toBe(original);
  await expect.poll(async()=> (await state(page)).status).toBe('playing');
  await page.keyboard.press('k');
  await expect.poll(async()=> (await state(page)).anchor?.rate).toBe(.75);
  await page.keyboard.press('k');
  await expect.poll(async()=> (await state(page)).bytes).toBe(0);
  await page.keyboard.press('j'); await page.keyboard.press('j');
  await expect.poll(async()=> (await state(page)).status).toBe('playing');
  await page.evaluate(()=> (window as any).eval('(async()=>{pauseAllMedia();await _slowPlayback.forScrub();await _prepareContinuousScrub();})()'));
  expect((await state(page)).bytes).toBe(0);expect((await state(page)).scrubBytes).toBeGreaterThan(0);
  await page.evaluate(()=> (window as any).eval('playAllMedia()'));
  await expect.poll(async()=> (await state(page)).status).toBe('playing');
  expect((await state(page)).scrubBytes).toBe(0);
  // Change participant and transport again before the outgoing fade retires.
  await page.evaluate(()=> (window as any).eval(`(() => {
    selectAudioSource(assetOrder.find(s=>mediaData[s] && s!==currentAudioSource));
    const m=getLayer(currentAudioSource).querySelector('video');m.playbackRate=.75;
    pauseAllMedia();playAllMedia();
  })()`));
  await expect.poll(async()=> (await state(page)).status).toBe('playing');
  await expect.poll(async()=> (await state(page)).native).toBe(0);
});

test('worklet chunks match one-buffer DSP and retire before context close',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const root=window as any, sr=48000;
    // Exceeds 1 MiB/chunk; chirps and a changing envelope expose cursor errors
    // that steady tones hide. Compare the same patched worklet in one buffer
    // with the shared controller's chunked upload.
    async function render(chunked:boolean) {
      const ctx=new OfflineAudioContext(2,10*sr,sr);
      const input=ctx.createBuffer(2,4*sr,sr);
      for(let c=0;c<2;c++) {
        const p=input.getChannelData(c);
        for(let i=0;i<p.length;i++) p[i]=.2*Math.sin(2*Math.PI*(280*i/sr+50*(i/sr)**2))*(.6+.4*Math.sin(i/sr*3+c));
      }
      let node:any, engine:any;
      if(chunked) {
        engine=root.WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js'});
        if(!await engine.load(ctx,input)) throw Error(engine.state.error);
        node=engine.state.node; await engine.schedule({offset:0,at:.5,rate:.5});
      } else {
        await ctx.audioWorklet.addModule('js/signalsmith-worklet.js');
        node=new AudioWorkletNode(ctx,'signalsmith-stretch',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
        let ready:any;const initialized=new Promise(resolve=>ready=resolve),calls=new Map<number,any>();let id=0;
        node.port.onmessage=(e:any)=>{if(e.data[0]==='ready')ready();else calls.get(e.data[0])?.(e.data[1]);};
        await initialized;
        const rpc=(method:string,args:any[])=>new Promise(resolve=>{calls.set(++id,resolve);node.port.postMessage([id,method,...args]);});
        await rpc('addBuffers',[[input.getChannelData(0).slice(),input.getChannelData(1).slice()]]);
        await rpc('schedule',[{active:true,input:0,output:.5,rate:.5,semitones:0}]);
      }
      node.connect(ctx.destination);
      const output=await ctx.startRendering();node.disconnect();
      // Offline rendering is already closed; a separate live check below tests
      // terminal acknowledgement. Do not pretend this can retire after render.
      node.port.close();
      return output.getChannelData(0);
    }
    const one=await render(false),chunks=await render(true);
    let error=0,energy=0;
    for(let i=0;i<one.length;i++){error+=(one[i]-chunks[i])**2;energy+=one[i]**2;}
    const ctx=new AudioContext();await ctx.resume();
    const engine=root.WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js'});
    await engine.load(ctx,ctx.createBuffer(2,sr,sr));
    const retired=await engine.reset();await ctx.close();
    return {relativeError:Math.sqrt(error/energy),energy,retired,bytes:engine.state.bytes,retiring:engine.state.retiringBytes};
  });
  expect(result.energy).toBeGreaterThan(100);expect(result.relativeError).toBeLessThan(1e-6);
  expect(result.retired).toBe(true);expect(result.bytes+result.retiring).toBe(0);
});

test('playback budget refusal, failed module, and clear during initialization stay bounded',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const root=window as any,ctx=new AudioContext();await ctx.resume();
    const input=ctx.createBuffer(3,48000,ctx.sampleRate),before=input.getChannelData(0).byteLength;
    const errors:string[]=[];
    const tiny=root.WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js',maxBufferBytes:16,onError:(e:string)=>errors.push(e)});
    const refused=await tiny.load(ctx,input);
    const failed=root.WarpPlaybackAudio.create({workletUrl:'js/not-a-worklet.js',onError:(e:string)=>errors.push(e)});
    const missing=await failed.load(ctx,input);
    const cancelled=root.WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js'});
    const preparing=cancelled.load(ctx,input),retired=await cancelled.reset();await preparing;
    const bytes=cancelled.state.bytes+cancelled.state.retiringBytes;
    await ctx.close();
    return {refused,missing,retired,bytes,errors:errors.length,unchanged:before===input.getChannelData(0).byteLength};
  });
  expect(result).toEqual({refused:false,missing:false,retired:true,bytes:0,errors:2,unchanged:true});
});

test('slow playback places a known audio event on its scheduled timeline, including leading silence',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const sr=48000,ctx=new OfflineAudioContext(2,5*sr,sr),input=ctx.createBuffer(2,2*sr,sr);
    for(let c=0;c<2;c++) for(let i=sr;i<sr*1.2;i++) input.getChannelData(c)[i]=.3*Math.sin(2*Math.PI*900*i/sr);
    const engine=(window as any).WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js'});
    await engine.load(ctx,input);engine.state.node.connect(ctx.destination);
    // Negative source offset preserves a .166s empty edit. The center of the
    // 1.0–1.2s tone should be at .5 + (1.1+.166)/.5 = 3.032 output seconds.
    await engine.schedule({offset:-.166,at:.5,rate:.5});
    const output=(await ctx.startRendering()).getChannelData(0);
    let sum=0,weighted=0,early=0;
    for(let i=0;i<output.length;i++){const power=output[i]**2;sum+=power;weighted+=power*i/sr;if(i<sr)early+=power;}
    return {center:weighted/sum,power:sum,early};
  });
  expect(result.power).toBeGreaterThan(100);expect(Math.abs(result.center-3.032)).toBeLessThan(.04);
  expect(result.early).toBeLessThan(1e-12);
});

test('rapid transport cancellation and repeated clear release old processors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(let pass=0;pass<3;pass++) {
    if(!pass) await setup(page);
    else {await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/dialogue_71.mp4'));
      await page.waitForFunction(()=> (window as any).eval('!!_videoAudioBuffers.editA'));}
    await start(page);
    await page.evaluate(()=> (window as any).eval(`(() => {
      const m=getLayer('editA').querySelector('video');
      for(let i=0;i<8;i++){m.currentTime=i/5;m.playbackRate=i%2?.5:.75;}
      pauseAllMedia();
    })()`));
    await expect.poll(async()=> (await state(page)).anchor).toBeNull();
    await page.evaluate(()=> (window as any).eval('clearAllMedia()'));
    await expect.poll(async()=> (await state(page)).retiringBytes+(await state(page)).bytes).toBe(0);
  }
  expect(errors).toEqual([]);
});
