# PR #50 independent-review corrections — October 16, 2026

Branch: `codex/mp4-audio-hardening`. Reviewed revision: `923eb079aa18d5fb9fa9a47bb81e7a18317b6cd5`; released baseline: `d84d6757c4b23370d0d62509ec2d3056ee823028` (3.19.4). Candidate 3.19.5 remains unpublished. The user authorized correcting both review findings, testing, documentation and updating the feature PR. Merge and publication remain on hold.

The independent report and reproductions are retained, unchanged, at `output/pr50-independent-review-2026-10-16-lrrR7k/`. New author correction evidence is at `output/mp4-audio-review-fix-2026-10-16-fqhyiB/`. This is author verification of corrections; a follow-up independent review has not yet occurred.

## R1: apply track policy after leading container boxes

The reviewed decode owners and WebCodecs dispatcher recognized MP4 only when `ftyp` occupied bytes 4–7. The independent reviewer demonstrated that a leading 16-byte `free` box, with all media addresses repaired, allowed Chrome to publish decoded tools and host audio READY for an unidentified track. The unpadded two-track control correctly withheld those tools and failed audio-only host readiness. This was incomplete enforcement of the intended policy, not a new native-decoder regression. WebKit did not decode the reviewer's padded multi-track variant; its behavior must not be described as the same Chrome bypass.

The three call sites now share `_isMP4AudioContainer` in `js/mp4-demux.js`. It follows top-level box sizes, including extended sizes, instead of searching payload bytes or assuming the first box type. The scan has a 64-header budget and handles file-relative offsets and typed-array byte offsets. `ftyp`, legacy movie/media-first shapes, padding candidates and an exhausted plausible prefix enter metadata verification. A malformed identified/padding candidate or an inconclusive bounded prefix cannot silently authorize native analysis. Recognition is not container validation; `_demuxMP4Audio` remains the metadata/table validator.

Both original decode owners retain their generation fences and the existing policy: native playback stays browser-managed; multiple/unverifiable MP4 tracks withhold analysis, monitoring and preview. Managed video can become ready after picture verification, while managed audio-only requires analysis and sends correlated FAILED for ambiguous tracks. No new track chooser or preparation command was introduced.

The real-container test helper structurally rebases `stco`/`co64` tables before prepending boxes; it does not find table names by scanning compressed bytes. New all-AAC fixtures isolate the policy from mixed-codec capability. Five new browser cases cover padded video/audio manual loading, both host readiness policies and real single-track AAC fallback after forced native failure. Pure checks also cover padding types, unknown leading boxes, extended/invalid sizes, legacy shapes, payload false positives, byte offsets and bounded inconclusive recognition.

## R2: reject a second movie clock for the intended reason

The earlier author statement that a second movie clock had been guarded was incorrect. `foundMovieHeader` remained unused at `923eb07`. The original test inserted a header without rebasing `stco`; it rejected because packet addresses pointed into headers. The historical raw evidence remains intact, and the original committed work log now explicitly corrects that claim.

The `mvhd` branch now reads and sets the guard. Both metadata and full extraction reject a second movie header before publishing timing or packets. The synthetic builder accepts a movie-clock sequence and computes sample offsets from the final movie size. Tests cover 1000/2000, 2000/1000 and identical 1000/1000 clocks, alongside a passing single-clock edit-list control. With the guard deliberately removed, the same valid-offset duplicate returns identical packets but changes leading delay from 0.1 to 0.05 seconds and the trim limit from 48,000 to 24,000 frames. The corrected implementation rejects it in both modes.

The negative runner removes the actual guard and requires the specific duplicate-clock assertion to fail while a valid-container control passes. Relaxing the media-range guard no longer affects any duplicate-clock assertion. This distinguishes the intended rejection from the old stale-offset failure.

## Verification and retained failures

| Check | Measured local result |
|---|---|
| Expanded MP4 browser cases | 34 passed: 17 Chrome + 17 WebKit, one worker, zero retries/skips/runner errors |
| Actual padded single-track AAC fallback | Supported and decoded in both local engines |
| Malformed/audio-recognition checks | 284 passed |
| Ownership | 1,197 passed locally; two neighboring-WarpCap checks are absent in hosted checkout |
| Release infrastructure | 25 passed |
| Nine deliberate regressions | All fail their intended assertions while retaining a valid-input setup control |
| Real padded/unpadded reference | Six files / ten audio-track instances; packet bytes/counts, relative DTS, IDs, rates and channels agree with FFprobe and across each padding pair |
| Duplicate-clock counterfactual | Same packet bytes under the removed guard, with the expected altered delay/trim; corrected full/metadata parsing rejects |

Before production edits, the expanded pure runner reported 258 passes and 25 expected failures: six duplicate-clock rejections and 19 new recognition checks whose shared API did not yet exist. These are not 25 distinct production defects. The first before-fix Chrome case failed its intended missing-notice assertion and then hit a teardown timeout. The run was intentionally interrupted (exit 130), retaining one failed result and four non-passing/unexecuted results. It is incomplete negative evidence, not a completed five-case baseline run or a green suite; the teardown cause was not established. Its raw report, error context and screenshot remain retained. The independent review's original working reproductions also remain unchanged.

The first passing post-fix browser run completed all 34 cases in about 30 seconds with no retries. A later pure-only addition verifies `co64` rebasing; runtime and browser-test bytes were unchanged, so the same browser suite was not repeated merely for that extra model check. Ownership and all nine negative controls were repeated after the pure addition. Existing fixtures were neither generated nor rewritten. No broad local suite was repeated; complete required inventories run once on the updated PR.

The earlier 923eb07 hosted run and original author records are historical evidence for that revision only. New required hosted results are pending at correction-commit time. Expected complete inventories are 550 Chromium and 162 focused WebKit cases; the PR description and final ignored receipt will record the measured run, exact feature/synthetic-merge identities, archive digests and staged-file hashes after completion. Publication must remain skipped.

## Limits

The recognizer is bounded and conservative; it does not certify arbitrary container prefixes or compressed bitstreams. Metadata parsing is not whole-file integrity verification. Packet budgets still exclude initial whole-file reads, decoded PCM, frame caches and total browser memory. No audio algorithms, canonical scrub/playback files, WebM/video-demuxer suffix, native-timeout policy or usage adapter changed. No physical Safari listening, rendered track/PCM identity comparison, loudness/true-peak conformance or OS installation test was performed. Historical Grid, 44.1-kHz preview-amplitude, broader WebKit 7.1 and PR #49 readiness observations remain unresolved.

Reproduce the model/ownership checks with `npm run test:ownership` and release checks with `npm run test:infra`. After fixtures exist, run the 17 cases with `WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test tests/mp4-audio.spec.ts --workers=1 --retries=0`; the existing WebKit MP4 project includes the same cases. Local verification used an owned loopback server with fixture setup disabled. Raw probes/configs, nine-mutation runner, source hashes and preservation receipts are retained under the new evidence directory.
