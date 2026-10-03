# Release readiness assessment — October 1, 2026

**Recommendation: hold deployment for a focused review of the later Safari changes, the original-clip listening check, and a final full regression run against the frozen shipping candidate.** This is a release-readiness assessment from existing evidence and current source inspection, not a new independent adversarial review. No commit, push, deployment, live analytics event or native browser action occurred during this assessment.

**October 2 update:** Jay completed the original-clip audibility check and reported sound while scrubbing in both number 2 (direct output) and number 5 (the shipping workaround). That listening prerequisite is now met. The focused independent review and final full regression run remain pending. His report does not establish a new tab-return, picture-presentation or mute/source-switch acceptance run. Exact evidence and limits are appended to the [root-cause record](safari-root-cause-investigation-2026-10-01.md). The cause remains unresolved; the workaround is unchanged.

## What is already closed

The [final independent adversarial review](final-adversarial-review-2026-10-01.md) found a medium-severity Clear cancellation defect and a low-severity obsolete planning paragraph. The [Reset follow-up](reset-cancellation-verification-2026-10-01.md) corrected both. Its immediate cancellation regression failed before the fix and passed afterward; 61 consent/production/installed-update cases passed, with 444 ownership/logic checks. Current source still routes `resetComparison()` through `abortPending()`, and the catalog describes the implemented 1–4-item population. The current analytics adapter's independently calculated SHA-256 matches the HTML integrity attribute. App/cache version alignment remains 3.18.12.

The independent review's full Chromium run passed 325 tests with one existing skip, but that run preceded the subsequent Safari media changes. It must not be represented as full coverage of the current shipping bytes. The analytics implementation has not gained new collection categories during these media changes; a complete repeat of the analytics design review is not the highest-value next step.

## Why the later changes merit a focused review

Comparing the current production HTML/JavaScript/service-worker files with the independent review's preserved hashes identifies five changed files: `index.html`, `js/usage.js`, `js/transport.js`, `js/audio-routing.js` and `js/scrub-audio.js`. The usage change is the bounded Clear fix described above. The other files include help typography, native seek scheduling and restoration, Safari video output/gain policy, context priming, and the generated-stream scrub output. The pinned scrub core/worklet and other extracted production scripts still match the reviewed hashes.

The [tab/seek verification](safari-tab-restore-verification-2026-10-01.md) records 64 passing targeted transport cases and native presentation controls. The [scrub-output investigation](safari-output-investigation-2026-10-01.md) records 43 distinct passing behavioral cases, seven strengthened output-lifecycle cases overlapping that population, and 467 ownership/logic checks. Four subsequent codec/layout cases passed in Chromium with a Safari policy fixture. These are useful local regression checks; capability fixtures do not establish native WebKit behavior or speaker audibility.

An independent focused review should examine the interactions among the new owners: rapid source selection, mute/volume changes, forward/backward dragging, native play after seek, queued seeks and stale callbacks, blur/hide/return during a gesture or fade, Clear/replacement while preparation or player startup is pending, and stream/player/track/timer cleanup. It should check native-versus-graph capability fallbacks and that Chromium's ordinary direct output is unchanged. Existing analytics lifecycle and installed-update tests should be rerun as regressions; no live count is needed for the review. A full independent audit of unchanged analytics design is unnecessary absent a new finding or collection change.

## Native evidence and the remaining practical check

The original running-but-inaudible Safari session was real: valid dragging rendered strong post-gain PCM without audible sound; a fresh direct sample was also silent, while the generated stream feeding native audio was audible. Jay subsequently confirmed working scrubbing after the workaround. The trigger remains unidentified.

All six fresh variants later sounded audible, including the candidate without that workaround. The latest direct-output fixture test also remained audible after two actual tab absences (22.443 and 7.783 seconds), with completed preparation and uninterrupted gestures. This is encouraging evidence; it is not a reproduction of the original failure or a fresh test of the shipping workaround with the original private clips. The [root-cause record](safari-root-cause-investigation-2026-10-01.md) preserves these distinctions and the local test controls.

Jay plans to test the original clips in the morning. Number 2 checks whether the original pair reproduces the direct-output failure. For release acceptance, the exact shipping output path also needs a fresh check with that pair: number 5 uses the unmodified candidate adapter. Actual forward/reverse dragging, source switching and mute/volume behavior, tab return, and picture movement/playback responsiveness should be checked there. If the direct-output failure cannot be recreated but the shipping path works, an unidentified trigger alone need not prevent release. It does prevent claiming that the root cause was identified or eliminated.

Native surround and mobile WebKit remain limitations. The native FLAC-in-MP4 5.1 probe did not reach a preview buffer and entered an unverified transcode fallback; it did not establish a bridge-output failure. The Chromium Opus/FLAC 5.1/7.1 tests are not native Safari codec assurances. Extra stream output latency and resource cost were not benchmarked. These limitations should remain explicit rather than turning every untested device/codec into an indefinite release gate.

## Bounded release path

1. Complete the original-clip direct-output diagnosis and fresh shipping-path acceptance check.
2. Obtain a focused independent adversarial review of the post-review Safari changes; correct any material findings.
3. Freeze the candidate and run the full behavioral suite plus ownership/logic checks, with version/hash alignment and production-versus-QA packaging verified.

Passing those checks would support deployment with the documented Safari limitations. Repeating reviews indefinitely would not establish a zero-risk release. The localhost diagnostic helpers belong to the evidence directory, are absent from application/service-worker assets, and should remain outside the public deployment contents.
