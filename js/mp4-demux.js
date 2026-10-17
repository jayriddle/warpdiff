// MP4 / WebM audio demuxers — extracted from index.html (no app-state dependencies).
// Pure: each takes a Uint8Array container and returns
//   { chunks:[{timestamp,data}], sampleRate, channels, codec, description,
//     preSkip, maxSamples, timelineStart, trackId }
// (WebM returns a subset). Used by the audio decode pipeline to feed WebCodecs AudioDecoder.
// See CLAUDE.md "MP4 audio demuxer" for track isolation and bounded extraction.

// Recognize top-level ISO-BMFF boxes rather than assuming ftyp is first. This
// only chooses the metadata/track-policy path; _demuxMP4Audio validates it.
// Padding, broken identified headers and an exhausted plausible prefix remain
// candidates, so an inconclusive bounded scan cannot enable native analysis.
function _isMP4AudioContainer(data) {
    if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0, candidate = false;
    for (let boxes = 0; boxes < 64; boxes++) {
        if (data.length - at < 8) return candidate;
        const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
        if (type === 'ftyp' || type === 'moov' || type === 'mdat') return true;
        if (type === 'free' || type === 'skip' || type === 'wide') candidate = true;
        let size = view.getUint32(at), header = 8;
        if (size === 1) {
            if (data.length - at < 16) return candidate;
            size = view.getUint32(at + 8) * 0x100000000 + view.getUint32(at + 12);
            header = 16;
        } else if (size === 0) size = data.length - at;
        if (!Number.isSafeInteger(size) || size < header || size > data.length - at) return candidate;
        at += size;
        if (at === data.length) return candidate;
    }
    return true; // Plausible prefix exceeded recognition budget: require verification.
}

// --- MP4 demuxer ---
function _demuxMP4Audio(data, metadataOnly = false, selectedTrackId = null, validateOnly = false) {
    // Keep encoded tables as views. No packet copies or per-sample objects are
    // made until every selected-track count, clock and media range is feasible.
    try {
        if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1) return null;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const maxSamples = 1000000, maxPacketBytes = 256 * 1024 * 1024;
        const tracks = [], mediaRanges = [];
        let movieTimescale = 1000, foundMovie = false, foundMovieHeader = false, boxes = 0;
        const str = (at, n) => String.fromCharCode(...data.subarray(at, at + n));
        const uint64 = at => { const n = view.getBigUint64(at); return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : NaN; };
        function header(at, end) {
            if (end - at < 8) return null;
            let size = view.getUint32(at), length = 8;
            if (size === 1) { if (end - at < 16) return null; size = uint64(at + 8); length = 16; }
            else if (!size) size = end - at;
            if (!Number.isSafeInteger(size) || size < length || size > end - at) return null;
            return {type:str(at + 4, 4), start:at + length, end:at + size};
        }
        function save(track, name, start, end) {
            if (track[name]) return false;
            track[name] = {start, end};
            return true;
        }
        function walk(start, end, parent = '', track = null, depth = 0) {
            if (depth > 8) return false;
            let at = start;
            while (at < end) {
                if (++boxes > 100000) return false;
                const b = header(at, end); if (!b) return false;
                const {type, start:s, end:e} = b;
                if (type === 'moov') {
                    if (parent || foundMovie) return false;
                    foundMovie = true; if (!walk(s, e, type, null, depth + 1)) return false;
                } else if (type === 'trak') {
                    if (parent !== 'moov' || track || tracks.length >= 64) return false;
                    const next = {id:null, handler:null, timescale:0, mediaStart:-1, segmentDuration:-1, timelineDuration:0};
                    tracks.push(next); if (!walk(s, e, type, next, depth + 1)) return false;
                } else if (type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'edts') {
                    const expected = {mdia:'trak', minf:'mdia', stbl:'minf', edts:'trak'}[type];
                    if (!track || parent !== expected || !save(track, type, s, e) || !walk(s, e, type, track, depth + 1)) return false;
                } else if (type === 'mdat' && !parent) mediaRanges.push([s, e]);
                else if (type === 'mvhd' && parent === 'moov') {
                    if (foundMovieHeader) return false;
                    foundMovieHeader = true;
                    if (e - s < 1 || data[s] > 1 || e - s < (data[s] ? 24 : 16)) return false;
                    movieTimescale = view.getUint32(s + (data[s] ? 20 : 12)); if (!movieTimescale) return false;
                } else if (track && type === 'tkhd' && parent === 'trak') {
                    if (!save(track, type, s, e) || e - s < 1 || data[s] > 1 || e - s < (data[s] ? 24 : 16)) return false;
                    track.id = view.getUint32(s + (data[s] ? 20 : 12));
                } else if (track && type === 'mdhd' && parent === 'mdia') {
                    if (!save(track, type, s, e) || e - s < 1 || data[s] > 1 || e - s < (data[s] ? 24 : 16)) return false;
                    track.timescale = view.getUint32(s + (data[s] ? 20 : 12)); if (!track.timescale) return false;
                } else if (track && type === 'hdlr' && parent === 'mdia') {
                    if (!save(track, type, s, e) || e - s < 12 || data[s] !== 0) return false;
                    track.handler = str(s + 8, 4);
                } else if (track && type === 'elst' && parent === 'edts') {
                    if (!save(track, type, s, e) || e - s < 8 || data[s] > 1) return false;
                    const stride = data[s] ? 20 : 12, count = view.getUint32(s + 4);
                    if (count > Math.floor((e - s - 8) / stride)) return false;
                    for (let i = 0; i < count; i++) {
                        const p = s + 8 + i * stride;
                        const duration = data[s] ? uint64(p) : view.getUint32(p);
                        const time = data[s] ? Number(view.getBigInt64(p + 8)) : view.getInt32(p + 4);
                        if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(time) || time < -1) return false;
                        if (time === -1) track.timelineDuration += duration;
                        else { track.mediaStart = time; track.segmentDuration = duration; break; }
                        if (!Number.isSafeInteger(track.timelineDuration)) return false;
                    }
                } else if (track && parent === 'stbl' && ['stsd','stsz','stsc','stco','co64','stts'].includes(type)) {
                    if (!save(track, type === 'co64' || type === 'stco' ? 'offsets' : type, s, e)) return false;
                    if (type === 'co64' || type === 'stco') track.offsetWidth = type === 'co64' ? 8 : 4;
                }
                at = e;
            }
            return at === end;
        }
        function format(track) {
            const b = track.stsd;
            if (!b || b.end - b.start < 8 || data[b.start] !== 0 || view.getUint32(b.start + 4) !== 1) return false;
            const entry = header(b.start + 8, b.end);
            if (!entry || entry.end !== b.end || entry.end - entry.start < 28) return false;
            const at = entry.start, version = view.getUint16(at + 8);
            // QuickTime v1 adds four packet fields. V2 needs its own rate/layout
            // interpretation; do not read its fields using the v0 offsets.
            if (version > 1 || entry.end - at < (version ? 44 : 28)) return false;
            const f = track.format = {trackId:track.id, codec:entry.type, channels:null, sampleRate:null, channelLayout:null};
            track.codec = entry.type === 'Opus' ? 'opus' : entry.type;
            track.channels = view.getUint16(at + 16);
            track.sampleRate = view.getUint32(at + 24) / 65536;
            track.description = null; track.preSkip = 0;
            if (['sowt','twos','lpcm','in24','in32','fl32','fl64','raw '].includes(entry.type) && !version) {
                f.channels = track.channels; f.sampleRate = track.sampleRate;
            }
            let p = at + (version ? 44 : 28), customLayout = false;
            const configurations = new Set();
            while (p < entry.end) {
                if (++boxes > 100000) return false;
                const child = header(p, entry.end); if (!child) return false;
                const {start:s, end:e, type} = child;
                if (['dOps','esds','dfLa'].includes(type)) {
                    if (configurations.has(type)) return false;
                    configurations.add(type);
                }
                if (e - s > 65536 && ['dOps','esds','dfLa'].includes(type)) return false;
                if (type === 'dOps' && entry.type === 'Opus') {
                    if (track.description || e - s < 11 || data[s] !== 0) return false;
                    const channels = data[s + 1], family = data[s + 10];
                    if (!channels || (family === 0 && (channels > 2 || e - s !== 11))) return false;
                    if (family !== 0) {
                        if (family !== 1 || e - s !== 13 + channels) return false;
                        const streams = data[s + 11], coupled = data[s + 12];
                        if (!streams || coupled > streams || streams + coupled > channels) return false;
                        if (!data.subarray(s + 13, e).every(n => n === 255 || n < streams + coupled)) return false;
                    }
                    track.description = data.subarray(s, e);
                    track.channels = f.channels = channels; track.sampleRate = f.sampleRate = 48000;
                    track.preSkip = view.getUint16(s + 2);
                    if (family === 1) f.channelLayout = channels === 6 ? '5.1' : channels === 8 ? '7.1' : null;
                } else if (type === 'dfLa' && entry.type === 'fLaC') {
                    if (e - s < 42 || (data[s + 4] & 127) !== 0 || view.getUint32(s + 4) % 0x1000000 !== 34) return false;
                    const si = s + 8;
                    f.sampleRate = (data[si + 10] << 12) | (data[si + 11] << 4) | (data[si + 12] >> 4);
                    f.channels = ((data[si + 12] >> 1) & 7) + 1;
                    if (typeof WarpScrubAudio !== 'undefined') f.channelLayout = WarpScrubAudio.monitor.flacLayout(data.subarray(s + 4, e));
                } else if (type === 'esds' && entry.type === 'mp4a') {
                    if (e - s < 4) return false;
                    parseEsdsFormat(s + 4, e, f, 0, track);
                    if (f.codec === 'aac') {
                        if (!track.description) track.codec = 'mp4a.40.2';
                    } else if (f.codec && f.codec !== 'mp4a') track.codec = f.codec;
                    if (typeof WarpScrubAudio !== 'undefined') f.channelLayout = WarpScrubAudio.monitor.aacLayout(data.subarray(s, e));
                } else if (type === 'chan') customLayout = true;
                p = e;
            }
            if (f.channels) track.channels = f.channels;
            if (f.sampleRate) track.sampleRate = f.sampleRate;
            if (customLayout) f.channelLayout = null;
            if (entry.type === 'Opus' && !track.description) return false;
            return true;
        }
        function parseEsdsFormat(start, end, format, depth = 0, decoder = null) {
            if (depth > 3) return;
            for (let at = start; at < end;) {
                const tag = data[at++];
                let length = 0, complete = false;
                for (let i = 0; i < 4 && at < end; i++) {
                    const value = data[at++]; length = length * 128 + (value & 127);
                    if (!(value & 128)) { complete = true; break; }
                }
                if (!complete || at + length > end) return;
                const limit = at + length;
                if (tag === 3 && length >= 3) {
                    let child = at + 3;
                    const flags = data[at + 2];
                    if (flags & 128) child += 2;
                    if (flags & 64) child += 1 + data[child];
                    if (flags & 32) child += 2;
                    parseEsdsFormat(child, limit, format, depth + 1, decoder);
                } else if (tag === 4 && length >= 13) {
                    format.codec = ({64:'aac', 102:'aac', 103:'aac', 104:'aac', 105:'mp3', 107:'mp3',
                        165:'ac-3', 166:'ec-3', 169:'dtsc', 170:'dtsh', 171:'dtsh', 172:'dtse'})[data[at]] || 'mp4a';
                    parseEsdsFormat(at + 13, limit, format, depth + 1, decoder);
                } else if (tag === 5 && format.codec === 'aac' && length >= 2) {
                    let bit = at * 8;
                    const read = n => {
                        if (bit + n > limit * 8) throw new Error('Truncated AudioSpecificConfig');
                        let value = 0;
                        for (let i = 0; i < n; i++, bit++) value = value * 2 + ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
                        return value;
                    };
                    const objectType = () => { const type = read(5); return type === 31 ? 32 + read(6) : type; };
                    const frequency = () => {
                        const index = read(4);
                        return index === 15 ? read(24) : [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][index];
                    };
                    const type = objectType();
                    if (decoder) { decoder.codec = 'mp4a.40.' + type; decoder.description = data.subarray(at, limit); }
                    let rate = frequency(), configuration = read(4);
                    let stereoExtension = type === 29;
                    if (type === 5 || type === 29) { rate = frequency(); objectType(); }
                    // Backward-compatible HE-AAC may declare SBR/parametric stereo
                    // in a sync extension instead of the initial object type.
                    if (type !== 5 && type !== 29 && length <= 64) {
                        for (let probe = bit; probe + 21 <= limit * 8; probe++) {
                            bit = probe;
                            if (read(11) !== 0x2b7 || objectType() !== 5 || !read(1)) continue;
                            rate = frequency();
                            if (bit + 12 <= limit * 8 && read(11) === 0x548) stereoExtension = !!read(1);
                            break;
                        }
                    }
                    // Program Config Elements/custom configurations need their own parser.
                    if ([1,2,3,4,5,29].includes(type)) {
                        format.sampleRate = rate || null;
                        format.channels = stereoExtension ? 2 : [null,1,2,3,4,5,6,8][configuration] || null;
                    }
                }
                at = limit;
            }
        }

        if (!walk(0, data.length) || !foundMovie) return null;
        const audio = tracks.filter(t => t.handler === 'soun');
        for (const track of audio) {
            track.valid = !!track.timescale && format(track);
            if (!track.valid) track.format = {trackId:track.id, codec:null, channels:null, sampleRate:null, channelLayout:null};
        }
        const ids = audio.map(t => t.id);
        const chosen = selectedTrackId === null ? audio.length === 1 ? audio[0] : null
            : Number.isInteger(selectedTrackId) ? audio.find(t => t.id === selectedTrackId) : null;
        const selection = chosen ? 'single' : audio.length ? 'ambiguous' : 'none';
        const timelineStart = chosen?.valid ? chosen.timelineDuration / movieTimescale : null;
        if (metadataOnly && !validateOnly) return {timelineStart, channelLayout:chosen?.format.channelLayout || null,
            audioTracks:audio.map(t => t.format), selection, trackId:chosen?.id ?? null};
        if (!chosen?.valid || new Set(ids).size !== ids.length) return null;
        const t = chosen;
        const table = (b, width) => {
            if (!b || b.end - b.start < 8 || data[b.start] !== 0) return null;
            const count = view.getUint32(b.start + 4);
            if (!count || count > maxSamples || count > Math.floor((b.end - b.start - 8) / width)) return null;
            return {start:b.start + 8, count};
        };
        const sizes = t.stsz;
        if (!sizes || sizes.end - sizes.start < 12 || data[sizes.start] !== 0) return null;
        const uniform = view.getUint32(sizes.start + 4), count = view.getUint32(sizes.start + 8);
        if (!count || count > maxSamples || count > data.length) return null;
        if (!uniform && count > Math.floor((sizes.end - sizes.start - 12) / 4)) return null;
        if (uniform && count > Math.floor(Math.min(data.length, maxPacketBytes) / uniform)) return null;
        const sizeAt = i => uniform || view.getUint32(sizes.start + 12 + i * 4);
        let packetBytes = 0;
        for (let i = 0; i < count; i++) {
            const size = sizeAt(i);
            if (!size || size > Math.min(data.length, maxPacketBytes) - packetBytes) return null;
            packetBytes += size;
        }
        const offsets = table(t.offsets, t.offsetWidth), mapping = table(t.stsc, 12), timing = table(t.stts, 8);
        if (!offsets || !mapping || !timing || offsets.count > count || mapping.count > offsets.count || timing.count > count) return null;
        const firstChunk = i => view.getUint32(mapping.start + i * 12);
        const perChunk = i => view.getUint32(mapping.start + i * 12 + 4);
        if (firstChunk(0) !== 1) return null;
        let mapped = 0;
        for (let i = 0; i < mapping.count; i++) {
            const first = firstChunk(i), next = i + 1 < mapping.count ? firstChunk(i + 1) : offsets.count + 1;
            const per = perChunk(i), span = next - first;
            if (!per || next <= first || first > offsets.count || next > offsets.count + 1
                || view.getUint32(mapping.start + i * 12 + 8) !== 1 || per > Math.floor((count - mapped) / span)) return null;
            mapped += per * span;
        }
        if (mapped !== count) return null;
        let timed = 0, ticks = 0;
        for (let i = 0; i < timing.count; i++) {
            const n = view.getUint32(timing.start + i * 8), delta = view.getUint32(timing.start + i * 8 + 4);
            if (!n || !delta || n > count - timed || delta > Math.floor((Number.MAX_SAFE_INTEGER - ticks) / n)) return null;
            timed += n; ticks += n * delta;
        }
        if (timed !== count || ticks / t.timescale > Number.MAX_SAFE_INTEGER / 1000000) return null;
        const offsetAt = i => t.offsetWidth === 8 ? uint64(offsets.start + i * 8) : view.getUint32(offsets.start + i * 4);
        function rangeEnd(pos) {
            let lo = 0, hi = mediaRanges.length - 1;
            while (lo <= hi) { const mid = (lo + hi) >>> 1, range = mediaRanges[mid];
                if (pos < range[0]) hi = mid - 1;
                else if (pos >= range[1]) lo = mid + 1;
                else return range[1];
            }
            return -1;
        }
        let sample = 0, map = 0;
        for (let i = 0; i < offsets.count; i++) {
            while (map + 1 < mapping.count && firstChunk(map + 1) <= i + 1) map++;
            let pos = offsetAt(i); if (!Number.isSafeInteger(pos)) return null;
            const end = rangeEnd(pos), n = perChunk(map);
            if (end < pos) return null;
            for (let j = 0; j < n; j++, sample++) { const size = sizeAt(sample); if (size > end - pos) return null; pos += size; }
        }
        if (!Number.isFinite(t.sampleRate) || t.sampleRate <= 0 || t.sampleRate > 1048575 || !t.channels || t.channels > 256) return null;
        const preSkip = t.mediaStart >= 0 ? Math.round(t.mediaStart * t.sampleRate / t.timescale) : t.preSkip;
        const maxFrames = t.segmentDuration > 0 ? Math.round(t.segmentDuration / movieTimescale * t.sampleRate) : 0;
        if (!Number.isSafeInteger(preSkip) || !Number.isSafeInteger(maxFrames)) return null;
        if (t.codec.startsWith('mp4a.40.') && (!t.description || !t.format.channels || !t.format.sampleRate)) return null;
        // Package inspection needs the same complete table/range validation,
        // without packet copies, expanded timestamps or a second parser.
        if (validateOnly && !foundMovieHeader) return null; // No default clock may certify a package start.
        if (validateOnly) return {codec:t.codec, channels:t.format.channels, sampleRate:t.format.sampleRate,
            timelineStart, trackId:t.id, audioTrackCount:audio.length,
            videoTrackCount:tracks.filter(track => track.handler === 'vide').length,
            trackCount:tracks.length, packetCount:count, encodedDuration:ticks / t.timescale};
        // All rejection checks precede packet copies. Build timestamps and offsets
        // directly from validated compact runs, without expanded helper arrays.
        const chunks = [];
        let run = 0, remaining = view.getUint32(timing.start), timestamp = 0;
        sample = 0; map = 0;
        for (let i = 0; i < offsets.count; i++) {
            while (map + 1 < mapping.count && firstChunk(map + 1) <= i + 1) map++;
            let pos = offsetAt(i);
            for (let j = 0; j < perChunk(map); j++, sample++) {
                const size = sizeAt(sample);
                chunks.push({timestamp:Math.round(timestamp * 1000000 / t.timescale), data:data.slice(pos, pos + size)});
                pos += size; timestamp += view.getUint32(timing.start + run * 8 + 4);
                if (--remaining === 0 && run + 1 < timing.count) remaining = view.getUint32(timing.start + (++run) * 8);
            }
        }
        let description = t.description;
        if (t.codec === 'opus') {
            const d = description, head = new Uint8Array(d.length + 8);
            head.set([79,112,117,115,72,101,97,100,1,d[1]]);
            head[10] = d[3]; head[11] = d[2];
            head[12] = d[7]; head[13] = d[6]; head[14] = d[5]; head[15] = d[4];
            head[16] = d[9]; head[17] = d[8]; head.set(d.subarray(10), 18); description = head;
        } else if (description) description = description.slice();
        return {chunks, sampleRate:t.sampleRate, channels:t.channels, codec:t.codec, description,
            preSkip, maxSamples:maxFrames, timelineStart, channelLayout:t.format.channelLayout, trackId:t.id};
    } catch (_) { return null; } // Malformed input never escapes the pure parser.
}

// --- WebM demuxer ---
function _demuxWebMAudio(data, metadataOnly = false) {
    let audioTrackNum = -1;
    let codecPrivate = null;
    let sampleRate = 48000;
    let channels = 2;
    let timestampScale = 1000000;
    const chunks = [];
    const audioTracks = [];
    let foundTracks = false;

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
        Audio: 0xE1, SampleRate: 0xB5, OutputSampleRate: 0x78B5, Channels: 0x9F,
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
                foundTracks = true;
                let o = el.dataOffset;
                while (o < dEnd) { const e2 = readEl(d, o); if (!e2) break; if (e2.id === ID.TrackEntry) parseTrackEntry(d, e2.dataOffset, e2.dataOffset + e2.dataSize); o = e2.dataOffset + e2.dataSize; }
            } else if (el.id === ID.Cluster && audioTrackNum >= 0 && !metadataOnly) {
                parseCluster(d, el.dataOffset, dEnd);
            }
            off = dEnd;
        }
    }

    function parseTrackEntry(d, start, end) {
        let num = -1, type = -1, codec = '', priv = null, sr = 48000, ch = 2;
        let sourceRate = 8000, sourceChannels = 1, outputRate = null; // Matroska defaults
        let off = start;
        while (off < end) {
            const el = readEl(d, off); if (!el) break;
            const dEnd = el.dataOffset + el.dataSize;
            if (el.id === ID.TrackNumber) num = readUint(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.TrackType) type = readUint(d, el.dataOffset, el.dataSize);
            else if (el.id === ID.CodecID) codec = readString(d, el.dataOffset, Math.min(el.dataSize, 128));
            else if (el.id === ID.CodecPrivate && !metadataOnly) priv = d.slice(el.dataOffset, dEnd);
            else if (el.id === ID.Audio) {
                let ao = el.dataOffset;
                while (ao < dEnd) {
                    const ae = readEl(d, ao); if (!ae || ae.dataOffset + ae.dataSize > dEnd) break;
                    if (ae.id === ID.SampleRate && [4,8].includes(ae.dataSize)) sr = sourceRate = readFloat(d, ae.dataOffset, ae.dataSize);
                    else if (ae.id === ID.OutputSampleRate && [4,8].includes(ae.dataSize)) outputRate = readFloat(d, ae.dataOffset, ae.dataSize);
                    else if (ae.id === ID.Channels) ch = sourceChannels = readUint(d, ae.dataOffset, ae.dataSize);
                    ao = ae.dataOffset + ae.dataSize;
                }
            }
            off = dEnd;
        }
        if (type === 2) audioTracks.push({codec, channels:sourceChannels,
            sampleRate:codec === 'A_OPUS' ? 48000 : outputRate || sourceRate, channelLayout:null});
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

    if (metadataOnly) return foundTracks ? { audioTracks } : null;
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

    const maxSamples = 1000000; // bounded metadata; larger inputs use native seeking

    // Per-trak temp state, committed at trak end only for the first 'vide' track.
    let t = null;      // current trak accumulator
    let video = null;  // committed video track

    function walk(start, end, depth = 0) {
        if (depth > 32) return false; // containers are shallow; bound hostile nesting
        let off = start;
        while (off + 8 <= end) {
            let size = view.getUint32(off);
            const type = readStr(off + 4, 4);
            let headerLen = 8;
            if (size === 1) {
                if (off + 16 > end) return false;
                size = Number(view.getBigUint64(off + 8));
                headerLen = 16;
            } else if (size === 0) {
                size = end - off;
            }
            if (!Number.isSafeInteger(size) || size < headerLen || size > end - off) return false;
            const s = off + headerLen, e = off + size;

            if (type === 'moov' || type === 'mdia' || type === 'minf' || type === 'stbl' ||
                type === 'edts') {
                if (!walk(s, e, depth + 1)) return false;
            } else if (type === 'trak') {
                if (t) return false; // a trak cannot contain another trak
                t = { handler: null, timescale: 1, elstMediaTime: 0 };
                if (!walk(s, e, depth + 1)) return false;
                if (!video && t.handler === 'vide' && t.codec && t.sizes && t.chunkOffsets && t.dtsDeltas) {
                    video = t;
                }
                t = null;
            } else if (!t) {
                // outside a trak — skip
            } else if (type === 'elst') {
                if (e - s < 8 || data[s] > 1) return false;
                // Edit list — scoped per trak (same invariant as the audio demuxer:
                // never let another track's elst clobber the video track's). The
                // first entry with media_time >= 0 shifts the presentation
                // timeline: the <video> element applies it, so raw sample pts run
                // ahead by media_time/timescale (e.g. the 2-frame x264 B-frame
                // lead). Without this shift the overlay paints the wrong frame.
                const version = data[s];
                const n = view.getUint32(s + 4);
                if (n > Math.floor((e - s - 8) / (version === 1 ? 20 : 12))) return false;
                let eOff = s + 8;
                for (let i = 0; i < n && eOff + (version === 1 ? 20 : 12) <= e; i++) {
                    const mt = version === 1
                        ? Number(view.getBigInt64(eOff + 8))
                        : view.getInt32(eOff + 4);
                    eOff += version === 1 ? 20 : 12;
                    if (!Number.isSafeInteger(mt)) return false;
                    if (mt >= 0) { t.elstMediaTime = mt; break; }
                }
            } else if (type === 'mdhd') {
                if (e - s < 1 || data[s] > 1 || e - s < (data[s] === 1 ? 24 : 16)) return false;
                const version = data[s];
                t.timescale = view.getUint32(version === 1 ? s + 20 : s + 12);
                if (!t.timescale) return false;
            } else if (type === 'hdlr') {
                if (e - s < 12) return false;
                t.handler = readStr(s + 8, 4);
            } else if (type === 'stsd') {
                if (!parseStsdVideo(s, e)) return false;
            } else if (type === 'stss') {
                if (e - s < 8) return false;
                const n = view.getUint32(s + 4);
                if (n > maxSamples || n > Math.floor((e - s - 8) / 4)) return false;
                t.syncSamples = new Set();
                for (let i = 0; i < n && s + 8 + i * 4 + 4 <= e; i++) {
                    t.syncSamples.add(view.getUint32(s + 8 + i * 4)); // 1-based
                }
            } else if (type === 'stsz') {
                if (e - s < 12) return false;
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
                if (cnt !== n) return false;
                // Keep a view of the encoded table until cheap cross-table and
                // range checks pass. A declared count must not allocate samples.
                // One million samples also bounds valid-but-pathological metadata;
                // larger inputs retain native seeking (about 4.6 h at 60 fps).
                if (n > maxSamples || (uniform && n > Math.floor(data.length / uniform))) return false;
                if (!uniform) {
                    let total = 0;
                    for (let i = 0; i < cnt; i++) {
                        const size = view.getUint32(s + 12 + i * 4);
                        if (!size || size > data.length - total) return false;
                        total += size;
                    }
                }
                t.sizes = { length: cnt, uniform, start: s + 12 };
            } else if (type === 'stsc') {
                if (e - s < 8) return false;
                // Clamp entry count to the box bytes (12 per entry) — defense in
                // depth so a bogus count can't drive an out-of-bounds getUint32.
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 12)));
                if (n > maxSamples || n !== view.getUint32(s + 4)) return false;
                t.stsc = [];
                for (let i = 0; i < n; i++) {
                    const b = s + 8 + i * 12;
                    t.stsc.push({ firstChunk: view.getUint32(b), perChunk: view.getUint32(b + 4), description: view.getUint32(b + 8) });
                }
            } else if (type === 'stco' || type === 'co64') {
                if (e - s < 8) return false;
                const entry = type === 'stco' ? 4 : 8;
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / entry)));
                if (n > maxSamples || n !== view.getUint32(s + 4)) return false;
                t.chunkOffsets = new Array(n);
                for (let i = 0; i < n; i++) {
                    t.chunkOffsets[i] = type === 'stco'
                        ? view.getUint32(s + 8 + i * 4)
                        : Number(view.getBigUint64(s + 8 + i * 8));
                }
            } else if (type === 'stts') {
                if (e - s < 8) return false;
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 8)));
                if (n > maxSamples || n !== view.getUint32(s + 4)) return false;
                t.dtsDeltas = [];
                for (let i = 0; i < n; i++) {
                    const b = s + 8 + i * 8;
                    t.dtsDeltas.push({ count: view.getUint32(b), delta: view.getUint32(b + 4) });
                }
            } else if (type === 'ctts') {
                if (e - s < 8 || data[s] > 1) return false;
                const version = data[s];
                const n = Math.min(view.getUint32(s + 4), Math.max(0, Math.floor((e - (s + 8)) / 8)));
                if (n > maxSamples || n !== view.getUint32(s + 4)) return false;
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
        return off === end;
    }

    function parseStsdVideo(s, e) {
        // stsd: version+flags(4) entry_count(4) then sample entries
        if (e - s < 8) return false;
        const entryStart = s + 8;
        if (!view.getUint32(s + 4) || entryStart + 8 > e) return false;
        const entrySize = view.getUint32(entryStart);
        const fourcc = readStr(entryStart + 4, 4);
        if (entrySize < 8 || entrySize > e - entryStart) return false;
        if (fourcc !== 'avc1' && fourcc !== 'avc3' && fourcc !== 'hvc1' && fourcc !== 'hev1') return true;
        if (entrySize < 86 || view.getUint32(s + 4) !== 1) return false;
        const entryEnd = entryStart + entrySize;
        // VisualSampleEntry: width/height at +32/+34 from entry box start,
        // child boxes (avcC/hvcC/…) start at +86.
        t.width = view.getUint16(entryStart + 32);
        t.height = view.getUint16(entryStart + 34);
        let off = entryStart + 86;
        while (off + 8 <= entryEnd) {
            const cSize = view.getUint32(off);
            const cType = readStr(off + 4, 4);
            if (cSize < 8 || cSize > entryEnd - off) return false;
            if (cType === 'avcC' && (fourcc === 'avc1' || fourcc === 'avc3')) {
                if (cSize < 15) return false; // AVCDecoderConfigurationRecord fixed header
                t.description = data.slice(off + 8, off + cSize);
                // avc1.PPCCLL from avcC profile / compat / level bytes
                const hex = b => b.toString(16).padStart(2, '0');
                t.codec = 'avc1.' + hex(t.description[1]) + hex(t.description[2]) + hex(t.description[3]);
            } else if (cType === 'hvcC' && (fourcc === 'hvc1' || fourcc === 'hev1')) {
                if (cSize < 31) return false; // HEVCDecoderConfigurationRecord fixed header
                t.description = data.slice(off + 8, off + cSize);
                t.codec = _hevcCodecString(t.description);
            } else if (cType === 'colr') {
                if (cSize < 12) return false;
                if (readStr(off + 8, 4) !== 'nclx') { off += cSize; continue; }
                if (cSize < 19) return false;
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
        return off === entryEnd;
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

    if (!walk(0, data.length)) return null;
    if (!video || !video.sizes.length) return null;

    const nSamples = video.sizes.length;
    const sizeAt = i => video.sizes.uniform || view.getUint32(video.sizes.start + i * 4);

    // Validate compact chunk/timing coverage before allocating per-sample data.
    const stsc = video.stsc;
    const chunks = video.chunkOffsets;
    if (!stsc?.length || stsc[0].firstChunk !== 1 || !chunks.length) return null;
    let mapped = 0;
    for (let i = 0; i < stsc.length; i++) {
        const entry = stsc[i];
        const next = i + 1 < stsc.length ? stsc[i + 1].firstChunk : chunks.length + 1;
        if (!entry.perChunk || entry.description !== 1 || entry.firstChunk > chunks.length
            || next <= entry.firstChunk || next > chunks.length + 1) return null;
        const span = next - entry.firstChunk;
        if (entry.perChunk > Math.floor((nSamples - mapped) / span)) return null;
        mapped += span * entry.perChunk;
    }
    if (mapped !== nSamples) return null;
    for (const runs of [video.dtsDeltas, video.ctts]) {
        if (!runs) continue;
        let count = 0;
        for (const run of runs) {
            if (!run.count || run.count > nSamples - count) return null;
            count += run.count;
        }
        if (count !== nSamples) return null;
    }
    if (video.syncSamples) {
        if (!video.syncSamples.size) return null;
        for (const n of video.syncSamples) if (n < 1 || n > nSamples) return null;
    }

    // Check every byte range without an offsets array. Uniform runs take one
    // check per chunk; variable sizes are read directly from the bounded table.
    let sample = 0, mapIndex = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
        while (mapIndex + 1 < stsc.length && stsc[mapIndex + 1].firstChunk <= ci + 1) mapIndex++;
        const per = stsc[mapIndex].perChunk;
        let pos = chunks[ci];
        if (!Number.isSafeInteger(pos) || pos < 0 || pos > data.length) return null;
        if (video.sizes.uniform) {
            if (per > Math.floor((data.length - pos) / video.sizes.uniform)) return null;
            sample += per;
        } else {
            for (let j = 0; j < per; j++, sample++) {
                const size = sizeAt(sample);
                if (size > data.length - pos) return null;
                pos += size;
            }
        }
    }

    // All inexpensive rejection paths above precede per-sample allocation.
    const offsets = new Array(nSamples);
    sample = 0; mapIndex = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
        while (mapIndex + 1 < stsc.length && stsc[mapIndex + 1].firstChunk <= ci + 1) mapIndex++;
        let pos = chunks[ci];
        for (let j = 0; j < stsc[mapIndex].perChunk; j++, sample++) {
            offsets[sample] = pos;
            pos += sizeAt(sample);
        }
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
            size: sizeAt(i),
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
