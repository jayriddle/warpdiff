# Backward scrub volume: investigation and correction

## Outcome

Local **WarpDiff 3.17.8**, using shared scrub component **1.3.1**, recovers the
measured remaining volume loss in backward speech. Some material lost more level
inside time stretching than the previous 6.02 dB compensation could recover.
The correction now permits up to 12.04 dB, according to measured source/output
power and available peak headroom. There is no fixed backward-volume boost.

This is a local checkpoint for listening acceptance; it has not been pushed or
deployed. The historical [3.17.7 record](scrub-volume-2026-09-22.md) is preserved.

## What the investigation established

The generated 7.1 speech reference lost about **9.18 dB** before compensation at
reverse half speed. The previous 6.02 dB allowance left about **3.19 dB** missing.
Its requested correction hit that ceiling in approximately 98% of active
observations. Changing the reverse starting position did not remove the loss.

Running the same samples in reverse order through the forward processor produced
the same loss. This identifies a content/phase interaction in the existing
time-stretch processor, rather than a separate reverse gain or channel-routing
mistake. The two movie passages had much smaller residual differences already.

Alternatives tested and rejected:

- Higher phase precision and bounded phase accumulation did not resolve it.
- Resetting phase around silence or weak frequency bins gave inconsistent results
  and could reduce forward speech level.
- Twice as many overlapping frames added processing work without resolving the
  speech case.
- Sine/square-root-Hann windows improved that reference, but changed the processor
  more broadly and produced raw peaks above full scale in the Center Only +11
  movie at 0.1× (approximately 1.008 forward and 1.057 reverse). The existing
  added-gain guard cannot repair overloads already present before compensation.
- Intermediate window shapes were also content-dependent. None was adopted.

The chosen correction retains the existing FFT, windows, overlap, source-power
measurement, 150 ms averaging, 60 ms gain response and peak lookahead. It changes
only the maximum permitted additional gain, owned by the shared processor.
An added internal `maxGain` field supplies the same limit to ordinary, silent
and final-hop handling. No new surface control or preference is required.

## Measured result

RMS volume difference from the same source mix, in dB. Positive values are slightly
louder; negative values are quieter. Reference voice uses **Center Only +11**:

| Direction / speed | Previous correction | New correction |
| --- | ---: | ---: |
| Backward 0.5× | −3.19 | +0.07 |
| Backward 0.25× | −0.90 | +0.12 |
| Forward 0.5× | +0.02 | +0.02 |
| Forward 0.25× | −0.11 | −0.07 |

The previous column comes from the isolated 1.3.0 processor; the new column is
Chrome 153 output through WarpDiff's selected listening engine. The same source
interval excludes 0.2 seconds at each edge. For Full Mix, the new reference's
backward differences were +0.11 dB at half speed and +0.37 dB at quarter speed.
Peak headroom makes the compensation depend on the selected listening level.

Both 7.1 movies (`de3f…` and `505a…sync-fixed`) stayed within **0.20 dB** of their
selected source mix in both directions at half and quarter speed. The first
movie's 0.166-second audio start remains accounted for. Analysis uses movie
timeline 0.70–6.30 s and reference timeline 8.20–15.80 s.

All **36 browser captures** (three sources, two mixes, three speeds, two directions)
were finite, with no samples above full scale. Their maximum slow-output true
peak was **−0.4 dBFS**, measured independently with FFmpeg. Integrated loudness
differences ranged from −0.2 to +1.2 LU; time stretching changes the spectrum,
duration and loudness gating, so RMS matching does not imply identical LUFS.

Twelve additional 0.1× processor renders (three sources, both mixes and directions)
stayed within −0.05 to +0.27 dB RMS of source, with a maximum sample peak of 0.95,
maximum measured true peak of −0.4 dBFS, and no nonfinite or overloaded samples.
These isolate the shipped processor; the browser captures above cover its actual
WarpDiff integration.

## Regression and lifecycle verification

- **18 processor properties** pass: both directions at 0.1–4×, minimum-speed/held
  picture transitions, unchanged 1× samples, preserved quiet/loud differences,
  linked stereo gain, center listening, peak headroom, silence, restart and disposal.
  Two new sustained-voice cases exercise losses larger than the previous allowance.
- Restoring canonical processor `881954a` makes both new voice cases fail; the
  current processor was restored. The raw-signal control verifies substantial
  loss, so the test is not passing on an unaffected input or silence.
- The actual WarpDiff engine's new reverse browser regression fails at **6.36 dB
  loss** with the old pinned processor. Its forward control still passes. Both
  pass with component 1.3.1. This uses a deterministic harmonic voice; no private
  movie is required for the regression.
- **24 focused WarpDiff browser checks** and **39 canonical WarpCap/WarpSonic
  browser checks** pass without retries. They cover real pointer reversals,
  source handoff, Listen routing, full-rate input, fallback/cancellation, and
  processor lifetime. The complete unrelated app suites were not repeated.
- A separate five-second backward pointer drag in each Listen mix had **97 active
  observations**, one initial anchor, reverse direction throughout, and a steady
  master gain of 1. Release stopped the preview. Native 7.1 coefficients matched
  the reference; original metrics stayed byte-equal; clear released selected and
  retiring PCM and the context reference. No page errors occurred.
- Canonical logic: **1,206 passed**; **430 WarpDiff ownership checks**, canonical CI/type/monitor checks and the audit-retention gate passed. The final committed source pin is recorded in WarpDiff’s lock file.

All browsers were isolated and physically muted. The user's browser was not
controlled. The live pointer probe checks control continuity, not subjective
audio cadence or sound quality.

## Tradeoffs and remaining limitations

Restoring more volume can make existing stretching artifacts more audible. This
does not repair the reported harsh sound near 2.775 s or promise identical perceived
loudness. Loud peaks and the finite correction allowance can still leave some
passages quiet; extreme sustained harmonic probes demonstrate that limitation.
The guard limits added sample gain, not true peaks or pre-existing clipping.

Source files, original multichannel analysis, ordinary playback, Listen policy,
transport time and stereo placement retain their owners. The cap increase adds
no FFT work or buffer allocation; CPU/battery behavior has not been benchmarked.
WarpSonic keeps source-level matching off by default. WarpCap's bundled WarpDiff
and the separate Signalsmith playback experiment remain outside this change.

## Reproduction and evidence

The [numeric record](reverse-scrub-volume-verification-2026-09-23.json) retains
source hashes, source intervals, processor exploration, browser measurements,
independent loudness checks, live-gesture results and exact shared-source hashes.
Private media bytes and generated WAV captures stay outside Git.

From WarpDiff, with the local server running and the verified reference available:

```sh
node scripts/measure-scrub-presence.mjs REFERENCE/presence-7.1.mp4 RESULTS_REFERENCE 8 16 both
node scripts/measure-scrub-presence.mjs MOVIE.mp4 RESULTS_MOVIE .5 6.5 both
npx playwright test tests/continuous-scrub.spec.ts tests/full-rate-scrub.spec.ts tests/dialogue-listening.spec.ts --workers=1 --retries=0
node tests/ownership.test.mjs
node scripts/vendor-scrub-audio.mjs --check --repo ../WarpCap
```

The measurement tool now accepts `forward`, `reverse` or `both` as its last
argument; existing callers default to forward. Reverse WAV names include
`-reverse`. Each output is measured over `0.2/rate` to `(span−0.2)/rate`, compared
with the corresponding source interval adjusted for the audio start.

For listening acceptance, reload local WarpDiff, confirm **3.17.8**, and compare
ordinary play with slow backward dragging in Full Mix and Center Only +11.
Check both level and attacks; human listening remains the final quality check.

## Local checkpoint

Canonical component 1.3.1 is committed at `03eb2a303ddd30a7fe24610050ada90afe1bbdaf`.
WarpDiff pins that exact commit with `workingTree:false`; the vendor check proves
byte equality against canonical Git contents. The post-pin ownership gate passes
all 430 checks. APP_VERSION, service-worker cache, README, What’s New and affected
manual/feature descriptions are aligned at 3.17.8. No runtime audio code changed
after the successful browser/processor captures. Nothing was pushed or deployed.
