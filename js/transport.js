// Media transport / playback ownership — extracted from index.html.
// Play/pause/restart, frame stepping, A/V sync, frame-accurate loop enforcement,
// and video/audio handler binding. STATEFUL: reads/writes app globals (mediaData,
// _bulkSyncActive, primaryVideoRef, _loopInPoint/_loopOutPoint, currentAudioSource,
// _opusSync*, …) and calls the opus-sync engine + progress loop that remain in
// index.html — all resolve via the shared global scope of classic <script>s.
// Holds the single-owner targets for audit findings A (_startLoopRvfc), B
// (setupVideoHandlers), D (_startOpusSyncForPlayingSlots / playAllMedia /
// restartAllVideos); see tests/ownership.test.mjs.

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

function playAllMedia() {
    _bulkSyncActive = true;
    const customLoopActive = (_loopInPoint !== null && _loopOutPoint !== null);
    getAllPlayableMedia().forEach(m => { m.loop = !customLoopActive; m.play().catch(() => {}); });
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
    getAllPlayableMedia().forEach(m => { m.currentTime = _loopInPoint; });
    if (_opusSyncActive) {
        for (const s of assetOrder) {
            if (_opusSyncSlots[s]) _startOpusSyncAudio(s, _loopInPoint);
        }
    }
}
function _startLoopRvfc(video) {
    if (isGridMode) return;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    if (video.paused || video.ended) return;
    if (_loopInPoint === null || _loopOutPoint === null) return;
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
        if (video.paused || video.ended ||
            _loopInPoint === null || _loopOutPoint === null ||   // loop cleared
            isGridMode ||                                        // mode switched
            video !== primaryVideoRef) {                        // no longer primary
            _cancelLoopWrapTimer();
            video._loopRvfcActive = false;
            return;
        }
        if (isDragging) { video.requestVideoFrameCallback(onFrame); return; }

        const t = metadata.mediaTime;
        if (t >= _loopOutPoint || t < _loopInPoint - 0.05) {
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
            if (t >= _loopOutPoint - frameDur * 1.25 && _loopWrapTimer === null) {
                const rate = video.playbackRate || 1;
                const delayMs = Math.max(0, ((_loopOutPoint - t) / rate) * 1000 - 2);
                _loopWrapTimer = setTimeout(() => {
                    _loopWrapTimer = null;
                    // Re-validate: the loop may have been cleared, playback paused,
                    // or the user may have seeked back since this was scheduled.
                    if (_loopInPoint === null || _loopOutPoint === null) return;
                    if (video.paused || isDragging) return;
                    if (video.currentTime < _loopOutPoint - frameDur * 1.5) return;
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

    // Enable native looping
    video.loop = true;

    // Passive fps detection — detects during first normal playback
    _setupFpsDetection(video, slot);

    video.addEventListener('play', function() {
        // Frame-accurate loop enforcement runs even during bulk sync — the 'play'
        // event fires after the transition to playing, so this is the correct
        // moment to start the RVFC chain. Guarding it on _bulkSyncActive (as the
        // sync logic below does) means playAllMedia's window blocks loop start.
        if (_loopInPoint !== null && _loopOutPoint !== null) _startLoopRvfc(video);

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
        // Sync pause to all other videos
        syncVideos(video, v => { if (!v.paused) v.pause(); });
    });

    video.addEventListener('ended', function() {
        // When custom loop points are active we set m.loop = false (so the
        // native end-of-video restart from 0 doesn't fight our RVFC seek-back).
        // The RVFC out-point check fires on mediaTime >= _loopOutPoint, but
        // the last frame's mediaTime is typically one frame short of duration
        // — so when _loopOutPoint sits at the video's effective end, the check
        // never trips and the video ends instead. Handle that here.
        if (isGridMode) return;
        if (_loopInPoint === null || _loopOutPoint === null) return;
        getAllPlayableMedia().forEach(m => {
            m.currentTime = _loopInPoint;
            m.play().catch(() => {});
        });
        if (_opusSyncActive) {
            for (const s of assetOrder) {
                if (_opusSyncSlots[s]) _startOpusSyncAudio(s, _loopInPoint);
            }
        }
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
