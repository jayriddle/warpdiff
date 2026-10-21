// Normal-app preparation owner. Files are retained only for the current manual
// comparison. The separately connected tool never owns admission or transport.
let _localPreparationBatch = null;
let _localPreparationEpoch = 0;
let _localPreparationAction = null;
let _localPreparationOpener = null;
let _localPreparationMessage = '';
let _localPreparationDialogOwner = null;
let _localPreparationRecovery = null;
let _localPreparationNotices = [];
const _LOCAL_COLOR_NOTICES = new Set(['No color tags; assumed BT.709','No color tags; assumed BT.601',
    'Missing color tags; assumed BT.709','Missing color tags; assumed BT.601',
    'Missing color tags; used declared BT.709','Missing color tags; used declared BT.601',
    'Missing color tags; used declared BT.470BG','Missing color tags; used declared BT.470M']);
const _localPreparationConnection = WarpPreparationConnection.create(() => _renderLocalPreparation());

function _releaseLocalPreparationRecovery() {
    const recovery = _localPreparationRecovery;
    if (!recovery) return;
    _localPreparationRecovery = null;
    // Callers may still be reading these collections synchronously. Drop the
    // File blobs on the next turn so a retained object cannot keep them.
    queueMicrotask(() => { recovery.files.length = 0; recovery.preparedFiles.clear(); });
}
function _normalizePreparationInput(file) {
    if (/^(image|video|audio)\//.test(file.type)) return file;
    const ext = file.name.split('.').pop().toLowerCase();
    // .ts is also TypeScript and Qt Linguist. Only an empty or generic
    // octet-stream type is MPEG-TS. .mts and .m2ts remain MPEG-TS.
    if (ext === 'ts') {
        if (!file.type || file.type === 'application/octet-stream') {
            return new File([file], file.name, {type:'video/mp2t', lastModified:file.lastModified});
        }
        return file;
    }
    const types = {mkv:'video/x-matroska',mov:'video/quicktime',mxf:'video/mxf',avi:'video/x-msvideo',
        mts:'video/mp2t',m2ts:'video/mp2t',dts:'audio/vnd.dts',ac3:'audio/ac3',
        eac3:'audio/eac3',mlp:'audio/mlp',truehd:'audio/true-hd'};
    return types[ext] ? new File([file],file.name,{type:types[ext],lastModified:file.lastModified}) : file;
}
function _localPreparationAccept(assignments, preparedFiles = null) {
    if (_managedReviewActive()) return;
    _localPreparationBatch = {epoch:_localPreparationEpoch,token:_loadingProgressToken,
        files:assignments.map(({slot,file}) => ({slot,file,prepared:!!preparedFiles?.has(file)})),issues:new Set()};
}
function _localPreparationClear() {
    _localPreparationAction?.controller.abort();
    ++_localPreparationEpoch; _localPreparationBatch = null; _localPreparationAction = null;
    _releaseLocalPreparationRecovery(); _localPreparationNotices = [];
    _localPreparationDialogOwner = null; _localPreparationOpener = null;
    _localPreparationMessage = '';
    const dialog = document.getElementById('localPreparationDialog');
    if (dialog?.open) dialog.close();
}
function _localPreparationIssue(slot, token) {
    const batch = _localPreparationBatch;
    const item = batch?.files.find(item => item.slot === slot);
    if (_managedReviewActive() || !item || token !== batch.token || token !== _loadingProgressToken ||
        !/^(video|audio)\//.test(item.file.type)) return false;
    const first = !batch.issues.has(slot); batch.issues.add(slot);
    const actionable = batch.files.some(entry => batch.issues.has(entry.slot) && !entry.prepared);
    if (item.prepared && !actionable) _localPreparationMessage = 'This review copy could not provide all audio tools. Keep the original; another conversion is not started automatically.';
    _renderLocalPreparation();
    if (first) showLoadToast('Some tools are unavailable for ' + item.file.name + '. Use Preparation to see your options.', false, 6000);
    return true;
}
function _showLocalPreparation(opener = null) {
    if (_managedReviewActive()) return;
    const dialog = document.getElementById('localPreparationDialog');
    if (!dialog) return;
    _renderLocalPreparation();
    if (!dialog.open) {
        _localPreparationOpener = opener || document.activeElement;
        _localPreparationDialogOwner = {};
        _showAppDialog(dialog);
    }
}
function _closeLocalPreparation() {
    document.getElementById('localPreparationDialog')?.close();
    _localPreparationClosed();
}
function _localPreparationClosed() {
    if (document.getElementById('localPreparationDialog').open || !_localPreparationDialogOwner) return;
    _localPreparationDialogOwner = null;
    _mediaPreparationProviders.cancel('local-companion');
    _localPreparationAction?.controller.abort();
    if (_localPreparationAction) _localPreparationMessage = 'Cancelling preparation. Your originals are unchanged.';
    if (_localPreparationOpener?.isConnected) _localPreparationOpener.focus({preventScroll:true});
    _localPreparationOpener = null;
}
function _renderLocalPreparation() {
    const dialog = document.getElementById('localPreparationDialog');
    if (!dialog) return;
    if (_localPreparationRecovery && _localPreparationRecovery.token !== _loadingProgressToken) _releaseLocalPreparationRecovery();
    const connection = _localPreparationConnection.state(), batch = _localPreparationBatch;
    const items = batch?.files.filter(item => batch.issues.has(item.slot)) || [];
    const actionable = items.filter(item => !item.prepared);
    const list = document.getElementById('localPreparationFiles'); list.replaceChildren();
    for (const item of items) { const li = document.createElement('li'); li.textContent = item.file.name; list.append(li); }
    document.getElementById('localPreparationSetup').hidden = connection.connected;
    document.getElementById('localPreparationDisconnect').hidden = !connection.connected;
    document.getElementById('localPreparationRestore').hidden = !_localPreparationRecovery ||
        _localPreparationRecovery.token !== _loadingProgressToken;
    document.getElementById('localPreparationConnect').disabled = connection.connecting;
    document.getElementById('localPreparationManual').disabled = Object.keys(_ffmpegCommands).length === 0;
    document.getElementById('localPreparationRun').disabled = !connection.connected || connection.busy ||
        !!_localPreparationAction || !actionable.length;
    const preparedOnly = 'This review copy could not provide all audio tools. Keep the original; another conversion is not started automatically.';
    document.getElementById('localPreparationStatus').textContent = _localPreparationMessage || (connection.connecting
        ? 'Approve the connection in the local tool window. No files are sent while connecting.'
        : connection.connected ? actionable.length ? 'Ready to prepare the files listed above.'
        : items.length ? preparedOnly : 'Connected. Load your files normally; preparation is offered only when needed.'
        : items.length && !actionable.length ? preparedOnly
        : 'Connect the local preparation tool once for this visit. Your current comparison stays in place.');
    const button = document.getElementById('preparationBtn');
    if (button) {button.hidden = _managedReviewActive();
        button.textContent = actionable.length ? 'Preparation needed' : items.length ? 'Preparation' : connection.connected ? 'Preparation ✓' : 'Preparation';}
}
async function _connectLocalPreparation() {
    _localPreparationMessage = '';
    try { await _localPreparationConnection.connect(document.getElementById('localPreparationAddress').value.trim()); }
    catch (error) {_localPreparationMessage = error.message;}
    _renderLocalPreparation();
}
async function _runLocalPreparation() {
    const batch = _localPreparationBatch;
    if (!batch || _localPreparationAction || _localPreparationConnection.state().busy || _managedReviewActive()) return;
    const candidates = batch.files.filter(item => batch.issues.has(item.slot) && !item.prepared);
    if (!candidates.length) return;
    const owner = {epoch:batch.epoch,controller:new AbortController()}; _localPreparationAction = owner;
    _localPreparationNotices = [];
    _localPreparationMessage = 'Preparing review copies on this computer… You can cancel without replacing your files.';
    _renderLocalPreparation();
    const files = batch.files.map(item => item.file), preparedFiles = new Set();
    try {
        for (const item of candidates) {
            if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
            const request = WarpMediaPreparation.createReviewRequest({id:crypto.randomUUID(),filename:item.file.name,mediaType:item.file.type.split('/')[0]});
            const result = await _mediaPreparationProviders.prepare('local-companion',request,item.file);
            if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
            const file = result.files[0];
            if (file.type.split('/')[0] !== item.file.type.split('/')[0]) throw new Error('The prepared file changed media kind.');
            files[batch.files.indexOf(item)] = file; preparedFiles.add(file);
        }
        if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
        await _loadLocalPreparedComparison(files,preparedFiles,owner,batch);
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (_localPreparationAction === owner && batch === _localPreparationBatch) {
            _localPreparationMessage = error.message + ' Your comparison and originals are unchanged. You can retry.';
            _showLocalPreparation();
        }
    } finally {
        if (_localPreparationAction === owner) _localPreparationAction = null;
        _renderLocalPreparation();
    }
}
function _validateLocalPreparedFile(file, signal) {
    return new Promise((resolve,reject) => {
        const video = file.type.startsWith('video/');
        const probe = document.createElement(video ? 'video' : 'audio');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', {willReadFrequently:true});
        let done = false, poll = null, wake = null, seeks = 0;
        const events = [];
        const note = name => { if (events.length < 12) events.push(name); };
        const diagnose = () => {
            let code = '';
            try { if (probe.error) code = ' mediaError=' + probe.error.code; } catch (_) {}
            const time = Number.isFinite(probe.currentTime) ? probe.currentTime.toFixed(3) : String(probe.currentTime);
            return ' (readyState ' + probe.readyState + ', networkState ' + probe.networkState +
                ', time ' + time + ', size ' + probe.videoWidth + 'x' + probe.videoHeight +
                ', seeks ' + seeks + ', events ' + (events.join(' ') || 'none') + code + ')';
        };
        const src = URL.createObjectURL(file);
        const finish = error => {
            if (done) return; done = true; clearTimeout(timer); clearTimeout(poll); clearTimeout(wake);
            signal.removeEventListener('abort',cancel);
            probe.pause(); probe.removeAttribute('src'); probe.load(); probe.remove();
            URL.revokeObjectURL(src); canvas.width = canvas.height = 0;
            if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new DOMException('Preparation cancelled','AbortError'));
        const timer = setTimeout(() => finish(new Error('The prepared file did not become playable. Retry or keep your current comparison.' + diagnose())),30000);
        const fail = () => finish(new Error((video ? 'Could not decode the prepared picture.' : 'Could not decode the prepared audio.') + diagnose()));
        const frameReady = () => probe.readyState >= 2 && Number.isFinite(probe.duration) && probe.duration > 0 &&
            (!video || probe.videoWidth && probe.videoHeight && _hostVideoFrameAvailable(probe, context));
        const settle = () => {
            if (done) return;
            clearTimeout(poll);
            if (frameReady()) finish();
            else poll = setTimeout(settle, 50);
        };
        // WebKit does not reach loadeddata on a paused hidden video until a
        // seek, so the seek starts at loadedmetadata. Hosted WebKit seeked to
        // both 40 ms and 100 ms on the FFV1 review and stayed at readyState 1
        // with the network idle, so the one retry returns to the first sample.
        // A drawn frame is enough; seeked is not required. The parenthetical
        // is for the hosted failure log.
        const seekTo = target => {
            if (done) return;
            seeks += 1; note('seek' + target.toFixed(3));
            if (Math.abs(probe.currentTime - target) >= 0.001) {
                try { probe.currentTime = target; }
                catch (_) { fail(); return; }
            }
            settle();
        };
        probe.muted = true; probe.preload = 'auto'; probe.playsInline = true;
        probe.tabIndex = -1; probe.setAttribute('aria-hidden','true');
        probe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
        for (const name of ['loadedmetadata','loadeddata','canplay','seeking','seeked','stalled','waiting','suspend','error'])
            probe.addEventListener(name, () => note(name));
        probe.addEventListener('error', () => finish(new Error('Could not open the prepared file in this browser.' + diagnose())), {once:true});
        probe.addEventListener('loadedmetadata', () => {
            if (!Number.isFinite(probe.duration) || probe.duration <= 0) { fail(); return; }
            seekTo(probe.duration > 0.08 ? Math.min(0.04, probe.duration / 2) : 0);
            if (done) return;
            wake = setTimeout(() => {
                if (done || probe.readyState >= 2) return;
                if (!Number.isFinite(probe.duration) || probe.duration <= 0) { fail(); return; }
                const again = Math.abs(probe.currentTime) < 0.001 ? Math.min(0.04, probe.duration / 2) : 0;
                seekTo(again);
            }, 300);
        }, {once:true});
        probe.addEventListener('loadeddata', settle);
        probe.addEventListener('seeked', settle);
        signal.addEventListener('abort', cancel, {once:true});
        if (signal.aborted) { cancel(); return; }
        probe.src = src; document.body.appendChild(probe);
        probe.load();
    });
}
async function _loadLocalPreparedComparison(files, preparedFiles, owner, batch) {
    if (_managedReviewActive()) throw new Error('The review host owns this comparison');
    // Verify returned copies before any clear; unrelated companions and optional
    // analysis use ordinary local loading, without a host READY deadline.
    for (const file of preparedFiles) await _validateLocalPreparedFile(file,owner.controller.signal);
    if (_localPreparationAction !== owner || batch !== _localPreparationBatch || owner.controller.signal.aborted) {
        throw new DOMException('Superseded','AbortError');
    }
    const previous = batch.files.map(item => item.file);
    const previousPrepared = new Set(batch.files.filter(item => item.prepared).map(item => item.file));
    // clearAllMedia resets the module list. Keep this copy for the toast.
    const notices = _localPreparationNotices.filter(notice => _LOCAL_COLOR_NOTICES.has(notice));
    _localPreparationAction = null;
    try {
        if (!handleMultipleFiles(files,{preserveOrder:true,preparedFiles})) throw new Error('The prepared files were rejected');
        _localPreparationRecovery = {files:previous,preparedFiles:previousPrepared,token:_loadingProgressToken,announced:false,notices};
    } catch (error) {
        if (_localPreparationBatch === batch) _localPreparationAction = owner; // rejected before clear
        else if (!_managedReviewActive()) {
            handleMultipleFiles(previous,{preserveOrder:true,preparedFiles:previousPrepared});
            _localPreparationMessage = 'Could not replace the comparison. The previous files were reopened. Your originals are unchanged.';
            _showLocalPreparation();
        }
        throw error;
    }
}
function _localPreparationActivated() {
    const recovery = _localPreparationRecovery;
    if (!recovery || recovery.token !== _loadingProgressToken) {
        if (recovery) _releaseLocalPreparationRecovery();
        return;
    }
    if (recovery.announced) return;
    recovery.announced = true;
    const note = [...new Set(recovery.notices || [])].filter(notice => _LOCAL_COLOR_NOTICES.has(notice)).join(' ');
    showLoadToast('Opened the prepared review copy. '+(note ? note+'. ' : '')+'Analysis uses this copy. Preparation can reopen the previous comparison.',false,6000);
}
function _restoreLocalPreparationComparison() {
    const recovery = _localPreparationRecovery;
    if (!recovery || recovery.token !== _loadingProgressToken || _managedReviewActive()) return;
    handleMultipleFiles(recovery.files,{preserveOrder:true,preparedFiles:recovery.preparedFiles});
    document.getElementById('loadBtn').focus({preventScroll:true});
}
function _setupLocalPreparation() {
    _mediaPreparationProviders.register({id:'local-companion',version:1,mode:'files',
        supports:request => request.recipe === 'local-review-copy-v1',
        async prepare(request,{input,signal}) {
            const prepared = await _localPreparationConnection.prepare(input,request.source.mediaType,signal);
            if (_LOCAL_COLOR_NOTICES.has(prepared.notice)) _localPreparationNotices.push(prepared.notice);
            return {kind:'files',files:[prepared.file]};
        }});
    document.getElementById('preparationBtn').addEventListener('click',event => _showLocalPreparation(event.currentTarget));
    document.getElementById('localPreparationConnect').addEventListener('click',_connectLocalPreparation);
    document.getElementById('localPreparationDisconnect').addEventListener('click',() => {_localPreparationConnection.disconnect();_renderLocalPreparation();});
    document.getElementById('localPreparationRun').addEventListener('click',_runLocalPreparation);
    document.getElementById('localPreparationManual').addEventListener('click',() => {
        _closeLocalPreparation();_setFfmpegPanelOpen(true,document.getElementById('preparationBtn'));
    });
    document.getElementById('localPreparationClose').addEventListener('click',_closeLocalPreparation);
    document.getElementById('localPreparationRestore').addEventListener('click',_restoreLocalPreparationComparison);
    document.getElementById('localPreparationDialog').addEventListener('close',_localPreparationClosed);
    document.getElementById('localPreparationDialog').addEventListener('cancel',event => {event.preventDefault();_closeLocalPreparation();});
    document.getElementById('localPreparationDialog').addEventListener('keydown',event => {
        if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
        const dialog = event.currentTarget;
        const controls = [...dialog.querySelectorAll('a[href], summary, input:not(:disabled), button:not(:disabled)')].filter(control => {
            if (control.tabIndex < 0 || !control.getClientRects().length) return false;
            for (let parent = control.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
                if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(control)) return false;
            }
            return true;
        });
        if (!controls.length) return;
        const current = controls.indexOf(document.activeElement);
        const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
            : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault(); controls[next].focus();
    });
    const field = document.getElementById('localPreparationAddress');
    if (location.hostname === '127.0.0.1' && location.protocol === 'http:') field.value = location.origin;
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('preparation')) {
        try { field.value = WarpPreparationConnection.address(params.get('preparation')); _showLocalPreparation(); } catch (_) {}
        const rest = location.hash.slice(1).split('&').filter(part => !new URLSearchParams(part).has('preparation')).join('&');
        history.replaceState(history.state,'',location.pathname+location.search+(rest ? '#'+rest : ''));
    }
    _renderLocalPreparation();
}
document.addEventListener('DOMContentLoaded',_setupLocalPreparation,{once:true});
