// Decoder-policy tests need an explicitly declared SDR signal. This labels a
// generated test copy only; it is never used for user media or fidelity claims.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export function sdrDecoderFixture(input:string, directory:string) {
  fs.mkdirSync(directory,{recursive:true});
  const output=path.join(directory,path.basename(input));
  const run=(args:string[])=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n',...args],{maxBuffer:64*1024*1024,timeout:30000});
  run(['-copyts','-i',input,'-map','0','-c','copy','-strict','-2','-avoid_negative_ts','disabled',
    '-bsf:v','h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+write_colr',output]);
  const picture=(file:string)=>run(['-i',file,'-map','0:v:0','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1']);
  assert(picture(input).equals(picture(output)),'Test copy must retain decoded picture planes');
  const audio=(file:string)=>JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_packets',
    '-show_data_hash','sha256','-of','json',file]).toString()).packets.map(p=>({pts:p.pts_time,dts:p.dts_time,hash:p.data_hash}));
  assert.deepEqual(audio(output),audio(input),'Test copy must retain audio packets and timestamps');
  const stat=fs.statSync(input);fs.utimesSync(output,stat.atime,stat.mtime);
  return output;
}
