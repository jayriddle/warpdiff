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
    let minDur = Infinity;
    for (const v of videos) {
        const d = _getEffectiveDuration(v);
        if (!d || !isFinite(d)) return null;
        if (d < minDur) minDur = d;
    }
    return { inP: 0, outP: minDur };
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
    _applyNativeLoopPolicy();
    getAllPlayableMedia().forEach(m => { m.play().catch(() => {}); });
    _startOpusSyncForPlayingSlots(v => v.currentTime);
    startProgressUpdateLoop();
    _updatePlayPauseBtn(true);
    setTimeout(() => { _bulkSyncActive = false; }, 50);
}

function pauseAllMedia() {
    _bulkSyncActive = true;
    getAllPlayableMedia().forEach(m => m.pause());
    _stopAllOpusSyncAudio();
    _updatePlayPauseBtn(false);
    _bulkSyncActive = false;
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
    getAllPlayableMedia().forEach(m => { m.currentTime = bounds.inP; });
    if (_opusSyncActive) {
        for (const s of assetOrder) {
            if (_opusSyncSlots[s]) _startOpusSyncAudio(s, bounds.inP);
        }
    }
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
const _DRIFT_HARD_SEEK = 0.15; // s — beyond this, always seek (missed wrap, stall)
const _DRIFT_RELEASE = 0.005;  // s — nudge ends once drift is inside this
const _DRIFT_NUDGE = 0.02;     // ±2% rate trim (imperceptible on muted video)

function _driftLockTick(primary) {
    if (hasAudios || !primary || primary.paused) return;
    if (isDragging || _bulkSyncActive || _frameKicking) return;
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
    const engage = 0.5 / (videoFrameRates[primary.src] || 30); // half a frame
    for (const v of videos) {
        if (v === primary) continue;
        if (v.paused || v.ended || v.readyState < 2) continue;
        // A correction seek is still in flight — let it land before measuring
        // again, or a stalled follower gets a fresh seek every rAF (seek storm).
        if (v.seeking) continue;
        const drift = v.currentTime - primary.currentTime; // >0 → follower ahead
        const mag = Math.abs(drift);
        if (mag > _DRIFT_HARD_SEEK || (!isGridMode && mag > engage)) {
            v.currentTime = primary.currentTime;
            v._driftNudge = 0;
            if (v.playbackRate !== base) v.playbackRate = base;
        } else if (v._driftNudge) {
            // Release on convergence OR overshoot past the target (sign flip).
            if (mag < _DRIFT_RELEASE || Math.sign(drift) === v._driftNudge) {
                v._driftNudge = 0;
                v.playbackRate = base;
            } else {
                const want = base * (1 + _DRIFT_NUDGE * v._driftNudge);
                if (Math.abs(v.playbackRate - want) > 1e-6) v.playbackRate = want;
            }
        } else if (mag > engage) {
            v._driftNudge = drift > 0 ? -1 : 1;
            v.playbackRate = base * (1 + _DRIFT_NUDGE * v._driftNudge);
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
    const timestamps = [];
    let detected = false;

    function onFrame(now, metadata) {
        if (detected || video.paused || video.ended) return;
        timestamps.push(metadata.mediaTime);
        if (timestamps.length <= _FPS_SAMPLE_COUNT) {
            video.requestVideoFrameCallback(onFrame);
        } else {
            detected = true;
            // Compute all intervals between consecutive frames
            const intervals = [];
            for (let i = 1; i < timestamps.length; i++) {
                const dt = timestamps[i] - timestamps[i - 1];
                if (dt > 0) intervals.push(dt);
            }
            // Find minimum interval (true frame duration — drops only create larger gaps)
            const minInterval = Math.min(...intervals);
            // Filter out dropped frames (interval > 1.5x the minimum)
            const threshold = minInterval * 1.5;
            const good = intervals.filter(dt => dt <= threshold);
            // Average the good intervals for precision to distinguish 23.976 vs 24
            const avgInterval = good.length > 0
                ? good.reduce((a, b) => a + b, 0) / good.length
                : minInterval;
            const rawFps = 1 / avgInterval;
            const snapped = _FPS_STANDARD_RATES.reduce((a, b) =>
                Math.abs(b - rawFps) < Math.abs(a - rawFps) ? b : a);
            console.log(`[fps] ${slot}: raw=${rawFps.toFixed(4)} → snapped=${snapped} (${good.length}/${intervals.length} good intervals)`);
            videoFrameRates[video.src] = snapped;
            updateAssetInfoBar(slot, { fps: `${snapped} fps` });
            updateDurationDisplay(slot, video.duration, snapped);
        }
    }

    video.addEventListener('play', function() {
        if (detected) return;
        timestamps.length = 0;
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
        if (isDragging || _frameKicking) return; // _frameKick may trigger play during scrub; don't cascade
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
    videos.forEach(v => {
        const fps = videoFrameRates[v.src] || 30;
        // Small epsilon (0.01 frames) handles IEEE 754 rounding at
        // frame boundaries without overshooting from frame midpoints.
        const currentFrame = Math.floor(v.currentTime * fps + 0.01);
        const totalFrames = Math.floor(v.duration * fps + 0.01);
        const targetFrame = (currentFrame + direction + totalFrames) % totalFrames;
        // Seek to the midpoint of the target frame to avoid landing on
        // a frame boundary where IEEE 754 rounding leaves us in the
        // wrong frame (e.g. 1/24 = 0.04166...64, just short of frame 1).
        const target = Math.min((targetFrame + 0.5) / fps, v.duration - 0.001);
        v.currentTime = target;
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
