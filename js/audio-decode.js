// Audio decode pipeline — extracted from index.html.
// Three-tier decode (decodeAudioData → WebCodecs AudioDecoder → ffmpeg transcode via
// _onAllDecodeFailed routing) plus finalize/viz wiring. STATEFUL: these functions read
// and write app globals (mediaData, _opusSync*, waveformData, audioMetrics, the two
// decode-generation counters, …) and call helpers that remain in index.html — they
// resolve via the shared global scope of classic <script>s (same as js/hotkeys.js).
// Single decode owners per concern; see tests/ownership.test.mjs for the guards.

function _nextAudioDecodeGeneration() {
    _audioDecodeEpoch += 1;
    return _audioDecodeEpoch;
}

function _videoAudioDecodeIsCurrent(slot, gen) {
    return _videoAudioDecodeGen[slot] === gen;
}

function _audioBufferTimeForTimeline(timelineTime, timelineStart) {
    const start = Number.isFinite(timelineStart) && timelineStart > 0 ? timelineStart : 0;
    return timelineTime - start;
}

function _audioTimelineWarningText(slotLabels) {
    if (!Array.isArray(slotLabels) || slotLabels.length === 0) return '';
    return 'Audio start timestamp unavailable for ' + slotLabels.join(', ') +
        ' — the container does not expose where audio begins. Decoded-audio views and tools are using a fallback timeline; verify A/V sync.';
}

// One owner for both the numeric fallback used by decoded-audio tools and the confidence attached to
// it. Numeric zero can be authoritative, so confidence must not be inferred from the stored number.
function _setAudioTimelineMetadata(slot, timelineStart) {
    const known = Number.isFinite(timelineStart);
    _audioTimelineStarts[slot] = known && timelineStart > 0 ? timelineStart : 0;
    _audioTimelineStartKnown[slot] = known;
    _renderAudioTimelineAlert();
}

function _renderAudioTimelineAlert() {
    const el = document.getElementById('audioTimingAlert');
    if (!el) return;
    const unknown = assetOrder.filter(slot =>
        mediaData[slot] && mediaData[slot].type === 'video' && _audioTimelineStartKnown[slot] === false
    ).map(slotLabel);
    const text = _audioTimelineWarningText(unknown);
    el.hidden = !text;
    el.textContent = text;
}

async function decodeAndComputeAudioViz(slot, source) {
    // Generation guard: a reload/clear during the async decode below must not
    // let a stale completion write this slot's viz/metrics/Opus state (or mute
    // the *new* video). Mirrors the audio-only decodeAndComputeAudioSlotViz; the
    // captured gen is threaded through _decodeAudioWebCodecs → _finalizeAudioViz.
    _videoAudioDecodeGen[slot] = _nextAudioDecodeGeneration();
    const gen = _videoAudioDecodeGen[slot];
    // Each decode is authoritative about Opus-pending — clear any stale flag so a
    // previous file's pending state can't spuriously activate sync on this one.
    delete _opusSyncPending[slot];
    // Read file once upfront — avoid re-reading in the catch path
    const arrayBuffer = source instanceof File
        ? await source.arrayBuffer()
        : source;
    if (!_videoAudioDecodeIsCurrent(slot, gen)) return;

    // Detect Opus from file bytes — needed to activate Chrome sync correction.
    // Scan first and last 64KB for 'Opus' (MP4) or 'A_OPUS' (WebM).
    const bytes = new Uint8Array(arrayBuffer);
    const isMP4 = bytes.length > 7 &&
        bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    let timelineStart = null;
    if (isMP4) {
        try {
            const timing = _demuxMP4Audio(bytes, true);
            if (timing && Number.isFinite(timing.timelineStart)) timelineStart = timing.timelineStart;
        } catch (e) {
            console.warn('[audio-timeline] MP4 timing parse failed for', slot, e);
        }
    }
    let isOpus = false;
    const scanRegions = [
        [0, Math.min(bytes.length, 65536)],
        [Math.max(0, bytes.length - 65536), bytes.length]
    ];
    for (const [s, e] of scanRegions) {
        for (let i = s; i < e - 3; i++) {
            if (bytes[i] === 0x4F && bytes[i+1] === 0x70 && bytes[i+2] === 0x75 && bytes[i+3] === 0x73) { isOpus = true; break; }
        }
        if (isOpus) break;
    }
    if (_isChrome && isOpus) _opusSyncPending[slot] = true;

    // Byte-scan for unsupported codec signatures — used as a tiebreaker when
    // both decodeAudioData and AudioDecoder fail. Only triggers transcode on
    // combined failure, so false positives on multi-track files are harmless.
    const _byteCodecKeys = Object.keys(_UNSUPPORTED_CODEC_LABELS);
    const _byteCodecBytes = {
        'ac-3': [0x61,0x63,0x2D,0x33], 'ec-3': [0x65,0x63,0x2D,0x33],
        'dtsc': [0x64,0x74,0x73,0x63], 'dtse': [0x64,0x74,0x73,0x65],
        'dtsh': [0x64,0x74,0x73,0x68], 'dtsl': [0x64,0x74,0x73,0x6C],
        'mlpa': [0x6D,0x6C,0x70,0x61]
    };
    delete _byteScannedCodec[slot];
    outer: for (const [rs, re] of scanRegions) {
        for (let i = rs; i < re - 3; i++) {
            for (const k of _byteCodecKeys) {
                const b = _byteCodecBytes[k];
                if (bytes[i]===b[0] && bytes[i+1]===b[1] && bytes[i+2]===b[2] && bytes[i+3]===b[3]) {
                    _byteScannedCodec[slot] = k;
                    break outer;
                }
            }
        }
    }

    // For Opus on Chrome, always use WebCodecs — decodeAudioData succeeds but
    // produces wrong timing. For Safari, decodeAudioData hangs on Opus so the
    // timeout catches it. For non-Opus, decodeAudioData works correctly.
    if (_isChrome && isOpus && typeof AudioDecoder !== 'undefined') {
        _decodeAudioWebCodecs(slot, arrayBuffer, gen);
        return;
    }

    try {
        const ctx = getAudioContext();
        const decodePromise = ctx.decodeAudioData(arrayBuffer.slice(0));
        const hasWebCodecs = typeof AudioDecoder !== 'undefined';
        const audioBuffer = await Promise.race([
            decodePromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('decode timeout')), hasWebCodecs ? 1000 : 30000))
        ]);
        _finalizeAudioViz(slot, audioBuffer, gen, timelineStart);
    } catch (e) {
        if (!_videoAudioDecodeIsCurrent(slot, gen)) return;
        if (typeof AudioDecoder !== 'undefined') {
            console.warn('Audio decode failed/timeout for', slot, '— trying WebCodecs fallback');
            _opusSyncPending[slot] = true;
            _decodeAudioWebCodecs(slot, arrayBuffer, gen);
        } else {
            console.warn('Audio decode failed for', slot, e);
            _onAllDecodeFailed(slot, false, gen);
        }
    }
}

function _onAllDecodeFailed(slot, audioConfirmed, gen) {
    if (!_videoAudioDecodeIsCurrent(slot, gen)) return;
    if (_ffmpegCommands[slot]) return; // already registered
    const filename = mediaData[slot] && mediaData[slot].name;
    if (!filename) return;
    const codec = _byteScannedCodec[slot] || 'unknown';
    // For video files with no detected unsupported codec AND no demuxed
    // audio packets, decode failure means there's actually no audio track.
    // If audioConfirmed is true (WebCodecs got packets but couldn't decode
    // them — e.g. AAC with malformed AudioSpecificConfig, weird HE-AAC
    // variant, or corrupt frames), fall through to transcode — ffmpeg
    // routinely handles streams that WebCodecs rejects.
    if (mediaData[slot] && mediaData[slot].type === 'video' && codec === 'unknown' && !audioConfirmed) {
        _markSlotNoAudio(slot);
        return;
    }
    _registerFfmpegCommand(slot, filename, codec);
}

function _finalizeAudioViz(slot, audioBuffer, gen, timelineStart = null) {
    // Drop stale completions — a reload/clear during the async decode chain
    // bumps _videoAudioDecodeGen, so this slot no longer belongs to this decode.
    // Without this, a previous file's decode could overwrite the new slot's
    // viz/metrics/buffer, activate Opus sync, and mute the new video.
    if (gen !== undefined && _videoAudioDecodeGen[slot] !== gen) return;
    _setAudioTimelineMetadata(slot, timelineStart);
    waveformData[slot] = computeWaveformData(audioBuffer, 600);
    spectrogramData[slot] = computeSpectrogramData(audioBuffer);
    const _mf = computeAudioMetrics(audioBuffer);
    audioMetrics[slot] = _mf;
    // Propagate envelope data to the slot viz data if it already exists (no-video mode)
    if (_audioSlotVizData[slot]) _audioSlotVizData[slot].lufsEnvelope = _mf ? _mf.stBlks : null;
    _updateMetricSpans(slot);

    // If this slot just finished a transcode, advance toast to 'done' now
    if (_ffmpegTranscoding[slot] && _ffmpegTranscoding[slot].phase === 'computing') {
        const doneState = { phase: 'done', loadEpoch: _ffmpegLoadEpoch };
        _ffmpegTranscoding[slot] = doneState;
        _updateTranscodeDOM(slot); _updateTranscodeToast(slot);
        setTimeout(() => {
            if (doneState.loadEpoch === _ffmpegLoadEpoch && _ffmpegTranscoding[slot] === doneState) {
                delete _ffmpegTranscoding[slot];
            }
        }, 3000);
    }
    delete audioFileBuffers[slot];

    // Store AudioBuffer for scrub audio.
    // Opus sync slots (Chrome) need full quality for correct A/V playback.
    // All other slots get a channel-preserving 22050 Hz copy. Keeping channels
    // separate prevents anti-phase stereo (L = -R) cancelling to silence.
    // decodeAudioData returns a real AudioBuffer; the WebCodecs path
    // returns a fake object — normalize it first via createBuffer + copyToChannel.
    try {
        let buf;
        if (audioBuffer instanceof AudioBuffer) {
            buf = audioBuffer;
        } else {
            const ctx = getAudioContext();
            const nCh = audioBuffer.numberOfChannels || 1;
            buf = ctx.createBuffer(nCh, audioBuffer.length, audioBuffer.sampleRate);
            for (let c = 0; c < nCh; c++) buf.copyToChannel(audioBuffer.getChannelData(c), c);
        }
        _videoAudioBuffers[slot] = (_isChrome && _opusSyncPending[slot])
            ? buf                        // full quality — needed for Opus A/V sync
            : _downsampleForScrub(buf);  // channel-preserving 22050 Hz scrub copy
    } catch (_) {} // non-critical — scrub audio just won't work

    // Activate Chrome Opus sync only for slots that used WebCodecs
    // (meaning decodeAudioData failed/timed out — i.e. Opus in Safari,
    // or the fake buffer path). For Chrome, _opusSyncPending marks slots
    // that should use Web Audio replacement.
    if (_isChrome && _opusSyncPending[slot] && _videoAudioBuffers[slot] && hasVideos) {
        _opusSyncSlots[slot] = true;
        _opusSyncActive = true;
        _opusSyncDuration[slot] = _audioTimelineStarts[slot] + _videoAudioBuffers[slot].duration;
        const layer = getLayer(slot);
        const video = layer && layer.querySelector('video');
        if (video) video.muted = true;
        // Refresh the info bar duration — it was rendered with the inflated
        // raw video.duration at load time, before _opusSyncDuration was known.
        updateDurationDisplay(slot, _opusSyncDuration[slot], videoFrameRates[video && video.src] || null);
        _reconcileSoloEffectiveDuration(slot);
        // If video is already playing, start sync audio immediately
        if (video && !video.paused) _startOpusSyncAudio(slot, video.currentTime);
    }

    // Draw if this is the currently active/visible slot
    const activeSlot = assetOrder[currentAssetIndex];
    if (slot === activeSlot || slot === currentAudioSource) {
        updateAudioVisForSlot(slot);
    }

    // If no-video mode is active, populate viz data and draw canvas now
    if (_noVideoMode && hasVideos) {
        _populateNoVideoSlotData(slot);
        drawAudioSlotCanvas(slot);
    }
}

function _decodeAudioWebCodecs(slot, arrayBuffer, gen) {
    if (!_videoAudioDecodeIsCurrent(slot, gen)) return;
    if (typeof AudioDecoder === 'undefined') {
        console.warn('WebCodecs AudioDecoder not available for', slot);
        return;
    }
    _webcodecsStarted(slot, gen);

    const bytes = new Uint8Array(arrayBuffer);

    // Detect container format from first bytes
    const isMP4 = bytes.length > 7 &&
        bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // 'ftyp'
    const isWebM = bytes.length > 3 &&
        bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3; // EBML

    let extracted = null;
    if (isMP4) {
        extracted = _demuxMP4Audio(bytes);
    } else if (isWebM) {
        extracted = _demuxWebMAudio(bytes);
    } else {
        console.warn('Unknown container format for', slot);
        _onAllDecodeFailed(slot, false, gen);
        _webcodecsFinished(slot, gen);
        return;
    }

    if (!extracted || extracted.chunks.length === 0) {
        console.warn('No audio packets extracted for', slot);
        // For video files with no unsupported codec detected, empty chunks means
        // no audio track — not a codec problem. Avoid triggering ffmpeg.
        if (mediaData[slot] && mediaData[slot].type === 'video' && !_byteScannedCodec[slot]) {
            if (_videoAudioDecodeIsCurrent(slot, gen)) _markSlotNoAudio(slot);
        } else {
            _onAllDecodeFailed(slot, false, gen);
        }
        _webcodecsFinished(slot, gen);
        return;
    }

    console.log('[webcodecs] ' + slot + ': found ' + extracted.chunks.length + ' packets, ' +
        'rate=' + extracted.sampleRate + ', ch=' + extracted.channels +
        ', codec=' + extracted.codec + ', container=' + (isMP4 ? 'mp4' : 'webm'));

    // If the demuxer found an unsupported primary codec, register for transcode
    // and bail — don't pass it to AudioDecoder which will just error.
    // extracted.codec is the raw stsd box type (e.g. 'ec-3', 'ac-3', 'dtsc')
    // which maps directly to _UNSUPPORTED_CODEC_LABELS keys.
    const _demuxedCodec = extracted.codec || '';
    if (_UNSUPPORTED_CODEC_LABELS.hasOwnProperty(_demuxedCodec)) {
        console.warn('[webcodecs] ' + slot + ': primary codec ' + _demuxedCodec + ' is unsupported — registering for transcode');
        const filename = mediaData[slot] && mediaData[slot].name;
        if (filename && _videoAudioDecodeIsCurrent(slot, gen)) _registerFfmpegCommand(slot, filename, _demuxedCodec);
        _webcodecsFinished(slot, gen);
        return;
    }

    _decodeWithAudioDecoder(slot, extracted, gen);
}

function _decodeWithAudioDecoder(slot, extracted, gen) {
    const decodedChunks = [];
    let decodeError = false;

    const decoder = new AudioDecoder({
        output: function(audioData) {
            const chData = [];
            for (let c = 0; c < audioData.numberOfChannels; c++) {
                const buf = new Float32Array(audioData.numberOfFrames);
                audioData.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
                chData.push(buf);
            }
            decodedChunks.push({ timestamp: audioData.timestamp, samples: chData });
            audioData.close();
        },
        error: function(err) {
            console.warn('AudioDecoder error for', slot, err);
            decodeError = true;
        }
    });

    const config = {
        codec: extracted.codec,
        sampleRate: extracted.sampleRate,
        numberOfChannels: extracted.channels
    };
    if (extracted.description) {
        config.description = extracted.description instanceof ArrayBuffer
            ? extracted.description
            : extracted.description.buffer
                ? extracted.description.buffer.slice(extracted.description.byteOffset, extracted.description.byteOffset + extracted.description.byteLength)
                : extracted.description;
    }

    try {
        decoder.configure(config);
    } catch (err) {
        console.warn('AudioDecoder configure failed for', slot, err);
        try { decoder.close(); } catch (_) {}  // sole decode exit that skipped close()
        _onAllDecodeFailed(slot, true, gen); // audio packets were already demuxed
        _webcodecsFinished(slot, gen);
        return;
    }

    for (let i = 0; i < extracted.chunks.length; i++) {
        if (decodeError) break;
        const chunk = extracted.chunks[i];
        decoder.decode(new EncodedAudioChunk({
            type: 'key',  // Opus frames are all independent
            timestamp: chunk.timestamp,
            data: chunk.data
        }));
    }

    decoder.flush().then(() => {
        try { decoder.close(); } catch (_) {}
        if (!_videoAudioDecodeIsCurrent(slot, gen)) {
            _webcodecsFinished(slot, gen);
            return;
        }
        if (decodeError || decodedChunks.length === 0) {
            // If some chunks decoded before the error, use what we have
            if (decodedChunks.length === 0) {
                console.warn('WebCodecs decode produced no output for', slot);
                _onAllDecodeFailed(slot, true, gen); // audio packets were demuxed
                _webcodecsFinished(slot, gen);
                return;
            }
        }

        decodedChunks.sort((a, b) => a.timestamp - b.timestamp);
        const numChannels = decodedChunks[0].samples.length || 1;
        const rawFrames = decodedChunks.reduce((sum, c) => sum + c.samples[0].length, 0);
        const rawBuffers = [];
        for (let c = 0; c < numChannels; c++) rawBuffers.push(new Float32Array(rawFrames));
        let writeOffset = 0;
        for (const chunk of decodedChunks) {
            for (let c = 0; c < numChannels; c++) {
                rawBuffers[c].set(chunk.samples[c] || chunk.samples[0], writeOffset);
            }
            writeOffset += chunk.samples[0].length;
        }

        // Trim Opus pre-skip (encoder priming samples) from the start
        const skip = extracted.preSkip || 0;
        let channelBuffers = skip > 0
            ? rawBuffers.map(buf => buf.subarray(Math.min(skip, buf.length)))
            : rawBuffers;
        // Trim trailing audio to match edit list segment duration
        const maxLen = extracted.maxSamples || 0;
        if (maxLen > 0 && channelBuffers[0].length > maxLen) {
            channelBuffers = channelBuffers.map(buf => buf.subarray(0, maxLen));
        }
        const totalFrames = channelBuffers[0].length;

        const duration = totalFrames / extracted.sampleRate;
        const fakeBuffer = {
            numberOfChannels: numChannels,
            sampleRate: extracted.sampleRate,
            duration: duration,
            length: totalFrames,
            getChannelData: function(ch) { return channelBuffers[Math.min(ch, numChannels - 1)]; }
        };
        console.log('[webcodecs] ' + slot + ': decoded ' + duration.toFixed(1) + 's, ' +
            totalFrames + ' frames, ' + numChannels + 'ch at ' + extracted.sampleRate + 'Hz');
        _finalizeAudioViz(slot, fakeBuffer, gen, extracted.timelineStart);
        _webcodecsFinished(slot, gen);
    }).catch(err => {
        console.warn('AudioDecoder flush failed for', slot, err);
        try { decoder.close(); } catch (_) {}
        if (!_videoAudioDecodeIsCurrent(slot, gen)) {
            _webcodecsFinished(slot, gen);
            return;
        }
        if (decodedChunks.length === 0) _onAllDecodeFailed(slot, true, gen); // audio packets were demuxed
        // If some chunks decoded before the error, use what we got
        if (decodedChunks.length > 0) {
            // Re-enter the success path with partial data
            const numChannels = decodedChunks[0].samples.length || 1;
            const rawFrames = decodedChunks.reduce((sum, c) => sum + c.samples[0].length, 0);
            const rawBuffers = [];
            for (let c = 0; c < numChannels; c++) rawBuffers.push(new Float32Array(rawFrames));
            let wo = 0;
            for (const chunk of decodedChunks) {
                for (let c = 0; c < numChannels; c++) rawBuffers[c].set(chunk.samples[c] || chunk.samples[0], wo);
                wo += chunk.samples[0].length;
            }
            const skip = extracted.preSkip || 0;
            let channelBuffers = skip > 0 ? rawBuffers.map(buf => buf.subarray(Math.min(skip, buf.length))) : rawBuffers;
            const maxLen = extracted.maxSamples || 0;
            if (maxLen > 0 && channelBuffers[0].length > maxLen) {
                channelBuffers = channelBuffers.map(buf => buf.subarray(0, maxLen));
            }
            const totalFrames = channelBuffers[0].length;
            const duration = totalFrames / extracted.sampleRate;
            console.log('[webcodecs] ' + slot + ': partial decode ' + duration.toFixed(1) + 's (' + decodedChunks.length + '/' + extracted.chunks.length + ' chunks)');
            _finalizeAudioViz(slot, {
                numberOfChannels: numChannels, sampleRate: extracted.sampleRate,
                duration: duration, length: totalFrames,
                getChannelData: function(ch) { return channelBuffers[Math.min(ch, numChannels - 1)]; }
            }, gen, extracted.timelineStart);
        }
        _webcodecsFinished(slot, gen);
    });
}

function decodeAndComputeAudioSlotViz(slot, arrayBuffer) {
    _audioDecodeGen[slot] = _nextAudioDecodeGeneration();
    const gen = _audioDecodeGen[slot];
    const ctx = getAudioContext();
    ctx.decodeAudioData(arrayBuffer.slice(0)).then(audioBuffer => {
        if (_audioDecodeGen[slot] !== gen) return;
        updateLoadingStatus('Computing waveforms…');
        const dpr = window.devicePixelRatio || 1;
        const maxPx = Math.round(window.innerWidth * dpr);
        const numBuckets = Math.min(Math.ceil(audioBuffer.duration * 1000), maxPx);
        const waveform = computeWaveformData(audioBuffer, numBuckets);
        const spectrogram = computeSpectrogramData(audioBuffer);
        const _m = computeAudioMetrics(audioBuffer);
        audioMetrics[slot] = _m;
        _audioSlotVizData[slot] = { waveform, spectrogram, audioBuffer, lufsEnvelope: _m ? _m.stBlks : null };
        _updateMetricSpans(slot);
        delete audioFileBuffers[slot];

        // Update info bar with audio metadata
        updateAudioInfoBar(slot, audioBuffer, arrayBuffer);

        // Recompute max duration across all loaded audio slots
        _audioMaxDuration = 0;
        assetOrder.forEach(s => {
            if (_audioSlotVizData[s]) {
                _audioMaxDuration = Math.max(_audioMaxDuration,
                    (_audioTimelineStarts[s] || 0) + _audioSlotVizData[s].audioBuffer.duration);
            }
        });

        // Redraw all canvases with uniform time scale
        assetOrder.forEach(s => {
            if (_audioSlotVizData[s]) drawAudioSlotCanvas(s);
        });

        // Update duration display using decoded duration as a fallback in case
        // the <audio> element's loadedmetadata event is slow (e.g. service worker
        // intercepting the blob URL). This is idempotent — loadedmetadata will
        // overwrite it with the same value when it eventually fires.
        updateDurationDisplay(slot, audioBuffer.duration);

        // Activate the view if it hasn't been activated yet (i.e. loadedmetadata
        // hasn't fired). This unblocks the loading screen when the <audio> element
        // is slow to fire loadedmetadata. The viewActivating guard in
        // checkAllLoaded() prevents a double-activation when loadedmetadata later fires.
        _setLoadingSlotState(slot, 'Ready', 'ready');
        if (!viewActivating) checkAllLoaded();
    }).catch(err => {
        if (_audioDecodeGen[slot] !== gen) return;
        _setLoadingSlotState(slot, 'Could not decode', 'error');
        console.error('Audio decode error for slot ' + slot + ':', err);
        showLoadToast('Audio decode failed for ' + slotLabel(slot), true, 5000);
    });
}
