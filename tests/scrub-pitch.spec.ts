import {test, expect} from '@playwright/test';
import path from 'node:path';
import {moveHeldPointer} from './helpers/scrub-motion';

test.use({serviceWorkers:'block'});
test.afterEach(async({page},info)=>{
  const evidence=await page.evaluate(()=>(window as any).__pitchChecks||[]).catch(()=>[]);
  if(evidence.length)await info.attach('gesture-preview-rates',{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});
});

test('brief preview PCM retains source pitch and level at every selected playback speed', async ({page}, info) => {
  await page.goto('/');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const sr=48000, input=new AudioBuffer({numberOfChannels:2,length:sr,sampleRate:sr});
    for(let i=0;i<sr;i++) {
      input.getChannelData(0)[i]=.2*Math.sin(2*Math.PI*440*i/sr);
      input.getChannelData(1)[i]=.2*Math.sin(2*Math.PI*660*i/sr);
    }
    const originals=[input.getChannelData(0).slice(),input.getChannelData(1).slice()];
    const savedContext=getAudioContext, savedOutput=_setScrubPreviewOutput;
    _videoAudioBuffers.editA=input; _audioTimelineStarts.editA=0;
    currentAudioSource='editA'; isMuted=false; audioMuteStates.editA=false;
    _prefs.save('volume',50);
    const spectrum=pcm=>{
      const N=32768, size=2048, re=new Float64Array(N), im=new Float64Array(N);
      for(let i=0;i<size;i++)re[i]=pcm[720+i]*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));
      fft(re,im);
      let bin=0,peak=0;
      for(let k=Math.ceil(50*N/sr);k<Math.floor(1500*N/sr);k++){
        const power=re[k]*re[k]+im[k]*im[k];if(power>peak){peak=power;bin=k;}
      }
      const logPower=k=>Math.log(Math.max(1e-30,re[k]*re[k]+im[k]*im[k]));
      const a=logPower(bin-1),b=logPower(bin),c=logPower(bin+1);
      let sum=0,tailPeak=0;
      for(let i=720;i<3600;i++)sum+=pcm[i]*pcm[i];
      for(let i=4560;i<pcm.length;i++)tailPeak=Math.max(tailPeak,Math.abs(pcm[i]));
      return {frequency:(bin+.5*(a-c)/(a-2*b+c))*sr/N,rms:Math.sqrt(sum/2880),tailPeak};
    };
    const rows=[];
    try {
      for(let index=0;index<PLAYBACK_RATES.length;index++) {
        const ctx=new OfflineAudioContext(2,5760,sr);
        getAudioContext=()=>ctx; _setScrubPreviewOutput=()=>ctx.destination;
        playbackRateIndex=index; playScrubSnippet(.2);
        const outputDuration=_scrubSourceSnippetLen;
        const rendered=await ctx.startRendering();
        rows.push({selectedRate:PLAYBACK_RATES[playbackRateIndex],outputDuration,
          channels:[spectrum(rendered.getChannelData(0)),spectrum(rendered.getChannelData(1))]});
        _stopScrubAudioNodes();
      }
      return {rows,sourceUnchanged:originals.every((pcm,c)=>pcm.every((value,i)=>value===input.getChannelData(c)[i]))};
    } finally {
      _stopScrubAudioNodes();getAudioContext=savedContext;_setScrubPreviewOutput=savedOutput;
    }
  })()`));
  await info.attach('brief-preview-spectrum',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
  expect(result.sourceUnchanged).toBe(true);
  expect(result.rows.map((r:any)=>r.selectedRate)).toEqual([.25,.5,.75,1,1.25,1.5,2]);
  for(const row of result.rows) {
    expect(row.outputDuration).toBeCloseTo(.09,6);
    for(const [channel,frequency] of [[0,440],[1,660]]) {
      const measured=row.channels[channel];
      expect(measured.frequency,`${row.selectedRate}× channel ${channel} pitch`).toBeCloseTo(frequency,0);
      expect(measured.rms).toBeGreaterThan(.068);
      expect(measured.rms).toBeLessThan(.073);
      expect(measured.tailPeak).toBeLessThan(.00001);
    }
  }
});

for(const mode of ['entry','direct','fallback']) test(`${mode==='fallback'?'fallback':mode==='direct'?'direct Continuous entry':'Continuous entry'} previews retain pitch policy in both drag directions without changing playback speed`, async ({page},info) => {
  const fallback=mode==='fallback';
  // Physically silence the native WebKit preview player only in this test page.
  await page.addInitScript(() => {
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){
      if(this.dataset.scrubPreviewOutput!==undefined)this.muted=true;
      return play.call(this);
    };
  });
  await page.goto('/');
  if(mode==='direct')await page.evaluate(()=>(window as any).eval(`
    // Model the hosted native seek completing only after motion starts.
    const feed=_feedScrubAudio;
    _feedScrubAudio=time=>{if(WarpScrubAudio.motionVelocity(_scrubMotionSamples))feed(time);};
  `));
  if(fallback) await page.evaluate(() => (window as any).eval(`
    Object.getPrototypeOf(getAudioContext().audioWorklet).addModule=()=>Promise.reject(new Error('Test short-preview fallback'));
  `));
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/landscape_a.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  await page.waitForFunction(field => (window as any).eval('!!_continuousScrubEngine.state.'+field),fallback?'error':'node');
  await expect(page.locator('#comparisonView.active')).toBeVisible();
  await page.evaluate(() => (window as any).eval(`
    pauseAllMedia(); window.__pitchGrains=[];window.__pitchChecks=[];
    const play=playScrubSnippet;
    playScrubSnippet=time=>{
      const prior=_scrubSource;play(time);
      if(_scrubSource&&_scrubSource!==prior)__pitchGrains.push({time,rate:_scrubSource.playbackRate.value});
    };
    // Read while the held gesture is still active. Hosted tracing can delay a
    // separate driver evaluate past the app's legitimate 130ms idle cutoff.
    window.scrubMotionState=()=>({
      motionAge:performance.now()-_scrubAudioMotionAt,
      grains:__pitchGrains.slice(),continuous:_continuousScrubEngine.state.active,
      direction:_continuousScrubCursor?.direction,selectedRate:PLAYBACK_RATES[playbackRateIndex],
      mediaRate:document.querySelector('#layerEditA video').playbackRate
    });
  `));
  const box=(await page.locator('#videoProgressContainer').boundingBox())!;
  for(const speed of [.5,1,2]) {
    while(await page.evaluate(speed=>(window as any).eval('PLAYBACK_RATES[playbackRateIndex]')>speed,speed))await page.keyboard.press('j');
    while(await page.evaluate(speed=>(window as any).eval('PLAYBACK_RATES[playbackRateIndex]')<speed,speed))await page.keyboard.press('k');
    for(const direction of [1,-1]) {
      const start=direction>0?.2:.6,end=direction>0?.6:.2,y=box.y+box.height/2;
      await page.evaluate(() => { (window as any).__pitchGrains=[]; });
      await page.mouse.move(box.x+box.width*start,y);await page.mouse.down();
      const sweep=await moveHeldPointer(page,Array.from({length:12},(_,i)=>({x:box.x+box.width*(start+(end-start)*(i+1)/12),y})),40,false,true);
      const active=sweep.trace[sweep.trace.length-1].state;
      if(!fallback&&speed===.5&&direction===-1) {
        // Reproduce the hosted driver's late read: idle is correct now, while
        // the captured sample must still prove Continuous during motion.
        await page.waitForTimeout(180);
        expect(await page.evaluate(()=>(window as any).__testAPI.continuousScrubState.active)).toBe(false);
      }
      await page.mouse.up();
      await page.evaluate(check=>{(window as any).__pitchChecks.push(check);},{speed,direction,maximumInputGap:sweep.maximumInputGap,...active});
      expect(sweep.maximumInputGap).toBeLessThan(130);
      expect(active.motionAge,'sample must be inside the actual motion window').toBeLessThan(130);
      expect(active.selectedRate).toBe(speed);expect(active.mediaRate).toBe(speed);
      // A ready processor may enter Continuous directly if native seeking
      // delivers the first position after motion has begun. Forced fallback
      // must emit grains; every grain emitted by either path must retain pitch.
      if(fallback)expect(active.grains.length).toBeGreaterThan(0);
      if(mode==='direct')expect(active.grains).toHaveLength(0);
      expect(active.grains.every((g:any)=>g.rate===1)).toBe(true);
      expect(active.continuous).toBe(!fallback);
      if(!fallback)expect(active.direction).toBe(direction);
      await expect.poll(() => page.evaluate(() => (window as any).eval('!!_scrubSource || _continuousScrubEngine.state.active'))).toBe(false);
    }
  }
  await page.evaluate(() => (window as any).clearAllMedia());
  await expect(page.locator('audio[data-scrub-preview-output]')).toHaveCount(0);
});
