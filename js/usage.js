// Opt-in GoatCounter adapter. The hosted destination is used only on the official site after consent.
// Contract: https://www.goatcounter.com/help/pixel; ns is count.js's no_session field.
// Keep the destination in source, never accept a remote endpoint from a URL or message.
const _USAGE_ENDPOINT = 'https://warpdiff.goatcounter.com/count';
const _USAGE_HOST = 'jayriddle.github.io';
// Account settings verified in docs/usage-account.md; publication is separate.
const _USAGE_ACCOUNT_VERIFIED = true;
// Scope 4: scope-3 counts plus a coarse working-space group per ready review, as
// described in docs/usage-consent.md. Independent of APP_VERSION: change only
// when the accepted collection scope changes, and preserve each scope's record.
const _USAGE_CONSENT_VERSION = 4;

var _usage = (() => {
    // This check protects new adapters under older/mismatched HTML. The HTML's
    // integrity attribute protects the other direction, including old adapters
    // that predate this check. Keep the document's harmless fallback if blocked.
    if (typeof _USAGE_DOCUMENT_CONTRACT === 'undefined' || _USAGE_DOCUMENT_CONTRACT !== '3.18.12/scope-4') {
        return typeof _usage === 'object' ? _usage : Object.freeze({
            setup() {}, beginLoad() {}, comparisonReady() {}, feature() {}, scrub() {},
            startOperation() { return null; }, outcome() {}, slotState() {},
            resetComparison() {}, enterStandalone() {}, hostLaunch() {}, epoch: 0
        });
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const testMode = local && new URLSearchParams(location.search).get('usageTest') === '1';
    const endpoint = testMode ? new URL('__goatcounter_test__/count', location.href).href.split('?')[0]
        : location.hostname === _USAGE_HOST && /^https:\/\/[a-z0-9-]+\.goatcounter\.com\/count$/.test(_USAGE_ENDPOINT)
            ? _USAGE_ENDPOINT : '';
    const key = testMode ? 'usageConsentTest' : 'usageConsent';
    const invitationKey = testMode ? 'usageInvitationDismissedTest' : 'usageInvitationDismissed';
    let invitationDismissed = false;
    let consent = null, needsReview = false, epoch = 0, seenEpoch = -1, visitSent = false;
    let initialized = false, localRefusal = false, persistenceWarning = '';
    let decisionGeneration = 0, standalone = false, hostOwned = false;
    let load = null, review = null;
    // These sets are the complete vocabulary, never values derived from media.
    const features = new Set(['stack', 'grid', 'scopes', 'audio-viz', 'difference', 'wipe',
        'loupe', 'tile-check', 'loop', 'solo', 'listening-full', 'listening-dialogue', 'listening-center']);
    const operations = new Set(['analysis', 'preview', 'continuous']);
    const outcomes = new Set(['analysis-failed', 'analysis-fallback', 'preview-unavailable',
        'preview-reduced', 'continuous-fallback']);
    const pending = new Set();
    const totals = { visits: 0, comparisons: 0, events: 0, failures: 0 };

    function restoreConsent() {
        // A failed withdrawal write must never resurrect a readable older Yes
        // in this document, including after unrelated storage notifications.
        if (localRefusal) { consent = 'no'; needsReview = false; return; }
        consent = null; needsReview = false;
        let saved;
        try {
            invitationDismissed = _prefs.load(invitationKey, false) === true;
            saved = _prefs.load(key, null);
        } catch (_) { return; }
        // Refusals survive scope changes and old builds; never turn a No into a prompt.
        if (saved === 'no' || saved?.choice === 'no') { consent = 'no'; return; }
        if (saved === 'yes' || saved?.choice === 'yes') {
            const dated = typeof saved.decidedAt === 'string' && Number.isFinite(Date.parse(saved.decidedAt));
            if (saved.version === _USAGE_CONSENT_VERSION && dated) consent = 'yes';
            else needsReview = true; // Unknown, legacy or incomplete Yes must fail closed.
        }
    }

    function available() { return !!endpoint && (testMode || _USAGE_ACCOUNT_VERIFIED) && window.top === window.self && !hostOwned && !_managedReviewActive(); }
    function allowed() {
        return available() && standalone && consent === 'yes' && navigator.onLine && !document.prerendering &&
            (testMode || !navigator.webdriver);
    }
    function abortPending() {
        // Invalidate tickets too: off → on must not revive an old review/job.
        load = null; review = null;
        decisionGeneration++;
        pending.forEach(controller => controller.abort());
        pending.clear();
    }
    function send(path, event = false, every = false) {
        if (!allowed() || pending.size >= 64) return false;
        // An allowlist of constant labels only: no filename, URL, title, media bytes,
        // browser storage ID, exact dimensions, campaign or referrer data.
        const match = /^(.*)-(image|video|audio|mixed)-([1234])$/.exec(path);
        const label = match && match[1];
        if (!['/', 'comparison-active'].includes(path) && !(match && (
            ['comparison', 'load-attempt', 'load-failed'].includes(label) ||
            (label.startsWith('feature-') && features.has(label.slice(8))) ||
            (label.endsWith('-attempt') && operations.has(label.slice(0, -8))) || outcomes.has(label) ||
            /^scrub-(timeline|waveform|spectrogram|threshold-(1|2|6|21))$/.test(label) ||
            /^workspace-(narrow|medium|wide)-(short|tall)$/.test(label)))) return false;
        const url = new URL(endpoint);
        // Release belongs in the event path: GoatCounter page titles alone do
        // not provide a reliable historical breakdown between app releases.
        url.search = new URLSearchParams({ p: event ? `v${APP_VERSION}/${path}` : path, t: event ? 'WarpDiff ' + APP_VERSION : 'WarpDiff',
            e: event ? 'true' : 'false', r: '', rnd: String(Math.random()) }).toString();
        if (every) url.searchParams.set('ns', 'true');
        const controller = new AbortController();
        pending.add(controller);
        if (event) totals.events++;
        const timeout = setTimeout(() => controller.abort(), 3000);
        fetch(url, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer',
            cache: 'no-store', signal: controller.signal }).then(response => {
            // Opaque production responses cannot confirm server acceptance.
            if (testMode && !response.ok) throw new Error('Local collector unavailable');
        }).catch(() => {
            if (consent === 'yes') { totals.failures++; render(); }
        }).finally(() => { clearTimeout(timeout); pending.delete(controller); });
        return true;
    }
    function visit() {
        if (!visitSent && document.visibilityState === 'visible' && send('/')) {
            visitSent = true;
            totals.visits++;
        }
        render();
    }
    function render() {
        if (!initialized) return;
        const enabled = available();
        const status = document.getElementById('usageStatus');
        status.textContent = !enabled ? 'Usage sharing is unavailable. No usage data is sent.'
            : persistenceWarning ? persistenceWarning
            : consent === 'yes' ? 'Sharing is on for files you load here. You can turn it off anytime.'
            : consent === 'no' ? 'Sharing is off. Your choice is remembered in this browser.'
            : needsReview ? 'Please review the current usage-sharing details. Nothing is reported until you agree.'
            : invitationDismissed ? 'Sharing is off. You can enable it here anytime.'
            : 'Your choice. Nothing is reported until you agree.';
        document.querySelectorAll('[data-usage-choice]').forEach(button => {
            button.disabled = !enabled;
            button.setAttribute('aria-pressed', String(button.dataset.usageChoice === consent));
        });
        document.getElementById('usageInvitation').hidden = !enabled || consent !== null || invitationDismissed;
        document.getElementById('usageInvitationTitle').textContent = needsReview ? 'Review usage sharing' : 'Help shape WarpDiff';
        document.getElementById('usageConsentReview').hidden = !needsReview;
        document.getElementById('usageTestNotice').hidden = !testMode;
        document.getElementById('usageInvitationTest').hidden = !testMode;
        document.querySelector('#appearancePanel [data-usage-choice="no"]').textContent = consent === 'yes' ? 'Turn sharing off' : 'Keep sharing off';
        document.getElementById('usageTestStats').hidden = !testMode;
        document.getElementById('usageTestStats').textContent =
            `Local requests this page: ${totals.visits} visit · ${totals.comparisons} ready reviews · ${totals.events} events · ${totals.failures} failed requests`;
    }
    function choose(value) {
        if (!available() || !['yes', 'no'].includes(value)) return;
        abortPending();
        consent = value;
        localRefusal = value === 'no';
        persistenceWarning = '';
        needsReview = false;
        invitationDismissed = false;
        try {
            _prefs.save(key, { choice: value, version: _USAGE_CONSENT_VERSION, decidedAt: new Date().toISOString() });
            localRefusal = false;
        } catch (_) {
            if (value === 'no') {
                try {
                    localStorage.removeItem('pref_' + key);
                    persistenceWarning = 'Sharing is off. The old permission was removed, but this browser could not save No. You may be asked again next time.';
                } catch (_) {
                    persistenceWarning = 'Sharing is off for this page, but this browser could not remove the previous permission. Clear WarpDiff’s site data before opening it again to prevent the old Yes from returning.';
                }
            } else {
                persistenceWarning = 'Sharing is on for this page only. This browser could not save your choice.';
            }
        }
        try { _prefs.save(invitationKey, false); } catch (_) { /* Presentation only. */ }
        if (value === 'yes') enterStandalone();
        render();
    }
    function enterStandalone() {
        if (!available()) return;
        // No timer guesses launch identity. Only an explicit Yes or an accepted
        // manual file load establishes a standalone document. Host loads cannot.
        standalone = true;
        visit();
    }
    function setup() {
        restoreConsent();
        initialized = true;
        document.querySelectorAll('[data-usage-choice]').forEach(button => {
            button.addEventListener('click', () => {
                const fromInvitation = !!button.closest('#usageInvitation');
                choose(button.dataset.usageChoice);
                if (fromInvitation) document.getElementById('appearanceButton').focus();
            });
        });
        window.addEventListener('storage', event => {
            if (event.key !== 'pref_' + key && event.key !== 'pref_' + invitationKey && event.key !== null) return;
            // Every delivered consent mutation is a boundary, regardless of its
            // value. Never coalesce No → Yes by reading only the final saved Yes.
            // This also covers removal, corrupt/old scopes and storage.clear().
            if (event.key === 'pref_' + key || event.key === null) abortPending();
            restoreConsent();
            if (consent !== 'yes') abortPending();
            else visit();
            render();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') visit();
        });
        window.addEventListener('pagehide', abortPending);
        window.addEventListener('offline', abortPending);
        visit();
    }
    function once(context, label) {
        if (!context || context !== load || context.epoch !== epoch || context.decisionGeneration !== decisionGeneration || context.seen.has(label)) return false;
        context.seen.add(label); // Dropped/offline events are never replayed.
        const sent = send(`${label}-${context.type}-${context.count}`, true, true);
        if (sent) context.sent.add(label);
        render();
        return sent;
    }
    function beginLoad(type, count) {
        review = null; load = null;
        if (!['image', 'video', 'audio', 'mixed'].includes(type) || ![1,2,3,4].includes(count)) return;
        // Continuing into a review quietly dismisses the invitation. This is
        // presentation state only: neither a Yes nor a No, and never reported.
        if (available() && consent === null && !invitationDismissed) {
            invitationDismissed = true;
            try { _prefs.save(invitationKey, true); } catch (_) { /* Keep it quiet for this page. */ }
            render();
        }
        const context = { epoch, decisionGeneration, type, count, seen: new Set(), sent: new Set(), readySlots: new Set(), scrubs: 0 };
        if (send(`load-attempt-${type}-${count}`, true, true)) load = context;
    }
    function startOperation(kind) {
        if (!operations.has(kind) || !load || !allowed()) return null;
        const label = kind + '-attempt';
        // A denominator is per load containing at least one attempt, not per file.
        if (!load.sent.has(label) && !once(load, label)) return null;
        return { context: load, kind };
    }
    function outcome(ticket, value) {
        if (!ticket || !outcomes.has(value) || !value.startsWith(ticket.kind + '-')) return;
        once(ticket.context, value);
    }
    function feature(name) {
        if (features.has(name)) once(review, 'feature-' + name);
    }
    function scrub(surface) {
        if (!review || review !== load || !allowed() || !['timeline', 'waveform', 'spectrogram'].includes(surface)) return;
        once(review, 'scrub-' + surface);
        if ([1,2,6,21].includes(++review.scrubs)) once(review, 'scrub-threshold-' + review.scrubs);
    }
    function workingSpaceLabel() {
        // Read only after consent/readiness. CSS layout pixels describe the room
        // inside this window, including side-by-side use; no screen properties,
        // exact measurements, resize history or adjacent-window data are sent.
        const width = window.innerWidth, height = window.innerHeight;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        const widthGroup = width < 760 ? 'narrow' : width < 1200 ? 'medium' : 'wide';
        return `workspace-${widthGroup}-${height < 600 ? 'short' : 'tall'}`;
    }
    function comparisonReady(generation, types) {
        if (generation !== epoch || seenEpoch === epoch) return;
        // The UI can activate while another image/audio slot is still decoding.
        // Require both the activation boundary and all assigned slots' readiness.
        if (load && load.readySlots.size < load.count) { load.readyTypes = types; return; }
        seenEpoch = epoch; // Never replay a comparison completed before consent/offline.
        if (types.length < 1 || types.length > 4 || types.some(type => !['image', 'video', 'audio'].includes(type))) return;
        const type = types.every(value => value === types[0]) ? types[0] : 'mixed';
        if (!load || load.failed || load.type !== type || load.count !== types.length) return;
        if (once(load, 'comparison')) {
            review = load;
            totals.comparisons++;
            send('comparison-active', true); // Session-deduplicated participation estimate.
            if (allowed()) {
                const space = workingSpaceLabel();
                if (space) once(review, space); // One sample at readiness; never track resize.
            }
            render();
        }
    }
    return { setup, beginLoad, comparisonReady, feature, scrub, startOperation, outcome, enterStandalone,
        hostLaunch() { hostOwned = true; standalone = false; abortPending(); render(); },
        slotState(slot, kind) {
            if (!load || !['original', 'editA', 'editB', 'editC'].includes(slot)) return;
            if (kind === 'error') { load.failed = true; review = null; once(load, 'load-failed'); }
            if (kind === 'ready') {
                load.readySlots.add(slot);
                if (load.readyTypes) comparisonReady(epoch, load.readyTypes);
            }
        },
        resetComparison() { epoch++; abortPending(); }, get epoch() { return epoch; } };
})();
