// Media transport / playback ownership — extracted from index.html.
// Play/pause/restart, frame stepping, A/V sync, frame-accurate loop enforcement,
// multi-video sync-lock (_getLoopBounds/_applyNativeLoopPolicy/_driftLockTick),
// and video/audio handler binding. STATEFUL: reads/writes app globals (mediaData,
// _bulkSyncActive, primaryVideoRef, _loopInPoint/_loopOutPoint, currentAudioSource,
// _opusSync*, …) and calls the opus-sync engine + progress loop that remain in
// index.html — all resolve via the shared global scope of classic <script>s.
// Holds the single-owner targets for audit findings A (_startLoopRvfc), B
// (setupVideoHandlers), D (_startOpusSyncForPlayingSlots / playAllMedia /
// restartAllVideos) and the sync-lock owners H (_applyNativeLoopPolicy is the
// sole .loop writer, _driftLockTick the sole follower-rate writer); see
// tests/ownership.test.mjs.

function syncVideos(sourceVideo, action) {
    document.querySelectorAll('video').forEach(v => {
        if (v !== sourceVideo) action(v);
    });
}

function syncMedia(source, action) {
    const tag = hasAudios ? '.asset-layer audio' : 'video';
    document.querySelectorAll(tag).forEach(el => {
        if (el !== source) action(el);
    });
}

function _startOpusSyncForPlayingSlots(timeForSlot) {
    if (!_opusSyncActive) return;
    for (const slot of assetOrder) {
        if (!_opusSyncSlots[slot]) continue;
        const layer = getLayer(slot);
        const video = layer && layer.querySelector('video');
        if (video) _startOpusSyncAudio(slot, timeForSlot(video));
    }
}

// Effective loop region — the single source of truth for "where does playback
// wrap". Custom in/out points win; otherwise, with 2+ videos loaded, all videos
// loop TOGETHER over [0, shortest effective duration] so they stay sync-locked
// across wraps (native per-element .loop wraps each video independently at its
// own duration, compounding desync every pass). Single video, audio mode, or
// metadata-not-ready → null (plain native looping).
function _getLoopBounds() {
    if (_loopInPoint !== null && _loopOutPoint !== null)
        return { inP: _loopInPoint, outP: _loopOutPoint };
    if (hasAudios) return null;
    const videos = getAllVideos();
    if (videos.length < 2) return null;
    // Default range (no custom points) depends on _loopRangeMode:
    //   'sync' → wrap at the SHORTEST clip, so every frame has a counterpart to
    //            compare (frame-locked A/B — the default).
    //   'full' → wrap at the LONGEST clip, so each clip can be reviewed in full;
    //            shorter clips freeze on their last frame during the tail and
    //            everyone re-wraps together when all have ended.
    let minDur = Infinity, maxDur = 0;
    for (const v of videos) {
        const d = _getEffectiveDuration(v);
        if (!d || !isFinite(d)) return null;
        if (d < minDur) minDur = d;
        if (d > maxDur) maxDur = d;
    }
    return { inP: 0, outP: _loopRangeMode === 'full' ? maxDur : minDur };
}

// Single owner of the native .loop flag: native looping only when no managed
// loop region is active — otherwise the native restart-at-0 fights the
// synchronized wrap seek-back. Everyone (marker set/clear, asset switch,
// metadata load, play) routes through here instead of writing .loop directly.
function _applyNativeLoopPolicy() {
    const native = _getLoopBounds() === null;
    getAllPlayableMedia().forEach(m => { m.loop = native; });
}

function playAllMedia() {
    _bulkSyncActive = true;
    // Suspend retained scrub sessions before playback: idle-but-configured
    // VideoDecoders hold hardware pipelines and starve 2–3 playing <video>
    // elements (chunky frames). Suspend (not close) keeps the demuxed samples
    // and frame cache so the next drag resumes in ~ms instead of refetching
    // and re-demuxing the whole file. Skip mid-drag (the overlay is using
    // them). See index.html.
    if (!isDragging) _suspendScrubSessions();
    _applyNativeLoopPolicy();
    getAllPlayableMedia().forEach(m => { m.play().catch(() => {}); });
    _startOpusSyncForPlayingSlots(v => v.currentTime);
    startProgressUpdateLoop();
    _updatePlayPauseBtn(true);
    // First-play muted nudge (index.html) — once per session, if muted + audible.
    if (typeof _maybeMutedNudge === 'function') _maybeMutedNudge();
    setTimeout(() => { _bulkSyncActive = false; }, 50);
}

function pauseAllMedia() {
    _bulkSyncActive = true;
    getAllPlayableMedia().forEach(m => m.pause());
    _snapAllVideosToFrame();
    _stopAllOpusSyncAudio();
    _updatePlayPauseBtn(false);
    // Release async, like playAllMedia/restartAllVideos: 'pause' events fire as
    // queued tasks, so a synchronous reset lets the per-element pause handlers
    // run with the guard already cleared and cascade needlessly.
    setTimeout(() => { _bulkSyncActive = false; }, 50);
}

// Single owner of "which clip is the sync reference" for the PAUSED alignment
// paths (pause snap + frame stepping): the selected/active clip. It's the one
// the user is watching, and the only one guaranteed to sit on its own frame, so
// every other clip is aligned TO it rather than the group averaging toward a
// clip nobody is looking at. Falls back to the active layer's video, then the
// first video, when primaryVideoRef is stale (asset switch, replaced element).
function _syncReferenceVideo(videos) {
    let ref = primaryVideoRef;
    if (!ref || ref.isConnected === false || !videos.includes(ref)) {
        const activeSlot = (typeof currentAudioSource !== 'undefined' && currentAudioSource) || assetOrder[currentAssetIndex];
        const activeLayer = getLayer(activeSlot);
        ref = (activeLayer && activeLayer.querySelector('video')) || videos[0];
    }
    return ref || null;
}

// Snap every video onto its own frame grid at the REFERENCE clip's paused
// instant, so a spacebar-stop always lands all synced videos on "the same
// frame" — not just within the drift lock's tolerance. The drift lock holds
// followers within half a frame (Stack, hidden) or ~5ms (Grid, converged
// nudge), which is normally imperceptible, but a clip a few ms off can straddle
// a frame boundary and round to frame N vs N+1 at the exact instant pause()
// lands. Reference is the primary (playing) clip's currentTime, NOT its frame
// NUMBER — clips can have different fps, so each follower is quantized to its
// OWN frame grid at that shared point in time (mirrors stepFrame's midpoint-
// seek math). No-op for audio mode or fewer than 2 videos.
function _snapAllVideosToFrame() {
    if (hasAudios) return;
    // Scrub owns position during a drag: the scrub-start pause (mousedown while
    // playing calls pauseAllMedia) must not fire a competing seek per video an
    // instant before the drag's own first seek lands.
    if (isDragging) return;
    const videos = getAllVideos();
    if (videos.length < 2) return;
    const ref = _syncReferenceVideo(videos);
    if (!ref || isNaN(ref.duration)) return;
    const refTime = ref.currentTime;
    for (const v of videos) {
        if (isNaN(v.duration)) continue;
        const fps = videoFrameRates[v.src] || 30;
        // Leave a follower that's within the drift lock's own tolerance (half a
        // frame) exactly where it froze. It may sit on an ADJACENT frame number to
        // the reference — a sub-half-frame clock difference straddling a boundary —
        // but seeking it onto the reference's frame makes the just-paused, on-screen
        // follower visibly HOP a frame to catch up while the reference (never
        // seeked) stays solid: the asymmetric "B stutters on almost every Grid
        // pause" report. The clips are already as aligned as they were all through
        // playback — the lock never held them tighter than this — so a seek buys a
        // frame of precision at the cost of a visible jump, which reads as a bug.
        // Only snap a follower that's genuinely MORE than half a frame off: an
        // unconverged state (paused right after play/seek/loop-wrap, before the lock
        // caught up), where a visible correction is expected anyway.
        if (Math.abs(v.currentTime - refTime) <= 0.5 / fps) continue;
        const frame = Math.floor(refTime * fps + 0.01);
        v.currentTime = Math.min(Math.max((frame + 0.5) / fps, 0), v.duration - 0.001);
    }
}

function setupAudioHandlers(audio, slot) {
    audio.addEventListener('play', function() {
        if (isDragging || _bulkSyncActive) return;
        syncMedia(audio, a => {
            a.play().catch(() => {});
            if (Math.abs(a.currentTime - audio.currentTime) > 0.1) {
                a.currentTime = audio.currentTime;
            }
        });
        startProgressUpdateLoop();
    });

    audio.addEventListener('pause', function() {
        if (isDragging || _bulkSyncActive) return;
        syncMedia(audio, a => { if (!a.paused) a.pause(); });
    });

    audio.addEventListener('seeked', function() {
        if (isDragging || _bulkSyncActive) return;
        updateMediaProgress(audio);
    });
}

let _loopWrapTimer = null;   // pending exact-out-point wrap (scheduled in onFrame)
function _cancelLoopWrapTimer() {
    if (_loopWrapTimer !== null) { clearTimeout(_loopWrapTimer); _loopWrapTimer = null; }
}
function _loopWrapToInPoint() {
    const bounds = _getLoopBounds();
    if (bounds === null) return;
    // Suppress the per-element play/pause sync handlers + drift lock while every
    // element is seeked back, same as the 'ended' wrap: if any element ended a
    // hair early (unequal-duration sync loop), the seek can surface a pause/play
    // the handlers would otherwise cascade against a mid-wrap clock.
    _cancelLoopWrapTimer();
    _bulkSyncActive = true;
    // seek AND play: in Full mode the shorter clips are frozen (ended/paused) on
    // their last frame during the tail, so they must be resumed, not just seeked.
    // In Sync mode every clip is already playing, so play() is a harmless no-op.
    getAllPlayableMedia().forEach(m => { m.currentTime = bounds.inP; m.play().catch(() => {}); });
    if (_opusSyncActive) {
        for (const s of assetOrder) {
            if (_opusSyncSlots[s]) _startOpusSyncAudio(s, bounds.inP);
        }
    }
    setTimeout(() => { _bulkSyncActive = false; }, 50);
}
function _startLoopRvfc(video) {
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    if (video.paused || video.ended) return;
    if (_getLoopBounds() === null) return;
    // Single-owner guard: at most one RVFC chain per video. Without it a
    // pause→play cycle leaves the dormant chain registered (RVFC doesn't
    // fire while paused, but the callback survives) AND the 'play' handler
    // starts a fresh one — accumulating parallel seek-back chains that all
    // fire at the out-point, producing the loop-wrap stutter/audio glitch.
    if (video._loopRvfcActive) return;
    video._loopRvfcActive = true;

    function onFrame(now, metadata) {
        // Any of these ends this chain — release ownership so a later
        // _startLoopRvfc can start a clean one. Cancel any pending wrap too.
        // (Runs in Stack AND Grid mode — the chain lives on the primary video
        // and the wrap seeks every video, which is mode-independent.)
        const bounds = _getLoopBounds();
        if (video.paused || video.ended ||
            bounds === null ||                                   // loop region gone
            video !== primaryVideoRef) {                        // no longer primary
            _cancelLoopWrapTimer();
            video._loopRvfcActive = false;
            return;
        }
        if (isDragging) { video.requestVideoFrameCallback(onFrame); return; }

        const t = metadata.mediaTime;
        if (t >= bounds.outP || t < bounds.inP - 0.05) {
            // Safety net: a frame at/past the out-point was already presented
            // (long seek landing, stall, or a cancelled schedule below).
            _cancelLoopWrapTimer();
            _loopWrapToInPoint();
        } else {
            // mediaTime is quantized to the frame grid, so waiting for a frame
            // PAST the out-point lets up to a full frame of AUDIO (~42ms at
            // 24fps, plus seek latency) play beyond the boundary — audibly.
            // Instead, when the LAST in-region frame presents, schedule the
            // wrap for the exact out-point time.
            const frameDur = 1 / (videoFrameRates[video.src] || 30);
            if (t >= bounds.outP - frameDur * 1.25 && _loopWrapTimer === null) {
                const rate = video.playbackRate || 1;
                const delayMs = Math.max(0, ((bounds.outP - t) / rate) * 1000 - 2);
                _loopWrapTimer = setTimeout(() => {
                    _loopWrapTimer = null;
                    // Re-validate: the loop may have been cleared, playback paused,
                    // or the user may have seeked back since this was scheduled.
                    // A video that ENDED is not a user pause — when the out-point
                    // sits at the video's natural end (the sync-loop case) the
                    // element can end a hair before this fires; wrapping here is
                    // exactly right (the 'ended' handler remains as the backstop).
                    const b = _getLoopBounds();
                    if (b === null) return;
                    if ((video.paused && !video.ended) || isDragging) return;
                    if (video.currentTime < b.outP - frameDur * 1.5) return;
                    _loopWrapToInPoint();
                }, delayMs);
            }
        }
        // Always re-register: RVFC fires when the next frame is presented
        // (after seek or buffering stall) — there's no need for a 'playing'
        // fallback, and registering both creates duplicate parallel chains.
        video.requestVideoFrameCallback(onFrame);
    }
    video.requestVideoFrameCallback(onFrame);
}

// ── Video-to-video drift lock ─────────────────────────────────────────────
// Two free-running <video> elements drift (independent clocks, per-element
// frame drops); the browser gives no lockstep guarantee. The primary is the
// clock master and is never touched; followers converge onto it:
//   - Stack mode: followers are display:none (CSS hides non-active wrappers),
//     so a direct seek is invisible — hard-resync whenever they're more than
//     half a frame out.
//   - Grid mode: followers are on screen, and a mid-playback seek stutters
//     visibly — trim playbackRate by ±_DRIFT_NUDGE instead (inaudible: every
//     non-active slot is muted by selectAudioSource) and seek only past
//     _DRIFT_HARD_SEEK. The nudged rate is re-asserted every tick so a J/K
//     rate change mid-episode can't strand the follower at the base rate.
// Called from updateLoop (startProgressUpdateLoop) every rAF while playing.
const _DRIFT_HARD_SEEK = 0.15; // s — beyond this, always seek (missed wrap, stall).
                               // Deliberately the ONLY seek threshold in BOTH modes:
                               // a 40ms hidden-seek tier was tried (v3.11.9 dev) and
                               // measurably WORSENED steady-state sync (14 seeks/3s,
                               // mean drift −11ms vs 1 seek, +2ms nudge-only) — seek
                               // latency jitter keeps re-triggering around a low bar.
const _DRIFT_RELEASE = 0.005;  // s — nudge ends once drift is inside this
const _DRIFT_NUDGE = 0.02;     // ±2% rate trim (imperceptible on VISIBLE muted video)
const _DRIFT_NUDGE_HIDDEN = 0.10; // ±10% for Stack's display:none follower — invisible
                                  // AND muted, so a strong trim is undetectable and
                                  // converges ~5× faster than Grid's gentle one
// Grid's trim is PROPORTIONAL to the error (mag/_DRIFT_CONVERGE_TAU, floored at
// _DRIFT_NUDGE, capped at _DRIFT_NUDGE_MAX) rather than a flat ±2%. Two <video>s
// told to play together come up 1–2 frames apart on real hardware — a decode-start
// race, NOT steady drift: measured in real Chrome on 1080p high-bitrate H.264, the
// offset builds to 35–50 ms within the first ~200 ms of playback and then just sits
// there. A flat ±2% needs ~1.5 s to walk 45 ms out (measured: converged at 1494 ms
// and 1643 ms), but a review pause typically lands ~0.7 s in — while the pair is
// still 30–40 ms (>½ frame) apart. _snapAllVideosToFrame then correctly seeks the
// follower onto the reference's frame, and THAT seek is the visible "B stutters a
// frame or two to catch up on almost every pause" hop (the reference, never seeked,
// stays solid — hence the asymmetry, and why it tracks the selection).
// Proportional trim closes the same 45 ms in ~0.3 s while leaving small
// steady-state errors on the old gentle ±2%: the visible follower only ever gets a
// strong trim when it is already a frame out, which is exactly when the alternative
// is a worse-looking seek. Cap stays under the ±10% Stack has always shipped.
const _DRIFT_NUDGE_MAX = 0.12;      // ceiling for Grid's proportional trim
const _DRIFT_CONVERGE_TAU = 0.4;    // s — Grid convergence time constant (exponential)
// Does this engine render a rate-trimmed <video> smoothly? Chrome does; WebKit
// does NOT. Measured in real Safari (safaridriver, tests/investigate-safari.mjs
// section 3), 4 s of resumed playback per arm, 3 runs: the VISIBLE follower under
// a trim presented frames irregularly every single time (12/102, 12/102, 7/8
// wrong frame-steps plus wall-clock hitches), while the untrimmed primary was
// flawless in all six arms and the same follower with trims stubbed out was
// flawless too (0/94 in every run). The jerk does NOT scale with magnitude —
// capping the trim at 2% or 5% was just as bad as 12% — so it can't be tuned
// away, only avoided. That is the reported "when I resume, the unselected clip
// doesn't play smoothly".
// On such an engine a slightly-offset-but-SMOOTH visible follower beats a
// frame-accurate juddering one: the offset is a per-play-session startup race
// that stays roughly constant rather than growing, it's hard to see while both
// clips are moving, and _snapAllVideosToFrame aligns the pair exactly on pause —
// which is when frame accuracy actually matters. Gross desync still hard-seeks
// via _DRIFT_HARD_SEEK, and Stack's follower is display:none so its trim is
// invisible and stays enabled.
// Detected by capability, not UA string — fastSeek is WebKit-only, the same
// gate _scrubUseDecoder uses to pick the scrub path.
// Measured trade (Safari, Grid follower, per 4 s resume): trims gave peak drift
// 53–145 ms with >½ frame on ~85% of ticks AND 6 hitches + 12/102 bad
// frame-steps; no trim gives ~85 ms drift with 0 hitches / 0 bad steps. The
// trims were buying almost no sync here while costing all the smoothness.
// Both land on the SAME FRAME at pause (verified 3×), which is what review
// accuracy depends on. A cooldown-limited corrective SEEK instead of a trim was
// also measured — drift ~36 ms, but ~1 hitch per 92 frames — and rejected: it
// reintroduces judder to buy sub-frame alignment during motion, and seeking a
// playing element is the mechanism the _seekLead comments warn about.
const _RATE_TRIM_IS_SMOOTH = typeof HTMLMediaElement === 'undefined' ||
    !HTMLMediaElement.prototype.fastSeek;

function _driftLockTick(primary) {
    if (hasAudios || !primary || primary.paused) return;
    if (isDragging || _bulkSyncActive) return;
    const videos = getAllVideos();
    if (videos.length < 2) return;
    // The clock master's true base is the USER-selected rate, not
    // primary.playbackRate: if this element was a mid-nudge FOLLOWER a tick ago
    // (an asset switch promoted it to primary while its rate was base·(1±2%)),
    // reading its rate would treat the skew as the base and every follower would
    // sync to a permanently 2%-off clock — a global tempo error until J/K. Read
    // the intended rate directly and force the primary back onto it.
    const base = (typeof PLAYBACK_RATES !== 'undefined' &&
                  PLAYBACK_RATES[playbackRateIndex]) || primary.playbackRate || 1;
    primary._driftNudge = 0;
    if (Math.abs((primary.playbackRate || 1) - base) > 1e-6) primary.playbackRate = base;
    const primaryFps = videoFrameRates[primary.src] || 30;
    for (const v of videos) {
        if (v === primary) continue;
        if (v.paused || v.ended || v.readyState < 2) continue;
        // A correction seek is still in flight — let it land before measuring
        // again, or a stalled follower gets a fresh seek every rAF (seek storm).
        if (v.seeking) continue;
        // A correction seek just landed: fold the landing error into a
        // per-element lead. Seeking a PLAYING element stalls it for the seek
        // latency while the primary keeps advancing, so an uncompensated seek
        // lands BEHIND by that latency — beyond the engage threshold again →
        // a perpetual seek loop (measured: ~26 seeks/s) that held the hidden
        // Stack follower chronically 1–2 frames behind. Every asset switch
        // then promoted the laggard to clock master and dragged the whole
        // cluster (and the timeline) backward — the "switching jumps back a
        // frame or two and stalls" bug. With the lead, one or two corrections
        // land ON the clock and the loop stops.
        if (v._seekIssued) {
            v._seekIssued = false;
            const err = v.currentTime - primary.currentTime; // <0 → landed behind
            v._seekLead = Math.min(0.25, Math.max(0, (v._seekLead || 0) - err * 0.8));
        }
        // Engage at half a frame of the COARSER of the two grids: a low-fps
        // follower can only land on its own (coarser) grid, so measuring it
        // against a high-fps primary's finer grid would re-engage every tick
        // (thrash). Per-pair, mirroring the diff gate's fps convention.
        // Stack tightens the band to 8 ms: its follower is hidden AND muted, so
        // a nudge costs nothing perceptible — and the follower is what the user
        // switches TO, so any tolerated drift becomes a visible content offset
        // at the swap on near-identical clips. (Grid keeps the half-frame band:
        // its followers are on screen and correcting sub-half-frame drift there
        // buys nothing visible.)
        const halfFrame = 0.5 / Math.min(primaryFps, videoFrameRates[v.src] || 30);
        const engage = isGridMode ? halfFrame : Math.min(halfFrame, 0.008);
        const drift = v.currentTime - primary.currentTime; // >0 → follower ahead
        const mag = Math.abs(drift);
        // Sub-_DRIFT_HARD_SEEK drift converges via rate trim in BOTH modes:
        // Grid followers are visible → gentle ±2%; Stack's follower is
        // display:none AND muted → a strong ±10% is undetectable and converges
        // fast without ever seeking. (Stack used to hard-seek at half a frame,
        // but a seek stalls a playing element for its seek latency, landing it
        // behind by more than half a frame again → perpetual seek loop.)
        const trim = isGridMode
            ? Math.min(_DRIFT_NUDGE_MAX, Math.max(_DRIFT_NUDGE, mag / _DRIFT_CONVERGE_TAU))
            : _DRIFT_NUDGE_HIDDEN;
        // Engines that judder under a rate trim only get it where it can't be
        // seen (Stack's display:none follower). A VISIBLE follower is left alone
        // and re-aligned by the pause snap — see _RATE_TRIM_IS_SMOOTH.
        const mayTrim = _RATE_TRIM_IS_SMOOTH || !isGridMode;
        if (mag > _DRIFT_HARD_SEEK) {
            v._seekIssued = true;
            v.currentTime = primary.currentTime + (v._seekLead || 0);
            v._driftNudge = 0;
            if (v.playbackRate !== base) v.playbackRate = base;
        } else if (v._driftNudge) {
            // Release on convergence OR overshoot past the target (sign flip) —
            // and unconditionally where trims aren't usable, so an episode that
            // began before a mode switch can't strand the follower off-rate.
            if (!mayTrim || mag < _DRIFT_RELEASE || Math.sign(drift) === v._driftNudge) {
                v._driftNudge = 0;
                v.playbackRate = base;
            } else {
                const want = base * (1 + trim * v._driftNudge);
                if (Math.abs(v.playbackRate - want) > 1e-6) v.playbackRate = want;
            }
        } else if (mayTrim && mag > engage) {
            v._driftNudge = drift > 0 ? -1 : 1;
            v.playbackRate = base * (1 + trim * v._driftNudge);
        } else if (v.playbackRate !== base) {
            // Idle follower tracks the user rate (J/K writes it directly, but
            // this heals any leftover from an interrupted nudge episode).
            v.playbackRate = base;
        }
    }
}

function _setupFpsDetection(video, slot) {
    if (typeof video.requestVideoFrameCallback !== 'function') {
        videoFrameRates[video.src] = 30;
        return;
    }
    videoFrameRates[video.src] = 30; // default until detected
    // Frame-to-frame deltas, ACCUMULATED across play sessions (see the 'play'
    // handler). lastTs anchors the current run only, so a pause/seek boundary
    // never contributes a bogus interval.
    const intervals = [];
    let lastTs = null;
    let detected = false;
    let detecting = false;   // single-chain guard: at most one detection RVFC in flight

    function onFrame(now, metadata) {
        if (detected) { detecting = false; return; }
        // Chain ended before enough samples (pause/seek/ended) — release the
        // guard so the next 'play' can start a clean pass instead of two chains
        // racing the same sample buffer.
        if (video.paused || video.ended) { detecting = false; return; }
        if (lastTs !== null) {
            const dt = metadata.mediaTime - lastTs;
            if (dt > 0) intervals.push(dt);
        }
        lastTs = metadata.mediaTime;
        if (intervals.length < _FPS_SAMPLE_COUNT) {
            video.requestVideoFrameCallback(onFrame);
        } else {
            detected = true;
            detecting = false;
            // Base the frame duration on the MEDIAN interval, not the minimum.
            // The minimum is the single least robust statistic available here:
            // one spuriously small delta sets the dropped-frame threshold for
            // every other sample, so all the real intervals get discarded as
            // "drops" and the estimate collapses onto the junk. Safari emits
            // exactly that during ordinary playback — measured on a 24 fps clip
            // whose deltas were a clean run of 41.67 ms polluted by 2.17, 4.65,
            // 0, −666 and 743 ms values; min → 2.17 ms → threshold 3.26 ms →
            // zero real intervals survived → ~460 fps, snapped to 60 (Chrome
            // reported the same file as 24). The median ignores outliers at
            // both ends, and a real dropped frame still lands at ~2× it.
            const sorted = intervals.slice().sort((a, b) => a - b);
            const median = sorted[sorted.length >> 1];
            // ±25% around the median: real frame intervals cluster tightly, a
            // dropped frame lands at ~2x, and Safari's junk deltas land well
            // outside. A wider ±50% window still admitted a stray 23.9 ms delta
            // next to a clean 41.67 ms run and pulled 24 fps to 25.
            const good = intervals.filter(dt => dt > median * 0.75 && dt < median * 1.25);
            // Average the good intervals for precision to distinguish 23.976 vs 24
            const avgInterval = good.length > 0
                ? good.reduce((a, b) => a + b, 0) / good.length
                : median;
            const rawFps = 1 / avgInterval;
            const snapped = _FPS_STANDARD_RATES.reduce((a, b) =>
                Math.abs(b - rawFps) < Math.abs(a - rawFps) ? b : a);
            console.log(`[fps] ${slot}: raw=${rawFps.toFixed(4)} → snapped=${snapped} (${good.length}/${intervals.length} good intervals)`);
            videoFrameRates[video.src] = snapped;
            updateAssetInfoBar(slot, { fps: `${snapped} fps` });
            updateDurationDisplay(slot, video.duration, snapped);
        }
    }

    // A run boundary must not bridge into a bogus delta: drop the anchor, keep
    // the samples. (A mid-playback seek otherwise contributes a garbage interval
    // — and a small forward one would poison minInterval, which sets the
    // dropped-frame filter's threshold for every other sample.)
    video.addEventListener('seeking', function() { lastTs = null; });

    video.addEventListener('play', function() {
        if (detected || detecting) return;
        detecting = true;
        // Do NOT clear the accumulated intervals. Detection needs
        // _FPS_SAMPLE_COUNT frames (~1.3 s at 24 fps) and resetting on every
        // play meant a user reviewing in short taps (~0.7 s ≈ 17 frames) never
        // finished a pass — the clip stayed pinned to the 30 fps default, which
        // then fed the WRONG grid to _snapAllVideosToFrame's midpoint
        // quantization (landing a 24 fps clip off its own frame boundaries,
        // defeating the (frame+0.5)/fps protection) and the wrong half-frame
        // band to the drift lock. Samples now carry across sessions.
        lastTs = null;
        video.requestVideoFrameCallback(onFrame);
    });
}

function setupVideoHandlers(video, slot) {
    // Idempotency guard: loadedmetadata can fire more than once on the
    // same element — notably _applyTranscodedFile reassigns video.src and
    // calls video.load(), re-firing it. Without this guard a second full
    // set of play/pause/ended/seeked listeners (and a second fps-detection
    // RVFC chain) would attach, so every transcoded file (AC-3/EAC-3/DTS/
    // TrueHD) ran doubled handlers. The flag lives on the element, so it
    // dies when the element is replaced on the next load.
    if (video._handlersBound) return;
    video._handlersBound = true;

    // Native-loop default for this (possibly just-loaded) element — routes
    // through the policy owner: with a second video already present this
    // DISABLES native loop everywhere so the videos wrap together instead
    // of each restarting at 0 on its own clock.
    _applyNativeLoopPolicy();

    // Passive fps detection — detects during first normal playback
    _setupFpsDetection(video, slot);

    video.addEventListener('play', function() {
        // Frame-accurate loop enforcement runs even during bulk sync — the 'play'
        // event fires after the transition to playing, so this is the correct
        // moment to start the RVFC chain. Guarding it on _bulkSyncActive (as the
        // sync logic below does) means playAllMedia's window blocks loop start.
        if (_getLoopBounds() !== null) _startLoopRvfc(video);

        if (_bulkSyncActive) return;
        if (isDragging) return;
        // Sync all videos when any video plays
        syncVideos(video, v => {
            v.play().catch(() => {});
            if (Math.abs(v.currentTime - video.currentTime) > 0.5) {
                v.currentTime = video.currentTime;
            }
        });

        // Start global progress update loop (only once)
        startProgressUpdateLoop();
    });

    video.addEventListener('pause', function() {
        if (_bulkSyncActive) return;
        // Reaching the natural end fires 'pause' then 'ended'. Under a managed
        // loop region the 'ended' handler is about to wrap everyone back to the
        // in-point — cascading this implicit pause to the other videos first
        // would kick off a pause→play storm (each play re-syncs against a
        // mid-wrap clock and seeks the others to stale positions).
        if (video.ended && _getLoopBounds() !== null) return;
        // Sync pause to all other videos
        syncVideos(video, v => { if (!v.paused) v.pause(); });
    });

    video.addEventListener('ended', function() {
        // When a managed loop region is active (custom points OR multi-video
        // sync loop) native looping is off, so the native end-of-video restart
        // from 0 can't fight our synchronized seek-back. The RVFC out-point
        // check fires on mediaTime >= outP, but the last frame's mediaTime is
        // typically one frame short of duration — so an out-point at a video's
        // effective end never trips the check and that video ends instead.
        // Wrap everyone together here (fires for followers too: with unequal
        // durations, the shortest video ends first and drags the rest back).
        const bounds = _getLoopBounds();
        if (bounds === null) return;
        // Full mode: a clip that reaches its own end HOLDS on its last frame —
        // wrap only once EVERY clip has ended (the longest finishing is the
        // trigger). Purely event-driven: no per-frame currentTime race. Sync mode
        // is unchanged — the out-point is the shortest clip, so the first 'ended'
        // is the wrap point (the RVFC chain usually beats it; this is the backstop).
        if (_loopRangeMode === 'full' && !getAllVideos().every(v => v.ended)) return;
        // Atomic wrap, same shape as playAllMedia/restartAllVideos: suppress
        // the per-video play/pause sync handlers while every element is seeked
        // and (re)started, and drop any pending exact-time wrap — otherwise the
        // handlers re-sync against mid-wrap clocks and seek each other to
        // stale pre-wrap positions.
        _cancelLoopWrapTimer();
        _bulkSyncActive = true;
        getAllPlayableMedia().forEach(m => {
            m.currentTime = bounds.inP;
            m.play().catch(() => {});
        });
        if (_opusSyncActive) {
            for (const s of assetOrder) {
                if (_opusSyncSlots[s]) _startOpusSyncAudio(s, bounds.inP);
            }
        }
        setTimeout(() => { _bulkSyncActive = false; }, 50);
    });
    
    video.addEventListener('seeked', function() {
        if (isDragging && !isGridMode) {
            // Only the active (scrubbed) video drives the reactive-seek chain. A
            // stray 'seeked' from a non-active element (a late-landing seek queued
            // before the drag, an opus/loop seek) must not consume the shared
            // _scrubNextTime / _scrubSeekPending and seek the wrong element.
            const _asSlot = currentAudioSource || assetOrder[currentAssetIndex];
            const _asLayer = getLayer(_asSlot);
            if (video !== (_asLayer && _asLayer.querySelector('video'))) return;
            // Reactive seek: previous decode finished.
            // Wait one rAF so the compositor can display this frame before we
            // issue the next seek — issuing immediately can clear the AVFoundation
            // buffer before the frame ever appears on screen.
            _scrubSeekPending = false;
            requestAnimationFrame(() => {
                if (!isDragging || isGridMode) return;
                if (_scrubNextTime !== null && !isNaN(video.duration)) {
                    _scrubSeekPending = true;
                    const _nt = _scrubNextTime;
                    _scrubNextTime = null;
                    video.currentTime = _nt;
                }
            });
            return;
        }
        if (isDragging) return; // grid scrub manages its own progress updates
        // Only the active video updates progress — prevents duration cycling
        // when scrub seeks all videos and their seeked events fire asynchronously
        const activeSlot = currentAudioSource || assetOrder[currentAssetIndex];
        const activeLayer = getLayer(activeSlot);
        const activeVideo = activeLayer ? activeLayer.querySelector('video') : null;
        if (video === activeVideo) {
            updateVideoProgress(video);
        }
        // Restart Opus sync audio on seek/loop only if drift is significant.
        // The RVFC loop-wrap path and `_syncOpusAudioToVideo` already restart
        // the source when needed; restarting unconditionally on every seek
        // causes a second restart at every loop wrap that cuts off the first
        // restart's fade-in mid-flight — audible as a remnant click after
        // the deferred-start anti-crossfade fix.
        if (_opusSyncSlots[slot] && !video.paused && _opusSyncSources[slot]) {
            const ctx = getAudioContext();
            const rate = _opusSyncRate[slot] || 1;
            const elapsed = ctx.currentTime - _opusSyncStartCtx[slot];
            const expectedVideoTime = _opusSyncStartVideo[slot] + elapsed * rate;
            if (elapsed >= 0 && Math.abs(video.currentTime - expectedVideoTime) > 0.15) {
                _startOpusSyncAudio(slot, video.currentTime);
            }
        } else if (_opusSyncSlots[slot] && !video.paused) {
            // No source running — start one (rare path; normally sources are
            // managed by the play/wrap flow).
            _startOpusSyncAudio(slot, video.currentTime);
        }
        // Refresh scopes after seek completes (frame is decoded)
        if (videoScopesVisible) updateVideoScopes();
        if (_diffMode) requestAnimationFrame(drawDiffComposite);
        if (_noVideoMode) updateAllAudioSlotCursors(video);
    });
}

function restartAllVideos() {
    _bulkSyncActive = true;
    const startTime = (_loopInPoint !== null) ? _loopInPoint : 0;
    getAllPlayableMedia().forEach(m => { m.currentTime = startTime; m.play().catch(() => {}); });
    _startOpusSyncForPlayingSlots(() => startTime);
    startProgressUpdateLoop();
    setTimeout(() => { _bulkSyncActive = false; }, 50);
}

function stepFrame(direction) {
    const videos = getAllVideos();
    if (videos.length === 0) return;
    // Pause all videos first — frame stepping only makes sense when paused
    videos.forEach(v => { if (!v.paused) v.pause(); });
    // Advance the REFERENCE clip by one of ITS frames, then quantize every clip
    // onto its OWN grid at that shared instant — the same reference-time (not
    // reference-frame-NUMBER) convention _snapAllVideosToFrame uses, because
    // clips can differ in fps. Stepping each video on its own clock instead let
    // a mixed-fps pair diverge by the frame-duration difference on EVERY step
    // (24 vs 30 fps = 8.3 ms/step: measured 204 ms — 5 frames — adrift after 24
    // taps), and nothing corrects it: the drift lock only runs during playback
    // and the pause snap only runs from pauseAllMedia. The old per-clip
    // `% totalFrames` wrap was the same bug at the loop point — clips of
    // different lengths wrapped at their own ends onto unrelated content.
    const ref = _syncReferenceVideo(videos);
    if (!ref || isNaN(ref.duration)) return;
    const refFps = videoFrameRates[ref.src] || 30;
    // Small epsilon (0.01 frames) handles IEEE 754 rounding at frame boundaries
    // without overshooting from frame midpoints.
    const refTotal = Math.floor(_getEffectiveDuration(ref) * refFps + 0.01);
    if (refTotal <= 0) return;
    const refFrame = Math.floor(ref.currentTime * refFps + 0.01);
    // Seek to the midpoint of the target frame to avoid landing on a frame
    // boundary where IEEE 754 rounding leaves us in the wrong frame (e.g.
    // 1/24 = 0.04166...64, just short of frame 1).
    const refTime = (((refFrame + direction) % refTotal + refTotal) % refTotal + 0.5) / refFps;
    videos.forEach(v => {
        const fps = videoFrameRates[v.src] || 30;
        const frame = Math.floor(refTime * fps + 0.01);
        // A follower shorter than the reference holds on its last frame rather
        // than wrapping to unrelated content (matches the Full-mode tail).
        v.currentTime = Math.min(Math.max((frame + 0.5) / fps, 0), v.duration - 0.001);
    });
    // Update progress display after seek completes (seeked event handles
    // the visual update). Also update optimistically for responsive feel.
    const primary = videos[0];
    if (primary) updateVideoProgressFromTime(primary, primary.currentTime);
    // Refresh magnifier after seek so loupe shows the new frame
    if (magnifierEnabled && _lastMouseEvent) {
        requestAnimationFrame(() => updateMagnifier(_lastMouseEvent));
    }
    // Refresh video scopes after frame step
    if (videoScopesVisible) {
        requestAnimationFrame(() => updateVideoScopes());
    }
    // Refresh difference overlay after frame step
    if (_diffMode) {
        requestAnimationFrame(() => drawDiffComposite());
    }
}
