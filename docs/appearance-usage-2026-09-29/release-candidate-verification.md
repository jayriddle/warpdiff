# WarpDiff 3.18.12 — final release preparation

Prepared 2026-10-01 in the existing working tree. **This is a local release candidate, not a published release.** No commit, push, deployment or live GoatCounter count was performed. The public GitHub Pages document was checked read-only during this work and still identified itself as 3.17.5. This record covers the final preparation; earlier appearance and consent work remains in the linked records in this directory.

Follow-up: the [final adversarial review](final-adversarial-review-2026-10-01.md) found a pending-request cancellation defect at Clear and an outdated planning paragraph. Both were corrected and verified in the [Reset cancellation record](reset-cancellation-verification-2026-10-01.md), which preserves the failing-before/passing-after regression and current integrity hash. The verification results below describe preparation before that follow-up.

## Changes and decisions

The app, README and PWA cache now agree on version **3.18.12**. Analytics remains owned by the removable classic-script adapter `js/usage.js`; the default GoatCounter embed was not added. The document/adapter contract is `3.18.12/scope-4`, and the HTML pins the adapter's refreshed SHA-256 integrity hash. The verified production configuration is enabled locally, subject to the consent, launch and delivery gates.

Working-space reporting adds **one coarse category per counted ready comparison**. Width is narrow below 760 CSS pixels, medium from 760 through 1,199, or wide from 1,200 upward. Height is short below 600 CSS pixels or tall from 600 upward. These six combinations describe available browser window space, including side-by-side workflows. They are provisional layout categories, not device types or measured usability thresholds.

Only the fixed category label is sent with the existing release/media/item context and `ns=true`. The adapter reads dimensions at readiness, discards the raw values, and never adds them to storage or the request. There is no screen-resolution, exact-size, window-position, resize-history, adjacent-app, remaining-media-area or input-capability measurement. Duplicate readiness, resizing, playback and feature activation do not resample. Invalid dimensions skip the event. Existing pre-consent, offline, failed-review and host-view exclusions apply. This adds at most one dispatch to each eligible ready comparison; delivery remains best effort.

**Consent scope 4** explicitly adds broad window-size groups. All earlier Yes records pause until renewed; any saved No remains off. New consent cannot replay earlier reviews. The invitation, expandable Details, in-app Manual/Getting Started, README, FEATURES, MANUAL, consent history, event contract, measurement catalog and account record were aligned. Appearance-choice reporting remains deferred.

The provider settings were rechecked read-only in authenticated Safari. Browser/OS, country and repeat-visit/session counting remain enabled; region, referrer, built-in screen-size, language and individual-pageview collection remain disabled. Retention is configured to 365 days and dashboard access is private. Operator: Jay Riddle. Public privacy contact: warpdiff@gmail.com. No account settings changed during this final-preparation turn. Configuration does not prove execution of a deletion job or hosted acceptance.

The current What's New popup now has only three short bullets: more consistent forward/backward scrub volume; the four new appearances; and optional usage sharing, off until agreement. Detailed unpublished iterations remain in the release-note archive.

Tablet wording was added to README, FEATURES and both manuals:

> WarpDiff can run in tablet browsers, but some features depend on keyboard shortcuts, hover, or precise dragging. Touch support is currently limited; a keyboard and mouse or trackpad are recommended for more complete control.

This is guidance in documentation, not a startup warning or a claim of comprehensive tablet testing. A narrow-window probe found the comparison header overflowing at 390 pixels and clipping the privacy button. A limited media rule now wraps the header below 601 pixels and allows its tool strip to scroll, so Appearance and privacy remains reachable. The existing layout owner reads the actual resulting header height. Broader touch controls are deferred.

## Verification and meaningful failed checks

All automated reporting tests used intercepted requests or loopback collectors. None sent a production count.

| Check | Measured result |
| --- | --- |
| Initial focused consent/production suite | 59 passed, no retries, 29.3 s |
| Initial full Chromium suite, before narrow-header change | 324 passed, 1 existing skip, no retries, 2.7 min |
| Final focused suite, including narrow-header withdrawal | 60 passed, no retries, 28.6 s |
| Ownership and pure-logic harness | 444 passed, 0 failed |
| Full Chromium run after header change | 324 passed, 1 failed, 1 existing skip, no retries, 2.8 min; failure investigated below |
| Isolated original failing test | 5 repetitions passed, no retries, 7.9 s |
| Confirmation full run after readiness correction | **325 passed, 1 existing skip, no retries, 2.7 min** |
| Disposable Chromium layout probe | Eight viewport sizes; privacy panel fits and privacy button remains reachable at every size; no JavaScript errors |
| Native desktop Safari local smoke | Default silence, disclosure, explicit Yes, withdrawal and remembered No after reload verified |

New behavioral checks exercise workspace boundaries at 759/760/1,199/1,200 pixels wide and 599/600 high, plus a 960×900 side-by-side window. They assert the fixed event and payload fields, once-per-review sampling, no resize/duplicate-ready resampling, a new sample for a new review, scope-3 renewal without replay and silence after withdrawal. The production fixture expects the additional workspace label. The narrow-header test uses an actual click on the visible privacy control during a ready review, turns sharing off, and verifies another load remains silent.

The failed full-suite test checked the Solo “Loop starts after A ends” toast. The received text was the startup “Clips differ in length” notice. Its playback assertions still passed. Inspection showed that the shared load helper waits for the comparison container, which becomes visible before first-frame activation; that later activation displays the startup notice. The test could issue its loop command before this notice arrived. The original test passed five isolated repetitions. The test now waits for the expected startup notice before beginning its deliberate Solo actions. Production playback behavior was not changed to accommodate the test. The failed log is retained; the confirmation full run passed with the corrected schedule and no retries.

The first layout probe captured screenshots during the fade-in: these do not establish visible media correctness. Its header measurements did establish a 555-pixel scroll width in a 390-pixel viewport. The corrected probe waits for Grid and fully opaque layers and preserves the initial evidence separately. It covers 390×800, 759×599, 760×600, 960×900, 1,199×599, 1,200×600, 1,440×900 and 1,366×560. All final headers stay within the window and all privacy panels fit. The 390-pixel Grid's second square image extends **2 pixels below the viewport**; the probe explicitly records that overshoot and permits up to 2 pixels. All other tested media bounds fit without overshoot. This is a retained small-window limitation, not a claim that every layout is pixel-perfect. Final screenshots at 390×800 and 960×900 were visually inspected after fade completion.

An automated WebKit binary was unavailable locally, so no automated WebKit pass is claimed. Instead, actual desktop Safari opened the unchanged candidate bytes on a fresh temporary loopback origin with `?usageTest=1`. The local collector had zero requests before consent; Yes showed sharing on and produced exactly one `/` visit; No showed sharing off; reload preserved No and showed zero new page requests. The cumulative local receipt contains just that one visit. This verifies Safari startup/integrity and basic consent behavior, not Safari media processing or a complete test suite. The local test tab was closed and its temporary server stopped. Production consent and other browser tabs were not changed.

The first Safari navigation attempt lost characters because input raced new-tab creation; an invalid-URL dialog was canceled and the correct local address was entered. This was resolved through the browser UI and is not an app failure. No machine or browser security settings were changed.

## Evidence

- [Initial focused run](release-candidate-evidence/focused-tests.txt), [final focused run](release-candidate-evidence/focused-tests-final.txt), [initial full run](release-candidate-evidence/full-tests-before-header.txt), [failed final run](release-candidate-evidence/full-tests-final.txt), [isolated repetitions](release-candidate-evidence/playback-failure-investigation.txt), [confirmation full run](release-candidate-evidence/full-tests-confirmation.txt), [ownership](release-candidate-evidence/ownership-final.txt).
- [Reproducible layout probe](release-candidate-evidence/check-layout.cjs), [initial observations](release-candidate-evidence/layout-results-initial.json), [final observations](release-candidate-evidence/layout-results.json), [layout log](release-candidate-evidence/layout-check.txt).
- [390-pixel comparison](release-candidate-evidence/comparison-390x800.png), [side-by-side comparison](release-candidate-evidence/comparison-960x900.png), [390-pixel disclosure panel](release-candidate-evidence/privacy-390x800.png). Other tested sizes have corresponding screenshots in the same directory.
- [Safari local receipt](release-candidate-evidence/safari-local-counts.json), [verified account settings](../usage-account.md), [scope history](../usage-consent.md), [event contract](../usage-events.md), [release-note archive](../release-notes-archive.md).

## Remaining boundaries

Final whitespace validation passed, and a separate calculation confirmed that the adapter bytes match the HTML's integrity hash. The release candidate's local checks are complete. These checks justify publication review; they do not establish hosted dashboard receipt.

Actual iOS, iPadOS and Android hardware, touch interaction and Firefox were not tested in this turn. Browser/OS classification is provider-derived and can classify an iPad as a Mac. Feature counts do not establish usability or importance, especially where touch access is limited. Workspace events describe ready-review volume in a category, not distinct people or time spent. They can be lost independently of comparison counts; compare aligned release/media/item cohorts using the delivered workspace-category sum.

The prior consent/update suites cover mixed protected revisions and host-launch gating locally; they do not prove every installed historical release or a real native WarpCap launch. No live GoatCounter aggregation, filtering, repeat suppression or automatic deletion was exercised. Publication and a deliberately consented live dashboard check remain separate release steps. No broader analytics categories or tablet UI redesign were introduced here.
