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

test('verified surround layout is applied by the worker and the foreground path', async ({page}) => {
  const result = await page.evaluate(async () => {
    const w = window as any;
    const rate = 48000, n = rate * 4, amp = 10 ** (-20 / 20);
    const buffer = new AudioBuffer({length: n, sampleRate: rate, numberOfChannels: 6});
    const plane = buffer.getChannelData(4);
    for (let i = 0; i < n; i++) plane[i] = amp * Math.sin(2 * Math.PI * 1000 * i / rate);
    const weighted = await w._computeAudioAnalysis(buffer, 64, () => true, '5.1');
    const direct = w.computeAudioMetrics(buffer, '5.1');
    const plain = w.computeAudioMetrics(buffer);
    return {
      worker: weighted.metrics.integratedLUFS,
      direct: direct.integratedLUFS,
      plain: plain.integratedLUFS,
      layout: weighted.metrics.loudnessLayout,
      same: weighted.metrics.integratedLUFS === direct.integratedLUFS
        && weighted.metrics.truePeakDBTP === direct.truePeakDBTP
        && weighted.metrics.loudnessLayout === direct.loudnessLayout,
    };
  });
  expect(result.worker).toBe('-21.5');
  expect(result.direct).toBe('-21.5');
  expect(result.plain).toBe('-23.0');
  expect(result.layout).toBe('5.1');
  expect(result.same).toBe(true);
});

test('worker and foreground agree on EBU loudness and true-peak cases', async ({page}) => {
  const result = await page.evaluate(async () => {
    const w = window as any;
    const rate = 48000;
    function sine(levelDb, seconds, freq = 1000, phase = 0) {
      const amp = 10 ** (levelDb / 20), n = Math.round(rate * seconds), data = new Float32Array(n);
      const fade = Math.round(0.01 * rate);
      for (let i = 0; i < n; i++) {
        let window = 1;
        if (i < fade) window = 0.5 - 0.5 * Math.cos(Math.PI * i / fade);
        else if (i >= n - fade) window = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / fade);
        data[i] = amp * window * Math.sin(2 * Math.PI * freq * i / rate + phase);
      }
      return data;
    }
    function buffer(planes) {
      return new AudioBuffer({length: planes[0].length, sampleRate: rate, numberOfChannels: planes.length});
    }
    async function compare(planes, layout) {
      const audio = buffer(planes);
      for (let c = 0; c < planes.length; c++) audio.copyToChannel(planes[c], c);
      const worker = await w._computeAudioAnalysis(audio, 64, () => true, layout);
      const direct = w.computeAudioMetrics(audio, layout);
      return {worker: worker.metrics.integratedLUFS, direct: direct.integratedLUFS,
        workerTp: worker.metrics.truePeakDBTP, directTp: direct.truePeakDBTP,
        layout: worker.metrics.loudnessLayout};
    }
    const tone = sine(-23, 4);
    const peak = sine(20 * Math.log10(0.5), 0.5, rate / 4, Math.PI / 4);
    const n = rate * 4;
    const channel = db => {
      const data = new Float32Array(n);
      if (db === null) return data;
      const amp = 10 ** (db / 20);
      for (let i = 0; i < n; i++) data[i] = amp * Math.sin(2 * Math.PI * 1000 * i / rate);
      return data;
    };
    return {
      stereo: await compare([tone, tone], null),
      peak: await compare([peak, peak], null),
      surround: await compare([channel(-28), channel(-28), channel(-24), channel(null), channel(-30), channel(-30)], '5.1'),
    };
  });
  expect(result.stereo.worker).toBe('-23.0');
  expect(result.stereo.direct).toBe('-23.0');
  expect(result.peak.workerTp).toBe(result.peak.directTp);
  expect(Number(result.peak.workerTp)).toBeGreaterThanOrEqual(-6.4);
  expect(Number(result.peak.workerTp)).toBeLessThanOrEqual(-5.8);
  expect(result.surround.worker).toBe('-23.0');
  expect(result.surround.direct).toBe('-23.0');
  expect(result.surround.layout).toBe('5.1');
});

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
