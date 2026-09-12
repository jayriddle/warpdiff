// Explicit host capability; iframe topology alone never selects a product policy.
function _managedReviewActive() { return _hostCapabilities.managedReview === true; }

const _managedReviewChrome = { placements: [], disclosures: [] };
function _applyManagedReviewChrome() {
    const active = _managedReviewActive();
    document.body.classList.toggle('managed-review', active);
    document.body.classList.remove('managed-media-details');
    // Restore before applying so consecutive loads never duplicate controls or listeners.
    for (const { element, marker } of _managedReviewChrome.placements) marker.replaceWith(element);
    _managedReviewChrome.placements = [];
    for (const el of _managedReviewChrome.disclosures) el.remove();
    _managedReviewChrome.disclosures = [];
    for (const [id, label] of [['gridIconBtn', active ? 'Side by side' : 'Grid'], ['stackIconBtn', active ? 'Single candidate' : 'Stack']]) {
        const button = document.getElementById(id);
        button.title = label;
        button.setAttribute('aria-label', label);
    }
    if (!active) return;
    for (const id of ['quickStartPopup', 'quickStartBackdrop', 'changelogPopup', 'changelogBackdrop']) document.getElementById(id).classList.remove('show');
    for (const id of ['shortcutsPanel', 'shortcutsBackdrop', 'manualPanel', 'manualBackdrop']) document.getElementById(id).classList.remove('open');
    const header = document.getElementById('headerRight');
    const makeOptions = (id, title, controls) => {
        const details = document.createElement('details');
        details.id = id; details.className = 'managed-options';
        const summary = document.createElement('summary'); summary.textContent = title;
        const content = document.createElement('div'); content.className = 'managed-options-content';
        details.append(summary, content);
        for (const controlId of controls) {
            const element = document.getElementById(controlId);
            const marker = document.createComment('managed review control position');
            element.replaceWith(marker); content.appendChild(element);
            _managedReviewChrome.placements.push({ element, marker });
        }
        header.appendChild(details); _managedReviewChrome.disclosures.push(details);
        details.addEventListener('keydown', event => {
            if (event.key === 'Escape') { details.open = false; summary.focus(); event.stopPropagation(); }
        });
        return details;
    };
    makeOptions('managedViewOptions', 'View options', ['gridSubOptions', 'stackSubOptions']);
    makeOptions('managedInspectionTools', 'Inspection tools', ['wipeToggleBtn', 'tileCheckToggleBtn', 'waveformToggleBtn', 'scopesToggleBtn']);
    for (const [id, label] of [['wipeToggleBtn','Image wipe'], ['tileCheckToggleBtn','Tile check'], ['waveformToggleBtn','Waveform'], ['scopesToggleBtn','Video scopes']]) {
        const button = document.getElementById(id);
        if (!button.querySelector('.managed-tool-label')) {
            const span = document.createElement('span'); span.className = 'managed-tool-label'; span.textContent = label;
            button.appendChild(span);
        }
    }
    const tools = document.querySelector('#managedInspectionTools .managed-options-content');
    for (const [id, label] of [['diffMode', 'Difference'], ['bwMode', 'Grayscale']]) {
        const button = document.createElement('button'); button.className = 'mode-sub-btn'; button.textContent = label; button.id = 'managed-' + id; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            const action = _hotkeyActions.find(item => item.id === id);
            if (_managedReviewActive() && action) action.fn();
            button.blur();
        });
        tools.appendChild(button);
    }
    const details = document.createElement('button');
    details.id = 'managedMediaDetails'; details.className = 'mode-sub-btn'; details.textContent = 'Media details';
    details.setAttribute('aria-pressed', 'false');
    details.addEventListener('click', () => {
        if (!details.isConnected || !_managedReviewActive()) return;
        const shown = document.body.classList.toggle('managed-media-details');
        details.setAttribute('aria-pressed', String(shown));
    });
    document.querySelector('#managedViewOptions .managed-options-content').appendChild(details);
}
