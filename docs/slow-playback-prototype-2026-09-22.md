# Signalsmith slow-playback prototype

## Decision and scope

On September 22, Jay reported that both D (Rubber Band R3) and E (Signalsmith Stretch) were much better than the previous half-speed attempts, and preferred E. That is the listening acceptance for the saved six-second passage. It does not by itself establish live transport quality.

A local opt-in prototype now uses E's **Signalsmith Stretch Web 1.3.2 default processor** during slow native-media playback. Open `http://localhost:8080/?slowAudio=signalsmith`, load a file, and use J twice for 0.5×. Existing controls remain in place. The regular URL and deployed application retain their released behavior. The experiment only enables on localhost/loopback; no persisted preference, release bump, push, or deployment is part of this checkpoint.

## Implementation and ownership

- `js/slow-playback.js` adapts the selected source to the shared engine. The existing native audio routing owner still controls mute and source-switch gain. Separate native/processed branches feed that same output.
- The media element remains the transport clock. The processor never seeks video or changes its speed. A scheduled handoff allows 120 ms of processor preparation plus a 30 ms margin while native playback continues; a 15 ms gain transition completes the handoff. Audio-device queue lead is accounted for separately.
- Speed changes, seek, restart, waiting, pause, loop, and selection events revalidate the selected stream. A 250 ms check detects clock divergence over 60 ms. It can re-anchor audio but never writes media time.
- Full Mix, Dialogue Focus, and Center Only use the existing monitoring policy. Retained raw center is combined with Full Mix before stretching. Original channels, analysis, metadata, and source files are unchanged.
- The reusable controller and processor live canonically in WarpCap, pinned here with `js/PLAYBACK_AUDIO_LOCK.json` and `scripts/vendor-playback-audio.mjs`. Existing Continuous scrubbing and its pin are independent. WarpCap's bundled WarpDiff and runtime are not refreshed.
- Only one selected listening processor owns PCM at a time. Switching between scrub and slow playback retires the prior processor. Each upload is acknowledged and no larger than 1 MiB; the selected processor has a 64 MiB PCM cap. Clear waits for terminal retirement before closing the captured audio context.

## Findings and fixes

The upstream wrapper's `dropBuffers()` releases samples but keeps its processor active. The generated wrapper adds a disposal message, releases its references, acknowledges the terminal render, and returns `false`. Cancellation before WASM initialization also prevents late resurrection.

The upstream chunk reader did not advance its source cursor correctly across buffer boundaries. The generated wrapper fixes both cursor advances. Tests use a nonstationary source and prove that the historical wrapper fails the sample oracle. A real AudioWorklet render then compares chunked and one-buffer output. The embedded WASM/DSP, default preset, and pitch setting remain those used for E.

## Verification record

Environment: macOS, Node 26.4.0, system Chrome 153, isolated muted headless browser, local static server. The user's browser was not controlled.

Focused tests exercise pitch and center isolation, unchanged original metrics, selected-stream budget, pause/seek/restart/speed/source changes, scrub handoff, chunk continuity, early cancellation, invalid/missing resources, negative source offsets, and repeated clear. A known 200 ms tone at source 1.0–1.2 s with a 166 ms leading edit checks its stretched energy center against the expected 3.032 s output timestamp (40 ms tolerance).

The real-file probe uses `505a7754367fd458-stripped-sync-fixed.mp4` (H.264, 48 kHz 7.1 FLAC), SHA-256 `6bf18b8641ba9327920339c275ed3e8804806c864d71bdbf65d2e2729de8c735`. In a 20-second half-speed run including a natural loop:

| Measurement | Result |
| --- | ---: |
| Recorded observations | 392 |
| Observations using the processed branch exclusively | 386 |
| Modeled audio/media clock difference, 95th percentile | 25.5 ms |
| Modeled audio/media clock difference, maximum | 27.1 ms |
| Scheduled audio anchors, including startup and loop | 3 |
| Maximum selected processor PCM | 4,534,272 bytes |
| Nonfinite audio samples / page errors | 0 / 0 |
| Sample peak | 0.235 (below full scale) |
| Retained processor PCM after clear | 0 bytes |

The timing result compares the scheduled audio map and the browser's output timestamp against media time. It is **not** a microphone/display measurement of physical lip sync. The buffer count is selected processor PCM, not total tab memory or proof of zero browser-native leaks. Detailed local trace: `/Users/jay/Documents/warpdiff-audio-check-2026-09-20/live-prototype-2026-09-22.json` (no source audio included).

Initial failed checks are retained here: the new test initially waited for all four available slot names rather than loaded slots, attempted non-existent standalone speed functions, selected an empty slot, and mistook the fixture's 750 Hz right-front tone for a lowered center pitch. Those were corrected against the existing slot registry, keyboard actions, and fixture channel frequencies. A later center-isolation check sampled before both the processor history and analyser window had cleared; its wait now covers both. The patch generator also correctly rejected an ambiguous first message-handler anchor; the anchor was made unique.

The first full regression run passed 256 tests with one existing skip; the new clear check read the state during its intentional 20 ms outgoing fade. That check now awaits both active and retiring bytes together, matching the awaitable teardown contract. This was a test-observation race, not unreleased PCM after retirement. Final focused results and checkpoint revisions are recorded below.

All six focused checks subsequently passed, including master volume/mute. An additional review found a handoff race: a transport event during the outgoing fade could treat the old ready processor as the newly selected one. The adapter now tracks whether the selected branch is connected before acting on ready state. An isolated browser injection restoring the old logic fails the handoff test (native gain remains 1); the corrected version reaches exclusive processed playback. The injection never edits the live served file or user browser.

### Final checkpoint

- **257 browser tests passed, 1 existing skip**, with retries disabled. Every test had reported its result when one Node/Playwright worker stalled in shutdown (no test browser processes remained). SIGTERM did not stop it; stopping that isolated worker with SIGKILL allowed the parent runner to print the summary and exit 0. This is not an uninterrupted runner exit; the shutdown anomaly is retained as a verification limitation. The earlier focused run exited normally with all six new tests passing.
- **430 ownership/pure-logic checks passed**, including the new controller/processor/license pin and neighboring canonical byte comparisons.
- Canonical WarpCap **1206 logic checks passed**, CI passed, wrapper historical-negative controls passed, and the tracked audit manifest/checksums passed.
- Canonical component checkpoint: `087e64f4ae14c861829bc31d69daba3699535505` (component 0.1.0). WarpDiff's playback lock uses that committed revision with `workingTree: false`. Existing scrub pin remains 1.2.1.
- Default release remains **3.17.5**. This localhost experiment has no release-version/changelog bump and has not been pushed or deployed. WarpCap's bundled surface is unchanged.

The final full-suite log is retained locally at `/Users/jay/Documents/warpdiff-audio-check-2026-09-20/regression-final-2026-09-22.txt`; a compact result and hashes are retained with this work log in `slow-playback-verification-2026-09-22.json`.

## Limits before promotion

- Live listening/physical lip sync still need Jay's confirmation with this URL. The accepted E recording used a fixed +0.8 dB audition gain to match loudness; the integration uses the existing listening gains, without a clip-specific boost.
- This first adapter covers native-media slow playback with full device-rate mono/stereo or prepared stereo-plus-center. Chrome Opus replacement keeps its existing owner. Original multichannel audio-only buffers and reduced-rate/oversized listening copies fall back to browser playback with a notice when preparation is attempted. Opus is excluded from this prototype rather than silently replacing its timing engine.
- Normal-speed and faster playback use the existing path. Continuous drag scrubbing is unchanged. Each transition may briefly use native slow playback while the processor prepares.
- The same 64 MiB selected-stream limit means long-file streaming is a separate design step. Processor scratch, source buffers, video caches, and analysis have separate memory owners.
- This is a bounded prototype, not a release declaration or a promise that every clip will be artifact-free. Firefox/Safari and physical device latency have not been validated here.

## Reproduction

```sh
node scripts/vendor-playback-audio.mjs --check --repo ../WarpCap
node scripts/check-slow-playback.mjs /path/to/clip.mp4 /path/to/local-trace.json 20
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test tests/slow-playback.spec.ts --workers=1 --retries=0
npm run test:ownership
```

Private media and prior audition WAV files remain outside both repositories. The first investigation and D/E comparison are preserved in `half-speed-audio-investigation-2026-09-18.md` and `half-speed-audio-reference-2026-09-20.md`.

## Later listening feedback: harsh center-channel passage

Jay subsequently reported harshness in a different 7.1 FLAC clip, `de3f59c8de544e18.mp4`, around 2.775 s, especially with Center Only at +11 dB. An isolated reproduction found no digital overload or transport correction at that passage; perceived cause and an improvement remain unconfirmed. The [follow-up investigation](slow-playback-harshness-2026-09-22.md) records the exact settings, offline/live captures, true-peak checks, algorithm tradeoffs, and next comparison. This feedback does not establish acceptance of the prototype across clips. Playback implementation remains unchanged by the follow-up.
