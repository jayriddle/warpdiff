# Slow-playback tradeoffs and the reported harsh passage

## Scope and outcome

Jay reported harsh sound in `de3f59c8de544e18.mp4` around timeline **2.775 s**, most apparent with **Listen: Center Only, Center +11 dB**. This investigation reproduced those settings at **0.5×** with the local Signalsmith prototype. It did not modify playback code, source media, shared components, or the user's browser.

The recorded passage did **not** exceed digital full scale, including an oversampled true-peak check, and did not coincide with a seek, branch switch, or resynchronization in this run. This weakens those explanations for the reported sound. It does **not** establish the perceived harshness's cause: the remaining candidates include the stretcher's treatment of a short noisy/transient sound, characteristics already in the source center channel, and their greater audibility with center isolation and gain. Numerical measurements are not a listening verdict.

The prototype should retain its experimental status. The next quality comparison should use this exact passage with unchanged 0.5× speed, pitch, and center-listening intent. Start by comparing the live capture with the isolated default-processor render. If the same objection occurs in both, evaluate processor settings that balance sharp sounds and sustained speech, then check the previously preferred E passage for regressions. Headroom changes alone are not supported as a fix for this passage by these measurements.

## What the processing changes

Signalsmith reconstructs audio across short, overlapping frequency-analysis windows to make slower playback keep its pitch. That can make speech clearer than the previous browser stretching while still changing the texture or timing of consonants, breath, and impacts. Its author describes transient repetition/smearing for larger stretches; the pinned version's README says time stretching sounds best between roughly 0.75× and 1.5×. These are algorithm tradeoffs, not evidence that any particular audible defect is unavoidable.

- [Pinned upstream README](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/57b93f4e9206a089a45387eaa39bdc9f310d3308/README.md)
- [Author's design explanation, including time-aliasing and window-size tradeoffs](https://signalsmith-audio.co.uk/writing/2023/stretch-design/)

The integration adds **120 ms of reported processor latency**, compensated through preloaded input and scheduled output. The host allows another 30 ms before the native-to-processed handoff and uses a 15 ms fade. This requires care at playback starts, seeks, loops, and rate changes; 120 ms is not an intended permanent audio/video offset. Real hardware lip sync has not been measured by this investigation.

It also adds a selected processor and a PCM copy capped at **64 MiB**. That cap does not include source buffers, analysis, video, or processor scratch memory. Real-time CPU cost and battery use were not benchmarked here. The existing prototype falls back when its accepted layout, full device-rate input, or memory requirements are unmet.

The 7.1 listening policy is unchanged: verified channels are combined into stereo, with an additional retained raw center plane supporting Listen controls before stretching. Center Only selects the center channel's entire contents, which can include effects and noise. It is not dialogue-source separation. Original files, multichannel analysis, waveform/spectrogram data, and native 1× playback remain unchanged.

## Input and environment

- Input: H.264 High, 1720×720; FLAC, 48,000 Hz, 8 channels, 7.1.
- Video starts at 0; the audio track starts at **0.166 s**. The test preserved this leading interval in its timeline mapping.
- Source SHA-256: `78ea9fe777d6c5eadfdcaedf79b32df0438183b6b3cf9c70d3194dc2ae8fb59e`.
- The similarly named `(1)` download has the same SHA-256; there is no content ambiguity between these two local files.
- WarpDiff `d244e2e`, local version 3.17.6; pinned shared playback component 0.1.0 / Signalsmith Web 1.3.2 default DSP.
- Isolated, physically muted headless system Chrome 153; 48 kHz AudioContext; `http://localhost:8080/?slowAudio=signalsmith`.
- The prepared listening buffer has three planes: Full Mix L/R and raw center. Its duration is 13.765167 s. Source analysis supplied a center sample peak of 0.55974388 and other-channel stereo peak bound of 0.49336163.

## Measurements

The narrow inspection interval was source timeline **2.55–3.00 s**, surrounding the user's 2.775 s report. Offline processing used the entire input, with a 0.5 s scheduling lead and the 0.166 s source offset retained. It was cropped after rendering; the processor did not start at the excerpt boundary.

### Gain and headroom

The requested +11 dB corresponds to a nominal gain of 3.5481. Existing source-peak protection applies **−3.12497 dB** of headroom, leaving an effective **+7.87503 dB** relative to Center Only at 0 dB. The raw-center-to-each-ear coefficient is 1.75080074, including the existing −3 dB center-to-stereo contribution. No new limiter, EQ, de-esser, or audition normalization was added.

### Around the reported passage

| Path | Sample peak, dBFS | Oversampled true peak | Samples above full scale |
| --- | ---: | ---: | ---: |
| Center +11 dB input, unstretched | −2.08 | −2.0 dBFS | 0 |
| Center +11 dB, isolated default processor, 0.5× | −3.52 | −3.5 dBFS | 0 |
| Center +11 dB, live app, 0.5× | −3.80 | −3.8 dBFS | 0 |
| Center 0 dB, isolated default processor, 0.5× | −11.39 | Not measured | 0 |
| Full Mix, isolated default processor, 0.5× | −4.53 | Not measured | 0 |

All inspected/rendered samples were finite. The entire isolated center +11 dB render peaked at −1.67 dBFS; the 12 s live capture peaked at −0.71 dBFS. Neither had samples exceeding full scale. True peak was measured around the reported passage, not over every output file.

### Live transport

The capture began before playback and lasted 12 output seconds, covering the reported passage. The trace records 20 ms observations of media time, processor anchors, native/processed gains, and output timestamps, plus media events.

- An initial anchor was replaced near media time **0.217 s**, early in startup.
- The replacement anchor then remained unchanged through the reported passage.
- Across media time 2.50–3.05 s, the native branch gain remained 0 and the processed branch gain remained 1.
- No seek, waiting, speed, or Listen changes were introduced around the passage. This steady-playback run does not rule out problems during separate interactive changes in the user's session.
- No page errors occurred. Clear returned selected/retiring processor PCM to 0 and released the app AudioContext reference.

These measurements rule out observed digital overload and a coincident transport correction in this capture. They do not rule out physical playback-device distortion, prove source fidelity by listening, or identify the exact perceived artifact. Live and isolated renders need not be sample-identical: their starts and processing histories differ.

## Reproduction and retained artifacts

All source media and audio outputs remain outside the repositories:

`/Users/jay/Documents/warpdiff-audio-check-2026-09-22/`

- `inspect-harshness.mjs` — local isolated-browser reproduction, with fixed input/output paths for this report.
- `harshness.json` — full numeric record and live timing trace.
- `center11-input.wav` — existing Center Only mix, before stretching.
- `center11-half.wav`, `center0-half.wav`, `full-half.wav` — full offline renders.
- `center11-live.wav` — 12 s recording of the live app's listening output.
- `center11-half-passage.wav`, `center11-live-passage.wav` — 2.2 s output excerpts corresponding to source timeline 2.30–3.40 s; no level normalization or fades added.

Run the reproduction with the local server available:

```sh
node /Users/jay/Documents/warpdiff-audio-check-2026-09-22/inspect-harshness.mjs
```

The true-peak measurements use FFmpeg's `atrim` followed by `ebur128=peak=true`. Offline half-speed source interval 2.55–3.00 s maps to output 5.10–6.00 s. The live interval uses the recorded processor anchor and capture start time, accounting for the audio track's 0.166 s leading interval. Excerpts likewise use the recorded mapping.

Compact results and SHA-256 hashes of the local reproduction, full trace, and retained audio are in `slow-playback-harshness-verification-2026-09-22.json` beside this report. A gain-normalized waveform comparison is retained in the full trace; it is explicitly not a perceptual-quality score and is not used to claim the artifact is fixed.

No playback implementation or dependency changed, so the app regression suites were not rerun. Verification consists of the real-file offline/live captures, digital-level and true-peak checks, timing observations, teardown observation, and documentation whitespace check. The first design-article URL failed; the same author's `.co.uk` site supplied the primary source. No subjective quality acceptance or production-readiness claim is made.
