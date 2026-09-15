# Even playhead motion during normal playback

## Result and scope

WarpDiff **3.16.1** advances its timeline, waveform and spectrogram playheads from the display-refresh clock, with small corrections toward the native media clock. This fixes uneven normal-playback motion for a single clip as well as synced comparisons. The starting revision was `be6e850` (3.16.0).

Audio routing, source-switch fades, Continuous scrub processing, decoded analysis, video rendering, and transport/loop timing are unchanged. The change is local; release and WarpCap's bundled-copy update remain separate actions.

The existing compact What's New section is carried forward under 3.16.1, with its playback highlight updated. This preserves the user's requested consolidation instead of adding another interim release section.

## Cause

The old display clock combined the native media clock with a projection from each displayed video's frame timestamp. Video frames and screen refreshes do not necessarily have the same cadence. Resetting that projection on each video callback produced alternating short and long cursor steps. The native audio clock also has small sampling fluctuations. Preventing backward movement alone could turn those discrepancies into held positions followed by catch-up steps.

A muted, isolated Chrome run reproduced the variation using one generated H.264 clip; its typical per-refresh movement varied from roughly half speed to one-and-a-half speed. The stripped movie was also measured alone and as a synced pair. This is timing evidence, not a claim that the device's audio or video content was independently re-evaluated by eye or ear.

The browser callback specification also documents that frame callbacks may arrive a refresh late and run at the lower of video/display cadence: [requestVideoFrameCallback specification](https://wicg.github.io/video-rvfc/). The implementation decision is grounded in the local traces below.

## Implementation and safeguards

- `_resolveVideoProgressTime` remains the sole display-clock owner. The animation frame's timestamp reaches it through the existing progress-update functions.
- `_projectVisualTime` advances at the video's playback rate and corrects native-clock sampling noise over 150 ms. Each ordinary correction changes the displayed speed by at most 10%; it does not alter audio speed or seek any media.
- If the native clock stops, extrapolation is limited to 25 ms of wall time or one source frame, whichever is smaller. Insufficient buffered data holds the cursor. Pause, seek, restart and wrap retain direct positioning.
- After a long delayed refresh, the clock catches up to native time without reversing a cursor held for a stall. A 500 ms delayed-refresh replay covers this edge case.
- A per-video seek generation catches a seek that starts and finishes between refreshes. Small native-clock corrections are no longer interpreted as loop wraps.
- Source handoffs retain the shared display clock. Stale hidden-video frame timestamps cannot steer it.
- FPS detection retains its single callback chain and accumulated samples, and now finishes when the frame rate is known. Frame-accurate loop enforcement retains its separate existing owner.
- Cursor positioning still uses compositor transforms. No CSS transition animates a seek or return to the beginning.

## Before and after

Values show the 5th–95th percentile of movement per refresh divided by elapsed wall time at 1× playback. **1.000× means steady motion.** Both traces are recomputed with the same 5–50 ms refresh-interval filter. A held update advances less than 1 ms. Counts and raw samples are in [comparison.json](comparison.json) and the linked traces.

| Clip | Loaded copies | Before | After | Held updates before → after |
|---|---:|---:|---:|---:|
| Generated H.264 | 1 | 0.489–1.516× | 0.985–1.012× | 0 → 0 |
| Generated H.264 | 2 | 0.008–1.548× | 0.989–1.008× | 6 → 0 |
| Stripped H.264 / 7.1 FLAC | 1 | 0.957–1.142× | 0.989–1.006× | 0 → 0 |
| Stripped H.264 / 7.1 FLAC | 2 | 0.000–1.929× | 0.990–1.007× | 9 → 0 |

Traces: generated clip [before](before-generated.json) / [after](after-generated.json); stripped movie [before](before-movie.json) / [after](after-movie.json). No backward steps were measured after the change. Measurements used Chrome 152.0.7977.83, an isolated headless window at 1920 × 1080, and muted device output. Single-video runs mostly refreshed at 60 Hz; two-video runs refreshed at 30 Hz. Even spacing is improved within that cadence; these numbers are not a guarantee of a particular browser refresh rate or immunity to long main-thread stalls. No movie bytes, pictures or audio samples are retained.

The original before-probe summaries filtered out intervals over 25 ms and therefore omitted the paired runs' speed percentiles. `comparison.json` recomputes both sides from the retained samples using the same wider interval range; it does not substitute another baseline run.

The after traces precede the final delayed-refresh guard. That guard does not run within the reported 5–50 ms intervals; the 500 ms edge case is verified separately by the controlled replay.

## Verification and failed checks

- Four controlled browser regressions failed on the original implementation at the motion-uniformity assertion: [before log](regression-before.txt). They replay native-clock sampling variation with 24/30/60 fps content, 60/120 Hz displays, single/Stack/Grid modes, and 0.5×/1×/2× speeds through the real progress loop. They also check timeline/cursor agreement, stopped-clock limits, completed seeks, exact pause positioning, and absence of CSS jump animations.
- The first corrected-code run passed three cases; the Stack case still inherited a real paused decoder's readiness while its test clock was simulated. The replay now explicitly supplies the healthy readiness it models. The movement assertions are unchanged: [initial after log](regression-initial-after.txt).
- An existing ownership check matched the old spelling of the FPS callback guard. It was updated for the combined completed/running guard and supplemented with a check that completed detection stops requesting callbacks.
- The diagnostic's first attempt timed out because it counted empty slots as loaded assets. Its readiness condition now counts actual loaded media. That attempt produced no usable playback measurement.
- **15 focused browser checks passed**, including source-switch audio continuity, restart at zero/custom in-points, native/Sync/Full wraps, and repeated Stack/Grid handoffs: [focused log](focused.txt).
- The initial full suite passed 213 cases, skipped one, and failed three existing timing-sensitive checks: [initial full log](full-initial.txt). The failures were a counted seek during the Stack switch observation, a native 25% volume sample measured as 36.2% of the reference sample, and an Opus fade sampled before reaching its full level. Three isolated repetitions of those cases produced five passes and four failures: [repeat log](failures-repeated.txt). The Opus failure reproduced in all three repetitions; its recorded envelope had advanced only partway despite the test's 40 ms wall-time sleep.
- Native-audio measurements now wait for 150 ms of actual audio-context progress to fill the analyser at each level. The Opus test waits for the scheduled fade's end on that same audio clock. Both routes must finish loading before they are probed. The original gain, RMS-ratio, mute and continuity assertions remain unchanged.
- The Stack switch's three isolated repeats passed without a product change. Its test now observes a settled window with no pending seek, away from the loop boundary, so startup/loop seeks are not accidentally counted as switch behavior. It still requires zero seeks during the observed swap. This was a test-window weakness, not a demonstrated new switching defect.
- **19 final focused checks passed**, including the strengthened audio checks and delayed-refresh case: [final focused log](focused-final.txt).
- **399 ownership checks passed**: [ownership log](ownership.txt).
- **Final full browser suite: 216 passed, one skipped, no retries**: [final full log](full-final.txt). The existing skip remains unchanged.
- Whitespace validation passed. Retained test logs have terminal color escapes and trailing whitespace removed; results and assertion output are otherwise preserved.

## Reproduction

Start the local app on port 8080. Run browser probes sequentially so they do not compete with the regression suite:

```sh
node tests/investigate-playhead.mjs --clip tests/fixtures/landscape_a.mp4 --out /tmp/playhead-generated.json
node tests/investigate-playhead.mjs --clip ~/Downloads/3ed42143c3ef7772-stripped.mp4 --out /tmp/playhead-movie.json
npx playwright test tests/playhead-clock.spec.ts --workers=1 --retries=0
npx playwright test --workers=1 --retries=0
npm run test:ownership
```

The tests and measurements establish behavior in Chromium. The user's assessment of visible smoothness in their ordinary working browser remains the final practical check; Safari/Firefox and physical high-refresh displays were not measured in this pass.
