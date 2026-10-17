// Admission describes evidence and available tools; it never certifies decoding.
// Pure policy. Browser decoding, host readiness and playback keep their owners.
const WarpMediaInput = (() => {
    const VERSION = 1;
    function assessMP4Audio(metadata) {
        const tracks = metadata && Array.isArray(metadata.audioTracks) ? metadata.audioTracks : null;
        const count = tracks && tracks.length <= 64 ? tracks.length : null;
        const code = count === null ? 'audio-inventory-unverified'
            : count > 1 ? 'audio-track-selection-required' : null;
        const message = code === 'audio-inventory-unverified'
            ? 'The MP4 audio track could not be verified. Analysis and scrub audio are unavailable. Prepare a file with one audio track. Playback stays browser-managed.'
            : code === 'audio-track-selection-required'
                ? 'Multiple MP4 audio tracks: analysis and scrub audio are unavailable. Prepare a file with one audio track. Playback uses the browser’s track choice.' : '';
        return Object.freeze({
            contract: 'warpdiff.media-input', version: VERSION,
            profile: 'mp4-audio-selection-v1', evidence: 'container-metadata',
            status: code ? 'preparation-required' : 'eligible',
            audioTrackCount: count,
            // Eligible includes a verified absence of audio; downstream decoding
            // still distinguishes silence/no track from an unsupported soundtrack.
            decodedAudio: code ? 'withheld' : 'eligible',
            playback: 'browser-managed', code, message,
        });
    }
    function capability(state, evidence, reason) {
        return Object.freeze({state, evidence, reason});
    }
    function assessCapabilities(facts = {}) {
        const kind = ['image', 'video', 'audio'].includes(facts.kind) ? facts.kind : 'unknown';
        const container = ['mp4', 'webm'].includes(facts.container) ? facts.container : 'unknown';
        const count = facts.inventoryKnown === true && Number.isInteger(facts.audioTrackCount) &&
            facts.audioTrackCount >= 0 && facts.audioTrackCount <= 64 ? facts.audioTrackCount : null;
        const selection = container === 'mp4' ? assessMP4Audio(count === null ? null : {audioTracks: Array(count)}) : null;
        const blocked = selection?.decodedAudio === 'withheld';
        const absent = count === 0, image = kind === 'image', audio = kind === 'audio';
        const failed = facts.mediaFailed === true;
        const noSound = image || absent;
        const na = capability('not-applicable', 'media-kind', 'This input does not require this capability.');
        const decoded = noSound ? na : blocked
            ? capability('unavailable', 'track-policy', selection.message)
            : facts.audioDecoded === true ? capability('available', 'audio-decoder', 'Audio samples were decoded from the loaded file.')
                : facts.audioDecodeFailed === true || facts.noAudioDetected === true
                    ? capability('unavailable', 'decode-result', 'Decoded audio is unavailable; prepare a compatible file if audio is expected.')
                    : capability('unknown', 'not-observed', 'Audio decoding has not been verified.');
        const picture = audio ? na : failed ? capability('unavailable', 'media-error', 'The picture could not be decoded.')
            : facts.pictureDecoded === true ? capability('available', 'decoded-picture', 'A decoded image or initial video frame was verified.')
                : capability('unknown', 'not-observed', 'A decoded picture has not been verified.');
        const native = image ? na : failed ? capability('unavailable', 'media-error', 'The native player reported a media failure.')
            : facts.nativeDataReady === true && (audio || picture.state === 'available')
                ? capability('available', 'native-media-data', 'The native player supplied media data; this does not verify every soundtrack or the complete file.')
                : capability('unknown', 'not-observed', 'Native playback readiness has not been verified.');
        const analysis = noSound ? na : blocked ? decoded : facts.analysisReady === true && decoded.state === 'available'
            ? capability('available', 'analysis-result', 'Waveform, spectrogram and metrics use decoded audio from the loaded file.')
            : decoded.state === 'unavailable' ? decoded : facts.audioDecodeFailed === true
                ? capability('unavailable', 'analysis-result', 'Decoded-audio analysis is unavailable; prepare a compatible file.')
                : capability('unknown', 'not-observed', 'Decoded-audio analysis has not completed.');
        const preview = noSound ? na : blocked ? decoded : facts.previewReady === true && decoded.state === 'available'
            ? capability('available', 'listening-buffer', 'A scrub listening buffer is available; its format may differ from the source.')
            : facts.previewUnavailable === true || facts.audioDecodeFailed === true || decoded.state === 'unavailable'
                ? capability('unavailable', 'preview-result', 'Scrub audio is unavailable; normal playback may still work.')
                : capability('unknown', 'not-observed', 'Scrub audio has not been prepared.');
        const duration = !image && Number.isFinite(facts.durationSeconds) && facts.durationSeconds > 0
            ? Object.freeze({state: 'known', seconds: facts.durationSeconds, evidence: 'native-metadata'})
            : Object.freeze({state: image ? 'not-applicable' : 'unknown', seconds: null, evidence: 'not-observed'});
        const start = !noSound && facts.audioStartKnown === true && Number.isFinite(facts.audioStartSeconds) && facts.audioStartSeconds >= 0
            ? Object.freeze({state: 'known', seconds: facts.audioStartSeconds, evidence: 'container-timeline'})
            : Object.freeze({state: noSound ? 'not-applicable' : 'unknown', seconds: null, evidence: 'not-observed'});
        return Object.freeze({contract: 'warpdiff.media-input', version: VERSION, profile: 'direct-capabilities-v1', kind, container,
            audioTrackCount: count,
            admission: Object.freeze({state: failed ? 'failed' : facts.loaderDecision === 'admitted' ? 'admitted' : 'pending',
                authority: 'existing-loader', preparedProfile: 'not-validated'}),
            capabilities: Object.freeze({picture, nativePlayback: native,
                frameAccess: audio ? na : failed ? picture : facts.frameAccess === true
                    ? capability('available', 'canvas-readback', 'The current comparison element supplied readable pixels.')
                    : capability('unknown', 'not-observed', 'Pixel access from the current element has not been verified.'),
                audioDecode: decoded, decodedAnalysis: analysis, scrubAudio: preview,
                originalSourceAnalysis: noSound ? na : blocked ? decoded : analysis.state === 'unavailable' ? analysis
                    : capability('unknown', 'not-certified', 'Decoded-file analysis does not certify original channel fidelity or professional measurement conformance.'),
            }),
            timing: Object.freeze({duration, audioStart: start,
                frameRate: capability(kind === 'video' ? 'unknown' : 'not-applicable', 'not-certified', 'Exact frame rate and constant-frame-rate conformance are not verified by this report.'),
                synchronization: capability(kind === 'video' && !absent ? 'unknown' : 'not-applicable', 'not-certified', 'A known start timestamp does not certify complete A/V synchronization.'),
            }),
            issues: Object.freeze(blocked ? [Object.freeze({code: selection.code, message: selection.message})] : []),
        });
    }
    function createEvidenceStore() {
        const entries = new Map();
        const keys = ['pictureDecoded', 'frameAccess', 'nativeDataReady', 'mediaFailed', 'audioDecoded', 'audioDecodeFailed',
            'container', 'inventoryKnown', 'audioTrackCount', 'metadataAudioStart'];
        return Object.freeze({
            begin(slot, owner) { entries.set(slot, {owner, facts: Object.freeze({})}); },
            observe(slot, owner, patch) {
                const entry = entries.get(slot);
                if (!entry || entry.owner !== owner) return false;
                const selected = {};
                for (const key of keys.filter(key => Object.hasOwn(patch, key))) {
                    const value = patch[key];
                    if (key === 'container') selected[key] = ['mp4', 'webm'].includes(value) ? value : 'unknown';
                    else if (key === 'audioTrackCount') selected[key] = Number.isInteger(value) && value >= 0 && value <= 64 ? value : null;
                    else if (key === 'metadataAudioStart') selected[key] = Number.isFinite(value) && value >= 0 ? value : null;
                    else if (typeof value === 'boolean') selected[key] = value;
                }
                entry.facts = Object.freeze({...entry.facts, ...selected}); return true;
            },
            read(slot, owner) { const entry = entries.get(slot); return entry?.owner === owner ? entry.facts : null; },
            clear() { entries.clear(); },
        });
    }
    return Object.freeze({version: VERSION, assessMP4Audio, assessCapabilities, createEvidenceStore});
})();
