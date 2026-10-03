# Safari scrub-audio recovery — 2026-10-01

Jay reported that picture movement looked good after the preceding Safari changes, but scrub preview was silent. This follow-up fixes a specific preview-context recovery gap in the unpublished 3.18.12 candidate. It does not establish the exact state of Jay's original silent tab; those files and that tab's internal state were not inspected or changed.

## Change and rationale

`_primeScrubAudioContext` in `js/scrub-audio.js` remains the gesture-time owner of preview audio startup. It now resumes any inactive, non-closed context, including Safari's `interrupted` state. Previously only `suspended` resumed. The native mono/stereo video path added in the preceding work deliberately avoids MediaElementSource to reduce Safari picture stalls, so native Play cannot be assumed to activate the independent Web Audio preview context.

The fix stays in the WarpDiff adapter. The pinned shared scrub core and worklet, source PCM, selection/mute/volume policy, native output path, transport clocks, consent scope and analytics adapter are unchanged. A read-only `continuousScrubState` accessor exposes the core's existing diagnostic view to the behavioral suite. README, FEATURES, Markdown Manual, in-app Manual and AGENTS describe the recovery consistently. The current What's New summary remains three short bullets; no new development step was added there.

## Measured before and after

Native Safari ran a loopback-only QA page with the repository's known AAC stereo video fixtures. A local helper clicked through native Safari controls, then dispatched synthetic DOM drags into the real controller at 35 ms intervals. The drags are not a claim of sustained physical pointer automation. AnalyserNodes measured the processed preview gain's PCM. These measurements establish signal production, not physical speaker output or perceived audio quality.

The interruption fixture really suspended the AudioContext, then fault-injected the `interrupted` state label. Its resume wrapper removed the injected label and called the real native resume. This models the missing state transition; it did not induce a real OS interruption or lock the Mac. The baseline adapter was served from a separate loopback QA route that restored only the old conditional, without editing production files.

| Native Safari check | Result |
| --- | --- |
| Baseline, interrupted context, forward drag | Preview RMS 0; snippet RMS 0; context clock remained 19.1147 s |
| Updated, same interruption fixture, forward drag | Context resumed; clock advanced 1.6373 s; maximum preview RMS 0.08168; snippet RMS 0.06357 |
| Updated, backward drag after recovery | Maximum preview RMS 0.07690; context stayed running |
| Updated, Grid drag after a real tab switch | Maximum preview RMS 0.08088 |
| Native output isolation | Two direct outputs and zero native MediaElementSource routes throughout these checks |
| Seek backward and play after recovery | First clip's presented PTS advanced from 0.273 to 0.4397 by 500 ms, then 0.9397 by 1 s |

The initial ordinary forward/backward probes also produced preview PCM before any controlled interruption. In an initial Stack probe after a real tab return, native seeks stalled and the presentation-clocked preview had no target, so it was silent even though the audio context was running. The adapter recovery change does not address a native seek stall. The initial observations are preserved separately from the controlled interruption comparison; they must not be presented as proof that every silent preview has the same cause.

A final decoded-pixel check confirmed this separate limitation after a paused tab return: the time moved from 2.5658 s to 0.3011 s while the earlier blue/cyan pictures remained. Grid preview still produced RMS 0.08049. A plain native-video control with **no WarpDiff code or audio graph** then reproduced the same stale blue/cyan pictures after an exact seek to 0.301 s; `fastSeek` did not correct them. This control separates the browser's native picture recovery from the adapter fix. It does not justify claiming that the app can never contribute to other stalls, or that all Safari builds/devices behave this way. See [plain control](safari-scrub-audio-evidence-2026-10-01/native-tab-control.html) and the `native-tab-control` observations.

Playing the plain control for 750 ms and pausing recovered red/yellow pictures at approximately 0.84/1.03 s. This was an explicit native Play action, not an automatic WarpDiff recovery implementation. [Recovery screenshot](safari-scrub-audio-evidence-2026-10-01/native-control-recovered.png).

## Automated verification

- New behavioral regression: **1 passed, no retry, 4.2 s**. It uses Safari's direct-output policy in Chromium, stops the real context and injects the interruption label, then uses browser mouse drags. It verifies resume, nonzero processed preview RMS, zero native source routes, silence after release, and mute silence during another drag. It models Safari policy/state, not native Safari's OS lifecycle.
- Focused playback/scrub regression run: **28 passed, no retries, 30.1 s**. Covers native scheduling, restored surfaces, decoded timeline placement, WebCodecs scrub lifecycle, source handoffs, envelopes, restart and cancellation, including the new interruption test.
- Ownership/pure-logic harness: **462 passed, 0 failed**.
- Source syntax and `git diff --check`: passed. The QA helper initially had a malformed comment boundary; it was corrected and syntax-checked before its first browser run. This was a helper error, not an app result.
- Local preview verification: both HTML and `js/scrub-audio.js` at port 8081 returned 200 and matched the working tree byte for byte.

Evidence: [native observations](safari-scrub-audio-evidence-2026-10-01/observations.json), [initial probes](safari-scrub-audio-evidence-2026-10-01/baseline-observations.json), [controlled interruption observations](safari-scrub-audio-evidence-2026-10-01/interruption-observations.json), [new test](safari-scrub-audio-evidence-2026-10-01/interrupted-test.txt), [regression log](safari-scrub-audio-evidence-2026-10-01/regression-tests.txt), [ownership log](safari-scrub-audio-evidence-2026-10-01/ownership.txt), [served-source check](safari-scrub-audio-evidence-2026-10-01/preview-check.json), and [source hashes](safari-scrub-audio-evidence-2026-10-01/final-source-hashes.json). The server and fixture helper are retained for reproducibility, with local-only collector handling and no forwarding.

## Remaining verification and delivery

Jay's original comparison still needs a listening check after reloading the local Safari page and loading the files again. A real Safari OS-induced interruption, hardware audio output, iPad/iPhone volume-locked behavior and audible time-stretching quality were not established by these measurements. The separate native seek-stall observation remains a Safari limitation; publication remains on hold while the actual comparison is rechecked. The older tab-return record's passing run must not be read as an unconditional guarantee of recovery.

No commit, push or deployment was performed. No live GoatCounter count was sent. The user-facing preview remains at **http://127.0.0.1:8081/?usageTest=1**. Temporary native QA tabs and their dedicated server are closed after verification; the original comparison tab and port-8081 preview are preserved.
