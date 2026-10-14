# Non-1× scrub pitch investigation — October 13, 2026

Candidate: local `codex/interim-release-review` at `b17d7b7`, app **3.19.1**.
Jay heard an occasional lower tone in installed Safari with
`ac3_video_aac.mp4`, believes it happened in both directions, and confirms it
did not happen at normal 1× speed. Chrome seemed correct to Jay; the exact
matching Chrome rate and the timing of the Safari sound are not established.

This record captures the original diagnosis before the adapter change. Jay
subsequently authorized the fix; see the [local fix and verification](fix.md).

## Finding

There is a confirmed pitch inconsistency between the brief snippet and
Continuous preview. The app's snippet function applies the selected playback
rate directly to an AudioBufferSourceNode. The Continuous processor retains
the tone's pitch while changing its traversal speed. The snippet does not
reverse its samples, so its pitch shift can occur before either drag direction.

Normal warmed-up test gestures began with one snippet and entered Continuous
preview 100–102.5 ms later. At 1×, both preview paths retain the source pitch.
At reduced rates, the initial snippet has lower pitch. This mechanism closely
matches the reported occasional lower tone, but does not establish that every
sound heard on installed Safari came from that path.

## Measured evidence

The exact prepared file contains AAC LC stereo at 48 kHz and a nominal 440 Hz
tone. It has 1 s of H.264 picture and approximately 0.981 s of decoded audio.
Both browser engines measured the original tone between 439.937 and 440.055 Hz.
The file's SHA-256 is recorded in [results.json](results.json); it was unchanged
after both probes.

| Selected rate | Snippet peak frequency | Continuous peak frequency |
|---|---:|---:|
| 0.25× | 109.94–110.01 Hz | 439.76–440.18 Hz |
| 0.5× | 219.90–220.14 Hz | 439.84–440.16 Hz |
| 0.75× | 329.94–330.12 Hz | Not measured at this tempo |
| 1× | 439.93–440.15 Hz | 439.93–440.07 Hz |
| 1.5× | 660.02–660.09 Hz | 439.97–440.03 Hz |
| 2× | 879.97–880.05 Hz | 439.98–440.02 Hz |

Continuous ranges combine forward and reverse renders in both engines. The
selected playback rate and Continuous tempo are separate controls: the app
derives Continuous tempo from pointer/picture motion. These isolated renders
set processor tempo explicitly to test pitch retention, rather than claiming
that a selected 0.5× playback rate produces an identical Continuous tempo.

There were **32 non-silent offline renders**: six snippet rates and five
Continuous tempos in both directions, repeated in Chromium and WebKit.
There were **12 live path-selection gestures**: 1×, 0.5× and 0.25× in both
directions in both engines. Every gesture recorded one initial snippet,
followed by 11–12 active Continuous ticks, with no engine error. Held movement
gaps were at most 46 ms, below the 130 ms idle cutoff. WebKit's hidden native
audio player's playback rate remained 1× in every gesture; it was not applying
the selected playback speed a second time. Neither probe reported page errors.

## Method and limits

The offline probe loads the actual prepared file through WarpDiff's decode
pipeline. It calls the shipped `playScrubSnippet` function, substituting only
its context and output destination inside an isolated page so an
OfflineAudioContext can collect PCM. It renders Continuous through the pinned
`WarpScrubAudio` 1.3.1 component, appending the same diagnostic message
acknowledgment used by existing offline tests. The acknowledgment ensures
load/play messages arrive before fast rendering; DSP methods remain unchanged.

Frequency estimates use Hann windows, the app's FFT, zero padding and
interpolation around the strongest 50–1500 Hz peak. Reference/Continuous
windows contain 4096 samples; snippets use 2048 samples inside the 90 ms grain,
away from its outer fades. These dominant-peak measurements do not certify the
absence of every sideband, stretch texture or brief transition artifact.

The live probe wraps snippet and Continuous adapter calls solely to record
path selection. Playwright supplies trusted mouse down/up and J/K speed keys.
Held movement runs through actual document handlers at a 40 ms requested
cadence, following the release tests' driver-latency correction. The WebKit
scrub player is muted only in the diagnostic page, and Chromium is launched
with muted output. These gestures measure control flow, not speaker pitch.

Browser versions: headless Chromium 145.0.7632.6 and Playwright WebKit reporting
Safari 26.0 on macOS. This is not an installed-Safari acoustic capture. Exact
user-selected non-1× rate, output device and whether the lower tone lasted only
at the beginning or throughout motion remain unknown. Installed Safari
acceptance stays open; no publication was performed.

## Recommended next change at diagnosis

Make click, warm-up and fallback snippets audition at original pitch too,
using a 1× source rate while retaining their 90 ms output duration and existing
volume, fades, source-selection and cleanup owners. This is a small WarpDiff
adapter policy change; it need not alter the shared pinned DSP or native
playback speeds. The current source comment intentionally describes matching
the selected speed, so record the revised listening policy explicitly rather
than treating that line as an accidental implementation typo.

Verify the actual snippet spectrum at reduced and increased playback speeds,
then the snippet-to-Continuous transition and fallback/clear/mute behavior.
Repeat installed Safari listening with the same AAC file and a known speech
sample. No application, dependency, pinned component or release-version change
has been made during this investigation. The previously passing release gate
does not certify this pitch behavior.

## Reproduction and retained evidence

With the local 3.19.1 preview at `http://localhost:8080/` and the exact prepared
file in `tests/fixtures/`, run from the repository root:

```sh
node tools/investigations/scrub-pitch/measure.mjs
node tools/investigations/scrub-pitch/gesture.mjs
```

The scripts require the existing Playwright installation and its Chromium and
WebKit runtimes. They write raw results to
`output/safari-scrub-pitch-2026-10-13/`, or an output directory supplied as their
first argument. They do not run as release gates or modify application files.
The synthetic prepared media remains gitignored. Missing media or a probe
error causes failure; silent renders and empty frequency windows were also
checked when consolidating this record.

[results.json](results.json) retains browser/source versions and hashes,
per-render frequency ranges/RMS/window counts, and per-gesture path counts,
initial snippet rates, transition timing and engine errors. Full window
frequencies, raw event timelines and console logs remain in the local output
directory. No failing probe needed a retry. The shipped application files and
the two pinned scrub files remained unchanged.
