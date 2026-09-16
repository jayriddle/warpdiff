# Shared scrub audio

WarpDiff 3.17.0 uses **Continuous** as its standard drag preview. Pitch stays steady as drag speed and direction change. Clicks still audition short previews, and holding still fades audio out. The old mode selector and preference have been retired. Original analysis and normal playback remain independent of preview processing.

## Components

- `js/scrub-audio.js`: WarpDiff adapter, current snippet engine, gesture clock, selected source, memory policy, fallback notice, and cleanup calls.
- `js/scrub-audio-core.js`: app-independent `WarpScrubAudio` factory. Owns continuous preparation, stream lifetime, gain envelopes, timing helpers, and shared surround coefficients. Each instance has a read-only state view.
- `js/scrub-worklet.js`: the canonical pitch-preserving processor from WarpSonic.
- `js/audio-routing.js`: existing listening graph uses the shared surround coefficients. Analysis receives original decoded channels.

The canonical sources are WarpCap's `shared/media/scrub-audio.js` and `audio/wsola-worklet.js`; its `docs/shared-scrub-audio.md` defines the complete contract. Copies here are pinned by commit and SHA-256 in [SCRUB_AUDIO_LOCK.json](../js/SCRUB_AUDIO_LOCK.json). Both apps consume the same implementation with independent stream instances. Version 1.2.1 makes reset/disposal awaitable: WarpDiff clears state immediately, then lets the old processor finish its terminal render before closing that captured audio context. Original PCM and playback processing are unchanged. See the [memory investigation](memory-leak-2026-09-15.md).

## Updating the component

```sh
node scripts/vendor-scrub-audio.mjs --repo ../WarpCap --ref <canonical-commit>
node scripts/vendor-scrub-audio.mjs --check --repo ../WarpCap
```

During development, explicitly use `--worktree` instead of `--ref`; it records the reconstruction limit in the lock. Repin to a committed canonical revision for the final checkpoint. `--check` without a neighboring repository verifies the pinned local files. The ownership harness also checks neighboring canonical files when present. Keep the controller and worklet in `sw.js` assets, so installed offline copies can load continuous audio. This procedure does not update WarpCap's bundled WarpDiff or deploy anything.

## Adapter contract

Create one instance with `{workletUrl, maxBufferBytes, onError}`. `load(context, listeningBuffer)` prepares without starting sound. Video decode analysis completes before `_prepareVideoScrubBuffer` prepares its separate listening copy at the audio device rate: mono/stereo, or Full Mix L/R plus raw center for verified surround. Same-rate mono/stereo is reused; surround is folded directly from the original decode. No 22.05 kHz intermediate remains in the normal path. The adapter passes current source-relative `offset`, positive `tempo`, signed `direction`, `continuous`, optional presented-frame `limitOffset`, and listening `level` to `update`. `stop` fades and retains the selected buffer; `reset` cancels stale publication and releases it; `dispose` permanently closes the instance. Never resume a gesture from an asynchronous load callback.

WarpDiff keeps one continuous stream for the selected audio source. A single video follows confirmed picture time; multi-video Grid/audio-only retain the shared pointer clock. Real audio-start silence is preserved. Clicks audition a snippet. A failed continuous load reports the fallback and keeps snippet audition available. Surround is folded to stereo before spectral processing with an optional retained center, using the same policy as native/scrub listening; original PCM remains intact.

`state.bytes` reports retained listening PCM and `state.retiringBytes` the short outgoing fade. These are not total memory: source analysis, transient rendering, processor scratch, and video caches have separate owners. Continuous preview may soften transients; normal playback remains the reference for defect inspection.

## Preview memory policy

- `_SCRUB_PREVIEW_MAX_BYTES` is 64 MiB. `_scrubPreviewPlan` applies it to each of up to four video listening copies; the selected shared engine applies a separate limit of the same size before preparing or transferring its context-rate PCM. At 48 kHz this accommodates about 175 seconds of stereo per copy, twice that for mono, or 116 seconds with the retained center.
- If full-rate video PCM exceeds the limit, preparation selects the highest fitting rate among 22,050, 16,000, 11,025 and 8,000 Hz. Continuous still checks its required device-rate size and falls back to short previews with a notice. If none fits, preview is unavailable with a notice while original graphs, metrics and normal playback remain available.
- Rate reduction uses a centered Blackman-windowed sinc filter, 16 source-scaled lobes per side and 1,024 fractional phases. It removes out-of-band frequencies before reducing the sample rate, preserves channel phase, and keeps sample-zero timing. It processes bounded slices with cancellation checks and yields between them. No full-rate intermediate listening copy is allocated for this fallback.
- `_prepareVideoScrubBuffer` serializes preparation across slots, skipping obsolete requests before allocation and fencing publication after preparation. `_finalizeAudioViz` awaits preparation; clear/replacement generations prevent stale buffers returning. Both visualization views reuse original analysis aggregates.
- Audio-only original buffers and Chrome Opus replacement buffers retain their existing owners. Source decoding, original analysis, temporary rendering, processor scratch, video/GPU caches and brief outgoing fades are outside the retained-preview budget. This is not a total browser-memory cap.

## Checks

Run both existing suites, including `tests/continuous-scrub.spec.ts` and `tests/full-rate-scrub.spec.ts`. For a real local clip:

```sh
node tests/investigate-shared-scrub.mjs --clip /path/to/movie.mp4 --out /tmp/scrub.json
```

The probe compares pointer gestures, clock cadence, selected-stream PCM, and isolated Chrome process CPU. It does not save movie frames or audio, and cannot establish listening preference. WarpCap’s bundled WarpDiff update and deployment remain held. The user preferred Continuous. Dialogue controls still require listening acceptance on real voices at changing drag speeds.


## Dialogue listening (component 1.2.0)

`js/audio-monitor.js` owns comparison-scoped settings and the Listen popover. `WarpScrubAudio.monitor` owns normalization of settings, channel coefficients, source peak bounds, native graph ramps, and codec-layout helpers. Every native, replacement and short-preview output resolves the same per-slot plan. The selected continuous instance receives that plan through `setMonitorMix(plan)`.

A verified surround `load(ctx, buffer, layout)` uses `layout` equal to `5.1`, `7.1`, or `stereo-center`. The last value is an internal three-channel representation: Full Mix left, Full Mix right, and raw center. These are listening components, not three speaker channels. `listeningBuffer(buffer, ctx, current, layout)` produces this representation and `listeningBytes(buffer, rate, layout)` accounts for all three. Ordinary mono/stereo callers omit layout and retain their existing behavior.

The processor mixes the retained center into Mid before spectral processing; other-channel gain also controls Side. New settings neither reload PCM nor seek. Restoring previously silent bands re-aligns their phase within the existing Hann overlap, avoiding panned-channel cancellation after Center Only. Normal WarpSonic callers retain their existing full-stereo preparation and optional stereo Center Focus; its UI is unchanged in this checkpoint. The new API is available to that surface without a host dependency.

Center controls require codec/container evidence agreeing with the decoded channel count. The MP4 metadata path recognizes FLAC STREAMINFO and optional standard masks, AAC's declared 5.1 configuration, and valid Opus family-1 surround declarations. Custom `chan` descriptions, ambiguous multiple audio tracks and unrecognized layouts remain Full Mix. Audio-only FLAC and WAVE extensible masks use the same verification policy. This is a limited allowlist, not a general channel-layout parser.

`monitor.peaks` measures the center and the remaining stereo contribution without changing samples. Focused mixes use a conservative sum of those peaks to reserve headroom; Full Mix preserves existing gain. This protects the input mix, not every possible peak after time stretching. It is neither loudness normalization nor a brick-wall output limiter.

Three-component Float32 PCM costs 576,000 bytes/second at 48 kHz: approximately 116 seconds within 64 MiB, versus 175 seconds for stereo. Video and selected-stream limits remain independent. Long surround files may fall back sooner. Original analysis aggregates, audio-only original buffers and replacement-playback originals retain their previous owners. No task answers or annotation payloads acquire listening preferences. Clearing resets the comparison to Full Mix.

MP4 Opus dOps is converted to the identification header WebCodecs requires, including the multistream mapping. The decoder-only copy clears pre-skip because the existing post-decode owner applies priming and edit-list trimming once. Audio-only display and lazy W-panel decode both read the same verified WAVE/FLAC layout so completion order cannot disable the listening controls.
