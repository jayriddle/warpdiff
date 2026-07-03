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
// Memory note (spike): the session retains the full file bytes and closes every
// VideoFrame immediately after drawImage — no frame cache yet (phase 2).
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

    let canvas = null, ctx2d = null;
    let dead = false;
    let curKey = -1;        // decode index of the GOP keyframe the decoder is primed from
    let nextFeed = -1;      // next decode index to feed (-1 = no active run)
    let targetIdx = -1;     // decode index of the current target sample
    let targetPts = -1;     // seconds
    let lastPaintedPts = -1;
    let framesPainted = 0;  // total painted (test/diagnostic surface)

    const decoder = new VideoDecoder({
        output(frame) {
            // reset() discards pending outputs, so anything arriving here belongs
            // to the current run. Paint progressively up to the target; close past it.
            const ptsS = frame.timestamp / 1e6;
            if (!dead && ctx2d && ptsS <= targetPts + frameDur * 0.5) {
                ctx2d.drawImage(frame, 0, 0, canvas.width, canvas.height);
                lastPaintedPts = ptsS;
                framesPainted++;
            }
            frame.close();
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

        attach(canvasEl) {
            canvas = canvasEl;
            canvas.width = info.codedWidth || 640;
            canvas.height = info.codedHeight || 360;
            ctx2d = canvas.getContext('2d');
        },

        request(t) {
            if (dead || decoder.state !== 'configured') return;
            const idx = targetForTime(t);
            const key = keyBefore(idx);
            targetPts = samples[idx].pts;
            if (nextFeed >= 0 && key === curKey && idx >= targetIdx) {
                // Same GOP, at/ahead of the current target — extend the run forward.
                targetIdx = idx;
                pump();
            } else {
                // New GOP, or backward within the GOP — restart from the keyframe.
                // reset() discards queued work and unconfigures; reconfigure explicitly.
                try {
                    decoder.reset();
                    decoder.configure(config);
                } catch (_) { dead = true; return; }
                curKey = key;
                nextFeed = key;
                targetIdx = idx;
                pump();
            }
        },

        close() {
            dead = true;
            try { decoder.close(); } catch (_) {}
            canvas = null;
            ctx2d = null;
        }
    };
}
