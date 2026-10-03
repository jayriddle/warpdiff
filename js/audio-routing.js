// Native media keeps its browser decoder and timeline; a small output envelope
// prevents abrupt level changes when selecting another soundtrack. Keep native
// elements unmuted: Chromium changes its media clock/audio renderer when muted,
// provoking drift corrections and discontinuities after the gain fade finishes.
const _AUDIO_SWITCH_FADE = 0.015;
const _nativeAudioRoutes = new Map(); // media element → connected nodes
const _nativeDirectOutputs = new Map(); // Safari mono/stereo video → native volume envelope
// Probe a detached, silent element. Platforms that lock native volume must
// retain the graph path, otherwise inactive videos could become audible.
const _nativeVideoVolumeWritable = (() => {
    const probe = document.createElement('video');
    try { _setMediaVolume(probe, .5); return probe.volume === .5; }
    catch (_) { return false; }
})();

// One volume writer preserves master level when Safari keeps ordinary video
// audio on its native path. Zero volume silences inactive clips without toggling
// mute or attaching the MediaElementSource that stalls post-seek video frames.
function _setMediaVolume(media, volume) {
    if (volume !== undefined) media._warpMasterVolume = volume;
    const master = media._warpMasterVolume ?? media.volume;
    media.volume = master * (_nativeDirectOutputs.get(media)?.level ?? 1);
}

function _setDirectNativeAudioMuted(media, muted, fade) {
    const state = _nativeDirectOutputs.get(media);
    if (!state) return;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    const target = muted ? 0 : 1;
    state.target = target;
    media.muted = false;
    if (!fade || media.paused || document.hidden || state.level === target) {
        state.level = target;
        _setMediaVolume(media);
        return;
    }
    const from = state.level, start = performance.now();
    const tick = () => {
        if (_nativeDirectOutputs.get(media) !== state) return;
        const progress = Math.min(1, (performance.now() - start) / (_AUDIO_SWITCH_FADE * 1000));
        state.level = from + (target - from) * progress;
        _setMediaVolume(media);
        state.timer = progress < 1 ? setTimeout(tick, 4) : null;
    };
    state.timer = setTimeout(tick, 4);
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    // Background timer throttling must not leave two soundtracks audible.
    for (const [media, state] of _nativeDirectOutputs) {
        _setDirectNativeAudioMuted(media, state.target === 0, false);
    }
});

// One listening-output owner for native playback, scrub grains and decoded
// replacement audio. Web Audio defines speaker downmixes for 1/2/4/6 channels,
// but treats 8 → 2 as discrete: only FL/FR survive. Browser-decoded 7.1 is
// FL FR FC LFE BL BR SL SR. Match WarpSonic's monitoring policy: center at
// -3 dB into both ears, each side/back pair shares the surround contribution,
// and LFE stays out of the stereo mix. Source PCM and analysis are untouched.
function _connectAudioOutput(source, destination, channels, slot) {
    return _connectMonitoredAudio(source, destination, channels, slot);
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
    if (!_nativeAudioRoutes.has(media) && _IS_WEBKIT_MEDIA && _nativeVideoVolumeWritable && media.tagName === 'VIDEO' &&
        [1, 2].includes(channels) && !_opusSyncSlots[media.dataset.slot] && !_slowPlayback.enabled) {
        if (!_nativeDirectOutputs.has(media)) {
            const level = media.muted ? 0 : 1;
            _nativeDirectOutputs.set(media, { level, target: level, timer: null });
            media.muted = false;
            _setMediaVolume(media);
        }
        return null;
    }
    if (_nativeAudioRoutes.has(media)) {
        const route = _nativeAudioRoutes.get(media);
        if (supported && route.channels !== channels) {
            route.output.disconnect();
            route.output = _connectAudioOutput(route.source, route.nativeGain || route.gain, channels, media.dataset.slot);
            route.channels = channels;
        }
        return route;
    }
    if (!supported) return null;
    const direct = _nativeDirectOutputs.get(media);
    if (direct) {
        if (direct.timer !== null) clearTimeout(direct.timer);
        _nativeDirectOutputs.delete(media);
        _setMediaVolume(media); // a newly verified surround layout needs the shared matrix
    }
    const ctx = getAudioContext();
    const gain = ctx.createGain();
    let source;
    try { source = ctx.createMediaElementSource(media); }
    catch (_) { return null; } // Keep direct browser playback if routing is unavailable.
    const level = direct?.level ?? (media.muted ? 0 : 1);
    _scheduleAudioGain(gain, level, level, ctx.currentTime);
    const nativeGain = _slowPlayback.enabled ? ctx.createGain() : null;
    if (nativeGain) {
        _scheduleAudioGain(nativeGain, 1, 1, ctx.currentTime);
        nativeGain.connect(gain);
    }
    const output = _connectAudioOutput(source, nativeGain || gain, channels, media.dataset.slot);
    gain.connect(ctx.destination);
    media.muted = !!_opusSyncSlots[media.dataset.slot];
    const resume = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    media.addEventListener('play', resume);
    const route = { source, gain, ctx, resume, output, channels, nativeGain };
    _nativeAudioRoutes.set(media, route);
    _slowPlayback.attach(media, route);
    if (!media.paused) resume();
    return route;
}

function _setNativeAudioMuted(media, muted, fade = false) {
    if (_nativeDirectOutputs.has(media)) {
        _setDirectNativeAudioMuted(media, muted, fade);
        return;
    }
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
    _slowPlayback.refresh();
}

function _clearNativeAudioRoutes() {
    for (const state of _nativeDirectOutputs.values()) {
        if (state.timer !== null) clearTimeout(state.timer);
    }
    _nativeDirectOutputs.clear();
    for (const [media, route] of _nativeAudioRoutes) {
        _slowPlayback.detach(media, route);
        media.removeEventListener('play', route.resume);
        route.output.disconnect();
        route.source.disconnect();
        route.gain.disconnect();
    }
    _nativeAudioRoutes.clear();
}
