// Diagnostic wrappers log actual app path selection without altering DSP.
// Trusted down/up; held movement uses the same in-page cadence as release tests.
import {chromium,webkit} from 'playwright';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
const folder=path.resolve(process.argv[2] || 'output/safari-scrub-pitch-2026-10-13');
await mkdir(folder,{recursive:true});
const report={at:new Date().toISOString(),browsers:[]};
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{})});
 const result={name,errors:[],gestures:[]};report.browsers.push(result);
 try {
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:800}});
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.addInitScript(()=>{
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){if(this.dataset.scrubPreviewOutput!==undefined)this.muted=true;return play.call(this);};
  });
  await page.goto('http://localhost:8080/');
  await page.locator('#multiFileInput').setInputFiles(path.resolve('tests/fixtures/ac3_video_aac.mp4'));
  await page.waitForFunction(()=>!!_videoAudioBuffers.editA&&!!_continuousScrubEngine.state.node,null,{timeout:60000});
  await page.waitForSelector('#comparisonView.active');
  await page.evaluate(()=>{
   pauseAllMedia();window.__paths=[];
   const snippet=playScrubSnippet,continuous=_playContinuousScrub;
   playScrubSnippet=function(time){const prior=_scrubSource;snippet(time);if(_scrubSource&&prior!==_scrubSource)__paths.push({kind:'snippet',at:performance.now(),time,rate:_scrubSource.playbackRate.value});};
   _playContinuousScrub=function(time){const result=continuous(time);__paths.push({kind:'preview-tick',at:performance.now(),time,handled:result,active:_continuousScrubEngine.state.active,error:_continuousScrubEngine.state.error,cursor:_continuousScrubCursor?{..._continuousScrubCursor}:null});return result;};
  });
  const box=await page.locator('#videoProgressContainer').boundingBox(),y=box.y+box.height/2;
  for(const rate of [1,.5,.25]) {
   while(await page.evaluate(r=>PLAYBACK_RATES[playbackRateIndex]>r,rate))await page.keyboard.press('j');
   while(await page.evaluate(r=>PLAYBACK_RATES[playbackRateIndex]<r,rate))await page.keyboard.press('k');
   for(const direction of [1,-1]) {
    const start=direction>0?.25:.7,end=direction>0?.7:.25;
    await page.mouse.move(box.x+box.width*start,y);
    await page.evaluate(()=>{__paths.length=0;});
    await page.mouse.down();
    const motion=await page.evaluate(async({box,y,start,end})=>{
     const times=[];
     for(let i=1;i<=16;i++){
      if(!__testAPI.isDragging)throw Error('Gesture lost');
      times.push(performance.now());
      document.dispatchEvent(new MouseEvent('mousemove',{clientX:box.x+box.width*(start+(end-start)*i/16),clientY:y,buttons:1,bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,40));
     }
     return {maxInputGap:Math.max(...times.slice(1).map((t,i)=>t-times[i])),paths:__paths.slice(),selectedRate:PLAYBACK_RATES[playbackRateIndex],sinkRate:_scrubPreviewOutput?.audio.playbackRate,engineError:_continuousScrubEngine.state.error};
    },{box,y,start,end});
    await page.mouse.up();await page.waitForTimeout(170);
    result.gestures.push({rate,direction,...motion});
    console.log(name,rate,direction,JSON.stringify({selectedRate:motion.selectedRate,maxInputGap:motion.maxInputGap,snippets:motion.paths.filter(x=>x.kind==='snippet'),activeTicks:motion.paths.filter(x=>x.active).length,sinkRate:motion.sinkRate,engineError:motion.engineError}));
   }
  }
  await page.evaluate(()=>clearAllMedia());
 }catch(e){result.errors.push(String(e.stack||e));console.error(name,e);}
 finally{await browser.close();}
 await writeFile(folder+'/gestures.json',JSON.stringify(report,null,2)+'\n');
}
if(report.browsers.some(x=>x.errors.length))process.exitCode=1;
