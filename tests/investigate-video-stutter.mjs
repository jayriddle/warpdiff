// Isolated and muted. Retains timing/decoder diagnostics, never movie frames or PCM.
// node tests/investigate-video-stutter.mjs --clip /path/to/video.mp4 --out /tmp/stutter.json
import {chromium} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const clip = path.resolve(option('--clip', '')), out = option('--out', '/tmp/warpdiff-video-stutter.json');
if (!args.includes('--clip')) throw Error('--clip is required');
const seconds = Number(option('--seconds', '20'));
const arms = option('--arms', 'native,native-routed,app-cold,app-ready').split(',');
const version = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
const browser = await chromium.launch({channel:'chrome', headless:true,
  args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report = {at:new Date().toISOString(), clip:path.basename(clip), browser:browser.version(), version, seconds, arms:[]};
const quantile = (values,q) => values.length ? values.slice().sort((a,b)=>a-b)[Math.floor((values.length-1)*q)] : null;
try {
  for (const arm of arms) {
    const context = await browser.newContext({viewport:{width:Number(option('--width','1639')),height:Number(option('--height','1492'))},
      deviceScaleFactor:Number(option('--dpr','2')),serviceWorkers:'block'});
    const page = await context.newPage(), errors = [], mediaEvents = [];
    page.on('pageerror', e=>errors.push(String(e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Media.enable');
    cdp.on('Media.playerPropertiesChanged', e=>mediaEvents.push(e));
    cdp.on('Media.playerErrorsRaised', e=>mediaEvents.push(e));
    await page.addInitScript(version => {
      localStorage.setItem('lastSeenVersion',version);
      window.__stutter = {tasks:[],events:[],writes:[],costs:[]};
      new PerformanceObserver(list => window.__stutter.tasks.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration}))))
        .observe({type:'longtask', buffered:true});
      for(const name of ['currentTime','playbackRate','muted']) {
        const original=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,name);
        Object.defineProperty(HTMLMediaElement.prototype,name,{...original,set(value){
          window.__stutter.writes.push({at:performance.now(),name,value,paused:this.paused,time:this.currentTime,stack:new Error().stack.split('\n').slice(2,5)});
          original.set.call(this,value);
        }});
      }
    }, version);
    await page.goto('http://localhost:8080');
    if (arm.startsWith('native')) {
      await page.evaluate(() => {
        document.body.innerHTML='<input type="file" id="nativeFile"><video id="nativeVideo" loop style="width:95vw;height:90vh;object-fit:contain"></video>';
        window.__sourceVideo=document.querySelector('video');
      });
      await page.locator('#nativeFile').setInputFiles(clip);
      await page.evaluate(() => {window.__sourceVideo.src=URL.createObjectURL(document.querySelector('input').files[0]);});
      await page.waitForFunction(()=>window.__sourceVideo.readyState>=2);
      if (arm==='native-routed') await page.evaluate(() => {
        const ctx=new AudioContext(),source=ctx.createMediaElementSource(window.__sourceVideo);
        const route=window.WarpScrubAudio.monitor.connect(source,ctx.destination,8,null);
        window.__nativeProbe={ctx,source,route};
      });
    } else {
      if (arm.startsWith('app-cold')) await page.evaluate(synchronous => {
        const original=window._computeAudioAnalysis;
        const ready=new Promise(resolve=>{window.__releaseAnalysis=resolve;});
        // Start both implementations during playback. Otherwise fast decoding
        // can finish the control before the measurement's play command arrives.
        window._computeAudioAnalysis=async (buffer,buckets,...rest)=>{
          await ready;
          return synchronous ? {waveform:window.computeWaveformData(buffer,buckets),
            spectrogram:window.computeSpectrogramData(buffer),metrics:window.computeAudioMetrics(buffer)}
            : original(buffer,buckets,...rest);
        };
      },arm.endsWith('-sync'));
      await page.evaluate(() => {
        for (const name of ['computeWaveformData','computeSpectrogramData','computeAudioMetrics','updateVideoScopes','updateSpectrogramCursor']) {
          const fn=window[name];window[name]=function(...args){const at=performance.now();try{return fn(...args);}finally{window.__stutter.costs.push({name,at,duration:performance.now()-at});}};
        }
      });
      await page.locator('#multiFileInput').setInputFiles(clip);
      await page.waitForFunction(()=>document.querySelector('.asset-layer video')?.readyState>=2);
      if (!arm.startsWith('app-cold')) await page.waitForFunction(()=>window.eval('!!_videoAudioBuffers.editA && !!_continuousScrubEngine.state.node'),null,{timeout:60000});
      await page.evaluate(() => {window.__sourceVideo=document.querySelector('.asset-layer video');});
      if (arm.includes('viz')) await page.evaluate(() => window.eval('_audioVizHeight=422; _audioVizSplit=.483; if (!audioVizVisible) toggleAudioViz(); else _applyAudioVizLayout(true)'));
      if (arm.includes('scopes')) await page.evaluate(() => window.eval('if (!videoScopesVisible) toggleVideoScopes()'));
      if (arm.includes('scrub')) {
        const box=await page.locator('#videoProgressContainer').boundingBox();
        await page.mouse.move(box.x+box.width*.15,box.y+box.height/2);
        await page.mouse.down();
        await page.mouse.move(box.x+box.width*.45,box.y+box.height/2,{steps:40});
        await page.mouse.up();
      }
    }
    const data = await page.evaluate(async ({arm,seconds}) => {
      const video=window.__sourceVideo, d=window.__stutter;
      const events=['play','playing','pause','waiting','stalled','seeking','seeked','ratechange','ended'];
      for(const event of events) video.addEventListener(event,()=>d.events.push({at:performance.now(),event,time:video.currentTime,ready:video.readyState}));
      const quality=()=>{const q=video.getVideoPlaybackQuality();return {droppedVideoFrames:q.droppedVideoFrames,totalVideoFrames:q.totalVideoFrames};};
      const frames=[],ticks=[],begin=performance.now(),qualityBefore=quality();
      let stop=false;
      const frame=(now,m)=>{
        frames.push({now,time:m.mediaTime,presented:m.presentedFrames,expected:m.expectedDisplayTime,processing:m.processingDuration});
        if(!stop)video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      const tick=now=>{
        ticks.push({now,time:video.currentTime,rate:video.playbackRate,ready:video.readyState,seeking:video.seeking});
        if(!stop)requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      if(arm.startsWith('native')) {if(window.__nativeProbe)await window.__nativeProbe.ctx.resume();await video.play();}
      else window.playAllMedia();
      if (arm.startsWith('app-cold')) video.requestVideoFrameCallback(()=>setTimeout(window.__releaseAnalysis,100));
      await new Promise(resolve=>setTimeout(resolve,seconds*1000));
      stop=true;
      const finish=performance.now(),qualityAfter=quality();
      video.pause();
      return {begin,finish,duration:video.duration,qualityBefore,qualityAfter,frames,ticks,...d,
        app:arm.startsWith('app')?window.eval(`({opus:_opusSyncActive,scope:_playbackScope,scrubActive:_continuousScrubEngine.state.active,
          channels:_nativeAudioRoutes.get(window.__sourceVideo)?.channels,ctx:getAudioContext().sampleRate,ctxState:getAudioContext().state,
          scopes:videoScopesVisible,loupe:magnifierEnabled,diff:_diffMode})`):null};
    }, {arm,seconds});
    const regular=data.frames.slice(1).map((v,i)=>({...v,dt:v.now-data.frames[i].now,mediaDelta:v.time-data.frames[i].time,skipped:v.presented-data.frames[i].presented-1}));
    const steady=regular.filter(v=>v.mediaDelta>0&&v.time>.3&&v.time<data.duration-.3);
    const cadence = steady.map(v=>v.dt);
    const during=data.tasks.filter(t=>t.at>=data.begin&&t.at<data.finish);
    const result={arm,summary:{presentations:data.frames.length,frameP50:quantile(cadence,.5),frameP95:quantile(cadence,.95),
      gapsOver80:steady.filter(v=>v.dt>80).length,maxFrameGap:Math.max(...cadence),
      dropped:data.qualityAfter.droppedVideoFrames-data.qualityBefore.droppedVideoFrames,
      total:data.qualityAfter.totalVideoFrames-data.qualityBefore.totalVideoFrames,
      longTasks:during.length,maxTask:Math.max(0,...during.map(t=>t.duration)),
      playingSeeks:data.writes.filter(w=>w.at>=data.begin&&w.name==='currentTime'&&!w.paused).length,
      rateWrites:data.writes.filter(w=>w.at>=data.begin&&w.name==='playbackRate').length,
      rateRange:[Math.min(...data.ticks.map(v=>v.rate)),Math.max(...data.ticks.map(v=>v.rate))],app:data.app},
      errors,mediaEvents,data};
    report.arms.push(result);console.log(JSON.stringify({arm,...result.summary,errors}));
    writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    await context.close();
  }
} finally {await browser.close();}
