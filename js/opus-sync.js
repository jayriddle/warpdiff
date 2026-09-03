// Chrome Opus A/V sync correction — extracted from index.html.
// Chrome misapplies Opus pre-skip / MP4 edit list, causing audio to lag video.
// For affected slots we mute the <video> native audio and play the decoded
// AudioBuffer via Web Audio with correct timing. STATEFUL: owns the _opusSync*
// per-slot maps (reset/reassigned by index.html's clearAllMedia) and reads app
// globals (getLayer, assetOrder, currentAudioSource, audioMuteStates, isMuted,
// _prefs, _videoAudioBuffers, getAudioContext) — all resolve via the shared
// global scope of classic <script>s, same pattern as js/transport.js.
// INVARIANT — deferred-start window: see CLAUDE.md "Opus / Chrome Web Audio
// sync replacement"; every consumer of the per-slot state must handle
// _opusSyncStartCtx[slot] > ctx.currentTime. Regression tests:
// tests/warpdiff.spec.ts "Opus deferred-start window" + tests/ownership.test.mjs.

// Chrome misapplies Opus pre-skip / MP4 edit list, causing audio to lag
// video. For affected slots, we mute the <video> native audio and play
// the decoded AudioBuffer via Web Audio API with correct timing.
const _isChrome = /Chrome\//.test(navigator.userAgent) && !/Edge|Edg/.test(navigator.userAgent);
let _opusSyncPending = {};     // { slot: true } — slots that went through WebCodecs (Opus)
let _opusSyncSlots = {};       // { slot: true } — slots needing Web Audio replacement
let _opusSyncDuration = {};    // { slot: number } — corrected duration from decoded buffer
let _opusSyncSources = {};     // { slot: AudioBufferSourceNode }
let _opusSyncGains = {};       // { slot: GainNode }
let _opusSyncStartCtx = {};    // { slot: number } — scheduled source.start() time (up to _OPUS_FADE in the future during the deferred-start window)
let _opusSyncStartVideo = {};  // { slot: number } — video.currentTime used as offset
let _opusSyncRate = {};        // { slot: number } — playbackRate the source was started at
let _opusSyncFadeUntil = {};   // { slot: number } — ctx time until which the previous source's fade-out is audible
let _opusSyncActive = false;

const _OPUS_FADE = 0.015; // 15ms fade to avoid clicks on start/stop

function _startOpusSyncAudio(slot, fromTime) {
    if (!getTransportSlots().includes(slot)) {
        _stopOpusSyncAudio(slot);
        return;
    }
    const ctx = getAudioContext();
    _stopOpusSyncAudio(slot);
    const buf = _videoAudioBuffers[slot];
    if (!buf) return;
    if (ctx.state === 'suspended') ctx.resume();
    const layer = getLayer(slot);
    const video = layer && layer.querySelector('video');
    const rate = (video && video.playbackRate) || 1;
    // Begin only once any previous fade-out has gone silent — overlapping
    // the two creates a linear crossfade between uncorrelated audio chunks
    // (different points in the buffer), which sums to audible phase
    // artifacts especially on loud sections at loop wraps. Brief silence
    // is preferable to a click. _stopOpusSyncAudio stamps _opusSyncFadeUntil
    // whenever it fades an audible source, so this covers external
    // stop→start sequences (e.g. pause→play) as well as replacement, and
    // collapses to "now" when nothing is fading.
    let startTime = Math.max(ctx.currentTime, _opusSyncFadeUntil[slot] || 0);
    const timelineStart = _audioTimelineStarts[slot] || 0;
    let startVideoTime = fromTime + (startTime - ctx.currentTime) * rate;
    let offset = _audioBufferTimeForTimeline(startVideoTime, timelineStart);
    // A leading empty MP4 edit means the video timeline begins before the first
    // audio sample. Schedule the source for that future timeline point instead
    // of clamping to sample zero and playing the audio early.
    if (offset < 0) {
        startTime += (-offset) / rate;
        startVideoTime = timelineStart;
        offset = 0;
    }
    // The video may legitimately continue after the audio edit ends.
    if (offset >= buf.duration) return;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const isCurrent = slot === (currentAudioSource || assetOrder[currentAssetIndex]);
    const vol = isCurrent && !audioMuteStates[slot]
        ? (_prefs.load('volume', 100) / 100) : 0;
    // Fade in from 0 to vol over _OPUS_FADE, starting at startTime
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + _OPUS_FADE);
    source.buffer = buf;
    // Match the video element's playback rate so audio runs in sync at non-1× speeds
    source.playbackRate.value = rate;
    source.connect(gain);
    gain.connect(ctx.destination);
    // The source begins at startTime, not now — the video keeps advancing
    // through the gap, so start the buffer at the sample that will be
    // current then. Starting at fromTime's sample would play it late and
    // bake a permanent (startTime − now)·rate lag into the drift anchors,
    // which are self-consistent with the audio and never correct it.
    source.start(startTime, offset);
    _opusSyncSources[slot] = source;
    _opusSyncGains[slot] = gain;
    // Anchor drift math at the actual start moment — _syncOpusAudioToVideo
    // computes expectedVideoTime = startVideo + (ctx.currentTime - startCtx) * rate.
    _opusSyncStartCtx[slot] = startTime;
    _opusSyncStartVideo[slot] = startVideoTime;
    _opusSyncRate[slot] = rate;
    source.onended = () => {
        if (_opusSyncSources[slot] === source) {
            _opusSyncSources[slot] = null;
            _opusSyncGains[slot] = null;
        }
    };
}

function _stopOpusSyncAudio(slot) {
    const source = _opusSyncSources[slot];
    const gain = _opusSyncGains[slot];
    if (source) {
        const ctx = getAudioContext();
        if (gain && _opusSyncStartCtx[slot] > ctx.currentTime) {
            // Source is scheduled but hasn't started (deferred-start window).
            // All its gain automation is in the future, so gain.gain.value
            // still reads the GainNode default 1.0 — a value-anchored fade
            // here would let the source start un-faded at near-full volume
            // for the few ms until the delayed stop(). Nothing is audible
            // yet, so cancel the scheduled start outright instead.
            gain.gain.cancelScheduledValues(0);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            try { source.stop(); } catch (_) {}
        } else if (gain) {
            // Fade out then stop to avoid click
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + _OPUS_FADE);
            // Tell the next _startOpusSyncAudio when this fade goes silent.
            // Pending cancels (branch above) and natural ends produce no
            // fade, so they leave the stamp alone.
            _opusSyncFadeUntil[slot] = ctx.currentTime + _OPUS_FADE;
            const s = source;
            setTimeout(() => { try { s.stop(); } catch (_) {} }, _OPUS_FADE * 1000 + 5);
        } else {
            try { source.stop(); } catch (_) {}
        }
        _opusSyncSources[slot] = null;
        _opusSyncGains[slot] = null;
    }
}

function _stopAllOpusSyncAudio() {
    for (const slot of assetOrder) _stopOpusSyncAudio(slot);
}

function _syncOpusAudioToVideo() {
    if (!_opusSyncActive) return;
    for (const slot of getTransportSlots()) {
        if (!_opusSyncSlots[slot] || !_opusSyncSources[slot]) continue;
        const layer = getLayer(slot);
        const video = layer && layer.querySelector('video');
        if (!video || video.paused) continue;
        const ctx = getAudioContext();
        const rate = _opusSyncRate[slot] || 1;
        const elapsed = ctx.currentTime - _opusSyncStartCtx[slot];
        // Skip drift correction during the deferred-start window — `elapsed`
        // is negative until the new source actually starts playing, and
        // `video.currentTime` can briefly outpace the expected playback by
        // up to _OPUS_FADE worth of real time, producing false drift readings
        // that retrigger restarts and stack 15 ms gaps end-to-end (audible).
        if (elapsed < 0) continue;
        const expectedVideoTime = _opusSyncStartVideo[slot] + elapsed * rate;
        // Restart if the video's playback rate has changed (audio source can't
        // change rate mid-stream without an audible glitch — restart gets us a
        // fresh source running at the new rate) or if drift is significant.
        if (Math.abs(rate - video.playbackRate) > 0.001 ||
            Math.abs(video.currentTime - expectedVideoTime) > 0.15) {
            _startOpusSyncAudio(slot, video.currentTime);
        }
    }
}

function _updateOpusSyncRate(rate) {
    if (!_opusSyncActive) return;
    const ctx = getAudioContext();
    for (const slot of getTransportSlots()) {
        const src = _opusSyncSources[slot];
        if (!src) continue;
        // Re-anchor timeline at the new rate so drift math stays correct.
        // Skip re-anchoring during the deferred-start window (elapsed < 0):
        // the anchors already describe the scheduled start, and adding the
        // negative elapsed would drag startVideo backward and detach
        // startCtx from the moment the source actually begins. The rate
        // assignment below still takes effect when the source starts.
        const elapsed = ctx.currentTime - _opusSyncStartCtx[slot];
        const timelineStart = _audioTimelineStarts[slot] || 0;
        const layer = getLayer(slot);
        const video = layer && layer.querySelector('video');
        if (elapsed < 0 && timelineStart > 0 && video && video.currentTime < timelineStart) {
            // This is a potentially long wait for intentional leading silence,
            // not merely the 15 ms anti-click fade. Playback-rate changes alter
            // when the video reaches timelineStart, so cancel and reschedule.
            _startOpusSyncAudio(slot, video.currentTime);
            continue;
        }
        if (elapsed >= 0) {
            const oldRate = _opusSyncRate[slot] || 1;
            _opusSyncStartVideo[slot] = _opusSyncStartVideo[slot] + elapsed * oldRate;
            _opusSyncStartCtx[slot] = ctx.currentTime;
        }
        src.playbackRate.value = rate;
        _opusSyncRate[slot] = rate;
    }
}

function _updateOpusSyncGains() {
    if (!_opusSyncActive) return;
    const vol = _prefs.load('volume', 100) / 100;
    const ctx = getAudioContext();
    const participants = new Set(getTransportSlots());
    for (const slot of assetOrder) {
        const g = _opusSyncGains[slot];
        if (!g) continue;
        const isCurrent = slot === (currentAudioSource || assetOrder[currentAssetIndex]);
        const target = (participants.has(slot) && !isMuted && isCurrent && !audioMuteStates[slot]) ? vol : 0;
        const startTime = _opusSyncStartCtx[slot];
        if (startTime > ctx.currentTime) {
            // The slot's fade-in is still scheduled in the future
            // (deferred-start window). A bare .value write would be
            // overridden when that automation fires — a just-muted slot
            // would ramp back up to the stale volume. Re-schedule the
            // fade-in toward the new target instead.
            g.gain.cancelScheduledValues(0);
            g.gain.setValueAtTime(0, startTime);
            g.gain.linearRampToValueAtTime(target, startTime + _OPUS_FADE);
        } else {
            g.gain.value = target;
        }
    }
}
