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
    return Object.freeze({version: VERSION, assessMP4Audio});
})();
