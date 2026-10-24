# Adversarial review of WarpDiff main — October 23, 2026

Reviewed revision: `312536c2970bb8f21fa8f99feb0d4067a41a50e3`, version **3.19.13**. Local `main` and GitHub `main` agreed when checked. This is a review of current behavior, including older code; the findings are not attributed to the latest documentation-only commit.

The review is read-only for product code. Its scope includes manual and managed loading, preparation admission/cancellation/recovery, native and replacement audio routing, scrub rendering and resource ownership, preference failures, and staged/offline updates. Findings require a concrete trigger and source evidence; browser reproductions use real generated media and ordinary Load/transport controls without replacing app implementations.

## Findings

### R1 — P1: multi-track WebM silently switches to the last soundtrack

**Location:** `js/mp4-demux.js:479–480`, with the MP4-only ambiguity check at `js/audio-decode.js:163` and replacement activation at `js/audio-decode.js:354–366`.

Every supported audio `TrackEntry` overwrites `audioTrackNum`, so WebM extraction uses the last Opus/Vorbis track. The main decode owner applies its track-ambiguity guard only to MP4. Chrome then treats the resulting Opus PCM as authoritative, mutes the native soundtrack and installs replacement playback. The format description still says that the browser selects the playback track.

**Reproduction:** load `two-audio-tracks.webm`, a three-second VP9 file with two mono Opus tracks. The first/default track is a 440 Hz sine; the second/nondefault track is 880 Hz. In bundled Chromium and installed Chrome, native `decodeAudioData` returns the first track (440 Hz amplitude about 0.124934; 880 Hz amplitude about 0.0000039). WarpDiff's analysis/listening buffer instead contains the second track (880 Hz amplitude 0.124986; 440 Hz amplitude 0.0000022), with `_opusSyncSlots.editA === true`, no track issue, and analysis available. These are distinct soundtracks, not an A/V offset or small decoding difference.

A separate **live playback** probe in Chrome **156.0.8078.47** confirms the audible source switch. A standalone native video produces a 440 Hz amplitude of 0.124923 and an 880 Hz amplitude of 0.000130. WarpDiff's running replacement produces 880 Hz at 0.124997 and 440 Hz at 0.000139; the native video is muted, replacement is active and its output gain is 1. Measurements use the live audio graph, with headless speaker output muted by the browser launch flag; this is signal evidence rather than a physical listening test.

**Impact:** a review can hear, scrub, and measure a different language/commentary/mix from the browser's selected soundtrack, without an ambiguity warning.

**Suggested repair:** apply a unique-track selection contract to WebM before either native analysis or WebCodecs replacement. When browser track identity cannot be established, retain native playback and withhold decoded tools, as the MP4 path already does. Add a real two-track fixture that distinguishes both analysis and actual playback.

### R2 — P2: a short Opus soundtrack truncates the video review timeline

**Location:** `js/audio-decode.js:354–363` and `index.html:9090–9095`.

`_finalizeAudioViz` sets `_opusSyncDuration` to the decoded audio end. `_getEffectiveDuration` unconditionally substitutes that value for the video duration. This assumes audio duration establishes picture duration, even when the picture legitimately continues after the sound ends. `_startOpusSyncAudio` itself already recognizes that a video can outlast its audio.

**Reproduction:** load `opus-short-track.mp4`, a valid five-second H.264 picture with a two-second Opus soundtrack. The native media element reports 5.000 seconds; WarpDiff reports an effective duration of 2.000 seconds. Clicking 90% of the visible progress slider seeks to **1.799617 seconds**, rather than about 4.5 seconds. An otherwise equivalent AAC control reports 5.000 seconds and seeks to **4.499044 seconds**.

**Impact:** the last three seconds of valid picture are excluded from the scrub timeline and duration-dependent controls. This reproduction establishes timeline/seek truncation; it does not claim that native playback necessarily stops at two seconds.

**Suggested repair:** establish the picture's end independently of decoded audio. Preserve the full picture timeline when a soundtrack ends early; any correction for genuinely inflated container duration must be supported by video timing evidence. Cover shorter and longer soundtracks, including delayed starts and Solo/custom-loop consumers.

### R3 — P2: ordinary metadata containing “Opus” activates replacement audio

**Location:** `js/audio-decode.js:172–183` and `211–213`.

The Opus decision scans arbitrary bytes in the first and last 64 KiB for the four-character word `Opus`. It does not use the parsed selected track codec. A tag, title, comment or other unrelated bytes can therefore enable `_opusSyncPending`, force WebCodecs, suppress native direct output, and later activate replacement audio for AAC.

**Reproduction:** `aac-control.mp4` and `aac-opus-comment.mp4` both contain five-second H.264 picture and two-second AAC soundtracks. The latter adds only a comment, `Exported by Opus Studio`. Extracted encoded AAC packets have the same SHA-256 in both files: `80f922e5a09a820f44857bf2c935ac456dc2a13d21189c64605d481c67851a05`. Their encoded video packet hashes also match (`47a8db122ea378f09d9eec3e76a6f281df1abff926fdd1a8d765462db2be542d`). The control retains one direct native output and no Opus replacement. The comment-bearing file has no direct native output, enables Opus replacement, and also exhibits R2's two-second timeline. Its displayed source codec remains AAC.

**Impact:** harmless descriptive metadata changes playback architecture and can expose ordinary AAC reviews to Opus-specific duration and synchronization behavior. This is separate from R2: correcting duration alone would still leave AAC on the wrong audio route.

**Suggested repair:** derive replacement eligibility from the uniquely selected, parsed codec and confirm the WebCodecs extraction is actually Opus before publishing replacement state. Unknown or ambiguous codec identity should not authorize replacement. Retain a metadata-only negative control in the browser suite.

## Verification and investigation record

Evidence is retained locally under `output/main-adversarial-review-2026-10-23/`; it is ignored and excluded from Pages. The reusable probes and generated-media instructions are retained alongside their output, without changing the product test inventory.

| Check | Result |
|---|---|
| Ownership / pure logic | 1,728 passed, 0 failed |
| Release infrastructure | 26 passed, 0 failed, 0 skipped |
| First focused Chromium run | 157 passed, 0 failed, 0 skipped, 0 flaky; one worker, zero retries |
| Expanded installed-Chrome run | 100 passed, 0 failed, 0 skipped, 0 flaky; one worker, zero retries; 142.8 seconds |
| Real-media adversarial audio probes | All three defects reproduced in Chromium 145.0.7632.6 and Chrome 156.0.8078.47; unaffected AAC control verified in both |
| Live WebM playback probe | Chrome 156.0.8078.47: native first track versus WarpDiff replacement second track confirmed |
| Focused WebKit run | 103 passed, 0 failed, 0 skipped, 0 flaky; one worker, zero retries; 99.0 seconds |

The first focused run covers native video output, strict host loading, prepared-package import, preparation follow-ups, updates, preferences, media admission/contracts and restart behavior. The audio probe records container metadata, selected buffers, routing state, actual slider seek positions, and zero page errors for all four cases. Passing baseline tests do not negate the additional reproducers; they show that the existing selected coverage does not detect these cases.

The expanded Chrome run covers background analysis cancellation/fallback, color rendering and held-target handoff, native dialog keyboard behavior, info-bar editing/layout/overflow/dragging, actual object cleanup, the connected preparation workflow, encoded scrub-input budgeting/cancellation, and usage daily-claim/update behavior. The WebKit run covers host loading/readiness, native mono/stereo output, preparation follow-ups and prepared-package import. Counts are per run and include overlap; they are not a count of unique behaviors across browsers. All three completed browser reports have zero report-level errors.

Environment: macOS/arm64, Node 26.4.0, Playwright 1.58.2, FFmpeg/ffprobe 8.1.2, bundled Chromium 145.0.7632.6, installed Chrome 156.0.8078.47. No tools were installed or upgraded. Full environment evidence is in `environment.json`.

Primary evidence:

- `audio-probes.cjs`, `audio-probes.json`, `audio-probes.log`: ordinary-load browser reproductions and assertions confirming the observed defects, with control. These assertions are not a passing product regression suite.
- `chrome-audio/audio-probes.json`, `chrome-audio-probes.log`: independent fresh-page repetition of the four input cases in installed Chrome. `native-playback-probe.cjs`, `.json`, and `.log` establish the live playback switch.
- `generate-fixtures.cjs`, `fixtures/metadata.json`, `aac-packet-comparison.json`: real FFmpeg fixtures, ffprobe stream/disposition evidence and identical AAC packet hashes. The generator uses `-n` and refuses to overwrite existing fixture evidence.
- `browser.config.cjs`, `browser.json`, `browser.log`: the 157-case browser run.
- `chrome-extended.config.cjs`, `chrome-extended.json`, `chrome-extended.log`: the complete 100-case Chrome run and its retained browser artifacts.
- `webkit.config.cjs`, `webkit.json`, `webkit.log`: the complete 103-case WebKit run.
- `ownership.log`, `infrastructure.log`, `revision.txt`, `status-before.txt`: initial checks and repository baseline.
- `FINAL-VERIFICATION.json`, `status-after.txt`: consolidated results, findings and repository preservation check. Final local and remote main remained at the reviewed revision; staged and tracked diffs were empty. The only added non-ignored file was this review record; no pre-existing status entries were removed.

**Failed/incomplete run retained:** the first expanded run used bundled Chromium 145.0.7632.6 and completed 12 cases successfully but failed four color-path assertions: staged-base/query/fragment, NV12 BT.709 limited, NV12 BT.709 full, and NV12 sRGB. The first assertion required wide gamut whenever the decoder fell back; the others required either decoder output or a named native-policy case. The browser instead reached fallback on an sRGB surface. These are failed tests, not proof of changed picture color. At the next HEVC case, the run did not finish retiring; SIGINT was sent to the owned runner, then SIGTERM and SIGKILL to its remaining owned worker. It exited 130. The report classifies the remaining 84 cases as skipped, including interruption; they are **unexecuted**, not successful coverage. The result and shutdown detail are preserved in `extended-browser-outcome.json`. The selected 100-case run was then restarted in installed Chrome, the channel used by CI, with one worker and zero retries; its result is recorded in the final verification table.

All four cases passed in installed Chrome, as did the remaining selected cases. No source, assertion, or threshold was changed. This establishes passing coverage for that Chrome version; it does not repair or erase the bundled Chromium failures, which remain a browser/output-path limitation of this local verification.

To repeat the adversarial probes, preserve this evidence directory first. The fixture generator accepts a fresh destination as its first argument and refuses overwrites. `audio-probes.cjs` and `native-playback-probe.cjs` accept `WARPDIFF_REVIEW_CHANNEL=chrome` and a fresh `WARPDIFF_REVIEW_OUTPUT` directory. The browser configs contain absolute paths from this checkout; copy them and select fresh output/report paths before reuse. The normal product regressions retain their original sources and assertions.

## Limits

This is a targeted adversarial source/behavior review, not an exhaustive proof of correctness or a complete browser/device matrix. It does not certify color on physical displays, audible latency on real output devices, professional measurement conformance, complete-file decoding, or all combinations of codecs/containers. No user media was used. Existing untracked project evidence was left in place. No product changes, dependency upgrades, commits, merges or deployments were made.
