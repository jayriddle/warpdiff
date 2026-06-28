// MP4 / WebM audio demuxers — extracted from index.html (no app-state dependencies).
// Pure: each takes a Uint8Array container and returns
//   { chunks:[{timestamp,data}], sampleRate, channels, codec, description, preSkip, maxSamples }
// (WebM returns a subset). Used by the audio decode pipeline to feed WebCodecs AudioDecoder.
// See CLAUDE.md "MP4 audio demuxer" for the per-track mdhd.timescale scoping invariant.

// --- MP4 demuxer ---
function _demuxMP4Audio(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sampleRate = 48000, channels = 2;
    let codecPrivate = null;
    let preSkip = 0;
    let audioCodec = 'opus'; // updated from stsd entry type
    let audioTrackId = -1;
    let timescale = 1;
    let mediaStartTime = -1; // from edit list, in timescale units
    let segmentDuration = -1; // from edit list, in movie timescale units
    let movieTimescale = 1000; // from mvhd, used to interpret segmentDuration
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
            } else if (type === 'stsd') {
                parseStsd(boxStart, boxEnd);
            } else if (type === 'stsz') {
                parseStsz(boxStart, boxEnd);
            } else if (type === 'stco') {
                parseStco(boxStart, boxEnd);
            } else if (type === 'co64') {
                parseCo64(boxStart, boxEnd);
            } else if (type === 'stsc') {
                parseStsc(boxStart, boxEnd);
            } else if (type === 'stts') {
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
                if (mt >= 0) { _lastElstMediaTime = mt; _lastElstSegDuration = sd; return; }
                off += 20;
            } else {
                if (off + 12 > end) break;
                const sd = view.getUint32(off);
                const mt = view.getInt32(off + 4);
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
            for (let i = 0; i < count; i++) sampleTable.sizes.push(defaultSize);
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
        ', segDur=' + segmentDuration + ', movieTs=' + movieTimescale +
        ', maxSamples=' + maxSamples);

    return {
        chunks: chunks,
        sampleRate: sampleRate,
        channels: channels,
        codec: audioCodec,
        description: codecPrivate,
        preSkip: skipSamples,
        maxSamples: maxSamples
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
        return { id: idI.id, headerLen: hLen, dataSize: szI.value, dataOffset: offset + hLen };
    }

    function readUint(d, off, sz) {
        let v = 0; for (let i = 0; i < sz; i++) v = v * 256 + d[off + i]; return v;
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
