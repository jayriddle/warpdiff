// Native media keeps its browser decoder and timeline; a small output envelope
// prevents abrupt level changes when selecting another soundtrack. Keep native
// elements unmuted: Chromium changes its media clock/audio renderer when muted,
// provoking drift corrections and discontinuities after the gain fade finishes.
const _AUDIO_SWITCH_FADE = 0.015;
const _nativeAudioRoutes = new Map(); // media element → connected nodes

// One listening-output owner for native playback, scrub grains and decoded
// replacement audio. Web Audio defines speaker downmixes for 1/2/4/6 channels,
// but treats 8 → 2 as discrete: only FL/FR survive. Browser-decoded 7.1 is
// FL FR FC LFE BL BR SL SR. Match WarpSonic's monitoring policy: center at
// -3 dB into both ears, each side/back pair shares the surround contribution,
// and LFE stays out of the stereo mix. Source PCM and analysis are untouched.
function _connectAudioOutput(source, destination, channels) {
    const nodes = [];
    let input = destination;
    if (channels === 8) {
        const ctx = source.context;
        const split = ctx.createChannelSplitter(8);
        const merge = ctx.createChannelMerger(2);
        nodes.push(split, merge);
        const matrix = WarpScrubAudio.surroundMatrix(channels);
        for (const [channel, left, right] of matrix) {
            for (const [ear, level] of [[0, left], [1, right]]) {
                if (!level) continue;
                const gain = ctx.createGain();
                gain.gain.value = level;
                split.connect(gain, channel);
                gain.connect(merge, 0, ear);
                nodes.push(gain);
            }
        }
        merge.connect(destination);
        input = split;
    }
    source.connect(input);
    let connected = true;
    return {
        disconnect() {
            if (!connected) return;
            connected = false;
            source.disconnect(input);
            nodes.forEach(node => node.disconnect());
        }
    };
}

// Evaluate our envelope before canceling automation, including rapid reversals.
// AudioParam.value after cancelScheduledValues can report the old endpoint.
function _audioGainAtTime(gain, time) {
    const e = gain._audioEnvelope;
    if (!e) return 0;
    const progress = Math.max(0, Math.min(1, (time - e.start) / e.duration));
    return e.from + (e.target - e.from) * progress;
}

function _scheduleAudioGain(gain, from, target, start, duration = _AUDIO_SWITCH_FADE) {
    gain.gain.cancelScheduledValues(0);
    gain.gain.setValueAtTime(from, start);
    gain.gain.linearRampToValueAtTime(target, start + duration);
    gain._audioEnvelope = { from, target, start, duration };
}

function _prepareNativeAudio(media, channels) {
    if (!media) return null;
    // Until decode identifies a supported output layout, leave browser-native
    // mixing in charge. Taking over at loadedmetadata would discard dialogue
    // before the 7.1 channel count arrives (or forever if analysis cannot decode).
    const supported = [1, 2, 4, 6, 8].includes(channels);
    if (_nativeAudioRoutes.has(media)) {
        const route = _nativeAudioRoutes.get(media);
        if (supported && route.channels !== channels) {
            route.output.disconnect();
            route.output = _connectAudioOutput(route.source, route.gain, channels);
            route.channels = channels;
        }
        return route;
    }
    if (!supported) return null;
    const ctx = getAudioContext();
    const gain = ctx.createGain();
    let source;
    try { source = ctx.createMediaElementSource(media); }
    catch (_) { return null; } // Keep direct browser playback if routing is unavailable.
    const level = media.muted ? 0 : 1;
    _scheduleAudioGain(gain, level, level, ctx.currentTime);
    const output = _connectAudioOutput(source, gain, channels);
    gain.connect(ctx.destination);
    media.muted = !!_opusSyncSlots[media.dataset.slot];
    const resume = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    media.addEventListener('play', resume);
    const route = { source, gain, ctx, resume, output, channels };
    _nativeAudioRoutes.set(media, route);
    if (!media.paused) resume();
    return route;
}

function _setNativeAudioMuted(media, muted, fade = false) {
    const route = _nativeAudioRoutes.get(media);
    if (!route) { media.muted = !!muted; return; }
    const { gain, ctx } = route;
    const target = muted ? 0 : 1;
    if (!fade || media.paused || ctx.state !== 'running') {
        _scheduleAudioGain(gain, target, target, ctx.currentTime);
    } else if (gain._audioEnvelope.target !== target) {
        _scheduleAudioGain(gain, _audioGainAtTime(gain, ctx.currentTime), target, ctx.currentTime);
    }
    // Gain owns audibility, even for global mute. Only replacement soundtracks
    // disable the native renderer, because their separate buffer owns playback.
    media.muted = !!_opusSyncSlots[media.dataset.slot];
}

function _clearNativeAudioRoutes() {
    for (const [media, route] of _nativeAudioRoutes) {
        media.removeEventListener('play', route.resume);
        route.output.disconnect();
        route.source.disconnect();
        route.gain.disconnect();
    }
    _nativeAudioRoutes.clear();
}
