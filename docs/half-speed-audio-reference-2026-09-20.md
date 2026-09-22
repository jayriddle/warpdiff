# Half-speed audio: different processors

Date: 2026-09-20. WarpDiff remains 3.17.5 at `a950a15`.

## Decision from the first comparison

Jay confirmed that sample A reproduces the electronic sound and that neither B (premix before native slowdown) nor C (WarpSonic's existing WSOLA processor) improves it. This is a failed quality check for both proposed changes. Neither is being integrated.

The previous [capture record](half-speed-audio-investigation-2026-09-18.md) established that this passage has no full-scale clipping or sustained all-channel silent gaps. Jay's feedback now establishes that the artifact itself is present in the saved recording, allowing further investigation without repeatedly exercising the live application.

## What changed in the investigation

The first comparison was narrower than it appeared: Chromium's pitch-preserving renderer and the tested WarpSonic processor both use WSOLA, which aligns and overlaps short pieces of the source waveform. Their implementations differ, but C was not a test of an independent processing family. [Chromium's renderer source](https://chromium.googlesource.com/chromium/src/+/HEAD/media/filters/audio_renderer_algorithm.h) identifies that algorithm; WarpSonic's implementation is in the already-pinned `WsolaProcessor`.

Prepared two different processing candidates while holding 0.5× speed, normal pitch, Full Mix, and audition loudness constant:

- **D — Rubber Band R3 4.0.0:** offline reference using the Finer engine and linked stereo processing. This is a quality benchmark; no Rubber Band library was added to WarpDiff. Offline operation can use an advance analysis pass, so this result would still need a separate real-time evaluation before adoption. [Official integration guidance](https://www.breakfastquay.com/rubberband/integration.html)
- **E — Signalsmith Stretch Web 1.3.2:** the official prebuilt JavaScript/WASM processor, rendered in an isolated Chrome AudioWorklet with the default quality preset. It offers a different spectral approach and already has a browser implementation. Its maintainer describes its best time-stretching range as more moderate than 0.5×, so this remains an experiment rather than a promised improvement. [Official project and browser release](https://github.com/Signalsmith-Audio/signalsmith-stretch)

No denoising, equalization, voice reconstruction, pitch shift, or channel suppression was applied. The original files and all WarpDiff analysis data remain untouched.

## Input and method

Both candidates consume the first six seconds of the previous **1× float capture**, taken after WarpDiff's Full Mix matrix. Using that already-decoded, already-mixed recording holds the source and channel matrix constant across these two candidates. It has not passed through half-speed stretching. The source is 48 kHz, stereo, 32-bit float; output is 12 seconds.

The source WAV SHA-256 is `5a22199e462cff196a6162bc3416a511b14db452d2af61794928f38f3db659ff`. Its parent recording comes from Jay's `505a7754367fd458-stripped-sync-fixed.mp4`.

Rubber Band was downloaded as the official macOS executable archive and run locally:

```sh
rubberband-r3 --fine --tempo 0.5 --centre-focus --ignore-clipping -q \
  source-full-mix-6s.wav full-rubberband-r3-0.5x-float.wav
```

Here `--centre-focus` links stereo processing inside the stretcher; it does not select WarpDiff's Center Only listening mode or discard the other source channels. Pitch ratio remained 1. `--ignore-clipping` disables the utility's automatic gain retry; the resulting float output was independently checked and did not clip.

Signalsmith used its published browser release unchanged. The standalone probe loaded it through an intercepted local test URL; no application or service-worker assets were edited. It awaited buffer loading and scheduling acknowledgments, scheduled playback 500 ms ahead to allow preparation, rendered 12.5 seconds, and retained the 12-second passage after that lead. The requested rate was 0.5 and pitch shift was zero. The isolated browser was muted, and the user's browser was not touched.

## Verification

| Measurement | D: Rubber Band R3 | E: Signalsmith |
| --- | ---: | ---: |
| Output frames | 576,000 | 576,000 |
| Rate / channels | 48,000 Hz / stereo | 48,000 Hz / stereo |
| Duration | 12.000 s | 12.000 s |
| Invalid samples | 0 | 0 |
| Samples above full scale | 0 | 0 |
| Longest internal near-zero run | 0 | 0 |
| Raw sample peak | -12.84 dBFS | -13.66 dBFS |
| Loudness before matching | -28.3 LUFS | -29.1 LUFS |
| Fixed audition gain | 0 dB | +0.8 dB |
| Remeasured audition loudness | -28.3 LUFS | -28.3 LUFS |
| Remeasured audition true peak | -12.8 dBFS | -12.9 dBFS |

The audition loudness matches A to FFmpeg's reported 0.1 LU precision. Matching used a constant gain only; it added no compression or filtering. Audition copies are stereo 16-bit PCM WAV, with float results retained separately.

Signalsmith reported 120 ms total processing latency with this preset. Its offline render took 169 ms for 12 seconds of audio in system Chrome 153, with no page or processor errors. The lead was compensated in this render. These numbers do not prove responsive live seeking, acceptable browser CPU use on every machine, or correct integration with video; those remain required checks if E passes listening.

These checks establish valid renders at the intended settings. They do not establish audible improvement. D and E still require comparison against Jay's confirmed baseline; no winner or fix is claimed.

## Artifacts and exact versions

All private audio and downloaded tools remain local, outside the repository, at `/Users/jay/Documents/warpdiff-audio-check-2026-09-20/`.

- `source-full-mix-6s.wav`: common unstretched input.
- `full-rubberband-r3-0.5x-matched.wav` and `full-signalsmith-0.5x-matched.wav`: audition samples.
- Corresponding `-float.wav` files: processing outputs before audition gain/conversion.
- `reference-measurements.json`: output validity and independently measured levels.
- `signalsmith-render.json`: browser, timing, scheduling, and error results.
- `render-signalsmith.mjs`: reproducible browser probe.
- `tools/`: the unmodified downloaded reference tools and licenses.

Rubber Band archive: official `rubberband-4.0.0-gpl-executable-macos.tar.bz2`, SHA-256 `0dc91509a31a94c1144436cc20e6f1d165bdab39fe125f9be7d46139921b733f`; executable reported `4.0.0`.

Signalsmith source: official GitHub mirror commit `57b93f4e9206a089a45387eaa39bdc9f310d3308`; web package reports `1.3.2`. The tested `SignalsmithStretch.js` is 113,781 bytes, SHA-256 `fe0e23b6bb5dbffb231a91e7dc39f9d2a7d10c7f793fb0237d819ca748f7f778`.

## Integration decision remains conditional on quality

If a candidate clearly improves the sound, the next engineering step is a bounded live playback prototype. It must compensate processing delay, retain pitch and the selected mix across speed/seek/restart operations, maintain A/V synchronization, and obey existing memory and disposal limits. Original analysis and source metadata must remain independent of listening processing. Any reusable engine work belongs in the canonical shared component before WarpDiff repins it.

Rubber Band and Signalsmith also have different distribution terms: Rubber Band offers GPL and commercial licensing; Signalsmith publishes the tested release under MIT. No runtime dependency or licensing change has been made to either project. [Rubber Band distribution information](https://www.breakfastquay.com/rubberband/), [Signalsmith license](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt)

No product code, source media, release version, or deployment changed. Full app regression suites were not rerun for these external diagnostic renders; output duration/format, finite samples, peaks, gaps, and matched loudness were checked directly.

## September 22 listening decision

Jay reported that both D and E were much better than the previous attempts and preferred E. The quality gate for this saved passage passed. The next local work is recorded in [Signalsmith slow-playback prototype](slow-playback-prototype-2026-09-22.md); the original September 20 measurements and limitations above are preserved.
