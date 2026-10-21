// Explicit local package handoff. Inspection never clears media or authorizes READY.
let _preparedImportEpoch = 0;
let _preparedImportOperation = null;
let _preparedImportCandidate = null;
let _preparedImportOpener = null;

function _preparedImportControls() {
    const busy = !!_preparedImportOperation;
    document.getElementById('preparedImportCheck').disabled = busy ||
        !document.getElementById('preparedImportManifest').files.length ||
        !document.getElementById('preparedImportMedia').files.length;
    document.getElementById('preparedImportLoad').disabled = busy || !_preparedImportCandidate;
    document.getElementById('preparedImportStatus').setAttribute('aria-busy', String(busy));
}
function _preparedImportInvalidate() {
    _preparedImportEpoch++;
    _preparedImportOperation?.controller.abort();
    // An unsettled File/WebCrypto read retains the inspector's reservation.
    // Keep its operation until finally; a reopened dialog cannot start another.
    _preparedImportCandidate = null;
    document.getElementById('preparedImportSummary').replaceChildren();
    document.getElementById('preparedImportStatus').textContent = _preparedImportOperation
        ? 'The previous check is finishing. You can close this dialog or wait to check again.' : '';
    _preparedImportControls();
}
function _setPreparedImportOpen(open, opener = null) {
    const dialog = document.getElementById('preparedImportDialog');
    if (open) {
        if (_managedReviewActive() || dialog.open) return;
        _setFfmpegPanelOpen(false);
        _closeAppearancePanel(); // its capture-phase keyboard owner must retire before this modal opens
        _preparedImportOpener = opener || document.activeElement;
        _preparedImportInvalidate();
        _showAppDialog(dialog);
        dialog.scrollTop = 0;
        // Begin with the explanation, including the ordinary-loading exit, even
        // in a short window; focusing a file input would scroll past it.
        document.getElementById('preparedImportTitle').focus({preventScroll:true});
    } else {
        _preparedImportInvalidate();
        for (const id of ['Manifest', 'Media', 'Source', 'Others']) document.getElementById('preparedImport' + id).value = '';
        _preparedImportControls();
        const target = _preparedImportOpener;
        _preparedImportOpener = null;
        if (dialog.open) dialog.close();
        if (target?.isConnected && target.getClientRects().length) target.focus({preventScroll:true});
    }
}
function _resetPreparedImport() { _setPreparedImportOpen(false); }

function _preparedImportFiles() {
    const first = id => document.getElementById(id).files[0];
    const manifestFile = first('preparedImportManifest'), mediaFile = first('preparedImportMedia');
    const sourceFile = first('preparedImportSource');
    const others = [...document.getElementById('preparedImportOthers').files];
    if (!manifestFile || !mediaFile) throw new Error('Select the manifest and prepared MP4.');
    if (others.some(file => !file.type)) throw new Error('A companion file has no browser media type. Use Load files to open it separately, or choose an identified image or video.');
    if (others.length > 3 || others.some(file => !file.size || !/^(image|video)\//.test(file.type))) {
        throw new Error('Choose at most three nonempty images or videos as companion files.');
    }
    if (others.some(file => file.name === mediaFile.name && file.size === mediaFile.size && file.lastModified === mediaFile.lastModified)) {
        throw new Error('The prepared video is already included. Choose different companion files.');
    }
    return {manifestFile, mediaFile, sourceFile, others};
}
function _preparedImportSummary(selection, report) {
    const summary = document.getElementById('preparedImportSummary'); summary.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'Package check passed — decoding is next'; summary.append(heading);
    const list = document.createElement('dl');
    for (const [label, value] of [
        ['Prepared file', selection.mediaFile.name + ' — selected bytes match the manifest.'],
        ['Original', report.sourceBinding === 'matched' ? selection.sourceFile.name + ' — selected bytes match the manifest.' : 'Not selected; original-file binding was not checked.'],
        ['Inspected format', report.container.width + ' × ' + report.container.height + ' AVC video; stereo AAC-LC, 48 kHz.'],
        ['Declared preparation', 'Copied picture, FFmpeg default stereo downmix, no normalization. These transformation claims and source derivation are not independently verified.'],
        ['Other comparison files', selection.others.length ? selection.others.map(file => file.name).join(', ') : 'None'],
    ]) {
        const term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = label; detail.textContent = value; list.append(term, detail);
    }
    summary.append(list);
    const note = document.createElement('p');
    note.textContent = 'Analysis describes the prepared stereo copy. Keep the original for multichannel or original-source measurements. Complete decoding, frame mapping, A/V synchronization and measurement conformance are not verified by this check.';
    summary.append(note);
}
async function _checkPreparedImport() {
    if (_preparedImportOperation || !document.getElementById('preparedImportDialog').open || _managedReviewActive()) return;
    _preparedImportInvalidate();
    const status = document.getElementById('preparedImportStatus');
    let selection;
    try { selection = _preparedImportFiles(); }
    catch (error) { status.textContent = error.message; return; }
    const operation = {controller:new AbortController(), epoch:_preparedImportEpoch};
    _preparedImportOperation = operation;
    status.textContent = 'Checking selected files… Your current comparison is unchanged.';
    status.focus({preventScroll:true});
    _preparedImportControls();
    try {
        const checked = await WarpPreparedMedia.inspectSnapshot({...selection, signal:operation.controller.signal});
        if (operation.controller.signal.aborted || operation.epoch !== _preparedImportEpoch ||
                !document.getElementById('preparedImportDialog').open || _managedReviewActive()) return;
        // Inspection establishes MP4 bytes regardless of the OS's MIME guess.
        _preparedImportCandidate = {epoch:operation.epoch, files:[checked.mediaFile, ...selection.others]};
        _preparedImportSummary(selection, checked.report);
        status.textContent = 'Ready to load. Loading starts a new comparison; the normal decoder checks still apply.';
    } catch (error) {
        if (operation.epoch === _preparedImportEpoch && document.getElementById('preparedImportDialog').open) {
            status.textContent = 'Package check failed: ' + error.message + ' Your current comparison is unchanged.';
        }
    } finally {
        if (_preparedImportOperation === operation) _preparedImportOperation = null;
        if (document.getElementById('preparedImportDialog').open) {
            if (operation.epoch !== _preparedImportEpoch) status.textContent = 'Previous check cancelled. Check the selected files again.';
            _preparedImportControls();
        }
    }
}
function _loadPreparedImport() {
    const candidate = _preparedImportCandidate;
    if (!candidate || _preparedImportOperation || candidate.epoch !== _preparedImportEpoch ||
            !document.getElementById('preparedImportDialog').open || _managedReviewActive()) return;
    // handleMultipleFiles owns clear, slot ordering, decoding and activation.
    // Its clear resets this dialog; keep only the local File array for handoff.
    if (document.getElementById('quickStartPopup').classList.contains('show')) toggleQuickStart();
    let accepted = false;
    try { accepted = handleMultipleFiles(candidate.files) === true; }
    catch (error) {
        const status = document.getElementById('preparedImportStatus');
        if (document.getElementById('preparedImportDialog').open) {
            status.textContent = 'These files were not loaded. ' + (error && error.message ? error.message : 'Your current comparison is unchanged.');
        }
    }
    const dialog = document.getElementById('preparedImportDialog');
    if (dialog.open) {
        const status = document.getElementById('preparedImportStatus');
        if (!accepted && !status.textContent.startsWith('These files were not loaded.')) {
            status.textContent = 'These files were not loaded. Your current comparison is unchanged.';
        }
        status.focus({preventScroll:true});
    } else if (accepted) document.getElementById('loadBtn').focus({preventScroll:true});
}
function _loadOrdinaryMediaFromHelp() {
    if (_managedReviewActive()) return;
    _resetPreparedImport();
    if (document.getElementById('quickStartPopup').classList.contains('show')) toggleQuickStart();
    document.getElementById('loadBtn').focus({preventScroll:true});
    // Stay in the user's gesture and use the ordinary loader's existing chooser.
    document.getElementById('multiFileInput').click();
}
function _setupPreparedImportEntryPoints() {
    document.getElementById('preparedPackageBtn').addEventListener('click', event => _setPreparedImportOpen(true, event.currentTarget));
    document.getElementById('helpLoadFiles').addEventListener('click', _loadOrdinaryMediaFromHelp);
}
// Help follows the main script in the document; its controls do not exist yet.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _setupPreparedImportEntryPoints, {once:true});
else _setupPreparedImportEntryPoints();
document.getElementById('preparedImportOrdinary').addEventListener('click', _loadOrdinaryMediaFromHelp);
document.getElementById('preparedImportCancel').addEventListener('click', _resetPreparedImport);
document.getElementById('preparedImportCheck').addEventListener('click', _checkPreparedImport);
document.getElementById('preparedImportLoad').addEventListener('click', _loadPreparedImport);
for (const id of ['Manifest', 'Media', 'Source', 'Others']) document.getElementById('preparedImport' + id).addEventListener('change', _preparedImportInvalidate);
document.getElementById('preparedImportDialog').addEventListener('cancel', event => {
    // File inputs also emit bubbling cancel events when a chooser is dismissed.
    // Only cancellation of the dialog itself retires the package form.
    if (event.target !== event.currentTarget) return;
    event.preventDefault(); _resetPreparedImport();
});
document.getElementById('preparedImportDialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll('a[href], summary, input:not(:disabled), button:not(:disabled)')]
        .filter(control => {
            if (control.tabIndex < 0 || !control.getClientRects().length) return false;
            // Browsers can report rectangles for descendants of closed details
            // even though they cannot take focus. Only its summary participates.
            for (let parent = control.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
                if (parent.matches('details:not([open])') &&
                        !parent.querySelector(':scope > summary')?.contains(control)) return false;
            }
            return true;
        });
    if (!controls.length) return;
    // WebKit's platform Tab policy can skip buttons despite tabIndex === 0.
    // Cycle the dialog's controls explicitly so both directions include them.
    const current = controls.indexOf(document.activeElement);
    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault(); controls[next].focus();
});
document.getElementById('preparedImportDialog').addEventListener('close', () => {
    // Ignore an older queued close event if the dialog has already reopened.
    if (!document.getElementById('preparedImportDialog').open && _preparedImportOpener) _resetPreparedImport();
});
for (const type of ['dragover', 'drop']) document.getElementById('preparedImportDialog').addEventListener(type, event => {
    event.preventDefault(); event.stopPropagation(); // A drop in this modal must not trigger the page's ordinary loader.
});
