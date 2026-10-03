# Final adversarial follow-up — Reset cancellation

Completed 2026-10-01 in the existing WarpDiff working tree. This addresses F1 and F2 in the [final adversarial review](final-adversarial-review-2026-10-01.md). **The review's local release-signoff blocker is corrected and its behavioral regression passes.** No commit, push, deployment, account setting change or live GoatCounter count was performed.

## Correction and rationale

`js/usage.js` previously advanced the comparison epoch and discarded the old load/review on Clear, but left already-dispatched fetch controllers in the pending set. `resetComparison()` now advances the epoch and calls the existing `abortPending()` owner. That owner retires load/review contexts, advances the decision generation, aborts every pending controller and clears the pending set. Withdrawal, offline changes, pagehide and host activation already use it; Clear now follows the same lifecycle.

The actual Reset button reaches this owner through `resetAll()` and `clearAllMedia()`. Replacement loads and loading cancellation also share Clear. Manual loading was checked in source: it clears the old comparison **before** establishing standalone use and starting the new load. The change therefore does not synchronously cancel the new manual load's initial visit.

The adapter's HTML integrity was refreshed to **`sha256-D9dsUTie8UWB9gfEf84gTtysJGT1vFfXMUuzNYbjglE=`**. The unpublished candidate remains **3.18.12**, cache `warpdiff-v3.18.12`, consent scope **4**, and document/adapter contract `3.18.12/scope-4`. There is no collection expansion, new event or consent change. An already-received count cannot be retracted by aborting a fetch. The engaged visit remains once per document and is not replayed after cancellation.

F2's obsolete catalog paragraph now correctly describes single-item reviews and 2–4-item comparisons as implemented since scope 2 and retained in scope 4. The authoritative event contract already described that population. Its lifecycle wording now also makes Clear/replacement cancellation and declining the Reset confirmation explicit. The release-note archive records the correction; the concise public What's New stays unchanged.

## Behavioral proof and verification

A new production-branch Playwright regression uses a disposable context, saved scope-4 consent and the real Reset button/confirmation. It intercepts every external destination and holds the collector responses, while observing the actual fetch promises and their AbortSignals. The wrapper passes the original request and options to the browser's native fetch; it does not simulate abort behavior or alter the sender timeout.

The test loads two actual PNG inputs and establishes five pending paths: engaged visit, load attempt, ready comparison, participation and workspace. It verifies that all are still unsettled/un-aborted before the action. Declining Reset keeps the ready comparison and those requests intact. Confirming Reset returns to the landing state and must immediately abort all five signals. This assertion runs directly after the action, before the sender's three-second timeout could conceal the bug. It then verifies promise settlement, no extra old requests, and four fresh events from another comparison without replaying the document's visit.

| Check | Exact result |
| --- | --- |
| New regression against the original adapter | **1 failed** at the immediate all-aborted assertion; test body 497 ms. This reproduces F1 before its timeout. |
| Same regression after the owner change | **1 passed**, 1.2 s total; test body 428 ms. |
| Appearance/consent, production and real installed-update suites | **61 passed**, 28.7 s, two workers, zero retries. |
| Ownership/pure-logic harness | **444 passed, 0 failed**. |
| Whitespace and integrity verification | `git diff --check` passed; independently calculated adapter hash matches the HTML attribute. |

The focused suites include prior failed-withdrawal, queued No → Yes, host-launch, no-replay, diagnostic-ticket, workspace and restored-audio-panel regressions. The installed-update test exercises a real service worker and Cache Storage with partial upgrade/downgrade and disclosure mismatch, using the changed adapter and its refreshed hash; blocked revisions remain silent and comparisons usable. The existing full media suite was not repeated for this bounded analytics cleanup: its 325-pass/one-skip results remain recorded in the release preparation and independent review, and are not presented as a new full run after this fix.

Evidence: [failing regression](reset-cancellation-evidence-2026-10-01/regression-before-fix.txt), [passing regression](reset-cancellation-evidence-2026-10-01/regression-after-fix.txt), [61-test run](reset-cancellation-evidence-2026-10-01/consent-and-update-tests.txt), [ownership](reset-cancellation-evidence-2026-10-01/ownership.txt), and the permanent test in `tests/usage-production.spec.ts`. The original adversarial report and its evidence were preserved unchanged.

## Remaining boundaries

Browser verification here is Chromium with locally intercepted requests. It proves immediate native-fetch signal cancellation and lifecycle behavior; it does not prove removal of a count already received, hosted dashboard acceptance, filtering, aggregation, repeat suppression or retention enforcement. No further Safari, Firefox, native WarpCap, tablet or actual BFCache test is claimed by this follow-up. Earlier coverage and limitations remain in the [release-candidate record](release-candidate-verification.md) and [adversarial report](final-adversarial-review-2026-10-01.md).

The candidate is ready for deployment review with both reported findings addressed locally. Publication and a deliberately consented live dashboard verification remain separate steps.
