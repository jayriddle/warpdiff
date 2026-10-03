# Focused review follow-up — October 2, 2026

**The independent review recommends shipping the exact standalone 3.18.12 candidate and holding a future WarpCap bundle upgrade.** This follow-up closes its nonblocking test-observation finding F2. No application runtime file changed, so the standalone candidate still matches all 32 source hashes recorded at the release checkpoint and confirmed by the reviewer.

The [independent review](focused-safari-review-2026-10-02.md) and its evidence remain unchanged. This follow-up is implementation/verification of the test correction, not another independent review. No deployment, commit, push, hosted analytics event, account-setting change, native Safari interaction, WarpCap modification or vendor update was performed.

## F2: preserve transient codec-label history

The old AC-3 test polled for `Dolby Digital` after submitting the file. The review's fresh full suite had one failure because the app had already completed conversion and displayed `AAC · Stereo · 48 kHz` before that polling assertion observed the original label. Three independent traces showed the correct intermediate label lasting only about 135–162 ms. The reviewer classified this as a test observation race, not a reproduced conversion or source-metadata defect.

Updated `tests/audio-format.spec.ts` installs a DOM mutation observer on the A layer before loading. It retains text-node additions to the source-format field, including a label subsequently replaced before a driver-side poll. The test still performs real ffmpeg.wasm conversion, requires the final AAC UI label, and now asserts that the retained original Dolby Digital label precedes the retained AAC label. The history is attached to the test result. The observer is disconnected and its test-only state removed in `finally`.

No production hook, conversion delay, wider timeout, retry, skip or weaker final-label assertion was introduced. No new application code or version bump was needed. The exact [test diff](focused-safari-followup-evidence-2026-10-02/test-observation.diff) is preserved.

## Verification

| Check | Measured result |
| --- | --- |
| Entire audio-format suite | **9 passed, 0 failed, 0 skipped, 0 flaky, 0 retries**; two workers; 9.013 seconds |
| Real AC-3 conversion case | Passed; 973 ms test body; retained `Reading audio… → Dolby Digital → Reading audio… → AAC · Stereo · 48 kHz` |
| Ownership/pure logic | **467 passed, 0 failed**, exit 0 |
| Reviewed runtime hashes | **32 checked, zero changed** before and after testing |
| Tracked whitespace | `git diff --check` passed |

The [result summary](focused-safari-followup-evidence-2026-10-02/results-summary.json), [browser log](focused-safari-followup-evidence-2026-10-02/audio-format.log), [Playwright JSON](focused-safari-followup-evidence-2026-10-02/audio-format.json), [ownership log](focused-safari-followup-evidence-2026-10-02/ownership.log), and [invocations](focused-safari-followup-evidence-2026-10-02/invocations.json) preserve exact results. There was no failed follow-up run. Node/color runtime warnings did not cause failures.

This bounded correction does not replace either earlier full-suite result: the release checkpoint passed **344 tests with one existing skip**, while the independent review's fresh full run passed **343 with one failure and one existing skip**. Its sole failure is retained in the review's evidence and addressed by the test correction here. A further full run was unnecessary for this test-only change after all nine affected cases passed; no product bytes changed.

These tests use headless Chromium. No new native Safari audibility, picture/tab-return, surround/mobile or output-latency evidence was established. The unidentified historical silent-output trigger and the existing Safari workaround/limitations remain as documented. The reviewer did not reproduce a standalone production defect or require removing that workaround.

## F1 remains a separate WarpCap integration issue

The review reproduced a delayed scrub-resume callback starting playback after opening and closing Home without a new child Play action. Both WarpCap's existing 3.14.5 bundle and the candidate exhibit it in the isolated host fixture. A pending-logout cover without a focus transition also retained gesture state and a bounded direct-output tail until the normal idle timeout. The Safari-policy fixture's native player was paused/blocked; that result is not proof of audible sound behind a cover or an unbounded leak.

Before a WarpCap bundle upgrade, implement one supported viewer suspension owner and invoke it at host coverage boundaries before focus changes. It must retire gesture/play generations, pending seeks and deferred resumes, stop preview delivery and pause transport while retaining loaded media. Uncovering should restore input without restarting playback. Verify the delayed-resume and logout schedules, the covered-play control, actual task replacement/release, final frame removal, WarpSonic transitions and activity accounting. Native embedded listening acceptance is also needed before claiming Safari support for that upgraded surface.

F1 was not fixed in this follow-up. It is an existing host integration defect and does not block the review's standalone ship recommendation. Publishing standalone WarpDiff will not automatically update WarpCap's separately pinned bundle.

## Next action

The standalone release preparation and focused independent review are complete, with F2 corrected and tested. The next standalone action is to commit and deploy 3.18.12, then verify the deployed version. Publication has not occurred in this follow-up. Keep the WarpCap upgrade on hold until its separate integration work is complete.
