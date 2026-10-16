# Adversarial review corrections — October 15, 2026

Working branch: `codex/media-input-hardening`. Starting revision: `9da778005bc61898f0ba64b5e708248575356343`.

This record describes the local correction and verification phase for the two adversarial findings, before committing or pushing. Jay subsequently authorized committing the fixes, pushing the feature branch, opening a draft PR, running hosted checks and obtaining focused independent review. Those follow-up results are recorded in the PR description and a separate local verification receipt. Merge and publication remain on hold; repository settings are outside this follow-up.

## Changes and rationale

### P2: host video readiness without usable video samples

The review supplied a fast-start MP4 ending immediately after its `mdat` header. Its metadata and dimensions load, but it contains no video sample bytes. The earlier implementation trusted `loadeddata` and could send READY for this empty video.

`_hostLoadVerifyVideo` now owns a cancellable initial-frame check for host video slots. Native readiness and dimensions alone cannot mark a video ready. It checks whether the native element can actually draw a frame to a private 1×1 canvas. Two distinct opaque backgrounds and copy compositing distinguish a no-op draw from a genuine black, red, green or transparent pixel; pixel brightness is not used as a validity rule.

Small native probes confirmed that WebKit can report readyState 4 without materializing a paused frame even for the valid complete-file control. If the comparison has no drawable frame, a separate muted inline video briefly verifies native decoding of the same local blob. The comparison remains paused at time zero; its playback and listening routes are untouched. The verifier is not placed inside an asset layer or the transport participants.

Verification has a 10-second deadline. A missing frame, native probe error or rejected play promise routes through the current request's existing failure owner: one correlated FAILED, no READY, partial comparison cleared, and Pull restored. Success, failure, clear and replacement cancel the pending check, pause/remove/release the temporary element, and release the canvas. The request signal and captured loading token fence late work.

This is initial-usability validation, not proof that every frame in a file is intact. A browser that blocks the required muted verification reports failure rather than assuming success. These limits are described in the README, feature inventory, manual and agent guidance. The unpublished candidate stays at version 3.19.2; the quiet announcement marker is unchanged.

### P3: More-button focus during info-bar fitting

The fit owner previously hid More before measuring and then showed it again when overflow remained. Chrome moved keyboard focus to BODY during that temporary hide.

The fit now calculates the final overflow decision before changing More's visibility. A button that stays visible is never hidden during measurement, so focus remains on it. This avoids restoring focus after a blur or taking focus back from a different control. The new regression checks three real queued refreshes and Escape focus restoration. WebKit also runs this regression in the selected profile.

## Regression coverage

- Valid complete-file control followed by metadata-only video: both signed/supplied transports and same-window/managed-parent hosts. The fixture's first sample starts outside the truncated prefix. Valid READY leaves the comparison paused at zero; truncated video cannot receive READY and must fail at the bounded deadline. Cleanup and absence of later terminal replies are asserted.
- Source-pixel tests cover black, both sentinel colors and full transparency.
- Pending verification is retired by replacement and clear; stale deadlines cannot affect a newer comparison.
- A rejected verifier play promise produces one clean failure and releases the probe.
- A focused More button retains focus through queued fits while still visible.

All browser verification uses one worker and zero retries. Existing fixture sentinels were present. A guard skips byte-identical legacy PNG writes and rejects changes, preserving existing fixtures and evidence.

## Verification record

The first focused run passed the two same-window video cases, then failed managed-host setup because the new fixture omitted required display labels. That setup was corrected; it was not treated as an application defect. The interrupted attempt and its report remain preserved.

The corrected initial focused profile passed seven cases in Chrome and seven in WebKit. The two additional cleanup/play-rejection cases are included in the complete profiles below.

Negative-control copies load `index.html` and `js/info-bar.js` from the exact starting revision without reverting working source. Two initial negative attempts reached the intended video assertion but also hit a later test timeout during failure capture/teardown and were interrupted. Their exact timeout cause was not established; neither is claimed as a clean negative verification. The final negative-only configuration disables failure screenshots/traces and excludes unrelated pending-verifier setup cases. It completes with exactly five failures, each with one intended behavioral error: four premature READY assertions and the queued-fit focus assertion. It has no runner errors, retries or skips.

The complete Chromium suite passed 498 cases with its one approved existing timestamp-collision skip (499 unique cases, 498.096 seconds). The selected WebKit profile passed 112/112 in 114.453 seconds. Both complete reports pass the repository's report validator against freshly collected inventories, with no flaky results, retries, runner errors or unexpected skips. The expanded WebKit profile includes the new More-focus regression; it is not the complete cross-browser suite.

The exact same four premature-READY checks also fail at their intended assertion against the starting source in WebKit. The negative validator checks the behavioral message, exact copied-file path, dynamic assertion line, one error per case, no retries and complete result counts. Chrome has five intended failures, including focus; WebKit has four, since the pre-existing focus issue is Chrome-specific.

The final ownership harness passes 872 checks, including the existing 314 malformed-parser checks; release infrastructure passes 18. Whitespace checks pass. The companion [verification JSON](adversarial-fixes-verification.json) records durations, source hashes and evidence paths. All browser work was serial, with one worker and zero retries.

No application or test source changed during the complete browser runs. The affected runtime HTTP responses match working source byte-for-byte, and all five recorded application/test/config source hashes remain unchanged after verification.

The strict final preservation audit passes: only the ten intended tracked files changed and these two project records were added. All other pre-existing files and all seven symlinks retain their content, mode and modification time; no fixtures, dependencies or previous evidence changed. HEAD and branch remain unchanged, and the index is untouched. The private verification output remains ignored and unpublished.

Raw evidence directory: `/Users/jay/Documents/warpdiff/output/media-readiness-fix-2026-10-15-booXAH/`.

## Retained limitations

The historical Grid `topGap = -899` and 44.1 kHz short-preview amplitude failures remain unexplained; current passes cannot establish their cause or repair. This work does not claim a change to audio measurement accuracy, the analysis-required host policy, full-file integrity validation, or whole-browser memory limits. No physical Safari listening or loudness/true-peak conformance check was performed.
