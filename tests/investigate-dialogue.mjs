// Offline measurement of the shipped scrub processor. No sound is played or retained.
// node tests/investigate-dialogue.mjs [--clip file] --out report.json
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const arg = key => process.argv[process.argv.indexOf(key) + 1];
const sr = 48000, code = fs.readFileSync('js/scrub-worklet.js', 'utf8');
const processors = new Map();
vm.runInNewContext(code, { sampleRate:sr,
  AudioWorkletProcessor:class { constructor() { this.port = { postMessage(){}, close(){} }; } },
  registerProcessor:(name, processor) => processors.set(name, processor) });
const Processor = processors.get('phase-vocoder-processor');
function energy(channels, from, to) {
  let sum = 0;
  for (const channel of channels) for (let i = from; i < Math.min(to, channel.length); i++) sum += channel[i] ** 2;
  return sum / ((to - from) * channels.length);
}
function measure(channels, rate, start = 1, seconds = 4) {
  const processor = new Processor();
  processor._msg({type:'load', channels:channels.map(ch => ch.slice().buffer)});
  processor._msg({type:'tempo', value:rate});
  processor._msg({type:'anchor', pos:start * sr, direction:1});
  processor._msg({type:'play', value:true});
  const length = Math.floor(seconds * sr / rate), output = channels.map(() => new Float32Array(length));
  const block = channels.map(() => new Float32Array(128));
  for (let i = 0; i < length; i += 128) {
    processor.process([], [block]);
    block.forEach((channel, c) => output[c].set(channel.subarray(0, Math.min(128, length-i)), i));
  }
  // Exclude the initial overlap-add fill and corresponding source interval.
  const skip = Math.ceil(0.15 * sr / rate);
  const inputEnergy = energy(channels, Math.floor(start*sr + skip*rate), Math.floor((start+seconds)*sr));
  const outputEnergy = energy(output, skip, length);
  return {rate, sourceStart:start, sourceSeconds:seconds,
    levelDifferenceDb:Math.round(1000*10*Math.log10(outputEnergy/inputEnergy))/1000};
}
const report = { processorSha256:createHash('sha256').update(code).digest('hex'), sampleRate:sr,
  method:'Offline exact processor; fixed forward speeds; electrical RMS over corresponding source/output spans, excluding startup. Real speech is nonstationary and spectral windows extend beyond each analysis position. These figures do not measure perceived intelligibility, browser decoding, or pointer cadence.',
  synthetic:[], clip:null };
for (const kind of ['tone','harmonics','noise']) {
  let seed = 1; const input = new Float32Array(sr*10);
  for (let i=0; i<input.length; i++) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    input[i] = kind==='tone' ? .2*Math.sin(2*Math.PI*317*i/sr)
      : kind==='harmonics' ? .15*Math.sin(2*Math.PI*173*i/sr)+.08*Math.sin(2*Math.PI*346*i/sr)+.04*Math.sin(2*Math.PI*519*i/sr)
      : (seed/4294967296-.5)*.4;
  }
  for (const rate of [.1,.25,.5,1,2]) report.synthetic.push({kind,...measure([input,input],rate,1,1)});
}
if (process.argv.includes('--clip')) {
  const clip = arg('--clip');
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,channels,channel_layout,sample_rate','-of','json',clip]));
  const info = probe.streams[0];
  if (![6,8].includes(info.channels)) throw new Error('Use a known 5.1/7.1 fixture for this probe.');
  const raw = execFileSync('ffmpeg',['-v','error','-i',clip,'-map','0:a:0','-t','10','-ar',String(sr),'-c:a','pcm_f32le','-f','f32le','-'],{maxBuffer:32*1024*1024});
  const n = raw.length / 4 / info.channels;
  const center = new Float32Array(n), left = new Float32Array(n), right = new Float32Array(n);
  for (let i=0; i<n; i++) {
    const sample = c => raw.readFloatLE((i*info.channels+c)*4);
    center[i] = sample(2)*Math.SQRT1_2;
    const surround = info.channels===8 ? Math.SQRT1_2/2 : Math.SQRT1_2;
    left[i] = sample(0)+center[i]+surround*(sample(4)+(info.channels===8?sample(6):0));
    right[i] = sample(1)+center[i]+surround*(sample(5)+(info.channels===8?sample(7):0));
  }
  report.clip = { sourceSha256:createHash('sha256').update(fs.readFileSync(clip)).digest('hex'),...info,
    fullMix:[.25,.5,1,2].map(rate => measure([left,right],rate)),
    center:[.25,.5,1,2].map(rate => measure([center,center],rate)) };
}
const json = JSON.stringify(report,null,2)+'\n';
if(process.argv.includes('--out')) fs.writeFileSync(arg('--out'),json);
console.log(json);
