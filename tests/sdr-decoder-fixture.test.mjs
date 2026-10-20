// Real fixture preservation across FFmpeg versions, including Ubuntu 6.1's
// edited-FLAC trailing-packet regression. Writes only per-test temp directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

for(const verifiedSoftware of [false,true]) {
  test('SDR '+(verifiedSoftware?'verified software':'metadata copy')+' keeps the complete delayed FLAC track',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-sdr-fixture-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    // .mts uses Node 24+'s built-in type stripping without a build dependency.
    fs.copyFileSync(new URL('./helpers/sdr-decoder-fixture.ts',import.meta.url),path.join(dir,'helper.mts'));
    const {sdrDecoderFixture}=await import(pathToFileURL(path.join(dir,'helper.mts')).href);
    const input=path.join(dir,'delayed-flac.mp4');
    execFileSync('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=black:s=128x72:r=24:d=5',
      '-itsoffset','0.166','-f','lavfi','-i','aevalsrc=0|0|0.2*sin(2*PI*440*t)|0|0|0|0|0:s=48000:d=4.5:c=7.1',
      '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
      '-c:a','flac','-strict','-2','-movflags','+faststart',input],{timeout:30000});
    const packets=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_packets',
      '-show_data_hash','sha256','-of','json',file])).packets.map(p=>({pts:p.pts_time,dts:p.dts_time,hash:p.data_hash}));
    const original=packets(input),before={hash:createHash('sha256').update(fs.readFileSync(input)).digest('hex'),mtime:fs.statSync(input,{bigint:true}).mtimeNs};
    assert.equal(original.length,47,'control contains a partial trailing FLAC packet');
    assert.equal(original[0].pts,'0.166000');assert.equal(original.at(-1).pts,'4.582000');
    const output=sdrDecoderFixture(input,path.join(dir,'copy'),{verifiedSoftware});
    assert.deepEqual(packets(output),original,'every audio packet and original PTS/DTS must survive');
    const info=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=channels,start_time,duration','-of','json',output])).streams[0];
    assert.equal(info.channels,8);assert.equal(info.start_time,'0.166000');assert.equal(info.duration,'4.500000');
    assert.equal(createHash('sha256').update(fs.readFileSync(input)).digest('hex'),before.hash);
    assert.equal(fs.statSync(input,{bigint:true}).mtimeNs,before.mtime);
  });
}
