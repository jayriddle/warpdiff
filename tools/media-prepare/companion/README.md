# Optional local preparation tool

This tool connects to normal WarpDiff: choose or drop 1–4 files,
open directly when possible, then **Prepare and open** if picture/audio tools
cannot be used. Preparation requires an explicit click. The returned review
copy opens automatically through WarpDiff's existing host loading and readiness
checks. No manifest, command copying or second file picker is involved.

This is a separately run repository tool, not an installed companion. The
normal browser app contains only a connection adapter and preparation controls;
native processing stays in this separate tool. The former managed-wrapper
prototype remains available at `/demo.html` as a development reference.
FFmpeg and ffprobe must be installed separately; no engine is supplied,
downloaded or installed by this tool.

## Try it locally

With an existing Node.js installation supporting the repository's tests and
FFmpeg/ffprobe on PATH, run from the repository root:

```sh
node tools/media-prepare/companion/server.mjs
```

Open the loopback URL printed by the launcher, then **Open WarpDiff on this
computer**. This is the normal app, including Load, Help and its normal controls.
Its Preparation dialog has the local address filled in. Choose **Connect local
tool**, then approve **Connect** in the separate local window. Keep that window
open for this visit. Connection alone sends no files and performs no conversion.

Load/drop your files normally. Supported media opens directly. When needed,
**Prepare and open** makes local review copies and opens them automatically
alongside unaffected comparison files. No manifest or second picker is needed.
Close/cancel or Escape stops the current preparation and leaves the source
comparison in place. Clear, accepted replacement and managed-host entry retire
the job; invalid selections preserve it. Closing the connection window cancels
and disconnects. Stop the launcher with Ctrl+C.

Once this app version is published, the launch page also offers **Open online
WarpDiff**, with the address prefilled. Alternatively, open **Preparation** in
the published app and enter the printed `http://127.0.0.1:port` address. Connect
only to the address printed by your trusted copy of this tool. No automatic port
discovery or remembered trust is used. Before publication, use the local app to
review this candidate. A native installer, signing and update UI are future work.

Files go only to the helper on this computer, in a private temporary directory.
The original files are never modified. Successful outputs remain temporary:
after transfer, the browser owns the review copy for this visit and the helper
removes its files. This prototype has no Save copy command. Closing the page
loses that in-memory comparison.

## Preparation policy and limits

- One native job at a time, including upload and result ownership. Sequential
  preparation preserves comparison order and unaffected files.
- Video: one picture stream and at most one soundtrack. Compatible H.264
  8-bit 4:2:0 up to 4096×2160 is copied, including full-range
  `yuvj420p` explicitly marked `pc`. Known range, matrix, primaries and transfer
  labels must survive copying; a copied picture does not gain invented labels.
  Untagged 8-bit 4:2:0 H.264 stays on that copy path. Other picture streams are encoded to
  H.264 yuv420p at up to 1920×1080. Odd picture dimensions are normalized to
  even dimensions before conversion to 4:2:0. Missing or unspecified tags assume
  BT.709 when the longer side is at least 1280 or the shorter side is at least 720,
  and BT.601 otherwise. A present matrix, primaries or transfer is never replaced.
  Missing ones are filled from the highest-priority declared tag (matrix, then
  primaries, then transfer). A BT.709 or SMPTE 170M transfer alone does not
  choose the matrix or primaries, because those curves are the same; frame size
  does. Frame size also applies when all three are absent.
  BT.470 M fills its matrix as SMPTE 170M. An sRGB-only transfer keeps IEC 61966-2-1
  and assumes BT.709 matrix and primaries. The notice says "used declared" when the
  fill comes from a declared family and "assumed" when that family was not declared.
  RGB, GBR and palette sources set the scale output matrix to that resolved matrix.
  scale calls BT.470BG `bt601`, which FFmpeg 7.0 through 8.0 accept; the
  colorspace filter still says `bt470bg`. The `gbr` layout label is not a YCbCr matrix. The assumption is shown on the
  companion header and as a WarpDiff toast. It does not replace the Preparation
  dialog connection status. The source transfer, including sRGB and BT.470, is kept;
  matrix, primaries and range become limited-range BT.709. Video soundtracks become stereo AAC-LC at
  48 kHz. The soundtrack is padded, then trimmed to the picture duration, so its
  length matches the picture instead of depending on where the shortest stream ends.
  Source timing otherwise follows FFmpeg's normal muxing behavior; this does not
  certify sample/frame mapping or synchronization conformance.
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

The server binds only to `127.0.0.1` on a random port. Native execution requires
the exact Host and Origin plus a random per-launch bearer token; there is no
CORS endpoint. The bearer stays in the helper's same-origin connection page,
never in an app URL, message, storage record or log. The connection page cannot
be framed. An explicit popup handshake pins the exact opener/window, both origins,
version 1 and a random nonce before transferring a MessagePort. User approval in
that page grants this visit's connection. The production origin is
`https://jayriddle.github.io`; loopback HTTP/HTTPS origins are allowed for local
use/tests. This remains an origin boundary: sibling GitHub Pages projects share
the production origin.

The app sends a selected File over the port only after Prepare and open. All
native API requests are same-origin requests from the local page; the hosted app
does not fetch localhost or bypass browser private-network permissions. A URL
fragment may prefill only the strictly parsed loopback address and open the
connection dialog; it cannot connect, execute or select media. The fragment is
removed immediately. Port generation, job ID and comparison generation checks
fence late messages. Managed-host entry disconnects local preparation.

The ordinary app loader owns returned-file admission. Internal prepared reloads
reuse the existing strict host image/video/audio readiness owner without sending
host replies or entering host analytics mode. Conversion success and File shape
alone never authorize READY; reports still say prepared-profile not validated.
The safe manual command is available under Preparation → Other ways to prepare.

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
own allowlisted setup/connection/demo UI. Repository docs, tests, native tools and arbitrary paths
are not served. It is not part of service-worker assets or the Pages package.

## Verification

Existing test fixtures must already exist. Tests generate additional small
media files only in private temporary directories and remove them afterward.

```sh
node --test --test-concurrency=1 tests/local-companion.test.mjs
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test --config=playwright.companion.config.ts
npx playwright test tests/normal-preparation.spec.ts --workers=1 --retries=0
```

The browser tests use one worker and zero retries in Chromium and Playwright
WebKit. They exercise direct loading, real DTS/FFV1 preparation, automatic
return, mixed comparisons, cancellation, file drops, rejected selections and
narrow layouts. Rejected selections preserve the current comparison/job.
Native tests exercise authorization, request limits, exclusive reservation,
stale cancellation, process retirement and real conversion/cleanup.

## Before product integration

The normal-app tests use a separate HTTPS app origin and HTTP loopback popup,
including real File transfer, explicit approval, conversion, cancellation and
strict rejection of corrupt returns. Negative window/origin guards include
controlled test events; they are not browser-origin spoofing demonstrations.
Public-origin and staged-package observations are recorded separately from these
local TLS tests. Physical Safari, iOS, an installer,
signing/updating, crash cleanup, progress/capacity reporting, HDR/color handling,
multi-track selection and original-source measurement provenance need separate
design and verification. Existing app playback/scrub workarounds remain in place.

The unchanged app can initially show a black paused video in Playwright WebKit
until Play is pressed. Independent checks reproduced this without the wrapper
and with ordinary and prepared files; playback recovered. Chromium showed the
expected paused picture after its normal fade. This remains a visible baseline
limitation, not a verified physical-Safari result.

This workflow is not a promise to open every format.

## Color and execution policy

Compatible bounded AVC pictures are copied with their declared color interpretation preserved. Untagged 8-bit 4:2:0 H.264 is copied without inventing labels. Reencoding dithers other SDR picture to limited-range 8-bit 4:2:0 BT.709 matrix, primaries and range, and keeps the source transfer (including sRGB and BT.470). Missing or unspecified tags assume BT.709 when the longer side is at least 1280 or the shorter side is at least 720, and BT.601 otherwise. A declared tag is kept; missing matrix, primaries and transfer are filled from it in that order. A BT.709 or SMPTE 170M transfer alone does not choose the matrix or primaries, because those curves are the same; frame size does. Frame size is also used when all three tags are absent. An sRGB-only transfer keeps that curve and assumes BT.709 matrix and primaries. RGB, GBR and palette sources convert with the same resolved matrix. scale names BT.470BG `bt601`; the colorspace filter keeps `bt470bg`. The companion header and a WarpDiff toast name an assumption; the Preparation dialog keeps its connection status. PQ/HLG and a declared unsupported tag are refused. No tone mapping is applied. Keep the original or use a color-managed preparation tool for those inputs.

Six hours is an input-duration admission bound, not a processing-time promise. Encoding and output decode verification each retain their existing ten-minute execution budget and size limits. Long/complex sources can exceed that budget; cancellation waits for native child retirement. These safeguards are deliberately retained.

Preparation notices do not open WarpDiff dialogs during loading. Open Preparation explicitly, connect and approve the local tool, then choose Prepare and open. Returned files receive a native-playability check before replacing the comparison. Check failures retain the current comparison for retry; after replacement, Reopen previous comparison reloads the prior Files. This restores the previous file selection, not a serialized playback/layout session. Optional analysis can complete later; managed-host readiness rules remain strict.
