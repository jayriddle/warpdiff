# WarpDiff

A/B comparison tool for images, video, and audio. Hosted on GitHub Pages.

- **Repo**: https://github.com/jayriddle/warpdiff
- **Architecture**: `index.html` holds all the HTML/CSS and the bulk of the JS (one `<style>` block top, one `<script>` block bottom), with cohesive subsystems progressively extracted into classic `<script>` files in `js/` (see below). The extracted files are **not ES modules** — they share one global scope with the inline script (top-level `let`/`const`/`function` are visible across all classic scripts in the realm), so an extracted function can read/write inline globals and vice versa, resolved at call time. This is the only viable split given the no-build-step constraint.
- **PWA**: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — installable, offline-capable.
- **No build step**: vanilla HTML/CSS/JS only, served as static files.

### Files

- `index.html` — the app. One `<style>` block at the top, one `<script>` block at the bottom.
- `js/audio-viz.js` — waveform/spectrogram FFT, K-weighting biquads, EBU R128 LUFS/LRA/True-Peak computation, palette tables. Exports functions consumed by the script in `index.html`.
- `js/scopes.js` — video scope rendering (waveform monitor, histogram, vectorscope). Uses `Uint16Array` hit-count buffers + `putImageData`; buffers cached across frames, reallocated on resize.
- `js/hotkeys.js` — registry-based hotkey table + key→action lookup, with localStorage override for custom bindings.
- `js/mp4-demux.js` — pure MP4/WebM audio demuxers (`_demuxMP4Audio` / `_demuxWebMAudio`) plus the video sample-table demuxer for scrubbing (`_demuxMP4Video`: stsd/stss/stsz/stsc/stco/stts/ctts/elst → decode-order samples with elst-shifted pts, avcC/hvcC config, RFC 6381 codec strings). No app-state deps.
- `js/scrub-video.js` — WebCodecs scrub decoder sessions (`_createScrubVideoSession`): per-slot VideoDecoder, GOP-run feeding with reorder margin, rAF-coalesced painting, decoded-frame ImageBitmap cache. Consumed by the overlay controller in `index.html`. No app-state deps (canvas injected via `attach`).
- `js/timecode.js` — pure timecode formatters (`_formatTcForCopy`, `_formatTcForMarker`); only app dep is the `_prefs.load` default-format lookup. State-coupled builders stay inline.
- `js/opus-sync.js` — the Chrome Opus A/V sync engine (`_opusSync*` state, `_startOpusSyncAudio`/`_stopOpusSyncAudio`/`_syncOpusAudioToVideo`/`_updateOpusSyncRate`/`_updateOpusSyncGains`, `_OPUS_FADE`). **Stateful** (shares globals). Owns the deferred-start-window invariant (see below).
- `js/audio-decode.js` — the three-tier audio decode pipeline: `decodeAndComputeAudioViz`, `decodeAndComputeAudioSlotViz`, `_decodeAudioWebCodecs`, `_decodeWithAudioDecoder`, `_finalizeAudioViz`, `_onAllDecodeFailed`. **Stateful** — reads/writes inline globals (`mediaData`, `_opusSync*`, `waveformData`, the two decode-generation counters) via shared global scope.
- `js/transport.js` — playback/transport: `playAllMedia`/`pauseAllMedia`/`restartAllVideos`, `stepFrame`, `syncVideos`/`syncMedia`, frame-accurate loop enforcement (`_startLoopRvfc` + `_loopWrapTimer`), and video/audio handler binding (`setupVideoHandlers`/`setupAudioHandlers`/`_setupFpsDetection`). **Stateful** (shares globals). Holds the single-owner targets for the ownership guards.
- `js/starfield.js` — landing-page background animation.
- `ffmpeg/` — ffmpeg.wasm bundle (`ffmpeg-core.{js,wasm,worker.js}` + `ffmpeg.min.js`, ~24 MB). Loaded lazily, single-threaded (no `crossOriginIsolated` / `SharedArrayBuffer`).
- `tests/` — `warpdiff.spec.ts` (Playwright) + `ownership.test.mjs` (dependency-free Node harness; see Testing). `tests/global-setup.ts` auto-generates the gitignored MP4/WAV/MP3 fixtures via `tests/fixtures/generate.sh` on first run (requires `ffmpeg` on PATH).

**When extracting more code into `js/`** (candidates: layout-geometry pure math, waveform/spectrogram panel drawing → `js/audio-viz.js`, ffmpeg transcode orchestration): keep the function definitions in the module, leave the call sites + a `// name → js/file.js` pointer comment in `index.html`, add a `<script src>` tag *before* the inline script, **and add the file to `sw.js` ASSETS** (guarded by the ownership harness). The harness reads concatenated sources, so its guards keep resolving moved functions without edits.

## Key Technical Patterns

### Frame & timecode
- Frame stepping uses midpoint seeking `(frame+0.5)/fps` to avoid IEEE 754 boundary issues.
- Repeated `,` / `.` presses use the burst-local `_frameStepCursor` while a precise seek is unresolved; it expires after 750 ms and resets on playback, pause, restart, and scrub entry.
- Timecode display uses `Math.floor(time * fps + 0.01)` epsilon to match frame numbers.
- Passive fps detection (`_setupFpsDetection`) accumulates frame timestamps across normal-playback sessions, normalizes coalesced callbacks with `metadata.presentedFrames`, and snaps to standard rates (23.976 / 24 / 25 / 29.97 / 30 / 48 / 50 / 59.94 / 60). No active probing at load time.

### Layout
- Stack mode `applyZoom()` supports two zoom reference modes toggled by `\` (`_stackZoomMode`):
  - **Fit** (default) — `_perAssetFits[slot] = min(viewW/nw, viewH/nh)`; `fitZoom` = smallest per-asset fit; each asset fills the viewport independently.
  - **Match** — `fitZoom = _perAssetFits['original']`; all assets rendered at the GT slot's fit scale so spatial scale is consistent across assets. Only available when the GT slot is loaded; `_toggleStackZoomMode()` no-ops with a toast otherwise. Pill indicator in header shows `Fit` (gray) or `Match · GT` (orange).
- Equal-area layout for mixed orientations (Grid inline mode): `A = min((availW/Σ√ri)², availH²·min(ri))`.
- Grid layout auto-picks horizontal vs vertical via `pickBestGridLayout(n)` — computes rendered area for each option given viewport dimensions and asset aspect ratios; re-evaluated on resize.
- Three-phase layout: measure → compute geometry → DOM write. Debounced functions use the pattern `functionNameDebounced` wrapping `functionName`.

### Loop in/out enforcement (RVFC chain)
Sub-region looping is enforced *frame-accurately* via `requestVideoFrameCallback`, not rAF.

- `_startLoopRvfc(video)` registers an `onFrame` callback that checks `metadata.mediaTime` against `_loopInPoint` / `_loopOutPoint` and seeks back when out of range. The callback always re-registers itself at the end (single chain, no duplicate callbacks).
- **Scheduled exact-time wrap**: `mediaTime` is quantized to the frame grid, so waiting for a frame *past* the out-point lets up to a full frame of audio (~42 ms at 24 fps, plus seek latency) play beyond the boundary — audibly. When the **last in-region frame** presents (`t >= out − frameDur·1.25`, `frameDur` from `videoFrameRates`), `onFrame` schedules `_loopWrapToInPoint()` via `setTimeout` for the exact out-point time (playback-rate aware). The timer re-validates before firing (loop cleared / paused / user seeked back) and is cancelled by `clearLoopMarkers`; the immediate `t >= out` check remains as the safety net.
- **Critical**: never register both `requestVideoFrameCallback` *and* an `'ended'`/`'playing'` event listener as fallbacks at the same site — they create parallel chains on stall and dead chains on non-stall. RVFC's contract is "fire when next frame is presented," which covers both the post-seek and post-stall cases on its own.
- The `'play'` event handler in `setupVideoHandlers` must start the RVFC chain **before** the `_bulkSyncActive` early-return; `playAllMedia` flips that flag for 50 ms and the chain would otherwise never start.
- `playAllMedia` sets `m.loop = !customLoopActive` (not unconditionally `true`) — preserves `setNativeLoop(false)` when in/out points are active. Otherwise native loop fights the RVFC seek-back.
- `setLoopPoint` clamps `media.currentTime` to `_getEffectiveDuration(media)` before storing, so loop markers don't overflow the timeline for files where `video.duration` is inflated past actual content (e.g. Opus / DTS with audio-extension metadata).
- A `'ended'` handler wraps to in-point when custom loops are active — the RVFC out-point check fires on `mediaTime >= _loopOutPoint`, but the last frame's `mediaTime` is typically one frame *short* of duration, so an out-point at the end never trips the check and the video ends instead. The handler restarts playback at in-point.

### Audio decode pipeline (three-tier)
1. **`decodeAudioData()`** — native browser decode. Race against a timeout: 1 s if WebCodecs is available (fast fallback), 30 s otherwise.
2. **WebCodecs `AudioDecoder`** — for codecs `decodeAudioData` doesn't handle (notably Opus in Safari, and Opus in Chrome where decode is "successful" but timing is wrong). Demuxer (`_demuxMP4Audio` / `_demuxWebMAudio`) extracts packets manually.
3. **ffmpeg.wasm transcode** — last resort for unsupported codecs (AC-3 / EAC-3 / DTS family / TrueHD).

The fallback routing is **`_onAllDecodeFailed(slot, audioConfirmed)`**:
- If `audioConfirmed=true` (WebCodecs already extracted packets but couldn't decode them — e.g. DTS-HD MA muxed with `mp4a` fourcc, malformed AAC, HE-AAC marked as LC), always attempt transcode.
- If `audioConfirmed=false` and the byte scanner didn't find a known unsupported-codec signature (`ac-3` / `ec-3` / `dtsc` / `dtse` / `dtsh` / `dtsl` / `mlpa`) inside MP4 box atoms, *and* the file is a video, treat as "no audio track" and skip transcode. (Without this distinction, files with confirmed-but-undecodable audio get silently dropped.)
- Otherwise call `_registerFfmpegCommand` which queues the slot for transcode and pops the ffmpeg panel.

### MP4 audio demuxer (`_demuxMP4Audio`)
- Walks `moov → trak → mdia → mdhd / hdlr / minf / stbl → stsd / stsz / stco / co64 / stsc / stts` and `trak → edts → elst`.
- **Per-track scoping is mandatory** for `mdhd.timescale`. Store in `_lastMdhdTimescale` during `parseMdhd` and only promote to the demuxer-wide `timescale` inside `parseHdlr` when `handler_type === 'soun'`. A previous version used a single global `timescale` that got overwritten by every track visited — so a data/subtitle track at timescale=1000 silently clobbered the audio track's 48000, making elst priming offsets (16512 / 48000 = 344 ms) look like 16.5-second skips. Same scoping for `_lastElstMediaTime` and `_lastElstSegDuration` (these reset at each `parseTkhd`).
- Returned `extracted` shape: `{ chunks: [{timestamp, data}], sampleRate, channels, codec, description, preSkip, maxSamples }`. `preSkip` and `maxSamples` are applied post-decode to trim encoder priming and edit-list-truncated tails.

### ffmpeg.wasm transcode
- Loaded once (~24 MB), single-threaded (the bundled build is built with `--disable-pthreads`). Each `ff.run()` invocation exits the wasm instance, so `_ffmpegLoaded` and `_ffmpegInstance` are reset after every run and the next slot in `_ffmpegQueue` triggers a fresh load.
- `_ffmpegQueue` is sorted by `assetOrder` on each push so Ref → A → B order is preserved regardless of which decode fails first.
- Standard transcode command (use as a template for unsupported-codec → AAC):
  ```
  ffmpeg -ignore_editlist 0 -fflags +bitexact -i input.mp4 \
         -map 0:v:0 -map 0:a:0 \
         -c:v copy \
         -c:a aac -ac 2 -ar 48000 -b:a 192k \
         -shortest -movflags +faststart \
         output_aac.mp4
  ```
  Critical flags:
  - **`-ignore_editlist 0`** — *apply* the input edit list. DTS-HD MA and similar codecs carry an elst that trims ~344 ms of encoder priming silence; ignoring it (`-ignore_editlist 1`) leaves the priming in the decoded PCM and the output AAC plays late by that amount.
  - **`-ac 2`** — explicit stereo downmix. AAC 5.1 playback in browsers is spotty; stereo is rock-solid.
  - **`-shortest`** — caps output duration to the shortest stream (= video). Otherwise audio overhang produces A/V duration mismatch in the muxed output.
  - **`-movflags +faststart`** — moov atom at the front for streaming.
- `ff.setLogger` captures all output (`fferr`, `ffout`, `info`) regardless of type; on completion the captured stderr is dumped to console as `[ffmpeg] <slot> stderr: …`. Diagnostic surface for transcode-related questions.

### Opus / Chrome Web Audio sync replacement
Chrome's `<video>` element produces incorrect A/V timing for Opus audio tracks. For affected slots we mute `<video>` audio and play the decoded `AudioBuffer` via Web Audio.

- `_opusSyncSlots[slot]` flags the slot as needing Web Audio replacement. `_opusSyncActive` is the global toggle.
- `_opusSyncDuration[slot]` stores the corrected duration from the decoded buffer (raw `video.duration` reflects container metadata that often extends past actual audio end). `_getEffectiveDuration()` returns this for Opus slots, raw `video.duration` otherwise. Used by timeline, loop markers, and info-bar / Stack-strip duration display.
- `_startOpusSyncAudio(slot, fromTime)`: creates an `AudioBufferSourceNode` at the slot's video's `playbackRate`, fades in over `_OPUS_FADE` (15 ms). Starts at `max(now, _opusSyncFadeUntil[slot])` — `_stopOpusSyncAudio` stamps `_opusSyncFadeUntil` whenever it fades an *audible* source, so any stop→start sequence (internal replacement or external pause→play) waits out the fade rather than crossfading uncorrelated audio with it. The buffer offset is advanced by `(startTime − now)·rate` so audio aligns with the still-advancing video at the actual start moment (starting at `fromTime`'s sample would bake a permanent lag into the drift anchors). Records the **scheduled start time** in `_opusSyncStartCtx` (possibly future), start video time, and the rate per slot.
- **Deferred-start window**: for up to `_OPUS_FADE` after replacing an audible source, the new source exists but hasn't started and all its gain automation is in the future (`gain.gain.value` still reads the GainNode default 1.0). Every consumer of the per-slot state must handle `_opusSyncStartCtx[slot] > ctx.currentTime`: `_syncOpusAudioToVideo` skips drift checks (`elapsed < 0`), `_updateOpusSyncRate` skips re-anchoring, `_updateOpusSyncGains` re-schedules the pending fade-in instead of writing `.value`, and `_stopOpusSyncAudio` cancels the scheduled start outright instead of running a value-anchored fade (which would anchor at 1.0 and let the source start un-faded). Silent cancels and natural ends leave `_opusSyncFadeUntil` untouched — it tracks the last *audible* fade.
- `_syncOpusAudioToVideo()`: drift-corrects each slot. `expectedVideoTime = startVideo + (ctx.currentTime - startCtx) * rate`. Restarts the source if drift > 150 ms OR if `video.playbackRate` changed (the AudioBufferSourceNode's rate can't change mid-stream without an audible glitch).
- J/K speed handlers call `_updateOpusSyncRate(rate)` which re-anchors the timeline (`startVideo` updated to current expected position, `startCtx` to current `ctx.currentTime`) before assigning the new `source.playbackRate.value`.

### Scrub audio preview
- Exactly one preview-audio owner: `playScrubSnippet` resolves `currentAudioSource` (or the active Stack slot fallback). Grid may decode/paint three videos, but never creates scrub audio for the two unselected slots.
- Pointer/presentation events feed `_feedScrubAudio`; a steady 50 ms clock emits only the newest changed target and stops after 130 ms idle. Multi-video Grid uses the shared pointer timeline because competing decoder-paint callbacks are bursty; single-video scrubbing follows the displayed-frame callback.
- Grains have a constant 90 ms **output** duration at every playback rate: the source span scales by `PLAYBACK_RATES[playbackRateIndex]`. Adjacent grains overlap and use the existing 10 ms held-gain ramps plus bounded ±8 ms phase alignment.
- WebCodecs scrub targets are also globally rAF-coalesced: raw pointer events record the newest time, then one display-frame owner fans that target to all visible sessions. The first direct/click target remains immediate.
- Storage: full-quality `AudioBuffer` for Chrome Opus slots (needed for Opus sync replacement). Channel-preserving 22050 Hz downsample via `_downsampleForScrub()` for everything else; retaining stereo phase roughly halves PCM storage versus 48 kHz instead of discarding channels.

### Audio & video metrics
- EBU R128 / BS.1770-4 in `computeAudioMetrics(audioBuffer)` (`js/audio-viz.js`). K-weighting via two cascaded biquad IIR stages (high-shelf + RLB, coefficients computed analytically per fs via Audio EQ Cookbook). 400 ms gated blocks → integrated LUFS; 3 s short-term blocks → LRA; 4× Catmull-Rom cubic interpolation for true peak per channel.
- Spectrograms at 120 s or longer use one 2048-point FFT with an adaptive hop capped at 8,192 frames per channel. Hann coherent gain is compensated so Ref mode reports a bin-centred full-scale sine at 0 dBFS.
- Info bar shows `LUFS · LRA · TP`. CSS `:empty { display: none }` auto-hides absent metrics.
- LUFS envelope (E key cycles modes): Waveform / Waveform+LUFS / LUFS only. Short-term LUFS drawn as stepped chart, reference lines at −14 (streaming) / −16 (podcast) / −23 (broadcast).

### Other
- Scope rendering uses `Uint16Array` hit counts + `putImageData`; hit buffers cached in `js/scopes.js`.
- Images loaded via `URL.createObjectURL` (not FileReader/base64) — no heap inflation.
- Loading overlay (`#loadingOverlay`) shows status during audio decode; hidden at `startFadeIn()`. `checkAllLoaded()` is called from both the audio `loadedmetadata` path AND the end of `decodeAndComputeAudioSlotViz` (defensive — `loadedmetadata` is sometimes delayed indefinitely on `blob:` URLs).
- Service worker (`sw.js`) early-returns for `blob:` URLs — Chrome cannot fetch blob URLs from within a service worker, and intercepting them blocks `<audio>` element loadedmetadata.
- Pixel magnifier for video uses a **CSS-positioned clone `<video>` element** (not `drawImage(video, canvas)`) because Chrome's macOS video pipeline applies a BT.709-style transfer treatment to `<video>` that canvas content doesn't get — the clone matches by construction. Clipping uses `clip-path: circle(50%)` — `overflow:hidden` + `border-radius:50%` does NOT clip hardware-composited video on macOS. **Fallback if the clone approach ever breaks**: the mismatch was measured empirically for the scrub overlay (2026-07, luma-ramp flicker calibration; residual ≤2/255) and corrected with the `#scrubOverlayColorFix` feComponentTransfer table in `index.html` — a canvas + that filter is a proven drop-in alternative. Caveat: the table captures current Chrome-on-macOS behavior (re-measure after major Chrome color-pipeline changes), whereas the clone is version-proof.

## Naming Conventions

- UI shows two view modes: **Stack** and **Grid** (never "Overlay" or "3-UP").
- Grid sub-layouts (3 files): **Inline** (equal cols/rows) and **Offset** (L-shaped 1+2).
- Internal code still uses `tripartite`, `tripartiteLayout3Col`, etc. — only user-facing text was renamed.
- Slots are named `original`, `editA`, `editB` internally; UI shows "Ref"/"A"/"B" for video/image and "GT"/"A"/"B" for audio (`slotLabel(slot)` returns context-aware labels).

## Coding Conventions

- No build step, no dependencies — vanilla HTML/CSS/JS only.
- CSS is in a single `<style>` block at the top of `index.html`; most JS is in the single `<script>` block at the bottom. Cohesive subsystems are extracted into `js/*.js` classic scripts (see Files) — prefer extending an existing module when the code belongs to its subsystem; otherwise edit `index.html`.
- Use `_prefixed` names for module-level private state (e.g., `_audioSlotVizData`, `_opusSyncSlots`). (Note: `_frameStepping` does not exist; the synchronization-suppression owner is `_bulkSyncActive`.)
- Debounced layout functions use the pattern `functionNameDebounced` wrapping `functionName`.
- **Single-owner discipline**: each piece of stateful behavior should have ONE owner (one function that writes it; everyone else routes through it). The ownership harness (`tests/ownership.test.mjs`) enforces this for the audited cases — when adding/refactoring an owner, update the corresponding guard.
- **`APP_VERSION` in `index.html` and `CACHE_NAME` in `sw.js` must be kept in sync on every version bump** (now guarded by the ownership harness). The service worker uses `CACHE_NAME` to invalidate the cache for installed PWA users.
- Add a "What's New" entry inside `#changelogPopup` (search for `<h3>v3.x.y</h3>`) on each version bump. The popup auto-shows on version change.

## Testing

Two layers:
- **Behavioral (Playwright)**: `npm test` / `npx playwright test`. Real headless Chromium; state inspected via `__testAPI`.
- **Structural + pure-logic (`npm run test:ownership`)**: `node tests/ownership.test.mjs`, dependency-free, no browser. Reads concatenated sources (`index.html` + `js/*.js`) and asserts: single-owner guards (RVFC loop chain, video handler binding, decode generations, opus-sync restart, decode pipeline, transport cluster), build/version hygiene (`APP_VERSION` == `CACHE_NAME`; every `<script src=js/*>` is in `sw.js` ASSETS), inline-`<script>` syntax, and pure-function unit tests (incl. the MP4 demuxer against a real fixture). Guards use `countOf`/brace-balancing `extractFn`; each freezes a specific competing-owner bug and is verified to fail when its fix is reverted. Run both before pushing.

- Playwright. `npm test` or `npx playwright test` runs the suite from project root.
- `playwright.config.ts` declares `globalSetup: './tests/global-setup.ts'`, which auto-generates the gitignored MP4 / WAV / MP3 fixtures via `tests/fixtures/generate.sh` if `tests/fixtures/landscape_a.mp4` is missing. Requires `ffmpeg` on PATH; setup errors out with an install hint if it isn't.
- `tests/fixtures/*.{mp4,wav,mp3}` are gitignored (deterministic outputs of the generator script — don't commit them).
- Tests use the `__testAPI` global on `window` to inspect internal state (`zoomLevel`, `fitZoom`, `isGridMode`, `_loopInPoint`, etc.) — add to `__testAPI` when introducing testable state.
- Server: `./start.sh` runs `npx serve -l 8080 .` from project root; Playwright auto-detects and reuses it (`reuseExistingServer: true`).

## Additional Resources

- See `memory.md` for detailed memory management patterns, buffer caching strategies, audio downsampling, typed array usage, and GC avoidance techniques (critical for scopes, audio viz, and large media handling).
- `FEATURES.md`, `MANUAL.md`, and `README.md` provide user-facing documentation.
- `docs/scrub-proxy-spike-2026-05.md` — postmortem on a failed attempt to give Chrome Safari-style scrub feel via an ffmpeg.wasm-transcoded 1-second-GOP proxy. Read before reattempting; the recommendation is WebCodecs + `mp4box.js`, not another `<video>` element.
