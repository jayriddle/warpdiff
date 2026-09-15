# Dialogue listening — investigation and implementation

## Outcome

WarpDiff 3.17.0 adds Full Mix, Dialogue Focus, and Center Only beside volume. Center can be boosted by 0–12 dB; other channels can be reduced to silence. The selected mix applies to native playback, decoded replacement playback, Continuous and short previews. New comparisons start in Full Mix. Unknown/stereo layouts explain why discrete-center controls are unavailable.

The shared implementation is WarpScrubAudio 1.2.0 in WarpCap. WarpSonic retains its existing stereo preparation and Center Focus UI; the new discrete-center API is available to future surface adapters. Deployment and WarpCap's WarpDiff vendor refresh remain held.

## Investigation

The supplied six-channel FLAC movie was decoded locally and measured through the exact shipped phase-vocoder code. No movie frames, PCM, speech transcript or audio excerpts are retained. The [before measurements](before-51.json) identify the input by SHA-256 and state the method and limitations. The reusable [probe](../../tests/investigate-dialogue.mjs) also measures stationary tones, harmonics and deterministic noise.

| Source, measured over the corresponding input/output interval | Quarter speed | Half speed | Normal speed |
|---|---:|---:|---:|
| Movie center channel | −2.623 dB | −1.270 dB | 0.000 dB |
| Movie full stereo mix | −2.628 dB | −1.684 dB | 0.000 dB |
| Deterministic noise | −2.379 dB | −1.337 dB | 0.000 dB |

Steady tones/harmonics stayed near their source level at these speeds. This supports content-dependent time-stretch attenuation/softening, not a missing center in the current downmix. It does not establish perceived intelligibility or explain every browser/pointer-dependent case. Real speech is nonstationary and the processor's analysis window extends past its nominal position; the measurements are electrical level comparisons, not an intelligibility score.

Full Mix retains the established stretching response. Dialogue controls change the contribution of the actual center before stretching and can reduce competing material. Continuous can still soften articulation. Normal-speed Full Mix remains useful for final listening decisions.

## Implementation decisions

- **One policy:** `WarpScrubAudio.monitor` owns settings validation, channel coefficients, source-peak headroom, metadata helpers and native graph ramps. `js/audio-monitor.js` owns WarpDiff's comparison settings, readiness, routes and UI.
- **Center survives preparation:** verified surround previews contain Full Mix L/R plus raw center. The worklet combines center with Mid before spectral processing and applies the same other-channel level to Side. Mode changes post coefficients; they do not seek or reload PCM.
- **Restore panned sound correctly:** switching back from Center Only re-aligns the previously silent bands within the existing Hann overlap. Without this, their independent phase histories could weaken or move the restored sound between ears at slow speeds. Position and node identity remain unchanged.
- **Verified layout:** FLAC metadata and optional masks, declared AAC 5.1, valid MP4 Opus family-1 surround, and WAVE extensible masks can establish a center. Decoded channel count must agree. Custom channel descriptions, ambiguous multiple-audio-track MP4s and unrecognized layouts retain Full Mix.
- **Source-based headroom:** focused mixes use conservative original center/other peak bounds. The panel reports any headroom reduction. This protects the input mix; it is not a post-stretch brick-wall limiter or automatic loudness normalization.
- **Memory:** all three preview planes count toward the existing 64 MiB per-video and separate selected-stream caps. At 48 kHz that allows approximately 116 seconds of surround preview, versus 175 seconds of stereo. Filtered fallbacks may occur sooner. No original multichannel PCM is newly retained after video analysis.
- **Analysis and timing:** original metrics and graph aggregates remain authoritative. Mute, volume, leading audio offsets, seeks, loops and source-selection ownership remain in their existing paths.
- **UI lifecycle:** settings follow source selection within one comparison; an unsupported source uses Full Mix. Clear resets the controls and releases graph/buffer state. Escape returns focus to the disclosure; range keys remain local to the sliders.

## Verification record

- Initial browser exercise: nine new output/UI/lifecycle tests passed. It measures channel frequencies through real native playback, Continuous, short previews and replacement playback with physical audio muted.
- The first broader scrub run passed 17 cases and failed one old two-plane memory assertion. The assertion now accounts for the retained center; it still verifies exact selected-stream storage.
- Initial pure DSP tests passed five and failed four. Two exposed panned-channel restoration at slow speeds; rephasing on mix changes fixes this. The other two needed a longer input and a threshold consistent with the pre-existing 2× tone attenuation. All nine then passed, including both directions and restoration positive controls.
- The initial manual browser probe assumed a single clip occupied Ref. WarpDiff correctly places a single clip in A; the corrected probe found the verified layout and three-plane cache with no page errors.
- The first ownership run found the not-yet-updated README version. Version/documentation alignment is now included in the checks.
- Final suite, historical-injection results, source pin and retained evidence inventory are recorded at completion below.

## Reproduce

From the WarpDiff repository root:

```sh
node tests/investigate-dialogue.mjs --clip /path/to/a/known-surround-movie.mp4 --out /path/to/report.json
npx playwright test tests/dialogue-listening.spec.ts --workers=1 --retries=0
npx playwright test --workers=4 --retries=0
node tests/ownership.test.mjs
node scripts/vendor-scrub-audio.mjs --check --repo ../WarpCap
```

The fixture generator creates identifiable synthetic 5.1 and 7.1 tracks locally. These media files are gitignored. The [control screenshot](controls.png) uses a generated black video, not the user's movie.

Manual acceptance: compare Full Mix and Dialogue Focus on real voices while dragging at slow, changing speeds. Center Only can omit voices placed in other channels. Verify complete speaker coverage in Full Mix. Headless electrical checks do not replace that listening assessment.


## Additional findings during verification

- Both user-selected stripped FLAC movies expose verified 5.1/7.1 layouts. The browser checks confirmed a retained center, unchanged original metrics and unchanged timeline time when changing the mix. Their 0.166-second audio starts remain intact.
- The codec smoke exposed a pre-existing MP4 Opus decoder-header defect. Raw big-endian `dOps` bytes were passed where WebCodecs expects an `OpusHead`; generated 6/8-channel inputs decoded as two channels. The demuxer now builds the correct identification header and retains mapping and priming values. Both surround formats now decode every channel and preserve the 1500 Hz center fixture.
- The first AAC smoke encoded a PCE/custom layout and correctly left center controls unavailable. Encoding the standard declared 5.1 configuration enables them. The first Opus fixture conversion needed an explicit 5.1 layout because the encoder rejects the decoded FLAC's 5.1(side) label.
- A new source-handoff test initially assumed input order; WarpDiff sorts by modification time. It now selects by actual filename and passes through surround → stereo → surround, then a verified audio-only file.
- The shared-controller review caught a missing layout field when recording processor failure, which would allow a surround stream to reload repeatedly. The corrected callback test fails against the recorded before-fix implementation and passes after preserving the layout. A first untrusted-event dispatch did not exercise the callback; the test now invokes the registered recovery callback directly. An older warm-up fade test now establishes an advancing audio clock before claiming its source was already audible.
- The final offline measurements match the pre-change Full Mix response exactly for the sampled real and synthetic intervals. The new controls do not quietly alter the default processing gain.

### Standards consulted

The FLAC channel assignments and optional channel mask define the supported center identity ([RFC 9639](https://www.rfc-editor.org/rfc/rfc9639.html#section-9.1.3)). The shared 5.1 fold follows the [Web Audio downmix equations](https://www.w3.org/TR/webaudio/#down-mix). WebCodecs accepts an Opus identification header ([W3C Opus registration](https://www.w3.org/TR/webcodecs-opus-codec-registration/#audiodecoderconfig-description)); its signature, endianness and mapping are defined in [RFC 7845](https://www.rfc-editor.org/rfc/rfc7845.html#section-5.1), while the [MP4 Opus specification](https://opus-codec.org/docs/opus_in_isobmff.html) defines dOps. Browser fixture measurements verify the application's resulting channel order.


## Decode and lifecycle corrections

The final codec sample comparison found that WebCodecs honored OpusHead priming while the existing post-decode code also trimmed it. The decoder receives a separate copy with zero pre-skip; the existing demux/edit-list-aware trim remains the sole owner. MP4 and WebM share this correction. Generated 5.1/7.1 center samples now match FFmpeg within the test tolerance, with an eight-second duration and no additional audio start shift. The failed and passing sample comparisons are retained in `codec-samples.txt` and `codec-samples-final.txt`.

A broader run then exposed an ordering issue when an audio-only WAVE was loaded after video. The audio-only display and lazy W panel have independent decode generations; the panel path initially omitted WAVE/FLAC channel metadata and could overwrite ready listening state. A deterministic test forces the panel decode to finish last. It failed before the correction; both paths now use the shared WAVE/FLAC metadata helper. The retained failure and passing check are `audio-only-order-before.txt` and `audio-only-order-final.txt`.

The Opus header ownership checks were also run against the actual pre-change demuxer from WarpDiff 5151423: both new header assertions failed while 402 existing checks passed. This is retained in `historical-demux.txt`.


## Checkpoint and retained evidence

Canonical component 1.2.0 is committed in WarpCap as `cbfb6945e2c7c26958ecb94662a32a69038e4688`. WarpDiff's lock pins that commit and both file hashes with `workingTree: false`. The product changes and test sources can be reconstructed from `reviewed.patch` over WarpDiff `5151423`; `source-sha256.json` records their exact hashes and tool versions. The companion canonical audit is retained under WarpCap's `docs/archive/audits/2026-09-15-dialogue-listening` with an integrity manifest.

The dated record keeps initial failures alongside final results, including the byte-count and finalization test updates, file-order fixture correction, real Opus header/priming fixes and the audio-only completion race. Logs are historical evidence and may contain local paths and terminal formatting. No movie frames, PCM or transcripts are retained. The control screenshot uses a generated fixture. The real-movie inputs require the user's local files matching the recorded hashes.

Delivery remains local. Nothing is pushed or deployed, and WarpCap's bundled WarpDiff remains unchanged. Subjective voice clarity at slow, changing drag speeds is the remaining listening-acceptance check.


## Final verification

| Check | Result |
|---|---|
| Complete WarpDiff Chromium suite, four workers, no retries | **229 passed, 1 optional skip** |
| WarpDiff ownership/pure-logic harness | **404 passed, 0 failed** |
| New listening/codec browser coverage in that suite | **13 passed**, including actual Opus sample comparison and forced audio-only decode order |
| Pinned canonical source and vendored hashes | Match component 1.2.0 at **cbfb694** |
| Canonical direct logic and CI | **1,206 logic passed; CI passed** |
| Canonical new DSP/unit tests | **9 passed** |
| WarpSonic scrub/output browser regressions | **26 passed, 1 optional skip** |
| Shared-controller browser regressions | **9 passed** |
| Real movies and codec/desktop smoke | Both user-selected FLAC files and generated 5.1/7.1 Opus plus declared 5.1 AAC pass; no page errors; panel fits 1024×768, 1280×720 and 1920×1080 |
| Existing Full Mix level response | Before/after real and synthetic measurements match exactly over the measured intervals |

The original failed runs are preserved separately. The final complete suite is `full-browser.txt`; source hashes, patch and `manifest.json` inventory the retained checkpoint. Source/doc changes pass the whitespace check; terminal whitespace in historical logs is intentionally preserved. No original assets, deployment, WarpCap vendor snapshot or unrelated files are part of this change.
