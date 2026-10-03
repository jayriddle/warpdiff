# Usage and basic reliability — 3.18.8 / consent scope 2

Date: 2026-09-30. User approved implementing the first feature-usage and basic error-reporting set after configuring WarpDiff’s GoatCounter account. This work changes the local working tree only: no commit, push, publication, external analytics script insertion or real GoatCounter test traffic. The official endpoint remains pinned in source; hosted acceptance is still unverified.

## Implemented result

- Visits plus accepted load attempts and ready reviews, including **one-item reviews** and 2–4-item comparisons. Media type and item count are fixed categories; repeats count as new loads.
- Per-review explicit Stack/Grid, scopes, combined audio graphs, Difference, wipe, loupe, Tile Check, loops, Solo and listening-preset counts. Initial/restored layouts and automatic audio-only graphs are not explicit choices.
- Scrub adoption by timeline/waveform/spectrogram surface, and cumulative thresholds at 1, 2, 6 and 21 completed drags. Excludes click seeks, loop-marker drags, Shift-drag regions, lost-mouseup/blur recovery and canceled work.
- Fixed loading-failure counts, audio-analysis failure vs successful foreground fallback, reduced/unavailable scrub preparation, and Continuous-to-short-preview fallback. Each operation family has a per-load attempt denominator. No new timeout policy or global exception listener.
- Scope 2 discloses these categories and the app release. Previous Yes requires review; saved No stays off. No analytics request reports a refusal or the stored consent record. All appearances remain available either way.
- Events carry the release in their path so historical release breakdowns do not depend on a changing page title. Full event vocabulary and interpretation are documented in [usage-events.md](../usage-events.md).

## Implementation decisions and safeguards

`js/usage.js` remains the sole collector, vocabulary validator and per-load deduplication owner. It retains only in-memory load/review contexts, readiness bookkeeping and operation tickets. A ready review requires both app activation and every assigned slot’s ready callback. Failed sets cannot count as ready. Features require a dispatched ready-review event.

A load must begin while consent is already valid. No late consent, reconnect or re-enable can make earlier work reportable. Clear, withdrawal (including another tab), scope invalidation, pagehide and offline transitions invalidate contexts/tickets. Async analysis and preview outcomes keep the ticket from their original operation; they cannot attach to a newer load. Existing application generation guards remain intact.

Network dispatch stays best effort: three-second timeout, no queue/retry/storage/replay, credentials omitted, empty referrer and no caching. The in-flight cap increased from 8 to 64 to accommodate bounded feature/diagnostic bursts without dropping normal events. Repeated features and scrub thresholds stop generating requests after their per-review limits. The local test status distinguishes ready reviews, events and collector request failures. Collector failures never produce error-report events.

The integration adds lightweight calls at existing behavior owners. Audio signal processing, media pixels, transport clocks, feature settings and appearance rendering are unchanged. APP_VERSION, cache name, README and in-app What’s New are now 3.18.8. User-facing details in README, FEATURES, MANUAL and the in-app Manual were updated; prior consent scope 1 remains preserved.

## Problems found and resolved during verification

1. The first regression run had **25 passing / 1 failing** tests: audio review events were absent. The loading UI calls audio “audio file”; passing that display label to a strict analytics enum correctly rejected it. Classification now derives only image/video/audio from assigned MIME types; display wording is independent. Later audio/video readiness tests passed.
2. Forced broken-image loads exposed the general activation callback’s ability to run with a failed or still-decoding image slot. Added per-slot readiness and a failure flag within the analytics owner. The review count now waits for all assigned slots even when the UI activates early. Tests cover failed images, delayed slots, stale callbacks and pre-consent pending loads. The UI activation behavior itself was not changed.
3. The first new feature test left keyboard focus on the Appearance button after dismissing privacy controls. WarpDiff intentionally ignores comparison shortcuts there. The test now starts with a real Stack toolbar click; this checks both toolbar and subsequent keyboard actions rather than assuming keyboard focus.
4. A blocked-worker test initially did not reach its intended failure because the service worker could serve the worker script. Analytics browser tests now block service workers, guaranteeing deterministic interception. With an actual worker failure, the original foreground analysis succeeded and only `analysis-fallback` was emitted; injected failure of foreground analysis emitted `analysis-failed` without raw exception text.
5. Chromium’s AudioWorklet loader bypassed the network route intended to simulate a blocked processor. The diagnostic test now rejects module preparation at its API boundary while retaining the actual shared engine and adapter. It verifies one attempt/fallback count and continued short-preview availability. This was a test-fixture issue, not evidence that hosted error reporting had worked.
6. Preview reduction is classified from the memory-limit plan’s `limited` flag, rather than merely comparing sample rates. Ordinary resampling is not a fallback.
7. One existing Solar geometry check failed once and passed on retry during development. Its test now waits for both orbital paths to match their resized dimensions and for animation pauses to settle before sampling. No Solar production code changed.

## Verification

Final full-suite run: **296 passed, 1 skipped in 1.6 minutes**, with no failed or retried tests. All 35 appearance/consent/analytics browser tests passed as part of this run. The skipped test is the existing timestamp-collision toast test, not an analytics test. Earlier development runs failed while exercising the cases above; they are not represented as clean passes.

- Full browser regression log: [scope2-full-suite.txt](scope2-full-suite.txt). Structural check log: [scope2-ownership.txt](scope2-ownership.txt).
- `git diff --check`: passed.
- Structural/ownership checks: **442 passed, 0 failed**. Includes three new guards for complete readiness, a single scrub-finalization hook, and invalidated diagnostic contexts.
- Forced worker and foreground-analysis test: **1 passed**, 2.4 seconds after service-worker isolation.
- Forced Continuous preparation-failure test: **1 passed**, 2.3 seconds after replacing the ineffective network-route fixture.
- Production-host tests serve this working tree under an intercepted official origin and intercept/deny every external request. They verify current-scope consent, No/withdrawal, stale Yes, copied-host rejection, automation suppression, release-prefixed paths and absence of cookies/referrers/private media data. They do **not** send live events.
- Desktop/mobile invitation and mobile Details were rendered and visually inspected. At 390×844, the Details panel stays within the viewport and scrolls; choices remain reachable. Evidence: [desktop invitation](scope2-invitation-desktop.png), [mobile invitation](scope2-invitation-mobile.png), [mobile Details](scope2-details-mobile.png).

## Limits and next steps

This is a bounded first set, not a full crash-reporting service. No raw error messages, stack traces, files, filenames, logs or recording of user activity. No per-feature dwell time, timing benchmarks, transcode outcomes, video scrub decoder diagnostics, individual scope choices, audio-source switching or verified-center availability denominator. Those remain candidates in the [planning catalog](../usage-measurement-catalog.md).

Counts describe starts, activations and fixed outcomes, not completed work or unique files/people. Scrub thresholds are cumulative; their differences only approximate frequency bands within aligned cohorts. Late errors may follow earlier readiness, diagnostic categories may overlap, blocked requests undercount, and opaque hosted responses cannot prove dashboard receipt.

Try the loopback preview at `http://127.0.0.1:8081/?usageTest=1`. Existing local scope-1 Yes will ask for the new scope; No will stay off. Before a public launch, settle the operator/contact and actual retention information already identified in the consent record, then publish and verify an explicitly consented real event in the hosted dashboard. No hosted settings or data were changed here.
