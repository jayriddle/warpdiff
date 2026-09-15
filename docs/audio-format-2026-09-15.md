# Video audio-format readout — 2026-09-15

## Result

WarpDiff 3.17.1 adds source audio information to video info bars in Grid and the active-video header in Stack. Examples are **FLAC · 5.1 · 48 kHz**, **FLAC · 7.1 · 48 kHz**, and **AAC · Stereo · 44.1 kHz**. Hover for the complete information when space is limited.

This answers the request to identify what kind of audio a video contains. It uses the loaded file's metadata; selecting Center Only or preparing a stereo listening copy does not turn the source label into “Mono” or “Stereo.”

## Implementation and decisions

- Extended the existing metadata-only MP4 parser to return small records for each audio track. The existing WebM parser now has a metadata-only path that skips audio packet copies. Both use bytes already read for audio preparation; this does not add another file read, decode, or retained PCM buffer.
- Read FLAC rate and channel count from STREAMINFO, and AAC channel declarations from AudioSpecificConfig. MP4 sample-entry channel counts can be placeholders: the real AAC 5.1 fixture has a two-channel sample-entry header. Explicit and implicit HE-AAC extensions are also checked so the label does not report the mono, half-rate core of a stereo HE-AAC stream. Protocol checks used the [FLAC specification](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.2) and [FFmpeg's MPEG-4 audio configuration reader](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/mpeg4audio.c).
- Identify MP4 Opus from its declaration and channel header; show its 48 kHz decode clock instead of the encoder's original input-rate hint, following the [Opus MP4 mapping](https://opus-codec.org/docs/opus_in_isobmff.html). Identify WebM Vorbis separately from Opus using [Matroska track metadata](https://www.matroska.org/technical/elements.html). Recognize declared Dolby, DTS, ALAC, and PCM formats without assuming every MP4 contains AAC.
- Show 5.1/7.1 only with verified layout metadata. Otherwise show the declared count, such as “8 ch,” or omit unavailable fields. AAC with a custom Program Config Element does not inherit a misleading stereo placeholder.
- Count and list multiple audio tracks, including each track's known format. Do not imply that WarpDiff knows which track the browser selected for playback. A container declaring no audio gets “No audio track”; unreadable metadata gets “Audio: Unknown.”
- One generation-checked writer publishes the per-video readout. Clearing/reloading drops it with the asset. An obsolete decode cannot relabel a new file, and an in-browser transcode reports the newly loaded AAC format.
- Grid bars with source metadata use tighter spacing and reserve a small hoverable width for the label. This keeps a single-row bar while retaining the existing loudness metrics and zoom readout.
- Updated the app/cache version, What's New, README, Features, Manual, in-app Manual, and architecture notes. The shared scrub component and its WarpCap pin are unchanged.

## Verified source files

Independent FFprobe output and muted headless Chromium agreed on both user-provided clips:

| File | Readout |
| --- | --- |
| `7df491ce6c3e8076-stripped.mp4` | FLAC · 5.1 · 48 kHz |
| `3ed42143c3ef7772-stripped.mp4` | FLAC · 7.1 · 48 kHz |

Both clips loaded without browser script errors. Additional browser checks covered FLAC 5.1/7.1, AAC 5.1 and stereo, Opus 7.1, WebM Vorbis, a real AC-3→AAC transcode, stale completion after reload, and clearing from video to image. A separate two-audio-track MP4 correctly listed FLAC 7.1 and AAC stereo. A video without audio displayed “No audio track” in both views.

## Verification and corrections

- Ownership/pure-logic checks: **420 passed**. New cases cover real codec fixtures, explicit/implicit HE-AAC, custom AAC channel configuration, DTS carried by `mp4a`, multiple tracks, unknown layout, malformed containers, and source-metadata ownership.
- Focused browser checks: **9 passed**, including the narrow two-video Grid layout.
- The first focused run passed seven cases and failed one Grid visibility assertion: Escape correctly returned focus to the Listen control, which keeps its keyboard events local. The test needed to leave that control before pressing G. A subsequent test-only attempt to use the Grid icon also failed to enter Grid from the single-clip layout; the final test explicitly clicks the source field and presses G. Neither failure involved an incorrect format label. The first full run had those six navigation failures, 231 passes, and one optional skip; the corrected focused run passed all eight cases.
- Final complete browser run: **238 passed, 1 skipped**, with four workers and no retries (4.0 minutes). The existing timestamp-collision toast case is skipped because it needs dedicated near-identical-timestamp fixtures. All source-format, dialogue-listening, scrubbing, restart, switching, and playhead tests passed.
- A visual check at 1024×768 found the new label could shrink to zero width in a two-video Grid. Tighter spacing and a 50 px minimum fixed this; the dedicated test also checks that zoom stays inside its bar.
- An intermediate complete run had one existing hidden-follower drift test fail (mean drift 44.69 ms against its 21 ms limit), with 236 passes and one skip. Separate browser layout probes were running during that suite; the cause was not established. The same case had passed in the earlier complete run and passed **three of three isolated repeats** without changes to transport code or test thresholds. The final complete run uses no concurrent visual probes.

Reproduce with:

```sh
node tests/ownership.test.mjs
npx playwright test tests/audio-format.spec.ts --workers=1 --retries=0
npx playwright test tests/warpdiff.spec.ts --grep 'hidden follower converges without a seek storm' --workers=1 --retries=0 --repeat-each=3
npx playwright test --workers=4 --retries=0
```

## Limits

This is a metadata readout, not a track selector or a full media inspector. Unsupported/custom declarations can show only a codec or a channel count. It does not infer a surround layout from channel count, identify object-based extensions such as Atmos, or report bitrate/bit depth. Narrow info bars shorten the visible text; the hover detail remains complete. Original playback, scrubbing, timing, and analysis are not changed by the readout.

## Delivery

Saved as a local checkpoint on `codex/shared-scrub`. Push and deployment remain pending. Refresh the local WarpDiff app to load version 3.17.1.
