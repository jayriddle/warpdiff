import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {prependMp4Boxes,box} from './mp4-audio-fixture.mjs';
export function prepareMp4AudioFiles(directory, root) {
  const run=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{timeout:30000,stdio:'pipe'});
  const multi=path.join(directory,'two-audio.mp4'),audio=path.join(directory,'two-audio.m4a'),single=path.join(directory,'one-audio.mp4');
  run(['-i',path.join(root,'tests/fixtures/landscape_a.mp4'),'-f','lavfi','-i','sine=frequency=1234:sample_rate=48000:duration=1',
    '-map','0:v:0','-map','0:a:0','-map','1:a:0','-c:v','copy','-c:a:0','copy','-c:a:1','libopus','-b:a:1','64k',
    '-disposition:a:0','default','-disposition:a:1','0','-strict','-2','-t','1','-movflags','+faststart',multi]);
  run(['-i',multi,'-map','0:a','-c','copy','-strict','-2','-f','mp4','-movflags','+faststart',audio]);
  run(['-i',multi,'-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',single]);
  const multiAAC=path.join(directory,'two-aac.mp4'),audioAAC=path.join(directory,'two-aac.m4a');
  run(['-i',multi,'-map','0','-c','copy','-c:a:1','aac','-movflags','+faststart',multiAAC]);
  run(['-i',multiAAC,'-map','0:a','-c','copy','-f','mp4','-movflags','+faststart',audioAAC]);
  const padding=box('free',Buffer.alloc(8));
  const pad=file=>{const result=path.join(directory,'padded-'+path.basename(file));fs.writeFileSync(result,prependMp4Boxes(fs.readFileSync(file),padding));return result;};
  const paddedMulti=pad(multiAAC),paddedAudio=pad(audioAAC),paddedSingle=pad(single);
  const b=fs.readFileSync(single);
  function boxes(start,end){const out=[];for(let p=start;p+8<=end;){const size=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8);if(size<8||p+size>end)throw Error('Unexpected generated box');out.push({type,start:p+8,end:p+size});p+=size;}return out;}
  const moov=boxes(0,b.length).find(t=>t.type==='moov');let changed=false;
  for(const track of boxes(moov.start,moov.end).filter(t=>t.type==='trak')) {
    const mdia=boxes(track.start,track.end).find(t=>t.type==='mdia'),media=boxes(mdia.start,mdia.end),handler=media.find(t=>t.type==='hdlr');
    if(b.toString('ascii',handler.start+8,handler.start+12)!=='soun')continue;
    const minf=media.find(t=>t.type==='minf'),stbl=boxes(minf.start,minf.end).find(t=>t.type==='stbl');
    const stsc=boxes(stbl.start,stbl.end).find(t=>t.type==='stsc');if(!stsc||b.readUInt32BE(stsc.start+4)<1)throw Error('Missing generated audio chunk map');
    b.writeUInt32BE(2,stsc.start+16);changed=true;
  }
  if(!changed)throw Error('No generated audio track was changed');const malformed=path.join(directory,'invalid-audio-map.mp4');fs.writeFileSync(malformed,b);
  return {multi,audio,single,malformed,paddedMulti,paddedAudio,paddedSingle};
}
