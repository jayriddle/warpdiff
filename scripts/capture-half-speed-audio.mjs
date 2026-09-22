// Local diagnostic only. Requires the existing dev server and Playwright dev dependency.
// Usage: node scripts/capture-half-speed-audio.mjs INPUT.mp4 OUTPUT_DIRECTORY
// Private audio stays in OUTPUT_DIRECTORY; do not commit the generated WAV files.
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Supply an input video and output directory.');
const outDir = path.resolve(output);
await mkdir(outDir, {recursive:true});
const browser = await chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const captures = [];
const report = {input:path.resolve(input), sourceSha256:createHash('sha256').update(await readFile(input)).digest('hex'),
  capturedAt:new Date().toISOString(), errors:[], captures:[]};

function stats(channels, sampleRate) {
  const frames=channels[0].length;
  let peak=0, sum=0, over=0, invalid=0, first=frames, last=-1, silentRun=0, longest=0;
  for(let i=0;i<frames;i++) {
    let active=false;
    for(const channel of channels) {
      const value=channel[i];
      if(!Number.isFinite(value)) invalid++;
      peak=Math.max(peak,Math.abs(value)); sum+=value*value;
      if(Math.abs(value)>1) over++;
      if(Math.abs(value)>1e-7) active=true;
    }
    if(active) {first=Math.min(first,i);last=i;if(first<i)longest=Math.max(longest,silentRun);silentRun=0;}
    else if(last>=0) silentRun++;
  }
  return {frames, sampleRate, channels:channels.length, duration:frames/sampleRate, peak,
    peakDbfs:peak>0?20*Math.log10(peak):null,
    rmsDbfs:sum>0?10*Math.log10(sum/(frames*channels.length)):null,
    samplesAboveFullScale:over, nonfiniteSamples:invalid,
    firstActiveSeconds:first/sampleRate, lastActiveSeconds:last/sampleRate,
    longestInternalNearZeroSeconds:longest/sampleRate};
}
function wav(channels, sampleRate, gain=1, floating=false) {
  const n=channels.length, frames=channels[0].length, bytes=floating?4:2;
  const data=Buffer.alloc(44+frames*n*bytes);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(floating?3:1,20);data.writeUInt16LE(n,22);
  data.writeUInt32LE(sampleRate,24);data.writeUInt32LE(sampleRate*n*bytes,28);
  data.writeUInt16LE(n*bytes,32);data.writeUInt16LE(bytes*8,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
  let at=44;
  for(let i=0;i<frames;i++) for(const channel of channels) {
    if(floating) data.writeFloatLE(channel[i],at);
    else data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channel[i]*gain))*32767),at);
    at+=bytes;
  }
  return data;
}
function decode(result) {
  return result.planes.map(encoded=>{
    const bytes=Buffer.from(encoded,'base64'), samples=new Float32Array(bytes.length/4);
    for(let i=0;i<samples.length;i++) samples[i]=bytes.readFloatLE(i*4);
    return samples;
  });
}

try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(process.env.WARPDIFF_URL || 'http://localhost:8080/');
  await page.locator('#multiFileInput').setInputFiles(path.resolve(input));
  await page.waitForFunction(()=>{
    const video=document.querySelector('#layerEditA video');
    return video && video.readyState>=2 && !video.seeking && !!_videoAudioBuffers.editA
      && (!_audioMonitorSlots.get('editA')?.layout || _audioMonitorSlots.get('editA')?.ready);
  },null,{timeout:60000});
  report.environment=await page.evaluate(()=>({version:APP_VERSION,userAgent:navigator.userAgent,
    sampleRate:getAudioContext().sampleRate,previewRate:_videoAudioBuffers.editA.sampleRate,
    previewChannels:_videoAudioBuffers.editA.numberOfChannels,monitor:_audioMonitorSlots.get('editA'),
    opusReplacement:!!_opusSyncSlots.editA, audioStart:_audioTimelineStarts.editA,
    sourceSeconds:Math.min(6,_videoAudioBuffers.editA.duration-.5)}));
  if(report.environment.opusReplacement) throw Error('This probe requires native playback, not an Opus replacement.');
  if(report.environment.previewRate!==report.environment.sampleRate) throw Error('Use a full-rate preview for this comparison.');
  if(report.environment.audioStart) throw Error('This probe currently requires audio beginning at timeline zero.');
  if(report.environment.sourceSeconds<1) throw Error('Use a clip with at least 1.5 seconds of decoded audio.');

  await page.evaluate(async()=>{
    const code=`class Capture extends AudioWorkletProcessor {
      constructor(o){super();this.n=o.processorOptions.frames;this.at=0;this.first=null;this.data=[new Float32Array(this.n),new Float32Array(this.n)];}
      process(inputs,outputs){
        if(this.first===null)this.first=currentTime;
        const input=inputs[0], block=outputs[0][0].length, count=Math.min(block,this.n-this.at);
        for(let c=0;c<2;c++)if(input[c])this.data[c].set(input[c].subarray(0,count),this.at);
        this.at+=count;
        if(this.at>=this.n){const channels=this.data.map(c=>c.buffer);this.port.postMessage({channels,startContextTime:this.first,endContextTime:currentTime+count/sampleRate},channels);return false;}
        return true;
      }
    } registerProcessor('half-speed-capture',Capture);`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try{await getAudioContext().audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    window.__halfSpeedProbe={
      encode(channels){return channels.map(channel=>{const bytes=new Uint8Array(channel.buffer,channel.byteOffset,channel.byteLength);let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value);});},
      mix(mode){
        setAudioListening({mode,centerDb:0,otherDb:-9});
        const buffer=_videoAudioBuffers.editA, plan=_audioMonitorPlanForSlot('editA');
        const channels=[new Float32Array(buffer.length),new Float32Array(buffer.length)];
        for(let c=0;c<2;c++){
          const source=buffer.getChannelData(Math.min(c,buffer.numberOfChannels-1));
          const center=buffer.numberOfChannels===3?buffer.getChannelData(2):null;
          for(let i=0;i<buffer.length;i++)channels[c][i]=source[i]*plan.otherGain+(center?center[i]*plan.centerDelta:0);
        }
        return {channels,plan,sampleRate:buffer.sampleRate};
      },
      wav(channels,sampleRate){
        const length=channels[0].length,n=channels.length,buffer=new ArrayBuffer(44+length*n*4),v=new DataView(buffer);
        const text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
        text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,n,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*n*4,true);v.setUint16(32,n*4,true);v.setUint16(34,32,true);text(36,'data');v.setUint32(40,length*n*4,true);
        for(let i=0;i<length;i++)for(let c=0;c<n;c++)v.setFloat32(44+(i*n+c)*4,channels[c][i],true);
        return new Blob([buffer],{type:'audio/wav'});
      }
    };
  });

  const modes=report.environment.monitor?.ready && report.environment.previewChannels===3 ? ['full','center'] : ['full'];
  const cases=[{kind:'native',mode:'full',rate:1},...modes.flatMap(mode=>[
    {kind:'native',mode,rate:.5},{kind:'premixed-native',mode,rate:.5},{kind:'wsola',mode,rate:.5}])];
  for(const spec of cases) {
    const name=`${spec.mode}-${spec.kind}-${spec.rate}x`;
    console.log(`Capturing ${name}`);
    const result=await page.evaluate(async({spec,sourceSeconds})=>{
      pauseAllMedia(); setVolume(100);
      const probe=window.__halfSpeedProbe,ctx=getAudioContext(),mixed=probe.mix(spec.mode);
      await ctx.resume();
      const sampleRate=ctx.sampleRate;
      if(spec.kind==='wsola'){
        const off=new OfflineAudioContext(2,Math.ceil(sourceSeconds/spec.rate*sampleRate),sampleRate);
        // Offline rendering can finish before asynchronous port messages arrive.
        // Initialize the unmodified processor synchronously through a probe-only
        // subclass; this changes setup timing, not its DSP or live app behavior.
        const code=await (await fetch('js/scrub-worklet.js')).text();
        const moduleUrl=URL.createObjectURL(new Blob([code,`
          class OfflineProbeWsola extends WsolaProcessor {
            constructor(options){super();const p=options.processorOptions;
              this._msg({type:'load',channels:p.channels});
              this._msg({type:'tempo',value:p.tempo});this._msg({type:'play',value:true});}
          }
          registerProcessor('offline-probe-wsola',OfflineProbeWsola);
        `],{type:'text/javascript'}));
        try{await off.audioWorklet.addModule(moduleUrl);}finally{URL.revokeObjectURL(moduleUrl);}
        const node=new AudioWorkletNode(off,'offline-probe-wsola',{numberOfInputs:0,outputChannelCount:[2],
          processorOptions:{channels:mixed.channels.map(c=>c.buffer),tempo:spec.rate}});
        node.connect(off.destination);
        const started=performance.now(),rendered=await off.startRendering(),renderWallMs=performance.now()-started;
        node.disconnect();node.port.close();
        return {planes:probe.encode([rendered.getChannelData(0),rendered.getChannelData(1)]),sampleRate,plan:mixed.plan,renderWallMs};
      }
      let media,source,url;
      if(spec.kind==='native'){
        media=document.querySelector('#layerEditA video');
        const route=_nativeAudioRoutes.get(media);
        if(!route)throw Error('Native output route is not ready.');
        source=route.gain;
      }else{
        media=document.createElement('audio');
        url=URL.createObjectURL(probe.wav(mixed.channels,sampleRate));
        await new Promise((resolve,reject)=>{media.oncanplay=resolve;media.onerror=()=>reject(Error('Premixed WAV failed to load'));media.src=url;media.load();});
        source=ctx.createMediaElementSource(media);source.connect(ctx.destination);
      }
      media.pause();media.loop=false;media.volume=1;media.muted=false;media.preservesPitch=true;
      if(media.currentTime!==0)await new Promise(resolve=>{media.addEventListener('seeked',resolve,{once:true});media.currentTime=0;});
      media.playbackRate=spec.rate;
      const frames=Math.ceil((sourceSeconds/spec.rate+.35)*sampleRate);
      const node=new AudioWorkletNode(ctx,'half-speed-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete',processorOptions:{frames}});
      const trace=[];const record=()=>trace.push({contextTime:ctx.currentTime,mediaTime:media.currentTime,paused:media.paused,readyState:media.readyState,seeking:media.seeking,rate:media.playbackRate});
      let interval;
      try{
        const recording=new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('Audio capture timed out')),frames/sampleRate*1000+10000);
          node.port.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
        });
        source.connect(node);node.connect(ctx.destination);record();interval=setInterval(record,25);
        await media.play();
        const recorded=await recording;record();
        const state={rate:media.playbackRate,preservesPitch:media.preservesPitch,continuousActive:_continuousScrubEngine.state.active,volume:media.volume};
        return {planes:probe.encode(recorded.channels.map(b=>new Float32Array(b))),sampleRate,plan:mixed.plan,state,trace,startContextTime:recorded.startContextTime,endContextTime:recorded.endContextTime};
      }finally{
        clearInterval(interval);media.pause();source.disconnect(node);node.disconnect();node.port.close();
        if(url){source.disconnect();media.removeAttribute('src');media.load();URL.revokeObjectURL(url);}
      }
    },{spec,sourceSeconds:report.environment.sourceSeconds});
    const channels=decode(result);delete result.planes;
    const measurement={name,...spec,...result,...stats(channels,result.sampleRate)};
    if(measurement.nonfiniteSamples || measurement.peak===0)throw Error(`Invalid or silent capture: ${name}`);
    captures.push({name,channels,sampleRate:result.sampleRate});report.captures.push(measurement);
    await writeFile(path.join(outDir,`${name}-raw-float.wav`),wav(channels,result.sampleRate,1,true));
    await writeFile(path.join(outDir,'measurements.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({name,peakDbfs:measurement.peakDbfs,over:measurement.samplesAboveFullScale,nearZeroGapMs:measurement.longestInternalNearZeroSeconds*1000}));
  }
  // Identical safety gain for every audition file, never per-file peak normalization.
  report.auditionGain=Math.min(1,.95/Math.max(...report.captures.map(c=>c.peak)));
  report.auditionTrim='Leading near-zero transport/processor startup is trimmed separately; each file then contains sourceSeconds/rate seconds. Raw captures retain every sample.';
  for(let i=0;i<captures.length;i++){
    const capture=captures[i],measurement=report.captures[i];
    const start=Math.round(measurement.firstActiveSeconds*capture.sampleRate);
    const frames=Math.floor(report.environment.sourceSeconds/measurement.rate*capture.sampleRate);
    const channels=capture.channels.map(c=>{const copy=new Float32Array(frames);copy.set(c.subarray(start,start+frames));return copy;});
    await writeFile(path.join(outDir,`${capture.name}.wav`),wav(channels,capture.sampleRate,report.auditionGain));
  }
  await writeFile(path.join(outDir,'measurements.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Saved ${captures.length} captures to ${outDir}`);
} finally {await browser.close();}
