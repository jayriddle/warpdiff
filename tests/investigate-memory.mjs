// Isolated, muted Chrome. Records counters and WeakRefs, never movie frames or PCM.
// node tests/investigate-memory.mjs --clip /path/to/video.mp4 --out /tmp/memory.json
import {chromium} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const args=process.argv.slice(2), option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
if (!args.includes('--clip')) throw Error('--clip is required');
const clip=path.resolve(option('--clip','')), out=option('--out','/tmp/warpdiff-memory.json');
const cycles=Number(option('--cycles','8')), loopSeconds=Number(option('--loop-seconds','90'));
const version=readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1639,height:1492},deviceScaleFactor:2,serviceWorkers:'block'});
const page=await context.newPage(), cdp=await context.newCDPSession(page), browserCdp=await browser.newBrowserCDPSession();
const report={at:new Date().toISOString(),clip:path.basename(clip),version,browser:browser.version(),cycles,loopSeconds,samples:[],errors:[]};
page.on('pageerror',error=>report.errors.push(String(error)));
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
async function sample(phase,gc=true) {
  if (gc) {
    await cdp.send('Runtime.discardConsoleEntries');
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(120);
    await cdp.send('HeapProfiler.collectGarbage');
  }
  const heap=await cdp.send('Runtime.getHeapUsage'), dom=await cdp.send('Memory.getDOMCounters');
  const targets=(await browserCdp.send('Target.getTargets')).targetInfos.map(t=>({type:t.type,url:t.url}));
  const processes=(await browserCdp.send('SystemInfo.getProcessInfo')).processInfo.map(p=>{
    let rssKiB=null;
    try {rssKiB=Number(execFileSync('ps',['-o','rss=','-p',String(p.id)],{encoding:'utf8'}).trim());} catch {}
    return {type:p.type,pid:p.id,cpuTime:p.cpuTime,rssKiB};
  });
  const app=await page.evaluate(()=>window.eval(`(() => {
    const state=_continuousScrubEngine.state;
    const pcm=Object.values(_videoAudioBuffers).reduce((n,b)=>n+(b?b.length*b.numberOfChannels*4:0),0);
    const video=document.querySelector('.asset-layer video'),q=video?.getVideoPlaybackQuality();
    const refs=window.__memoryRefs.map(group=>Object.fromEntries(Object.entries(group).map(([name,weak])=>{
      const item=weak.deref();
      return [name,!item?null:name==='video'?{connected:item.isConnected,paused:item.paused,ready:item.readyState}:true];
    })));
    return {at:performance.now(),nativeRoutes:_nativeAudioRoutes.size,monitorRoutes:_audioMonitorRoutes.size,
      monitorSlots:_audioMonitorSlots.size,blobUrls:_blobUrls.length,analysisQueue:_audioAnalysisQueue.length,
      analysisActive:!!_audioAnalysisJob,audioContext:audioContext?.state||null,listeningBytes:pcm,
      continuous:{bytes:state.bytes,retiringBytes:state.retiringBytes,active:state.active,node:!!state.node},
      sessions:Object.fromEntries(Object.entries(_scrubVideoSessions).map(([slot,s])=>[slot,{suspended:s.suspended,cache:s.cacheStats}])),
      quality:q?{dropped:q.droppedVideoFrames,total:q.totalVideoFrames,time:video.currentTime}:null,refs};
  })()`));
  const row={phase,gc,heap,dom,targets,processes,app}; report.samples.push(row);save();
  console.log(JSON.stringify({phase,gc,heap,dom,workers:targets.filter(t=>t.type==='worker').length,
    rendererMiB:processes.filter(p=>p.type==='renderer').reduce((n,p)=>n+p.rssKiB/1024,0),app}));
}
async function load() {
  await page.locator('#multiFileInput').setInputFiles(clip);
  await page.waitForFunction(()=>window.eval('!!_videoAudioBuffers.editA && !!_continuousScrubEngine.state.node'),null,{timeout:60000});
  await page.evaluate(()=>window.eval('if (!audioVizVisible) toggleAudioViz()'));
}
async function scrub() {
  const box=await page.locator('#videoProgressContainer').boundingBox(), y=box.y+box.height/2;
  await page.mouse.move(box.x+box.width*.15,y);await page.mouse.down();
  for (const fraction of [.8,.2,.7]) await page.mouse.move(box.x+box.width*fraction,y,{steps:32});
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function remember() {
  await page.evaluate(()=>window.eval(`(() => {
    const video=document.querySelector('.asset-layer video');
    const items={video,buffer:_videoAudioBuffers.editA,context:audioContext,
      node:_continuousScrubEngine.state.node,session:_scrubVideoSessions.editA};
    window.__memoryRefs.push(Object.fromEntries(Object.entries(items).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,new WeakRef(v)])));
  })()`));
}
try {
  await page.addInitScript(version=>{localStorage.setItem('lastSeenVersion',version);window.__memoryRefs=[];},version);
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(500);
  await sample('baseline');
  for (let cycle=1;cycle<=cycles;cycle++) {
    await load();
    await page.evaluate(()=>window.playAllMedia());await page.waitForTimeout(1000);
    await scrub();
    await remember();
    await sample(`cycle-${cycle}-loaded`);
    // Clear during playback as well as from pause; real file replacement can do either.
    if (cycle%2) await page.evaluate(()=>window.playAllMedia());
    else await page.evaluate(()=>window.pauseAllMedia());
    await page.evaluate(()=>window.clearAllMedia());await page.waitForTimeout(750);
    await sample(`cycle-${cycle}-cleared`);
  }
  if (loopSeconds>0) {
    await load();await scrub();await remember();
    await page.evaluate(()=>window.pauseAllMedia());
    await page.waitForTimeout(100);
    await page.evaluate(()=>window.playAllMedia());
    await page.waitForFunction(()=>{const v=document.querySelector('.asset-layer video');return v&&!v.paused&&v.loop;});
    await sample('loop-start');
    for(let seconds=15;seconds<=loopSeconds;seconds+=15) {
      await page.waitForTimeout(15000);
      if(!await page.evaluate(()=>{const v=document.querySelector('.asset-layer video');return v&&!v.paused;})) throw Error('Loop measurement lost active playback');
      await sample(`loop-${seconds}s`,false);
    }
    await page.evaluate(()=>window.pauseAllMedia());await sample('loop-end-collected');
    await page.evaluate(()=>window.clearAllMedia());await page.waitForTimeout(1000);await sample('final-cleared');
  }
  if(args.includes('--snapshot')) {
    const chunks=[];
    cdp.on('HeapProfiler.addHeapSnapshotChunk',({chunk})=>chunks.push(chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
    writeFileSync(option('--snapshot','/tmp/warpdiff-memory.heapsnapshot'),chunks.join(''));
  }
} finally {save();await browser.close();}
