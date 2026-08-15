# Playback performance and headphone-audio assessment

**Date:** 2026-08-13
**Scope:** Current WarpDiff video playback, inspection tools, audio analysis, multichannel handling, and an optional upstream comparison-media contract
**Status:** Assessment and recommendations only; this document does not authorize removal of source-media support or change current playback behavior

## Executive summary

WarpDiff's ordinary single-video playback path is relatively inexpensive. The most demanding cases combine multiple high-resolution video decoders with live inspection features, particularly the video loupe, scopes, or Difference mode. The clearest measured playback defect is the loupe lifecycle: once a loupe clone has been created, it can continue consuming decoder resources after the loupe is hidden. In a repeated Chromium test, adding one loupe clone changed a second video's dropped-frame count from zero to approximately 51–52 frames.

The largest architectural simplification would be to create comparison-ready media upstream. A canonical H.264/AAC, constant-frame-rate proxy with aligned timelines would remove much of WarpDiff's browser compatibility machinery and make playback more predictable. Resolution and frame-rate limits would produce more playback benefit than codec normalization alone.

Tutors judge audio using headphones. For that workflow, the most coherent audio path is a deterministic, upstream-generated stereo headphone-monitoring track. WarpDiff would play, scrub, visualize, and measure that same signal. The original multichannel source should remain available as the deliverable of record; the stereo track is a monitoring proxy, not a replacement master.

## Current playback cost profile

### Most expensive use cases

In descending order of likely cost:

1. **Two or three high-resolution videos playing in Grid.** Each asset requires an active video decoder. 4K, high-frame-rate, 10-bit, high-bitrate, or difficult codec profiles can exceed hardware-decoder capacity and push a stream onto a slower path.
2. **Linked loupe during multi-video playback.** The loupe uses cloned `<video>` elements to preserve Chrome/macOS color parity. These clones add decoder demand. The cost can currently persist after the loupe is no longer visible if it was activated earlier in the session.
3. **Difference mode with high-resolution sources.** Difference mode composites source frames at native resolution into an offscreen canvas on every display animation frame, then draws the result into the visible canvas.
4. **Live video scopes.** A scope update samples a 640×360 frame, reads pixels, analyzes them, and renders the selected display. Direct measurements were approximately 6–8 ms per update, a substantial fraction of the 16.7 ms budget at 60 Hz.
5. **Scrubbing multiple videos.** Each slot can run a WebCodecs decoder session and retain decoded GOP frames. Long-GOP media makes random movement more expensive, and three populated caches can retain several hundred MiB.
6. **Loading long media with audio.** PCM decode, waveform, spectrogram, LUFS, LRA, true-peak, and scrub-buffer preparation currently occur as one eager pipeline. This is primarily an initial-load CPU and memory spike.
7. **Playback at 1.5× or 2×.** Faster playback increases decoder throughput requirements and amplifies the costs of Grid, loupe, Difference, and scopes.

The practical worst case is three 4K videos in Grid at 2× speed with linked loupe and live scopes. Single-video playback without auxiliary inspection features is comparatively light.

### Loupe lifecycle nuance

If the loupe has never been activated since the page loaded, fixing its lifecycle will provide almost no playback improvement: clone videos are created lazily, and the inactive per-frame guard is negligible.

If the loupe was activated and later hidden, the fix can materially improve playback. Inactive clones should be paused and released when:

- the loupe is disabled;
- linked loupe is disabled;
- the pointer leaves the relevant inspection surface;
- the page becomes hidden; or
- media is cleared or replaced.

The implementation must preserve the clone-based color path unless a canvas alternative is revalidated. A canvas with the existing scrub-overlay color correction is a possible fallback, but its calibration is specific to measured Chrome/macOS behavior and should be rechecked after major browser color-pipeline changes.

## Playback improvement backlog

### RICE and risk method

The RICE figures are relative prioritization estimates, not forecasts:

- **Reach:** 1–10, representing how broadly the change affects normal use.
- **Impact:** 3 = massive, 2 = high, 1 = medium, 0.5 = low, 0.25 = very low.
- **Confidence:** confidence in the expected benefit.
- **Effort:** estimated engineering days.
- **RICE:** `Reach × Impact × Confidence ÷ Effort`.
- **Risk:** 1 = very low through 5 = high, combining regression likelihood and blast radius.
- **Risk-adjusted score:** `RICE ÷ (1 + 0.5 × (Risk − 1))`.

| Adjusted rank | Change | RICE | Risk | Risk-adjusted | Principal risk |
|---:|---|---:|---:|---:|---|
| 1 | Add `playsInline` to primary videos | 11.4 | 1 | **11.40** | Negligible; primarily improves mobile behavior |
| 2 | Pause and release inactive loupe clones | 5.7 | 2 | **3.80** | Loupe reactivation or positioning could regress |
| 3 | Throttle ARIA playback-position updates | 4.5 | 2 | **3.00** | Assistive feedback could become too stale |
| 4 | Cache video references, active media, and loop bounds per tick | 2.8 | 2 | **1.87** | Cache invalidation after media or layout changes |
| 5 | Separate scrub-audio readiness from heavy analysis | 3.4 | 4 | **1.36** | Decode generations, loading completion, metrics, and Opus state are coupled |
| 6 | Resolve effective duration from the media's owning slot | 1.9 | 2 | **1.27** | Incorrect ownership mapping could affect loop bounds |
| 7 | Use transforms and percentages for cursor/progress updates | 2.3 | 3 | **1.15** | Rounding, layout, or hit-area alignment could change |
| 8 | Drive scopes from presented frames at a capped rate | 1.8 | 3 | **0.90** | Scopes could become stale during seek, pause, or replacement |
| 9 | Suspend auxiliary work while the page is hidden | 1.3 | 2 | **0.87** | Resume must immediately refresh all derived views |
| 10 | Stop follower frame-callback chains after FPS detection | 1.1 | 3 | **0.55** | FPS may need redetection after replacement or unusual playback |
| 11 | Separate UI animation from transport maintenance | 1.25 | 5 | **0.42** | Timing ownership changes could regress sync, loops, or Opus audio |
| 12 | Prototype `captureStream()` for loupe rendering | 1.0 | 5 | **0.33** | Browser support, latency, lifecycle, and color parity |
| 13 | Make scrub-cache size device-aware | 0.65 | 4 | **0.26** | Smaller caches can reintroduce scrub stalls |
| 14 | Render Difference directly into its display canvas | 0.43 | 4 | **0.17** | Scaling, sizing, and color output could change |
| 15 | Replace canvas Difference with CSS blending | 0.20 | 5 | **0.07** | Color-management and compositing parity are difficult to guarantee |

RICE favors tiny, inexpensive changes. The most important substantive change is still the loupe lifecycle because it caused measured frame loss. The broadest potential performance improvement is separating quickly needed scrub audio from heavyweight analysis.

### Recommended delivery sequence

1. **Contained changes:** `playsInline`, loupe cleanup, ARIA throttling, hot-path reference caching, and effective-duration ownership.
2. **Hot-path reductions:** transform-based progress/cursor rendering and hidden-page suspension.
3. **Audio pipeline split:** make scrub/playback audio ready first; compute waveform, spectrogram, LUFS, LRA, and true peak lazily or in background work.
4. **Frame-driven analysis:** update scopes and Difference output only for newly presented frames and cap analysis frequency where appropriate.
5. **Isolated experiments:** `captureStream()` loupe, CSS Difference, device-aware cache sizing, and broader scheduler restructuring. Require measurements before adoption.

Do not change the proven drift thresholds, frame-accurate loop callback, midpoint frame stepping, GOP-aware scrub cache, multi-video scrub pointer clock, or seamless Stack switching without a specific reproduced problem and targeted test.

## Upstream comparison-media contract

### Highest-leverage simplification

An upstream system could provide canonical comparison-ready proxies with:

- MP4 container with fast-start metadata;
- H.264/AVC, 8-bit 4:2:0, using broadly hardware-decodable settings;
- AAC-LC stereo at 48 kHz;
- constant and explicitly supplied frame rate;
- matching frame rate, timeline start, and duration across compared assets;
- a short, fixed GOP, approximately one second rather than all-intra;
- an interactive resolution/frame-rate ceiling, such as 1080p at 30 or 60 fps;
- sidecar metadata containing exact FPS, dimensions, duration, source identity, and audio derivation.

Codec normalization alone mainly improves reliability and simplifies code. The strongest playback gains come from resolution, frame-rate, bitrate, GOP, and timeline normalization.

With a strict input contract, WarpDiff could eventually remove or greatly reduce:

- the ffmpeg.wasm bundle and transcode UI;
- Chrome Opus replacement audio and drift correction;
- MP4/WebM audio fallback demuxing;
- unsupported-codec detection and much of the three-tier audio decoder;
- effective-duration corrections;
- passive FPS detection; and
- codec-, edit-list-, and priming-specific compatibility branches.

This would change WarpDiff from an arbitrary-media compatibility layer into a focused comparison player. The tradeoff is that direct drag-and-drop of unsupported source media would require an upstream proxy generator, desktop helper, server process, or prescribed export preset.

### Secondary simplification option

Loupe and scopes could be defined as still-frame inspection tools: available while paused, scrubbing, or frame-stepping, but suspended during continuous playback. This would eliminate most live loupe synchronization and continuous scope analysis. It is a defensible simplification if tutors use these tools for close inspection rather than live motion judgment, but it is a product restriction and should be validated with users before implementation.

## Current multichannel-audio overhead

Multichannel audio contributes little sustained video-playback overhead in the ordinary AAC path, but it creates significant loading, analysis, and retained-memory costs. Most all-channel costs scale approximately linearly with decoded channel count.

### PCM and scrub-buffer memory

Approximate storage per minute, using 32-bit floating-point PCM:

| Retained representation | Mono | Stereo | 5.1 | 7.1 |
|---|---:|---:|---:|---:|
| Full-quality 48 kHz PCM | 11.5 MB | 23.0 MB | 69.1 MB | 92.2 MB |
| 22.05 kHz scrub copy | 5.3 MB | 10.6 MB | 31.8 MB | 42.3 MB |
| Relative to stereo | 0.5× | 1× | **3×** | **4×** |

For three ten-minute 5.1 videos, scrub buffers alone can approach 950 MB, versus approximately 320 MB for stereo. Full-quality PCM is retained for audio-only assets and Chrome Opus replacement audio. Ordinary non-Opus video normally retains only the downsampled scrub copy after analysis.

Waveforms and spectrograms currently inspect only channels 1 and 2, so their computation does not grow beyond stereo. LUFS, LRA, true-peak, and scrub downsampling process every decoded channel. Loudness analysis also creates filtered per-channel arrays temporarily, increasing peak memory during loading.

A synthetic Chromium measurement of the current metrics implementation on 15 seconds of 48 kHz audio produced:

| Channels | Metrics time | Relative to stereo |
|---:|---:|---:|
| 1 | 16.7 ms | 0.76× |
| 2 | 22.1 ms | 1× |
| 6 | 74.3 ms | 3.4× |
| 8 | 86.0 ms | 3.9× |

These are local microbenchmark results rather than end-to-end load times, but they demonstrate the expected channel scaling. Enforcing stereo upstream removes roughly 67% of channel-dependent work and storage for 5.1, or 75% for 7.1.

There is also a measurement limitation: visualizations expose only the first two channels, while current loudness calculations apply equal weight to every decoded channel, potentially including LFE. This is not a complete layout-aware BS.1770 multichannel implementation.

## Recommended headphone-monitoring audio path

Because tutors judge audio through headphones, the preferred path is:

```text
Original source audio
        |
        v
Layout-aware, deterministic upstream render
        |
        v
48 kHz stereo AAC headphone-review track
        |
        +-- Native video playback
        +-- Waveform and spectrogram
        +-- LUFS, LRA, and true-peak metrics
        +-- Stereo scrub-preview buffer
```

The upstream renderer should:

- read and validate the declared source channel layout;
- use one documented downmix matrix for Ref, A, and B;
- define center, surround, and LFE treatment explicitly;
- render in floating-point precision with fixed headroom;
- avoid per-asset peak normalization, compression, or limiting;
- compensate and verify resampling and codec delay;
- retain provenance metadata describing layout, matrix, LFE policy, headroom, and timing adjustment; and
- run independent checks for silent, swapped, missing, or malformed source channels.

WarpDiff should use this exact signal for playback, visualization, metrics, and scrubbing. Monitoring volume should remain separate from media level. Source switching should retain the existing short gain ramps. Optional mono and L/R checks are useful; loudness matching, if added, must be clearly labeled and disabled by default.

The current 22.05 kHz scrub preview is adequate for navigation. Once the signal is guaranteed stereo, a 32 kHz scrub buffer could improve headphone clarity while remaining smaller than today's 5.1 scrub representation. This is optional and should be measured against memory and scrub latency.

If tutors need to judge surround direction rather than stereo compatibility, provide a separately generated, approved binaural monitoring track. Runtime browser HRTF rendering would add variability and complexity and should not be the canonical review path.

## Downmix tradeoffs and safeguards

A stereo downmix is appropriate only when the review target is the headphone experience. It is not a substitute for validating the original multichannel deliverable.

| Tradeoff | Consequence | Safeguard |
|---|---|---|
| Spatial information is reduced | Channel swaps, missing surrounds, and rear-channel balance may be hidden | Preserve and separately validate the source channels |
| The matrix changes the sound | Dialogue, ambience, bass, and loudness depend on coefficients | Use one documented, versioned matrix for every asset |
| Cross-channel phase can cancel | Material may become quieter or disappear in the fold-down | Treat this as a compatibility finding; provide mono/L-R checks and source-channel QC |
| Summed peaks can exceed 0 dBFS | The render can clip | Reserve fixed linear headroom; do not use an automatic limiter |
| LFE handling is ambiguous | Inclusion may add excess bass; omission may hide LFE defects | Declare and record the LFE policy explicitly |
| Stereo metrics differ from source-master metrics | Headphone LUFS/peak cannot certify the multichannel master | Label metrics as **Headphone mix** and keep source compliance separate |
| Lossy re-encoding adds artifacts | AAC review audio is not mathematically transparent | Use a high-quality canonical encode and avoid repeated generations |
| Resampling and encoder priming can shift sync | Audio may lead or lag picture | Apply delay compensation and verify sample/frame alignment upstream |
| A matrix fold-down is not binaural surround | It lacks virtual speaker/HRTF cues | Generate an approved binaural track when spatial intent is under review |

The source multichannel file should therefore remain the authoritative deliverable. The stereo headphone track is a deterministic monitoring representation with traceable derivation.

## Decision guidance

If WarpDiff must continue accepting arbitrary local files, retain the compatibility paths and first implement the contained playback improvements, especially loupe cleanup and staged audio analysis.

If the surrounding workflow can guarantee upstream processing, adopt the canonical proxy contract. For the tutor workflow, make a deterministic stereo headphone track part of that contract. This offers three simultaneous benefits:

1. more predictable multi-video playback;
2. substantially lower audio memory and analysis cost; and
3. consistent playback, visualization, and metrics across browsers and tutor machines.

Before making stereo the only monitoring representation, confirm that tutors are evaluating headphone translation rather than approving surround-master integrity. If both judgments matter, retain two explicit review products: **Headphone mix** for tutor listening and **Source/master QC** for channel-level and compliance checks.

## Validation requirements for future changes

Any implementation based on this assessment should include:

- dropped-frame measurements for one, two, and three videos before and after loupe activation/deactivation;
- loupe lifecycle tests covering disable, pointer leave, linked-mode changes, page visibility, media replacement, and clear;
- visual color-parity tests before changing the clone-based loupe or Difference renderer;
- scope freshness tests for play, pause, seek, frame-step, source switch, and page resume;
- audio-decode generation and loading-completion tests if analysis becomes staged or asynchronous;
- A/V alignment tests for upstream proxy encoder delay and edit-list handling;
- known multichannel fixtures verifying the documented downmix matrix, LFE policy, phase behavior, and headroom;
- proof that waveform, spectrogram, playback, scrub preview, and metrics all use the same headphone-monitor signal; and
- labels that clearly distinguish headphone-monitor metrics from source-master compliance metrics.
