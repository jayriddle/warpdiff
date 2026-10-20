// Optional offline file handoff. No discovery, conversion, network or loading.
// Inspection validates byte binding and bounded container facts, never READY.
const WarpPreparedMedia = (() => {
    const VERSION = 1, RECIPE = 'video-audio-compatibility-v1';
    const MAX_FILE_BYTES = 64 * 1024 * 1024, MAX_MANIFEST_BYTES = 16 * 1024;
    let inspecting = false;
    const freeze = value => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
    };
    function checkSignal(signal) {
        if (signal?.aborted) { const error = new Error('Package inspection cancelled'); error.name = 'AbortError'; throw error; }
    }
    function identity(value) {
        if (!value || typeof value.name !== 'string' || !value.name || value.name.length > 255 ||
            /[\/\\\x00-\x1f\x7f-\x9f]/.test(value.name) || ['.', '..'].includes(value.name) ||
            !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FILE_BYTES ||
            typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
            throw new TypeError('Invalid package file identity');
        }
        return {name:value.name, size:value.size, sha256:value.sha256};
    }
    function parseManifest(text) {
        if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) throw new TypeError('Package manifest exceeds 16 KiB');
        const value = JSON.parse(text);
        if (value?.contract !== 'warpdiff.prepared-media' || value.version !== VERSION || value.recipe !== RECIPE ||
            value.transformation?.video !== 'copy' || value.transformation?.audio !== 'aac-stereo-48000' ||
            value.transformation?.normalization !== 'none' || value.transformation?.downmix !== 'ffmpeg-default' ||
            !Number.isInteger(value.transformation?.selectedAudioStream) || value.transformation.selectedAudioStream < 0 ||
            value.transformation.selectedAudioStream > 63) throw new TypeError('Unsupported prepared package');
        return freeze({contract:value.contract, version:VERSION, recipe:RECIPE,
            source:identity(value.source), rendition:identity(value.rendition),
            transformation:{video:'copy', audio:'aac-stereo-48000', normalization:'none', downmix:'ffmpeg-default',
                selectedAudioStream:value.transformation.selectedAudioStream}});
    }
    function checkFile(file, expected) {
        if (!(file instanceof File) || file.size < 1 || file.size > MAX_FILE_BYTES ||
            file.name !== expected.name || file.size !== expected.size) throw new TypeError('Selected file does not match the package identity');
    }
    async function boundBytes(file, expected, signal) {
        checkFile(file, expected); checkSignal(signal);
        const bytes = await file.arrayBuffer(); checkSignal(signal);
        if (bytes.byteLength !== expected.size) throw new Error('Package read length changed');
        const hash = await crypto.subtle.digest('SHA-256', bytes); checkSignal(signal);
        const hex = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
        if (hex !== expected.sha256) throw new Error('Package SHA-256 does not match selected bytes');
        return bytes;
    }
    async function inspect({manifestFile, mediaFile, sourceFile, signal} = {}, snapshot = false) {
        checkSignal(signal);
        if (inspecting) throw new Error('Another package inspection is still retiring');
        if (!(manifestFile instanceof File) || !manifestFile.size || manifestFile.size > MAX_MANIFEST_BYTES) throw new TypeError('Select a package manifest of at most 16 KiB');
        inspecting = true;
        try {
            const text = await manifestFile.text(); checkSignal(signal);
            const manifest = parseManifest(text);
            // Validate every supplied identity/size before the first media read.
            checkFile(mediaFile, manifest.rendition);
            if (sourceFile !== undefined) checkFile(sourceFile, manifest.source);
            if (sourceFile !== undefined) await boundBytes(sourceFile, manifest.source, signal);
            const bytes = new Uint8Array(await boundBytes(mediaFile, manifest.rendition, signal));
            checkSignal(signal);
            const audio = _demuxMP4Audio(bytes, false, null, true);
            if (!audio || audio.trackCount !== 2 || audio.videoTrackCount !== 1 || audio.audioTrackCount !== 1 ||
                audio.codec !== 'mp4a.40.2' || audio.aacSbr !== false || audio.channels !== 2 || audio.sampleRate !== 48000 ||
                !Number.isFinite(audio.timelineStart) || audio.timelineStart < 0) throw new Error('Package requires one video and one readable stereo AAC-LC 48 kHz track');
            const video = _demuxMP4Video(bytes, true);
            if (!video || !/^avc1\.(42|4d|64)[a-f0-9]{4}$/i.test(video.codec) ||
                !video.codedWidth || !video.codedHeight || video.codedWidth > 4096 || video.codedHeight > 4096 ||
                video.codedWidth * video.codedHeight > 4096 * 2160 || !video.sampleCount) throw new Error('Package requires bounded AVC picture with readable sample tables');
            checkSignal(signal);
            const report = freeze({contract:'warpdiff.prepared-media-report', version:VERSION, recipe:RECIPE,
                status:'candidate', renditionBinding:'matched', sourceBinding:sourceFile === undefined ? 'not-checked' : 'matched',
                container:{videoCodec:video.codec, width:video.codedWidth, height:video.codedHeight,
                    audioCodec:audio.codec, channels:audio.channels, sampleRate:audio.sampleRate, audioStart:audio.timelineStart},
                analysisBasis:'prepared-copy', validation:'normal-load-required',
                conformance:{fullFileDecoding:'not-verified', sourceDerivation:'not-verified',
                    frameMapping:'not-verified', synchronization:'not-verified', channelFidelity:'not-verified', measurement:'not-verified'}});
            // File handles may become unreadable or change on disk after Check.
            // A bounded in-memory File binds loading to the exact hashed bytes.
            return snapshot ? Object.freeze({report, mediaFile:new File([bytes], mediaFile.name,
                {type:'video/mp4',lastModified:mediaFile.lastModified})}) : report;
        } finally { inspecting = false; }
    }
    function createFileProvider({manifestFile, mediaFile} = {}) {
        let files = {manifestFile, mediaFile};
        return Object.freeze({id:'prepared-package', version:VERSION, mode:'files',
            supports:request => !!files && request.recipe === RECIPE,
            async prepare(request, {input, signal}) {
                if (!files) throw new Error('Package provider has already been consumed');
                const selected = files; files = null; // one-shot; release retained Files on settlement
                if (input?.name !== request.source?.name) throw new Error('Package source does not match preparation request');
                const checked = await inspect({...selected, sourceFile:input, signal}, true); checkSignal(signal);
                return {kind:'files', files:[checked.mediaFile]};
            },
        });
    }
    return Object.freeze({version:VERSION, limits:Object.freeze({fileBytes:MAX_FILE_BYTES, manifestBytes:MAX_MANIFEST_BYTES}),
        parseManifest, inspectFiles:options => inspect(options), inspectSnapshot:options => inspect(options, true), createFileProvider});
})();
