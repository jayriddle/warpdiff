// Normal-app preparation owner. Files are retained only for the current manual
// comparison. The separately connected tool never owns admission or transport.
let _localPreparationBatch = null;
let _localPreparationEpoch = 0;
let _localPreparationAction = null;
let _localPreparationOpener = null;
let _localPreparationMessage = '';
const _localPreparationConnection = WarpPreparationConnection.create(() => _renderLocalPreparation());

function _normalizePreparationInput(file) {
    if (/^(image|video|audio)\//.test(file.type)) return file;
    const ext = file.name.split('.').pop().toLowerCase();
    const types = {mkv:'video/x-matroska',mov:'video/quicktime',mxf:'video/mxf',avi:'video/x-msvideo',
        mts:'video/mp2t',m2ts:'video/mp2t',ts:'video/mp2t',dts:'audio/vnd.dts',ac3:'audio/ac3',
        eac3:'audio/eac3',mlp:'audio/mlp',truehd:'audio/true-hd'};
    return types[ext] ? new File([file],file.name,{type:types[ext],lastModified:file.lastModified}) : file;
}
function _localPreparationAccept(assignments, preparedFiles = null) {
    if (_managedReviewActive()) return;
    _localPreparationBatch = {epoch:_localPreparationEpoch,token:_loadingProgressToken,
        files:assignments.map(({slot,file}) => ({slot,file,prepared:!!preparedFiles?.has(file)})),issues:new Set()};
}
function _localPreparationClear() {
    ++_localPreparationEpoch; _localPreparationBatch = null; _localPreparationAction = null;
    _localPreparationMessage = '';
    const dialog = document.getElementById('localPreparationDialog');
    if (dialog?.open) dialog.close();
}
function _localPreparationIssue(slot, token) {
    const batch = _localPreparationBatch;
    const item = batch?.files.find(item => item.slot === slot);
    if (_managedReviewActive() || !item || token !== batch.token || token !== _loadingProgressToken ||
        !/^(video|audio)\//.test(item.file.type)) return false;
    batch.issues.add(slot);
    if (item.prepared) _localPreparationMessage = 'This review copy could not provide all audio tools. Keep the original; another conversion is not started automatically.';
    _showLocalPreparation(); return true;
}
function _showLocalPreparation(opener = null) {
    if (_managedReviewActive()) return;
    const dialog = document.getElementById('localPreparationDialog');
    if (!dialog) return;
    _renderLocalPreparation();
    if (!dialog.open) { _localPreparationOpener = opener || document.activeElement; dialog.showModal(); }
}
function _closeLocalPreparation() {
    _mediaPreparationProviders.cancel();
    if (_localPreparationAction) _localPreparationMessage = 'Cancelling preparation. Your originals are unchanged.';
    document.getElementById('localPreparationDialog')?.close();
    if (_localPreparationOpener?.isConnected) _localPreparationOpener.focus({preventScroll:true});
    _localPreparationOpener = null;
}
function _renderLocalPreparation() {
    const dialog = document.getElementById('localPreparationDialog');
    if (!dialog) return;
    const connection = _localPreparationConnection.state(), batch = _localPreparationBatch;
    const items = batch?.files.filter(item => batch.issues.has(item.slot)) || [];
    const list = document.getElementById('localPreparationFiles'); list.replaceChildren();
    for (const item of items) { const li = document.createElement('li'); li.textContent = item.file.name; list.append(li); }
    document.getElementById('localPreparationSetup').hidden = connection.connected;
    document.getElementById('localPreparationDisconnect').hidden = !connection.connected;
    document.getElementById('localPreparationConnect').disabled = connection.connecting;
    document.getElementById('localPreparationManual').disabled = Object.keys(_ffmpegCommands).length === 0;
    document.getElementById('localPreparationRun').disabled = !connection.connected || connection.busy ||
        !!_localPreparationAction || !items.length || items.some(item => item.prepared);
    document.getElementById('localPreparationStatus').textContent = _localPreparationMessage || (connection.connecting
        ? 'Approve the connection in the local tool window. No files are sent while connecting.'
        : connection.connected ? items.length ? 'Ready to prepare the files listed above.' : 'Connected. Load your files normally; preparation is offered only when needed.'
        : 'Connect the local preparation tool once for this visit. Your current comparison stays in place.');
    const button = document.getElementById('preparationBtn');
    if (button) {button.hidden = _managedReviewActive();button.textContent = connection.connected ? 'Preparation ✓' : 'Preparation';}
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
    const owner = {epoch:batch.epoch}; _localPreparationAction = owner;
    _localPreparationMessage = 'Preparing review copies on this computer… You can cancel without replacing your files.';
    _renderLocalPreparation();
    const files = batch.files.map(item => item.file), preparedFiles = new Set();
    let reloadGeneration = null;
    try {
        for (const item of candidates) {
            if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
            const request = WarpMediaPreparation.createReviewRequest({id:crypto.randomUUID(),filename:item.file.name,mediaType:item.file.type.split('/')[0]});
            const result = await _mediaPreparationProviders.prepare('local-companion',request,item.file);
            if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
            const file = result.files[0]; files[batch.files.indexOf(item)] = file; preparedFiles.add(file);
        }
        if (_localPreparationAction !== owner || batch !== _localPreparationBatch) return;
        // Consume the old action before the normal loader clears its comparison.
        _localPreparationAction = null;
        const reloading = _loadLocalPreparedComparison(files,preparedFiles);
        reloadGeneration = _viewLoadGeneration;
        await reloading;
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (_localPreparationAction === owner || reloadGeneration !== null && _hostLoadIsCurrent(reloadGeneration) && _hostLoadRequest.status === 'failed') {
            _localPreparationMessage = error.message + ' Your originals are unchanged.';
            _showLocalPreparation();
        }
    } finally {
        if (_localPreparationAction === owner) _localPreparationAction = null;
        _renderLocalPreparation();
    }
}
function _loadLocalPreparedComparison(files, preparedFiles) {
    if (_managedReviewActive()) return Promise.reject(new Error('The review host owns this comparison'));
    clearAllMedia();
    _hostLoadAbortController = new AbortController();
    const request = {generation:++_hostLoadGeneration,signal:_hostLoadAbortController.signal,
        terminal:false,status:'loading',replyWindow:null,standalonePrepared:true};
    _hostLoadRequest = request;
    return new Promise((resolve,reject) => {
        const cancelled = () => {if (!request.terminal) finish(new DOMException('Superseded','AbortError'));};
        const timer = setTimeout(() => _hostLoadFailed(request,'The prepared comparison did not finish opening'),90000);
        const finish = error => {
            clearTimeout(timer); request.signal.removeEventListener('abort',cancelled);
            if (error) reject(error); else resolve();
        };
        request.localComplete = (accepted,error) => finish(accepted ? null : new Error(error || 'Could not open the prepared copy'));
        request.signal.addEventListener('abort',cancelled,{once:true});
        _usage.enterStandalone();
        try {
            if (!handleMultipleFiles(files,{alreadyCleared:true,loadGeneration:request.generation,standalonePrepared:true,preparedFiles})) {
                _hostLoadFailed(request,'The prepared files were rejected');
            }
        } catch (error) { _hostLoadFailed(request,error.message || 'Could not open the prepared files'); }
    });
}
function _setupLocalPreparation() {
    _mediaPreparationProviders.register({id:'local-companion',version:1,mode:'files',
        supports:request => request.recipe === 'local-review-copy-v1',
        async prepare(request,{input,signal}) {
            const file = await _localPreparationConnection.prepare(input,request.source.mediaType,signal);
            return {kind:'files',files:[file]};
        }});
    document.getElementById('preparationBtn').addEventListener('click',event => _showLocalPreparation(event.currentTarget));
    document.getElementById('localPreparationConnect').addEventListener('click',_connectLocalPreparation);
    document.getElementById('localPreparationDisconnect').addEventListener('click',() => {_localPreparationConnection.disconnect();_renderLocalPreparation();});
    document.getElementById('localPreparationRun').addEventListener('click',_runLocalPreparation);
    document.getElementById('localPreparationManual').addEventListener('click',() => {
        _closeLocalPreparation();_setFfmpegPanelOpen(true,document.getElementById('preparationBtn'));
    });
    document.getElementById('localPreparationClose').addEventListener('click',_closeLocalPreparation);
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
        history.replaceState(null,'',location.pathname+location.search);
    }
    _renderLocalPreparation();
}
document.addEventListener('DOMContentLoaded',_setupLocalPreparation,{once:true});
