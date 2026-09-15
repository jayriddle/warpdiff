import {test, expect} from '@playwright/test';

test.use({serviceWorkers:'block'});
test.beforeEach(async ({page}) => { await page.goto('/'); });

test('background analysis preserves every value and source channel while animation continues', async ({page}) => {
  const result = await page.evaluate(async () => {
    const w = window as any;
    const buffer = new AudioBuffer({length:240000, sampleRate:48000, numberOfChannels:8});
    for (let ch = 0; ch < 8; ch++) {
      const plane = buffer.getChannelData(ch);
      for (let i = 0; i < plane.length; i++) plane[i] = Math.sin(i * (ch + 1) * .023) * (ch + 1) / 16;
    }
    const original = Array.from({length:8}, (_, ch) => buffer.getChannelData(ch).slice());
    const NativeWorker = Worker;
    let computing = false, heartbeats = 0;
    w.Worker = class extends NativeWorker {
      constructor(url: string | URL) {
        super(url);
        this.addEventListener('message', event => { if (event.data.result) computing = false; });
      }
      postMessage(message: any, transfer: Transferable[]) {
        if (message.type === 'compute') computing = true;
        super.postMessage(message, transfer);
      }
    };
    let finished = false;
    const beat = () => { if (computing) heartbeats++; if (!finished) requestAnimationFrame(beat); };
    requestAnimationFrame(beat);
    const actual = await w._computeAudioAnalysis(buffer, 600);
    finished = true;
    w.Worker = NativeWorker;
    const expected = {waveform:w.computeWaveformData(buffer,600),
      spectrogram:w.computeSpectrogramData(buffer),metrics:w.computeAudioMetrics(buffer)};
    // Compare typed arrays element by element, including every spectral bin.
    function same(a: any, b: any): boolean {
      if (Object.is(a,b)) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
      if (ArrayBuffer.isView(a)) {
        if (a.constructor.name !== b.constructor.name || (a as any).length !== b.length) return false;
        for (let i = 0; i < (a as any).length; i++) if (!Object.is((a as any)[i], b[i])) return false;
        return true;
      }
      const keys=Object.keys(a);
      return keys.length===Object.keys(b).length && keys.every(key=>same(a[key],b[key]));
    }
    return {identical:same(actual,expected),heartbeats,channels:actual.metrics.channels,
      sourceUnchanged:original.every((plane,ch)=>same(plane,buffer.getChannelData(ch)))};
  });
  expect(result.identical).toBe(true);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.channels).toBe(8);
  expect(result.heartbeats).toBeGreaterThan(2);
});

for (const mode of ['clear','supersede']) {
  test(`analysis ${mode} cancels obsolete work and leaves the queue usable`, async ({page}) => {
    const result = await page.evaluate(async mode => {
      const w=window as any, NativeWorker=Worker;
      let live=0, maxLive=0;
      w.Worker=class extends NativeWorker {
        stopped=false;
        constructor(url:string|URL){super(url);maxLive=Math.max(maxLive,++live);}
        terminate(){if(!this.stopped){live--;this.stopped=true;}super.terminate();}
      };
      const oldBuffer=new AudioBuffer({length:240000,sampleRate:48000,numberOfChannels:8});
      const nextBuffer=new AudioBuffer({length:4800,sampleRate:48000,numberOfChannels:1});
      let current=true;
      const old=w._computeAudioAnalysis(oldBuffer,64,()=>current);
      const queued=w._computeAudioAnalysis(oldBuffer,64,()=>current);
      await new Promise(resolve=>setTimeout(resolve,10));
      current=false;
      if(mode==='clear')w.clearAllMedia();
      const fresh=w._computeAudioAnalysis(nextBuffer,64);
      const results=await Promise.all([old,queued,fresh]);
      w.Worker=NativeWorker;
      return {old:results[0],queued:results[1],freshChannels:results[2].metrics.channels,
        live,maxLive,sourceLength:oldBuffer.getChannelData(7).length};
    },mode);
    expect(result.old).toBeNull();
    expect(result.queued).toBeNull();
    expect(result.freshChannels).toBe(1);
    expect(result.maxLive).toBe(1);
    expect(result.live).toBe(0);
    expect(result.sourceLength).toBe(240000);
  });
}

test('blocked workers retain the original analysis compatibility path', async ({page,context}) => {
  await context.route('**/js/audio-analysis-worker.js', route=>route.abort());
  const result=await page.evaluate(async()=>{
    const w=window as any;
    const buffer=new AudioBuffer({length:4800,sampleRate:48000,numberOfChannels:2});
    buffer.getChannelData(1).fill(.25);
    const actual=await w._computeAudioAnalysis(buffer,64);
    return {metrics:actual.metrics,expected:w.computeAudioMetrics(buffer),
      left:actual.waveform.L[1],right:actual.waveform.R[1]};
  });
  expect(result.metrics).toEqual(result.expected);
  expect(result.left).toBe(0);
  expect(result.right).toBe(.25);
});
