// Trusted-code adapter boundary. No loading of plugins, network access, media
// mutation or automatic preparation. Results must re-enter the normal loader.
const _FFMPEG_UNSAFE_FILENAME = 'Rename this file without control characters before copying a terminal command.';
const _FFMPEG_UNSUPPORTED_CONTAINER = 'This command supports MP4/MOV video (including .m4v). Prepare other formats with a command suited to their container and video codec, then reload the prepared file.';

function _quotePosixShellArg(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

function _ffmpegFilenameParts(filename) {
    const suffix = filename.match(/(\.[^.]+)$/);
    if (suffix && suffix.index > 0) return {base: filename.slice(0, suffix.index), ext: suffix[1]};
    return {base: filename, ext: '.mp4'};
}

const WarpMediaPreparation = (() => {
    const CONTRACT = 'warpdiff.media-preparation', VERSION = 1;
    const RECIPE = 'video-audio-compatibility-v1';
    const REVIEW_RECIPE = 'local-review-copy-v1';
    function createReviewRequest({id, filename, mediaType}) {
        if (typeof id !== 'string' || !id || id.length > 128 || typeof filename !== 'string' || !filename ||
            !['video','audio'].includes(mediaType)) throw new TypeError('Invalid review-copy request');
        return Object.freeze({contract: CONTRACT, version: VERSION, id, recipe: REVIEW_RECIPE,
            source: Object.freeze({name:filename,mediaType}),
            output: Object.freeze({analysisBasis:'prepared-copy',preservesOriginal:true,
                picture:mediaType==='video'?'compatible-h264-copy-or-encode':'none',
                audio:mediaType==='video'?'stereo-aac':'pcm-original-channel-count'})});
    }
    function createRequest({id, filename, codec = 'unknown'}) {
        if (typeof id !== 'string' || !id || id.length > 128 || typeof filename !== 'string' || !filename ||
                typeof codec !== 'string' || !codec || codec.length > 128) throw new TypeError('Invalid preparation request');
        return Object.freeze({contract: CONTRACT, version: VERSION, id, recipe: RECIPE,
            source: Object.freeze({name: filename, mediaType: 'video'}),
            reason: Object.freeze({code: 'audio-decode-unavailable', codec}),
            output: Object.freeze({video: 'copy', audio: 'aac', channels: 2, sampleRate: 48000,
                bitrate: 192000, analysisBasis: 'prepared-copy', preservesOriginal: true}),
        });
    }
    function checkedRequest(request) {
        if (request?.contract === CONTRACT && request.version === VERSION && request.recipe === REVIEW_RECIPE) {
            return createReviewRequest({id:request.id,filename:request.source?.name,mediaType:request.source?.mediaType});
        }
        if (!request || request.contract !== CONTRACT || request.version !== VERSION || request.recipe !== RECIPE ||
                request.source?.mediaType !== 'video' || request.reason?.code !== 'audio-decode-unavailable') {
            throw new TypeError('Unsupported preparation contract');
        }
        // Reconstruct, rather than forwarding provider-controlled claims or options.
        return createRequest({id: request.id, filename: request.source.name, codec: request.reason.codec});
    }
    function manualFFmpegProvider() {
        return Object.freeze({id: 'manual-ffmpeg', version: VERSION, mode: 'instructions',
            supports: request => request.recipe === RECIPE,
            plan(request) {
                const filename = request.source.name, {base, ext} = _ffmpegFilenameParts(filename);
                const notice = /[\x00-\x1F\x7F-\x9F]/.test(filename) ? _FFMPEG_UNSAFE_FILENAME
                    : !['.mp4', '.mov', '.m4v'].includes(ext.toLowerCase()) ? _FFMPEG_UNSUPPORTED_CONTAINER : '';
                const command = notice ? null : 'ffmpeg -ignore_editlist 0 -fflags +bitexact -i ' + _quotePosixShellArg('./' + filename) + ' -map 0:v:0 -map 0:a:0 -c:v copy -c:a aac -ac 2 -ar 48000 -b:a 192k -af apad -shortest -movflags +faststart ' + _quotePosixShellArg('./' + base + '_aac' + ext);
                return Object.freeze({kind: 'instructions', command, notice});
            },
        });
    }
    function createRegistry() {
        const providers = new Map();
        let active = null;
        function register(provider) {
            if (!provider || typeof provider.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) || provider.version !== VERSION ||
                    !['instructions', 'files'].includes(provider.mode) || typeof provider.supports !== 'function' ||
                    typeof provider[provider.mode === 'files' ? 'prepare' : 'plan'] !== 'function') {
                throw new TypeError('Invalid preparation provider');
            }
            if (providers.has(provider.id)) throw new Error('Preparation provider already registered');
            // Capture the implementation at registration; later object mutation
            // cannot change the provider currently selected for a request.
            providers.set(provider.id, Object.freeze({id: provider.id, mode: provider.mode,
                supports: provider.supports.bind(provider),
                ...(provider.mode === 'files' ? {prepare: provider.prepare.bind(provider)} : {plan: provider.plan.bind(provider)}),
            }));
        }
        function selected(id, request, mode) {
            const provider = providers.get(id);
            if (!provider || provider.mode !== mode || provider.supports(request) !== true) {
                throw new Error('Preparation provider cannot handle this request');
            }
            return provider;
        }
        function describe(request) {
            request = checkedRequest(request);
            return Object.freeze([...providers.values()].filter(p => p.supports(request) === true)
                .map(p => Object.freeze({id: p.id, mode: p.mode})));
        }
        function plan(id, request) {
            request = checkedRequest(request);
            const result = selected(id, request, 'instructions').plan(request);
            if (!result || result.kind !== 'instructions' ||
                    !(result.command === null || typeof result.command === 'string') || typeof result.notice !== 'string') {
                throw new TypeError('Invalid preparation instructions');
            }
            return Object.freeze({kind: 'instructions', providerId: id, requestId: request.id,
                command: result.command, notice: result.notice});
        }
        function cancelled() {
            const error = new Error('Preparation cancelled'); error.name = 'AbortError'; return error;
        }
        function cancel() { if (active) active.abort(); }
        async function prepare(id, request, input) {
            request = checkedRequest(request);
            const provider = selected(id, request, 'files');
            if (!(input instanceof File) || !input.size || input.name !== request.source.name) {
                throw new TypeError('Preparation requires the explicitly supplied source File');
            }
            cancel();
            const controller = new AbortController(); active = controller;
            let onAbort;
            const aborted = new Promise((_, reject) => {
                onAbort = () => reject(cancelled());
                controller.signal.addEventListener('abort', onAbort, {once: true});
            });
            try {
                const result = await Promise.race([aborted, Promise.resolve().then(() => {
                    if (controller.signal.aborted) throw cancelled();
                    return provider.prepare(request, Object.freeze({input, signal: controller.signal}));
                })]);
                if (controller.signal.aborted || active !== controller) throw cancelled();
                if (!result || result.kind !== 'files' || !Array.isArray(result.files) || result.files.length < 1 || result.files.length > 4 ||
                        !result.files.every(file => file instanceof File && file.size > 0)) {
                    throw new TypeError('Preparation did not return 1–4 nonempty Files');
                }
                // Provider assertions such as ready/validated are deliberately not
                // propagated. The existing loader must verify returned bytes.
                return Object.freeze({kind: 'files', providerId: id, requestId: request.id,
                    validation: 'required', analysisBasis: 'prepared-copy', files: Object.freeze([...result.files])});
            } finally {
                controller.signal.removeEventListener('abort', onAbort);
                if (active === controller) active = null;
            }
        }
        return Object.freeze({register, describe, plan, prepare, cancel});
    }
    return Object.freeze({version: VERSION, createRequest, createReviewRequest, manualFFmpegProvider, createRegistry});
})();
