import {test, expect, Page} from '@playwright/test';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

async function load(page:Page, filename='dialogue_51.mp4') {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion','3.17.0'));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures',filename));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  await page.waitForFunction(() => (window as any).eval('!!_continuousScrubEngine.state.node'));
}
async function audioWait(page:Page, seconds=.25) {
  await page.evaluate(async seconds => {
    const ctx=(window as any).eval('getAudioContext()'); await ctx.resume();
    const end=ctx.currentTime+seconds, deadline=performance.now()+5000;
    while(ctx.currentTime<end && performance.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    if(ctx.currentTime<end) throw Error('Audio clock did not advance');
  },seconds);
}
async function bands(page:Page) {
  return page.evaluate(() => {
    const a=(window as any).__dialogueAnalyser, data=new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
    const amplitude=(hz:number) => {
      let real=0,imag=0;
      for(let i=0;i<data.length;i++){const angle=2*Math.PI*hz*i/a.context.sampleRate;real+=data[i]*Math.cos(angle);imag+=data[i]*Math.sin(angle);}
      return 2*Math.hypot(real,imag)/data.length;
    };
    return {center:amplitude(1500),front:amplitude(375),surround:amplitude(3000)};
  });
}

for(const channels of [6,8]) for(const output of ['native','continuous','replacement']) {
  test(`dialogue ${channels}ch ${output}: center and background controls preserve source and clocks`,async({page})=>{
    await load(page,`dialogue_${channels===6?'51':'71'}.mp4`);
    const before=await page.evaluate(()=> (window as any).eval(`({metrics:JSON.stringify(audioMetrics.editA),start:_audioTimelineStarts.editA,
      channels:_videoAudioBuffers.editA.numberOfChannels,bytes:_continuousScrubEngine.state.bytes,
      length:_videoAudioBuffers.editA.length,originalChannels:_audioMonitorSlots.get('editA').channels})`));
    expect(before.channels).toBe(3);expect(before.originalChannels).toBe(channels);
    expect(before.bytes).toBe(before.length*3*4);
    await page.locator('#audioListeningLabel').click();
    await expect(page.getByRole('button',{name:'Dialogue Focus',exact:true})).toBeEnabled();
    await page.evaluate(async ({output,channels})=>{
      const evaluate=(code:string)=>(window as any).eval(code);
      if(output==='replacement') {
        const video=document.querySelector('#layerEditA video') as HTMLVideoElement;
        const raw=await evaluate('getAudioContext()').decodeAudioData(await (await fetch(video.src)).arrayBuffer());
        (window as any).__rawDialogue=raw;
        await evaluate(`(async()=>{_opusSyncPending.editA=true;await _finalizeAudioViz('editA',window.__rawDialogue,undefined,0,'${channels===6?'5.1':'7.1'}');})()`);
      }
      const ctx=evaluate('getAudioContext()'); await ctx.resume();
      const a=ctx.createAnalyser();a.fftSize=8192;(window as any).__dialogueAnalyser=a;
      if(output==='continuous') {
        await evaluate('_prepareContinuousScrub()');
        evaluate(`_continuousScrubEngine.update({offset:1,tempo:1,level:1,continuous:false})`);
        evaluate('_continuousScrubEngine.state.gain').connect(a);
        (window as any).__dialogueNode=evaluate('_continuousScrubEngine.state.node');
      } else {
        evaluate('playAllMedia()');
        await new Promise(resolve=>setTimeout(resolve,80));
        evaluate(output==='replacement'?"_opusSyncGains.editA":"_nativeAudioRoutes.get(document.querySelector('#layerEditA video')).gain").connect(a);
      }
      (window as any).__dialogueSeeks=0;
      document.querySelector('#layerEditA video')!.addEventListener('seeking',()=> (window as any).__dialogueSeeks++);
    },{output,channels});
    await audioWait(page);
    const full=await bands(page);
    expect(full.center).toBeGreaterThan(.04);expect(full.front).toBeGreaterThan(.012);expect(full.surround).toBeGreaterThan(.006);
    await page.getByRole('button',{name:'Dialogue Focus',exact:true}).click();await audioWait(page);
    const focused=await bands(page);
    expect(focused.center/full.center).toBeCloseTo(1,1);
    expect(focused.front/full.front).toBeCloseTo(10**(-9/20),1);
    await page.getByRole('button',{name:'Center Only',exact:true}).click();await audioWait(page);
    const center=await bands(page);
    expect(center.center/full.center).toBeCloseTo(1,1);
    expect(center.front/full.front).toBeLessThan(.02);expect(center.surround/full.surround).toBeLessThan(.02);
    await page.locator('#dialogueCenterLevel').fill('6');await audioWait(page);
    expect((await bands(page)).center/full.center).toBeCloseTo(10**(6/20),1);
    await page.getByRole('button',{name:'Full Mix',exact:true}).click();await audioWait(page);
    const restored=await bands(page);
    expect(restored.front/full.front).toBeCloseTo(1,1);expect(restored.center/full.center).toBeCloseTo(1,1);
    const after=await page.evaluate(()=> (window as any).eval(`({metrics:JSON.stringify(audioMetrics.editA),start:_audioTimelineStarts.editA,
      seeks:window.__dialogueSeeks,sameNode:window.__dialogueNode===_continuousScrubEngine.state.node})`));
    expect(after.metrics).toBe(before.metrics);expect(after.start).toBe(before.start);expect(after.seeks).toBe(0);
    if(output==='continuous')expect(after.sameNode).toBe(true);
    await page.evaluate(()=> (window as any).eval('clearAllMedia()'));
    expect(await page.evaluate(()=> (window as any).eval('_audioMonitorSlots.size+_audioMonitorRoutes.size+_continuousScrubEngine.state.bytes'))).toBe(0);
  });
}

for(const [file,channels] of [['dialogue_51_opus.mp4',6],['dialogue_71_opus.mp4',8],['dialogue_51_aac.mp4',6]] as const) {
  test(`codec center identity survives decode and Continuous: ${file}`,async({page})=>{
    await load(page,file);
    const source=await page.evaluate(()=> (window as any).eval(`({channels:audioMetrics.editA.channels,layout:_audioMonitorSlots.get('editA').layout,
      duration:_videoAudioBuffers.editA.duration,start:_audioTimelineStarts.editA})`));
    expect(source.channels).toBe(channels);expect(source.layout).toBe(channels===6?'5.1':'7.1');
    expect(source.duration).toBeCloseTo(8,2);expect(source.start).toBe(0);
    if(file.includes('opus')) {
      // FFmpeg applies the Opus pre-skip once. Comparing actual decoded samples
      // catches a double trim or channel reorder hidden by duration clipping.
      const reference=execFileSync('ffmpeg',['-v','error','-i',path.join(__dirname,'fixtures',file),'-vn','-af','pan=mono|c0=c2','-t','0.05','-ar','48000','-c:a','pcm_f32le','-f','f32le','-']);
      const expected=Array.from({length:reference.length/4},(_,i)=>reference.readFloatLE(i*4));
      const difference=await page.evaluate(expected=> (window as any).eval(`(() => {
        const actual=_videoAudioBuffers.editA.getChannelData(2), expected=${JSON.stringify(expected)};
        return Math.sqrt(expected.reduce((sum,v,i)=>sum+(actual[i]-v)**2,0)/expected.reduce((sum,v)=>sum+v*v,0));
      })()`),expected);
      expect(difference).toBeLessThan(.01);
    }
    await page.evaluate(()=> (window as any).eval(`(async()=>{
      const ctx=getAudioContext();await ctx.resume();const a=ctx.createAnalyser();a.fftSize=8192;window.__dialogueAnalyser=a;
      _continuousScrubEngine.update({offset:1,tempo:1,level:1,continuous:false});_continuousScrubEngine.state.gain.connect(a);
    })()`));
    await audioWait(page);const full=await bands(page);
    expect(full.front).toBeGreaterThan(.012);expect(full.center).toBeGreaterThan(.04);
    await page.evaluate(()=> (window as any).eval("setAudioListening({mode:'center'})"));
    await audioWait(page);const center=await bands(page);
    expect(center.center/full.center).toBeCloseTo(1,1);expect(center.front/full.front).toBeLessThan(.02);
  });
}

test('dialogue short previews use the same center mix',async({page})=>{
  await load(page);
  const sample=async(mode:string)=>{
    await page.evaluate(mode=> (window as any).eval(`(async()=>{
      setAudioListening({mode:'${mode}',centerDb:0});const ctx=getAudioContext();await ctx.resume();
      playScrubSnippet(1);const a=ctx.createAnalyser();a.fftSize=1024;_scrubGain.connect(a);window.__dialogueAnalyser=a;
    })()`),mode);
    await audioWait(page,.035);return bands(page);
  };
  const full=await sample('full'),center=await sample('center');
  expect(full.center).toBeGreaterThan(.02);expect(full.front).toBeGreaterThan(.006);
  expect(center.center).toBeGreaterThan(.02);expect(center.front/center.center).toBeLessThan(.01);
});

test('dialogue controls keep keyboard focus, show unsupported files, and reset on clear',async({page})=>{
  await load(page);
  await page.locator('#audioListeningLabel').click();
  await page.getByRole('button',{name:'Dialogue Focus',exact:true}).click();
  await page.locator('#dialogueCenterLevel').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#dialogueCenterValue')).toHaveText('+1 dB');
  await page.keyboard.press('Escape');await expect(page.locator('#audioListeningLabel')).toBeFocused();
  await expect(page.locator('#audioListeningControl')).not.toHaveAttribute('open','');
  await page.evaluate(()=> (window as any).eval('clearAllMedia()'));
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures','side_lr.mp4'));
  await page.waitForFunction(()=> (window as any).eval('!!_videoAudioBuffers.editA'));
  await page.locator('#audioListeningLabel').click();
  await expect(page.getByRole('button',{name:'Center Only',exact:true})).toBeDisabled();
  await expect(page.locator('#audioListeningStatus')).toContainText('no separate center');
  await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Full Mix');
  await page.evaluate(()=> (window as any).eval(`(async()=>{
    await _finalizeAudioViz('editA',getAudioContext().createBuffer(8,4800,48000));
  })()`));
  await expect(page.getByRole('button',{name:'Center Only',exact:true})).toBeDisabled();
  await expect(page.locator('#audioListeningStatus')).toContainText('could not be verified');
});

test('dialogue settings follow source handoffs and verified audio-only files',async({page})=>{
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion','3.17.0'));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(['dialogue_51.mp4','side_lr.mp4','dialogue_71.mp4'].map(name=>path.join(__dirname,'fixtures',name)));
  await page.waitForFunction(()=> (window as any).eval("Object.keys(_videoAudioBuffers).length === 3 && [..._audioMonitorSlots.values()].filter(info=>info.ready).length === 2"));
  // Files are assigned by modification time; address sources by their identity.
  const select=async(name:string)=>page.evaluate(name=> (window as any).eval(`selectAudioSource(assetOrder.find(slot=>mediaData[slot]?.name===${JSON.stringify(name)}))`),name);
  await select('dialogue_51.mp4');
  await page.evaluate(()=> (window as any).eval("setAudioListening({mode:'dialogue',centerDb:6,otherDb:-12})"));
  await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Dialogue Focus');
  await select('side_lr.mp4');
  await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Full Mix');
  await expect(page.locator('#audioListeningStatus')).toContainText('no separate center');
  await select('dialogue_71.mp4');
  await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Dialogue Focus');
  await expect(page.locator('#dialogueCenterLevel')).toHaveValue('6');
  await expect(page.locator('#dialogueOtherLevel')).toHaveValue('-12');
  await expect(page.locator('#audioListeningStatus')).toContainText('7.1 center');
  await page.evaluate(()=> (window as any).clearAllMedia());
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures','surround_71.wav'));
  await page.waitForFunction(()=> (window as any).eval("!!_audioSlotVizData.editA"));
  // The audio-only display and W panel have separate decode owners. Force the
  // lazy panel decode to finish last; it must retain the same verified layout.
  await page.evaluate(()=> (window as any).eval(`(async()=>{
    const bytes=await (await fetch(getLayer('editA').querySelector('audio').src)).arrayBuffer();
    await decodeAndComputeAudioViz('editA',bytes);
  })()`));
  expect(await page.evaluate(()=> (window as any).eval("_audioMonitorSlots.get('editA').ready"))).toBe(true);
  await page.locator('#audioListeningLabel').click();
  await expect(page.locator('#audioListeningLabel')).toHaveText('Listen: Full Mix');
  await page.getByRole('button',{name:'Center Only',exact:true}).click();
  await expect(page.locator('#audioListeningStatus')).toContainText('7.1 center');
  expect(await page.evaluate(()=> (window as any).eval("({mode:_audioListening.mode,other:[..._audioMonitorSlots.keys()].map(slot=>_audioMonitorPlanForSlot(slot).otherGain)})"))).toEqual({mode:'center',other:[0]});
});

test('dialogue preparation retains filtered center within budget and cancels stale publication',async({page})=>{
  await load(page);
  const result=await page.evaluate(()=> (window as any).eval(`(async()=>{
    const input=getAudioContext().createBuffer(6,48000,48000);input.getChannelData(2).fill(.8);input.getChannelData(0).fill(.6);
    const before=input.getChannelData(2)[100];
    const peaks=await WarpScrubAudio.monitor.peaks(input,'5.1');
    const boost=WarpScrubAudio.monitor.plan({mode:'dialogue',centerDb:12,otherDb:0},peaks);
    const plan=_scrubPreviewPlan(input,48000,192000,'5.1');
    const filtered=await WarpScrubAudio.listeningBuffer(input,{sampleRate:plan.sampleRate},()=>true,'5.1');
    const pending=_finalizeAudioViz('editB',getAudioContext().createBuffer(6,480000,48000),undefined,0,'5.1');
    clearAllMedia();await pending;
    return {before,after:input.getChannelData(2)[100],plan,channels:filtered.numberOfChannels,center:filtered.getChannelData(2)[1000],
      left:filtered.getChannelData(0)[1000],maxBound:boost.otherGain*peaks.other+Math.SQRT1_2*boost.centerGain*peaks.center,
      headroom:boost.headroomDb,stale:_audioMonitorSlots.size};
  })()`));
  expect(result.before).toBe(result.after);expect(result.channels).toBe(3);expect(result.plan.bytes).toBeLessThanOrEqual(192000);
  expect(result.center).toBeCloseTo(.8,5);expect(result.left).toBeCloseTo(.6+.8*Math.SQRT1_2,5);
  expect(result.maxBound).toBeLessThanOrEqual(.980001);expect(result.headroom).toBeLessThan(0);expect(result.stale).toBe(0);
});
