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
function compatiblePicture(stream) {
    return stream?.codec_name==='h264' && (stream.pix_fmt==='yuv420p' ||
        stream.pix_fmt==='yuvj420p' && stream.color_range==='pc');
}
const UNSPECIFIED_COLOR = new Set(['unknown','unspecified','reserved']);
const SDR_MATRICES = ['bt709','bt470bg','smpte170m'];
const SDR_PRIMARIES = ['bt709','bt470bg','smpte170m','bt470m'];
// ffprobe reports BT.470 transfers as bt470m/bt470bg. gamma22/gamma28 are the
// encoder names for the same curves and are accepted when a probe uses them.
const SDR_TRANSFERS = ['bt709','smpte170m','iec61966-2-1','bt470m','bt470bg','gamma22','gamma28'];
function specifiedColor(value) {
    if (value == null || value === '') return null;
    const text = String(value);
    return UNSPECIFIED_COLOR.has(text) ? null : text;
}
function hdFrame(stream) {
    // Orientation-independent. HD when the longer side is at least 1280 or the
    // shorter side is at least 720: 1280×720, 720×1280, 960×720 and 1920×540.
    // 540×960, 720×576 and 720×480 stay SD and use BT.601 (SMPTE 170M).
    const width = Number(stream.width) || 0, height = Number(stream.height) || 0;
    return Math.max(width, height) >= 1280 || Math.min(width, height) >= 720;
}
function rgbPixels(pix) {
    return /^(?:gbr|rgb|bgr|pal8|argb|abgr|rgba|bgra|0rgb|0bgr)/.test(pix || '');
}
// A declared tag fills only the tags that are absent. Matrix wins, then
// primaries, then transfer. Frame size is used when all three are absent.
// BT.709 and SMPTE 170M transfers are the same curve, so a transfer alone
// does not choose the matrix or primaries; frame size does. BT.470 M has no
// YCbCr matrix of its own, so its matrix is SMPTE 170M. sRGB does not declare
// a matrix; its missing matrix and primaries are BT.709.
const COLOR_FAMILIES = {
    bt709:{label:'BT.709', matrix:'bt709', primaries:'bt709', transfer:'bt709'},
    smpte170m:{label:'BT.601', matrix:'smpte170m', primaries:'smpte170m', transfer:'smpte170m'},
    bt470bg:{label:'BT.470BG', matrix:'bt470bg', primaries:'bt470bg', transfer:'bt470bg'},
    bt470m:{label:'BT.470M', matrix:'smpte170m', primaries:'bt470m', transfer:'bt470m'},
    gamma22:{label:'BT.470M', matrix:'smpte170m', primaries:'bt470m', transfer:'gamma22'},
    gamma28:{label:'BT.470BG', matrix:'bt470bg', primaries:'bt470bg', transfer:'gamma28'},
    'iec61966-2-1':{label:'BT.709', matrix:'bt709', primaries:'bt709', transfer:'iec61966-2-1', assumed:true},
};
function specifiedMatrix(value) {
    const text = specifiedColor(value);
    // gbr/rgb name an RGB layout, not a YCbCr matrix.
    return text === 'gbr' || text === 'rgb' ? null : text;
}
export function transferMatches(actual, expected) {
    const aliases = expected === 'bt470m' || expected === 'gamma22' ? ['bt470m','gamma22']
        : expected === 'bt470bg' || expected === 'gamma28' ? ['bt470bg','gamma28'] : [expected];
    return aliases.includes(actual);
}
export function interpretSdr(stream) {
    if (['smpte2084','arib-std-b67'].includes(stream.color_transfer)) {
        throw new PreparationError('HDR (PQ/HLG) picture conversion is not supported. Keep the original or use a color-managed HDR preparation tool.');
    }
    const space = specifiedMatrix(stream.color_space), primaries = specifiedColor(stream.color_primaries);
    const transfer = specifiedColor(stream.color_transfer), range = specifiedColor(stream.color_range);
    if ((space && !SDR_MATRICES.includes(space)) || (primaries && !SDR_PRIMARIES.includes(primaries)) ||
        (transfer && !SDR_TRANSFERS.includes(transfer)) || (range && !['tv','pc'].includes(range))) {
        throw new PreparationError('Picture conversion needs known SDR color range, matrix, primaries and transfer. Keep this comparison or prepare the source with a color-managed tool.');
    }
    const weakTransfer = !space && !primaries && (transfer === 'bt709' || transfer === 'smpte170m');
    const declared = (space && COLOR_FAMILIES[space]) || (primaries && COLOR_FAMILIES[primaries]) ||
        (!weakTransfer && transfer && COLOR_FAMILIES[transfer]) || null;
    const assumedFamily = hdFrame(stream) ? COLOR_FAMILIES.bt709 : COLOR_FAMILIES.smpte170m;
    const source = declared || assumedFamily;
    const resolvedMatrix = space || source.matrix, resolvedPrimaries = primaries || source.primaries;
    const resolvedTransfer = transfer || source.transfer;
    const missing = [space,primaries,transfer].filter(value => !value).length;
    const notice = missing === 3 ? 'No color tags; assumed '+assumedFamily.label
        : missing ? (declared && !declared.assumed ? 'Missing color tags; used declared '+declared.label
            : 'Missing color tags; assumed '+(declared || assumedFamily).label) : null;
    const resolvedRange = range || (rgbPixels(stream.pix_fmt) || /^yuvj/.test(stream.pix_fmt || '') ? 'pc' : 'tv');
    const filterTransfer = resolvedTransfer === 'gamma22' ? 'bt470m' : resolvedTransfer === 'gamma28' ? 'bt470bg' : resolvedTransfer;
    return {transfer:resolvedTransfer, range:resolvedRange, notice,
        // swscale's default RGB matrix is BT.601. Name the same matrix colorspace
        // will read, or a later HD conversion treats those samples as BT.709.
        // scale's integer option calls BT.470BG "bt601". FFmpeg 7.0 through 8.0
        // reject out_color_matrix=bt470bg; 6.1 and 8.1 accept both, and the
        // samples match. The colorspace filter keeps the name bt470bg.
        scaleMatrix:rgbPixels(stream.pix_fmt) ? (resolvedMatrix === 'bt470bg' ? 'bt601' : resolvedMatrix) : null,
        encoderTransfer:resolvedTransfer === 'bt470m' || resolvedTransfer === 'gamma22' ? 'gamma22'
            : resolvedTransfer === 'bt470bg' || resolvedTransfer === 'gamma28' ? 'gamma28' : resolvedTransfer,
        filter:'colorspace=ispace='+resolvedMatrix+':iprimaries='+resolvedPrimaries+
            ':itrc='+filterTransfer+':irange='+resolvedRange+
            ':space=bt709:primaries=bt709:trc='+filterTransfer+':range=tv:format=yuv420p:dither=fsb'};
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
    const copyPicture=kind==='video'&&compatiblePicture(videos[0])&&
        videos[0].width>0&&videos[0].height>0&&videos[0].width<=4096&&videos[0].height<=2160;
    const picture = kind==='video' && !copyPicture ? interpretSdr(videos[0]) : null;
    const name=kind==='video'?'review.mp4':'review.wav', file=path.join(directory,name);
    const args=['-hide_banner','-loglevel','error','-nostdin','-n','-protocol_whitelist','file',
        '-format_whitelist',FORMATS,'-i',input];
    if(kind==='video') {
        args.push('-map','0:'+videos[0].index);
        if(copyPicture)args.push('-c:v','copy');
        // Normalize geometry before colorspace requests 4:2:0, which cannot
        // accept odd dimensions. Preserve range explicitly while scaling: older
        // swscale versions may otherwise normalize full-range samples before
        // the following conversion interprets them using the source range.
        else args.push('-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
            '-vf','scale=w=min(iw\\,1920):h=min(ih\\,1080):force_original_aspect_ratio=decrease:force_divisible_by=2'+
                ':in_range='+picture.range+':out_range='+picture.range+
                (picture.scaleMatrix ? ':out_color_matrix='+picture.scaleMatrix : '')+','+picture.filter,
            '-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc',picture.encoderTransfer,
            '-g','48','-sc_threshold','0');
        if(audios.length) {
            args.push('-map','0:'+audios[0].index,'-c:a','aac','-ac','2','-ar','48000','-b:a','192k');
            // -shortest ends on the video packet, before the AAC encoder emits the
            // 1024-sample frame that covers that instant. The soundtrack then
            // finishes ~21 ms before the picture. Hosted WebKit seeked that review
            // (including back to time 0) and stayed at HAVE_METADATA, with the
            // network idle and the dimensions already known. Stopping at the
            // picture duration writes the covering frame. Copied pictures already
            // opened, so they keep the shortest cut.
            if(copyPicture) args.push('-af','apad','-shortest');
            else args.push('-af','apad','-t',duration.toFixed(6));
        }
        // Version-1 composition offsets keep B-frame delay out of the video edit
        // list. Copied pictures keep their original edit list.
        args.push('-movflags', copyPicture ? '+faststart' : '+faststart+negative_cts_offsets');
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
    if(kind==='video'&&(outVideos.length!==1||!compatiblePicture(outVideos[0])||
       outAudios.length!==audios.length||outAudios.some(s=>s.codec_name!=='aac'||s.profile!=='LC'||s.channels!==2||Number(s.sample_rate)!==48000))) {
        throw new PreparationError('Prepared video did not match the requested compatibility format');
    }
    if(copyPicture) {
        for(const key of ['color_range','color_space','color_primaries','color_transfer']) {
            const value=videos[0][key];
            if(value && !['unknown','unspecified','reserved'].includes(value) && outVideos[0][key]!==value) {
                throw new PreparationError('Copied picture did not retain its declared color interpretation');
            }
        }
    } else if (kind === 'video' && (outVideos[0].color_range !== 'tv' || outVideos[0].color_space !== 'bt709' ||
        outVideos[0].color_primaries !== 'bt709' || !transferMatches(outVideos[0].color_transfer, picture.transfer))) {
        throw new PreparationError('Converted picture did not retain the requested SDR interpretation');
    }
    if(kind==='audio'&&(outVideos.length||outAudios.length!==1||outAudios[0].codec_name!=='pcm_s24le'||outAudios[0].channels!==audios[0].channels||
       Number(outAudios[0].sample_rate)!==Number(audios[0].sample_rate)))throw new PreparationError('Prepared audio did not retain its channel count and sample rate');
    const outDuration=Number((kind==='video'?outVideos[0]:outAudios[0]).duration||output.format.duration);
    if(!Number.isFinite(outDuration)||Math.abs(outDuration-duration)>Math.max(.15,duration*.001)) {
        throw new PreparationError('Prepared duration did not match the source');
    }
    if(kind==='video'&&!copyPicture&&outAudios.length) {
        const soundtrack=Number(outAudios[0].duration);
        if(!Number.isFinite(soundtrack)||soundtrack+0.001<outDuration) {
            throw new PreparationError('Prepared soundtrack does not cover the picture');
        }
    }
    await execute(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-xerror','-protocol_whitelist','file',
        '-format_whitelist',FORMATS,'-i',file,'-map','0:v?','-map','0:a?','-f','null','-'],{signal,timeout:10*60*1000});
    const preparation={picture:kind==='video'?(copyPicture?'copied':'encoded-h264-up-to-1080p'):'none',
        audio:audios.length?(kind==='video'?'stereo-aac':'pcm-original-channel-count'):'none',
        analysisBasis:'prepared-copy',originalRetained:true,conformance:'not-certified'};
    if (picture?.notice) preparation.colorNotice = picture.notice;
    return {file,name,size,type:kind==='video'?'video/mp4':'audio/wav',sha256:await digest(file,signal),preparation};
}
