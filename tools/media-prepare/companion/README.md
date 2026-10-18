# Local preparation companion — development prototype

This prototype tests the workflow “open my files”: choose or drop 1–4 files,
open directly when possible, then **Prepare and open** if picture/audio tools
cannot be used. Preparation requires an explicit click. The returned review
copy opens automatically through WarpDiff's existing host loading and readiness
checks. No manifest, command copying or second file picker is involved.

This is repository-only development tooling, not an installed companion or a
GitHub Pages feature. It wraps the unchanged app in a local managed host.
FFmpeg and ffprobe must be installed separately; no engine is supplied,
downloaded or installed by this tool.

## Try it locally

With an existing Node.js installation supporting the repository's tests and
FFmpeg/ffprobe on PATH, run from the repository root:

```sh
node tools/media-prepare/companion/server.mjs
```

Open the loopback URL printed by the launcher. Choose **Open files…** or drop
files into the page. Direct loading performs no conversion. Where offered,
**Prepare and open** makes local review copies and opens them in the comparison.
**Open anyway** retains available tools without preparation. **Cancel** clears
the current attempt and waits for external work to retire. Selecting new files
also cancels the old job. Stop the launcher with Ctrl+C.

Files go only to the helper on this computer, in a private temporary directory.
The original files are never modified. Successful outputs remain temporary:
after transfer, the browser owns the review copy for this visit and the helper
removes its files. This prototype has no Save copy command. Closing the page
loses that in-memory comparison.

## Preparation policy and limits

- One native job at a time, including upload and result ownership. Sequential
  preparation preserves comparison order and unaffected files.
- Video: one picture stream and at most one soundtrack. Compatible H.264
  yuv420p up to 4096×2160 is copied. Other picture streams are encoded to
  H.264 yuv420p at up to 1920×1080. Video soundtracks become stereo AAC-LC at
  48 kHz. Source timing is retained by FFmpeg's normal muxing behavior; this
  does not certify sample/frame mapping or synchronization conformance.
- Audio-only: one stream, 1–8 channels. PCM24 WAV retains the channel count
  and sample rate. This does not certify speaker-layout preservation or
  perceptual/channel fidelity. Ambiguous multiple streams are rejected.
- Input up to 512 MiB; accepted output up to 1 GiB; bounded declared duration
  up to six hours. Processing has a ten-minute overall deadline. Output
  growth is checked every 100 ms, so temporary disk use can overshoot the
  accepted-output limit before cancellation. These are not whole-process,
  decoded-PCM, browser-memory or hard CPU limits.
- The output is probed, duration checked and fully decoded by FFmpeg before
  it is offered to WarpDiff. The normal loader independently decides whether
  it is initially usable. Neither grants original-source measurements,
  complete-file integrity, exact sync or loudness/true-peak conformance.

## Transport and execution boundary

The server binds only to `127.0.0.1` on a random port. Native execution
requires the exact Host and Origin plus a random per-launch bearer token;
there is no cross-origin permission or CORS endpoint. The parent is not
frameable. Its same-origin comparison iframe uses the existing host protocol
with Blob URLs and reads the public metadata-only capability reports. The
parent alone owns picking, preparation and external-job cancellation.

Media never supplies a shell command, executable, input path or output path.
Native tools receive fixed argument arrays and privately named files.
Protocol/demuxer allowlists reject playlist/network transports. These are
defenses, not an operating-system sandbox for FFmpeg. Use a maintained,
trusted installation. A native tool is still processing selected media.

Cancellation waits for child `close`, escalating TERM to KILL after 500 ms.
Job IDs fence stale cancellation. Pending work retains its reservation until
retirement; browser generations prevent a cancelled result opening later.
Unused completed jobs expire after 60 seconds. Temporary files are removed
on ordinary error, cancellation, release and graceful shutdown. Forced process
or machine termination can leave temporary files; crash recovery is future work.

The helper serves only the app's public runtime allowlist under `/app/` and its
own three UI files. Repository docs, tests, native tools and arbitrary paths
are not served. It is not part of service-worker assets or the Pages package.

## Verification

Existing test fixtures must already exist. Tests generate additional small
media files only in private temporary directories and remove them afterward.

```sh
node --test --test-concurrency=1 tests/local-companion.test.mjs
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test --config=playwright.companion.config.ts
```

The browser tests use one worker and zero retries in Chromium and Playwright
WebKit. They exercise direct loading, real DTS/FFV1 preparation, automatic
return, mixed comparisons, cancellation, file drops, rejected selections and
narrow layouts. Rejected selections preserve the current comparison/job.
Native tests exercise authorization, request limits, exclusive reservation,
stale cancellation, process retirement and real conversion/cleanup.

## Before product integration

This same-origin local wrapper deliberately avoids assuming that a published
HTTPS page can access a loopback helper. Hosted-to-local discovery, permissions
and Safari behavior remain unimplemented. Physical Safari, iOS, an installer,
signing/updating, crash cleanup, progress/capacity reporting, HDR/color handling,
multi-track selection and original-source measurement provenance need separate
design and verification. Existing app playback/scrub workarounds remain in place.

The unchanged app can initially show a black paused video in Playwright WebKit
until Play is pressed. Independent checks reproduced this without the wrapper
and with ordinary and prepared files; playback recovered. Chromium showed the
expected paused picture after its normal fade. This remains a visible baseline
limitation, not a verified physical-Safari result.

This prototype is a proof of the handoff, not a promise to open every format.
