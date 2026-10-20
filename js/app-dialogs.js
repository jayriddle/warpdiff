// One boundary for native modals: retire transient keyboard owners before the
// browser makes the rest of the page inert. Help stays as the cancel destination;
// successful file handoffs close it explicitly.
function _showAppDialog(dialog) {
    _closeAppearancePanel();
    _closeInfoBarOverflow(false);
    _setFfmpegPanelOpen(false);
    for (const [id, close] of [['shortcutsPanel', toggleShortcutsPanel], ['manualPanel', toggleManualPanel], ['timecopyPanel', toggleTimecopyPanel]]) {
        if (document.getElementById(id)?.classList.contains('open')) close();
    }
    _reassigningActionId = null;
    _hideTcChooser();
    const editor = document.getElementById('infoEditorDialog');
    if (editor?.open && editor !== dialog) _closeInfoBarEditor();
    if (!dialog.dataset.appKeyboard) {
        dialog.dataset.appKeyboard = 'owned';
        dialog.addEventListener('keydown',event => {
            // Existing specialized editors may already own Tab. Supply the
            // same complete keyboard cycle for the other native dialogs.
            if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
            const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')]
                .filter(element => {
                    if (element.tabIndex < 0 || !element.getClientRects().length) return false;
                    for (let parent = element.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
                        if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(element)) return false;
                    }
                    return true;
                });
            if (!controls.length) return;
            const current = controls.indexOf(document.activeElement);
            const next = current < 0 ? event.shiftKey ? controls.length-1 : 0
                : (current+(event.shiftKey ? -1 : 1)+controls.length)%controls.length;
            event.preventDefault(); controls[next].focus();
        });
    }
    if (!dialog.open) dialog.showModal();
}
