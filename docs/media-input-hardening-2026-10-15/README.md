# Media input hardening — October 15, 2026

Jay authorized three fixes in one feature-branch stretch: host-load failure
handling, malformed MP4 video parsing, and bounded encoded-video input for
scrubbing. Branch: `codex/media-input-hardening`; released baseline:
`c2454a53cfab6c863e78fc0d07adc52b2235fa7f`. Merge and publication remain on hold.

## Host-load handling

One message listener retains exact-origin/source checks, request correlation,
and the extension's signed-URL fallback. It now validates the selected 1–4-file
payload, file metadata and binary representation before loading. Numeric
allocation sizes, arbitrary objects, invalid byte arrays, empty data and failed
base64 conversion become correlated failures. ArrayBuffer/views preserve their
byte ranges, and JSON byte arrays remain supported.

The existing terminal-failure owner aborts sibling I/O, clears partial media,
retires view activation, restores Pull and cancels its timeout before replying.
Superseded completions stay silent. Manual clear/replacement also retires host
I/O; host acceptance/failure explicitly preserve correlation while clearing.
This additional fence prevents a delayed host failure clearing manually loaded
files. Signed-network errors still request the same-window extension fallback;
application rejection is terminal rather than being mistaken for network failure.

Focused verification, zero retries: the initial 18 host cases passed in Chrome
and WebKit. Adding the manual-replacement fence then passed 24 selected Chrome
cases, including existing origin/host lifecycle checks and one existing duration
case selected by the filter. The ownership harness passed 525 checks. The final host-only WebKit run passed
all 19 cases in 8.1 seconds. Complete-suite results will be recorded below after
all three fixes.

Raw evidence is retained in ignored local directory
`output/media-input-hardening-2026-10-15-lr2_3mrr/`. Existing user files and earlier
evidence are preserved. No live settings or publication workflows were changed.

## Video parser hardening

The video demuxer returns null on short fixed headers, overdeclared tables,
unsafe extended lengths, excessive nesting, short visual/configuration/color
records, empty/missing chunk maps, invalid chunk ordering or sample-description
indices, inconsistent timing coverage, and out-of-file sample ranges. Reads
are bounded by each containing box. Chunk-map expansion is linear rather than
repeatedly searching the entire map for every chunk. Unsupported multiple
visual sample descriptions also use native scrubbing; the decoder only supports
the first description and cannot safely infer transitions.

All **306** new parser checks pass inside ownership (**831** total local passes).
Running the same probes on the released parser identifies **146** failures,
confirming regression sensitivity. All **16** available MP4 fixtures produce
byte-for-byte identical structured parser results before and after the change,
including unsupported tracks that already return null. No fixture was rewritten.
The parser fix changes no audio demuxing or playback ownership.

The released host fallback was also reproduced in temporary Chrome and WebKit
contexts: malformed base64 caused an unhandled rejection, no terminal reply and
a disabled Pull button. The corrected browser cases above exercise recovery.

## Encoded video input budget

Admission uses known File.size before fetch: at most **256 MiB per video** and
**512 MiB total** for pending initialization and retained scrub sessions.
Unknown/over-budget inputs immediately use native video seeking, with one notice
per comparison. Admitted responses stream into one reserved buffer, with length,
overrun, underrun and cancellation checks. There is no unbounded arrayBuffer read
or accumulated chunk array in this scrub path. Cancelled reservations count
until their initialization settles; stale completions cannot release a new
reservation. Clear/invalidation abort pending reads and close sessions still
awaiting decoder configuration. Playback suspension retains its encoded charge.
Closing a session clears its encoded-byte reference even if a closed handle lives on.

These are encoded-input accounting limits, **not a total-memory guarantee**.
Blob backing, stream chunks, demuxed sample tables, decoded-frame caches, source
audio decoding/analysis, native video buffers and GC delays remain additional.
Range-based demuxing is deferred. Files that do not fit retain native seeking,
normal playback and existing audio preparation/preview behavior.

Focused checks passed with zero retries: four real-browser Chrome cases
(including a real small-file decoder, pre-fetch rejection with native seeking,
cancel/late completion and response overrun), plus three WebKit fallback/cancel
cases. The controlled budget/stream/controller checks exercise exact/shared
limits with small buffers rather than allocating multi-hundred-MiB test data.
The complete ownership harness now passes **864** local checks. Infrastructure
checks pass **18**. Complete browser verification follows below.

The candidate version/cache is 3.19.2. The existing 3.19.1 What's New summary is
retained so this maintenance update does not repeat the prior announcement.
