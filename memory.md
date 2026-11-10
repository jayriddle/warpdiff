# WarpDiff Memory Management

## Architecture & Loading
- **App files**: `index.html` is about 15,000 lines and still holds the HTML, CSS, and most of the JS. The page also loads classic scripts from `js/` (not ES modules), including `wipe.js`, `scrub-video.js`, `transport.js`, and `audio-analysis.js`. They share one global scope with the inline script. No bundling.
- **Asset loading**: Use `URL.createObjectURL(file)` for images/videos (not `FileReader` or base64) to avoid heap inflation and unnecessary memory copies. Revoke URLs when assets are unloaded.
- **PWA/Service Worker**: `CACHE_NAME` in `sw.js` stays synced to `APP_VERSION`. A published install pins each runtime file to that release's cache. The document revalidates online and falls back to the cached copy; unstaged local development revalidates scripts and then updates the cache. Offline use starts after a complete bundle is stored.

## Audio Memory Optimizations

- **Await processor retirement before context close**: `_resetContinuousScrub()` clears state immediately and returns the shared engine's retirement promise, including earlier audible fades. `clearAllMedia()` detaches the old context immediately, disconnects its routes, resumes it if necessary to drain the terminal render, then closes that captured context after retirement. Never close the new comparison's context from an old completion. The worklet acknowledges disposal from its final `process()` call, which returns false; an acknowledgement in its message handler is too early. The shared controller removes the error handler (which captures source PCM) and closes its message port. A one-second timeout bounds failed/prohibited processor cleanup. A zero diagnostic byte count alone is insufficient: browser tests use WeakRefs and forced collection to check the real objects.
- **Release native media on clear**: pause removed video/audio elements, remove their source, call `load()` to release the decoder, and drop `primaryVideoRef` and the cached pointer event. Revoking a blob URL and removing a container alone can leave the last video's resources reachable.

- **Background analysis**: `js/audio-analysis.js` serializes video and audio-only jobs. Only the active job receives an additional original-sized PCM copy in `js/audio-analysis-worker.js`, sent through acknowledged slices of at most 1 MiB so staging cannot build an unbounded message queue. The source is never transferred or detached. The worker imports the existing `audio-viz.js` algorithms, transfers the finished typed-array aggregates back, and terminates after every job to release its PCM and FFT/K-weighting scratch. This adds transient PCM memory compared with foreground analysis; it is outside the scrub-preview budgets. Pending jobs retain their already-decoded source buffers but have no worker copy. Clearing media cancels the active worker and drops the queue; decode-generation fences prevent stale publication. If workers are unavailable, the original foreground calculation remains the compatibility path.

- **Native audio routing**: `js/audio-routing.js` waits until decode reports a supported channel count; browser mixing stays in charge before that. Ordinary mono and stereo video then stay on the element's own volume (`_nativeDirectOutputs`), so picture and sound share one output. Verified surround, audio-only, Opus replacement, and the slow-playback experiment use one `MediaElementAudioSourceNode` and `GainNode` per element. Inactive graph-routed media keeps its decoder running with zero output gain. `_connectAudioOutput()` delegates to the shared listening matrix without additional PCM copies. Scrub and replacement sources disconnect their matrix nodes when they end. `_clearNativeAudioRoutes()` removes resume listeners, direct-volume timers, and graph nodes before the shared context closes. No additional decoded buffers are retained.
- **Scrub audio**: Original analysis runs before preparing mono/stereo listening PCM, plus raw center for verified surround, at the AudioContext rate. `_scrubPreviewPlan` limits each video copy to 64 MiB; large clips get a filtered lower-rate short-preview copy, or an explained unavailable state if no 8 kHz-or-better copy fits. Chrome Opus retains its existing original buffer for replacement playback. The no-video view shares original analysis aggregates, not graphs recomputed from the listening copy.
- **Scrub cadence**: Pointer activity and displayed-frame position have separate owners. The 50 ms clock renews 90 ms grains during slow motion even at one held frame, using the existing buffer and output matrix; no extra PCM is stored. `stopScrubSnippet()` clears gesture/target state, and each ended source disconnects its output nodes.
- **AudioBuffer management**: `audioFileBuffers[slot]` deleted after decode. Decoded `AudioBuffer` lives in `_audioSlotVizData[slot].audioBuffer`; freed when `_audioSlotVizData = {}` in `clearAllMedia()`.
- **AudioContext lifecycle**: Lazy-created via `getAudioContext()`. `clearAllMedia()` drops the app's reference immediately, resumes a suspended context so the last render can finish, and closes that captured context only after scrub and slow-playback retirement. The next `getAudioContext()` call creates a fresh context.
- **Stale decode guard**: `_audioDecodeGen[slot]` counter incremented before each `decodeAudioData` call; captured in closure; checked before any state write in `.then()`. Prevents a slow decode completing after reload from writing `_audioSlotVizData` against a new batch. Reset to `{}` in `clearAllMedia()`.
- **BPM & viz**: Uses typed arrays (`Float32Array`) for FFT, waveform buckets, spectral flux. Spectrogram palettes precomputed once.

## Video Scopes & Visualization (`js/scopes.js`)

### Encoded scrub-video input

`_createScrubVideoInputBudget` limits encoded scrub inputs to 256 MiB per video
and 512 MiB across pending and retained sessions. Admission uses the original
File.size before fetching. `_readScrubVideoInput` fills one admitted buffer from
a stream, rejecting missing, short, oversized or inconsistent responses.
Cancellation aborts fetches; reservations remain charged until initialization
settles, so an old completion cannot release a newer input's budget. The existing
release/invalidate owner closes both pending and retained sessions; playback
suspension retains its charge. Closing a decoder session also nulls its encoded
byte reference. Unknown/over-budget inputs use native scrubbing, with a notice
once per comparison. No range-read decoder is implemented here.

This is an encoded-input accounting limit, not total memory: blob backing,
stream chunks, demuxed sample tables, decoded-frame caches, audio decoding and
analysis, native video buffers and garbage-collection delays remain additional.
See `docs/media-input-hardening-2026-10-15/README.md` for verification.

- **Cached buffers**: Critical for performance — `_wfmBuf`, `_wfmHits*` (Uint16Array), `_vsHit*` (Float32Array/Uint16Array) reused across *all* frames.
  - Reallocated *only* on canvas resize (`_wfmCachedW/H`, `_vsCachedSize`).
  - Comment: "Cached buffers for waveform monitor — reused across frames to avoid per-frame GC pressure."
- **Histogram**: `Uint32Array(256)` bins per channel; optional CDF with `Float32Array`.
- **Waveform monitor**: Hit counting + `putImageData()` for speed; supports luma, RGB parade, RGB overlay.
- **Vectorscope**: Hit accumulation in typed arrays, graticule/skin-tone overlays drawn on top.
- Offscreen canvas for frame sampling (`sampleVideoFrame()`).

## Decoded scrub-frame cache

`js/scrub-video.js` sizes the decoded-frame cache to the file's longest GOP, from a 96 MB floor to a 192 MB ceiling. As of 3.19.30, a frame at or under a 1280×720 area stays at full source size. A larger frame stays full size when its GOP fits in the 192 MB ceiling; otherwise it scales down just enough to fit, and never softer than a 1280×720 preview or the on-screen pixel size (CSS pixels × devicePixelRatio). A cached bitmap smaller than the current display is a miss. High 4:4:4 AVC can keep full-resolution I420 `VideoFrame`s. Opaque, resized, and other-codec output uses `ImageBitmap`s. Playback suspends the decoder and keeps the cache; clearing media closes it.

## Layout & Rendering
- **Stack/Zoom modes**: `_perAssetFits[]`, `_stackZoomMode` — minimal state; `applyZoom()` computes Fit and Balance scales without heavy objects.
- **Grid layout**: `pickBestGridLayout()` computes equal-area using square roots and mins — pure math, no persistent large structures.
- **Difference mode**: Drawn from the current frame. The offscreen compositing canvas, and Safari's reusable video frame, are released when the comparison is cleared.
- **Loupe**: Follows the cursor at the current zoom. Video uses a CSS-positioned clone `<video>` and hides the canvas. Images use a display-p3 canvas.

## Magnifier Clone Video Elements
- Clone `<video>` elements are created inside each loupe (`_magState[id].clone`) so hardware compositor path is used — `drawImage(video, canvas)` produces incorrect colours on macOS P3 displays.
- Clones reference the same blob URL as the original; they are NOT added to `_blobUrls` (no duplicate revocation needed).
- `clearAllMedia()` iterates `_magState`, pauses each clone, clears its `src`, removes it from the DOM, then wipes `_magState` entries. Prevents clone elements and blob URL refs leaking across file loads.

## General Patterns
- **_prefixed private state**: Module globals use a `_` prefix (for example `_audioSlotVizData`). `_frameStepping` does not exist; the synchronization-suppression owner is `_bulkSyncActive`.
- **Typed arrays everywhere**: Avoid JS numbers/objects for bulk data (bins, hits, audio samples, image data).
- **GC pressure avoidance**: Reuse objects, debounce layout/resize handlers, cache where resize is infrequent.
- **No build dependencies**: Zero npm packages in the app — keeps memory footprint tiny. `node_modules/` is dev-only (Playwright).

## Performance Notes
- Large 4K+ videos or multiple high-res assets can still push browser limits (VRAM, decode memory).
- Test with real media; scopes/viz update live during playback without dropping frames thanks to caching.
- Preferences/hotkeys in localStorage (tiny JSON).
- `APP_VERSION` bumps must sync with sw.js `CACHE_NAME`.

## Review of CLAUDE.md
- Matches the current patterns that this file depends on (midpoint seeking, epsilon timecode, Stack zoom Fit/Balance, equal-area grid).
- Naming conventions followed: Stack/Grid, GT/A/B slots, internal `tripartite*`.
- Coding style: vanilla JS, `_prefixed` vars, debounced functions. Extend an existing `js/` module when the code belongs there; otherwise edit `index.html`.

This file serves as living memory for memory-sensitive implementations. Update when adding new features that allocate buffers, decode media, or render visuals.

## Continuous scrub listening copy

The shared engine retains one selected listening copy (mono/stereo or Full Mix L/R plus raw center) at the AudioContext rate, limited to 64 MiB in WarpDiff. A second 64 MiB limit applies to each of up to four video listening buffers. Source decoding/analysis, audio-only original PCM, Opus replacement PCM, temporary rendering, processor scratch, video caches, and the brief outgoing fade are outside these retained-preview limits; do not describe them as a cap on total browser memory.

Module loading is cached per context/URL. Preparation is serialized with generation checks before allocation and publication. Source changes and clear route through `_resetContinuousScrub`; audible outgoing PCM is released after its short fade. `state.bytes` plus `state.retiringBytes` must reach zero after clear. The video preparation queue drops stale requests. Full-rate mono/stereo already at the device rate are reused; surround is folded separately. Downsampling uses a centered windowed-sinc filter with bounded output slices and cancellation checks, avoiding a full-rate intermediate copy and aliasing. Waveform/spectrogram aggregates always come from the original decode and are shared by both views.

At 48 kHz, stereo Float32 PCM uses 384,000 bytes per second; the 64 MiB limit accommodates about 175 seconds. Mono accommodates twice as long. Longer videos choose the highest fitting fallback rate among 22.05, 16, 11.025 and 8 kHz. If none fits, preview is unavailable but inspection and normal playback remain available. See `docs/shared-scrub-audio.md` for the component boundary and fallback contract.


## Discrete-center listening (3.17.0)

Verified surround video previews store three Float32 planes: Full Mix L/R plus raw center. Both `_scrubPreviewPlan` and the selected shared stream count all three within their separate 64 MiB budgets. At 48 kHz this is 576,000 bytes/second (about 116 seconds), 50% more than stereo. Filtered rate conversion writes all three directly, with no retained full-rate intermediate. Unknown layouts keep the existing mono/stereo preview. Original analysis aggregates and Opus/audio-only originals stay independent.

`_audioMonitorSlots` holds only layout, readiness and peak summaries; it retains no original PCM. The shared worklet retains its center plane and combines it with Mid before stretching. Mode/slider changes post coefficients instead of allocating buffers or restarting streams. `_audioMonitorRoutes` contains live output graph handles; source completion/clear disconnect them. `_clearAudioListening` clears slot/route state and resets settings through their sole writer. Metadata/peak preparation checks the decode generation before publication.
