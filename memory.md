# WarpDiff Memory Management

## Architecture & Loading
- **Single-file app**: All ~7100 lines of HTML/CSS/JS in `index.html` — no bundling, minimal parse overhead.
- **Asset loading**: Use `URL.createObjectURL(file)` for images/videos (not `FileReader` or base64) to avoid heap inflation and unnecessary memory copies. Revoke URLs when assets are unloaded.
- **PWA/Service Worker**: `sw.js` uses network-first caching with `CACHE_NAME` synced to `APP_VERSION`. Offline-capable without excessive storage bloat.

## Audio Memory Optimizations

- **Native audio routing**: `js/audio-routing.js` keeps one `MediaElementAudioSourceNode` and `GainNode` per media element for short source-switch fades. Inactive native media keeps its decoder running with zero output gain so source switches do not reset its playback clock. Routing begins only after decode identifies a supported channel count; browser-native mixing stays active beforehand. `_connectAudioOutput()` delegates to the shared listening matrix without additional PCM copies. Scrub/replacement sources disconnect their matrix nodes when they end; native matrices are released on clear or format change. No additional decoded buffers are retained. `_clearNativeAudioRoutes()` removes resume listeners, disconnects nodes, and clears the map before the shared context closes.
- **Scrub audio**: Original analysis runs before preparing mono/stereo listening PCM, plus raw center for verified surround, at the AudioContext rate. `_scrubPreviewPlan` limits each video copy to 64 MiB; large clips get a filtered lower-rate short-preview copy, or an explained unavailable state if no 8 kHz-or-better copy fits. Chrome Opus retains its existing original buffer for replacement playback. The no-video view shares original analysis aggregates, not graphs recomputed from the listening copy.
- **Scrub cadence**: Pointer activity and displayed-frame position have separate owners. The 50 ms clock renews 90 ms grains during slow motion even at one held frame, using the existing buffer and output matrix; no extra PCM is stored. `stopScrubSnippet()` clears gesture/target state, and each ended source disconnects its output nodes.
- **AudioBuffer management**: `audioFileBuffers[slot]` deleted after decode. Decoded `AudioBuffer` lives in `_audioSlotVizData[slot].audioBuffer`; freed when `_audioSlotVizData = {}` in `clearAllMedia()`.
- **AudioContext lifecycle**: Lazy-created via `getAudioContext()`. Closed and nulled in `clearAllMedia()` — `audioContext.close().catch(() => {}); audioContext = null` — so browser fully reclaims audio resources between loads. Fresh context created on next `getAudioContext()` call.
- **Stale decode guard**: `_audioDecodeGen[slot]` counter incremented before each `decodeAudioData` call; captured in closure; checked before any state write in `.then()`. Prevents a slow decode completing after reload from writing `_audioSlotVizData` against a new batch. Reset to `{}` in `clearAllMedia()`.
- **BPM & viz**: Uses typed arrays (`Float32Array`) for FFT, waveform buckets, spectral flux. Spectrogram palettes precomputed once.

## Video Scopes & Visualization (`js/scopes.js`)
- **Cached buffers**: Critical for performance — `_wfmBuf`, `_wfmHits*` (Uint16Array), `_vsHit*` (Float32Array/Uint16Array) reused across *all* frames.
  - Reallocated *only* on canvas resize (`_wfmCachedW/H`, `_vsCachedSize`).
  - Comment: "Cached buffers for waveform monitor — reused across frames to avoid per-frame GC pressure."
- **Histogram**: `Uint32Array(256)` bins per channel; optional CDF with `Float32Array`.
- **Waveform monitor**: Hit counting + `putImageData()` for speed; supports luma, RGB parade, RGB overlay.
- **Vectorscope**: Hit accumulation in typed arrays, graticule/skin-tone overlays drawn on top.
- Offscreen canvas for frame sampling (`sampleVideoFrame()`).

## Layout & Rendering
- **Stack/Zoom modes**: `_perAssetFits[]`, `_stackZoomMode` — minimal state; `applyZoom()` computes fit/match scales without heavy objects.
- **Grid layout**: `pickBestGridLayout()` computes equal-area using square roots and mins — pure math, no persistent large structures.
- **Difference mode**: Computed on-the-fly per frame; no stored difference buffers.
- **Loupe**: Canvas-based, follows cursor, uses native pixels at current zoom.

## Magnifier Clone Video Elements
- Clone `<video>` elements are created inside each loupe (`_magState[id].clone`) so hardware compositor path is used — `drawImage(video, canvas)` produces incorrect colours on macOS P3 displays.
- Clones reference the same blob URL as the original; they are NOT added to `_blobUrls` (no duplicate revocation needed).
- `clearAllMedia()` iterates `_magState`, pauses each clone, clears its `src`, removes it from the DOM, then wipes `_magState` entries. Prevents clone elements and blob URL refs leaking across file loads.

## General Patterns
- **_prefixed private state**: All module globals prefixed (e.g. `_frameStepping`, `_audioSlotVizData`) for clarity.
- **Typed arrays everywhere**: Avoid JS numbers/objects for bulk data (bins, hits, audio samples, image data).
- **GC pressure avoidance**: Reuse objects, debounce layout/resize handlers, cache where resize is infrequent.
- **No build dependencies**: Zero npm packages in the app — keeps memory footprint tiny. `node_modules/` is dev-only (Playwright).

## Performance Notes
- Large 4K+ videos or multiple high-res assets can still push browser limits (VRAM, decode memory).
- Test with real media; scopes/viz update live during playback without dropping frames thanks to caching.
- Preferences/hotkeys in localStorage (tiny JSON).
- `APP_VERSION` bumps must sync with sw.js `CACHE_NAME`.

## Review of CLAUDE.md
- Matches all key technical patterns (midpoint seeking, epsilon timecode, stack zoom Fit/Match, equal-area grid, etc.).
- Naming conventions followed: Stack/Grid, GT/A/B slots, internal `tripartite*`.
- Coding style: vanilla JS, edit `index.html` preferentially, `_prefixed` vars, debounced functions.

This file serves as living memory for memory-sensitive implementations. Update when adding new features that allocate buffers, decode media, or render visuals.

## Continuous scrub listening copy

The shared engine retains one selected listening copy (mono/stereo or Full Mix L/R plus raw center) at the AudioContext rate, limited to 64 MiB in WarpDiff. A second 64 MiB limit applies to each of up to four video listening buffers. Source decoding/analysis, audio-only original PCM, Opus replacement PCM, temporary rendering, processor scratch, video caches, and the brief outgoing fade are outside these retained-preview limits; do not describe them as a cap on total browser memory.

Module loading is cached per context/URL. Preparation is serialized with generation checks before allocation and publication. Source changes and clear route through `_resetContinuousScrub`; audible outgoing PCM is released after its short fade. `state.bytes` plus `state.retiringBytes` must reach zero after clear. The video preparation queue drops stale requests. Full-rate mono/stereo already at the device rate are reused; surround is folded separately. Downsampling uses a centered windowed-sinc filter with bounded output slices and cancellation checks, avoiding a full-rate intermediate copy and aliasing. Waveform/spectrogram aggregates always come from the original decode and are shared by both views.

At 48 kHz, stereo Float32 PCM uses 384,000 bytes per second; the 64 MiB limit accommodates about 175 seconds. Mono accommodates twice as long. Longer videos choose the highest fitting fallback rate among 22.05, 16, 11.025 and 8 kHz. If none fits, preview is unavailable but inspection and normal playback remain available. See `docs/shared-scrub-audio.md` for the component boundary and fallback contract.


## Discrete-center listening (3.17.0)

Verified surround video previews store three Float32 planes: Full Mix L/R plus raw center. Both `_scrubPreviewPlan` and the selected shared stream count all three within their separate 64 MiB budgets. At 48 kHz this is 576,000 bytes/second (about 116 seconds), 50% more than stereo. Filtered rate conversion writes all three directly, with no retained full-rate intermediate. Unknown layouts keep the existing mono/stereo preview. Original analysis aggregates and Opus/audio-only originals stay independent.

`_audioMonitorSlots` holds only layout, readiness and peak summaries; it retains no original PCM. The shared worklet retains its center plane and combines it with Mid before stretching. Mode/slider changes post coefficients instead of allocating buffers or restarting streams. `_audioMonitorRoutes` contains live output graph handles; source completion/clear disconnect them. `_clearAudioListening` clears slot/route state and resets settings through their sole writer. Metadata/peak preparation checks the decode generation before publication.
