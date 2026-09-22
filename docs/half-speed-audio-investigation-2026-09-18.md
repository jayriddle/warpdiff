# Electronic sound at half speed: investigation

Date: 2026-09-18. WarpDiff 3.17.5, source commit `a950a15`.

**Listening result, 2026-09-20:** Jay confirmed that A reproduces the reported electronic sound and neither B nor C reduces it. Premixing and the existing WarpSonic WSOLA processor therefore failed the listening criterion and are not selected for integration. The subsequent investigation and reference renders are recorded in [Half-speed audio: different processors](half-speed-audio-reference-2026-09-20.md).

## Report and scope

Jay reports substantial electronic-sounding noise at 0.5× with the new audio engine. The initial report did not distinguish ordinary Play from dragging the timeline, so a clarification was requested. These operations use different processing paths. This record covers the initial route investigation and the subsequent recorded comparison, treating the selected 0.5× speed as ordinary Play. Jay subsequently confirmed that the captured normal-playback sample A reproduces the problem. No playback code was changed and no audible fix is claimed.

Jay clarified that the desired outcome is cleaner processing at the same listening settings. Changing listening speed, pitch, or channel preference is not the proposed solution. The work below therefore holds half speed and normal voice pitch constant.

## Findings from the code

- The J/K speed controls in `index.html` set the participating media elements' `playbackRate`, then update any Opus replacement sources. WarpDiff does not set `preservesPitch` on native media elements.
- Ordinary playback of the previously supplied FLAC video uses browser-managed audio. Its browser pitch correction remains enabled. The shared Continuous scrub processor is not the half-speed playback engine for this file.
- Continuous dragging in `js/scrub-audio.js` uses the shared phase vocoder. Its tempo follows pointer motion, with picture-position limits for a single video. The selected J/K rate does not set Continuous dragging tempo; it does affect ordinary playback and the short-preview fallback.
- WarpDiff's Opus replacement is another distinct path: an `AudioBufferSourceNode` changes playback rate by resampling, which also changes pitch. It should not be described as using native pitch correction.
- WarpSonic's `ui/waveform.js` has a WSOLA pitch-preserving processor for its decoded playback route, including Opus replacement and Normalize. Ordinary native playback does not automatically use that processor. Its availability is a comparison opportunity, not evidence that it will sound better on this report.
- The shared worklet already separates ordinary-playback WSOLA from the dragging phase vocoder. Its comments record earlier problems with repeated speech attacks under very slow WSOLA dragging and synthetic tones from a previous spectral peak-grouping change. Reusing either approach needs listening checks rather than assuming that one algorithm is universally better.

## Initial route verification

Used a separate, muted headless system Chrome session. The user's open browser and original media file were untouched.

Representative file: `/Users/jay/Downloads/505a7754367fd458-stripped-sync-fixed.mp4`, previously supplied H.264 / FLAC 7.1 media. Jay has not identified it as the file behind this new report.

Loaded the file, waited for the listening buffer and playable video, pressed J twice and Space, and inspected state during advancing playback:

| Observation | Result |
| --- | --- |
| Browser user agent | HeadlessChrome/153.0.0.0, macOS |
| App version | 3.17.5 |
| Playing | Yes |
| Media playback rate | 0.5 |
| Native `preservesPitch` | `true` |
| Opus replacement active for slot | No |
| Continuous processor active | No |
| Continuous processor prepared | Yes; preparation does not mean it is producing sound |
| Dragging | No |
| Listening preview sample rate | 48,000 Hz |
| Listening preview planes | 3: stereo full mix plus retained center |
| Page errors | None |

Raw probe output: `/tmp/warpdiff-half-speed-route-2026-09-18.json` (temporary; the material results are preserved above).

This initial probe verified route selection, not perceived audio quality. At that stage no output capture or clipping measurement had been performed. The follow-up below adds those measurements.

## Follow-up: captured comparisons

Added `scripts/capture-half-speed-audio.mjs`, a local development diagnostic. It opens its own muted browser, loads the supplied video, and captures native output after WarpDiff's existing channel matrix and output gain. It also renders the existing WSOLA processor against the same decoded listening mix. It does not modify production transport, the shared processor, or original media.

For the nominal first six seconds of the representative file, recorded:

1. Current Full Mix playback at 1× as a reference.
2. Current Full Mix playback at 0.5×: browser stretching before WarpDiff's channel matrix.
3. Full Mix at 0.5× with the same matrix applied before browser stretching. A temporary float WAV and isolated native media element exercise the browser processor on the premixed input.
4. Full Mix at 0.5× through the existing WSOLA processor.
5. The same three half-speed variants with Center Only, to isolate dialogue from the other channels during diagnosis. This is a test condition, not a request to change Jay's preferred listening mode.

The worklet used for the WSOLA render is byte-identical to the current canonical WarpCap `audio/wsola-worklet.js`: SHA-256 `c1065fb37225e795d2e6236a6df344a1df183df4e10d18fea086d629003f4323`. No vendored DSP edits were made.

### Results

All seven captures contained finite, nonzero audio. None had samples above full scale. There were no sustained all-channel silent gaps: Full Mix had no internal near-zero run; the longest center-only run was two samples (0.042 ms). These measurements do not detect loss of just one component beneath other sound or assess metallic coloration.

| Capture | Raw sample peak, dBFS | Audition loudness before matching, LUFS |
| --- | ---: | ---: |
| Current Full Mix, 1× | -11.76 | -27.9 |
| Current Full Mix, 0.5× | -11.76 | -28.3 |
| Premix before browser stretch, Full Mix, 0.5× | -12.29 | -28.2 |
| WSOLA, Full Mix, 0.5× | -12.08 | -28.0 |
| Current Center Only, 0.5× | -12.99 | -28.4 |
| Premix before browser stretch, Center Only, 0.5× | -13.00 | -28.1 |
| WSOLA, Center Only, 0.5× | -13.01 | -27.7 |

Native captures confirmed `playbackRate=0.5`, `preservesPitch=true`, unity volume, and inactive Continuous scrubbing. The app reported no page errors. The WSOLA offline renders took 143 ms (Full Mix) and 137 ms (Center Only) for 12 seconds of output; this is offline render cost, not a real-time CPU or A/V synchronization test.

Seven standard audition WAV files were validated as 48 kHz, stereo, 16-bit PCM. Each half-speed file is 12 seconds long. Unaltered float captures were also retained. The audition exports remove only the leading near-zero startup and use equal source gain, without individual peak normalization. They cover the same passage but are not sample-aligned null-test material: the native and WSOLA engines have different startup and extraction timing.

To prevent small loudness differences from biasing comparison, separate `-matched.wav` copies use only fixed attenuation. FFmpeg EBU R128 measurements after this step put all three Full Mix copies at -28.3 LUFS and all three Center Only copies at -28.4 LUFS (reported precision 0.1 LU). Full Mix adjustments were 0, -0.1, and -0.3 dB; center adjustments were 0, -0.3, and -0.7 dB. These are diagnostic export adjustments, not changes to app gain or audio processing. No compression, denoising, or equalization was added.

### Failed check and resolution

The first offline WSOLA attempt returned silence because the offline render completed before asynchronous load/play messages reached the processor. This was a probe initialization race, not evidence of a silent live WSOLA engine. The diagnostic now appends a local subclass that applies the existing processor's load, tempo, and play messages synchronously in its constructor. The DSP itself is unchanged. The rerun produced all seven valid captures and the measurements above.

### Files and reproduction

Private recordings remain outside the repository at `/Users/jay/Documents/warpdiff-audio-check-2026-09-18/`; they have not been committed or uploaded. The folder contains raw float captures, regular audition WAVs, matched audition WAVs, `measurements.json` with timing traces, `audition-levels.json`, and `matched-levels.json` with remeasured output levels.

With the local dev server running, reproduce the captures using:

```sh
node scripts/capture-half-speed-audio.mjs \
  /Users/jay/Downloads/505a7754367fd458-stripped-sync-fixed.mp4 \
  /Users/jay/Documents/warpdiff-audio-check-2026-09-18
```

The script produces the raw captures, ordinary audition WAVs, and `measurements.json`. Loudness matching was a subsequent diagnostic export step using FFmpeg's `ebur128=peak=true` measurement and a fixed `volume=<adjustment>dB` filter; the exact adjustments and verified results are retained in the JSON files above. The probe deliberately rejects Opus replacement, reduced-rate previews, and a nonzero audio start because those would confound this native-playback comparison.

### Decision and limits

These recordings provide a concrete comparison at unchanged speed and pitch. They rule out full-scale clipping and sustained all-channel silence in this passage. At the initial handoff, reproduction and perceived quality still required listening feedback. On 2026-09-20 Jay confirmed reproduction in A and no improvement in B or C. An automated peak/gap check cannot select the best speech quality; this listening result rejects both initial alternatives.

The next decision is which processing change, if any, merits integration based on audible improvement. A successful candidate would then need live tests for A/V synchronization, seek/restart and speed changes, channel controls, long-clip memory, and cleanup. Production playback, releases, and deployment remain unchanged. Full app regression suites were not rerun because only the diagnostic and this record changed; the diagnostic itself completed in real Chrome, and its exported media and loudness matches were checked independently with FFmpeg.

## Recommendation

For ordinary Play at 0.5×, investigate pitch-preserving time stretching first. The comparison above includes the existing browser path, premixing before browser stretching, and the shared decoded-playback WSOLA path, with both Full Mix and verified center-channel listening. A successful candidate must improve intelligibility without losing A/V alignment, producing clicks on speed/seek changes, or retaining PCM after clear. Also check CPU use and memory on a long clip before adopting a decoded playback route.

Disabling pitch correction or changing to 0.75× was discussed in the initial response as a diagnostic/workaround. Neither was used in this comparison, and neither meets the requested outcome of cleaner 0.5× playback with normal voice pitch.

If the report instead concerns dragging, test the Continuous phase vocoder with the actual gesture and clip, including the picture-position limit. The native-playback investigation alone would not address that path.

Increasing input sample rate or applying a noise filter is not the recommended first change: the representative listening input already runs at 48 kHz, and neither addresses an established cause here. Preserve original media and analysis throughout. Any shared DSP change belongs in the canonical WarpCap component before repinning WarpDiff; do not edit the vendored copies directly.

## References

- [MDN: HTMLMediaElement.preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch) documents native pitch correction and its default enabled state.
- [Ravelli, Sandler and Bello, DAFx 2005](https://www.dafx.de/paper-archive/2005/P_182.pdf) discusses the differing speech/music behavior of time-domain stretching and phase-vocoder artifacts. This supports the diagnostic possibilities, not a diagnosis of Jay's clip.
