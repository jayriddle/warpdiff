// Decoder-policy tests need an explicitly declared SDR signal. This labels a
// generated test copy only; it is never used for user media or fidelity claims.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export function sdrDecoderFixture(input:string, directory:string, options:{verifiedSoftware?:boolean} = {}) {
  fs.mkdirSync(directory,{recursive:true});
  const output=path.join(directory,path.basename(input));
  const run=(args:string[])=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n',...args],{maxBuffer:64*1024*1024,timeout:30000});
  const audio=(file:string, raw=false)=>JSON.parse(execFileSync('ffprobe',['-v','error',...(raw?['-ignore_editlist','1']:[]),
    '-select_streams','a:0','-show_packets','-show_data_hash','sha256','-of','json',file]).toString()).packets
    .map(p=>({pts:p.pts_time,dts:p.dts_time,hash:p.data_hash}));
  const expectedAudio=audio(input);
  const tracks=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','json',input]).toString()).streams;
  let audioInput:string[]=[],maps=['-map','0'];
  if(tracks.length===1 && tracks[0].codec_name==='flac') {
    // FFmpeg 6.1's edited MP4 FLAC streamcopy drops the final packet. Read
    // that track without edits, then restore its known constant placement.
    // Full packet/PTS guards below reject any non-constant or lossy mapping.
    const raw=audio(input,true);
    const offset=Number(expectedAudio[0]?.pts)-Number(raw[0]?.pts);
    assert(Number.isFinite(offset),'FLAC test source requires a finite packet start');
    audioInput=['-ignore_editlist','1','-itsoffset',offset.toFixed(9),'-i',input];
    maps=['-map','0','-map','-0:a','-map','1:a:0'];
  }

  // Retained-cache tests need the verified High 4:4:4/I420 path. Ordinary
  // hardware output can change transfer metadata mid-run and correctly retire.
  // This lossless test-only encoding preserves every decoded frame and PTS;
  // the default copy still changes only video color metadata.
  const video=options.verifiedSoftware ? ['-c:v','libx264','-crf','0','-preset','fast','-pix_fmt','yuv420p',
    '-fps_mode:v','passthrough','-enc_time_base:v','demux',
    '-vf','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'] :
    ['-bsf:v','h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1'];
  run(['-copyts','-i',input,...audioInput,...maps,'-c','copy','-strict','-2','-avoid_negative_ts','disabled',...video,
    '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+write_colr',output]);
  if(options.verifiedSoftware) {
    const hashes=(file:string)=>run(['-i',file,'-map','0:v:0','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','framemd5','pipe:1'])
      .toString().split('\n').filter(line=>line && !line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
    assert.deepEqual(hashes(output),hashes(input),'Lossless test source must preserve every decoded frame');
    const frames=(file:string)=>JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames',
      '-show_entries','frame=best_effort_timestamp_time','-of','json',file]).toString()).frames.map(f=>f.best_effort_timestamp_time);
    assert.deepEqual(frames(output),frames(input),'Lossless test source must preserve every video PTS');
    const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=profile','-of','json',output]).toString());
    assert.equal(metadata.streams[0].profile,'High 4:4:4 Predictive','Retained-cache fixture must exercise verified software output');
  }
  const picture=(file:string)=>run(['-i',file,'-map','0:v:0','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1']);
  assert(picture(input).equals(picture(output)),'Test copy must retain decoded picture planes');
  assert.deepEqual(audio(output),expectedAudio,'Test copy must retain audio packets and timestamps');
  const stat=fs.statSync(input);fs.utimesSync(output,stat.atime,stat.mtime);
  return output;
}
