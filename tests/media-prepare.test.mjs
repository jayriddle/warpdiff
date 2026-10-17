import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {preparePackage,preparedMediaAPI} from '../tools/media-prepare/prepare.mjs';
import {prepareMp4AudioFiles} from './helpers/mp4-audio-files.mjs';
import {pageFiles} from '../scripts/stage-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),cli=path.join(root,'tools/media-prepare/prepare.mjs');
const source=path.join(root,'tests/fixtures/ac3_video.mp4');
const run=(tool,args)=>execFileSync(tool,args,{timeout:30000,maxBuffer:4*1024*1024});
const probe=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const picture=file=>run('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-']).toString().split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1).trim());
const pcm=file=>{const bytes=run('ffmpeg',['-v','error','-i',file,'-vn','-ac','2','-ar','48000','-af','aresample=48000:async=0:first_pts=0','-f','s16le','-']);return new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);};
let dir,prepared,multi,original;
before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-package-tool-'));
  original={hash:hash(source),mtime:fs.statSync(source).mtimeMs};
  fs.mkdirSync(path.join(dir,'fixtures'));multi=prepareMp4AudioFiles(path.join(dir,'fixtures'),root);
  prepared=await preparePackage({input:source,output:path.join(dir,'basic')});
});
after(()=>{if(original){assert.equal(hash(source),original.hash);assert.equal(fs.statSync(source).mtimeMs,original.mtime);}if(dir)fs.rmSync(dir,{recursive:true,force:true});});

test('real AC-3 conversion returns a byte-bound stereo AAC candidate without altering the original',()=>{
  const manifest=JSON.parse(fs.readFileSync(prepared.manifest));
  assert.equal(manifest.source.sha256,hash(source));assert.equal(manifest.rendition.sha256,hash(prepared.rendition));
  const streams=probe(prepared.rendition).streams;assert.equal(streams.length,2);
  assert.equal(streams.find(s=>s.codec_type==='video').codec_name,'h264');
  assert.equal(streams.find(s=>s.codec_type==='audio').channels,2);assert.equal(streams.find(s=>s.codec_type==='audio').sample_rate,'48000');
  assert.equal(prepared.report.validation,'normal-load-required');assert.equal(prepared.report.conformance.synchronization,'not-verified');
});
test('copied picture has identical decoded frame hashes',t=>{const before=picture(source),after=picture(prepared.rendition);assert.deepEqual(after,before);t.diagnostic(JSON.stringify({decodedFrames:before.length,allFrameHashesIdentical:true}));});
test('prepared stereo contains audible samples',()=>{const samples=pcm(prepared.rendition);let peak=0;for(const n of samples)peak=Math.max(peak,Math.abs(n));assert(peak>300);});
test('CLI arguments containing shell syntax remain literal paths',()=>{
  const input=path.join(dir,"Jay's $(touch INJECTED).mp4"),output=path.join(dir,"package $(touch ALSO_INJECTED)");fs.copyFileSync(source,input);
  const result=JSON.parse(run(process.execPath,[cli,'--input',input,'--output',output]));
  assert.equal(result.report.sourceBinding,'matched');assert(!fs.existsSync(path.join(root,'INJECTED')));assert(!fs.existsSync(path.join(root,'ALSO_INJECTED')));
});
test('ambiguous audio requires a chosen absolute stream index',async t=>{
  const output=path.join(dir,'ambiguous');await assert.rejects(preparePackage({input:multi.multi,output}),/Choose --audio-stream/);assert(!fs.existsSync(output));
  const selected=await preparePackage({input:multi.multi,output,audioStream:2});assert.equal(JSON.parse(fs.readFileSync(selected.manifest)).transformation.selectedAudioStream,2);
  const samples=pcm(selected.rendition),from=Math.round(.2*48000),to=Math.round(.6*48000);assert(samples.length/2>=to);
  let crossings=0;for(let i=from+1;i<to;i++)if(samples[(i-1)*2]<0&&samples[i*2]>=0)crossings++;
  const hz=crossings/((to-from)/48000);assert(hz>1200&&hz<1270,'Selected 1234 Hz active-window tone, received '+hz);
  t.diagnostic(JSON.stringify({selectedAudioStream:2,activeWindowSeconds:[.2,.6],frequencyHz:hz}));
});
test('explicit nonexistent track rejects before making an output directory',async()=>{
  const output=path.join(dir,'missing-track');await assert.rejects(preparePackage({input:source,output,audioStream:63}),/does not exist/);assert(!fs.existsSync(output));
});
test('existing output contents are never overwritten',async()=>{
  const output=path.join(dir,'existing');fs.mkdirSync(output);fs.writeFileSync(path.join(output,'sentinel'),'keep');
  await assert.rejects(preparePackage({input:source,output}),/EEXIST/);assert.deepEqual(fs.readdirSync(output),['sentinel']);assert.equal(fs.readFileSync(path.join(output,'sentinel'),'utf8'),'keep');
});
test('a playlist disguised as MP4 cannot make the external tools fetch a URL',async()=>{
  let requests=0;const server=http.createServer((req,res)=>{requests++;res.end('not media');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const input=path.join(dir,'playlist.mp4'),output=path.join(dir,'playlist-output');
    fs.writeFileSync(input,'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:'+server.address().port+'/not-local.ts\n#EXT-X-ENDLIST\n');
    await assert.rejects(preparePackage({input,output}));assert.equal(requests,0);assert(!fs.existsSync(output));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('missing FFmpeg cleans only its new output directory',async()=>{
  const output=path.join(dir,'missing-tool');await assert.rejects(preparePackage({input:source,output,ffmpeg:path.join(dir,'not-installed')}),/ENOENT/);assert(!fs.existsSync(output));
});
test('cancellation before execution leaves no output',async()=>{
  const controller=new AbortController();controller.abort();const output=path.join(dir,'pre-abort');await assert.rejects(preparePackage({input:source,output,signal:controller.signal}),{name:'AbortError'});assert(!fs.existsSync(output));
});
test('cancellation retires a running tool and cleans pending output',{skip:process.platform==='win32'},async()=>{
  const executable=path.join(dir,'delayed-tool');fs.writeFileSync(executable,'#!/bin/sh\nexec sleep 30\n',{mode:0o700});
  const controller=new AbortController(),output=path.join(dir,'cancelled');const pending=preparePackage({input:source,output,ffmpeg:executable,signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  for(let i=0;i<100&&!fs.existsSync(path.join(output,'.review.partial.mp4'));i++)await new Promise(r=>setTimeout(r,10));
  assert(fs.existsSync(path.join(output,'.review.partial.mp4')));controller.abort();await rejected;assert(!fs.existsSync(output));
});
test('cancellation waits for an uncooperative child to exit before cleaning output',{skip:process.platform==='win32'},async()=>{
  const executable=path.join(dir,'ignore-term-tool'),pidFile=path.join(dir,'ignore-term.pid');
  fs.writeFileSync(executable,'#!'+process.execPath+'\n'+
    'const fs=require("node:fs");process.on("SIGTERM",()=>{});fs.writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));setInterval(()=>{},1000);\n',{mode:0o700});
  const controller=new AbortController(),output=path.join(dir,'ignore-term-output');
  const pending=preparePackage({input:source,output,ffmpeg:executable,signal:controller.signal});
  const result=pending.then(()=>({name:'unexpected success'}),e=>e);
  let pid;
  try {
    for(let i=0;i<500&&!fs.existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,10));
    assert(fs.existsSync(pidFile),'Owned child reached its installed TERM handler');pid=Number(fs.readFileSync(pidFile,'utf8'));
    controller.abort();assert.equal((await result).name,'AbortError');
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert(!fs.existsSync(output));
  } finally {controller.abort();if(pid){try{process.kill(pid,'SIGKILL');}catch{}}await result;}
});
for(const boundary of ['rendition-link','rendition-unlink','manifest-open','manifest-write','manifest-link','manifest-unlink']) {
  test('cancellation at '+boundary+' rejects and removes only owned output',async()=>{
    const controller=new AbortController(),output=path.join(dir,'publish-cancel-'+boundary);
    const originals={open:fsp.open,link:fsp.link,unlink:fsp.unlink};let reached=false;
    const stop=()=>{reached=true;controller.abort();};
    fsp.link=async(...args)=>{const value=await originals.link(...args);if(args[1]===path.join(output,boundary==='rendition-link'?'review.mp4':'warpdiff-package.json')&&boundary.endsWith('-link'))stop();return value;};
    fsp.unlink=async(...args)=>{const value=await originals.unlink(...args);if(args[0]===path.join(output,boundary==='rendition-unlink'?'.review.partial.mp4':'.manifest.partial.json')&&boundary.endsWith('-unlink'))stop();return value;};
    fsp.open=async(...args)=>{const handle=await originals.open(...args);
      if(args[0]===path.join(output,'.manifest.partial.json')){
        if(boundary==='manifest-open')stop();
        if(boundary==='manifest-write'){const write=handle.writeFile.bind(handle);handle.writeFile=async(...a)=>{const value=await write(...a);stop();return value;};}
      }return handle;};
    try {await assert.rejects(preparePackage({input:source,output,signal:controller.signal}),{name:'AbortError'});assert(reached);assert(!fs.existsSync(output));}
    finally{Object.assign(fsp,originals);}
  });
}
test('a leading audio edit retains its onset within one AAC packet',async t=>{
  const input=path.join(root,'tests/fixtures/audio_offset.mp4'),output=await preparePackage({input,output:path.join(dir,'offset')});
  function onset(file){const samples=pcm(file);for(let i=0;i<samples.length;i+=2)if(Math.abs(samples[i])>1000)return i/2/48000;throw Error('No audible onset');}
  const sourceOnset=onset(input),preparedOnset=onset(output.rendition);assert(Math.abs(sourceOnset-preparedOnset)<=1024/48000);assert.deepEqual(picture(input),picture(output.rendition));
  t.diagnostic(JSON.stringify({sourceOnset,preparedOnset,differenceSeconds:Math.abs(sourceOnset-preparedOnset),limitSeconds:1024/48000}));
});
test('a short soundtrack does not truncate the copied picture',async t=>{
  const input=path.join(dir,'short-audio.mp4');run('ffmpeg',['-v','error','-i',path.join(root,'tests/fixtures/landscape_a.mp4'),'-map','0:v:0','-map','0:a:0','-c:v','copy','-af','atrim=end=0.2','-c:a','aac',input]);
  const result=await preparePackage({input,output:path.join(dir,'padded')});assert.deepEqual(picture(result.rendition),picture(input));
  const sourceDuration=Number(probe(input).format.duration),preparedDuration=Number(probe(result.rendition).format.duration);assert(preparedDuration>=sourceDuration-.05);
  t.diagnostic(JSON.stringify({sourceDuration,preparedDuration,allDecodedFrameHashesIdentical:true}));
});
test('surround preparation is explicitly a stereo copy, not source-channel certification',async()=>{
  const input=path.join(root,'tests/fixtures/dialogue_51_aac.mp4'),before=hash(input),result=await preparePackage({input,output:path.join(dir,'surround')});
  assert.equal(probe(input).streams.find(s=>s.codec_type==='audio').channels,6);assert.equal(result.report.container.channels,2);assert.equal(hash(input),before);
  assert.equal(result.report.analysisBasis,'prepared-copy');assert.equal(result.report.conformance.channelFidelity,'not-verified');
});
test('changed bytes fail package inspection even with an unchanged name and size',async()=>{
  const api=await preparedMediaAPI(),bytes=fs.readFileSync(prepared.rendition);bytes[bytes.length-1]^=1;
  await assert.rejects(api.inspectFiles({manifestFile:new File([fs.readFileSync(prepared.manifest)],'warpdiff-package.json'),mediaFile:new File([bytes],'review.mp4')}),/SHA-256/);
});
test('the external tool, test tools and FFmpeg are absent from the public package',()=>{
  const publicFiles=pageFiles(root);assert(publicFiles.includes('js/prepared-media.js'));assert(!publicFiles.some(file=>file.startsWith('tools/')||file.includes('ffmpeg')));
});
