// Listening settings belong to this comparison, independently of source analysis.
// Channel matrices, headroom and PCM preparation belong to WarpScrubAudio.monitor.
let _audioListening = WarpScrubAudio.monitor.settings();
const _audioMonitorSlots = new Map();
const _audioMonitorRoutes = new Set();

function _setAudioMonitorSlot(slot, value) {
    if (value) _audioMonitorSlots.set(slot, Object.freeze(value));
    else _audioMonitorSlots.delete(slot);
    _applyAudioListening();
}

async function _prepareAudioMonitorSlot(slot, buffer, layout, current) {
    const valid = layout === '5.1' && buffer.numberOfChannels === 6 || layout === '7.1' && buffer.numberOfChannels === 8;
    const info = {layout:valid ? layout : null, channels:buffer.numberOfChannels, ready:false, peaks:null};
    _setAudioMonitorSlot(slot, info);
    if (!valid) return;
    const peaks = await WarpScrubAudio.monitor.peaks(buffer, layout, current);
    if (peaks && current() && _audioMonitorSlots.get(slot) === info) _setAudioMonitorSlot(slot, {...info, peaks, ready:true});
    else if (current() && _audioMonitorSlots.get(slot) === info) _setAudioMonitorSlot(slot, {...info, error:true});
}

function _audioMonitorLayoutForBuffer(slot, buffer) {
    const info = _audioMonitorSlots.get(slot);
    if (!info?.ready || !buffer) return null;
    if (buffer.numberOfChannels === 3 && buffer === _videoAudioBuffers[slot]) return 'stereo-center';
    return buffer.numberOfChannels === info.channels ? info.layout : null;
}

function _audioMonitorPlanForSlot(slot) {
    const info = _audioMonitorSlots.get(slot);
    return WarpScrubAudio.monitor.plan(info?.ready ? _audioListening : {mode:'full'}, info?.peaks);
}

function _connectMonitoredAudio(source, destination, channels, slot) {
    const layout = channels === 3 && _audioMonitorSlots.get(slot)?.ready ? 'stereo-center' : null;
    const route = WarpScrubAudio.monitor.connect(source, destination, channels, layout, _audioMonitorPlanForSlot(slot));
    const entry = {slot, route};
    _audioMonitorRoutes.add(entry);
    let connected = true;
    return {disconnect() {
        if (!connected) return;
        connected = false;
        _audioMonitorRoutes.delete(entry);
        route.disconnect();
    }};
}

function setAudioListening(change) {
    _audioListening = WarpScrubAudio.monitor.settings({..._audioListening, ...change});
    _applyAudioListening();
}

function _applyAudioListening() {
    for (const {slot, route} of _audioMonitorRoutes) route.setMix(_audioMonitorPlanForSlot(slot));
    const slot = currentAudioSource || assetOrder[currentAssetIndex];
    _continuousScrubEngine.setMonitorMix(_audioMonitorPlanForSlot(slot));
    _renderAudioListening();
}

function _renderAudioListening() {
    const control = document.getElementById('audioListeningControl');
    if (!control) return;
    const slot = currentAudioSource || assetOrder[currentAssetIndex], info = _audioMonitorSlots.get(slot);
    control.hidden = !info;
    const ready = !!info?.ready, mode = ready ? _audioListening.mode : 'full';
    const names = {full:'Full Mix', dialogue:'Dialogue Focus', center:'Center Only'};
    document.getElementById('audioListeningLabel').textContent = 'Listen: ' + names[mode];
    control.classList.toggle('focused', mode !== 'full');
    control.querySelectorAll('[data-listening-mode]').forEach(button => {
        button.disabled = button.dataset.listeningMode !== 'full' && !ready;
        button.setAttribute('aria-pressed', String(button.dataset.listeningMode === mode));
    });
    const center = document.getElementById('dialogueCenterLevel'), other = document.getElementById('dialogueOtherLevel');
    center.value = _audioListening.centerDb; other.value = _audioListening.otherDb;
    center.disabled = !ready || mode === 'full'; other.disabled = !ready || mode !== 'dialogue';
    document.getElementById('dialogueCenterValue').textContent = '+' + _audioListening.centerDb + ' dB';
    document.getElementById('dialogueOtherValue').textContent = mode === 'center' || _audioListening.otherDb === -60 ? 'Muted' : _audioListening.otherDb + ' dB';
    const plan = _audioMonitorPlanForSlot(slot);
    document.getElementById('audioListeningStatus').textContent = ready
        ? `${slotLabel(slot)} · ${info.layout} center channel` + (plan.headroomDb < -.05 ? ` · ${(-plan.headroomDb).toFixed(1)} dB headroom applied` : '')
        : info?.error ? 'Center-channel listening could not be prepared. Full Mix is available.'
        : info?.layout ? 'Preparing center-channel listening…'
        : info?.channels <= 2 ? 'This file has no separate center channel.' : 'Center-channel layout could not be verified. Full Mix is available.';
}

function _clearAudioListening() {
    _audioMonitorSlots.clear();
    for (const {route} of _audioMonitorRoutes) route.disconnect();
    _audioMonitorRoutes.clear();
    setAudioListening({mode:'full', centerDb:0, otherDb:-9});
    const control = document.getElementById('audioListeningControl');
    if (control) control.open = false;
}

function _setupAudioListeningControl() {
    const control = document.getElementById('audioListeningControl');
    control.addEventListener('keydown', event => {
        if(event.key === 'Escape' && control.open) {
            control.open = false;
            control.querySelector('summary').focus();
            event.preventDefault();
        }
        event.stopPropagation();
    });
    document.addEventListener('pointerdown', event => {
        if(control.open && !control.contains(event.target)) control.open = false;
    });
}
