import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {patchFirstClusterUnknown} from './webm-cluster.mjs';

// Fresh temporary directory per test worker; no checked-in binary fixtures.
export function prepareAudioSelectionFiles(directory) {
  const run = args => execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-n',...args], {timeout:30000});
  const file = name => path.join(directory,name);
  const picture = duration => ['-f','lavfi','-i',`testsrc2=size=160x90:rate=24:duration=${duration}`];
  const tone = (duration,hz=440) => ['-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=${duration}`];
  const files = {aac:file('aac-control.mp4'),comment:file('aac-opus-comment.mp4'),short:file('opus-short.mp4'),
    delayed:file('opus-delayed.mp4'),long:file('opus-long.mp4'),multi:file('two-audio.webm'),
    mixed:file('opus-vorbis.webm'),single:file('one-audio.webm'),audio:file('two-audio-audio.webm'),
    unknownCluster:file('unknown-cluster.webm')};
  for (const [name,codec,pictureSeconds,audioSeconds,delay] of [
    ['aac','aac',5,2,0],['short','libopus',5,2,0],['delayed','libopus',5,2,1],['long','libopus',2,5,0]
  ]) run([...picture(pictureSeconds),...(delay?['-itsoffset',String(delay)]:[]),...tone(audioSeconds),
    '-map','0:v','-map','1:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a',codec,'-movflags','+faststart',files[name]]);
  // Stream copy ensures the negative control differs only in container metadata.
  run(['-i',files.aac,'-map','0','-c','copy','-metadata','comment=Exported by Opus Studio','-movflags','+faststart',files.comment]);
  run([...picture(3),...tone(3),...tone(3,880),'-map','0:v','-map','1:a','-map','2:a',
    '-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-c:a','libopus',
    '-disposition:a:0','default','-disposition:a:1','0',files.multi]);
  run(['-i',files.multi,'-map','0','-c','copy','-c:a:1','vorbis','-strict','-2','-ac:a:1','2',files.mixed]);
  run(['-i',files.multi,'-map','0:v','-map','0:a:0','-c','copy',files.single]);
  run(['-i',files.multi,'-map','0:a','-c','copy',files.audio]);
  const clustered = file('known-clusters.webm');
  run([...picture(4),...tone(4),'-map','0:v','-map','1:a','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8',
    '-b:v','80k','-c:a','libopus','-b:a','32k','-cluster_time_limit','250',clustered]);
  writeFileSync(files.unknownCluster, patchFirstClusterUnknown(readFileSync(clustered)));
  return files;
}
