// Local comparison probe. Does not retain media bytes, frames, or audio samples.
// node tests/investigate-shared-scrub.mjs --clip /path/to/movie.mp4 --out /tmp/scrub.json
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
if (!args.includes('--clip') || !args.includes('--out')) throw new Error('--clip and --out are required');
const clip = path.resolve(value('--clip'));
const browser = await chromium.launch({channel:'chrome', headless:true,
  args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report = {at:new Date().toISOString(), file:path.basename(clip), size:statSync(clip).size,
  sha256:createHash('sha256').update(readFileSync(clip)).digest('hex'), browser:browser.version(), arms:[], errors:[]};
try {
  const context = await browser.newContext({viewport:{width:1920,height:1080}, serviceWorkers:'block'});
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(args.includes('--url') ? value('--url') : 'http://localhost:8080');
  report.appVersion = await page.evaluate(() => window.eval('APP_VERSION'));
  report.component = JSON.parse(readFileSync(new URL('../js/SCRUB_AUDIO_LOCK.json', import.meta.url), 'utf8'));
  await page.locator('#multiFileInput').setInputFiles(clip);
  await page.waitForFunction(() => window.eval('!!_videoAudioBuffers.editA && !!audioMetrics.editA'),null,{timeout:60000});
  await page.evaluate(() => window.eval('pauseAllMedia()'));
  for (const time of [3,3.2,3.4]) await page.evaluate(time => window.__testAPI.scrubVideo.decodeProbe('editA',time),time);
  report.source = await page.evaluate(() => window.eval(`({channels:_videoAudioBuffers.editA.numberOfChannels,
    sampleRate:_videoAudioBuffers.editA.sampleRate, duration:_videoAudioBuffers.editA.duration,
    pcmBytes:_videoAudioBuffers.editA.length*_videoAudioBuffers.editA.numberOfChannels*4,
    audioStart:_audioTimelineStarts.editA, metrics:audioMetrics.editA})`));
  const cdp = await context.newCDPSession(page), system = await browser.newBrowserCDPSession();
  const cpu = async () => (await system.send('SystemInfo.getProcessInfo')).processInfo.reduce((sum,p) => sum+p.cpuTime,0);
  await page.evaluate(() => window.eval(`(() => {
    const tick = _scrubAudioTick;
    _scrubAudioTick = function() {
      const at = performance.now(); tick();
      const state = _continuousScrubEngine.state;
      window.__scrubProbe.push({at, cost:performance.now()-at, target:_scrubAudioTargetT,
        pointer:_scrubAudioPointerT, active:state.active, direction:_continuousScrubCursor?.direction || 0,
        grain:!!_scrubSource, rate:_continuousScrubCursor?.rate || 0});
    };
    window.__scrubProbe = [];
  })()`));
  for (const mode of ['snippets','continuous','continuous','snippets']) {
    await page.evaluate(mode => window.eval(`_setScrubAudioMode('${mode}'); _prepareContinuousScrub()`),mode);
    await page.waitForTimeout(250);
    const box = await page.locator('#videoProgressContainer').boundingBox();
    if (!box || box.width < 400) throw new Error('Timeline is not ready');
    const duration = await page.evaluate(() => document.querySelector('#layerEditA video').duration);
    const x = time => box.x + box.width * time / duration, y = box.y + box.height/2;
    await page.evaluate(() => { window.__scrubProbe = []; });
    const beforeCpu = await cpu(), start = Date.now();
    await page.mouse.move(x(3),y); await page.mouse.down();
    for (let i=1;i<=60;i++) { await page.mouse.move(x(3+i*0.006),y); await page.waitForTimeout(20); }
    for (let i=59;i>=15;i--) { await page.mouse.move(x(3+i*0.006),y); await page.waitForTimeout(20); }
    const wallSeconds = (Date.now()-start)/1000, cpuSeconds = (await cpu())-beforeCpu;
    const live = await page.evaluate(() => window.eval(`({trace:window.__scrubProbe.slice(), bytes:_continuousScrubEngine.state.bytes,
      sourceChannels:_videoAudioBuffers.editA.numberOfChannels, metrics:audioMetrics.editA,
      overlay:__testAPI.scrubVideo.overlayLive()})`));
    await page.mouse.up(); await page.waitForTimeout(250);
    const idle = await page.evaluate(() => window.eval('({stream:_continuousScrubEngine.state.active, grain:!!_scrubSource})'));
    const heap = await cdp.send('Runtime.getHeapUsage');
    const costs = live.trace.map(t=>t.cost).sort((a,b)=>a-b);
    const gaps = live.trace.slice(1).map((t,i)=>t.at-live.trace[i].at);
    report.arms.push({mode,wallSeconds,cpuSeconds,browserCpuPercent:100*cpuSeconds/wallSeconds,
      streamPcmBytes:live.bytes, sourceChannels:live.sourceChannels, metricsUnchanged:JSON.stringify(live.metrics)===JSON.stringify(report.source.metrics),
      displayedTimes:new Set(live.trace.map(t=>t.target)).size, overlay:live.overlay,
      activeTicks:live.trace.filter(t=>t.active||t.grain).length,
      reverseTicks:live.trace.filter(t=>t.direction<0).length,
      maxClockGapMs:Math.max(0,...gaps), p95MainTickMs:costs[Math.floor(costs.length*0.95)] || 0, idle, heap});
  }
  await page.evaluate(() => window.eval('clearAllMedia()'));
  await page.waitForTimeout(100);
  report.cleared = await page.evaluate(() => window.eval(`({bytes:_continuousScrubEngine.state.bytes,
    retiringBytes:_continuousScrubEngine.state.retiringBytes,node:!!_continuousScrubEngine.state.node})`));
  report.limits = 'Single local desktop run, device audio muted. CPU is summed process CPU time for this isolated Chrome instance, not a general performance guarantee. Heap excludes some native/GPU/audio allocations; streamPcmBytes counts retained listening PCM only. Human listening quality is not measured.';
} finally {
  writeFileSync(value('--out'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify(report,null,2));
