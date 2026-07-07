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
// revisit cache holds display-capped ImageBitmaps under a ~96 MB budget.
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
    // (scrub preview quality; a 4K frame would be ~33 MB raw) and the cache
    // holds ~96 MB, evicting the entries farthest from the current target.
    const CACHE_BUDGET = 96 * 1024 * 1024;
    const cacheScale = Math.min(1, 1280 / (info.codedWidth || 1280));
    const cacheW = Math.max(2, Math.round((info.codedWidth || 640) * cacheScale));
    const cacheH = Math.max(2, Math.round((info.codedHeight || 360) * cacheScale));
    const cacheFrameBytes = cacheW * cacheH * 4;
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

    const decoder = new VideoDecoder({
        output(frame) {
            // reset() discards pending outputs, so anything arriving here belongs
            // to the current run. Cache EVERY emitted frame (even ones that won't
            // paint — they're positions the user may revisit), then retain the
            // newest paintable one; the rAF tick paints it. Superseded frames
            // close immediately.
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
            if (dead || !ctx2d || ptsS <= paintFloor || ptsS > targetPts + frameDur * 0.5) {
                frame.close();
                return;
            }
            if (pendingFrame) pendingFrame.close();
            pendingFrame = frame;
            if (!rafId) rafId = requestAnimationFrame(paintPending);
        },
        error() { dead = true; try { decoder.close(); } catch (_) {} }
    });

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

        request(t) {
            if (dead || decoder.state !== 'configured') return;
            const idx = targetForTime(t);
            const key = keyBefore(idx);
            const pts = samples[idx].pts;
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
                return;
            }
            if (nextFeed >= 0 && key === curKey && idx + REORDER_MARGIN >= nextFeed) {
                // Same GOP, at/ahead of decode progress — retarget and keep the
                // run. This covers forward extension AND backward wobbles whose
                // frame hasn't been decoded yet (target 10s, decode at 5s, wobble
                // to 9.9s) — no reset needed, the run just stops sooner.
                targetPts = pts;
                targetIdx = idx;
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
            // cross-GOP runs keep the progressive fast-forward feel.
            paintFloor = pts < lastPaintedPts ? pts - frameDur : lastPaintedPts;
            if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
            targetPts = pts;
            curKey = key;
            nextFeed = key;
            targetIdx = idx;
            pump();
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
