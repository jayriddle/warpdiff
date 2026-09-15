# Single-video judder investigation and background audio analysis

Date: 2026-09-15. Local version: 3.17.2.

## What was reported

Picture slowdown and judder during ordinary playback of one FLAC 7.1 video, including after the first 15 seconds. The current reproduction file is `505a7754367fd458-stripped-sync-fixed.mp4`; earlier movie files are not the reproduction target for this report.

**The continuing judder has not been reproduced.** A separate preparation stall was reproduced and fixed. Do not describe this change as a confirmed fix for all of the reported symptoms.

## Source and session checks

- Source: H.264 High, 1724×720, 24000/1001 fps, 8.091417 seconds; FLAC, 48 kHz, eight channels / 7.1, 7.872 seconds. Both streams start at zero. Audio is approximately 219 ms shorter than picture.
- The inspected presentation timestamps are regularly spaced. All 194 decoded frames have different consecutive exact hashes; this does not prove uniform motion in the photographed scene.
- Chrome uses VideoToolbox hardware video decoding and Symphonia FLAC decoding for this file.
- Read the user's open tab without changing playback, loading another file there, or changing its preferences. It was paused with the waveform and spectrogram visible, scopes closed, at device pixel ratio 2 and viewport 1639×1492. The graphs occupied about 422 pixels vertically.
- Isolated tests were silent. A separate, temporary regular-Chrome test used its own local origin and a zero output gain; it did not change the user's comparison. That test was closed after playback stopped. The local helper was bound only to 127.0.0.1.

## What the measurements showed

The first isolated comparison tested native browser playback, native playback through the actual eight-channel listening matrix, WarpDiff playback during preparation, and WarpDiff after preparation. Only the preparation case showed a large stall: spectrogram computation took about 1,212 ms, inside a 1,289 ms main-thread task. A frame-callback gap measured about 1,150 ms.

The first probe accidentally returned a browser quality object directly across the automation boundary; its dropped-frame fields did not serialize. Those first dropped-frame counts are unavailable, not zero. The probe was corrected to copy explicit numeric fields before subsequent measurements.

Subsequent isolated runs matched the user's viewport and pixel density, and separately tested waveform/spectrogram visibility, playback after a scrub, and video scopes. With preparation complete, the first three cases each measured zero dropped frames over 22 seconds. Scopes added measurable rendering load (three dropped frames and 24 long tasks in the sampled run), but scopes were closed in the user's session, so this does not establish their reported cause.

Regular Chrome, using its actual audio output context rather than the headless test browser, also completed two 22-second passes:

| Configuration | Dropped frames | Total frames | Long main-thread tasks | Largest interior frame-callback gap |
| --- | ---: | ---: | ---: | ---: |
| WarpDiff, graphs closed, prepared | 0 | 528 | 0 | 67.1 ms |
| WarpDiff, waveform and spectrogram open, prepared | 0 | 528 | 0 | 66.7 ms |

The context ran at 48 kHz, with reported 5.33 ms base latency and 16 ms output latency. Frame delivery at a roughly 60 Hz display cadence naturally alternates intervals for this 23.976 fps source; these measurements should not be presented as proof of perceptually perfect motion.

The table excludes the first/last 300 ms when summarizing interior cadence. The raw loop-boundary callbacks were also inspected: the waveform-visible regular-Chrome run had approximately 82–83 ms gaps at its two native wraps. There was no second-long loop pause in those measurements; the larger native-wrap interval is retained as a limitation rather than hidden by the interior summary.

The single-video tests found no ongoing application seeks or playback-rate corrections. Opus replacement was inactive; the native output route had eight input channels, and the Continuous scrub processor was inactive during playback. The original clip has not been converted or modified.

### Controlled preparation comparison

An initial follow-up control finished foreground analysis before its play command arrived. It therefore measured steady playback, not preparation, and was not used to claim an improvement. The final probe explicitly released analysis 100 ms after the first playback-frame callback in both arms:

| Analysis during playback, 18-second run | Longest main-thread task | Largest interior frame-callback gap | Recorded frame callbacks | Browser dropped-frame counter |
| --- | ---: | ---: | ---: | ---: |
| Previous foreground computation | 1,227 ms | 1,216.6 ms | 400 | 31 |
| Background worker | No task ≥50 ms | 66.7 ms | 430 | 18 |

This establishes removal of the long page blockage. A frame-callback gap is not the same as proving the native video compositor froze for that whole interval: callbacks can be coalesced while the page is busy. The cold-start browser drop counter also remained nonzero with the worker, despite consecutive presentation-callback counts. Do not claim completely drop-free startup or that the recurring judder is resolved. Prepared playback remained free of reported drops in the waveform-visible test.

Compact measurements, including intermediate runs and their limitations, are retained in [video-stutter-2026-09-15-measurements.json](video-stutter-2026-09-15-measurements.json).

## Implemented change

`js/audio-analysis.js` owns a serialized, cancellable job queue for video and audio-only analysis. Each job runs the existing waveform, spectrogram, and loudness primitives in `js/audio-analysis-worker.js`, which imports `audio-viz.js`. There is no separate or reduced-quality numerical implementation.

Only the active job gets a temporary PCM copy. Acknowledged transfers of at most 1 MiB keep the copy work bounded and let the page handle input and animation between slices. The original PCM is never transferred, detached, downmixed, or resampled for analysis. All eight channels still reach loudness analysis; waveform/spectrogram channel presentation follows the existing algorithms. Results transfer back and the worker terminates, releasing its PCM and analysis scratch.

Clearing media terminates active work and discards queued work. Generation checks fence both preparation and publication so old files cannot overwrite a newer comparison. If workers cannot load, the original foreground implementation remains available.

### Tradeoffs and limits

- Background computation adds a temporary original-sized PCM copy for one active job. This is additional to original decoded audio, analysis scratch, graph outputs, and scrub-preview memory budgets.
- The work still consumes CPU and takes time. Graphs, loudness values and Continuous preparation can finish after playback becomes available.
- Foreground fallback retains the previous blocking behavior on hosts that prohibit workers.
- This change addresses the measured preparation stall. Continuing judder after readiness remains an open reproduction question. The requested next observation is whether it occurs at the same source moments on every loop or at different moments on different passes.
- No playback clock, loop policy, drift threshold, audio mix, scrub DSP, or source encoding was changed.

## Validation

- Focused browser checks: exact equality for all waveform values, every spectrogram bin and all loudness results on eight-channel source PCM; source samples remain unchanged; animation callbacks continue during worker computation.
- Cancellation checks: clear, superseding work, queued cancellation, one-worker concurrency, and subsequent successful jobs.
- Compatibility check: aborting worker loading still produces the original analysis result.
- Current ownership checks: 423 passed, zero failed.
- Final full browser suite: **242 passed, one existing timestamp-toast skip, zero failures**, two workers and retries disabled (1.8 minutes).
- Script syntax and `git diff --check` pass. The temporary regular-Chrome test tab and its 127.0.0.1 helper server were closed.

The first full browser suite completed with 239 passes, three failures and one existing skipped test. Two failures were assumptions about synchronous analysis: a decode-generation test mocked the old calculation functions, and a timeline-placement test read waveform width when only container metadata was ready. The first now mocks the asynchronous analysis boundary (real worker correctness is tested separately); the second waits for its graph aggregate before checking exact timeline geometry. A Solo transport check read 0.097908 seconds after a fixed 300 ms delay against a >0.1-second assertion; it now waits for playback progress while preserving the participant assertions. All seven focused checks, including these three and the four new worker checks, then passed.

The next four-browser full run had 241 passes, one failure and one skip. The existing Stack drift-lock timing check measured a 56.13 ms mean drift against its unchanged 21 ms limit. It subsequently passed five consecutive isolated runs. This same check had shown load sensitivity during the preceding source-format task. The final full run passed using two test browsers; no synchronization threshold or drift-test assertion was relaxed for this change.

Reproduction command, using a local file supplied by the reviewer:

```sh
node tests/investigate-video-stutter.mjs --clip /path/to/clip.mp4 \
  --seconds 20 --arms app-cold-sync,app-cold,app-viz --out /tmp/warpdiff-stutter.json
```

`app-cold-sync` deliberately uses the previous foreground calculation as a control; `app-cold` uses the worker. Both defer the start of analysis until playback is underway to make the preparation comparison reproducible. The probe retains timing and decoder diagnostics, not movie frames or audio PCM. Run playback measurements separately from the test suite so competing browsers do not distort frame timing.

## Diagnostic corrections retained

The first one-off regular-Chrome harness constructed a File in its parent page and passed it into the app iframe. The app's File check did not recognize that different-realm object, so this failed preparation with an unknown-container warning. Constructing the File in the iframe's own realm fixed the diagnostic; the failed run supplied no playback measurements. Normal file-input loading was unaffected.

## Delivery

Local checkpoint on `codex/shared-scrub`, version 3.17.2, with the new runtime files included in the offline cache. Push and deployment remain held. The user's existing loaded comparison was not reloaded; reloading the local app when convenient picks up this version.
