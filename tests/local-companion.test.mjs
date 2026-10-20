import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createCompanion} from '../tools/media-prepare/companion/server.mjs';
import {execute,prepareCompatible,INPUT_LIMIT} from '../tools/media-prepare/companion/processor.mjs';

const sample=await fs.readFile(new URL('./fixtures/ac3_video.mp4',import.meta.url));
const id=()=>randomBytes(16).toString('hex');
async function instance(options={}) {
    const app=await createCompanion(options);
    const html=await(await fetch(app.origin)).text();
    const token=html.match(/name="companion-token" content="([a-f0-9]{64})"/)[1];
    return {...app,headers(job){return {Origin:app.origin,Authorization:'Bearer '+token,'X-WarpDiff-Job':job};}};
}
async function waitFor(fn) {const until=Date.now()+5000;while(!fn()){if(Date.now()>until)throw Error('Timed out');await new Promise(r=>setTimeout(r,10));}}
function rawRequest(origin,headers) {
    return new Promise((resolve,reject)=>{
        const request=http.request(origin+'/api/prepare',{method:'POST',headers},response=>{
            response.resume();response.on('end',()=>resolve(response.statusCode));
        });request.on('error',reject);request.end();
    });
}

test('loopback native execution requires exact Host, Origin and per-launch authorization',async()=>{
    let calls=0;const app=await instance({checkTools:false,processor:async()=>{calls++;throw Error('must not run');}});
    try {
        for(const headers of [{},{Origin:'https://unrelated.invalid'}, {...app.headers(id()),Origin:'null'},
            {...app.headers(id()),Authorization:'Bearer wrong'}]) {
            const response=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...headers,'X-WarpDiff-Kind':'video'},body:sample});
            assert.equal(response.status,403);
        }
        // Browser fetch cannot forge Host. Exercise the DNS-rebinding boundary
        // with an actual raw Host header, rather than an ignored Fetch option.
        assert.equal(await rawRequest(app.origin,{...app.headers(id()),Host:'unrelated.invalid'}),403);
        const preflight=await fetch(app.origin+'/api/prepare',{method:'OPTIONS',headers:{Origin:'https://unrelated.invalid'}});
        assert.equal(preflight.status,405);assert.equal(preflight.headers.get('access-control-allow-origin'),null);
        assert.equal(calls,0);
        for(const file of ['/app/README.md','/app/package.json','/app/tools/media-prepare/prepare.mjs','/app/.git/config','/client.js/../../AGENTS.md']) {
            assert.equal((await fetch(app.origin+file)).status,404,file);
        }
        assert.equal(await rawRequest(app.origin,{...app.headers(id()),'X-WarpDiff-Kind':'video','Content-Length':INPUT_LIMIT+1}),413);
        const parent=await fetch(app.origin);assert.equal(parent.headers.get('cache-control'),'no-store');assert.equal(parent.headers.get('x-frame-options'),'DENY');
        const core=await fetch(app.origin+'/app/index.html');assert.equal(core.status,200);assert.equal(core.headers.get('x-frame-options'),'SAMEORIGIN');
    } finally {await app.close();}
});

test('oversized, empty and invalid job declarations reject before processing',async()=>{
    let calls=0;const app=await instance({checkTools:false,processor:async()=>{calls++;throw Error('must not run');}});
    try {
        for(const body of [Buffer.alloc(0),sample]) {
            const headers=app.headers(body.length?id():'invalid');headers['X-WarpDiff-Kind']=body.length?'image':'video';
            assert([400,413].includes((await fetch(app.origin+'/api/prepare',{method:'POST',headers,body})).status));
        }
        assert.equal(INPUT_LIMIT,512*1024*1024);assert.equal(calls,0);assert.equal(app.state().active,false);
    } finally {await app.close();}
});

test('one reservation spans upload, processing and result ownership; stale cancellation cannot abort it',async()=>{
    let started=false,retired=false,release;
    const gate=new Promise(r=>{release=r;});
    const app=await instance({checkTools:false,processor:async({signal})=>{
        started=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
        await gate;retired=true;throw Object.assign(Error('cancelled'),{name:'AbortError'});
    }});
    const first=id();
    try {
        const initial=fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(first),'X-WarpDiff-Kind':'video'},body:sample});
        await waitFor(()=>started);
        const next=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(id()),'X-WarpDiff-Kind':'video'},body:sample});
        assert.equal(next.status,409);
        assert.equal((await fetch(app.origin+'/api/cancel',{method:'POST',headers:app.headers(id())})).status,204);
        assert.equal(retired,false);assert.equal(app.state().active,true);
        let acknowledged=false;
        const cancel=fetch(app.origin+'/api/cancel',{method:'POST',headers:app.headers(first)}).then(response=>{acknowledged=true;return response;});
        await new Promise(r=>setTimeout(r,40));assert.equal(acknowledged,false);
        release();assert.equal((await cancel).status,204);await initial;
        assert.equal(retired,true);assert.equal(app.state().active,false);
    } finally {release();await app.close();}
});

test('real AC-3 preparation returns a verified review file and retires private files on release',async()=>{
    const app=await instance();const job=id();
    try {
        const before=await fs.readdir(os.tmpdir());
        const response=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(job),'X-WarpDiff-Kind':'video'},body:sample});
        assert.equal(response.status,200,await response.clone().text());const meta=await response.json();
        assert.equal(meta.jobId,job);assert.equal(meta.output.type,'video/mp4');assert.equal(meta.output.preparation.picture,'copied');
        assert.equal(meta.output.preparation.audio,'stereo-aac');assert.equal(meta.output.preparation.analysisBasis,'prepared-copy');
        assert(!JSON.stringify(meta).includes(os.tmpdir()));assert.equal(app.state().active,true);
        const result=await fetch(app.origin+'/api/result',{method:'POST',headers:app.headers(job)});assert.equal(result.status,200);
        const bytes=Buffer.from(await result.arrayBuffer());assert.equal(bytes.length,meta.output.size);
        const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.output.sha256);
        const dirs=(await fs.readdir(os.tmpdir())).filter(f=>f.startsWith('warpdiff-companion-')&&!before.includes(f));assert.equal(dirs.length,1);
        const packetInventory=async file=>JSON.parse((await execute('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-of','json',file])).stdout)
            .packets.map(p=>({pts:p.pts,dts:p.dts,duration:p.duration,data:p.data_hash}));
        assert.deepEqual(await packetInventory(path.join(os.tmpdir(),dirs[0],'review.mp4')),
            await packetInventory(new URL('./fixtures/ac3_video.mp4',import.meta.url).pathname),'copied picture packets and timestamps');
        assert.equal((await fetch(app.origin+'/api/release',{method:'POST',headers:app.headers(job)})).status,204);
        assert.equal(app.state().active,false);for(const name of dirs)await assert.rejects(fs.stat(path.join(os.tmpdir(),name)));
        assert.equal((await fetch(app.origin+'/api/result',{method:'POST',headers:app.headers(job)})).status,404);
    } finally {await app.close();}
});

test('abandoned uploads retire their reservation before accepting another input',async()=>{
    let calls=0;const app=await instance({checkTools:false,processor:async()=>{calls++;throw Error('Not used');}});
    const request=http.request(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(id()),'X-WarpDiff-Kind':'video','Content-Length':sample.length}});
    request.on('error',()=>{});
    try {
        request.write(sample.subarray(0,Math.floor(sample.length/2)));await waitFor(()=>app.state().active);
        request.destroy();await waitFor(()=>!app.state().active);assert.equal(calls,0);
    } finally {request.destroy();await app.close();}
});

test('invalid media and tool failures expose no private paths, leave no reservation and permit retry',async()=>{
    const app=await instance();
    try {
        const bad=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(id()),'X-WarpDiff-Kind':'video'},body:Buffer.from('not a media file')});
        assert.equal(bad.status,422);const message=await bad.text();assert(!message.includes(os.tmpdir()));assert(!message.includes('input.media'));
        assert.equal(app.state().active,false);
        const good=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(id()),'X-WarpDiff-Kind':'video'},body:sample});
        assert.equal(good.status,200);assert.equal(app.state().active,true);
    } finally {await app.close();}
});

test('playlist input cannot make the native tools request a network URL',async()=>{
    let requests=0;const remote=http.createServer((req,res)=>{requests++;res.end(sample);});
    await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
    const app=await instance();
    try {
        const body=Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:'+remote.address().port+'/media.ts\n#EXT-X-ENDLIST\n');
        const response=await fetch(app.origin+'/api/prepare',{method:'POST',headers:{...app.headers(id()),'X-WarpDiff-Kind':'video'},body});
        assert.equal(response.status,422);assert.equal(requests,0);assert.equal(app.state().active,false);
    } finally {await app.close();await new Promise(resolve=>remote.close(resolve));}
});

test('native execution abort waits for a TERM-resistant child to close',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-child-check-')),marker=path.join(directory,'started');
    const controller=new AbortController();
    try {
        const pending=execute(process.execPath,['-e',"require('fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",marker],{signal:controller.signal});
        while(true){try{await fs.stat(marker);break;}catch{await new Promise(r=>setTimeout(r,10));}}
        const pid=Number(await fs.readFile(marker,'utf8')),started=Date.now();controller.abort();
        await assert.rejects(pending,{name:'AbortError'});assert(Date.now()-started>=450);assert.throws(()=>process.kill(pid,0));
    } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('video preparation can encode non-AVC picture; audio-only preparation keeps channels and rate',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-real-preparation-'));
    try {
        const input=path.join(directory,'source.mkv');
        await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-i',new URL('./fixtures/landscape_a.mp4',import.meta.url).pathname,
            '-t','0.5','-vf','scale=160:90,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-pix_fmt','yuv420p10le','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','pcm_s16le',input]);
        const videoDir=path.join(directory,'video');await fs.mkdir(videoDir);
        const result=await prepareCompatible({input,directory:videoDir,kind:'video'});
        assert.equal(result.preparation.picture,'encoded-h264-up-to-1080p');assert.equal(result.type,'video/mp4');
        const audioDir=path.join(directory,'audio');await fs.mkdir(audioDir);
        const audio=await prepareCompatible({input:new URL('./fixtures/surround_71.wav',import.meta.url).pathname,directory:audioDir,kind:'audio'});
        assert.equal(audio.type,'audio/wav');assert.equal(audio.preparation.audio,'pcm-original-channel-count');
        const metadata=JSON.parse((await execute('ffprobe',['-v','error','-show_streams','-of','json',audio.file])).stdout);
        assert.equal(metadata.streams[0].channels,8);assert.equal(metadata.streams[0].sample_rate,'48000');
    } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('full-range AVC picture and declared color survive preparation with an AC-3 soundtrack',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-full-range-'));
    const inventory=async file=>JSON.parse((await execute('ffprobe',['-v','error','-show_streams','-show_packets',
        '-show_data_hash','sha256','-of','json',file])).stdout);
    try {
        for(const matrix of ['bt709','smpte170m']) {
            const input=path.join(directory,matrix+'.mp4'),output=path.join(directory,matrix);await fs.mkdir(output);
            await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-i',
                new URL('./fixtures/ac3_video.mp4',import.meta.url).pathname,'-t','0.5','-vf','scale=160:90:out_range=full',
                '-c:v','libx264','-pix_fmt','yuvj420p','-color_range','pc','-colorspace',matrix,
                '-color_primaries','bt709','-color_trc','bt709','-c:a','copy',input]);
            const source=await inventory(input),v=source.streams.find(s=>s.codec_type==='video');
            assert.equal(v.pix_fmt,'yuvj420p');assert.equal(v.color_range,'pc');
            const result=await prepareCompatible({input,directory:output,kind:'video'});
            assert.equal(result.preparation.picture,'copied');assert.equal(result.preparation.audio,'stereo-aac');
            const prepared=await inventory(result.file),out=prepared.streams.find(s=>s.codec_type==='video');
            for(const key of ['pix_fmt','color_range','color_space','color_primaries','color_transfer'])assert.equal(out[key],v[key],key);
            const packets=(data,index)=>data.packets.filter(p=>p.stream_index===index).map(p=>({pts:p.pts,dts:p.dts,duration:p.duration,hash:p.data_hash}));
            assert.deepEqual(packets(prepared,out.index),packets(source,v.index),'picture packet bytes and timestamps retained');
            const audio=prepared.streams.find(s=>s.codec_type==='audio');assert.equal(audio.codec_name,'aac');assert.equal(audio.channels,2);
            // A lying output probe must not certify a changed copied-picture label.
            const wrapper=path.join(directory,'probe-'+matrix+'.cjs');
            await fs.writeFile(wrapper,`#!/usr/bin/env node\nconst cp=require('node:child_process');const args=process.argv.slice(2);const data=JSON.parse(cp.execFileSync('ffprobe',args).toString());if(args.at(-1).endsWith('review.mp4'))data.streams.find(s=>s.codec_type==='video').color_space='bt470bg';process.stdout.write(JSON.stringify(data));\n`,{mode:0o700});
            const bad=path.join(directory,'bad-'+matrix);await fs.mkdir(bad);
            await assert.rejects(prepareCompatible({input,directory:bad,kind:'video',ffprobe:wrapper}),/retain its declared color interpretation/);
        }
    } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('bridge rejects invalid launch identities before accepting a port and disconnect is terminal',async()=>{
    const vm=await import('node:vm');
    const source=await fs.readFile(new URL('../tools/media-prepare/companion/bridge.js',import.meta.url),'utf8');
    function launch(origin,nonce='f'.repeat(32),hasOpener=true) {
        const listeners={},posted=[],opener=hasOpener?{postMessage(value){posted.push(value);}}:null;
        const ui={status:{textContent:''},site:{textContent:''},allow:{disabled:true,addEventListener(type,fn){this[type]=fn;}},disconnect:{addEventListener(type,fn){this[type]=fn;}}};
        vm.runInNewContext(source,{document:{querySelector(){return {content:'test-token'};},getElementById(id){return ui[id];}},
            location:{hash:'#'+new URLSearchParams({id:nonce,origin}),pathname:'/connect.html'},history:{replaceState(){}},
            window:{opener,addEventListener(type,fn){listeners[type]=fn;}},URL,URLSearchParams,File,AbortController,AbortSignal,
            fetch(){throw Error('No native request expected');}});
        const port={start(){},postMessage(value){posted.push(value);},close(){}};
        const connect=()=>listeners.message?.({source:opener,origin,data:{type:'WARPDIFF_PREPARATION_CONNECT',version:1,id:nonce},ports:[port]});
        return {listeners,ui,posted,connect};
    }
    for(const args of [['https://untrusted.example'],['null'],['https://jayriddle.github.io','bad'],['https://jayriddle.github.io','f'.repeat(32),false]]) {
        const probe=launch(...args);probe.connect();assert.equal(probe.ui.allow.disabled,true);assert.equal(probe.listeners.message,undefined);assert.deepEqual(probe.posted,[]);
    }
    for(const origin of ['https://jayriddle.github.io','http://127.0.0.1:54321','https://localhost:1234']) {
        const probe=launch(origin);probe.connect();assert.equal(probe.ui.allow.disabled,false);probe.ui.disconnect.click();probe.connect();probe.ui.allow.click();
        assert.equal(probe.ui.allow.disabled,true);assert.equal(probe.posted.some(item=>item.type==='ready'),false);
    }
});

for (const transfer of ['smpte2084','arib-std-b67']) test('HDR '+transfer+' is refused before picture reencoding',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-hdr-policy-'));
    try {
        const input=path.join(directory,'hdr.mkv'),out=path.join(directory,'output');await fs.mkdir(out);
        await execute('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=size=128x72:rate=24:duration=0.25',
            '-vf','setparams=range=tv:color_primaries=bt2020:color_trc='+transfer+':colorspace=bt2020nc','-c:v','ffv1','-pix_fmt','yuv420p10le','-color_range','tv','-colorspace','bt2020nc','-color_primaries','bt2020','-color_trc',transfer,input]);
        await assert.rejects(prepareCompatible({input,directory:out,kind:'video'}),/HDR \(PQ\/HLG\)/);
        assert.deepEqual(await fs.readdir(out),[]);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('unknown SDR interpretation is not silently assigned BT.709 during encoding',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-unknown-color-'));
    try {
        const input=path.join(directory,'unknown.mkv'),out=path.join(directory,'output');await fs.mkdir(out);
        await execute('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=size=128x72:duration=0.25','-c:v','ffv1',input]);
        await assert.rejects(prepareCompatible({input,directory:out,kind:'video'}),/known SDR color/);
        assert.deepEqual(await fs.readdir(out),[]);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});

for (const [width,height] of [[161,91],[161,90],[162,91],[162,90]]) {
    for (const range of ['tv','pc']) test(`SDR ${width}x${height} ${range} preparation normalizes geometry before 4:2:0 conversion`,async()=>{
        const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-sdr-geometry-'));
        try {
            // 4:4:4 permits genuinely odd dimensions. Set frame properties before
            // FFV1 encoding so both FFmpeg 6 and 8 retain the source color tags.
            const pixels=width*height,frame=Buffer.alloc(pixels*3,128);
            for(let y=0;y<height;y++)for(let x=0;x<width;x++)frame[y*width+x]=x<width/2 ? range==='pc'?0:16 : range==='pc'?255:235;
            const raw=path.join(directory,'source.yuv'),input=path.join(directory,'source.mkv'),out=path.join(directory,'output');
            await fs.writeFile(raw,Buffer.concat(Array(6).fill(frame)));await fs.mkdir(out);
            await execute('ffmpeg',['-v','error','-nostdin','-n','-f','rawvideo','-pixel_format','yuv444p','-video_size',width+'x'+height,
                '-framerate','24','-i',raw,'-vf','setparams=range='+range+':color_primaries=bt709:color_trc=bt709:colorspace=bt709',
                '-c:v','ffv1','-color_range',range,'-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',input]);
            const metadata=async file=>JSON.parse((await execute('ffprobe',['-v','error','-show_streams','-of','json',file])).stdout).streams[0];
            const source=await metadata(input);
            assert.equal(source.width,width);assert.equal(source.height,height);assert.equal(source.pix_fmt,'yuv444p');
            assert.equal(source.color_range,range);
            for(const key of ['color_space','color_primaries','color_transfer'])assert.equal(source[key],'bt709');
            const result=await prepareCompatible({input,directory:out,kind:'video'}),output=await metadata(result.file);
            assert.equal(result.preparation.picture,'encoded-h264-up-to-1080p');
            assert.equal(output.codec_name,'h264');assert.equal(output.pix_fmt,'yuv420p');
            assert.equal(output.width%2,0);assert.equal(output.height%2,0);
            assert(Math.abs(output.width-width)<=2);assert(Math.abs(output.height-height)<=2);
            assert.equal(output.nb_frames,'6');assert(Math.abs(Number(output.duration)-0.25)<0.001);
            assert.equal(output.color_range,'tv');
            for(const key of ['color_space','color_primaries','color_transfer'])assert.equal(output[key],'bt709');
            const {spawnSync}=await import('node:child_process');
            const decoded=spawnSync('ffmpeg',['-v','error','-i',result.file,'-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1']);
            assert.equal(decoded.status,0,decoded.stderr.toString());
            const row=Math.floor(output.height/2)*output.width;
            assert(Math.abs(decoded.stdout[row+16]-16)<=2,'Decoded black remains limited-range black');
            assert(Math.abs(decoded.stdout[row+output.width-16]-235)<=2,'Decoded white remains limited-range white');
        }finally{await fs.rm(directory,{recursive:true,force:true});}
    });
}

test('full-range 10-bit SDR encoding declares and produces limited BT.709 black and white',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-sdr-range-'));
    try {
        const w=128,h=72,frame=Buffer.alloc(w*h*3);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)frame.writeUInt16LE(x<w/2?0:1023,(y*w+x)*2);
        for(let i=w*h*2;i<frame.length;i+=2)frame.writeUInt16LE(512,i);
        const raw=path.join(directory,'source.yuv'),input=path.join(directory,'source.mkv'),out=path.join(directory,'output');
        await fs.writeFile(raw,Buffer.concat(Array(6).fill(frame)));await fs.mkdir(out);
        await execute('ffmpeg',['-v','error','-nostdin','-n','-f','rawvideo','-pixel_format','yuv420p10le','-video_size',w+'x'+h,'-framerate','24','-i',raw,
            '-vf','setparams=range=pc:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',input]);
        const result=await prepareCompatible({input,directory:out,kind:'video'});
        const metadata=JSON.parse((await execute('ffprobe',['-v','error','-show_streams','-of','json',result.file])).stdout).streams[0];
        assert.equal(metadata.color_range,'tv');for(const key of ['color_space','color_primaries','color_transfer'])assert.equal(metadata[key],'bt709');
        const {spawnSync}=await import('node:child_process');const decoded=spawnSync('ffmpeg',['-v','error','-i',result.file,'-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1']);
        assert.equal(decoded.status,0);assert(Math.abs(decoded.stdout[Math.floor(h/2)*w+16]-16)<=2);assert(Math.abs(decoded.stdout[Math.floor(h/2)*w+w-16]-235)<=2);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});
