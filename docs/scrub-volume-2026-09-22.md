# Scrub volume: correction and verification

## Outcome

Jay clarified that “presence” means volume. Local **WarpDiff 3.17.7** now compensates
for level lost inside Continuous time stretching. It follows the selected source
mix; it does not apply EQ or normalize every clip to one loudness. Normal playback,
the separate Signalsmith experiment, source files and original analysis are unchanged.

This is ready for listening acceptance. It has not been pushed or deployed.

## What changed, and why

The earlier controlled 7.1 reference and movie tests found about 2–3 dB of lost
level during slow speech. Channel preparation, center gain and the steady master
fader were already correct. The correction therefore belongs to the shared audio
processor, rather than another surface-specific volume slider.

- The canonical component compares the source mix's local power envelope with
  the stretched passage, with 150 ms averaging and a 60 ms gain response.
- One gain serves both ears, preserving stereo placement. Added gain is capped
  at 6.02 dB; source silence and quiet/loud differences are retained.
- One completed synthesis hop looks ahead for peaks. Gain ramps back toward unity
  before a boost would push samples past 0.95. This avoids hard clipping. An
  existing overload is not repaired or given additional gain.
- Stable 1× reconstruction stays at unity; the regression proves identical samples
  with the correction on/off. Reanchor clears correction history, end drains the
  pending hop, and disposal releases it.
- Fixed processor scratch grows by 8 KiB. The extra pending hop uses the existing
  ring; output sample placement and transport time are unchanged. Analysis reads
  up to one extra hop ahead (10.7 ms of synthesis at 48 kHz), so control changes can
  take that extra hop to reach the output. CPU/battery cost has not been benchmarked.

Shared component **1.3.0** is implemented in WarpCap checkpoint `881954a` and pinned here. WarpDiff enables
`matchSourceLevel`; WarpSonic keeps the default off. That gives later surfaces the
same reusable implementation without silently changing WarpSonic's accepted sound.
WarpCap's bundled WarpDiff is not refreshed.

## Measured result

Forward **RMS level difference from the same source mix**, in dB:

| Passage / Listen | Speed | Before | After |
| --- | ---: | ---: | ---: |
| Movie / Full Mix | 0.5× | −2.03 | +0.03 |
| Movie / Full Mix | 0.25× | −2.77 | +0.17 |
| Movie / Center Only +11 | 0.5× | −2.20 | +0.02 |
| Movie / Center Only +11 | 0.25× | −2.93 | +0.18 |
| Reference voice / Center Only +11 | 0.5× | −0.73 | +0.02 |
| Reference voice / Center Only +11 | 0.25× | −2.46 | −0.11 |

The movie is `de3f59c8de544e18.mp4`; comparison covers timeline 0.70–6.30 s,
preserving its 0.166 s audio offset. The synthetic 7.1 reference uses 8.20–15.80 s.
Chrome 153 browser captures reproduce the isolated processor results. A second 7.1 movie (`505a…sync-fixed`) stays within 0.10 dB in both Listen
modes at half/quarter speed. All eighteen browser renders were finite with no above-full-scale samples; FFmpeg true-peak
checks stayed below full scale.

This is not a promise of identical perceived loudness. EBU R128 integrated
loudness in these corrected forward examples is +0.1 to +0.8 LU above the source;
time stretching, spectral differences and gating change that measure. The earlier
[baseline record](scrub-presence-reference-2026-09-22.md) remains preserved.

## Verification

- **16 processor properties:** 0.1–4× in both directions; 0.02×/held-picture changes;
  unchanged 1×; preserved 20 dB quiet/loud difference; linked stereo gain; center
  listening; bounded boost; active peak protection; silence, restart and disposal.
- **23 focused WarpDiff browser checks:** the actual selected engine's output,
  pointer direction/mute/idle, channel routing, source handoff, Listen controls,
  full-rate preparation, budget fallback and cancellation.
- **39 WarpCap browser checks:** existing WarpSonic scrub/playback, shared controller,
  channel/focus behavior and actual memory retirement.
- **1,206 canonical logic checks**, nine existing monitor properties, canonical CI/type
  and audit-retention gates, and **430 WarpDiff ownership checks** pass.
- **Real-pointer reference probe:** Full Mix and Center Only +11 each had 96 active
  observations and one initial anchor during a five-second drag. Holding/releasing
  stopped sound. Native 7.1 coefficients matched their known signals; original
  metrics stayed byte-equal. Clear returned selected/retiring PCM to zero and
  released the context reference. No page errors occurred.
- Restoring the historical canonical processor makes the level properties fail.
  Restoring WarpDiff's historical adapter makes its browser regression fail at
  **2.323 dB loss**. Current implementations were restored after both checks.

The full app suites were not repeated for this bounded DSP change; the affected
audio/routing/lifecycle checks passed without retries. The restored-adapter volume
regression passed again after historical injection.

These browser sessions were isolated and physically muted; the user's browser
was not controlled. Fixed-rate captures isolate audio processing; the live pointer
probe separately checks control continuity and does not establish subjective quality.

## Rejected version and remaining limits

The initial compensation prototype matched average volume but overloaded the
center at 0.1× (approximately 1.26 peak, 324 over-range samples). It was rejected.
The completed-hop peak guard removes those overloads in the measured passage.
An initial diagnostic text insertion targeted the other processor's write index;
unchanged measurements exposed it, and the probe was corrected before accepting
results. Neither rejected result was treated as a successful fix.

The cap and headroom protection can leave residual loss. The movie's reverse cases
were within 0.17 dB, but synthetic speech remained **3.19 dB quieter at reverse
0.5×**, and 0.90 dB quieter at reverse 0.25×. The cap is deliberately retained.
Across 24 isolated forward/reverse renders, maximum slow-output true peak was
−0.4 dBFS; the guard is still a sample-peak bound, not a universal true-peak limiter.

Time-stretch texture and softened attacks remain possible. This does not establish
a resolution to the separate Signalsmith harshness report at 2.775 s. Physical-device
response, cross-browser listening and human preference remain unverified.

## Reproduce and try

Serve the local app and use the existing reference or a verified surround clip:

```sh
node scripts/measure-scrub-presence.mjs /path/to/presence-7.1.mp4 /path/to/results 8 16
node scripts/measure-scrub-presence.mjs /path/to/de3f59c8de544e18.mp4 /path/to/movie-results .5 6.5
```

The tool saves captures externally and checks the actual pinned DSP. It now enables
the same matching option as the adapter. The existing generator creates the eight-channel
reference with separate stems. [Verification JSON](scrub-volume-verification-2026-09-22.json)
retains hashes, gain plans, measurements, gesture summaries and reconstruction limits;
private audio remains outside Git.

Reload local WarpDiff and confirm **3.17.7**. Compare ordinary play with slow forward
dragging, first Full Mix, then Center Only +11 around the reported 2.775 s passage.
The acceptance question is whether volume is closer without pumping between words
or introducing harsh attacks. Listening acceptance remains pending.

## Follow-up — 2026-09-23

The reverse-speech limitation above was investigated in shared component 1.3.1 / WarpDiff 3.17.8. The [follow-up record](reverse-scrub-volume-2026-09-23.md) explains the increased correction allowance, unchanged peak protection, measured improvement, rejected alternatives and remaining limits. The measurements in this original report describe 1.3.0 and remain preserved.
