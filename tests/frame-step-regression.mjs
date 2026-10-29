import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export function runFrameStepChecks(check) {
  const frames = new Map(), timers = new Map(); let next = 0; const videos = [];
  const realm = {
    document:{hidden:false}, videoFrameRates:{'numbered.mp4':24},
    setTimeout:callback=>{timers.set(++next,callback);return next;},
    clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:callback=>{frames.set(++next,callback);return next;},
    cancelAnimationFrame:id=>frames.delete(id),
  };
  const source=readFileSync(new URL('../js/transport.js',import.meta.url),'utf8');
  // Keep the same realm object so exported declarations remain accessible.
  const context={...realm,testVideos:videos};
  runInNewContext(source+'\ngetTransportVideos = () => testVideos;',context);
  function video() {
    const listeners=new Set(), requests=[];
    const v={isConnected:true,paused:true,seeking:false,src:'numbered.mp4',currentSrc:'numbered.mp4',time:0,pending:0,
      addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn),
      get currentTime(){return this.time;},set currentTime(time){this.pending=time;this.seeking=true;requests.push(time);},
      finish(time=this.pending){this.time=time;this.seeking=false;[...listeners].forEach(fn=>fn());},
      listeners,requests};
    videos.push(v); return v;
  }
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
  const a=video(),b=video();
  context._queueFrameStepSeek(a,1);context._queueFrameStepSeek(a,2);context._queueFrameStepSeek(a,3);
  check('frame-step-queue: pending native seek retains only the latest target',a.requests.join(',')==='1');
  const cursor={ref:a,src:a.src,fps:24,total:96,frame:72,targetTime:3,updatedAt:0};
  check('frame-step-queue: pending work cannot expire while decoder still reports old time',context._frameStepCursorFrame(cursor,a,0,24,96,2000)===72);
  a.finish();
  check('frame-step-queue: seeked allows a paint opportunity before the next target',a.requests.join(',')==='1'&&frames.size===1);
  check('frame-step-queue: logical cursor survives the seeked-to-rAF gap',context._frameStepCursorFrame(cursor,a,24,24,96,2000)===72);
  context._queueFrameStepSeek(a,4);flush();
  check('frame-step-queue: a key in that gap replaces only the queued target',a.requests.join(',')==='1,4');
  a.finish();flush();
  check('frame-step-queue: settlement removes listener and pending ownership',a.listeners.size===0&&!context._frameStepSeekIsPending(a));
  context._queueFrameStepSeek(a,4);
  check('frame-step-queue: same-time target does not wait for a nonexistent event',!context._frameStepSeekIsPending(a)&&a.requests.length===2);
  context._queueFrameStepSeek(a,1);context._queueFrameStepSeek(a,2);context._queueFrameStepSeek(b,1);
  a.finish(3);
  check('frame-step-queue: an unrelated completed seek retires all queued writes',!context._frameStepSeekIsPending(a)&&!context._frameStepSeekIsPending(b)&&a.listeners.size===0&&b.listeners.size===0);
  context._queueFrameStepSeek(a,1);context._queueFrameStepSeek(a,2);a.finish();
  const late=[...frames.values()][0];context._resetFrameStepCursor();context._queueFrameStepSeek(a,3);late();
  check('frame-step-queue: a late retired frame cannot flush or retire a newer queue',a.requests.at(-1)===3&&context._frameStepSeekIsPending(a));
  context._resetFrameStepCursor();
  check('frame-step-queue: cancellation removes callbacks and media references',frames.size===0&&a.listeners.size===0&&b.listeners.size===0);
  a.finish(); // Cancellation retires ownership; an already issued native seek may still settle.
  context._queueFrameStepSeek(a,2);context._queueFrameStepSeek(a,4);a.finish();a.isConnected=false;flush();
  check('frame-step-queue: a removed element cannot receive its queued target',a.requests.at(-1)===2&&!context._frameStepSeekIsPending(a));a.isConnected=true;
  context._queueFrameStepSeek(a,1);context._queueFrameStepSeek(a,4);a.finish();context.document.hidden=true;flush();
  check('frame-step-queue: hidden pages retire work instead of seeking after suspension',a.requests.at(-1)===1&&!context._frameStepSeekIsPending(a));context.document.hidden=false;
  const p=video(), presented=new Map();
  p.requestVideoFrameCallback=fn=>{presented.set(++next,fn);return next;};
  p.cancelVideoFrameCallback=id=>presented.delete(id);
  const present=time=>{const callbacks=[...presented.values()];presented.clear();callbacks.forEach(fn=>fn(0,{mediaTime:time}));};
  context._queueFrameStepSeek(p,1);context._queueFrameStepSeek(p,2);
  check('frame-step-queue: slow decode cannot consume the presentation timeout',timers.size===0);
  p.finish();flush();
  check('frame-step-queue: decoded native time cannot release a not-yet-presented picture',p.requests.join(',')==='1'&&presented.size===1&&timers.size===1);
  present(0);
  check('frame-step-queue: an earlier presentation does not release the target',frames.size===0&&presented.size===1);
  present(1+0.5/24);
  check('frame-step-queue: the following frame cannot confirm the intended picture',frames.size===0&&presented.size===1);
  present(1);flush();
  check('frame-step-queue: confirmed presentation advances to the latest queued frame',p.requests.join(',')==='1,2');
  p.finish();const fallback=[...timers.values()][0];fallback();flush();
  check('frame-step-queue: absent hidden-layer callbacks have a bounded fallback',!context._frameStepSeekIsPending(p)&&presented.size===0&&timers.size===0);
  context._queueFrameStepSeek(p,3);p.finish();const oldPresent=[...presented.values()][0],oldTimer=[...timers.values()][0];
  context._resetFrameStepCursor();oldPresent(0,{mediaTime:3});oldTimer();flush();
  check('frame-step-queue: cancelled presentation callbacks and timers cannot restart work',p.requests.join(',')==='1,2,3'&&frames.size===0&&presented.size===0&&timers.size===0);
  p.finish();context._queueFrameStepSeek(p,1);context._queueFrameStepSeek(p,2);context._resetFrameStepCursor(true);
  check('frame-step-queue: Play commits the last requested target before retiring callbacks',p.requests.at(-1)===2&&!context._frameStepSeekIsPending(p)&&presented.size===0&&timers.size===0);
  const q=video(),callbacks=new Map();
  q.requestVideoFrameCallback=fn=>{callbacks.set(++next,fn);return next;};
  q.cancelVideoFrameCallback=id=>callbacks.delete(id);
  const show=time=>{const list=[...callbacks.values()];callbacks.clear();list.forEach(fn=>fn(0,{mediaTime:time}));};
  context._queueFrameStepSeek(q,1);const first=[...callbacks.values()][0];context._queueFrameStepSeek(q,2);q.finish();show(1);flush();
  context._queueFrameStepSeek(q,1);q.finish();show(2);flush();q.finish();
  const latestTimer=[...timers.values()][0];first(0,{mediaTime:1});
  check('frame-step-queue: revisiting a target cannot authorize a retired presentation callback',frames.size===0&&callbacks.size===1&&timers.size===1);
  latestTimer();flush();
  context._queueFrameStepSeek(q,2);context._queueFrameStepSeek(q,3);q.finish();show(2);q.time=3.5;flush();
  check('frame-step-queue: an external position change in the paint gap owns the timeline',q.requests.at(-1)===2&&!context._frameStepSeekIsPending(q));
  const expired={...cursor,targetTime:a.currentTime,updatedAt:0};
  check('frame-step-queue: settled stale cursor returns authority to observed time',context._frameStepCursorFrame(expired,a,24,24,96,2000)===24);
}
