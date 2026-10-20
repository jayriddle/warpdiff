import {test,expect} from '@playwright/test';
import path from 'node:path';
import {makeMotionFixture} from '../tools/investigations/sdr-color/fixtures.mjs';

// This is a macOS Chrome compositor/output transition. The WebKit profile
// deliberately does not select it; native seeking has no WebCodecs handoff.
if(process.platform==='darwin') {
  let file:string;
  test.use({browserName:'chromium',channel:'chrome',viewport:{width:1280,height:850},serviceWorkers:'block'});
  test.beforeAll(async({},info)=>{file=makeMotionFixture(path.join(info.project.outputDir,'moving-fixture-'+info.workerIndex));});
  test('rejected scrub output seeks the held target without another pointer event',async({page},info)=>{
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('/');
    await page.evaluate(()=>{
      const Original=VideoDecoder;(window as any).__software=false;(window as any).__outputs=[];
      (window as any).VideoDecoder=class extends Original {
        constructor(options:VideoDecoderInit){super({...options,output(frame){
          (window as any).__outputs.push({format:frame.format,timestamp:frame.timestamp,color:frame.colorSpace.toJSON()});
          options.output(frame);
        }});}
        configure(config:VideoDecoderConfig){super.configure((window as any).__software?{...config,hardwareAcceleration:'prefer-software'}:config);}
      };
    });
    await page.locator('#multiFileInput').setInputFiles(file);
    await page.locator('#comparisonView.active').waitFor();
    await page.locator('#stackIconBtn').click();
    await page.waitForFunction(()=>!window.eval('isGridMode') && (document.querySelector('#layerEditA video') as HTMLVideoElement)?.readyState>=2 && getComputedStyle(document.querySelector('.asset-layer.active')!).opacity==='1');
    expect(await page.evaluate(()=>matchMedia('(color-gamut: p3)').matches),'sRGB control must exercise the verified overlay').toBe(false);
    const bar=(await page.locator('#videoProgressContainer').boundingBox())!,y=bar.y+bar.height/2;
    await page.mouse.move(bar.x+bar.width*.06,y);await page.mouse.down();
    try {
      await page.waitForFunction(()=>window.eval('_scrubOverlayLive.editA?.framesPainted > 0'));
      await page.mouse.move(bar.x+bar.width*.85,y);
      await page.waitForFunction(()=>window.eval('_scrubOverlayLive.editA?.lastPaintedPts > 6'));
      expect(await page.evaluate(()=>(window as any).__outputs[0].format)).toBe('NV12');
      expect(await page.locator('#layerEditA video').evaluate(v=>v.currentTime),'native video was held behind the effective overlay').toBeLessThan(1);
      await page.evaluate(()=>{
        (window as any).__software=true;(window as any).__nativePresented=[];
        const v=document.querySelector('#layerEditA video') as HTMLVideoElement;
        const record=(_now:number,meta:VideoFrameCallbackMetadata)=>{
          (window as any).__nativePresented.push(meta.mediaTime);
          v.requestVideoFrameCallback(record);
        };
        v.requestVideoFrameCallback(record);
      });
      await page.mouse.move(bar.x+bar.width*.5,y);
      await page.waitForFunction(()=>window.eval('_scrubVideoSessions.editA === "failed"'));
      expect(await page.evaluate(()=>(window as any).__outputs.at(-1).format),'real software output triggered rejection').toBe('I420');
      const target=await page.evaluate(()=>window.eval('_scrubOverlayLastT'));
      const video=page.locator('#layerEditA video');
      // No pointer move or release until native decoding AND presentation catch up.
      await expect.poll(()=>video.evaluate((v,t)=>Math.abs(v.currentTime-t),target),{message:'native fallback reaches held target without another pointer event'}).toBeLessThan(.1);
      await expect.poll(()=>page.evaluate(t=>(window as any).__nativePresented.some(p=>Math.abs(p-t)<1/24+.005),target),{message:'native picture presents the held target'}).toBe(true);
      await page.waitForTimeout(1000); // Observe a stationary held gesture; no old queued seek may roll back.
      expect(await video.evaluate((v,t)=>Math.abs(v.currentTime-t),target),'held native target remains stable').toBeLessThan(.1);
      expect(await page.evaluate(()=>window.eval('isDragging'))).toBe(true);
      expect(await page.evaluate(()=>window.eval('_scrubVideoInputBudget.state.bytes'))).toBe(0);
      await info.attach('handoff-state',{body:Buffer.from(JSON.stringify(await page.evaluate(()=>({target:window.eval('_scrubOverlayLastT'),native:(document.querySelector('#layerEditA video') as HTMLVideoElement).currentTime,presented:(window as any).__nativePresented,outputs:(window as any).__outputs})),null,2)),contentType:'application/json'});
      await page.screenshot({path:info.outputPath('held-native-picture.png')});
    } finally {await page.mouse.up();}
  });
}
