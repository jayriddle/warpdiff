// MP4 / WebM audio demuxers — extracted from index.html (no app-state dependencies).
// Pure: each takes a Uint8Array container and returns
//   { chunks:[{timestamp,data}], sampleRate, channels, codec, description,
//     preSkip, maxSamples, timelineStart }
// (WebM returns a subset). Used by the audio decode pipeline to feed WebCodecs AudioDecoder.
// See CLAUDE.md "MP4 audio demuxer" for the per-track mdhd.timescale scoping invariant.

// --- MP4 demuxer ---
function _demuxMP4Audio(data, metadataOnly = false) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sampleRate = 48000, channels = 2;
    let codecPrivate = null;
    let preSkip = 0;
    let audioCodec = 'opus'; // updated from stsd entry type
    let audioTrackId = -1;
    let timescale = 1;
    let mediaStartTime = -1; // from edit list, in timescale units
    let segmentDuration = -1; // from edit list, in movie timescale units
    let timelineStartDuration = 0; // leading empty edits, in movie timescale units
    let movieTimescale = 1000; // from mvhd, used to interpret segmentDuration
    let foundAudioTrack = false;
    const sampleTable = { sizes: [], offsets: [], durations: [] };
    const chunks = [];

    function readStr(off, len) {
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(data[off + i]);
        return s;
    }

    // Walk MP4 boxes. containerEnd bounds the current container.
    function walkBoxes(start, end, path) {
        let off = start;
        while (off + 8 <= end) {
            let size = view.getUint32(off);
            const type = readStr(off + 4, 4);
            let headerLen = 8;
            if (size === 1 && off + 16 <= end) {
                // 64-bit extended size
                size = Number(view.getBigUint64(off + 8));
                headerLen = 16;
            } else if (size === 0) {
                size = end - off; // box extends to end
            }
            if (size < headerLen || off + size > end) break;

            const boxStart = off + headerLen;
            const boxEnd = off + size;
            const fullPath = path + '/' + type;

            // Container boxes — recurse
            if (type === 'moov' || type === 'trak' || type === 'mdia' ||
                type === 'minf' || type === 'stbl' || type === 'udta' ||
                type === 'edts') {
                walkBoxes(boxStart, boxEnd, fullPath);
            } else if (type === 'mvhd') {
                parseMvhd(boxStart, boxEnd);
            } else if (type === 'mdhd') {
                parseMdhd(boxStart, boxEnd);
            } else if (type === 'hdlr') {
                parseHdlr(boxStart, boxEnd);
            } else if (type === 'stsd' && !metadataOnly) {
                parseStsd(boxStart, boxEnd);
            } else if (type === 'stsz' && !metadataOnly) {
                parseStsz(boxStart, boxEnd);
            } else if (type === 'stco' && !metadataOnly) {
                parseStco(boxStart, boxEnd);
            } else if (type === 'co64' && !metadataOnly) {
                parseCo64(boxStart, boxEnd);
            } else if (type === 'stsc' && !metadataOnly) {
                parseStsc(boxStart, boxEnd);
            } else if (type === 'stts' && !metadataOnly) {
                parseStts(boxStart, boxEnd);
            } else if (type === 'tkhd') {
                parseTkhd(boxStart, boxEnd);
            } else if (type === 'elst') {
                parseElst(boxStart, boxEnd);
            }

            off = boxEnd;
        }
    }

    let _currentTrackIsAudio = false;
    let _stscEntries = [];
    let _lastElstMediaTime = -1; // elst from current trak, resolved after hdlr
    let _lastElstSegDuration = -1;
    let _lastElstTimelineStartDuration = 0;
    let _lastMdhdTimescale = 0;  // mdhd from current trak; promoted to `timescale`
                                 // only when hdlr confirms this trak is audio.
                                 // Without per-track scoping, the data/subtitle
                                 // track's mdhd (often 1000) overwrites the audio
                                 // track's mdhd (usually = sample rate, e.g. 48000)
                                 // and corrupts the elst skipSamples calculation.

    function parseTkhd(start, end) {
        if (end - start < 8) return;
        _lastElstMediaTime = -1; // reset for each new trak
        _lastElstSegDuration = -1;
        _lastElstTimelineStartDuration = 0;
        _lastMdhdTimescale = 0; // also reset per-track — see parseMdhd
        _currentTrackIsAudio = false;
        const version = data[start];
        audioTrackId = version === 1
            ? view.getUint32(start + 20)
            : view.getUint32(start + 12);
    }

    function parseElst(start, end) {
        // Edit list — tells us where in the media timeline playback starts
        // and how long the segment lasts.
        // Stored temporarily; assigned when hdlr confirms audio.
        if (end - start < 8) return;
        const version = data[start];
        const entryCount = view.getUint32(start + 4);
        let off = start + 8;
        for (let i = 0; i < entryCount; i++) {
            if (version === 1) {
                if (off + 20 > end) break;
                const sd = Number(view.getBigUint64(off));
                const mt = Number(view.getBigInt64(off + 8));
                if (mt === -1) _lastElstTimelineStartDuration += sd;
                if (mt >= 0) { _lastElstMediaTime = mt; _lastElstSegDuration = sd; return; }
                off += 20;
            } else {
                if (off + 12 > end) break;
                const sd = view.getUint32(off);
                const mt = view.getInt32(off + 4);
                if (mt === -1) _lastElstTimelineStartDuration += sd;
                if (mt >= 0) { _lastElstMediaTime = mt; _lastElstSegDuration = sd; return; }
                off += 12;
            }
        }
    }

    function parseMvhd(start, end) {
        if (end - start < 4) return;
        const version = data[start];
        // version 0: timescale at offset 12; version 1: at offset 20
        if (version === 1 && end - start >= 24) {
            movieTimescale = view.getUint32(start + 20);
        } else if (end - start >= 16) {
            movieTimescale = view.getUint32(start + 12);
        }
    }

    function parseMdhd(start, end) {
        if (end - start < 4) return;
        const version = data[start];
        // Store the timescale locally; promote to the audio-track-scoped
        // `timescale` only when parseHdlr confirms this trak is audio.
        if (version === 1 && end - start >= 28) {
            _lastMdhdTimescale = view.getUint32(start + 20);
        } else if (end - start >= 16) {
            _lastMdhdTimescale = view.getUint32(start + 12);
        }
    }

    function parseHdlr(start, end) {
        // version(4) + predefined(4) + handler_type(4)
        if (end - start < 12) return;
        const handlerType = readStr(start + 8, 4);
        _currentTrackIsAudio = (handlerType === 'soun');
        if (_currentTrackIsAudio) {
            foundAudioTrack = true;
            // Promote this trak's mdhd timescale to the demuxer-wide variable.
            // Previously the global `timescale` was overwritten by every track,
            // so a data/subtitle track parsed after the audio track (with
            // timescale=1000) would corrupt the audio elst calculation, making
            // 16512-sample (=344ms) priming offsets look like 16.5-second skips.
            if (_lastMdhdTimescale > 0) timescale = _lastMdhdTimescale;
            if (_lastElstMediaTime >= 0) {
                mediaStartTime = _lastElstMediaTime;
                segmentDuration = _lastElstSegDuration;
            }
            timelineStartDuration = _lastElstTimelineStartDuration;
        }
    }

    function parseStsd(start, end) {
        if (!_currentTrackIsAudio) return;
        // version(1) + flags(3) + entry_count(4)
        if (end - start < 8) return;
        const entryStart = start + 8;
        if (entryStart + 8 > end) return;
        let entrySize = view.getUint32(entryStart);
        const entryType = readStr(entryStart + 4, 4);

        // AudioSampleEntry layout after 8-byte box header:
        //   6 reserved + 2 data_ref_index = 8 bytes
        //   8 reserved
        //   2 channel_count (offset +16 from entry data start)
        //   2 sample_size
        //   2 compression_id + 2 packet_size
        //   4 sample_rate (16.16 fixed point)
        // Total: 28 bytes, sub-boxes start after
        const entryDataStart = entryStart + 8; // past box header
        const audioStart = entryDataStart + 28; // sub-boxes start here
        // Map stsd entry type to WebCodecs codec string
        if (entryType === 'Opus') audioCodec = 'opus';
        else if (entryType === 'mp4a') audioCodec = 'mp4a.40.2';
        else audioCodec = entryType;
        if (entryDataStart + 28 <= end) {
            channels = view.getUint16(entryDataStart + 16);
            sampleRate = view.getUint16(entryDataStart + 24); // upper 16 bits of fixed-point
        }

        // Look for 'dOps' (Opus) or 'Opus' sub-boxes inside the sample entry
        if (audioStart < entryStart + entrySize) {
            let bOff = audioStart;
            const bEnd = entryStart + entrySize;
            while (bOff + 8 <= bEnd) {
                const bSize = view.getUint32(bOff);
                const bType = readStr(bOff + 4, 4);
                if (bSize < 8 || bOff + bSize > bEnd) break;
                if (bType === 'dOps') {
                    // dOps box: version(1) + outputChannelCount(1) + preSkip(2) +
                    //           inputSampleRate(4) + outputGain(2) + mappingFamily(1) ...
                    codecPrivate = data.slice(bOff + 8, bOff + bSize);
                    if (codecPrivate.length >= 2) {
                        channels = codecPrivate[1]; // outputChannelCount — authoritative
                    }
                    if (codecPrivate.length >= 4) {
                        preSkip = (codecPrivate[2] << 8) | codecPrivate[3]; // big-endian in dOps
                    }
                }
                bOff += bSize;
            }
        }
    }

    function parseStsz(start, end) {
        if (!_currentTrackIsAudio || end - start < 12) return;
        const defaultSize = view.getUint32(start + 4);
        const count = view.getUint32(start + 8);
        if (defaultSize > 0) {
            // Clamp: a valid file can't declare more samples than it has bytes.
            // Without this, sample_count = 0xFFFFFFFF fills a ~4.3B-entry array
            // (OOM / main-thread hang) from a tiny crafted file.
            const n = Math.min(count, data.length);
            for (let i = 0; i < n; i++) sampleTable.sizes.push(defaultSize);
        } else {
            for (let i = 0; i < count && start + 12 + i * 4 + 4 <= end; i++) {
                sampleTable.sizes.push(view.getUint32(start + 12 + i * 4));
            }
        }
    }

    function parseStco(start, end) {
        if (!_currentTrackIsAudio || end - start < 8) return;
        const count = view.getUint32(start + 4);
        for (let i = 0; i < count && start + 8 + i * 4 + 4 <= end; i++) {
            sampleTable.offsets.push(view.getUint32(start + 8 + i * 4));
        }
    }

    function parseCo64(start, end) {
        if (!_currentTrackIsAudio || end - start < 8) return;
        const count = view.getUint32(start + 4);
        for (let i = 0; i < count && start + 8 + i * 8 + 8 <= end; i++) {
            sampleTable.offsets.push(Number(view.getBigUint64(start + 8 + i * 8)));
        }
    }

    function parseStsc(start, end) {
        if (!_currentTrackIsAudio || end - start < 8) return;
        const count = view.getUint32(start + 4);
        _stscEntries = [];
        for (let i = 0; i < count && start + 8 + i * 12 + 12 <= end; i++) {
            _stscEntries.push({
                firstChunk: view.getUint32(start + 8 + i * 12),
                samplesPerChunk: view.getUint32(start + 8 + i * 12 + 4),
                descIdx: view.getUint32(start + 8 + i * 12 + 8)
            });
        }
    }

    function parseStts(start, end) {
        if (!_currentTrackIsAudio || end - start < 8) return;
        const count = view.getUint32(start + 4);
        for (let i = 0; i < count && start + 8 + i * 8 + 8 <= end; i++) {
            const sampleCount = view.getUint32(start + 8 + i * 8);
            const sampleDelta = view.getUint32(start + 8 + i * 8 + 4);
            sampleTable.durations.push({ count: sampleCount, delta: sampleDelta });
        }
    }

    // Parse
    walkBoxes(0, data.length, '');

    const timelineStart = (timelineStartDuration > 0 && movieTimescale > 0)
        ? timelineStartDuration / movieTimescale
        : 0;
    // decodeAudioData handles the compressed samples itself; callers use this
    // lightweight mode only to retain the MP4 edit-list placement on the video
    // timeline. Do not build or copy the packet table in that path.
    if (metadataOnly) return foundAudioTrack ? { timelineStart: timelineStart } : null;

    if (sampleTable.sizes.length === 0 || sampleTable.offsets.length === 0) {
        console.warn('[mp4-parse] no audio samples found');
        return null;
    }

    // Build sample-to-offset mapping using stsc (sample-to-chunk) + stco (chunk offsets)
    // stsc tells us how many samples are in each chunk
    const numSamples = sampleTable.sizes.length;
    const sampleOffsets = new Array(numSamples);
    let sampleIdx = 0;

    for (let chunkIdx = 0; chunkIdx < sampleTable.offsets.length && sampleIdx < numSamples; chunkIdx++) {
        // Find how many samples in this chunk from stsc
        let samplesInChunk = 1;
        const chunkNum = chunkIdx + 1; // 1-based
        for (let s = _stscEntries.length - 1; s >= 0; s--) {
            if (chunkNum >= _stscEntries[s].firstChunk) {
                samplesInChunk = _stscEntries[s].samplesPerChunk;
                break;
            }
        }

        let offset = sampleTable.offsets[chunkIdx];
        for (let s = 0; s < samplesInChunk && sampleIdx < numSamples; s++) {
            sampleOffsets[sampleIdx] = offset;
            offset += sampleTable.sizes[sampleIdx];
            sampleIdx++;
        }
    }

    // Build timestamps from stts (time-to-sample)
    let ts = 0;
    let tsIdx = 0;
    for (const entry of sampleTable.durations) {
        for (let i = 0; i < entry.count && tsIdx < numSamples; i++) {
            const timestampUs = Math.round(ts * 1000000 / timescale);
            const sampleSize = sampleTable.sizes[tsIdx];
            const sampleOff = sampleOffsets[tsIdx];
            if (sampleOff !== undefined && sampleOff + sampleSize <= data.length) {
                chunks.push({
                    timestamp: timestampUs,
                    data: data.slice(sampleOff, sampleOff + sampleSize)
                });
            }
            ts += entry.delta;
            tsIdx++;
        }
    }

    // Edit list media_time supersedes preSkip (it includes encoder delay).
    // Convert to samples at the audio sample rate.
    const skipSamples = mediaStartTime >= 0
        ? Math.round(mediaStartTime * sampleRate / timescale)
        : preSkip;

    // segmentDuration (in movie timescale) tells us how long to play.
    // Convert to samples to trim trailing audio past the video end.
    const maxSamples = (segmentDuration > 0 && movieTimescale > 0)
        ? Math.round(segmentDuration / movieTimescale * sampleRate)
        : 0; // 0 = no limit

    console.log('[mp4-parse] ' + chunks.length + ' audio samples, timescale=' + timescale +
        ', rate=' + sampleRate + ', ch=' + channels +
        ', elst_media_time=' + mediaStartTime + ', skipSamples=' + skipSamples +
        ', timelineStart=' + timelineStart +
        ', segDur=' + segmentDuration + ', movieTs=' + movieTimescale +
        ', maxSamples=' + maxSamples);

    return {
        chunks: chunks,
        sampleRate: sampleRate,
        channels: channels,
        codec: audioCodec,
        description: codecPrivate,
        preSkip: skipSamples,
        maxSamples: maxSamples,
        timelineStart: timelineStart
    };
}

// --- WebM demuxer ---
function _demuxWebMAudio(data) {
    let audioTrackNum = -1;
    let codecPrivate = null;
    let sampleRate = 48000;
    let channels = 2;
    let timestampScale = 1000000;
    const chunks = [];

    function readVint(d, offset) {
        if (offset >= d.length) return null;
        let first = d[offset], len = 1, mask = 0x80;
        while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
        if (len > 8) return null;
        let value = first & (mask - 1);
        for (let i = 1; i < len; i++) {
            if (offset + i >= d.length) return null;
            value = value * 256 + d[offset + i];
        }
        return { value: value, length: len };
    }

    function readElementId(d, offset) {
        if (offset >= d.length) return null;
        let first = d[offset], len;
        if (first & 0x80) len = 1;
        else if (first & 0x40) len = 2;
        else if (first & 0x20) len = 3;
        else if (first & 0x10) len = 4;
        else return null;
        let id = 0;
        for (let i = 0; i < len; i++) {
            if (offset + i >= d.length) return null;
            id = id * 256 + d[offset + i];
        }
        return { id: id, length: len };
    }

    function readEl(d, offset) {
        const idI = readElementId(d, offset);
        if (!idI) return null;
        const szI = readVint(d, offset + idI.length);
        if (!szI) return null;
        const hLen = idI.length + szI.length;
        const dataOffset = offset + hLen;
        // Clamp the declared data size to the bytes actually present. An EBML VINT
        // can encode a size up to 2^56, which a truncated/crafted file uses to
        // drive readUint/readString/slice into multi-billion-iteration spins and
        // multi-GB allocations. A valid element never runs past EOF. Callers that
        // care about container bounds still Math.min against their own `end`.
        const dataSize = Math.min(szI.value, Math.max(0, d.length - dataOffset));
        return { id: idI.id, headerLen: hLen, dataSize: dataSize, dataOffset: dataOffset };
    }

    function readUint(d, off, sz) {
        // EBML integers are ≤8 bytes; cap the width so a bogus element size can't
        // spin this into a long loop (readEl already clamps sz to EOF anyway).
        let v = 0; const n = Math.min(sz, 8); for (let i = 0; i < n; i++) v = v * 256 + d[off + i]; return v;
    }
    function readFloat(d, off, sz) {
        const dv = new DataView(d.buffer, d.byteOffset + off, sz);
        return sz === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
    }
    function readString(d, off, sz) {
        let s = ''; for (let i = 0; i < sz; i++) s += String.fromCharCode(d[off + i]); return s;
    }

    const ID = {
        Segment: 0x18538067, Tracks: 0x1654AE6B, TrackEntry: 0xAE,
        TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63A2,
        Audio: 0xE1, SampleRate: 0xB5, Channels: 0x9F,
        Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3,
        Info: 0x1549A966, TimestampScale: 0x2AD7B1
    };

    function parseSegment(d, start, end) {
        let off = start;
        while (off < end) {
            const el = readEl(d, off);
            if (!el) break;
            const dEnd = Math.min(el.dataOffset + el.dataSize, end);
            if (el.id === ID.Info) {
                let o = el.dataOffset;
                while (o < dEnd) { const e2 = readEl(d, o); if (!e2) break; if (e2.id === ID.TimestampScale) timestampScale = readUint(d, e2.dataOffset, e2.dataSize); o = e2.dataOffset + e2.dataSize; }
            } else if (el.id === ID.Tracks) {
                let o = el.dataOffset;
                while (o < dEnd) { const e2 = readEl(d, o); if (!e2) break; if (e2.id === ID.TrackEntry) parseTrackEntry(d, e2.dataOffset, e2.dataOffset + e2.dataSize); o = e2.dataOffset + e2.dataSize; }
            } else if (el.id === ID.Cluster && audioTrackNum >= 0) {
                parseCluster(d, el.dataOffset, dEnd);
            }
            off = dEnd;
        }
    }

    function parseTrackEntry(d, start, end) {
        let num = -1, type = -1, codec = '', priv = null, sr = 48000, ch = 2;
        let off = start;
        while (off < end) {
            const el = readEl(d, off); if (!el) break;
            const dEnd = el.dataOffset + el.dataSize;
            if (el.id === ID.TrackNumber) num = readUint(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.TrackType) type = readUint(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.CodecID) codec = readString(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.CodecPrivate) priv = d.slice(el.dataOffset, dEnd);
            else if (el.id === ID.Audio) {
                let ao = el.dataOffset;
                while (ao < dEnd) { const ae = readEl(d, ao); if (!ae) break; if (ae.id === ID.SampleRate) sr = readFloat(d, ae.dataOffset, ae.dataSize); else if (ae.id === ID.Channels) ch = readUint(d, ae.dataOffset, ae.dataSize); ao = ae.dataOffset + ae.dataSize; }
            }
            off = dEnd;
        }
        if (type === 2 && (codec === 'A_OPUS' || codec === 'A_VORBIS')) {
            audioTrackNum = num; codecPrivate = priv; sampleRate = sr; channels = ch;
        }
    }

    function parseCluster(d, start, end) {
        let clusterTs = 0; let off = start;
        while (off < end) {
            const el = readEl(d, off); if (!el) break;
            const dEnd = Math.min(el.dataOffset + el.dataSize, end);
            if (el.id === ID.Timecode) clusterTs = readUint(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.SimpleBlock) {
                const tv = readVint(d, el.dataOffset); if (!tv || tv.value !== audioTrackNum) { off = dEnd; continue; }
                const tsOff = el.dataOffset + tv.length;
                const rel = (d[tsOff] << 8 | d[tsOff + 1]); const relSigned = rel >= 0x8000 ? rel - 0x10000 : rel;
                const frameStart = tsOff + 3;
                if (frameStart < el.dataOffset + el.dataSize) {
                    const tsMs = (clusterTs + relSigned) * timestampScale / 1000000;
                    chunks.push({ timestamp: Math.round(tsMs * 1000), data: d.slice(frameStart, el.dataOffset + el.dataSize) });
                }
            }
            off = dEnd;
        }
    }

    // Walk top-level
    let off = 0;
    while (off < data.length) {
        const el = readEl(data, off); if (!el) break;
        if (el.id === ID.Segment) { parseSegment(data, el.dataOffset, Math.min(el.dataOffset + el.dataSize, data.length)); break; }
        off = el.dataOffset + el.dataSize;
    }

    if (chunks.length === 0) return null;
    // OpusHead pre-skip is at bytes 10-11, little-endian
    let preSkip = 0;
    if (codecPrivate && codecPrivate.length >= 12) {
        preSkip = codecPrivate[10] | (codecPrivate[11] << 8);
    }
    return {
        chunks: chunks,
        sampleRate: sampleRate,
        channels: channels,
        codec: 'opus',
        description: codecPrivate ? codecPrivate.buffer.slice(codecPrivate.byteOffset, codecPrivate.byteOffset + codecPrivate.byteLength) : null,
        preSkip: preSkip
    };
}

// --- MP4 video demuxer (WebCodecs scrub path) ---
// Extracts the first video track's sample table for direct VideoDecoder feeding.
// Pure: takes a Uint8Array container, returns null (no parseable video track) or
//   { codec,            // WebCodecs codec string ("avc1.64001f", "hvc1.1.6.L120.B0", …)
//     description,      // Uint8Array avcC/hvcC payload for VideoDecoder config, or null
//     codedWidth, codedHeight,
//     timescale,        // media timescale (per-track mdhd — same scoping invariant as audio)
//     samples: [{ offset, size, dts, pts, key }] }  // dts/pts in SECONDS, decode order
// Used by js/scrub-video.js. See docs/scrub-proxy-spike-2026-05.md for why scrubbing
// decodes original samples instead of driving a second <video> element.
function _demuxMP4Video(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    function readStr(off, len) {
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(data[off + i]);
        return s;
    }

    // Per-trak temp state, committed at trak end only for the first 'vide' track.
    let t = null;      // current trak accumulator
    let video = null;  // committed video track

    function walk(start, end) {
        let off = start;
        while (off + 8 <= end) {
            let size = view.getUint32(off);
            const type = readStr(off + 4, 4);
            let headerLen = 8;
            if (size === 1 && off + 16 <= end) {
                size = Number(view.getBigUint64(off + 8));
                headerLen = 16;
            } else if (size === 0) {
                size = end - off;
            }
            if (size < headerLen || off + size > end) break;
            const s = off + headerLen, e = off + size;

            if (type === 'moov' || type === 'mdia' || type === 'minf' || type === 'stbl' ||
                type === 'edts') {
                walk(s, e);
            } else if (type === 'trak') {
                t = { handler: null, timescale: 1, elstMediaTime: 0 };
                walk(s, e);
                if (!video && t.handler === 'vide' && t.codec && t.sizes && t.chunkOffsets && t.dtsDeltas) {
                    video = t;
                }
                t = null;
            } else if (!t) {
                // outside a trak — skip
            } else if (type === 'elst') {
                // Edit list — scoped per trak (same invariant as the audio demuxer:
                // never let another track's elst clobber the video track's). The
                // first entry with media_time >= 0 shifts the presentation
                // timeline: the <video> element applies it, so raw sample pts run
                // ahead by media_time/timescale (e.g. the 2-frame x264 B-frame
                // lead). Without this shift the overlay paints the wrong frame.
                const version = data[s];
                const n = view.getUint32(s + 4);
                let eOff = s + 8;
                for (let i = 0; i < n && eOff + (version === 1 ? 20 : 12) <= e; i++) {
                    const mt = version === 1
                        ? Number(view.getBigInt64(eOff + 8))
                        : view.getInt32(eOff + 4);
                    eOff += version === 1 ? 20 : 12;
                    if (mt >= 0) { t.elstMediaTime = mt; break; }
                }
            } else if (type === 'mdhd') {
                const version = data[s];
                t.timescale = view.getUint32(version === 1 ? s + 20 : s + 12);
            } else if (type === 'hdlr') {
                t.handler = readStr(s + 8, 4);
            } else if (type === 'stsd') {
                parseStsdVideo(s, e);
            } else if (type === 'stss') {
                const n = view.getUint32(s + 4);
                t.syncSamples = new Set();
                for (let i = 0; i < n && s + 8 + i * 4 + 4 <= e; i++) {
                    t.syncSamples.add(view.getUint32(s + 8 + i * 4)); // 1-based
                }
            } else if (type === 'stsz') {
                const uniform = view.getUint32(s + 4);
                const n = view.getUint32(s + 8);
                // Clamp the count: a uniform-size table (no per-entry bytes) is
                // bounded by the file's byte count; a per-entry table by the box.
                // Otherwise sample_count = 0xFFFFFFFF fills a ~4.3B-entry array
                // (OOM / hang) — the `uniform || …` short-circuit means the
                // uniform case never even throws past the buffer to self-limit.
                const cnt = uniform
                    ? Math.min(n, data.length)
                    : Math.min(n, Math.max(0, Math.floor((e - (s + 12)) / 4)));
                t.sizes = new Array(cnt);
                for (let i = 0; i < cnt; i++) {
                    t.sizes[i] = uniform || view.getUint32(s + 12 + i * 4);
                }
            } else if (type === 'stsc') {
                // Clamp entry count to the box bytes (12 per entry) — defense in
                // depth so a bogus count can't drive an out-of-bounds getUint32.
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 12)));
                t.stsc = [];
                for (let i = 0; i < n; i++) {
                    const b = s + 8 + i * 12;
                    t.stsc.push({ firstChunk: view.getUint32(b), perChunk: view.getUint32(b + 4) });
                }
            } else if (type === 'stco' || type === 'co64') {
                const entry = type === 'stco' ? 4 : 8;
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / entry)));
                t.chunkOffsets = new Array(n);
                for (let i = 0; i < n; i++) {
                    t.chunkOffsets[i] = type === 'stco'
                        ? view.getUint32(s + 8 + i * 4)
                        : Number(view.getBigUint64(s + 8 + i * 8));
                }
            } else if (type === 'stts') {
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 8)));
                t.dtsDeltas = [];
                for (let i = 0; i < n; i++) {
                    const b = s + 8 + i * 8;
                    t.dtsDeltas.push({ count: view.getUint32(b), delta: view.getUint32(b + 4) });
                }
            } else if (type === 'ctts') {
                const version = data[s];
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 8)));
                t.ctts = [];
                for (let i = 0; i < n; i++) {
                    const b = s + 8 + i * 8;
                    t.ctts.push({
                        count: view.getUint32(b),
                        offset: version === 1 ? view.getInt32(b + 4) : view.getUint32(b + 4)
                    });
                }
            }
            off = e;
        }
    }

    function parseStsdVideo(s, e) {
        // stsd: version+flags(4) entry_count(4) then sample entries
        const entryStart = s + 8;
        if (entryStart + 8 > e) return;
        const entrySize = view.getUint32(entryStart);
        const fourcc = readStr(entryStart + 4, 4);
        if (fourcc !== 'avc1' && fourcc !== 'avc3' && fourcc !== 'hvc1' && fourcc !== 'hev1') return;
        const entryEnd = Math.min(entryStart + entrySize, e);
        // VisualSampleEntry: width/height at +32/+34 from entry box start,
        // child boxes (avcC/hvcC/…) start at +86.
        t.width = view.getUint16(entryStart + 32);
        t.height = view.getUint16(entryStart + 34);
        let off = entryStart + 86;
        while (off + 8 <= entryEnd) {
            const cSize = view.getUint32(off);
            const cType = readStr(off + 4, 4);
            if (cSize < 8 || off + cSize > entryEnd) break;
            if (cType === 'avcC' && (fourcc === 'avc1' || fourcc === 'avc3')) {
                t.description = data.slice(off + 8, off + cSize);
                // avc1.PPCCLL from avcC profile / compat / level bytes
                const hex = b => b.toString(16).padStart(2, '0');
                t.codec = 'avc1.' + hex(t.description[1]) + hex(t.description[2]) + hex(t.description[3]);
            } else if (cType === 'hvcC' && (fourcc === 'hvc1' || fourcc === 'hev1')) {
                t.description = data.slice(off + 8, off + cSize);
                t.codec = _hevcCodecString(t.description);
            } else if (cType === 'colr' && readStr(off + 8, 4) === 'nclx' && off + 19 <= entryEnd) {
                // Color description — lets the scrub decoder refuse HDR content
                // (PQ transfer=16, HLG=18): Chrome tone-maps HDR <video> for
                // display, which a canvas drawImage doesn't replicate.
                t.colr = {
                    primaries: view.getUint16(off + 12),
                    transfer: view.getUint16(off + 14),
                    matrix: view.getUint16(off + 16),
                    fullRange: (data[off + 18] & 0x80) !== 0
                };
            }
            off += cSize;
        }
    }

    // Build the RFC 6381 codec string from an hvcC payload.
    function _hevcCodecString(c) {
        const profileSpace = (c[1] >> 6) & 0x3;
        const tierFlag = (c[1] >> 5) & 0x1;
        const profileIdc = c[1] & 0x1f;
        const compat = (c[2] << 24 | c[3] << 16 | c[4] << 8 | c[5]) >>> 0;
        // profile compatibility flags: bit-reversed 32-bit value, hex, no padding
        let rev = 0;
        for (let i = 0; i < 32; i++) rev = (rev << 1 | (compat >> i) & 1) >>> 0;
        const levelIdc = c[12];
        let constraints = '';
        for (let i = 11; i >= 6; i--) {
            if (c[i] || constraints) constraints = c[i].toString(16).padStart(2, '0') + constraints;
        }
        return 'hvc1.' + (profileSpace ? String.fromCharCode(64 + profileSpace) : '') + profileIdc +
               '.' + rev.toString(16).toUpperCase() +
               '.' + (tierFlag ? 'H' : 'L') + levelIdc +
               (constraints ? '.' + constraints.replace(/(00)+$/, '') || '' : '.B0');
    }

    walk(0, data.length);
    if (!video || !video.sizes.length) return null;

    // Expand chunk map → per-sample file offsets (decode order = file order).
    const nSamples = video.sizes.length;
    const offsets = new Array(nSamples);
    {
        const stsc = video.stsc || [{ firstChunk: 1, perChunk: nSamples }];
        let sample = 0;
        for (let ci = 0; ci < video.chunkOffsets.length && sample < nSamples; ci++) {
            // samples-per-chunk for chunk ci+1 (1-based): last stsc entry with firstChunk <= ci+1
            let per = stsc[0].perChunk;
            for (let k = 0; k < stsc.length; k++) {
                if (stsc[k].firstChunk <= ci + 1) per = stsc[k].perChunk; else break;
            }
            let pos = video.chunkOffsets[ci];
            for (let j = 0; j < per && sample < nSamples; j++, sample++) {
                offsets[sample] = pos;
                pos += video.sizes[sample];
            }
        }
        if (sample < nSamples) return null; // malformed chunk map
    }

    // stts → dts; ctts → pts; elst shifts pts onto the element's timeline
    const ts = video.timescale || 1;
    const ptsShift = (video.elstMediaTime || 0) / ts;
    const samples = new Array(nSamples);
    let dts = 0, di = 0, dRemain = video.dtsDeltas.length ? video.dtsDeltas[0].count : 0;
    let ci2 = 0, cRemain = video.ctts && video.ctts.length ? video.ctts[0].count : 0;
    for (let i = 0; i < nSamples; i++) {
        let ctsOffset = 0;
        if (video.ctts && ci2 < video.ctts.length) {
            ctsOffset = video.ctts[ci2].offset;
            if (--cRemain <= 0 && ci2 + 1 < video.ctts.length) { ci2++; cRemain = video.ctts[ci2].count; }
        }
        samples[i] = {
            offset: offsets[i],
            size: video.sizes[i],
            dts: dts / ts,
            pts: (dts + ctsOffset) / ts - ptsShift,
            key: video.syncSamples ? video.syncSamples.has(i + 1) : true
        };
        if (di < video.dtsDeltas.length) {
            dts += video.dtsDeltas[di].delta;
            if (--dRemain <= 0 && di + 1 < video.dtsDeltas.length) { di++; dRemain = video.dtsDeltas[di].count; }
        }
    }

    return {
        codec: video.codec,
        description: video.description || null,
        codedWidth: video.width || 0,
        codedHeight: video.height || 0,
        timescale: ts,
        colr: video.colr || null,
        samples: samples
    };
}
