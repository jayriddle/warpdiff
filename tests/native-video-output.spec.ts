import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

for(const channels of [1,2]) {
  test('32 kHz '+channels+' channel video keeps native A/V output across scrub and playback',async({page},info)=>{
    const directory=info.outputPath('source');fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,'ordinary-aac.mp4');
    execFileSync('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2',
      '-f','lavfi','-i','sine=frequency=997:sample_rate=32000:duration=2','-c:v','libx264','-pix_fmt','yuv420p',
      '-c:a','aac','-ac',String(channels),file]);
    await page.addInitScript(()=>{
      localStorage.setItem('lastSeenVersion','999.0.0');localStorage.setItem('pref_audioVizVisible','true');
      // Fail visibly if ordinary video is ever attached to the independent
      // speaker clock, even on a machine with low output latency.
      const create=AudioContext.prototype.createMediaElementSource;
      (window as any).__mediaSourceAttempts=0;
      AudioContext.prototype.createMediaElementSource=function(...args){(window as any).__mediaSourceAttempts++;return create.apply(this,args);};
    });
    await page.goto('/');await page.locator('#multiFileInput').setInputFiles(file);
    await page.locator('#comparisonView.active').waitFor();
    await page.waitForFunction(()=>!!(window as any).__testAPI.nativeAudio.directLevel('editA'));
    const state=()=>page.evaluate(()=>({direct:(window as any).__testAPI.nativeAudio.directLevel('editA'),
      routes:(window as any).__testAPI.nativeAudio.routeCount,attempts:(window as any).__mediaSourceAttempts,
      muted:(document.querySelector('#layerEditA video') as HTMLVideoElement|null)?.muted}));
    expect(await state()).toMatchObject({routes:0,attempts:0,muted:false,direct:{target:1}});
    await page.locator('#playPauseBtn').click();
    await page.waitForFunction(()=>(document.querySelector('#layerEditA video') as HTMLVideoElement).currentTime>.1);
    await page.locator('#playPauseBtn').click();
    const bar=(await page.locator('#videoProgressContainer').boundingBox())!;
    await page.mouse.move(bar.x+bar.width*.3,bar.y+bar.height/2);await page.mouse.down();
    await page.mouse.move(bar.x+bar.width*.6,bar.y+bar.height/2);await page.mouse.up();
    await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).seeking);
    await page.locator('#playPauseBtn').click();
    await page.waitForFunction(()=>!(document.querySelector('#layerEditA video') as HTMLVideoElement).paused);
    expect(await state()).toMatchObject({routes:0,attempts:0,muted:false,direct:{target:1}});
    await page.keyboard.press('m');expect((await state()).direct!.volume).toBe(0);
    await page.keyboard.press('m');expect((await state()).direct!.volume).toBeGreaterThan(0);
    await page.evaluate(()=>(window as any).clearAllMedia());
    expect((await state()).direct).toBeNull();
  });
}
