// WarpDiff scrub adapter. Shared stream DSP/lifetime → scrub-audio-core.js.
// Scrub audio preview — plays short snippets with gain envelope to avoid clicks
let _scrubSource = null;
let _scrubGain = null;
let _scrubSourceBuffer = null;
let _scrubSourceOffset = 0;
let _scrubSourceStartCtx = 0;
let _scrubSourceRate = 1;
let _scrubSourceSnippetLen = 0;
let _scrubSourceFadeLen = 0;
let _scrubSourceLevel = 1;
let _scrubAudioClockId = 0;
let _scrubAudioTargetT = null;
let _scrubAudioPointerT = null;
let _scrubAudioMotionAt = -Infinity;
// One selected stream, not one full-clip worklet per loaded comparison asset.
let _scrubAudioMode = 'snippets'; // preference is read after the inline app initializes
let _continuousScrubCursor = null;
let _continuousScrubClick = false;
const _scrubMotionSamples = [];
let _scrubContinuousNotice = false;
const _continuousScrubEngine = WarpScrubAudio.create({
    workletUrl:'js/scrub-worklet.js',
    onError:() => {
        if (!_scrubContinuousNotice && _scrubAudioMode === 'continuous') {
            _scrubContinuousNotice = true;
            showLoadToast('Continuous scrub unavailable for this file — using snippets', true, 5000);
        }
    }
});
document.addEventListener('DOMContentLoaded', () => {
    _setScrubAudioMode(_prefs.load('scrubAudioMode', 'snippets'), false);
});

function _resetContinuousScrub() {
    _continuousScrubEngine.reset();
    _continuousScrubCursor = null;
    _continuousScrubClick = false;
    _scrubContinuousNotice = false;
}
function _prepareContinuousScrub() {
    if (_scrubAudioMode !== 'continuous') return Promise.resolve(false);
    const slot = currentAudioSource || assetOrder[currentAssetIndex];
    const buf = (_audioSlotVizData[slot] && _audioSlotVizData[slot].audioBuffer) || _videoAudioBuffers[slot];
    return buf ? _continuousScrubEngine.load(getAudioContext(), buf) : Promise.resolve(false);
}
function _setScrubAudioMode(mode, persist = true) {
    stopScrubSnippet();
    _resetContinuousScrub();
    _scrubAudioMode = mode === 'continuous' ? 'continuous' : 'snippets';
    if (persist) _prefs.save('scrubAudioMode', _scrubAudioMode);
    const button = document.getElementById('scrubModeBtn');
    if (button) {
        button.textContent = 'Scrub: ' + (_scrubAudioMode === 'continuous' ? 'Continuous' : 'Snippets');
        button.setAttribute('aria-pressed', String(_scrubAudioMode === 'continuous'));
        button.classList.toggle('active', _scrubAudioMode === 'continuous');
    }
    _prepareContinuousScrub();
}
function _playContinuousScrub(time) {
    const slot = currentAudioSource || assetOrder[currentAssetIndex];
    const buf = (_audioSlotVizData[slot] && _audioSlotVizData[slot].audioBuffer) || _videoAudioBuffers[slot];
    const engine = _continuousScrubEngine;
    if (!buf || isMuted || audioMuteStates[slot]) { engine.stop(); _continuousScrubCursor = null; return true; }
    const offset = time - (_audioTimelineStarts[slot] || 0);
    if (offset < 0 || offset >= buf.duration) { engine.stop(); _continuousScrubCursor = null; return true; }
    if (engine.state.buffer !== buf || !engine.state.node) {
        _prepareContinuousScrub();
        return false; // retain the existing snippet preview while warming/unavailable
    }
    const velocity = WarpScrubAudio.motionVelocity(_scrubMotionSamples);
    if (!velocity) {
        engine.stop(); _continuousScrubCursor = null;
        if (!_continuousScrubClick) { _continuousScrubClick = true; playScrubSnippet(time); }
        return true;
    }
    _continuousScrubClick = true;
    const ctx = getAudioContext(), at = ctx.currentTime, direction = velocity < 0 ? -1 : 1;
    const pointerOffset = (_scrubAudioPointerT === null ? time : _scrubAudioPointerT) - (_audioTimelineStarts[slot] || 0);
    const continuous = WarpScrubAudio.continuous(_continuousScrubCursor, pointerOffset, at, direction, offset);
    const requestedTempo = WarpScrubAudio.grainTempo(velocity);
    const tempo = continuous ? WarpScrubAudio.streamTempo(_continuousScrubCursor, offset, at, direction, requestedTempo) : requestedTempo;
    // A single video follows the last confirmed picture. Grid and audio-only
    // retain WarpDiff's shared pointer clock, avoiding competing decoder owners.
    const followsPicture = !_scrubAudioUsesPointerClock();
    const node = engine.update({offset, tempo, direction, continuous,
        limitOffset:followsPicture ? offset : null, level:_scrubOutputGain(_prefs.load('volume', 100))});
    if (!node) return false;
    _stopScrubAudioNodes(); // retire any warm-up/click snippet
    const prior = _continuousScrubCursor;
    const carried = continuous && prior ? prior.offset + prior.direction * prior.rate * Math.max(0, at - prior.at) : offset;
    _continuousScrubCursor = {offset:followsPicture ? direction > 0 ? Math.min(carried, offset) : Math.max(carried, offset) : carried,
        targetOffset:offset, pointerOffset, at, rate:tempo, direction};
    return true;
}
const _SCRUB_OUTPUT_LEN = 0.09;   // 90ms at every playback rate (source span scales with rate)
const _SCRUB_FADE = 0.01;         // 10ms fade in/out
const _SCRUB_AUDIO_CLOCK_MS = 50; // steady cadence, independent of pointer/decoder event bursts
const _SCRUB_AUDIO_IDLE_MS = 130; // stop after the pointer/presentation clock holds still
const _SCRUB_PHASE_SEARCH = 0.008; // max ±8ms target adjustment (< 1/5 frame at 24fps)

function _scrubOutputGain(volumePercent) {
    const value = Number(volumePercent);
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value / 100));
}

function _scrubGrainLengths(rate, sourceRemaining) {
    const safeRate = Math.max(0.01, Number(rate) || 1);
    const source = Math.min(_SCRUB_OUTPUT_LEN * safeRate, Math.max(0, sourceRemaining));
    return { source, output: source / safeRate };
}

function _scrubEnvelopeGain(elapsed, snippetLen, fadeLen) {
    if (elapsed <= 0 || snippetLen <= 0) return 0;
    if (fadeLen > 0 && elapsed < fadeLen) return elapsed / fadeLen;
    if (elapsed <= snippetLen - fadeLen) return 1;
    if (fadeLen > 0 && elapsed < snippetLen) return (snippetLen - elapsed) / fadeLen;
    return 0;
}

function _holdScrubGain(ctx) {
    if (!_scrubGain) return;
    const elapsed = Math.max(0, ctx.currentTime - _scrubSourceStartCtx);
    const held = _scrubEnvelopeGain(elapsed, _scrubSourceSnippetLen, _scrubSourceFadeLen) * _scrubSourceLevel;
    _scrubGain.gain.cancelScheduledValues(ctx.currentTime);
    _scrubGain.gain.setValueAtTime(held, ctx.currentTime);
}

// Align a new grain to the outgoing grain's waveform phase within a
// tightly bounded neighbourhood of the requested timeline position.
// Unaligned overlap can null a steady CENTER tone (or hollow speech)
// when the two grains happen to begin on opposite waveform phases.
function _phaseAlignScrubOffset(buf, desiredOffset, priorOffset, rate) {
    const sr = buf && buf.sampleRate;
    const channels = buf && buf.numberOfChannels;
    if (!sr || !channels || !buf.length) return desiredOffset;
    const step = Math.max(0.125, rate || 1);
    const windowFrames = Math.max(16, Math.round(0.004 * sr / step));
    const searchFrames = Math.max(1, Math.round(_SCRUB_PHASE_SEARCH * sr));
    const priorFrame = Math.round(priorOffset * sr);
    const desiredFrame = Math.round(desiredOffset * sr);
    if (priorFrame < 0 || priorFrame + Math.round(windowFrames * step) >= buf.length) return desiredOffset;
    const channelData = [];
    for (let c = 0; c < channels; c++) channelData.push(buf.getChannelData(c));
    const scoreAt = (candidateFrame) => {
        if (candidateFrame < 0 || candidateFrame + Math.round(windowFrames * step) >= buf.length) return -Infinity;
        let cross = 0, oldEnergy = 0, newEnergy = 0;
        for (let i = 0; i < windowFrames; i++) {
            const advance = Math.round(i * step);
            for (let c = 0; c < channels; c++) {
                const oldSample = channelData[c][priorFrame + advance];
                const newSample = channelData[c][candidateFrame + advance];
                cross += oldSample * newSample;
                oldEnergy += oldSample * oldSample;
                newEnergy += newSample * newSample;
            }
        }
        if (oldEnergy < 1e-8 || newEnergy < 1e-8) return -Infinity;
        return cross / Math.sqrt(oldEnergy * newEnergy);
    };
    const directScore = scoreAt(desiredFrame);
    let bestFrame = desiredFrame;
    let bestScore = directScore;
    for (let delta = -searchFrames; delta <= searchFrames; delta++) {
        const score = scoreAt(desiredFrame + delta) - Math.abs(delta) / searchFrames * 0.002;
        if (score > bestScore) { bestScore = score; bestFrame = desiredFrame + delta; }
    }
    // Do not slide arbitrary/noisy jumps for a marginal correlation win.
    if (bestScore < 0.35 || bestScore < directScore + 0.08) return desiredOffset;
    return bestFrame / sr;
}

function playScrubSnippet(time) {
    const ctx = getAudioContext();
    // Scrub audio has exactly one owner: the explicitly selected slot.
    // Grid may decode/paint three videos, but it never creates preview
    // audio for the two unselected slots.
    const slot = currentAudioSource || assetOrder[currentAssetIndex];
    if (isMuted || audioMuteStates[slot]) return; // respect global + per-slot mute (Web Audio bypasses video.muted)
    const vizData = _audioSlotVizData[slot];
    const buf = (vizData && vizData.audioBuffer) || _videoAudioBuffers[slot];
    if (!buf) return;
    let offset = _audioBufferTimeForTimeline(time, _audioTimelineStarts[slot] || 0);
    // Silence is part of the timeline. In particular, a leading empty
    // MP4 edit must not clamp to sample zero and repeat the first sound.
    if (offset < 0 || offset >= buf.duration) {
        _stopScrubAudioNodes();
        return;
    }
    const rate = PLAYBACK_RATES[playbackRateIndex] || 1;
    if (_scrubSource && _scrubSourceBuffer === buf) {
        const priorOffset = _scrubSourceOffset +
            Math.max(0, ctx.currentTime - _scrubSourceStartCtx) * _scrubSourceRate;
        offset = _phaseAlignScrubOffset(buf, offset, priorOffset, rate);
    }
    // Hold the OUTPUT grain length steady. The old fixed source span
    // shrank to 40ms at 2×, shorter than its 50ms scheduling interval,
    // which guaranteed gaps even with perfectly regular callbacks.
    const grainLengths = _scrubGrainLengths(rate, buf.duration - offset);
    const snippetLen = grainLengths.source;
    const outputSnippetLen = grainLengths.output;
    const fadeLen = Math.min(_SCRUB_FADE, outputSnippetLen / 2);
    const outputLevel = _scrubOutputGain(_prefs.load('volume', 100));

    // Fade out previous snippet smoothly
    if (_scrubGain) {
        _holdScrubGain(ctx);
        _scrubGain.gain.linearRampToValueAtTime(0, ctx.currentTime + _SCRUB_FADE);
    }
    if (_scrubSource) {
        const old = _scrubSource;
        setTimeout(() => { try { old.stop(); } catch (_) {} }, _SCRUB_FADE * 1000 + 10);
    }

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // Fade in
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(outputLevel, ctx.currentTime + fadeLen);
    // Fade out before end
    gain.gain.setValueAtTime(outputLevel, ctx.currentTime + outputSnippetLen - fadeLen);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + outputSnippetLen);

    const source = ctx.createBufferSource();
    source.buffer = buf;
    // Match the current playback rate so the scrub preview sounds like the
    // user's selected speed rather than always playing at 1×.
    source.playbackRate.value = rate;
    const output = _connectAudioOutput(source, gain, buf.numberOfChannels);
    source.start(0, offset, snippetLen);
    _scrubSource = source;
    _scrubGain = gain;
    _scrubSourceBuffer = buf;
    _scrubSourceOffset = offset;
    _scrubSourceStartCtx = ctx.currentTime;
    _scrubSourceRate = rate;
    _scrubSourceSnippetLen = outputSnippetLen;
    _scrubSourceFadeLen = fadeLen;
    _scrubSourceLevel = outputLevel;
    source.onended = () => {
        output.disconnect();
        gain.disconnect();
        if (_scrubSource === source) {
            _scrubSource = null; _scrubGain = null; _scrubSourceBuffer = null;
            _scrubSourceLevel = 1;
        }
    };
}

// Pointer activity keeps audition alive; presentation chooses its audio
// position. A slow drag can hold one frame for hundreds of milliseconds.
// Renew overlapping grains even at that same PTS, or a 90ms grain ends
// long before the next frame. Late decoder callbacks cannot extend a
// stopped gesture, and repeated motion beyond a timeline edge is idle.
function _scrubAudioTick() {
    _scrubAudioClockId = 0;
    if (!isDragging || _scrubAudioTargetT === null) {
        _stopScrubAudioNodes();
        _continuousScrubEngine.stop();
        _continuousScrubCursor = null;
        return;
    }
    const recent = performance.now() - _scrubAudioMotionAt < _SCRUB_AUDIO_IDLE_MS;
    if (!recent) {
        _stopScrubAudioNodes();
        _continuousScrubEngine.stop();
        _continuousScrubCursor = null;
        return;
    }
    if (_scrubAudioMode !== 'continuous' || !_playContinuousScrub(_scrubAudioTargetT)) playScrubSnippet(_scrubAudioTargetT);
    _scrubAudioClockId = setTimeout(_scrubAudioTick, _SCRUB_AUDIO_CLOCK_MS);
}

function _feedScrubAudioMotion(time, atBoundary) {
    if (!isDragging || !Number.isFinite(time)) return;
    const at = performance.now();
    _scrubMotionSamples.push({time, at});
    while (_scrubMotionSamples.length > 2 && at - _scrubMotionSamples[0].at > WarpScrubAudio.tuning.motionWindow) _scrubMotionSamples.shift();
    if (!atBoundary || time !== _scrubAudioPointerT) _scrubAudioMotionAt = performance.now();
    _scrubAudioPointerT = time;
    // Fractional pointer motion can round to the same interior time;
    // it still counts as activity. At an edge, repeated clamped targets
    // must fade instead of endlessly replaying the first/last sound.
    if (_scrubAudioUsesPointerClock()) _feedScrubAudio(time);
    else if (!_scrubAudioClockId && _scrubAudioTargetT !== null) _scrubAudioTick();
}

function _feedScrubAudio(time) {
    if (!Number.isFinite(time)) return;
    _scrubAudioTargetT = time;
    if (!_scrubAudioClockId) _scrubAudioTick();
}

// Resume inside the trusted pointer event. Calling resume only when the
// first asynchronous frame/seek completes is too late on browsers that
// enforce user-gesture activation for Web Audio.
function _primeScrubAudioContext() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    _prepareContinuousScrub();
}

function _stopScrubAudioNodes() {
    const ctx = getAudioContext();
    if (_scrubGain) {
        _holdScrubGain(ctx);
        _scrubGain.gain.linearRampToValueAtTime(0, ctx.currentTime + _SCRUB_FADE);
    }
    if (_scrubSource) {
        const old = _scrubSource;
        setTimeout(() => { try { old.stop(); } catch (_) {} }, _SCRUB_FADE * 1000 + 10);
        _scrubSource = null;
        _scrubGain = null;
        _scrubSourceBuffer = null;
        _scrubSourceLevel = 1;
    }
}

function stopScrubSnippet() {
    if (_scrubAudioClockId) clearTimeout(_scrubAudioClockId);
    _scrubAudioClockId = 0;
    _scrubAudioTargetT = null;
    _scrubAudioPointerT = null;
    _scrubAudioMotionAt = -Infinity;
    _scrubMotionSamples.length = 0;
    _continuousScrubClick = false;
    _continuousScrubEngine.stop();
    _continuousScrubCursor = null;
    _stopScrubAudioNodes();
}
