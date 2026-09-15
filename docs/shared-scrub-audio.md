# Shared scrub audio

WarpDiff 3.16.0 uses **Continuous** as its standard drag preview. Pitch stays steady as drag speed and direction change. Clicks still audition short previews, and holding still fades audio out. The old mode selector and preference have been retired. Original analysis and normal playback remain independent of preview processing.

## Components

- `js/scrub-audio.js`: WarpDiff adapter, current snippet engine, gesture clock, selected source, memory policy, fallback notice, and cleanup calls.
- `js/scrub-audio-core.js`: app-independent `WarpScrubAudio` factory. Owns continuous preparation, stream lifetime, gain envelopes, timing helpers, and shared surround coefficients. Each instance has a read-only state view.
- `js/scrub-worklet.js`: the canonical pitch-preserving processor from WarpSonic.
- `js/audio-routing.js`: existing listening graph uses the shared surround coefficients. Analysis receives original decoded channels.

The canonical sources are WarpCap's `shared/media/scrub-audio.js` and `audio/wsola-worklet.js`; its `docs/shared-scrub-audio.md` defines the complete contract. Copies here are pinned by commit and SHA-256 in [SCRUB_AUDIO_LOCK.json](../js/SCRUB_AUDIO_LOCK.json). Both apps consume the same implementation with independent stream instances.

## Updating the component

```sh
node scripts/vendor-scrub-audio.mjs --repo ../WarpCap --ref <canonical-commit>
node scripts/vendor-scrub-audio.mjs --check --repo ../WarpCap
```

During development, explicitly use `--worktree` instead of `--ref`; it records the reconstruction limit in the lock. Repin to a committed canonical revision for the final checkpoint. `--check` without a neighboring repository verifies the pinned local files. The ownership harness also checks neighboring canonical files when present. Keep the controller and worklet in `sw.js` assets, so installed offline copies can load continuous audio. This procedure does not update WarpCap's bundled WarpDiff or deploy anything.

## Adapter contract

Create one instance with `{workletUrl, maxBufferBytes, onError}`. `load(context, listeningBuffer)` prepares without starting sound. Video decode analysis completes before `_prepareVideoScrubBuffer` prepares its separate mono/stereo listening copy at the audio device rate. Same-rate mono/stereo is reused; surround is folded directly from the original decode. No 22.05 kHz intermediate remains in the normal path. The adapter passes current source-relative `offset`, positive `tempo`, signed `direction`, `continuous`, optional presented-frame `limitOffset`, and listening `level` to `update`. `stop` fades and retains the selected buffer; `reset` cancels stale publication and releases it; `dispose` permanently closes the instance. Never resume a gesture from an asynchronous load callback.

WarpDiff keeps one continuous stream for the selected audio source. A single video follows confirmed picture time; multi-video Grid/audio-only retain the shared pointer clock. Real audio-start silence is preserved. Clicks audition a snippet. A failed continuous load reports the fallback and keeps snippet audition available. 7.1 dialogue is folded to stereo before spectral processing, using the same policy as native/scrub listening; original PCM remains intact.

`state.bytes` reports retained listening PCM and `state.retiringBytes` the short outgoing fade. These are not total memory: source analysis, transient rendering, processor scratch, and video caches have separate owners. Continuous preview may soften transients; normal playback remains the reference for defect inspection.

## Preview memory policy

- `_SCRUB_PREVIEW_MAX_BYTES` is 64 MiB. `_scrubPreviewPlan` applies it to each of up to four video listening copies; the selected shared engine applies a separate limit of the same size before preparing or transferring its context-rate PCM. At 48 kHz this accommodates about 175 seconds of stereo per copy, twice that for mono.
- If full-rate video PCM exceeds the limit, preparation selects the highest fitting rate among 22,050, 16,000, 11,025 and 8,000 Hz. Continuous still checks its required device-rate size and falls back to short previews with a notice. If none fits, preview is unavailable with a notice while original graphs, metrics and normal playback remain available.
- Rate reduction uses a centered Blackman-windowed sinc filter, 16 source-scaled lobes per side and 1,024 fractional phases. It removes out-of-band frequencies before reducing the sample rate, preserves channel phase, and keeps sample-zero timing. It processes bounded slices with cancellation checks and yields between them. No full-rate intermediate listening copy is allocated for this fallback.
- `_prepareVideoScrubBuffer` serializes preparation across slots, skipping obsolete requests before allocation and fencing publication after preparation. `_finalizeAudioViz` awaits preparation; clear/replacement generations prevent stale buffers returning. Both visualization views reuse original analysis aggregates.
- Audio-only original buffers and Chrome Opus replacement buffers retain their existing owners. Source decoding, original analysis, temporary rendering, processor scratch, video/GPU caches and brief outgoing fades are outside the retained-preview budget. This is not a total browser-memory cap.

## Checks

Run both existing suites, including `tests/continuous-scrub.spec.ts` and `tests/full-rate-scrub.spec.ts`. For a real local clip:

```sh
node tests/investigate-shared-scrub.mjs --clip /path/to/movie.mp4 --out /tmp/scrub.json
```

The probe compares pointer gestures, clock cadence, selected-stream PCM, and isolated Chrome process CPU. It does not save movie frames or audio, and cannot establish listening preference. WarpCap’s bundled WarpDiff update and deployment remain held. The user preferred the prior Continuous preview; full-rate listening acceptance is the next manual check.
