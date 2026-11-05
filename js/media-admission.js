// Observes existing loading/decoding owners. Reports never authorize host READY.
//
// Header Media status is a definite-limitation signal, not a loading indicator.
// A loaded input needs attention when its current report has failed admission,
// a structured issue (for example more than one audio track), or picture,
// native playback, pixel access, audio decoding, loaded-file analysis, or scrub
// audio in the unavailable state. Unknown ("Not verified"), not-applicable, and
// available do not count, so an ordinary image or a video whose exact frame
// rate, full synchronization, or original-source fidelity is unverified stays
// quiet. Help opens the same dialog whenever media is loaded. Managed review
// has no Help, so its header button stays while media is loaded.
const _mediaInputEvidence = WarpMediaInput.createEvidenceStore();
const _MEDIA_INPUT_ATTENTION = ['picture', 'nativePlayback', 'frameAccess', 'audioDecode', 'decodedAnalysis', 'scrubAudio'];
let _mediaInputStatusQueued = false;
let _mediaInputStatusOpener = null;
let _mediaInputRetiring = false;

function _mediaInputShown(element) {
    return element && element.isConnected && !element.hidden && element.getClientRects().length ? element : null;
}
function _mediaInputHasLoaded() {
    return !_mediaInputRetiring && assetOrder.some(slot => mediaData[slot]);
}
function _mediaInputReportNeedsAttention(report) {
    if (!report) return false;
    if (report.admission?.state === 'failed' || report.issues?.length) return true;
    return _MEDIA_INPUT_ATTENTION.some(key => report.capabilities?.[key]?.state === 'unavailable');
}
function _mediaInputNeedsAttention() {
    return assetOrder.some(slot => mediaData[slot] && _mediaInputReportNeedsAttention(_getMediaInputReport(slot)));
}
function _syncMediaStatusHeader() {
    const button = document.getElementById('mediaStatusBtn');
    if (!button) return;
    const loaded = _mediaInputHasLoaded();
    const managed = typeof _managedReviewActive === 'function' && _managedReviewActive();
    button.hidden = !(loaded && (_mediaInputNeedsAttention() || managed));
    const help = document.getElementById('helpMediaStatusBtn');
    if (help) help.hidden = !loaded || managed;
}
function _mediaInputBegin(slot) {
    _mediaInputEvidence.begin(slot, mediaData[slot]);
    _mediaInputStatusChanged();
}
function _mediaInputObserve(slot, loadingToken, facts) {
    if (loadingToken !== _loadingProgressToken || !mediaData[slot]) return false;
    const accepted = _mediaInputEvidence.observe(slot, mediaData[slot], facts);
    if (accepted) _mediaInputStatusChanged();
    return accepted;
}
function _mediaInputAudioMetadata(slot, loadingToken, container, metadata) {
    const tracks = metadata?.audioTracks;
    _mediaInputObserve(slot, loadingToken, {container,
        inventoryKnown: Array.isArray(tracks) && (container !== 'webm' || metadata?.trackSelectionVerified === true),
        audioTrackCount: Array.isArray(tracks) ? tracks.length : null,
        metadataTimelineVerified: container !== 'mp4' || metadata?.timelineVerified === true,
        metadataAudioStart: Number.isFinite(metadata?.timelineStart) ? metadata.timelineStart : null});
}
function _mediaInputProbeFrame(slot, element, loadingToken) {
    if (loadingToken !== _loadingProgressToken || !mediaData[slot] ||
        getLayer(slot)?.querySelector('img,video') !== element) return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    try {
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (context && _hostVideoFrameAvailable(element, context)) {
            _mediaInputObserve(slot, loadingToken, {pictureDecoded: true, frameAccess: true});
        }
    } finally { canvas.width = canvas.height = 0; }
}
function _getMediaInputReport(slot) {
    const md = mediaData[slot];
    if (!md) return null;
    const observed = _mediaInputEvidence.read(slot, md);
    if (!observed) return null;
    const element = getLayer(slot)?.querySelector('video,audio');
    const host = _hostLoadIsCurrent(_viewLoadGeneration);
    const analysed = !!audioMetrics[slot] && (!!waveformData[slot] || !!_audioSlotVizData[slot]);
    // Legacy decoding can retain a fallback movie clock. A report cannot call
    // that guessed clock verified container timing, even after samples decode.
    const audioStartKnown = _audioTimelineStartKnown[slot];
    const reportClockVerified = observed.container !== 'mp4' || observed.metadataTimelineVerified === true;
    return WarpMediaInput.assessCapabilities({...observed, kind: md.type,
        loaderDecision: host ? _hostLoadRequest.status === 'ready' ? 'admitted' : 'pending'
            : viewActivating ? 'admitted' : 'pending',
        durationSeconds: element?.duration,
        audioStartKnown: reportClockVerified && (audioStartKnown === true || audioStartKnown === undefined && Number.isFinite(observed.metadataAudioStart)),
        audioStartSeconds: audioStartKnown === true ? _audioTimelineStarts[slot] : observed.metadataAudioStart,
        analysisReady: analysed,
        previewReady: !!_videoAudioBuffers[slot] || !!_audioSlotVizData[slot]?.audioBuffer,
        previewUnavailable: !!_videoScrubStatus[slot]?.unavailable,
        audioDecodeFailed: observed.audioDecodeFailed === true || !!_ffmpegCommands[slot],
        noAudioDetected: _noAudioSlots.has(slot),
    });
}
function _getMediaInputReports() {
    return Object.freeze(Object.fromEntries(assetOrder.filter(slot => mediaData[slot])
        .map(slot => [slot, _getMediaInputReport(slot)]).filter(([, report]) => report)));
}
function _mediaInputStatusChanged() {
    _syncMediaStatusHeader();
    const dialog = document.getElementById('mediaStatusDialog');
    if (!dialog?.open || _mediaInputStatusQueued) return;
    _mediaInputStatusQueued = true;
    queueMicrotask(() => { _mediaInputStatusQueued = false; if (document.getElementById('mediaStatusDialog').open) _renderMediaInputStatus(); });
}
function _mediaInputRefresh() {
    for (const slot of assetOrder) {
        const element = getLayer(slot)?.querySelector('img,video');
        if (element && (element.tagName === 'IMG' ? element.complete && element.naturalWidth > 0 : element.readyState >= 2)) {
            _mediaInputProbeFrame(slot, element, _loadingProgressToken);
        }
    }
    _renderMediaInputStatus();
}
function _renderMediaInputStatus() {
    const content = document.getElementById('mediaStatusContent'); content.replaceChildren();
    const names = {picture: 'Picture', nativePlayback: 'Native playback', frameAccess: 'Pixel access', audioDecode: 'Audio decoding',
        decodedAnalysis: 'Loaded-file audio analysis', scrubAudio: 'Scrub audio', originalSourceAnalysis: 'Original-source fidelity / measurement conformance'};
    const states = {available: 'Available', unavailable: 'Unavailable', unknown: 'Not verified', 'not-applicable': 'Not applicable'};
    for (const [slot, report] of Object.entries(_getMediaInputReports())) {
        const section = document.createElement('section'), title = document.createElement('h3');
        title.textContent = slotLabel(slot) + ' — ' + mediaData[slot].name; section.append(title);
        const admission = document.createElement('p');
        const loadingState = {admitted: 'loaded', pending: 'preparing', failed: 'unavailable'};
        admission.textContent = 'Comparison: ' + loadingState[report.admission.state] + '. Prepared-media requirements: not verified.';
        section.append(admission);
        const list = document.createElement('dl');
        function row(label, value, detail) {
            const term = document.createElement('dt'), description = document.createElement('dd');
            term.textContent = label; description.textContent = value + (detail ? ' — ' + detail : ''); list.append(term, description);
        }
        for (const [key, capability] of Object.entries(report.capabilities)) row(names[key], states[capability.state], capability.reason);
        row('Duration', report.timing.duration.state === 'known' ? report.timing.duration.seconds.toFixed(3) + ' s (reported by player)' : report.timing.duration.state === 'not-applicable' ? 'Not applicable' : 'Not verified');
        row('Audio start', report.timing.audioStart.state === 'known' ? report.timing.audioStart.seconds.toFixed(3) + ' s (container timeline)' : report.timing.audioStart.state === 'not-applicable' ? 'Not applicable' : 'Not verified');
        row('Exact frame rate / CFR', states[report.timing.frameRate.state], report.timing.frameRate.reason);
        row('A/V synchronization', states[report.timing.synchronization.state], report.timing.synchronization.reason);
        section.append(list); content.append(section);
    }
}
function _setMediaInputStatusOpen(open, opener = null) {
    const dialog = document.getElementById('mediaStatusDialog');
    if (open && !dialog.open) {
        _mediaInputStatusOpener = opener || document.activeElement;
        _mediaInputRefresh(); _showAppDialog(dialog);
    } else if (!open && dialog.open) dialog.close();
}
function _mediaInputClear() {
    _mediaInputEvidence.clear();
    _mediaInputRetiring = true;
    _syncMediaStatusHeader();
    _setMediaInputStatusOpen(false);
    _mediaInputRetiring = false;
    document.getElementById('mediaStatusContent').replaceChildren();
}
function _mediaInputStatusClosed() {
    if (document.getElementById('mediaStatusDialog').open) return;
    const target = _mediaInputStatusOpener;
    _mediaInputStatusOpener = null;
    if (document.querySelector('dialog[open]')) return;
    if (!_mediaInputRetiring && _mediaInputShown(target)) {
        target.focus({preventScroll: true});
        return;
    }
    // The header button hid while this dialog was open. Help is the remaining
    // way back to the report; clear/reload still returns to Load.
    if (!_mediaInputRetiring && _mediaInputHasLoaded()) {
        const fallback = _mediaInputShown(document.getElementById('helpMediaStatusBtn'))
            || _mediaInputShown(document.getElementById('helpBtn'));
        if (fallback) { fallback.focus({preventScroll: true}); return; }
    }
    document.getElementById('loadBtn')?.focus({preventScroll: true});
}
document.getElementById('mediaStatusBtn').addEventListener('click', event => _setMediaInputStatusOpen(true, event.currentTarget));
document.getElementById('mediaStatusClose').addEventListener('click', () => _setMediaInputStatusOpen(false));
document.getElementById('mediaStatusRefresh').addEventListener('click', _mediaInputRefresh);
document.getElementById('mediaStatusDialog').addEventListener('close', _mediaInputStatusClosed);
function _bindMediaStatusHelp() {
    document.getElementById('helpMediaStatusBtn')?.addEventListener('click', event => _setMediaInputStatusOpen(true, event.currentTarget));
    _syncMediaStatusHeader();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindMediaStatusHelp, {once:true});
else _bindMediaStatusHelp();
