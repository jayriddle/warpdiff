#!/usr/bin/env node
// Optional external tool. Uses separately installed executables, never downloads them.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, webcrypto} from 'node:crypto';
import {spawn} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function preparedMediaAPI() {
    const sources = await Promise.all(['js/mp4-demux.js', 'js/prepared-media.js'].map(file => fs.readFile(path.join(root, file), 'utf8')));
    return runInNewContext(sources.join('\n') + '\nWarpPreparedMedia', {File, TextEncoder, crypto:webcrypto});
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const abort = signal => { if (signal?.aborted) { const e = new Error('Preparation cancelled'); e.name = 'AbortError'; throw e; } };
// Settle only after close: cancellation must retire the process before callers
// remove its files. A tool that ignores TERM receives KILL after a bounded grace.
async function execute(executable, args, {signal, timeout, maxBuffer}) {
    abort(signal);
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {stdio:['ignore','pipe','pipe']});
        const chunks = {stdout:[], stderr:[]}, sizes = {stdout:0, stderr:0};
        let failure = null, killTimer = null;
        function retire(error) {
            if (failure) return;
            failure = error;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
        }
        const cancelled = () => { const e = new Error('Preparation cancelled'); e.name = 'AbortError'; retire(e); };
        const timer = setTimeout(() => retire(new Error('External tool timed out')), timeout);
        signal?.addEventListener('abort', cancelled, {once:true});
        if (signal?.aborted) cancelled();
        for (const stream of ['stdout','stderr']) child[stream].on('data', bytes => {
            if (failure) return;
            sizes[stream] += bytes.length;
            if (sizes[stream] > maxBuffer) retire(new Error('External tool output exceeds its buffer limit'));
            else chunks[stream].push(bytes);
        });
        child.on('error', error => { failure ||= error; });
        child.once('close', (code, killedBy) => {
            clearTimeout(timer); clearTimeout(killTimer);
            signal?.removeEventListener('abort', cancelled);
            const stdout = Buffer.concat(chunks.stdout).toString(), stderr = Buffer.concat(chunks.stderr).toString();
            if (!failure && code !== 0) failure = new Error('External tool failed (' + (killedBy || code) + '): ' + stderr.trim());
            if (failure) reject(failure); else resolve({stdout, stderr});
        });
    });
}
async function probe(file, signal, executable) {
    const {stdout} = await execute(executable, ['-v','error','-protocol_whitelist','file','-f','mov',
        '-show_streams','-show_format','-of','json',file],
        {signal, timeout:15000, maxBuffer:2 * 1024 * 1024});
    return JSON.parse(stdout);
}
export async function preparePackage({input, output, audioStream, signal, ffmpeg='ffmpeg', ffprobe='ffprobe'} = {}) {
    if (typeof input !== 'string' || typeof output !== 'string' || !input || !output) throw new TypeError('Specify --input and a new --output directory');
    input = path.resolve(input); output = path.resolve(output); abort(signal);
    const api = await preparedMediaAPI(), sourceStat = await fs.stat(input);
    if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > api.limits.fileBytes) throw new Error('Initial package handoff supports files up to 64 MiB');
    const sourceBytes = await fs.readFile(input); abort(signal);
    const source = {name:path.basename(input), size:sourceBytes.length, sha256:hash(sourceBytes)};
    const skeleton = {contract:'warpdiff.prepared-media', version:1, recipe:'video-audio-compatibility-v1', source,
        rendition:{name:'review.mp4', size:1, sha256:'0'.repeat(64)},
        transformation:{video:'copy', audio:'aac-stereo-48000', normalization:'none', downmix:'ffmpeg-default', selectedAudioStream:0}};
    api.parseManifest(JSON.stringify(skeleton)); // Names and limits precede external execution.
    const metadata = await probe(input, signal, ffprobe);
    const streams = metadata.streams;
    if (!Array.isArray(streams) || streams.length > 64) throw new Error('Unsupported source stream inventory');
    const videos = streams.filter(s => s.codec_type === 'video'), audios = streams.filter(s => s.codec_type === 'audio');
    if (videos.length !== 1 || videos[0].codec_name !== 'h264' || videos[0].pix_fmt !== 'yuv420p') throw new Error('Initial package tool requires one AVC/H.264 8-bit 4:2:0 video stream');
    if (audioStream === undefined && audios.length !== 1) throw new Error('Choose --audio-stream with its ffprobe stream index when audio is absent or ambiguous');
    const selected = audioStream === undefined ? audios[0] : audios.find(s => s.index === audioStream);
    if (!selected || !Number.isInteger(selected.index) || selected.index < 0 || selected.index > 63) throw new Error('Selected audio stream does not exist');
    skeleton.transformation.selectedAudioStream = selected.index;
    abort(signal);
    // mkdir is exclusive. Existing files/directories, including links, are untouched.
    await fs.mkdir(output);
    const partial = path.join(output, '.review.partial.mp4'), rendition = path.join(output, 'review.mp4');
    const manifestPath = path.join(output, 'warpdiff-package.json');
    const owned = new Set();
    try {
        // Reserve the pathname so FFmpeg cannot overwrite a pre-existing file.
        const handle = await fs.open(partial, 'wx'); await handle.close(); owned.add(partial);
        await execute(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-y',
            '-ignore_editlist','0','-fflags','+bitexact','-protocol_whitelist','file','-f','mov','-i',input,
            '-map','0:'+videos[0].index,'-map','0:'+selected.index,
            '-c:v','copy','-c:a','aac','-ac','2','-ar','48000','-b:a','192k',
            '-af','apad','-shortest','-map_metadata','-1','-movflags','+faststart',partial],
            {signal, timeout:120000, maxBuffer:2 * 1024 * 1024});
        abort(signal);
        const size = (await fs.stat(partial)).size;
        if (!size || size > api.limits.fileBytes) throw new Error('Prepared file exceeds the initial 64 MiB handoff limit');
        const bytes = await fs.readFile(partial); abort(signal);
        // Verify the source is still the byte sequence described in the manifest.
        if (hash(await fs.readFile(input)) !== source.sha256) throw new Error('Source changed during preparation');
        const manifest = {...skeleton, rendition:{name:'review.mp4', size:bytes.length, sha256:hash(bytes)}};
        const manifestText = JSON.stringify(manifest, null, 2) + '\n';
        const report = await api.inspectFiles({manifestFile:new File([manifestText], 'warpdiff-package.json'),
            mediaFile:new File([bytes], 'review.mp4'), sourceFile:new File([sourceBytes], source.name), signal});
        // Exercise actual decoding separately from container-table inspection.
        await execute(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-xerror','-protocol_whitelist','file','-f','mov','-i',partial,
            '-map','0:v:0','-map','0:a:0','-f','null','-'], {signal, timeout:120000, maxBuffer:2 * 1024 * 1024});
        abort(signal);
        // Exclusive links publish completed files without replacing user paths.
        await fs.link(partial, rendition); owned.add(rendition); abort(signal);
        await fs.unlink(partial); owned.delete(partial); abort(signal);
        const manifestPartial = path.join(output, '.manifest.partial.json');
        const manifestHandle = await fs.open(manifestPartial, 'wx'); owned.add(manifestPartial);
        try { abort(signal); await manifestHandle.writeFile(manifestText); } finally { await manifestHandle.close(); }
        abort(signal);
        await fs.link(manifestPartial, manifestPath); owned.add(manifestPath); abort(signal);
        await fs.unlink(manifestPartial); owned.delete(manifestPartial); abort(signal);
        return {output, manifest:manifestPath, rendition, report};
    } catch (error) {
        for (const file of owned) await fs.unlink(file).catch(() => {});
        // Never recursively delete anything a user may have added to the directory.
        await fs.rmdir(output).catch(() => {});
        throw error;
    }
}

async function main(args) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('node tools/media-prepare/prepare.mjs --input FILE --output NEW_DIRECTORY [--audio-stream INDEX]\nUses your installed ffmpeg/ffprobe. Copies AVC picture, prepares stereo AAC 48 kHz, retains the original.\nCreates review.mp4 and warpdiff-package.json. Initial file limit: 64 MiB. No strict conformance claim.'); return;
    }
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = {'--input':'input', '--output':'output', '--audio-stream':'audioStream'}[args[i]];
        if (!key || Object.hasOwn(options, key) || !args[i + 1]) throw new Error('Unknown, duplicate or incomplete option; use --help');
        options[key] = key === 'audioStream' ? Number(args[i + 1]) : args[i + 1];
    }
    if (options.audioStream !== undefined && (!Number.isInteger(options.audioStream) || options.audioStream < 0 || options.audioStream > 63)) throw new Error('Invalid audio stream index');
    const controller = new AbortController(), stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try { console.log(JSON.stringify(await preparePackage({...options, signal:controller.signal}), null, 2)); }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({error:error.message})); process.exitCode = 1; });
}
