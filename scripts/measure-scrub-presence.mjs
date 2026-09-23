// Isolated, physically muted browser measurement; audio stays in OUTPUT_DIR.
// node scripts/measure-scrub-presence.mjs INPUT OUTPUT_DIR [SOURCE_START=.5] [SOURCE_END=6.5]
// Fixed-rate DSP measurement; pointer/decoder timing needs a separate live probe.
// Input must have a verified surround layout with the retained center plane.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
const [input,output,startArg='.5',endArg='6.5']=process.argv.slice(2);
const sourceStart=Number(startArg),sourceEnd=Number(endArg);
if(!input||!output||!Number.isFinite(sourceStart)||!Number.isFinite(sourceEnd)||sourceEnd-sourceStart<=1)throw Error('Supply input, output directory, and an ordered source interval longer than one second.');
const dir=path.resolve(output);await mkdir(dir,{recursive:true});
const sourceSha256=createHash('sha256').update(await readFile(input)).digest('hex');
const report={at:new Date().toISOString(),sourceSha256,sourceStart,sourceEnd,renders:[],errors:[]};
function wav(planes,sr) {
 const p=planes.map(x=>Buffer.from(x,'base64')),n=p.length,frames=p[0].length/4,b=Buffer.alloc(44+frames*n*4);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(n,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*n*4,28);b.writeUInt16LE(n*4,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 for(let i=0;i<frames;i++)for(let c=0;c<n;c++)b.writeFloatLE(p[c].readFloatLE(i*4),44+(i*n+c)*4);return b;
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},serviceWorkers:'block'});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(process.env.WARPDIFF_URL||'http://localhost:8080/');
 await page.locator('#multiFileInput').setInputFiles(path.resolve(input));
 await page.waitForFunction(()=>!!_videoAudioBuffers.editA,null,{timeout:60000});
 if(!await page.evaluate(()=>_audioMonitorSlots.get('editA')?.ready&&_videoAudioBuffers.editA.numberOfChannels===3))throw Error('This probe requires a verified surround video with a retained center plane.');
 report.environment=await page.evaluate(()=>({version:APP_VERSION,userAgent:navigator.userAgent,rate:getAudioContext().sampleRate,channels:_videoAudioBuffers.editA.numberOfChannels,start:_audioTimelineStarts.editA,monitor:_audioMonitorSlots.get('editA')}));
 const before=await page.evaluate(()=>JSON.stringify(audioMetrics.editA));
 await page.evaluate(()=>{
   window.__encode=p=>p.map(ch=>{let s='';const b=new Uint8Array(ch.buffer,ch.byteOffset,ch.byteLength);for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);});
   window.__stats=(planes,sr,start,end)=>{
     let peak=0,sum=0,over=0,nonfinite=0;
     const lo=Math.max(0,Math.floor(start*sr)),hi=Math.min(planes[0].length,Math.floor(end*sr));
     for(const ch of planes)for(let i=lo;i<hi;i++){peak=Math.max(peak,Math.abs(ch[i]));sum+=ch[i]*ch[i];if(Math.abs(ch[i])>1)over++;if(!Number.isFinite(ch[i]))nonfinite++;}
     const bands={body:[100,500],detail:[2000,5000],high:[5000,10000]},energy={body:0,detail:0,high:0},N=2048,re=new Float64Array(N),im=new Float64Array(N);
     let frames=0;
     for(const ch of planes)for(let at=lo;at+N<=hi;at+=N/2) {
       for(let i=0;i<N;i++){re[i]=ch[at+i]*(.5-.5*Math.cos(2*Math.PI*i/N));im[i]=0;}
       fft(re,im);frames++;
       for(const [name,[low,high]] of Object.entries(bands))for(let k=Math.ceil(low*N/sr);k<high*N/sr;k++)energy[name]+=(re[k]*re[k]+im[k]*im[k])*2/(N*N*.375);
     }
     return {peak,peakDbfs:20*Math.log10(peak),rmsDbfs:10*Math.log10(sum/((hi-lo)*planes.length)),over,nonfinite,bandsDb:Object.fromEntries(Object.entries(energy).map(([name,sum])=>[name,10*Math.log10(sum/frames)]))};
   };
 });
 for(const mode of ['full','center'])for(const tempo of [1,.5,.25]) {
   const result=await page.evaluate(async({mode,tempo,sourceStart,sourceEnd})=>{
     setAudioListening({mode,centerDb:11,otherDb:-9});
     const source=_videoAudioBuffers.editA,sr=source.sampleRate,audioStart=_audioTimelineStarts.editA||0;
     if(sourceStart<audioStart||sourceEnd-audioStart>source.duration)throw Error('Interval is outside the decoded audio.');
     const text=await (await fetch('js/scrub-worklet.js')).text();
     // Diagnostic acknowledgement only: allow queued load/play messages to arrive
     // before a fast offline render. DSP and render methods are byte-unchanged.
     const url=URL.createObjectURL(new Blob([text+'\nconst msg=PhaseVocoderProcessor.prototype._msg;PhaseVocoderProcessor.prototype._msg=function(d){msg.call(this,d);if(d.type==="play"&&d.value)this.port.postMessage({type:"presence-ready"});};'],{type:'text/javascript'}));
     const ctx=new OfflineAudioContext(2,Math.ceil((sourceEnd-sourceStart+.1)/tempo*sr),sr),engine=WarpScrubAudio.create({workletUrl:url,matchSourceLevel:true}),plan=_audioMonitorPlanForSlot('editA');engine.setMonitorMix(plan);
     if(!await engine.load(ctx,source,'stereo-center'))throw Error(engine.state.error);
     const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Probe did not receive ready')),5000);engine.state.node.port.onmessage=e=>{if(e.data.type==='presence-ready'){clearTimeout(timer);resolve();}};});
     engine.update({offset:sourceStart-audioStart,tempo,direction:1,level:1,continuous:false});
     await ready;URL.revokeObjectURL(url);
     const rendered=await ctx.startRendering(),planes=[rendered.getChannelData(0),rendered.getChannelData(1)];
     engine.state.node.disconnect();engine.state.node.port.close();
     const reference=[new Float32Array(source.length),new Float32Array(source.length)];
     for(let c=0;c<2;c++)for(let i=0;i<source.length;i++)reference[c][i]=source.getChannelData(c)[i]*plan.otherGain+source.getChannelData(2)[i]*plan.centerDelta;
     const measured=__stats(planes,sr,.2/tempo,(sourceEnd-sourceStart-.2)/tempo),input=__stats(reference,sr,sourceStart+.2-audioStart,sourceEnd-.2-audioStart);
     if(!(measured.peak>0)||measured.nonfinite)throw Error('Probe produced silent or invalid output');
     const rmsDifferenceDb=measured.rmsDbfs-input.rmsDbfs;
     return {planes:__encode(planes),reference:tempo===1?__encode(reference):null,mode,tempo,sampleRate:sr,plan,sourceStart,sourceEnd,input,measured,rmsDifferenceDb,
       bandDifferencesDb:Object.fromEntries(Object.keys(input.bandsDb).map(name=>[name,{raw:measured.bandsDb[name]-input.bandsDb[name],afterLevelMatch:measured.bandsDb[name]-input.bandsDb[name]-rmsDifferenceDb}]))};
   },{mode,tempo,sourceStart,sourceEnd});
   await writeFile(dir+`/presence-${mode}-${tempo}.wav`,wav(result.planes,result.sampleRate));delete result.planes;
   if(result.reference)await writeFile(dir+`/presence-${mode}-input.wav`,wav(result.reference,result.sampleRate));delete result.reference;
   report.renders.push(result);console.log(JSON.stringify({mode,tempo,rmsDifferenceDb:result.rmsDifferenceDb,bandDifferencesDb:result.bandDifferencesDb,over:result.measured.over}));
 }
 report.originalMetricsUnchanged=await page.evaluate(prior=>JSON.stringify(audioMetrics.editA)===prior,before);
 await page.evaluate(()=>clearAllMedia());await page.waitForFunction(()=>_continuousScrubEngine.state.bytes+_continuousScrubEngine.state.retiringBytes===0);
 report.after=await page.evaluate(()=>({bytes:_continuousScrubEngine.state.bytes,retiring:_continuousScrubEngine.state.retiringBytes,context:audioContext}));
 await writeFile(dir+'/presence.json',JSON.stringify(report,null,2)+'\n');
 if(report.errors.length||!report.originalMetricsUnchanged)process.exitCode=1;
}finally{await browser.close();}
