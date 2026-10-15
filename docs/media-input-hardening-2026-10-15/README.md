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

## Complete local verification and self-review corrections

The initial complete Chromium attempt at 92995b2 was intentionally interrupted
before completion when self-review caught an empty managed-host request taking
the standalone extension retry path. A regression case now verifies immediate
managed failure and retained standalone retries. The corrected 20 host cases
pass in Chrome. The interrupted log is retained and is not a green suite.

The complete Chromium run at production revision 1463a02 executed all **460**
cases with zero retries in **444.3 seconds**: **458 passed, one failed, one
existing timestamp-collision skip**. Its sole failure was the service-worker
cache test hardcoding 3.19.1 as the current cache. At candidate 3.19.2 the worker
correctly deletes that old cache. The version-independent test now reads
CACHE_NAME in its VM context, verifies exact deletion of two old owned caches
and the exact legacy FFmpeg cache, and preserves the actual current cache plus
unrelated host caches. The corrected Chrome test passes. No production code
changed for this correction; the complete failed log and screenshot/trace remain
retained rather than being described as a passing suite.

The expanded WebKit profile passes **73** cases with zero retries, including
all 50 preceding cases, 20 host cases and three memory/fallback cases. Ownership
passes **864** locally; infrastructure passes **18**. The local public artifact
contains the same 35 allowed files. Hosted exact-revision verification will run
on this feature branch before review; manual feature checks cannot publish.

The historical four-image Grid uncertainty remains unexplained. This slice
changes no loudness/true-peak algorithms, audio mix policy, codec normalization
or licensing. No new physical Safari listening check was performed. No claim of
a complete arbitrary-media audit or a total-browser-memory limit is made.

## Hosted final verification

[Hosted run 38801164123](https://github.com/jayriddle/warpdiff/actions/runs/38801164123) passed on attempt 1 at exact revision
**116476976631d803715cbc23963bf73c0a100cab**, with zero browser retries, in **7m29s**.

| Check | Result |
|---|---|
| Chromium, three isolated shards | **459 passed**, one existing skip; all **460** cases accounted for |
| Expanded WebKit profile | **73 passed** |
| Hosted ownership | **862 passed**, zero failures |
| Infrastructure | **18 passed**, zero failures |
| Actual uploaded Pages artifact | All **35** files match every manifest hash |
| Publication job | **Skipped**, as required for feature/manual verification |

The two extra local ownership passes inspect neighboring WarpCap sources absent
from the hosted checkout. Report validation confirms complete/disjoint Chromium
execution, the one allowlisted timestamp skip, no runner errors and no retries.
The corrected version-independent cache case is included in the passing hosted
Chromium and WebKit runs. The earlier failed local complete run is retained
above, not retrospectively relabeled green.

The actual uploaded artifact is byte-identical, including its exact-SHA version
file, to a separately staged candidate exercised in installed Chrome and
Playwright WebKit. Both passed version/service-worker checks, image comparisons,
Stack/Grid switching, video play/pause/frame stepping and audio loading/graphs.
Chrome additionally passed offline reload and image loading. Both observed zero
uncaught application errors and zero analytics requests. Candidate screenshots
are retained; the Chrome video screenshot was visually inspected. The temporary
loopback server was shut down after verification.

## Final preservation and review boundary

The baseline snapshot covers **1,057** existing tracked/nonignored untracked
files, including **578** pre-existing untracked files. Every unrelated file hash
and every pre-existing untracked hash is unchanged. The tracked working tree and
index are clean after the commits. Earlier ignored evidence was read/copied,
not included in that snapshot's hash count. Normal generated test outputs are
separate from the retained failure records.

Main and the normal live version remain **c2454a5 / 3.19.1**. Pages settings and
main protections compare equal to their pre-run readbacks. No PR, merge, tag,
release, setting change or publication was performed. The feature branch was
pushed for hosted verification. This final follow-up records evidence only;
production and test bytes remain those checked at 116476976631d803715cbc23963bf73c0a100cab.

The compact [verification data](verification.json) accompanies this record.
Raw logs, browser reports, failed-check artifacts, baseline-negative probes,
35-file manifests and preservation records remain in the ignored directory
named above. Reproduce with test:ownership, test:infra, the zero-retry Chromium
CI configuration, and the expanded test:webkit profile. No Opus timing-policy
or timing-test change was made, so the separate Opus mutation runner was not
rerun for this slice.
