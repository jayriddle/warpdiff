# Restart after scrubbing: playback preparation

Date: 2026-09-15. WarpDiff 3.17.4. Baseline: `835ff5f` (3.17.3).

## Scope and finding

This implements the first follow-up from the memory investigation: make Play and `R` share playback preparation, then verify scrub → restart → looping. Push, deployment, and refreshing WarpCap's bundled WarpDiff remain held.

Scrubbing temporarily sets the participating native videos' `loop` flags to false. It also retains the WebCodecs video decoder and decoded-frame cache for responsive subsequent drags. Play restored the loop policy and suspended those retained decoders. Restart skipped both steps. After a paused scrub, `R` could therefore play once and stop at the end, while leaving an idle scrub decoder configured during native playback.

The regression was reproduced before changing the transport: the Space test passed, while the three restart tests failed on the missing native loop or unsuspended decoders. This is independent of the prior scrub-audio memory leak fix.

## Change and rationale

[`_preparePlaybackStart`](../js/transport.js) is now the shared preparation owner for Play and Restart. It:

1. Clears the frame-step cursor, invalidates older pending play requests, and releases the scrub-at-end hold.
2. Checks the current Solo loop. If its in-point is beyond the selected clip's end, it retains the existing paused final-frame hold and explanation.
3. Clears a valid Solo held position and enables the existing transport synchronization guard.
4. Suspends retained scrub decoders when no drag is active. The session, source bytes, demuxed samples, and frame cache remain available.
5. Restores the existing native-loop policy and pauses media outside the active playback scope.
6. Returns the participants and current play-request generation to the command.

Play starts from the current position. Restart first seeks each participant to the loop in-point or beginning, with the existing per-clip clamp, then starts playback. Restart retains its immediate playhead reset and existing Opus audio startup owner.

This moves the existing preparation into one function rather than adding another copy to Restart. It does not call Play after Restart has already issued play requests: doing so would invalidate those requests and could cause their delayed completion handlers to pause media.

No audio sample processing, listening mix, analysis calculation, playback-rate correction, or frame-cache budget changed. Source media were not modified. The shared scrub-audio component remains pinned to 1.2.1.

## Regression checks

[`tests/restart-playback.spec.ts`](../tests/restart-playback.spec.ts) uses real pointer drags and native video playback:

- Space and `R` each restore native looping after a paused single-video scrub. Presented frames cross the end twice, playback remains active, and `R` begins near the head.
- A Grid comparison restarts at its custom in-point and wraps both videos through that region, with native looping disabled as required by the managed loop.
- Solo restarts and loops only the selected video. All retained scrub decoders are suspended, including the inactive slot's decoder.
- Session identity and frame-cache counts/bytes/hits match before and after starting playback. A subsequent scrub reuses cached frames.

The existing invalid-Solo-loop test now checks both Space and `R`; neither may play a loop that starts beyond the clip's end.

Ownership guards require both commands to enter shared preparation exactly once, preserve scoped participants, and delegate scrub/loop setup to that owner. A mutation check restored only the old Restart implementation in an isolated harness copy: the shared-preparation and frame-cursor guards rejected it. The served application was not modified for that check.

## Verification record

| Check | Result |
| --- | --- |
| New browser regressions against the old transport | 1 passed, 3 failed as expected |
| Same focused regressions after the fix | 4 passed, no retries |
| Ownership and pure-logic suite | 428 passed |
| Restore old Restart in an isolated ownership harness | 2 failures as expected |
| Full browser suite | 248 passed, 1 existing skipped test, no retries (2.2 minutes) |
| Supplied eight-channel FLAC/H.264 clip | Old transport stopped at the end; repaired transport completed two wraps and remained playing |

Commands for repeatable automated checks:

```sh
npx playwright test tests/restart-playback.spec.ts --retries=0 --workers=1
npm run test:ownership
npx playwright test --retries=0 --workers=2
```

Browser checks use muted headless sessions and do not reload or operate the user's comparison. The full suite retains the existing timing thresholds.

The existing skipped test is the timestamp-collision warning, which requires fixtures with near-identical modification times. No new tests are skipped.

## Supplied clip: before and after

The check used `505a7754367fd458-stripped-sync-fixed.mp4`: H.264, 1724×720, 24000/1001 fps, with 48 kHz eight-channel FLAC. Its duration is 8.091417 seconds. A source hash before and after the check confirms the file was unchanged.

Both runs used isolated, muted Chrome 152.0.7977.83 at 1639×1492 with device pixel ratio 2 and service workers blocked. The baseline run substituted only `js/transport.js` from `835ff5f` through that test page's request routing. The second run used the current file. The user's tab and served runtime files were not changed for the substitution.

Each run loaded the clip, waited for audio preparation, opened the waveform panel, dragged the timeline forward/backward to 65%, released while paused, then pressed `R` once. The baseline was observed through the natural end. The repaired run was observed through two actual presented-frame wraps (about 16.2 seconds).

| Observation | Old transport | Shared preparation |
| --- | --- | --- |
| Position immediately after `R` | 0.000 s | 0.000 s |
| Native loop after `R` | Disabled | Enabled |
| Retained scrub session after `R` | Decoder still configured | Decoder suspended |
| Playback at natural end | Stopped at 8.091417 s | Wrapped twice and remained playing |
| Cached frames across restart/playback | 73, unchanged | 73, unchanged |
| Cache storage | 199,961,600 bytes | 199,961,600 bytes |
| Session identity across restart | Preserved | Preserved |
| Continuous scrub audio during playback | Inactive | Inactive |
| Browser page errors | None | None |

Chrome reported zero dropped frames in both runs. The measured improvement here is correct looping and decoder suspension; these counters do not demonstrate a subjective smoothness improvement. The retained cache is intentional storage for future scrubs and remains subject to the existing memory budget and clear lifecycle.

The [measurement record](restart-playback-2026-09-15-measurements.json) contains the source/transport hashes, browser version, media metadata, and before/after counters. It contains no movie frames or audio samples.

## Limits

This fixes a reproducible restart/setup gap. Suspending idle video decoders avoids carrying them into native playback, but it does not establish that every previously reported instance of picture judder is resolved. Subjective smoothness in the user's normal review session remains a separate validation step.

README, FEATURES, MANUAL, the in-app manual, What's New, and service-worker version have been updated for 3.17.4.
