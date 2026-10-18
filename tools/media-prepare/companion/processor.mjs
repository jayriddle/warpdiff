// Repository-only processor. No downloaded engines, shell commands or user paths.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

export const INPUT_LIMIT = 512 * 1024 * 1024;
export const OUTPUT_LIMIT = 1024 * 1024 * 1024;
const FORMATS = 'mov,matroska,webm,avi,mxf,mpeg,mpegts,asf,wav,flac,mp3,ogg,aac,ac3,eac3,dts,truehd,mlp';
export class PreparationError extends Error {}
const abortError = () => Object.assign(new PreparationError('Preparation cancelled'), {name:'AbortError'});
function check(signal) { if (signal?.aborted) throw abortError(); }

export function execute(executable, args, {signal, timeout=120000, maxBuffer=2*1024*1024}={}) {
    check(signal);
    return new Promise((resolve,reject) => {
        const child = spawn(executable,args,{stdio:['ignore','pipe','pipe']});
        let failure, killTimer;
        const chunks={stdout:[],stderr:[]}, sizes={stdout:0,stderr:0};
        const fail = error => {
            if (failure) return;
            failure=error; child.kill('SIGTERM');
            killTimer=setTimeout(()=>child.kill('SIGKILL'),500);
        };
        const cancelled=()=>fail(abortError());
        const timer=setTimeout(()=>fail(new PreparationError('Preparation timed out')),timeout);
        signal?.addEventListener('abort',cancelled,{once:true});
        if(signal?.aborted)cancelled();
        for(const key of ['stdout','stderr'])child[key].on('data',bytes=>{
            if(failure)return;
            sizes[key]+=bytes.length;
            if(sizes[key]>maxBuffer)fail(new PreparationError('Tool output limit exceeded'));
            else chunks[key].push(bytes);
        });
        child.on('error',error=>{failure ||= error;});
        // close, not exit, owns retirement; cancellation never abandons a child.
        child.once('close',code=>{
            clearTimeout(timer);clearTimeout(killTimer);
            signal?.removeEventListener('abort',cancelled);
            if(failure)reject(failure);
            else if(code!==0)reject(new PreparationError('The media tool could not read or prepare this file'));
            else resolve({stdout:Buffer.concat(chunks.stdout).toString(),stderr:Buffer.concat(chunks.stderr).toString()});
        });
    });
}
export async function checkExecutables({ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
    await execute(ffmpeg,['-version'],{timeout:10000});
    await execute(ffprobe,['-version'],{timeout:10000});
}
async function probe(file,{ffprobe,signal}) {
    const {stdout}=await execute(ffprobe,['-v','error','-protocol_whitelist','file',
        '-format_whitelist',FORMATS,'-show_streams','-show_format','-of','json',file],{signal,timeout:20000});
    return JSON.parse(stdout);
}
async function digest(file,signal) {
    const hash=createHash('sha256');
    for await(const bytes of createReadStream(file,{signal}))hash.update(bytes);
    return hash.digest('hex');
}
export async function prepareCompatible({input,directory,kind,signal,ffmpeg='ffmpeg',ffprobe='ffprobe'}) {
    check(signal);
    if(!['video','audio'].includes(kind))throw new PreparationError('This prototype prepares video and audio files');
    const source=await probe(input,{ffprobe,signal});
    const streams=source.streams;
    if(!Array.isArray(streams)||streams.length>64)throw new PreparationError('Unsupported media stream inventory');
    const videos=streams.filter(s=>s.codec_type==='video'&&s.disposition?.attached_pic!==1);
    const audios=streams.filter(s=>s.codec_type==='audio');
    if(videos.length>(kind==='video'?1:0)||audios.length>1||
       (kind==='video'&&videos.length!==1)||(kind==='audio'&&audios.length!==1)) {
        throw new PreparationError('This prototype needs one picture stream and at most one soundtrack, or one audio-only stream');
    }
    const selected=[...videos,...audios];
    if(selected.some(s=>!Number.isInteger(s.index)||s.index<0||s.index>63))throw new PreparationError('Invalid media stream index');
    const duration=Number((kind==='video'?videos[0]:audios[0]).duration || source.format?.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>6*60*60)throw new PreparationError('Could not establish a bounded media duration');
    if(kind==='audio'&&(!Number.isInteger(audios[0].channels)||audios[0].channels<1||audios[0].channels>8)) {
        throw new PreparationError('This prototype supports audio files with one to eight channels');
    }
    const copyPicture=kind==='video'&&videos[0].codec_name==='h264'&&videos[0].pix_fmt==='yuv420p'&&
        videos[0].width>0&&videos[0].height>0&&videos[0].width<=4096&&videos[0].height<=2160;
    const name=kind==='video'?'review.mp4':'review.wav', file=path.join(directory,name);
    const args=['-hide_banner','-loglevel','error','-nostdin','-n','-protocol_whitelist','file',
        '-format_whitelist',FORMATS,'-i',input];
    if(kind==='video') {
        args.push('-map','0:'+videos[0].index);
        if(copyPicture)args.push('-c:v','copy');
        else args.push('-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
            '-vf','scale=w=min(iw\\,1920):h=min(ih\\,1080):force_original_aspect_ratio=decrease:force_divisible_by=2',
            '-g','48','-sc_threshold','0');
        if(audios.length)args.push('-map','0:'+audios[0].index,'-c:a','aac','-ac','2','-ar','48000','-b:a','192k','-af','apad','-shortest');
        args.push('-movflags','+faststart');
    } else {
        args.push('-map','0:'+audios[0].index,'-c:a','pcm_s24le');
    }
    args.push('-map_metadata','-1',file);
    // Bound disk growth while encoding. Do not use -fs: a silently truncated
    // but decodable output must never be accepted as a successful preparation.
    const work=new AbortController();
    const onAbort=()=>work.abort();signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)work.abort();
    let limitExceeded=false,checking=false;
    const monitor=setInterval(async()=>{
        if(checking)return;checking=true;
        try{if((await fs.stat(file)).size>OUTPUT_LIMIT){limitExceeded=true;work.abort();}}catch{}
        finally{checking=false;}
    },100);
    try {
        try {await execute(ffmpeg,args,{signal:work.signal,timeout:10*60*1000});}
        catch(error){if(limitExceeded)throw new PreparationError('Prepared file exceeds the prototype output limit');throw error;}
    } finally {
        clearInterval(monitor);signal?.removeEventListener('abort',onAbort);
    }
    if(limitExceeded)throw new PreparationError('Prepared file exceeds the prototype output limit');
    check(signal);
    const size=(await fs.stat(file)).size;
    if(!size||size>OUTPUT_LIMIT)throw new PreparationError('Prepared file is empty or exceeds the output limit');
    const output=await probe(file,{ffprobe,signal}),outVideos=output.streams.filter(s=>s.codec_type==='video'),
        outAudios=output.streams.filter(s=>s.codec_type==='audio');
    if(kind==='video'&&(outVideos.length!==1||outVideos[0].codec_name!=='h264'||outVideos[0].pix_fmt!=='yuv420p'||
       outAudios.length!==audios.length||outAudios.some(s=>s.codec_name!=='aac'||s.profile!=='LC'||s.channels!==2||Number(s.sample_rate)!==48000))) {
        throw new PreparationError('Prepared video did not match the requested compatibility format');
    }
    if(kind==='audio'&&(outVideos.length||outAudios.length!==1||outAudios[0].codec_name!=='pcm_s24le'||outAudios[0].channels!==audios[0].channels||
       Number(outAudios[0].sample_rate)!==Number(audios[0].sample_rate)))throw new PreparationError('Prepared audio did not retain its channel count and sample rate');
    const outDuration=Number((kind==='video'?outVideos[0]:outAudios[0]).duration||output.format.duration);
    if(!Number.isFinite(outDuration)||Math.abs(outDuration-duration)>Math.max(.15,duration*.001)) {
        throw new PreparationError('Prepared duration did not match the source');
    }
    await execute(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-xerror','-protocol_whitelist','file',
        '-format_whitelist',FORMATS,'-i',file,'-map','0:v?','-map','0:a?','-f','null','-'],{signal,timeout:10*60*1000});
    return {file,name,size,type:kind==='video'?'video/mp4':'audio/wav',sha256:await digest(file,signal),
        preparation:{picture:kind==='video'?(copyPicture?'copied':'encoded-h264-up-to-1080p'):'none',
            audio:audios.length?(kind==='video'?'stereo-aac':'pcm-original-channel-count'):'none',
            analysisBasis:'prepared-copy',originalRetained:true,conformance:'not-certified'}};
}
