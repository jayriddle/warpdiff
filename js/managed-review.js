// Explicit host capability; iframe topology alone never selects a product policy.
function _managedReviewActive() { return _hostCapabilities.managedReview === true; }

function _applyManagedReviewChrome() {
    const active = _managedReviewActive();
    document.body.classList.toggle('managed-review', active);
    for (const [id, label] of [['gridIconBtn', active ? 'Compare together' : 'Grid'], ['stackIconBtn', active ? 'Single candidate' : 'Stack']]) {
        const button = document.getElementById(id);
        button.title = label;
        button.setAttribute('aria-label', label);
    }
    if (!active) return;
    for (const id of ['quickStartPopup', 'quickStartBackdrop', 'changelogPopup', 'changelogBackdrop']) document.getElementById(id).classList.remove('show');
    for (const id of ['shortcutsPanel', 'shortcutsBackdrop', 'manualPanel', 'manualBackdrop']) document.getElementById(id).classList.remove('open');
}
