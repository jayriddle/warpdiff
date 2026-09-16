import {test, expect} from '@playwright/test';
import path from 'node:path';

test.use({serviceWorkers:'block'});

for(const suspended of [false,true]) {
  test(`clearing media releases real audio/video objects with a ${suspended?'suspended':'running'} audio context`,async({page,context})=>{
    await page.goto('/');
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/landscape_a.mp4'));
    await page.waitForFunction(()=>(window as any).eval('!!_videoAudioBuffers.editA && !!_continuousScrubEngine.state.node'));
    const prepared=await page.evaluate(async suspended=>{
      const w=window as any;
      return w.eval(`(async()=>{
        const video=document.querySelector('.asset-layer video'),ctx=audioContext;
        await ctx.resume();
        if(${suspended})await ctx.suspend();
        window.memoryRefs={video:new WeakRef(video),context:new WeakRef(ctx),
          buffer:new WeakRef(_videoAudioBuffers.editA),node:new WeakRef(_continuousScrubEngine.state.node)};
        const prepared={ready:video.readyState,bytes:_continuousScrubEngine.state.bytes,context:ctx.state};
        clearAllMedia();
        // An old asynchronous close must never close a replacement context.
        window.memoryNewContext=getAudioContext();await window.memoryNewContext.resume();
        return prepared;
      })()`);
    },suspended);
    expect(prepared.ready).toBeGreaterThanOrEqual(2);
    expect(prepared.bytes).toBeGreaterThan(0);
    expect(prepared.context).toBe(suspended?'suspended':'running');
    const cdp=await context.newCDPSession(page);
    let remaining:any;
    for(let attempt=0;attempt<12;attempt++) {
      await page.waitForTimeout(150);
      await cdp.send('HeapProfiler.collectGarbage');
      remaining=await page.evaluate(()=>Object.fromEntries(Object.entries((window as any).memoryRefs).map(([name,weak]:[string,any])=>[name,!!weak.deref()])));
      if(!remaining.video&&!remaining.node&&!remaining.buffer)break;
    }
    expect(remaining).toMatchObject({video:false,buffer:false,node:false});
    expect(await page.evaluate(()=>(window as any).memoryRefs.context.deref()?.state||'closed')).toBe('closed');
    expect(await page.evaluate(()=>(window as any).memoryNewContext.state)).toBe('running');
    await page.evaluate(()=>{const w=window as any;w.clearAllMedia();w.memoryNewContext=null;});
    // Test app-owned teardown here: PCM and nodes collect, the old context is
    // closed, and its late close does not affect the replacement. Current
    // Chrome's end-to-end probe also checks collection of the context itself;
    // bundled Chromium can retain its native worklet proxy after close.
  });
}
