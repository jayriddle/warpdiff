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
