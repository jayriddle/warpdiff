# Media input hardening: independent-review corrections

Branch: `codex/media-input-hardening`. Reviewed starting point:
`40154668bdef6fdcbde5d108b217b7e89348d954`. Released baseline remains
`c2454a53cfab6c863e78fc0d07adc52b2235fa7f` (3.19.1). This is still the unpublished
3.19.2 candidate. Merge and publication remain held.

## Review assessment and scope

The independent review found two real gaps in the original hardening. Both are
pre-existing behavior that the branch had not completely addressed, rather than
new regressions. Passing the original suites did not establish the missing
behavior. This correction also addresses the separate main-source review's host
label/file ordering defect. Other review findings remain a separate backlog.

The independent evidence is retained unchanged at
`output/independent-media-review-2026-10-15-4eoyd8/`. New author evidence is in
`output/media-input-follow-up-2026-10-15-aaaPWt/` (ignored and unpublished).

## Host batch validation and readiness

Previously, empty supplied bytes were rejected but an HTTP 200 signed response
with an empty body became a File and reached READY. Converted files now receive
the same batch checks after either transport, outside the signed-network error
handler. An empty body or a MIME type that File normalizes to empty is a terminal
application failure; it cannot request the extension's network fallback. The
whole batch is rejected instead of silently filtering a file and shifting labels.

The old view-ready check counted registered `mediaData` objects, including
failed or still-decoding slots. `_hostLoadSlotUpdate` now owns per-request
readiness. Host loads require a decoded image with nonzero dimensions, a decoded
first video frame with dimensions, or, for audio-only media, native playable data
and decoded waveform analysis. Unsupported video soundtracks can still use the
existing external-preparation workflow when the picture itself is usable. Video
soundtrack analysis is not a new condition for host READY.

An initial image/video/audio error routes through the existing generation-fenced
failure owner: abort sibling work, clear partial media, release loading resources,
restore Pull and send one correlated FAILED. Loading-token and request guards
prevent late decode successes or failures from clearing or settling a replacement
comparison. READY is terminal; later playback failures are not a second load reply.
Standalone partial-error presentation remains unchanged.

Host assignments now preserve the host's array order, independently of
`lastModified`. Labels therefore remain with their supplied media. Manual loads
retain oldest-to-newest timestamp sorting. The regression cases cover 1–4 host
items through signed URLs and supplied bytes, checking labels, filenames and the
actual per-slot bytes, using descending timestamps and distinct images.

## Rejecting impossible sample tables before allocation

The reviewed parser accepted the declared sample count as an allocation size
before establishing byte feasibility or table coverage. A 120,395-byte probe with
100,000 samples of `0xffffffff` bytes allocated both sizes and offsets arrays
before returning null. The independent reviewer measured allocation order and
deliberately did not induce an OOM; the large-file memory consequence was an
inference, not a measured browser crash.

The parser now keeps a descriptor into the encoded size table. Uniform sizes are
checked with division to avoid unsafe multiplication; variable sizes are scanned
without expanding them. Compact chunk and timing coverage, sync indices and all
sample byte ranges are validated before allocating offsets/sample objects.
Uniform chunk ranges need only one check per chunk. The previous sizes array is
eliminated; mapping remains linear. A practical limit of 1,000,000 samples/table
entries bounds metadata work; larger inputs fall back to native seeking. For
context, one million video samples is about 4.6 hours at 60 fps. This limit does
not impose a playback-duration limit on native media.

Eight new checks observe the actual Array constructor: impossible uniform sizes,
impossible aggregate bytes, incomplete chunk/timing coverage, invalid byte ranges,
variable-size table failures and the practical cap must return null without
count-sized allocations. All eight fail against the reviewed parser. Existing
checks still pass, and all 16 MP4 fixtures retain identical structured output.
The synthetic AVC record now contains the fixture's complete SPS/PPS record.
Fixed-header checks still do not establish complete AVC/HEVC bitstream validation;
the earlier broader documentation wording has been narrowed accordingly.

## Verification and retained failed attempts

- Initial new parser probes: 306 existing checks passed; all eight new early-
  allocation expectations failed against the reviewed source. Corrected: 314 pass.
- A temporary browser run with index.html pinned to the reviewed source fails exactly the three selected intended
  assertions: empty signed image sends READY, corrupt managed image sends READY,
  and descending host timestamps reverse the label/file pairing. Three failures,
  zero retries; this is negative evidence, not a passing suite.
- An earlier exploratory negative run was interrupted during diagnostics after
  reproducing the empty-file READY. It is incomplete and is not counted as green.
- Initial corrected host profile: 46 passes. The expanded profile was then
  interrupted at a new valid-audio setup that patched an AudioContext instance
  discarded by host acceptance. A diagnostic confirmed ordinary audio was already
  ready while the held-decode sentinel had never been installed on the new context.
  The test now holds the first decode through the prototype and restores it on
  entry, so it exercises the new context. No production change was needed for this
  test-setup correction. The corrected 50-case Chrome profile passes, zero retries.
- Local ownership: 872 passes; infrastructure: 18 passes. The two neighboring
  WarpCap checks are local-only, so hosted ownership should contain 870.

Complete-suite and hosted results are recorded in the final verification sections
below. All browser runs use one worker and zero retries. Existing
fixtures are protected by a preload that skips identical writes and rejects
changes; failure artifacts and reports use fresh paths.

## Limits and open observations

The 256 MiB/file and 512 MiB/shared scrub-input budgets still cover encoded input
only. Demuxed metadata, decoded frames/audio, native buffers, Blob backing and GC
remain additional. The sample cap reduces metadata amplification; it is not a
whole-browser memory guarantee. Range demuxing remains deferred.

No new physical Safari listening, PCM rendering, loudness/true-peak conformance
or complete arbitrary-media validation is claimed. The focused WebKit profile
remains a selected profile. The historical Grid `topGap = -899` failure remains
unexplained; current passing runs do not establish its cause or repair. Earlier
interrupted/failing suites remain recorded in README.md and verification.json.
No audio mix, Opus scheduling policy, service-worker architecture, licensing or
release-infrastructure changes are included in this correction.

## Final verification

| Check | Result |
|---|---|
| Complete local Chrome inventory | 489 passed, one existing timestamp-collision skip; 470.897 s |
| Expanded local WebKit inventory | 103 passed; 81.044 s |
| Focused local Chrome host profile | 50 passed; 33.235 s |
| Ownership | 872 passed (870 expected without neighboring WarpCap sources) |
| Infrastructure | 18 passed |
| Parser checks | 314 passed; eight intended counterfactual failures |
| MP4 compatibility fixtures | 16 identical structured results |

Both complete reports match their fresh inventories: 490 Chrome and 103 WebKit
identities, one worker, zero retries, no runner/test errors or flaky results.
Chrome's only skip is the existing declared timestamp-collision case. The Grid
case passed here; its historical failure remains unexplained.

Hosted and packaged results appear below.
See [structured verification](follow-up-verification.json).

## First hosted run and response-interception correction

[Run 38813044298](https://github.com/jayriddle/warpdiff/actions/runs/38813044298)
at `eae70cd53e339a8237d7cbebc7deb9fabd5683a8`, attempt 1, **failed**. Chrome
completed its full inventory with 487 passes, two failures and one existing skip.
WebKit completed 103 cases with 100 passes and three failures. Ownership and
infrastructure passed; publication was skipped. Raw reports, artifacts/digests
and traces are retained in `hosted-first/` in the new evidence directory.

The three WebKit failures expected a controlled empty HTTP 200 but received no
terminal reply. The retained network trace shows an actual HTTP 404 from the
static server for `/rejected-host-media`; the mock response was bypassed. This is
the documented Playwright service-worker interception limitation (also described
in the installed playwright-core type reference). The app therefore correctly
requested network fallback rather than treating the body as an empty application
payload. The protocol spec now blocks service workers and explicitly requires
its controlled response handler to run before checking terminal behavior. The
independent packaged smoke still tests installed service workers and offline use.
No application code changed for this correction. Local verification: 50 Chrome
host cases, 103 WebKit-profile cases, and 872 ownership checks pass, zero retries.

Two other existing Chromium tests failed outside the protocol/parser probes:
short-preview center amplitude at 44.1 kHz was 0.01231544, below the required 0.02;
and More did not retain focus after Escape in a narrow info bar. Their causes are
not established. Their test bodies and audio/info-bar modules are unchanged; that
does not prove the branch cannot influence them. They passed in the complete local
run. Retain these failures, rather than claiming they are repaired or calling the
first hosted run green. The completed hosted run below checks the committed fixture fix.

The three negative browser controls pin index.html only; other scripts came from
the candidate checkout. These selected image cases do not exercise the changed
audio/video helpers. The parser counterfactual independently pins the parser
source. The complete hosted runs provide the exact-commit integration checks.

## Completed hosted and packaged verification

[Run 38814474872](https://github.com/jayriddle/warpdiff/actions/runs/38814474872), attempt 1, **passed** at
`976423bd40f7168dcca34cbf000fc169ae36e187`. Runtime changes originate in `eae70cd53e339a8237d7cbebc7deb9fabd5683a8`;
the intervening commit changes only the protocol test fixture and verification
notes. All 34 app assets are identical between those commits; version.json
receives the newer SHA during staging.

| Hosted check | Result |
|---|---|
| Complete Chromium inventory, three disjoint shards | 489 passed, one existing timestamp-collision skip |
| Selected WebKit profile | 103 passed |
| Ownership | 870 passed (local-only neighboring-source checks account for the two additional local passes) |
| Infrastructure | 18 passed |
| Public staging | 35 files; all manifest hashes and source bytes verified |
| Publish verified main | Skipped |

Report validation requires a complete inventory, one execution per identity, one
worker per machine, zero retries, no flaky results and no unexpected skips or
runner/test errors. Chromium JSON reports and WebKit's embedded report were
checked. All six downloaded report/package artifact digests match GitHub's
metadata. Elapsed hosted time: 423 seconds from run start to the final job end.

Both packaged Chrome and WebKit smoke checks passed for the exact tested SHA:
version display, installed service worker, two-image comparison, Stack/Grid,
video play/pause/frame step, audio visualization, rejected host-image decoding,
and host ordering. Chrome also passed offline reload and image loading. No
uncaught app errors or analytics requests were observed in either smoke context.
These are local tests of the packaged artifact, not a new deployment.

The two extra Chromium failures from the first hosted run passed in this final
run. **Their causes remain unestablished; this is not evidence of a repair.**
Their raw reports, screenshots and traces remain under hosted-first/. The older
Grid failure likewise remains an unresolved historical observation.

Read-only checks confirm remote main and live version.json still identify
`c2454a53cfab6c863e78fc0d07adc52b2235fa7f`. Live index.html, audio-decode.js and
mp4-demux.js match that released baseline, and Pages/protection settings are
unchanged. All 4,252 pre-existing files and seven symlinks were checked; only the
explicit correction files changed, and the 578 pre-existing nonignored untracked
files remain intact. Raw new evidence stays in the fresh ignored directory.

The correction is ready for follow-up review. Merge and publication remain held;
no pull request, merge, tag, release, deployment or settings change was made.
Final verification notes are a documentation-only follow-up to the hosted target.
