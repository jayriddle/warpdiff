# Continuous scrubbing: implementation and verification record

## Result

WarpDiff 3.16.0 makes Continuous the standard drag preview and prepares its video listening audio directly from the full-rate decode. The Snippets/Continuous selector is removed; clicking still auditions a short preview. Automatic short previews remain available when Continuous cannot run.

The reusable controller is WarpScrubAudio 1.1.0, pinned to WarpCap commit `930c6b29d13e0ee94ae6f149617c6825d8194165`. The pitch-preserving processor itself is unchanged. This continues the shared-component architecture while leaving playback, inspection, selected-video ownership and task hosting with their existing owners.

## What changed and why

1. **Removed the 22.05 kHz intermediate.** Ordinary video preview now uses mono/stereo audio at the audio device’s rate. Same-rate mono/stereo is reused; surround is folded into a separate listening copy. This avoids throwing away high-frequency content and then increasing the sample rate again before Continuous processing.
2. **Protected original analysis.** Waveforms, spectrograms and loudness are computed before the listening copy. The N view now shares those original-analysis aggregates instead of rebuilding them from preview PCM. Original source channels and metrics remain independent of the stereo listening mix.
3. **Bound retained preview memory.** Each video listening copy has a 64 MiB limit, and the selected Continuous processor has a separate 64 MiB limit. At 48 kHz, each limit holds approximately 175 seconds of stereo. A long video uses the highest fitting short-preview rate from 22.05, 16, 11.025 or 8 kHz; if none fits, normal playback and inspection remain available with an explanation. Decode/analysis storage, audio-only originals, Opus replacement playback, temporary processing and graphics are outside these limits.
4. **Added explicit filtering for rate reduction.** A test found that browser offline conversion could turn a 15 kHz input into an unwanted 1 kHz tone when reduced to 8 kHz. The new centered filter suppresses that alias, preserves the low-frequency signal and stereo phase, and does not shift the impulse’s peak on the timeline. It works in cancellable slices without creating a full-rate intermediate listening copy.
5. **Fenced asynchronous preparation.** Video preparation is serialized across slots. Clear/replacement checks run before allocation and before publication; obsolete filtered work can stop between slices. Source switches keep only the selected continuous stream, with the existing short outgoing fade.
6. **Updated the interface and documentation.** Continuous applies automatically even if the browser saved an old Snippets preference. Volume, mute, clicks, idle fade, backward dragging, actual audio-start silence, and the single-video versus Grid clock policies are preserved. Version, offline cache, Manual, Features, Getting Started and What’s New are aligned.

## Checks and observed results

- Full-rate test: a 16 kHz tone retains its expected amplitude; stereo channels with opposite phase remain independent. The previous version reported 22,050 Hz where 48,000 Hz was required.
- Surround test: center-only 7.1 audio reaches both listening channels at the expected level; loudness still reports eight original channels. Both analysis views reuse original data.
- Memory test: a deliberately reduced test budget exercises the real fallback path with a small signal. The 500 Hz tone survives; the unwanted 1 kHz alias is suppressed; short preview sources remain available. Oversized Continuous preparation is rejected before loading or copying, and oversized custom output is rejected too.
- Cancellation test: clearing during one active and one queued preparation prevents either old slot from returning; the newly loaded stereo buffer wins. The shared filtered converter also stops between slices when cancelled.
- Browser interaction checks cover forward/reverse dragging, clicks, mute, idle, Grid source switching, audio-only scrubbing, and released memory after clear. Generated-fixture screenshots were inspected at 1920 × 1080 and 1280 × 720; transport controls remain reachable.
- Final full WarpDiff browser run, without concurrent probes: **212 passed, one skipped**.
- WarpDiff ownership checks: **397 passed**. WarpCap logic checks: **1,206 passed**; CI checks passed. Shared-component browser checks all passed.

### Test failures retained in the companion audit

The initial WarpDiff suite passed 211 tests and skipped one; an audio-switch probe read a routing node before decode created it. The test now waits for its actual audio inputs and also requires a nonzero signal. The next suite passed 210 tests and skipped one, with two timing-sensitive playback failures. Those two tests and the corrected audio-switch test then each passed three isolated repetitions, nine passes total. No transport code was changed to satisfy them. The final full run without concurrent browser probes then passed all 212 non-skipped cases, with one skip; that log is retained separately.

WarpCap’s full run passed 332 tests and skipped two optional reporter-file cases. A comparison-authoring preview test encountered a missing video during readiness, causing nine later cases in its serial group not to run. The failed case and those nine cases all passed on rerun without product or test edits: 342 non-skipped cases covered across the runs. This intermittent readiness issue remains visible in the retained evidence.

## The stripped movie clip

The user-selected H.264/8-channel FLAC file was tested locally; no movie frames, audio samples or media bytes are retained in either repository.

| Property | Observed result |
|---|---|
| Listening audio | 2 channels, 48,000 Hz, 13.344 seconds |
| Original analysis | 8 channels, 48,000 Hz, 13.344 seconds |
| Audio start | 0.166 seconds |
| Integrated loudness / range / true peak | −31.8 LUFS / 5.2 LU / −10.5 dBTP, unchanged |
| Stored video listening PCM | 5,124,096 bytes |
| Selected Continuous PCM | 5,124,096 bytes |
| Forward/reverse scrub and idle | Active in both directions; stops at rest |
| Clear | No stream node; active and retiring PCM counters both zero |

The prior preview buffer was eight channels at 22.05 kHz. For this clip, combined retained preview PCM falls from 14,539,664 to 10,248,192 bytes, about 29.5%, while improving its input bandwidth. These figures exclude original decode/analysis and other browser allocations. The separate WarpSonic probe also confirms original 8-channel decode, stereo listening, actual audio start, normal playback progress, reverse scrubbing and cleanup.

## Limits and next step

Automated output measurements establish signal properties, timing and lifecycle behavior; they do not establish listening preference. Continuous can still soften attacks because of time stretching. The next manual step is to listen to this full-rate version, including slow dialogue and rapid direction/source changes.

These are local changes. Push/deployment and WarpCap’s bundled WarpDiff update remain held; WarpCap still bundles 3.14.5. Detailed logs, original failures, probe metadata and generated-fixture screenshots are retained in the companion WarpCap audit named `2026-09-15-full-rate-scrub`. Original historical evidence has not been rewritten.
