'use strict';
(() => {
    const token=document.querySelector('meta[name="companion-token"]').content;
    const params=new URLSearchParams(location.hash.slice(1)),id=params.get('id'),origin=params.get('origin');
    history.replaceState(null,'',location.pathname);
    const status=document.getElementById('status'),allow=document.getElementById('allow');
    let port=null,connected=false,job=null,closed=false;
    const allowed=() => {
        try {const url=new URL(origin);return url.origin===origin && (origin==='https://jayriddle.github.io' ||
            ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && ['http:','https:'].includes(url.protocol));} catch (_) {return false;}
    };
    // Reject the launch before installing a listener that can accept a port.
    if(!window.opener||!allowed()||!/^[a-f0-9]{32}$/.test(id||'')) {
        status.textContent='Open this connection window from WarpDiff.';return;
    }
    const headers=jobId=>({Authorization:'Bearer '+token,'X-WarpDiff-Job':jobId});
    function post(value){try{port?.postMessage(value);}catch(_) {connected=false;}}
    function close() {
        closed=true;connected=false;allow.disabled=true;
        if(job){job.controller.abort();fetch('/api/cancel',{method:'POST',headers:headers(job.id),keepalive:true}).catch(()=>{});}
        post({type:'closed'});port?.close();port=null;status.textContent='Disconnected. You can close this window.';
    }
    async function prepare(data) {
        const file=data.file,kind=data.kind;
        if(!/^[a-f0-9]{32}$/.test(data.id)||!(file instanceof File)||!file.size||file.size>512*1024*1024||!['video','audio'].includes(kind)) {
            post({type:'failed',id:data.id,error:'Invalid preparation request'});return;
        }
        if(job){post({type:'failed',id:data.id,error:'The previous preparation is finishing'});return;}
        const current={id:data.id,controller:new AbortController()};job=current;let result,error;
        status.textContent='Preparing a review copy on this computer…';
        try {
            const response=await fetch('/api/prepare',{method:'POST',headers:{...headers(current.id),'X-WarpDiff-Kind':kind},body:file,signal:current.controller.signal});
            const metadata=await response.json();if(!response.ok)throw new Error(metadata.error||'Preparation failed');
            if(metadata.jobId!==current.id||!Number.isSafeInteger(metadata.output?.size)||metadata.output.size<1||metadata.output.size>1024*1024*1024||
                metadata.output.type!==(kind==='video'?'video/mp4':'audio/wav'))throw new Error('Unexpected preparation result');
            const download=await fetch('/api/result',{method:'POST',headers:headers(current.id),signal:current.controller.signal});
            if(!download.ok||Number(download.headers.get('content-length'))!==metadata.output.size)throw new Error('Incomplete preparation result');
            const blob=await download.blob();if(blob.size!==metadata.output.size)throw new Error('Incomplete preparation result');
            const base=file.name.replace(/\.[^.]*$/,'')||'media';
            result=new File([blob],base+'_review'+(kind==='video'?'.mp4':'.wav'),{type:metadata.output.type,lastModified:file.lastModified});
        } catch(e) {error=current.controller.signal.aborted?'Preparation cancelled':String(e.message||'Preparation failed').slice(0,500);}
        finally {
            // A result/cancel response acknowledges native retirement, not just
            // browser fetch cancellation. The server retains its reservation.
            await fetch('/api/release',{method:'POST',headers:headers(current.id),signal:AbortSignal.timeout(15000)}).catch(()=>{});
            if(job===current)job=null;
        }
        if(!connected)return;
        if(current.controller.signal.aborted)error='Preparation cancelled';
        status.textContent=error||'Connected. The review copy has returned to WarpDiff.';
        post(error?{type:'failed',id:current.id,error}:{type:'result',id:current.id,file:result});
    }
    window.addEventListener('message',event=>{
        if(closed||port||event.source!==window.opener||event.origin!==origin||event.data?.type!=='WARPDIFF_PREPARATION_CONNECT'||event.data.version!==1||event.data.id!==id||event.ports.length!==1)return;
        port=event.ports[0];port.start();allow.disabled=false;status.textContent='Choose Connect to allow this window.';
        port.onmessage=event=>{
            const data=event.data;if(!connected||!data||typeof data!=='object')return;
            if(data.type==='disconnect')close();
            else if(data.type==='cancel'&&job?.id===data.id)job.controller.abort();
            else if(data.type==='prepare')prepare(data);
        };
    });
    allow.addEventListener('click',()=>{if(closed||!port)return;connected=true;allow.disabled=true;status.textContent='Connected. Return to WarpDiff and choose Prepare and open when needed.';post({type:'ready'});});
    document.getElementById('disconnect').addEventListener('click',close);
    window.addEventListener('pagehide',close);
    document.getElementById('site').textContent='WarpDiff window: '+origin;
    window.opener.postMessage({type:'WARPDIFF_PREPARATION_HELLO',version:1,id},origin);
})();
