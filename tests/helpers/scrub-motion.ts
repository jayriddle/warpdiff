import type {Page} from '@playwright/test';

// The trusted down/up remain Playwright gestures. Drive the held movement and
// sample PCM in the page's clock so protocol latency cannot turn continuous
// motion into >130 ms idle holds or sample after a 90 ms grain has ended.
// Events still pass through the actual document mousemove handler and decoder.
export async function moveHeldPointer(page:Page, points:{x:number,y:number}[], interval:number, samplePCM=false, sampleState=false) {
  return page.evaluate(async ({points,interval,samplePCM,sampleState})=>{
    const app=window as any, trace:any[]=[];
    if(sampleState&&typeof app.scrubMotionState!=='function')throw new Error('Expected a test state sampler');
    for(const point of points) {
      if(!app.__testAPI.isDragging)throw new Error('Expected a live trusted scrub gesture');
      const at=performance.now();
      document.dispatchEvent(new MouseEvent('mousemove',{clientX:point.x,clientY:point.y,buttons:1,bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,interval));
      const output=app.__testAPI.scrubPreviewOutput;
      trace.push({at,readAt:performance.now(),rms:samplePCM?app.previewRms():null,
        state:sampleState?app.scrubMotionState():null,
        contextTime:output?.context.currentTime,contextState:output?.context.state,
        nativePaused:output?.audio.paused,nativeReadyState:output?.audio.readyState,
        requested:output?.requested});
    }
    return {trace,peak:Math.max(0,...trace.map(sample=>sample.rms||0)),
      maximumInputGap:Math.max(0,...trace.slice(1).map((sample,index)=>sample.at-trace[index].at))};
  },{points,interval,samplePCM,sampleState});
}
