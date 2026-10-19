import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export async function runScrubInputChecks(check) {
  const source=readFileSync(new URL('../js/scrub-video.js',import.meta.url),'utf8');
  const realm={AbortController};runInNewContext(source,realm);
  const budget=realm._createScrubVideoInputBudget(4,8);
  for(const size of [undefined,0,-1,NaN,Infinity,1.5,5,2**32]) check('scrub-input: refuses invalid/oversized size '+size,budget.reserve(size)===null);
  const a=budget.reserve(4), b=budget.reserve(4);
  check('scrub-input: pending reservations fill the shared budget exactly',budget.state.bytes===8 && budget.reserve(1)===null);
  budget.settle(a);budget.release(a);budget.release(a);
  check('scrub-input: retained close releases exactly once',budget.state.bytes===4 && budget.state.inputs===1);
  budget.release(b);
  check('scrub-input: cancelled pending reservation remains accounted',b.controller.signal.aborted && budget.state.bytes===4);
  const c=budget.reserve(4);budget.settle(b);budget.settle(b);budget.release(b);
  check('scrub-input: old completion cannot release a newer reservation',budget.state.bytes===4 && budget.state.inputs===1);
  budget.settle(c);budget.release(c);
  check('scrub-input: final close returns to zero',budget.state.bytes===0 && budget.state.inputs===0);

  const read=realm._readScrubVideoInput;
  function response(chunks, headers={}) {
    let cancelled=false;
    const body=new ReadableStream({start(controller){chunks.forEach(chunk=>controller.enqueue(new Uint8Array(chunk)));controller.close();},cancel(){cancelled=true;}});
    return {response:new Response(body,{headers}),cancelled:()=>cancelled};
  }
  const good=response([[1,2],[3,4]]);
  check('scrub-input: bounded reader preserves chunk bytes',Array.from(await read(good.response,4,new AbortController().signal)).join(',')==='1,2,3,4');
  for(const [name,r,size,abort]of [
    ['oversized body',response([[1,2,3],[4,5]]),4,false],
    ['truncated body',response([[1,2,3]]),4,false],
    ['mismatched declared size',response([[1,2,3,4]],{'Content-Length':'8'}),4,false],
    ['already cancelled',response([[1,2,3,4]]),4,true],
  ]) {
    const controller=new AbortController();if(abort)controller.abort();let failed=false;
    try{await read(r.response,size,controller.signal);}catch{failed=true;}
    check('scrub-input: rejects '+name,failed);
  }
  let cancelCount=0;
  const overflowing=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(5));},cancel(){cancelCount++;}}));
  try{await read(overflowing,4,new AbortController().signal);}catch{}
  check('scrub-input: overrun cancels the unread stream and releases its reader',cancelCount===1 && !overflowing.body.locked);
  const broken=new Response(new ReadableStream({start(controller){controller.error(new Error('read failed'));}}));
  let readFailed=false;try{await read(broken,4,new AbortController().signal);}catch{readFailed=true;}
  check('scrub-input: failed streams reject and release their reader',readFailed && !broken.body.locked);
  let waitingController,abortedRead=false;
  const waiting=new Response(new ReadableStream({start(controller){waitingController=controller;}}));
  const abort=new AbortController();
  const waitingRead=read(waiting,4,abort.signal).catch(()=>{abortedRead=true;});
  abort.abort();for(let i=0;i<12;i++)await Promise.resolve();
  check('scrub-input: abort cancels a reader waiting for its next chunk',abortedRead && !waiting.body.locked);
  // Also let a reverted implementation finish, so a regression reports failure
  // rather than leaving a dangling read in the test harness.
  try{waitingController.close();}catch{}await waitingRead;

  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const controllerSource=html.slice(html.indexOf('let _scrubVideoSessions ='),html.indexOf('        // The video slots the overlay should engage'));
  function controllerHarness(delayedReady=false) {
    const pending=[],sessions=[],notices=[];
    const context={AbortController,mediaData:{a:{type:'video',src:'a',size:4},b:{type:'video',src:'b',size:4},c:{type:'video',src:'c',size:4}},
      isDragging:false,showLoadToast:message=>notices.push(message),getLayer:()=>({querySelector:()=>({})}),
      fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve})),
    };
    runInNewContext(source,context);
    const factory=context._createScrubVideoInputBudget;
    context._createScrubVideoInputBudget=()=>factory(4,8);
    context._createScrubVideoSession=(_bytes,_color,onColorRejected)=>{
      let readyResolve;
      const session={closed:0,suspended:0,rejectColor:onColorRejected,close(){this.closed++;},suspend(){this.suspended++;},
        ready:delayedReady?new Promise(resolve=>{readyResolve=resolve;}):Promise.resolve(true),resolve:()=>readyResolve(true)};
      sessions.push(session);return session;
    };
    runInNewContext(controllerSource,context);
    return {context,pending,sessions,notices,state:()=>runInNewContext('_scrubVideoInputBudget.state',context),
      map:()=>runInNewContext('_scrubVideoSessions',context),settle:async()=>{for(let i=0;i<12;i++)await Promise.resolve();}};
  }
  {
    const h=controllerHarness(),p=h.context._scrubOverlayGetSession('a');await h.settle();
    h.pending[0].resolve(new Response(new Uint8Array(4)));await p;
    h.sessions[0].rejectColor();
    check('scrub-input: color rejection closes the retained session and releases its reservation immediately',
      h.sessions[0].closed===1 && h.state().bytes===0 && h.map().a==='failed');
    h.context._releaseScrubSessions();
    const next=h.context._scrubOverlayGetSession('a');await h.settle();
    h.sessions[0].rejectColor();
    check('scrub-input: late color rejection cannot replace a newer pending owner or release its bytes',h.map().a===next && h.state().bytes===4);
    h.pending[1].resolve(new Response(new Uint8Array(4)));await next;h.context._releaseScrubSessions();
  }
  {
    const h=controllerHarness(),{context}=h;
    const a=context._scrubOverlayGetSession('a'), again=context._scrubOverlayGetSession('a'), b=context._scrubOverlayGetSession('b');
    check('scrub-input: cached pending session is shared',a===again);
    const c=await context._scrubOverlayGetSession('c');await h.settle();
    check('scrub-input: concurrent third input falls back before fetching',c===null && h.pending.length===2 && h.state().bytes===8 && h.notices.length===1);
    h.pending.forEach(p=>p.resolve(new Response(new Uint8Array(4))));await Promise.all([a,b]);
    check('scrub-input: retained sessions and suspension keep their reservations',h.sessions.length===2 && h.state().bytes===8 && h.sessions.every(s=>s.suspended===1));
    context._suspendScrubSessions();check('scrub-input: playback suspension does not release encoded bytes',h.state().bytes===8);
    context._invalidateScrubSession('a');
    check('scrub-input: per-slot invalidation closes and releases only that retained input',h.state().bytes===4 && h.sessions[0].closed===1 && h.sessions[1].closed===0);
    context.mediaData.d={type:'video',src:'d',size:4};const d=context._scrubOverlayGetSession('d');await h.settle();
    context._releaseScrubSessions();
    check('scrub-input: clear aborts pending fetch and keeps it charged until settlement',h.pending[2].options.signal.aborted && h.state().bytes===4);
    h.pending[2].resolve(new Response(new Uint8Array(4)));await d;
    check('scrub-input: stale fetch cannot create a decoder or refill the cleared map',h.sessions.length===2 && h.state().bytes===0 && Object.keys(h.map()).length===0);
  }
  {
    const h=controllerHarness(true),p=h.context._scrubOverlayGetSession('a');await h.settle();
    h.pending[0].resolve(new Response(new Uint8Array(4)));await h.settle();
    check('scrub-input: decoder configuration is included in pending budget',h.sessions.length===1 && h.state().bytes===4);
    h.context._releaseScrubSessions();
    check('scrub-input: clear closes a session still awaiting decoder configuration',h.sessions[0].closed===1 && h.state().bytes===4);
    h.sessions[0].resolve();await p;
    check('scrub-input: late configuration cannot publish or retain bytes after clear',h.state().bytes===0 && Object.keys(h.map()).length===0);
  }
  {
    const h=controllerHarness();h.context.mediaData.a.size=5;
    check('scrub-input: single-file cap rejects before fetch',await h.context._scrubOverlayGetSession('a')===null && h.pending.length===0 && h.state().bytes===0);
    h.context._releaseScrubSessions();h.context.mediaData.a.size=undefined;
    check('scrub-input: unknown size rejects before fetch',await h.context._scrubOverlayGetSession('a')===null && h.pending.length===0 && h.state().bytes===0);
  }
}
