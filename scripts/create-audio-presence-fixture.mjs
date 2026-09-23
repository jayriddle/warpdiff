// Generate a private-media-free 7.1 reference with individual mono stems.
// node scripts/create-audio-presence-fixture.mjs --out /path/to/output [--speech reference.wav]
// Without --speech, macOS's installed Samantha voice supplies the spoken reference.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2), value=key=>args.includes(key)?args[args.indexOf(key)+1]:null;
if(!value('--out'))throw Error('Supply --out. On systems without macOS speech, also supply --speech reference.wav.');
const out=path.resolve(value('--out')),stemDir=path.join(out,'tracks');
if(['reference.json','presence-7.1.flac','presence-7.1.wav','presence-7.1.mp4','reference-stereo.wav','tracks'].some(file=>existsSync(path.join(out,file))))throw Error('Reference output already exists; use a new output directory to preserve its provenance.');
mkdirSync(stemDir,{recursive:true});
const scratch=mkdtempSync(path.join(tmpdir(),'warpdiff-audio-reference-'));
const run=(name,args)=>execFileSync(name,args,{maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
const ff=args=>run('ffmpeg',['-hide_banner','-loglevel','error','-y',...args]);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sr=48000,duration=32,length=sr*duration;
const channels=[['FL','Front left',375],['FR','Front right',750],['FC','Center',1500],['LFE','Low frequency',90],['BL','Back left',3000],['BR','Back right',4500],['SL','Side left',6000],['SR','Side right',7500]];
const pcm=channels.map(()=>new Float32Array(length));
const transcript='This is the center channel. Clear voices need warmth and detail. Six crisp sounds test speech and breath.';
function tone(channel,start,seconds,hz,level,fade=.02) {
  const count=Math.round(seconds*sr),at=Math.round(start*sr);
  for(let i=0;i<count;i++)pcm[channel][at+i]+=level*Math.min(1,i/(fade*sr),(count-1-i)/(fade*sr))*Math.sin(2*Math.PI*hz*i/sr);
}
function raw(planes) {
  const b=Buffer.alloc(planes[0].length*planes.length*4);
  for(let i=0;i<planes[0].length;i++)for(let c=0;c<planes.length;c++)b.writeFloatLE(planes[c][i],(i*planes.length+c)*4);
  return b;
}
try {
  let speech=value('--speech'),provenance;
  if(speech) {speech=path.resolve(speech);provenance={method:'provided reference',sourceSha256:hash(speech)};}
  else {
    if(process.platform!=='darwin')throw Error('Use --speech with a licensed spoken reference on this platform.');
    speech=path.join(scratch,'speech.aiff');
    run('/usr/bin/say',['-v','Samantha','-r','205','-o',speech,transcript]);
    provenance={method:'local macOS speech synthesis',voice:'Samantha',wordsPerMinute:205,transcript,sourceSha256:hash(speech),platform:process.platform};
  }
  const spokenBytes=ff(['-i',speech,'-ac','1','-ar',String(sr),'-f','f32le','pipe:1']);
  const spoken=new Float32Array(spokenBytes.length/4);
  let speechPeak=0;
  for(let i=0;i<spoken.length;i++){spoken[i]=spokenBytes.readFloatLE(i*4);speechPeak=Math.max(speechPeak,Math.abs(spoken[i]));}
  if(spoken.length>sr*7.7||!(speechPeak>0))throw Error('Spoken reference must be audible and no longer than 7.7 seconds.');
  const speechGain=.32/speechPeak;
  const sections=channels.map(([id,label,hz],c)=>({start:c,end:c+1,label:`${id} - ${label}`,channel:c,frequency:hz,peak:.12,measure:[c+.1,c+.9]}));
  for(let c=0;c<8;c++)tone(c,c,1,channels[c][2],.12);
  for(const start of [8,16])for(let i=0;i<spoken.length;i++)pcm[2][start*sr+i]=spoken[i]*speechGain;
  for(const c of [0,1,4,5,6,7])tone(c,16,8,channels[c][2],.03,.1);
  tone(3,16,8,90,.08,.1);
  sections.push({start:8,end:16,label:'Center speech alone',measure:[8,16]},
    {start:16,end:24,label:'Same speech with surrounding tones',measure:[16,24]});
  let seed=0x4b1d203;
  for(const start of [24.2,24.6,25.0,25.4]) {
    for(let i=0;i<Math.round(.08*sr);i++) {
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
      const noise=(seed>>>0)/0xffffffff*2-1;
      pcm[2][Math.round(start*sr)+i]=.18*noise*Math.sin(Math.PI*i/(.08*sr));
    }
  }
  for(let i=0;i<sr;i++) {
    const t=i/sr,env=Math.sin(Math.PI*t)**2;
    let sample=0;for(let h=1;h<=7;h++)sample+=.12/h*Math.cos(2*Math.PI*223*h*t);
    pcm[2][26*sr+i]=sample*env;
  }
  sections.push({start:24,end:26,label:'Four short noise attacks',attacks:[24.2,24.6,25.0,25.4]},
    {start:26,end:27,label:'One harmonic syllable',fundamental:223},
    {start:27,end:28,label:'Digital silence',measure:[27.1,27.9]});
  for(const [i,hz] of [250,1000,4000,8000].entries()) {
    tone(2,28+i,1,hz,.14);
    sections.push({start:28+i,end:29+i,label:`Center calibration - ${hz} Hz`,channel:2,frequency:hz,peak:.14,measure:[28.1+i,28.9+i]});
  }
  const interleaved=path.join(scratch,'reference.f32');writeFileSync(interleaved,raw(pcm));
  const input=['-f','f32le','-ar',String(sr),'-ac','8','-channel_layout','7.1','-i',interleaved];
  ff([...input,'-c:a','flac','-sample_fmt','s32',path.join(out,'presence-7.1.flac')]);
  ff([...input,'-c:a','pcm_s24le',path.join(out,'presence-7.1.wav')]);
  for(let c=0;c<8;c++) {
    const file=path.join(scratch,channels[c][0]+'.f32');writeFileSync(file,raw([pcm[c]]));
    ff(['-f','f32le','-ar',String(sr),'-ac','1','-i',file,'-c:a','pcm_s24le',path.join(stemDir,`${c+1}-${channels[c][0]}.wav`)]);
  }
  // Use the same explicit monitoring matrix as the product, including LFE omission.
  ff(['-i',path.join(out,'presence-7.1.flac'),'-af','pan=stereo|FL=FL+0.7071067811865476*FC+0.3535533905932738*BL+0.3535533905932738*SL|FR=FR+0.7071067811865476*FC+0.3535533905932738*BR+0.3535533905932738*SR','-c:a','pcm_s24le',path.join(out,'reference-stereo.wav')]);
  // Browser-rendered cards avoid requiring FFmpeg's optional drawtext/font build.
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),args:['--mute-audio']});
  let cards='';
  try {
    const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1});
    await page.setContent('<style>html{background:#142238;color:#fff;font:20px system-ui}body{margin:0;text-align:center}h1{margin:58px 0 48px;font-size:28px}h2{font-size:24px;font-weight:500}p{color:#b8c9dc;margin-top:45px;font-size:16px}</style><h1>WarpDiff 7.1 audio reference</h1><h2></h2><p></p>');
    for(const [i,section] of sections.entries()) {
      await page.locator('h2').evaluate((el,text)=>el.textContent=text,section.label);
      await page.locator('p').evaluate((el,text)=>el.textContent=text,`${section.start}–${section.end} seconds · 48 kHz · eight separate channels`);
      const card=path.join(scratch,`card-${i}.png`);await page.screenshot({path:card});
      cards+=`file '${card}'\nduration ${section.end-section.start}\n`;
    }
    cards+=`file '${path.join(scratch,`card-${sections.length-1}.png`)}'\n`;
  }finally{await browser.close();}
  const cardList=path.join(scratch,'cards.txt');writeFileSync(cardList,cards);
  ff(['-f','concat','-safe','0','-i',cardList,'-i',path.join(out,'presence-7.1.flac'),'-map','0:v:0','-map','1:a:0','-vf','fps=24,tpad=stop_mode=clone:stop_duration=1','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','copy','-strict','-2','-movflags','+faststart',path.join(out,'presence-7.1.mp4')]);
  const files=['presence-7.1.flac','presence-7.1.wav','presence-7.1.mp4','reference-stereo.wav',...channels.map(([id],i)=>`tracks/${i+1}-${id}.wav`)];
  const reference={schemaVersion:1,sampleRate:sr,channels:channels.map(([id,label,frequency],index)=>({index,id,label,identificationFrequency:frequency})),layout:'7.1',duration,sections,speech:{...provenance,seconds:spoken.length/sr,referencePeak:.32,appliedGain:speechGain},generation:{node:process.version,ffmpeg:run('ffmpeg',['-version']).toString().split('\n')[0],note:'Calibration signals are deterministic. Speech depends on the provided file or installed macOS voice; hashes identify this exact reference.'},files:files.map(file=>({file,sha256:hash(path.join(out,file))}))};
  writeFileSync(path.join(out,'reference.json'),JSON.stringify(reference,null,2)+'\n');
  console.log(JSON.stringify({out,duration,layout:reference.layout,speechSeconds:reference.speech.seconds,files:files.length}));
}finally{rmSync(scratch,{recursive:true,force:true});}
