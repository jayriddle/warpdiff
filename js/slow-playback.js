// Local, opt-in experiment. The media element owns transport; this adapter owns
// which listening branch feeds the existing native-output gain (mute/switches).
// Reusable stream, PCM budget and retirement → playback-audio-core.js.
const _slowPlayback = (() => {
    const enabled = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        && new URLSearchParams(location.search).get('slowAudio') === 'signalsmith';
    let selected = null, revision = 0, timer = null, queued = false, pending = false;
    let status = 'idle', notice = false, suppressed = false;
    let retiring = Promise.resolve(true);
    const engine = WarpPlaybackAudio.create({workletUrl:'js/signalsmith-worklet.js', maxBufferBytes:64 * 1024 * 1024,
        onError:message => { fallback(message); }});
    function branch(route, slow, at = route.ctx.currentTime) {
        if (!route.slowGain) return;
        const now = route.ctx.currentTime;
        for (const [gain, value] of [[route.nativeGain, slow ? 0 : 1], [route.slowGain, slow ? route.media.volume : 0]]) {
            _scheduleAudioGain(gain, _audioGainAtTime(gain, now), value, Math.max(now, at), .015);
        }
    }
    function fallback(message) {
        status = 'fallback';
        if (selected) branch(selected.route, false);
        if (!notice) { notice = true; showLoadToast('Slow-audio experiment: using browser playback. ' + message, true, 6000); }
    }
    function release() {
        ++revision;
        if (selected) branch(selected.route, false);
        selected = null;
        pending = false;
        status = 'idle';
        // Let the outgoing branch finish its envelope before retiring its node.
        // Serialize all releases so a stale timer cannot reset a newer stream.
        retiring = retiring.then(() => new Promise(resolve => setTimeout(resolve, 20))).then(() => engine.reset());
        return retiring;
    }
    function candidate() {
        if (!enabled || suppressed || isDragging || _scrubAudioClockId) return null;
        const slot = currentAudioSource || assetOrder[currentAssetIndex];
        const media = getLayer(slot)?.querySelector('video, audio');
        if (!media || _opusSyncSlots[slot] || media.playbackRate >= 1 || media.playbackRate <= 0) return null;
        const route = _nativeAudioRoutes.get(media);
        const buffer = _videoAudioBuffers[slot] || _audioSlotVizData[slot]?.audioBuffer;
        return route?.slowGain && buffer ? {slot, media, route, buffer} : null;
    }
    function deviceLead(ctx) {
        const stamp = ctx.getOutputTimestamp?.();
        const audible = stamp?.contextTime > 0 && stamp.performanceTime > 0
            ? stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000 : null;
        return Math.max(0, Math.min(.25, audible === null ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : ctx.currentTime - audible));
    }
    async function anchor(own) {
        if (!selected || pending) return;
        const target = selected, {media, route, slot} = target, ctx = route.ctx;
        if (media.paused || media.seeking || media.readyState < 3 || route.waiting) {
            branch(route, false);
            engine.stop(); status = 'ready';
            return;
        }
        pending = true;
        // Preloaded history compensates the DSP delay. Give its lookahead time
        // to render while native audio bridges preparation. Hardware queue lead
        // is separate: media.currentTime corresponds to what is heard now.
        const at = ctx.currentTime + engine.state.latency + .03;
        const rate = media.playbackRate;
        const offset = media.currentTime - (_audioTimelineStarts[slot] || 0)
            + (at - ctx.currentTime + deviceLead(ctx)) * rate;
        const plan = await engine.schedule({offset, at, rate});
        if (revision !== own || selected !== target) return;
        pending = false;
        if (!plan || media.paused || media.seeking || rate !== media.playbackRate) { queue(); return; }
        branch(route, true, at); status = 'playing';
    }
    function refresh(force = false) {
        if (!enabled) return;
        const next = candidate();
        if (!next) { if (selected) release(); return; }
        if (selected?.media !== next.media || selected.buffer !== next.buffer) {
            const retired = release();
            selected = next;
            const own = revision;
            status = 'preparing';
            // Scrub and playback share the selected-stream memory allowance.
            Promise.all([retired, _resetContinuousScrub()]).then(async () => {
                if (revision !== own) return;
                engine.setMonitorMix(_audioMonitorPlanForSlot(next.slot));
                if (!await engine.load(next.route.ctx, next.buffer) || revision !== own) return;
                engine.state.node.connect(next.route.slowGain);
                next.connected = true;
                await anchor(own);
            }).catch(e => { if (revision === own) fallback(String(e.message || e)); });
            return;
        }
        if (!selected.connected || !engine.state.ready || pending) return;
        const {media, route, slot} = selected, state = engine.state;
        const expected = state.anchor && state.anchor.offset
            + (route.ctx.currentTime - deviceLead(route.ctx) - state.anchor.at) * state.anchor.rate;
        const drift = expected === null ? Infinity : Math.abs(expected - (media.currentTime - (_audioTimelineStarts[slot] || 0)));
        if (force || !state.anchor || media.paused || media.seeking || route.waiting || drift > .06) anchor(revision);
    }
    function queue(force = true) {
        if (!enabled || queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; refresh(force); });
    }
    return Object.freeze({enabled,
        attach(media, route) {
            if (!enabled) return;
            route.media = media;
            route.slowGain = route.ctx.createGain();
            _scheduleAudioGain(route.slowGain, 0, 0, route.ctx.currentTime);
            route.slowGain.connect(route.gain);
            route.slowEvent = event => {
                if (event.type === 'playing') { route.waiting = false; suppressed = false; }
                if (event.type === 'waiting') route.waiting = true;
                if (selected?.media !== media && media.dataset.slot !== currentAudioSource) return;
                if (event.type === 'volumechange') {
                    if (selected?.media === media && status === 'playing') branch(route, true, engine.state.anchor?.at);
                    return;
                }
                // Silence stale processed audio immediately on discontinuities.
                if (['pause', 'seeking', 'waiting', 'ratechange', 'ended'].includes(event.type) && selected?.media === media) {
                    if (selected.connected) ++revision;
                    pending = false; branch(route, false); engine.stop();
                }
                queue();
            };
            for (const type of ['play','playing','pause','seeking','seeked','waiting','ratechange','ended','volumechange']) media.addEventListener(type, route.slowEvent);
            if (!timer) timer = setInterval(() => refresh(), 250);
            queue();
        },
        detach(media, route) {
            if (!route.slowEvent) return;
            for (const type of ['play','playing','pause','seeking','seeked','waiting','ratechange','ended','volumechange']) media.removeEventListener(type, route.slowEvent);
            route.slowGain.disconnect();
            route.nativeGain.disconnect();
        },
        refresh:queue,
        setMix() { if (selected) engine.setMonitorMix(_audioMonitorPlanForSlot(selected.slot)); },
        forScrub() { if (!enabled) return Promise.resolve(true); suppressed = true; return release(); },
        clear() {
            clearInterval(timer); timer = null;
            suppressed = false; notice = false;
            return enabled ? release() : Promise.resolve(true);
        },
        get ownsStream() { return enabled && !!selected; },
        get state() { return {enabled, status, slot:selected?.slot || null, ...engine.state}; }
    });
})();
