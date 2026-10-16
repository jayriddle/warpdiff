# Draft PR and independent follow-up — October 15, 2026

Jay authorized committing the corrections, pushing the feature branch, opening a draft PR, running required hosted checks, and fixing follow-up findings. Merge and publication remain on hold. No repository settings were changed.

Draft PR: [#47 — Harden host media loading and bounded video scrubbing](https://github.com/jayriddle/warpdiff/pull/47). Branch: `codex/media-input-hardening`. Released baseline: `c2454a53cfab6c863e78fc0d07adc52b2235fa7f`.

## Initial hosted verification

The frame-verification and focus corrections were committed as `a625b7b3b4754096d05b218d759a4b5a5d768062`. Opening the draft PR triggered [run 38841981228](https://github.com/jayriddle/warpdiff/actions/runs/38841981228); no duplicate manual workflow was dispatched. Attempt 1 succeeded in 504 seconds:

| Check | Result |
|---|---|
| Complete Chromium, three separate one-worker machines | 498 passed, one approved existing timestamp-collision skip |
| Selected WebKit profile | 112 passed |
| Ownership | 870 passed |
| Release infrastructure | 18 passed |
| Publishing | Skipped |

Browser reports have complete, disjoint inventories, one execution per case, zero retries, and no unexpected skips, flaky results or runner errors. Local ownership has two additional neighboring-WarpCap checks unavailable in a fresh hosted checkout.

The PR tested virtual merge `a24f76d77e915b57dfba237f841cbac6e968f87a`, whose entire Git tree equals the feature commit's tree (`7bf2d65a8b66991c990529976ee412565972419d`). All six downloaded artifact ZIP digests match GitHub metadata. All 35 staged public files match the manifest and committed source bytes; `version.json` correctly identifies the tested virtual merge. Staging created an artifact and did not deploy it.

## Independent review and correction

A separate read-only reviewer examined the exact feature target, revalidated earlier full-suite inventories and source hashes, ran nine focused cases per engine, and challenged lifecycle, routing, deadlines and focus geometry. No additional runtime defect was found within that focused scope. Chrome passed eight focused cases but failed the new focus regression's setup; WebKit passed all nine.

The sole actionable finding was a P2 test race. The helper waited for the editor dialog to become invisible, although its queued native `close` event had not necessarily restored focus. The test could focus More first, then the existing close handler moved focus back to Customize info bar. Eight instrumented samples reproduced that ordering. This was an unfinished test precondition, not evidence that the production fit fix still hid More.

The test now waits for the close handler's `aria-expanded="false"` acknowledgment and explicitly asserts More's initial focus. It uses no arbitrary delay. The original three queued-fit expectations and Escape restoration remain intact; production code is unchanged from `a625b7b`. The reviewer independently source-reviewed these three added lines and confirmed that they resolve the finding without weakening the test.

Author verification of the exact corrected test passed 20 consecutive Chrome runs and 20 consecutive WebKit runs, one worker and zero retries. A copied test then served the exact earlier `9da778005bc61898f0ba64b5e708248575356343` info-bar source. Both new setup checks passed, and the test failed its intended queued-fit assertion. The validator requires the intended message, exact copied-file path and dynamically resolved assertion line, one result, one test error, zero retries and no runner errors. Ownership passed 872 checks; infrastructure passed 18; whitespace checks passed.

Five additional independent fault-injection scenarios passed per engine. Actual ten-second production deadlines measured 10,053.5 ms in Chrome and 10,052 ms in WebKit. Pending probe errors, clear/replacement, delayed play settlement and timeouts retired private media/canvas resources. Probes remained muted, used the correct source, stayed outside app listening/transport routes, and left comparison videos paused at time zero. Metadata refreshes retained visible More focus and geometry without taking focus from another control.

## Evidence, preservation and remaining limits

Raw evidence is retained locally under `output/media-input-pr-2026-10-15-jwn0fF/`. Start with `hosted/verification.json`, `focus-correction-verification.json`, and `independent-followup-20261015-204520/review-report.txt`, `review-results.json` and `source-correction-receipt.txt`. The companion [structured summary](pr-follow-up-verification.json) records the checked revisions and results.

The independent preservation audit passed for 5,520 pre-existing entries / 424,714,645 bytes, covering content, modes, symlink targets and Git state. It excluded `.git` and the agreed fresh orchestration directory; it did not measure access/modification times. The author separately audits existing file contents, modes, modification times and symlinks, allowing only this documented test correction and the two new project summaries.

Unsuccessful attempts remain visible: bundled Chromium stalled during initial failure capture and was interrupted; the corrected installed-Chrome focused run exposed the setup race; an initial supplemental WebKit keyboard-Tab precondition failed. Corrected WebKit focus probes use explicit focus without changing machine keyboard settings. These are not relabeled as green runs. Earlier author fixture/setup and negative-capture failures remain in [the correction record](adversarial-fixes.md).

The historical Grid `topGap = -899` and 44.1 kHz short-preview amplitude observations remain unexplained. This review does not establish arbitrary-codec/full-file integrity, whole-browser memory limits, physical Safari listening, or loudness/true-peak conformance. Forced stalled-play/unavailable-frame probes are fault injection. Existing encoded-input budgets and fixed codec-header checks retain their documented limits.

This summary accompanies the test-only correction. Its new required hosted run is pending at commit time; the final SHA-specific hosted results and review disposition will be added to PR #47 and the local receipt, avoiding another documentation-only push and duplicate CI. The successful earlier run above must not be substituted for checks on the corrected commit. Merge and publication still require Jay's approval.
