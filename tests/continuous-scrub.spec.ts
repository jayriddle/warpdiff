import { test, expect } from '@playwright/test';
import path from 'node:path';

for (const direction of [1, -1]) test(`the selected scrub engine keeps ${direction > 0 ? 'forward' : 'reverse'} slow dialogue near its original volume`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(direction => (window as any).eval(`(async () => {
    const direction=${direction};
    const sr=48000, ctx=new OfflineAudioContext(2,sr*8,sr), source=ctx.createBuffer(2,sr*3,sr);
    let phase=0, seed=71;
    for(let i=0;i<source.length;i++) {
      const t=i/sr;phase+=2*Math.PI*(183+27*Math.sin(2*Math.PI*2.7*t))/sr;
      seed=(1664525*seed+1013904223)>>>0;
      let v=.018*(seed/2147483648-1);
      for(let k=1;k<=9;k++)v+=.12/k*Math.sin(phase*k+.4*k);
      v*=.15+.85*Math.sin(Math.PI*((t*4)%1))**2;
      if(direction<0) {
        // A voiced segment after silence exposed the old correction ceiling.
        const voiced=t-.127;v=0;
        if(voiced>=0&&voiced<2) {
          for(let k=1;k<=16;k++)v+=.15/k*Math.sin(2*Math.PI*300*k*voiced);
          v*=Math.min(1,voiced/.02,(2-voiced)/.02);
        }
      }
      source.getChannelData(0)[i]=v;source.getChannelData(1)[i]=v;
    }
    const text=await (await fetch('js/scrub-worklet.js')).text();
    // Acknowledgement only; the actual selected app engine and DSP process the
    // signal. Offline rendering otherwise can outrun queued load/play messages.
    const url=URL.createObjectURL(new Blob([text+'\\nconst original=PhaseVocoderProcessor.prototype._msg;PhaseVocoderProcessor.prototype._msg=function(d){original.call(this,d);if(d.type==="play"&&d.value)this.port.postMessage({type:"test-ready"});};'],{type:'text/javascript'}));
    await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    ctx.audioWorklet.addModule=async()=>{}; // shipped processor is already registered above
    const engine=_continuousScrubEngine;
    if(!await engine.load(ctx,source))throw Error(engine.state.error);
    const node=engine.state.node;
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('No processor acknowledgement')),5000);
      node.port.onmessage=e=>{if(e.data.type==='test-ready'){clearTimeout(timer);resolve();}};
    });
    engine.update({offset:direction>0?.25:2.25,tempo:direction>0?.25:.5,direction,level:1,continuous:false});
    await ready;
    const rendered=await ctx.startRendering();node.disconnect();node.port.close();
    const power=(data,from,to)=>{let sum=0;for(let i=from*sr;i<to*sr;i++)sum+=data[i]*data[i];return sum/((to-from)*sr);};
    const before=power(source.getChannelData(0),.5,2),after=power(rendered.getChannelData(0),direction>0?1:.5,direction>0?7:3.5);
    let error=0,peak=0;
    for(let i=0;i<rendered.length;i++){const l=rendered.getChannelData(0)[i],r=rendered.getChannelData(1)[i];error=Math.max(error,Math.abs(l-r));peak=Math.max(peak,Math.abs(l));}
    return {difference:10*Math.log10(after/before),before,after,error,peak};
  })()`), direction);
  expect(result.before).toBeGreaterThan(.001);
  expect(result.after).toBeGreaterThan(.001);
  expect(Math.abs(result.difference)).toBeLessThan(.65);
  expect(result.error).toBe(0);
  expect(result.peak).toBeLessThan(1);
});

test('continuous scrub is standard, retains center dialogue, and releases its stream', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pref_scrubAudioMode', JSON.stringify('snippets')));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  await expect(page.locator('#scrubModeBtn')).toHaveCount(0);
  await page.waitForFunction(() => (window as any).eval('!!_continuousScrubEngine.state.node'));
  const warm = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2));
  expect(warm.framesPainted).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as any).eval(`({
    channels:_videoAudioBuffers.editA.numberOfChannels, metrics:JSON.stringify(audioMetrics.editA),
    start:_audioTimelineStarts.editA, bytes:_continuousScrubEngine.state.bytes
  })`));
  expect(before.channels).toBe(3); // Full stereo plus an independently retained center.
  expect(JSON.parse(before.metrics).channels).toBe(8);
  expect(before.start).toBeCloseTo(0.166, 3);
  expect(before.bytes).toBeGreaterThan(0);
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  const duration = await page.evaluate(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).duration);
  const x = box.x + box.width * 2 / duration, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 45; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  const playing = await page.evaluate(() => (window as any).eval(`(() => {
    const state = _continuousScrubEngine.state;
    const analyser = state.ctx.createAnalyser(); analyser.fftSize = 2048;
    state.gain.connect(analyser); window.__continuousAnalyser = analyser;
    return {active:state.active, sameChannels:_videoAudioBuffers.editA.numberOfChannels,
      metrics:JSON.stringify(audioMetrics.editA), gain:state.gain.gain.value};
  })()`));
  expect(playing.active).toBe(true);
  expect(playing.sameChannels).toBe(before.channels);
  expect(playing.metrics).toBe(before.metrics);
  for (let i = 46; i <= 55; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  const rms = await page.evaluate(() => {
    const a = (window as any).__continuousAnalyser;
    const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((s, v) => s + v*v, 0) / data.length);
  });
  expect(rms).toBeGreaterThan(0.01);
  const node = await page.evaluate(() => (window as any).eval(`(window.__scrubNode = _continuousScrubEngine.state.node, true)`));
  expect(node).toBe(true);
  for (let i = 54; i >= 20; i--) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubCursor.direction'))).toBe(-1);
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.node === window.__scrubNode'))).toBe(true);
  await page.evaluate(() => (window as any).eval('toggleMute()'));
  await expect.poll(() => page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.evaluate(() => (window as any).eval('toggleMute()'));
  for (let i = 21; i <= 35; i++) {
    await page.mouse.move(x + box.width * (i * 0.003) / duration, y);
    await page.waitForTimeout(20);
  }
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(true);
  await page.waitForTimeout(250); // holding a drag still must stop the continuous stream
  expect(await page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).eval('_continuousScrubEngine.state.active'))).toBe(false);
  await page.evaluate(() => (window as any).clearAllMedia());
  expect(await page.evaluate(() => (window as any).eval('({bytes:_continuousScrubEngine.state.bytes, node:!!_continuousScrubEngine.state.node})'))).toEqual({bytes:0,node:false});
});

test('old snippet preferences are ignored and failed loading retains click and drag previews', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('pref_scrubAudioMode', JSON.stringify('snippets')));
  await page.reload();
  await expect(page.locator('#scrubModeBtn')).toHaveCount(0);
  // A real failed module URL exercises the fallback; page routing does not
  // intercept AudioWorklet fetches consistently across Chromium versions.
  await page.evaluate(() => (window as any).eval(`(() => {
    const prototype = Object.getPrototypeOf(getAudioContext().audioWorklet), add = prototype.addModule;
    prototype.addModule = function() { return add.call(this, '/missing-scrub-module.js'); };
    window.__fallbackGrains = [];
    const play = playScrubSnippet;
    playScrubSnippet = time => { play(time); window.__fallbackGrains.push({time,source:!!_scrubSource}); };
  })()`));
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/surround_71.mp4'));
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  const duration = await page.evaluate(() => (document.querySelector('#layerEditA video') as HTMLVideoElement).duration);
  const x = box.x + box.width * 2 / duration, y = box.y + box.height / 2;
  await page.mouse.move(x,y); await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(x + box.width * i * 0.003 / duration,y);
    await page.waitForTimeout(20);
  }
  const fallback = await page.evaluate(() => (window as any).eval(`({
    error:_continuousScrubEngine.state.error, grains:window.__fallbackGrains.filter(g => g.source).length,
    node:!!_continuousScrubEngine.state.node, bytes:_continuousScrubEngine.state.bytes
  })`));
  expect(fallback.error).toBeTruthy(); expect(fallback.node).toBe(false);
  expect(fallback.bytes).toBe(0); expect(fallback.grains).toBeGreaterThan(5);
  await page.mouse.up();
  await page.evaluate(() => (window as any).eval('playScrubSnippet(2)'));
  expect(await page.evaluate(() => (window as any).eval('!!_scrubSource'))).toBe(true);
});

test('Grid source changes retain only the selected continuous buffer and clear pending work', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles([
    path.join(__dirname, 'fixtures/surround_71.mp4'),
    path.join(__dirname, 'fixtures/landscape_a.mp4'),
    path.join(__dirname, 'fixtures/landscape_b.mp4'),
  ]);
  await page.waitForFunction(() => (window as any).eval('Object.keys(_videoAudioBuffers).length >= 3'));
  await page.evaluate(() => (window as any).eval(`if (!isGridMode) _toggleStackGridMode();`));
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const slots = assetOrder.filter(slot => _videoAudioBuffers[slot]);
    const counts = [];
    for (const slot of slots) {
      selectAudioSource(slot); await _prepareContinuousScrub();
      const state = _continuousScrubEngine.state;
      counts.push({selected:state.buffer === _videoAudioBuffers[slot], channels:state.node.numberOfOutputs,
        bytes:state.bytes, expected:Math.ceil(_videoAudioBuffers[slot].duration * state.ctx.sampleRate) * _videoAudioBuffers[slot].numberOfChannels * 4});
    }
    // Start another request and clear immediately. Its completion cannot republish.
    const wasGrid = isGridMode; selectAudioSource(slots[0]); const pending = _prepareContinuousScrub(); clearAllMedia(); await pending;
    return {wasGrid, grid:counts, bytes:_continuousScrubEngine.state.bytes, node:!!_continuousScrubEngine.state.node};
  })()`));
  expect(result.wasGrid).toBe(true);
  expect(result.grid).toHaveLength(3);
  for (const row of result.grid) { expect(row.selected).toBe(true); expect(row.bytes).toBe(row.expected); }
  expect(result.bytes).toBe(0); expect(result.node).toBe(false);
});
