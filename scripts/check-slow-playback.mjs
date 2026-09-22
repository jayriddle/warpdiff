// Local, muted real-file probe. Does not change the user's browser or source.
// node scripts/check-slow-playback.mjs INPUT.mp4 OUTPUT.json [SECONDS=20]
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [input,output,seconds='20']=process.argv.slice(2);
if(!input||!output)throw Error('Supply input media and output JSON paths');
const report={sourceSha256:createHash('sha256').update(await readFile(input)).digest('hex'),errors:[]};
const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
try {
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://localhost:8080/?slowAudio=signalsmith');
  await page.locator('#multiFileInput').setInputFiles(path.resolve(input));
  await page.waitForFunction(()=>eval('!!_videoAudioBuffers.editA'));
  report.environment=await page.evaluate(()=>eval('({userAgent:navigator.userAgent,version:APP_VERSION,sampleRate:getAudioContext().sampleRate,channels:_videoAudioBuffers.editA.numberOfChannels})'));
  await page.keyboard.press('j');await page.keyboard.press('j');
  await page.evaluate(()=>eval('playAllMedia()'));
  await page.waitForFunction(()=>eval('_slowPlayback.state.status === "playing"'));
  report.trace=await page.evaluate(async seconds=>{
    const trace=[],ctx=eval('getAudioContext()'),media=document.querySelector('#layerEditA video');
    const route=eval('_nativeAudioRoutes.get(getLayer("editA").querySelector("video"))');
    const analyser=ctx.createAnalyser();analyser.fftSize=2048;route.gain.connect(analyser);const samples=new Float32Array(2048);
    let frame=null;
    const frameCallback=(now,meta)=>{frame={pts:meta.mediaTime,at:now};if(!media.paused)media.requestVideoFrameCallback(frameCallback);};
    media.requestVideoFrameCallback(frameCallback);
    const end=performance.now()+seconds*1000;
    while(performance.now()<end) {
      const s=eval('_slowPlayback.state');analyser.getFloatTimeDomainData(samples);
      trace.push({at:performance.now(),ctx:ctx.currentTime,media:media.currentTime,frame,rate:media.playbackRate,
        anchor:s.anchor,status:s.status,bytes:s.bytes,retiring:s.retiringBytes,scrub:eval('_continuousScrubEngine.state.bytes'),
        native:route.nativeGain.gain.value,slow:route.slowGain.gain.value,output:ctx.getOutputTimestamp(),
        peak:samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0),nonfinite:samples.some(x=>!Number.isFinite(x))});
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    route.gain.disconnect(analyser);return trace;
  },Number(seconds));
  await page.evaluate(()=>eval('clearAllMedia()'));
  await page.waitForFunction(()=>eval('_slowPlayback.state.bytes + _slowPlayback.state.retiringBytes === 0'));
  report.after=await page.evaluate(()=>eval('({bytes:_slowPlayback.state.bytes,retiring:_slowPlayback.state.retiringBytes,context:audioContext})'));
  const active=report.trace.filter(t=>t.anchor&&t.native===0&&t.at>=t.output.performanceTime);
  const drifts=active.map(t=>{
    const audible=t.output.contextTime+(t.at-t.output.performanceTime)/1000;
    return Math.abs(t.anchor.offset+(audible-t.anchor.at)*t.anchor.rate-t.media);
  }).sort((a,b)=>a-b);
  report.summary={samples:report.trace.length,qualitySamples:active.length,
    modeledClockDriftP95Seconds:drifts[Math.floor(drifts.length*.95)],modeledClockDriftMaxSeconds:drifts.at(-1),
    anchors:new Set(report.trace.map(t=>t.anchor?.at).filter(Boolean)).size,
    maxPCMBytes:Math.max(...report.trace.map(t=>t.bytes+t.retiring+t.scrub)),
    invalidAudio:report.trace.some(t=>t.nonfinite),peak:Math.max(...report.trace.map(t=>t.peak))};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({environment:report.environment,summary:report.summary,after:report.after,errors:report.errors},null,2));
  if(report.errors.length||report.summary.invalidAudio||!active.length)process.exitCode=1;
} finally {await browser.close();}
