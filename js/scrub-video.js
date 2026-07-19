// WebCodecs scrub decoder — smooth timeline scrubbing on Chrome for sparse-keyframe
// MP4 video. Decodes the ORIGINAL file's samples directly with VideoDecoder and
// paints VideoFrames to a canvas overlay during drags: no proxy transcode, no
// quality taint, and no second <video> element (which Chrome refuses to paint on
// scrub — see docs/scrub-proxy-spike-2026-05.md).
//
// Feed model: on request(t), find the target sample (greatest pts ≤ t), find its
// GOP keyframe, and feed chunks in decode order from the keyframe forward. Every
// output frame with pts ≤ target is painted as it arrives (progressive fast-forward,
// which is what makes it feel like Safari); frames past the target are closed
// unpainted. Forward scrubs inside the same GOP continue feeding without a reset;
// backward scrubs or GOP changes reset() the decoder (which per spec discards all
// pending output and returns it to "unconfigured") and reconfigure from the new
// keyframe.
//
// Memory: the session retains the full file bytes (sample chunks are subarray
// views into them). Decoded frames close immediately after paint/caching; the
// revisit cache holds display-capped ImageBitmaps under a budget sized to the
// file's longest GOP (96 MB floor, 192 MB ceiling) — see the cache block for
// why holding a whole GOP is what makes BACKWARD scrubbing usable.
//
// Globals consumed by index.html:
//   _scrubVideoSupported()          — feature gate
//   _createScrubVideoSession(bytes) — demux + configure; null if not scrubbable

function _scrubVideoSupported() {
    return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

function _createScrubVideoSession(bytes) {
    if (!_scrubVideoSupported()) return null;
    const info = _demuxMP4Video(bytes);
    if (!info || !info.codec || info.samples.length === 0) return null;
    // Refuse HDR content (PQ transfer=16, HLG=18 in the colr box): Chrome
    // tone-maps HDR <video> for display; drawImage of the decoded frames gets
    // no tone mapping, so the overlay would paint drastically darker. Falling
    // back to native <video> scrubbing is correct for these files. (Streams
    // tagged only in the bitstream, with no colr box, are caught by the
    // first-frame guard in the output callback below.)
    if (info.colr && (info.colr.transfer === 16 || info.colr.transfer === 18)) return null;

    const samples = info.samples;               // decode order
    const nSamples = samples.length;
    // Presentation-order index for target lookup: [{pts, idx}] sorted by pts
    const byPts = samples.map((s, i) => ({ pts: s.pts, idx: i })).sort((a, b) => a.pts - b.pts);
    // Median frame duration → half-frame tolerance for "frame at time t"
    const frameDur = nSamples > 1
        ? (byPts[nSamples - 1].pts - byPts[0].pts) / (nSamples - 1) : 1 / 30;

    const config = { codec: info.codec, optimizeForLatency: true };
    if (info.codedWidth)  config.codedWidth  = info.codedWidth;
    if (info.codedHeight) config.codedHeight = info.codedHeight;
    if (info.description) config.description = info.description;

    // ── Decoded-frame cache ──────────────────────────────────────────────
    // Every frame the decoder emits is cached as a display-capped ImageBitmap
    // so revisiting a position (backward jumps, back-and-forth A/B scrubbing)
    // paints instantly with no re-decode. Bitmaps are capped at 1280px wide
    // (scrub preview quality; a 4K frame would be ~33 MB raw), evicting the
    // entries farthest from the current target.
    const cacheScale = Math.min(1, 1280 / (info.codedWidth || 1280));
    const cacheW = Math.max(2, Math.round((info.codedWidth || 640) * cacheScale));
    const cacheH = Math.max(2, Math.round((info.codedHeight || 360) * cacheScale));
    const cacheFrameBytes = cacheW * cacheH * 4;
    // Size the budget to hold ONE FULL GOP where that's affordable, instead of a
    // flat 96 MB. A decoder only runs forward, so any backward target the
    // in-flight run has already passed costs reset() + a re-decode from the GOP
    // keyframe. Walking back through a GOP is free IF that run's frames are
    // still cached — and ruinous if they aren't: at a flat 96 MB the cache held
    // 27 frames against a 48-frame GOP, so backward travel fell off the cached
    // window every ~27 frames and re-decoded from the keyframe again. Measured
    // in real Chrome on two 10 s 1080p clips (GOP 48), median of 3 backward
    // drags of 61 requests each: 15 resets / 500 decode() calls / 32 visible
    // stalls at 27 frames, vs 8 / 285 / 18 once the cache held the GOP.
    // Forward drags are unaffected (5 resets either way) — they extend the
    // in-flight run rather than restarting it, which is the whole asymmetry.
    // Files with dense keyframes keep the 96 MB floor; only sparse-keyframe
    // files (the ones that scrub badly in the first place) spend more.
    const CACHE_FLOOR = 96 * 1024 * 1024;
    const CACHE_CEIL = 192 * 1024 * 1024;   // ~54 frames at 1280×720
    let maxGop = 1;
    for (let i = 0, lastKey = -1; i < nSamples; i++) {
        if (!samples[i].key) continue;
        if (lastKey >= 0 && i - lastKey > maxGop) maxGop = i - lastKey;
        lastKey = i;
    }
    // 1.25× so the window still spans the GOP when the target sits partway
    // through it (the run caches around the target, not from the keyframe).
    const CACHE_BUDGET = Math.min(CACHE_CEIL,
        Math.max(CACHE_FLOOR, Math.ceil(maxGop * 1.25) * cacheFrameBytes));
    // How many frames actually FIT in the budget (~27 at the 96 MB floor, ~54 at
    // the ceiling). Frames farther than this from the current target would be
    // evicted by cacheEvictFor the moment they land — see cacheStore's gate.
    const maxCacheFrames = Math.max(8, Math.floor(CACHE_BUDGET / cacheFrameBytes));
    const cache = new Map();          // decode idx → { bm: ImageBitmap, pts }
    let cacheBytes = 0;
    let cacheHits = 0;
    // decode idx from an output frame's µs timestamp
    const idxByTs = new Map(samples.map((s, i) => [Math.round(s.pts * 1e6), i]));

    function cacheEvictFor(centerPts) {
        while (cacheBytes + cacheFrameBytes > CACHE_BUDGET && cache.size) {
            let worstKey = -1, worstDist = -1;
            for (const [k, v] of cache) {
                const d = Math.abs(v.pts - centerPts);
                if (d > worstDist) { worstDist = d; worstKey = k; }
            }
            const evicted = cache.get(worstKey);
            cache.delete(worstKey);
            cacheBytes -= cacheFrameBytes;
            evicted.bm.close();
        }
    }

    function cacheStore(frame) {
        const idx = idxByTs.get(frame.timestamp);
        if (idx === undefined || cache.has(idx) || dead) { return; }
        // Distance gate: don't clone + createImageBitmap a frame the eviction
        // policy would discard immediately. A backward jump re-decodes the whole
        // GOP from its keyframe; without this gate every one of those frames
        // (dozens per mousemove on sparse-keyframe files) pays a clone + async
        // bitmap resize only to be evicted as "farthest from target" — pure
        // churn that starves the drag's main thread (reverse-scrub stutter).
        if (targetPts >= 0 &&
            Math.abs(frame.timestamp / 1e6 - targetPts) > maxCacheFrames * frameDur) { return; }
        let clone;
        try { clone = frame.clone(); } catch (_) { return; }
        cacheEvictFor(frame.timestamp / 1e6);
        // Reserve the budget synchronously, BEFORE the async createImageBitmap.
        // A whole GOP decodes in one burst — output() fires for dozens of frames
        // before any bitmap resolves — so counting bytes only on resolve let the
        // eviction check pass every frame against a stale cacheBytes and land N
        // bitmaps at once (~2× budget peak). Reserving now makes each burst
        // frame's cacheEvictFor see the ones already in flight. Refunded on any
        // path that doesn't end up storing a live bitmap.
        cacheBytes += cacheFrameBytes;
        createImageBitmap(clone, { resizeWidth: cacheW, resizeHeight: cacheH })
            .then(bm => {
                clone.close();
                if (dead || cache.has(idx)) { bm.close(); cacheBytes -= cacheFrameBytes; return; }
                cache.set(idx, { bm: bm, pts: samples[idx].pts });
            })
            .catch(() => { cacheBytes -= cacheFrameBytes; try { clone.close(); } catch (_) {} });
    }

    let canvas = null, ctx2d = null;
    let dead = false;
    let suspended = false;  // decoder closed (playback owns the hardware pipeline);
                            // bytes/samples/cache retained, decoder recreated on next request
    let curKey = -1;        // decode index of the GOP keyframe the decoder is primed from
    let nextFeed = -1;      // next decode index to feed (-1 = no active run)
    let targetIdx = -1;     // decode index of the current target sample
    let targetPts = -1;     // seconds
    let paintFloor = -1;    // frames with pts ≤ this are closed unpainted (backward runs
                            // paint only the target — no flash-rewind through the GOP)
    let lastPaintedPts = -1;
    let framesPainted = 0;  // total painted (test/diagnostic surface)
    let pendingFrame = null; // newest paintable frame awaiting the next rAF
    let rafId = 0;
    // ── Predictive backward prefetch ─────────────────────────────────────
    // Sizing the cache to a GOP made backward travel free WITHIN a GOP, but
    // every GOP boundary crossed backward still cost a full re-decode from the
    // previous keyframe — ~100 ms at 2560×1440, which reads as a freeze (7-9 of
    // 61 drag requests painted nothing at all). Forward never pays this: it
    // extends the in-flight run. So when the user is scrubbing BACKWARD and
    // nears the start of the current GOP, speculatively decode the PREVIOUS one
    // into the cache while the decoder is otherwise idle. Crossing the boundary
    // then hits the cache instead of stalling on a decode.
    let lastReqIdx = -1;
    let scrubDir = 0;          // -1 backward, +1 forward (consecutive requests)
    let runIsPrefetch = false; // current run is speculative: cache, never paint
    let prefetchedKey = -1;    // GOP keyframe already prefetched (don't repeat)
    // How far into the current GOP to start fetching the previous one. It has to
    // be long enough that the speculative decode FINISHES before the user gets
    // there: a GOP costs ~100 ms at 2560×1440 while a drag covers ~3 frames per
    // move at ~11 ms/move. A flat 12 frames (~45 ms of lead) fired on schedule
    // but landed late — the user stalled on the prefetch run instead of a fresh
    // one and measured stalls barely moved (21 → 19). Scaling with the GOP got
    // backward drags to 100% cache hits and eliminated the freezes outright
    // (requests that painted nothing at all: 8 → 0).
    const PREFETCH_LEAD = Math.max(12, Math.round(maxGop * 0.6));
    let _lastFrameColorSpace = null; // diagnostic: what Chrome assigned to decoded frames

    // Paint at most once per display frame. Decode can outrun the display by an
    // order of magnitude (a whole GOP decodes in a burst); painting every output
    // synchronously floods the main thread with drawImage calls and starves the
    // drag's mousemove handling — the stutter this replaced.
    function paintPending() {
        rafId = 0;
        const f = pendingFrame;
        pendingFrame = null;
        if (!f) return;
        if (!dead && ctx2d) {
            ctx2d.drawImage(f, 0, 0, canvas.width, canvas.height);
            lastPaintedPts = f.timestamp / 1e6;
            framesPainted++;
        }
        f.close();
    }

    // Named callbacks (not inline) so a suspended session can build a FRESH
    // VideoDecoder around the same logic — see suspend()/the resume in request().
    function _onDecoderOutput(frame) {
            // reset() discards pending outputs, so anything arriving here belongs
            // to the current run. Cache emitted frames near the target (positions
            // the user may revisit — the distance gate in cacheStore skips ones
            // that would be evicted immediately), then retain the newest paintable
            // one; the rAF tick paints it. Superseded frames close immediately.
            if (!_lastFrameColorSpace && frame.colorSpace) {
                const cs = frame.colorSpace;
                _lastFrameColorSpace = {
                    primaries: cs.primaries, transfer: cs.transfer,
                    matrix: cs.matrix, fullRange: cs.fullRange
                };
                // Late HDR guard for streams tagged only in the bitstream (no
                // colr box): kill the session before painting un-tone-mapped
                // frames and clear anything already on the canvas so the
                // <video> shows through; the controller falls back to seeks.
                if (cs.transfer === 'pq' || cs.transfer === 'hlg') {
                    dead = true;
                    if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
                    frame.close();
                    try { decoder.close(); } catch (_) {}
                    return;
                }
            }
            cacheStore(frame);
            const ptsS = frame.timestamp / 1e6;
            // runIsPrefetch: a speculative run's frames are the PAST relative to
            // where the user is looking — cache them, never paint them.
            if (dead || !ctx2d || runIsPrefetch ||
                ptsS <= paintFloor || ptsS > targetPts + frameDur * 0.5) {
                frame.close();
                return;
            }
            if (pendingFrame) pendingFrame.close();
            pendingFrame = frame;
            if (!rafId) rafId = requestAnimationFrame(paintPending);
    }
    function _onDecoderError() { dead = true; try { decoder.close(); } catch (_) {} }

    let decoder = new VideoDecoder({ output: _onDecoderOutput, error: _onDecoderError });

    let readyResolve;
    const ready = new Promise(r => { readyResolve = r; });
    // isConfigSupported first — configure() on an unsupported codec hard-errors the decoder
    try {
        VideoDecoder.isConfigSupported(config).then(res => {
            if (dead || !res.supported) { dead = true; readyResolve(false); return; }
            decoder.configure(config);
            readyResolve(true);
        }).catch(() => { dead = true; readyResolve(false); });
    } catch (_) {
        dead = true;
        readyResolve(false);
    }

    // Greatest presentation index with pts ≤ t (binary search over byPts)
    function targetForTime(t) {
        let lo = 0, hi = byPts.length - 1, best = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (byPts[mid].pts <= t + frameDur * 0.25) { best = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return byPts[best].idx;
    }

    // Nearest keyframe at or before decode index i
    function keyBefore(i) {
        for (let k = i; k >= 0; k--) if (samples[k].key) return k;
        return 0;
    }

    // Last decode index belonging to the GOP that starts at keyframe `key`
    function gopEndFor(key) {
        for (let i = key + 1; i < nSamples; i++) if (samples[i].key) return i - 1;
        return nSamples - 1;
    }

    // Decode a whole GOP into the cache without painting any of it. Targets the
    // GOP's LAST frame so cacheStore's distance gate (centred on targetPts)
    // spans the run — with the GOP-sized budget every frame in it survives.
    function startPrefetch(gopKey) {
        if (dead || suspended || decoder.state !== 'configured') return;
        try {
            decoder.reset();
            decoder.configure(config);
        } catch (_) { dead = true; return; }
        if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
        runIsPrefetch = true;
        prefetchedKey = gopKey;
        curKey = gopKey;
        nextFeed = gopKey;
        targetIdx = gopEndFor(gopKey);
        targetPts = samples[targetIdx].pts;
        pump();
    }

    // Called when a request was served from cache — i.e. the decoder is idle and
    // the user is coasting through already-decoded frames. That is exactly the
    // slack in which to decode the GOP they are about to reach.
    function maybePrefetchBackward(idx, key) {
        if (scrubDir >= 0 || dead || suspended) return;
        if (decoder.state !== 'configured' || decoder.decodeQueueSize > 0) return; // busy
        if (idx - key > PREFETCH_LEAD) return;   // still deep in the current GOP
        if (key <= 0) return;                    // nothing before this one
        const prevKey = keyBefore(key - 1);
        if (prevKey === prefetchedKey) return;   // already fetched this one
        if (cache.has(gopEndFor(prevKey))) return; // already warm
        startPrefetch(prevKey);
    }

    function feedOne(i) {
        const s = samples[i];
        decoder.decode(new EncodedVideoChunk({
            type: s.key ? 'key' : 'delta',
            timestamp: Math.round(s.pts * 1e6),
            data: bytes.subarray(s.offset, s.offset + s.size)
        }));
    }

    // Feed until the target is submitted, respecting decoder backpressure.
    // A few samples PAST the target are fed too (reorder margin) so the target
    // frame is released from the decoder's reorder buffer without a flush()
    // (flush() would force the next chunk to be a keyframe, killing forward
    // continuation). Their outputs land past targetPts and are closed unpainted.
    const REORDER_MARGIN = 8;
    function pump() {
        if (dead || nextFeed < 0 || decoder.state !== 'configured') return;
        const stop = Math.min(targetIdx + REORDER_MARGIN, nSamples - 1);
        while (nextFeed <= stop && decoder.decodeQueueSize < 24) {
            feedOne(nextFeed++);
        }
        if (nextFeed <= stop) decoder.addEventListener('dequeue', pump, { once: true });
    }

    return {
        ready: ready,
        width: info.codedWidth,
        height: info.codedHeight,
        sampleCount: nSamples,
        codec: info.codec,
        get framesPainted() { return framesPainted; },
        get lastPaintedPts() { return lastPaintedPts; },
        get dead() { return dead; },
        get suspended() { return suspended; },
        get cacheStats() { return { frames: cache.size, bytes: cacheBytes, hits: cacheHits }; },
        get frameColorSpace() { return _lastFrameColorSpace; },

        attach(canvasEl, colorSpaceOverride) {
            canvas = canvasEl;
            canvas.width = info.codedWidth || 640;
            canvas.height = info.codedHeight || 360;
            // On wide-gamut (P3) displays, macOS composites <video> through a
            // BT.709→P3 mapping that an sRGB canvas doesn't get — the overlay
            // reads darker than the video it covers (same issue that forced the
            // pixel magnifier to use a cloned <video>; see CLAUDE.md). Painting
            // into a display-p3 canvas keeps the conversion in the same gamut.
            // colorSpaceOverride ('srgb' | 'display-p3') is a calibration hook.
            const mode = colorSpaceOverride ||
                ((window.matchMedia && matchMedia('(color-gamut: p3)').matches) ? 'display-p3' : 'srgb');
            let ctx = null;
            if (mode === 'display-p3') {
                try { ctx = canvas.getContext('2d', { colorSpace: 'display-p3' }); }
                catch (_) { /* colorSpace unsupported — fall through */ }
            }
            ctx2d = ctx || canvas.getContext('2d');
        },

        // direct=true: this is a discrete seek (a click, or the initial position
        // before any drag movement), so paint ONLY the target frame — suppress the
        // progressive fast-forward through the GOP that makes a *drag* feel smooth
        // but reads as "frames speeding past in an instant" on a single click.
        request(t, direct) {
            if (dead) return;
            // Resume from suspension: playback start closed the decoder (it holds
            // a hardware pipeline) but kept the file bytes, demuxed samples, and
            // the ImageBitmap cache. Recreating + reconfiguring here costs
            // milliseconds; the full close() path would force a refetch of the
            // entire file, a re-demux, and a cold cache on every scrub after play.
            if (suspended) {
                try {
                    decoder = new VideoDecoder({ output: _onDecoderOutput, error: _onDecoderError });
                    decoder.configure(config);   // config already validated by isConfigSupported at init
                } catch (_) { dead = true; return; }
                suspended = false;
            }
            if (decoder.state !== 'configured') return;
            const idx = targetForTime(t);
            const key = keyBefore(idx);
            const pts = samples[idx].pts;
            // Travel direction, from consecutive requests — drives the backward
            // prefetch below. Unchanged positions (jitter) don't flip it.
            if (lastReqIdx >= 0 && idx !== lastReqIdx) scrubDir = idx < lastReqIdx ? -1 : 1;
            lastReqIdx = idx;
            // Cache hit — paint instantly, no decode. Neutralize any in-flight
            // run's painting (its outputs keep caching but stop painting) by
            // moving the target/floor to the served frame.
            const hit = cache.get(idx);
            if (hit && ctx2d) {
                ctx2d.drawImage(hit.bm, 0, 0, canvas.width, canvas.height);
                cacheHits++;
                framesPainted++;
                lastPaintedPts = pts;
                targetPts = pts;
                paintFloor = pts - frameDur * 0.5;
                if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
                // Decoder is idle and the user is coasting on cache — use the
                // slack to fetch the GOP they're heading into.
                maybePrefetchBackward(idx, key);
                return;
            }
            if (nextFeed >= 0 && key === curKey && idx + REORDER_MARGIN >= nextFeed) {
                // Same GOP, at/ahead of decode progress — retarget and keep the
                // run. This covers forward extension AND backward wobbles whose
                // frame hasn't been decoded yet (target 10s, decode at 5s, wobble
                // to 9.9s) — no reset needed, the run just stops sooner.
                targetPts = pts;
                targetIdx = idx;
                // A real target claims the run: resume painting. (The user
                // reached the GOP a prefetch was still filling — keep the
                // decoded progress, just stop suppressing output.)
                if (runIsPrefetch) { runIsPrefetch = false; paintFloor = pts - frameDur; }
                // Discrete seek forward within the GOP: lift the paint floor to
                // the target so the intervening frames decode (needed to release
                // the target) but don't paint — no fast-forward flash on a click.
                else if (direct) paintFloor = pts - frameDur;
                pump();
                return;
            }
            // Backward-jitter tolerance: real drags constantly wobble a few pixels
            // backward. If we're already showing (approximately) the requested
            // frame, do nothing — a reset here would re-decode the whole GOP on
            // every wobble, which reads as stutter.
            if (nextFeed >= 0 && key === curKey &&
                pts >= lastPaintedPts - 2 * frameDur && pts <= lastPaintedPts + frameDur) {
                return;
            }
            // Genuine backward jump or new GOP — restart from the keyframe.
            // reset() discards queued work and unconfigures; reconfigure explicitly.
            try {
                decoder.reset();
                decoder.configure(config);
            } catch (_) { dead = true; return; }
            // Backward runs paint only the target frame (intermediates from the
            // keyframe are the PAST — painting them flashes a rewind). Forward
            // cross-GOP DRAG runs keep the progressive fast-forward feel; a
            // discrete forward seek (direct) paints only the target, same as a
            // backward run — no fast-forward flash on a click.
            runIsPrefetch = false;   // a real target owns the decoder again
            paintFloor = (direct || pts < lastPaintedPts) ? pts - frameDur : lastPaintedPts;
            if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
            targetPts = pts;
            curKey = key;
            nextFeed = key;
            targetIdx = idx;
            pump();
        },

        // Playback-start teardown: release ONLY the VideoDecoder (the hardware
        // pipeline that competes with 2-3 playing <video> elements) and the
        // in-flight run state. The file bytes, demuxed sample table, and the
        // decoded-frame ImageBitmap cache all survive — they're inert memory,
        // and dropping them forced every post-play scrub to refetch + re-demux
        // the whole file with a cold cache (GC churn = choppy playback after
        // continued use; cold cache = reverse scrubs re-decode everything).
        // request() lazily resumes. Idempotent; no-op after close().
        suspend() {
            if (dead || suspended) return;
            suspended = true;
            curKey = -1;
            nextFeed = -1;
            targetIdx = -1;
            targetPts = -1;
            paintFloor = -1;
            lastPaintedPts = -1;
            runIsPrefetch = false;
            prefetchedKey = -1;
            lastReqIdx = -1;
            scrubDir = 0;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
            try { decoder.close(); } catch (_) {}
        },

        close() {
            dead = true;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
            for (const v of cache.values()) v.bm.close();
            cache.clear();
            cacheBytes = 0;
            try { decoder.close(); } catch (_) {}
            canvas = null;
            ctx2d = null;
        }
    };
}
