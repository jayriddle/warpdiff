# Audio selection and timeline repairs — October 23, 2026

Prepared version: **3.19.14**, from main `312536c2970bb8f21fa8f99feb0d4067a41a50e3` (3.19.13), on `codex/audio-review-fixes`. This addresses all three findings in [the adversarial review](main-adversarial-review-2026-10-23.md). It is a local implementation and verification record, not a deployment record.

## Changes and decisions

**R1: ambiguous WebM soundtrack selection.** Both video/lazy analysis and audio-only loading now apply the same one-track policy to WebM as MP4. The WebM demuxer inventories track numbers, types and codecs before copying packets or codec configuration. Multiple tracks, including an unsupported second codec, do not silently select the last supported track. Duplicate/invalid track identities and duplicate identity fields are rejected. Single-track extraction distinguishes Opus from Vorbis. Manual playback keeps the browser's soundtrack selection; waveform, spectrogram, metrics, listening presets and scrub audio remain unavailable with an explanation. Media status uses the same selection policy. Managed video readiness still depends on usable picture; managed audio-only requests fail when required analysis is withheld. Reloading a single-track copy and clearing retire the notice.

**R2: audio duration truncating picture.** Removed the decoded-audio duration override from timeline, duration displays and loop handling, including the separate progress-loop early wrap. `_getEffectiveDuration` now follows the supplied native media element. Retired the Solo reconciliation function whose only production caller reacted to that unsupported audio-based duration correction. A short or delayed soundtrack no longer shortens the picture, and longer soundtracks retain the native media timeline. Existing native and managed loop owners continue to enforce picture transport. Two older tests that required truncation were changed to require preservation; real-media tests independently verify seeking, playback past the sound end, Solo and custom loops.

This deliberately uses browser-reported media duration. Audio PCM is insufficient evidence for correcting a genuinely malformed/inflated container duration. This change does not add a separate complete video-timing validator or certify every frame's timing.

**R3: metadata text selecting replacement.** Removed the literal `Opus` byte search from replacement eligibility. Only one parsed Opus track can mark Chrome replacement pending. Publication also requires the WebCodecs decode to identify its codec as Opus; a non-Opus finalize clears pending before native output is prepared. Without WebCodecs, native decoding cannot activate replacement. The unrelated unsupported-codec scan remains a failure-path preparation hint, not playback authority. The 3.19.12 non-Opus timeout fix remains covered.

The source version, README and worker cache advance together to 3.19.14. This is quiet maintenance: the existing 3.19.13 What's New summary remains. README, FEATURES, MANUAL, in-app help, AGENTS and the release archive describe the changed behavior. No external libraries or processing service were added.

## Regression coverage

`tests/audio-selection.spec.ts` generates small real media in a fresh temporary directory through `tests/helpers/audio-selection-files.mjs`. The AAC metadata control is stream-copied so adding its comment cannot change the encoded audio/video packets. Cases cover two Opus soundtracks, mixed Opus/Vorbis soundtracks, audio-only WebM, native 440 Hz default-track playback, a single-track 440 Hz analysis control, clear/reload, AAC with misleading metadata through native and fallback decoding, short/delayed/longer soundtracks, actual 90% timeline seeks, playback after sound ends, Solo/custom loops and managed video/audio readiness. The suite is included in the WebKit workflow and automatically discovered by Chromium CI.

Ownership checks use synthetic EBML to verify ambiguity rejection before any packet/configuration slice, including later track inventories and unsupported tracks. Media-admission checks verify unavailable capabilities and accurate WebM notices. Existing MP4, multichannel, monitoring, decode-generation, native-output and transport suites are exercised alongside the new tests.

## Verification record

Evidence is retained in ignored `output/audio-review-fixes-2026-10-23/`. Every browser run used one worker and zero retries. Counts below are per run; overlapping cases are not added together as distinct coverage.

| Check | Result |
| --- | --- |
| Ownership / pure logic | 1,740 passed, zero failed |
| Release infrastructure | 26 passed, zero failed/skipped |
| Broad Chrome audio/transport | 195 passed; two synthetic monitoring fixtures failed, then were corrected and rechecked below (340.2 s) |
| Chrome focused follow-up | 36 passed, zero failed/skipped/flaky (65.9 s) |
| Expanded WebKit audio/transport | 70 passed, zero failed/skipped/flaky (101.5 s) |
| Full-length native loop, Chrome and WebKit | Both passed; Chrome replacement audio also restarts after the silent tail (12.2 s) |
| Original 3.19.13 negative control | All four selected regressions failed for their intended assertions |
| Syntax / whitespace | JavaScript syntax and `git diff --check` passed |

The final union is **204 distinct Chrome cases** and **70 distinct WebKit cases**, with no unresolved failing cases in the changed checkout. The first broad Chrome report remains retained with its two failures; this is not a claim that its original run was all green. All five final browser reports have zero report-level errors. The complete new suite has 14 cases, all passing in both browsers. The final loop follow-up strengthens the existing short-soundtrack test with full-duration wrap and audio-restart assertions.

The broad run covers strict host readiness, native output, MP4 selection and malformed extraction, multichannel monitoring, analysis cancellation, media-input reports/providers, waveform reset, visual clocks, restart, scrub pitch, Solo and Sync/Full loops, offset-aware audio mapping, source-switch fades and Opus scheduling. The follow-up reruns the new suite and all dialogue-monitoring cases, plus full-rate preview budgeting/cancellation. WebKit covers the new suite, MP4 selection, native output, reports/providers, Solo handoffs, Opus scheduling and timeline placement. This is targeted coverage rather than a full CI/browser inventory run.

**Measured signal control:** the Chrome native-playback tap after loading the two-track WebM measured 440 Hz at 0.056578 and 880 Hz at 0.000007807 during its first non-silent sample window. The selected single-track file independently retained the 440 Hz analysis tone. These measurements distinguish soundtracks; they are not a calibrated loudness or physical listening test.

**Initial checks and resolved failures:** the first ownership run passed 1,729 checks before the added pure/report regressions; the final inventory passes 1,740. An initial 12-case Chrome run passed after fixture setup was corrected; the initial 13-case WebKit run passed in 18.2 seconds. The two failures in the broad Chrome run were the 5.1/7.1 synthetic replacement monitoring tests: their direct call to `_finalizeAudioViz` supplied only a pending flag, so the new codec requirement correctly withheld replacement and the tests found no replacement gain to connect. Their fixtures now explicitly declare their simulated Opus codec. Signal, gain, timing and cleanup assertions were retained. Both pass in the 36-case follow-up. A separate new test verifies that pending state with an AAC decode cannot publish replacement. No product guard or assertion threshold was loosened to make the monitoring tests pass.

**Negative controls:** the same new regression tests were run against an untouched copy of the public source files from `312536c`, served separately on port 8093. The old version has no multi-track WebM notice, enables replacement/mutes native AAC when its comment contains Opus, reports 2 seconds for the 5-second picture, and repeatedly wraps before the playhead can reach 3 seconds. Each failed at the expected assertion. Failure cleanup also reached the 60-second test deadline in all four old-version cases, so the secondary timeouts are retained alongside the decisive assertion errors. Those cases pass on the fixed version, including the loop follow-up.

**Setup failures retained:** macOS's `python3` shim refused execution because the Xcode license is not accepted; the edit was rerun with the existing Node runtime, without changing machine settings. The first browser command raced creation of its log directory and did not start; it was rerun after directory creation. The first real fixture setup failed because the installed FFmpeg does not include `libvorbis` (one failed setup, 11 tests unexecuted). The helper now uses FFmpeg's built-in stereo Vorbis encoder with its required experimental flag; the next Chrome run passed. The first baseline command selected no tests because its regex was anchored before Playwright's file/project title prefix; the corrected title filter selected the four intended cases. No packages were installed or upgraded.

Primary evidence: `chrome.json/log`, `chrome-followup.json/log`, `webkit.json/log`, `loop-followup.json/log`, `baseline.json/log`, `baseline-setup.*`, `audio-selection-first.log`, `audio-selection-second.log`, `webkit-first.log`, `ownership-final.log`, `infrastructure.log`, and `FINAL-VERIFICATION.json`. Matching `*.config.cjs` files preserve exact suite selections, output paths and channels; use fresh evidence paths to repeat them. Product tests and fixture creation are in the repository's `tests/` directory. Environment: macOS arm64, Node 26.4.0, Playwright 1.58.2, installed Chrome 156.0.8078.47, and FFmpeg 8.1.2; see `environment.json` for runtime paths. Syntax and whitespace checks passed after the final code/test edits.

## Scope and remaining limits

This is a repair of selected-track identity, replacement eligibility and duration ownership, not complete WebM/Matroska validation, a new track-selection UI, or proof of full-file decode/synchronization. WebM audio timing that was previously unknown remains explicitly unverified. Native signal measurements run through the browser audio graph with speaker output muted; they are not physical output-device latency or listening certification. Tests use generated media, not user files. Existing unrelated untracked documentation/evidence is preserved. Verification above was completed before PR publication; this record does not indicate a merge or deployment.

## PR preparation

At the user's request, the reviewed changes are being published from `codex/audio-review-fixes` against `main`. A fresh fetch confirmed that `origin/main` still points to `312536c2970bb8f21fa8f99feb0d4067a41a50e3`. SHA-256 comparison confirmed all 21 files in the final verification manifest matched the tested snapshot before this publication note was added. Only the repair, its tests, affected documentation and the original review record are included; generated evidence stays local and ignored. GitHub CI will provide the full repository checks separately from the targeted local results above.

## PR 62 CI follow-up

[PR 62](https://github.com/jayriddle/warpdiff/pull/62) was published at `3afd4176ff880ed535a6438d714762315d2a4511`. Its [initial CI run](https://github.com/jayriddle/warpdiff/actions/runs/40054974080) passed ownership/infrastructure, Chromium shards 1 and 2, WebKit and public-file staging. Shard 3 found one additional legacy assertion outside the targeted local selection: dragging past the timeline end still expected the two-second replacement buffer to truncate a roughly three-second video. The video correctly stayed paused at 2.986333 seconds, so the obsolete `time <= 2.01` expectation failed. The required aggregate check correctly blocked merging.

The test now requires a native duration greater than 2.5 seconds, a final position within 0.1 seconds of that duration, and paused playback after release. It retains the shorter replacement buffer and strengthens the full-video-range assertion. No runtime code or CI protection was changed. All six Chrome scrub-recovery cases passed, the corrected end case passed in WebKit, and ownership passed all 1,740 checks again. The first supplemental WebKit launch inherited Chrome's channel from the temporary local config and failed before running the test; removing that inherited channel produced the passing 2.6-second run. Logs and reports are retained as `ci-failed.log`, `merge-followup.*`, `merge-webkit.*` and `merge-ownership.log` in the same ignored evidence directory. Updated full CI is required before merging.
