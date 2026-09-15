// Muted browser smoke; retains numbers and hashes, never movie frames or audio.
// Serve WarpDiff on 8080, then: node tests/investigate-dialogue-browser.mjs file... --out report.json
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2), outAt=args.indexOf('--out');
const output=outAt<0?null:args[outAt+1], files=outAt<0?args:args.slice(0,outAt);
if(!files.length) throw Error('Supply local media files to inspect');
const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report={method:'Muted headless Chromium. Actual local files, decoded center identity, listening controls, source metrics/timing and desktop geometry. No intelligibility claim.',files:[],geometry:[]};
try {
  for(const file of files) {
    const page=await browser.newPage({viewport:{width:1920,height:1080}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','3.17.0'));
    await page.goto('http://localhost:8080');
    await page.locator('#multiFileInput').setInputFiles(file);
    await page.waitForFunction(()=>window.eval('!!_videoAudioBuffers.editA && !!_continuousScrubEngine.state.node'),null,{timeout:45000});
    const record=await page.evaluate(()=>window.eval(`(() => {
      const info=_audioMonitorSlots.get('editA'), buffer=_videoAudioBuffers.editA;
      const originalMetrics=JSON.stringify(audioMetrics.editA), media=getLayer('editA').querySelector('video'), time=media.currentTime;
      const center=buffer.numberOfChannels>2?buffer.getChannelData(2):null, start=Math.round(buffer.sampleRate), count=Math.round(buffer.sampleRate*.128);
      const bands=center?[375,750,1500,3000,4500,6000,7500].map(hz=>{
        let re=0,im=0;for(let i=0;i<count;i++){const angle=2*Math.PI*hz*i/buffer.sampleRate;re+=center[start+i]*Math.cos(angle);im+=center[start+i]*Math.sin(angle);}
        return {hz,amplitude:2*Math.hypot(re,im)/count};
      }):[];
      setAudioListening({mode:'center',centerDb:6});
      const focused=_audioMonitorPlanForSlot('editA');setAudioListening({mode:'full'});
      return {layout:info?.layout,ready:info?.ready,originalChannels:info?.channels,storedChannels:buffer.numberOfChannels,
        selectedBytes:_continuousScrubEngine.state.bytes,start:_audioTimelineStarts.editA,bands,
        otherMuted:focused.otherGain===0,metricsUnchanged:originalMetrics===JSON.stringify(audioMetrics.editA),timeUnchanged:media.currentTime===time};
    })()`));
    record.sourceSha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    record.synthetic=/dialogue_(51|71)/.test(file);record.pageErrors=errors;
    record.passed=!!record.ready&&record.otherMuted&&record.metricsUnchanged&&record.timeUnchanged&&!errors.length;console.log(JSON.stringify(record));
    if(record.synthetic && (!(record.bands.find(b=>b.hz===1500)?.amplitude>=.05) || record.bands.find(b=>b.hz===375)?.amplitude>.005)) record.passed=false;
    report.files.push(record);
    if(record.synthetic && !report.geometry.length) {
      for(const [width,height] of [[1024,768],[1280,720],[1920,1080]]) {
        await page.setViewportSize({width,height});
        await page.locator('#audioListeningLabel').click();
        const geometry=await page.locator('.audio-listening-panel').evaluate(element=>{
          const r=element.getBoundingClientRect();
          const controls=[...element.querySelectorAll('button,input')].map(node=>{
            const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};
          });
          return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,controls};
        });
        if([geometry,...geometry.controls].some(b=>b.left<0||b.right>width||b.top<0||b.bottom>height)) throw Error('Clipped listening controls: '+JSON.stringify(geometry));
        report.geometry.push(geometry);
        await page.keyboard.press('Escape');
      }
    }
    await page.evaluate(()=>window.clearAllMedia());
    const retained=await page.evaluate(()=>window.eval('_audioMonitorSlots.size+_audioMonitorRoutes.size+_continuousScrubEngine.state.bytes'));
    if(retained!==0) throw Error('Retained listening state after clear');
    await page.close();
  }
} finally {await browser.close();}
const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(output,json);console.log(json);if(report.files.some(record=>!record.passed))process.exitCode=1;
