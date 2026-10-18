'use strict';
(() => {
    const token=document.querySelector('meta[name="companion-token"]').content;
    const ui=Object.fromEntries(['open','files','prepareAgain','comparison','cover','title','message','names','copyNote','prepare','anyway','cancel'].map(id=>[id,document.getElementById(id)]));
    let generation=0, files=[],needs=[],frame=null,directReady=false,pendingFrame=null,pendingHost=null,job=null,preparation=null,retiring=Promise.resolve();
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    function kind(file) {
        if(/^(image|video|audio)\//.test(file.type))return file.type.split('/')[0];
        return /\.(mp4|mov|m4v|mkv|webm|avi|mxf|mts|m2ts|ts)$/i.test(file.name)?'video':
            /\.(wav|flac|mp3|ogg|opus|aac|ac3|eac3|dts|mlp|m4a)$/i.test(file.name)?'audio':'';
    }
    function view(title,message,{prepare=false,anyway=false,cancel=false,copy=false,visible=true}={}) {
        ui.title.textContent=title;ui.message.textContent=message;ui.cover.hidden=!visible;
        if(frame)frame.inert=visible;
        ui.prepare.hidden=!prepare;ui.prepare.disabled=!!preparation;ui.anyway.hidden=!anyway||!directReady||!!preparation;ui.cancel.hidden=!cancel;ui.copyNote.hidden=!copy;
        ui.prepareAgain.hidden=!needs.length||!!preparation;ui.names.replaceChildren();
        for(const index of needs){const li=document.createElement('li');li.textContent=files[index]?.name||'';ui.names.append(li);}
    }
    function apiHeaders(id){return {'Authorization':'Bearer '+token,'X-WarpDiff-Job':id};}
    async function disposeJob() {
        const old=job;if(!old)return retiring;
        job=null;old.controller.abort();
        retiring=Promise.allSettled([retiring,fetch('/api/cancel',{method:'POST',headers:apiHeaders(old.id),signal:AbortSignal.timeout(15000)})]);
        await retiring;
    }
    function cancelHost() {
        if(pendingHost){pendingHost.reject(new DOMException('Superseded','AbortError'));pendingHost=null;}
    }
    function clearFrame(){directReady=false;if(pendingFrame){clearTimeout(pendingFrame.timer);pendingFrame.reject(new DOMException('Superseded','AbortError'));pendingFrame=null;}frame?.remove();frame=null;}
    async function newFrame(epoch) {
        clearFrame();const child=document.createElement('iframe');child.title='WarpDiff comparison';child.inert=!ui.cover.hidden;frame=child;
        await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{if(pendingFrame?.child===child)pendingFrame=null;reject(new Error('WarpDiff did not start'));},15000);
            pendingFrame={child,timer,reject};
            child.onload=()=>{
                clearTimeout(timer);if(pendingFrame?.child===child)pendingFrame=null;
                if(epoch!==generation){reject(new DOMException('Superseded','AbortError'));return;}
                // The wrapper owns explicit file drops; the comparison core owns
                // media readiness, playback and analysis through its existing API.
                for(const type of ['dragover','drop'])child.contentDocument.addEventListener(type,event=>{
                    if(!event.dataTransfer?.types.includes('Files'))return;
                    event.preventDefault();event.stopImmediatePropagation();
                    if(type==='drop')choose([...event.dataTransfer.files]);
                },true);
                resolve();
            };
            child.src='/app/';ui.comparison.append(child);
        });
    }
    window.addEventListener('message',event=>{
        const current=pendingHost;
        if(!current||event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.requestId!==current.id)return;
        if(event.data.type==='WARPDIFF_LOAD_READY'){pendingHost=null;current.resolve();}
        else if(event.data.type==='WARPDIFF_LOAD_FAILED'){pendingHost=null;current.reject(new Error('These files could not be opened directly'));}
    });
    async function openComparison(selected,epoch,prepared=false) {
        view('Opening your files','WarpDiff is checking picture and audio…',{cancel:true});
        try{await newFrame(epoch);}catch(error){if(epoch===generation)view('Could not start WarpDiff',error.message,{cancel:true});return;}
        if(epoch!==generation)return;
        const urls=selected.map(file=>URL.createObjectURL(file));
        const id=crypto.randomUUID();
        try {
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{if(pendingHost?.id===id)pendingHost=null;reject(new Error('Opening took too long'));},30000);
                pendingHost={id,resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}};
                const names=selected.map((file,index)=>file.name.trim().slice(0,180)||'Media '+(index+1));
                const labels=selected.length<=2?['',...names]:names;
                frame.contentWindow.postMessage({type:'WARPDIFF_LOAD',requestId:id,capabilities:{managedReview:true},slotLabels:labels,
                    signedItems:selected.map((file,i)=>({name:file.name,contentType:file.type||kind(file)+'/unknown',lastModified:file.lastModified,signedUrl:urls[i]}))},location.origin);
            });
            if(epoch!==generation)return;
            directReady=true;
            const end=performance.now()+30000;
            let reports=[];
            while(epoch===generation) {
                reports=Object.values(frame.contentWindow.WarpDiffHostAPI.readMediaInputReports());
                const done=reports.length===selected.length&&reports.every(report=>['available','unavailable','not-applicable'].includes(report.capabilities.decodedAnalysis.state));
                if(done||performance.now()>end)break;
                await sleep(75);
            }
            if(epoch!==generation)return;
            needs=reports.flatMap((report,index)=>kind(selected[index])!=='image'&&
                !['available','not-applicable'].includes(report.capabilities.decodedAnalysis.state)?[index]:[]);
            if(needs.length) {
                view(prepared?'The prepared copy could not be fully opened':'These files need a compatible copy',
                    prepared?'WarpDiff could not verify the prepared audio. The original files are unchanged.':
                    'Picture or audio tools are unavailable for the files below. Prepare a review copy here, then WarpDiff will open it automatically.',
                    {prepare:!prepared,anyway:true,cancel:true,copy:!prepared});
            } else view('Ready',prepared?'Opened the prepared review copy. Originals are unchanged.':'Opened your files.',{visible:false});
        } catch(error) {
            if(epoch!==generation)return;
            needs=selected.flatMap((file,index)=>['video','audio'].includes(kind(file))?[index]:[]);
            view('Could not open these files',prepared?'The prepared copy failed WarpDiff’s normal checks. Originals are unchanged.':
                'Try preparing a compatible review copy. Nothing will replace your originals.',{prepare:needs.length>0&&!prepared,cancel:true,copy:needs.length>0&&!prepared});
        } finally {urls.forEach(url=>URL.revokeObjectURL(url));}
    }
    async function choose(selected) {
        const epoch=++generation;cancelHost();clearFrame();files=[];needs=[];await disposeJob();
        if(epoch!==generation)return;
        if(selected.length<1||selected.length>4||selected.some(file=>!kind(file)||!file.size)||
           selected.some(file=>kind(file)==='audio')&&selected.some(file=>kind(file)!=='audio')) {
            needs=[];view('Choose 1–4 media files','Use images and videos together, or an audio-only comparison.');return;
        }
        files=[...selected];needs=[];await openComparison(files,epoch);
    }
    async function prepare() {
        if(preparation||!needs.length)return;
        const epoch=generation,owner={epoch},selected=[...files],indexes=[...needs];preparation=owner;clearFrame();
        view('Preparing your files','Creating compatible copies on this computer…',{cancel:true});
        try {
            await retiring;
            for(const index of indexes) {
                if(epoch!==generation)return;
                const source=selected[index],id=crypto.randomUUID().replaceAll('-',''),controller=new AbortController();job={id,controller};
                let metadata;
                try {
                    const response=await fetch('/api/prepare',{method:'POST',headers:{...apiHeaders(id),'X-WarpDiff-Kind':kind(source)},body:source,signal:controller.signal});
                    metadata=await response.json();if(!response.ok)throw new Error(metadata.error||'Preparation failed');
                    if(metadata.jobId!==id||!metadata.output||!Number.isSafeInteger(metadata.output.size)||metadata.output.size<1||metadata.output.size>1024*1024*1024||
                       metadata.output.type!==(kind(source)==='video'?'video/mp4':'audio/wav'))throw new Error('Unexpected preparation result');
                    const download=await fetch('/api/result',{method:'POST',headers:apiHeaders(id),signal:controller.signal});
                    if(!download.ok||Number(download.headers.get('content-length'))!==metadata.output.size)throw new Error('Incomplete preparation result');
                    const blob=await download.blob();if(blob.size!==metadata.output.size)throw new Error('Incomplete preparation result');
                    if(epoch!==generation||controller.signal.aborted)return;
                    const base=source.name.replace(/\.[^.]*$/,'')||'media',suffix=kind(source)==='video'?'.mp4':'.wav';
                    selected[index]=new File([blob],base+'_review'+suffix,{type:metadata.output.type,lastModified:source.lastModified});
                } finally {
                    await fetch('/api/release',{method:'POST',headers:apiHeaders(id),signal:AbortSignal.timeout(15000)}).catch(()=>{});
                    if(job?.id===id)job=null;
                }
            }
            if(epoch!==generation)return;
            files=selected;needs=[];await openComparison(files,epoch,true);
        } catch(error) {
            if(epoch!==generation)return;
            view('Preparation did not finish',error.message+' Your originals are unchanged.',{prepare:true,cancel:true,copy:true});
        } finally {if(preparation===owner){preparation=null;ui.prepare.disabled=false;ui.prepareAgain.hidden=!needs.length;}}
    }
    ui.open.addEventListener('click',()=>ui.files.click());
    ui.files.addEventListener('change',()=>{const selected=[...ui.files.files];ui.files.value='';choose(selected);});
    ui.prepare.addEventListener('click',prepare);
    ui.prepareAgain.addEventListener('click',()=>view('Prepare compatible review copies','The selected files will be prepared locally.',{prepare:true,anyway:true,cancel:true,copy:true}));
    ui.anyway.addEventListener('click',()=>{if(directReady&&!preparation)view('Opened with limited tools','Some audio tools may be unavailable.',{visible:false});});
    ui.cancel.addEventListener('click',async()=>{++generation;cancelHost();files=[];needs=[];clearFrame();view('Open your files','Preparation cancelled. Your originals are unchanged.');await disposeJob();});
    for(const type of ['dragover','drop'])document.addEventListener(type,event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();if(type==='drop')choose([...event.dataTransfer.files]);});
    window.addEventListener('pagehide',()=>{
        if(job){job.controller.abort();fetch('/api/cancel',{method:'POST',headers:apiHeaders(job.id),keepalive:true}).catch(()=>{});}
    });
})();
