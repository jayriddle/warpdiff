# Shared scrub audio

WarpDiff 3.15.0 offers **Scrub: Snippets / Continuous** beside volume. Snippets remains the default and click fallback. Continuous preserves pitch while following drag speed and direction; holding still stops audition. The mode affects listening preview, with original analysis inputs and normal playback preserved.

## Components

- `js/scrub-audio.js`: WarpDiff adapter, current snippet engine, gesture clock, selected source, mode preference, and cleanup calls.
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

Create one instance with `{workletUrl, onError}`. `load(context, originalBuffer)` prepares without starting sound. The adapter passes current source-relative `offset`, positive `tempo`, signed `direction`, `continuous`, optional presented-frame `limitOffset`, and listening `level` to `update`. `stop` fades and retains the selected buffer; `reset` cancels stale publication and releases it; `dispose` permanently closes the instance. Never resume a gesture from an asynchronous load callback.

WarpDiff keeps one continuous stream for the selected audio source. A single video follows confirmed picture time; multi-video Grid/audio-only retain the shared pointer clock. Real audio-start silence is preserved. Clicks audition a snippet. A failed continuous load reports the fallback and keeps snippet audition available. 7.1 dialogue is folded to stereo before spectral processing, using the same policy as native/scrub listening; original PCM remains intact.

`state.bytes` reports retained listening PCM and `state.retiringBytes` the short outgoing fade. These are not total memory: source analysis, transient rendering, processor scratch, and video caches have separate owners. Continuous preview may soften transients, so its default remains subject to listening comparison.

## Checks

Run both existing suites and `tests/continuous-scrub.spec.ts`. For a real local clip:

```sh
node tests/investigate-shared-scrub.mjs --clip /path/to/movie.mp4 --out /tmp/scrub.json
```

The probe compares pointer gestures, clock cadence, selected-stream PCM, and isolated Chrome process CPU. It does not save movie frames or audio, and cannot establish listening preference. WarpCap integration remains held until this optional mode is evaluated.
