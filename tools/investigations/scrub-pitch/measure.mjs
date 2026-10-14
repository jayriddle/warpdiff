// Read-only diagnostic: real prepared AAC PCM, shipped snippet function and
// pinned Continuous DSP. Offline renders do not exercise speakers or gestures.
import {chromium, webkit} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const folder = path.resolve(process.argv[2] || 'output/safari-scrub-pitch-2026-10-13');
await mkdir(folder,{recursive:true});
const input = path.resolve('tests/fixtures/ac3_video_aac.mp4');
const report = {at:new Date().toISOString(), input:path.basename(input),
  sha256:createHash('sha256').update(await readFile(input)).digest('hex'),
  method:'Offline renders; snippet context/destination substituted only in isolated pages; Continuous message acknowledgment appended without DSP edits.',
  browsers:[]};
for (const [name, type] of [['chromium',chromium], ['webkit',webkit]]) {
  const browser = await type.launch({headless:true, ...(name==='chromium' ? {args:['--mute-audio','--autoplay-policy=no-user-gesture-required']} : {})});
  const result = {name, errors:[], renders:[]}; report.browsers.push(result);
  try {
    const page = await browser.newPage({serviceWorkers:'block'});
    page.on('pageerror', error => result.errors.push(error.message));
    await page.goto('http://localhost:8080/');
    await page.locator('#multiFileInput').setInputFiles(input);
    await page.waitForFunction(() => !!_videoAudioBuffers.editA, null, {timeout:60000});
    result.environment = await page.evaluate(() => ({version:APP_VERSION, userAgent:navigator.userAgent,
      channels:_videoAudioBuffers.editA.numberOfChannels, sampleRate:_videoAudioBuffers.editA.sampleRate,
      duration:_videoAudioBuffers.editA.duration, timelineStart:_audioTimelineStarts.editA,
      pinned:WarpScrubAudio.version}));
    await page.evaluate(() => {
      window.__pitchStats = (pcm, sr, from, to, windowSize=4096) => {
        const N=32768, lo=Math.round(from*sr), hi=Math.min(pcm.length,Math.round(to*sr));
        const frequencies=[]; let power=0;
        for(let i=lo;i<hi;i++) power+=pcm[i]*pcm[i];
        for(let start=lo;start+windowSize<=hi;start+=Math.round(windowSize/2)) {
          const re=new Float64Array(N), im=new Float64Array(N);
          for(let i=0;i<windowSize;i++) re[i]=pcm[start+i]*(.5-.5*Math.cos(2*Math.PI*i/(windowSize-1)));
          fft(re,im);
          let peak=0, kmax=0;
          for(let k=Math.ceil(50*N/sr);k<=Math.floor(1500*N/sr);k++) {
            const p=re[k]*re[k]+im[k]*im[k]; if(p>peak){peak=p;kmax=k;}
          }
          const logPower=k=>Math.log(Math.max(1e-30,re[k]*re[k]+im[k]*im[k]));
          const a=logPower(kmax-1),b=logPower(kmax),c=logPower(kmax+1);
          frequencies.push((kmax+.5*(a-c)/(a-2*b+c))*sr/N);
        }
        return {rms:Math.sqrt(power/(hi-lo)), frequencyHz:frequencies,
          minHz:Math.min(...frequencies), maxHz:Math.max(...frequencies)};
      };
    });
    result.reference = await page.evaluate(() => __pitchStats(_videoAudioBuffers.editA.getChannelData(0),_videoAudioBuffers.editA.sampleRate,.2,.8));
    for (const rate of [.25,.5,.75,1,1.5,2]) {
      const row = await page.evaluate(async rate => {
        const ctx = new OfflineAudioContext(2,48000*.12,48000);
        const get=getAudioContext, output=_setScrubPreviewOutput, index=playbackRateIndex;
        try {
          getAudioContext=()=>ctx; _setScrubPreviewOutput=()=>ctx.destination;
          playbackRateIndex=PLAYBACK_RATES.indexOf(rate);
          playScrubSnippet(.3);
          const actualRate=_scrubSource.playbackRate.value;
          const rendered=await ctx.startRendering();
          return {kind:'snippet',rate,actualRate,...__pitchStats(rendered.getChannelData(0),48000,.012,.078,2048)};
        } finally {
          _stopScrubAudioNodes();getAudioContext=get;_setScrubPreviewOutput=output;playbackRateIndex=index;
        }
      },rate);
      result.renders.push(row); console.log(name,JSON.stringify(row));
    }
    for (const tempo of [.25,.5,1,1.5,2]) for (const direction of [1,-1]) {
      const row = await page.evaluate(async ({tempo,direction}) => {
        const source=_videoAudioBuffers.editA, sr=48000;
        const text=await (await fetch('js/scrub-worklet.js')).text();
        const url=URL.createObjectURL(new Blob([text+'\nconst original=PhaseVocoderProcessor.prototype._msg;PhaseVocoderProcessor.prototype._msg=function(d){original.call(this,d);if(d.type==="play"&&d.value)this.port.postMessage({type:"pitch-ready"});};'],{type:'text/javascript'}));
        const ctx=new OfflineAudioContext(2,Math.ceil(.65/tempo*sr),sr);
        const engine=WarpScrubAudio.create({workletUrl:url,matchSourceLevel:true});
        if(!await engine.load(ctx,source))throw Error(engine.state.error);
        const node=engine.state.node;
        const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No acknowledgment')),8000);node.port.onmessage=e=>{if(e.data.type==='pitch-ready'){clearTimeout(timer);resolve();}};});
        engine.update({offset:direction>0?.2:.8,tempo,direction,continuous:false,level:1});
        await ready; URL.revokeObjectURL(url);
        const rendered=await ctx.startRendering();node.disconnect();node.port.close();
        return {kind:'continuous',tempo,direction,...__pitchStats(rendered.getChannelData(0),sr,.08,.55/tempo)};
      },{tempo,direction});
      result.renders.push(row);console.log(name,JSON.stringify(row));
    }
    await page.evaluate(()=>clearAllMedia());
  } catch(error) {result.errors.push(String(error.stack||error));console.error(name,error);}
  finally {await browser.close();}
  await writeFile(folder+'/measurement.json',JSON.stringify(report,null,2)+'\n');
}
if(report.browsers.some(b=>b.errors.length))process.exitCode=1;
