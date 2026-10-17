# MP4 audio correctness and bounded extraction — October 16, 2026

Feature branch: `codex/mp4-audio-hardening`, based on released `main` at `d84d6757c4b23370d0d62509ec2d3056ee823028` (3.19.4). Candidate 3.19.5 is unpublished. The user authorized a tested, documented feature-branch PR; merge and publication remain on hold.

## Findings reproduced

The released audio parser appends every audio track's sizes, offsets and durations to shared tables while the latest track replaces the codec/clock/chunk-map settings. A two-track synthetic container produced four packets at 0/40/80/120 ms, mixing both tracks' payloads under one clock. The tracks actually contain two packets each, at 0/20 ms and 0/40 ms respectively. The initial focused checks recorded two passes and ten failures, including partial publication of truncated tables, fabricated chunk maps, zero-byte packets, header bytes treated as media, and expansion of an impossible uniform table before rejection. Some failing checks introduce the new explicit-selection contract; the mixed-packet observation independently demonstrates the released defect.

Allocation probes observe dynamic array pushes and packet copies as well as length-based array construction. The released parser uses push-based size expansion, so a constructor-only probe would miss it. The deliberately malformed probe uses 100,000 declared samples and about 120 KiB of padding; no browser OOM was induced.

## Implementation and policy

`_demuxMP4Audio` creates a separate record at every `trak`, independent of child order. The complete sample and timing maps, format, edit list and track ID stay together. The sole audio track is selected automatically. A caller may explicitly request a unique track ID through the optional third argument; an unselected multi-track extraction returns `null`. The app does not expose a new track selector or pretend that a parser choice identifies native playback.

Encoded tables remain views. Headers/counts, exact chunk and timing coverage, safe clocks and every sample's `mdat` range are checked before packet copies. No expanded per-sample sizes or offsets arrays are needed. Limits are 64 tracks, 100,000 boxes (including sample-entry children), one million packets, 256 MiB of copied packet bytes, and 64 KiB for a codec-configuration payload. Malformed/unsupported extraction returns `null` without an escaping parser exception. These limits do **not** bound initial file reads, decoded PCM, frames, concurrent comparisons or total browser memory.

Metadata mode returns small source fields and track IDs, with no packet/configuration byte copies. It is not full-file or compressed-bitstream validation. Unsupported sample descriptions retain unknown fields. QuickTime v1 child offsets include its extra packet fields; v2 is not read using v0 offsets. AAC receives its AudioSpecificConfig and verified channel/rate metadata instead of placeholder sample-entry values; codecs are not silently labelled Opus. Existing Opus header conversion and priming/edit-list ownership remain.

Recognized MP4 inputs with multiple tracks or an unreadable track inventory keep browser-managed playback, with a comparison-scoped notice. Both video/lazy and audio-only owners withhold waveform, spectrogram, metrics, dialogue/center monitoring and scrub audio before native analysis can select an unidentified track. Export the desired track externally and reload a single-track copy to restore the tools. This is a conservative cross-browser contract; it does not select the first or default track implicitly. The source info bar still lists all readable tracks. Clear/reload retires the notice, and alerts stack without covering each other.

A rejected packet map with a confirmed audio track follows external preparation rather than being called “no audio.” Managed video readiness continues to verify the picture and may succeed with decoded audio unavailable. Managed audio-only readiness requires analysis and therefore sends a correlated failure and cleans up when the track requirement is unmet. Native codec/timing limitations still apply; browser-managed playback is not a certification of audible output.

## Verification record

Raw reports, source snapshots, probe helpers and preservation receipts are retained in `output/mp4-audio-hardening-2026-10-16-gcHi8o/` (ignored and unpublished). Compact measured results will be saved in `verification.json`.

- First parser check: 12 assertions passed, then the temporary command wrapper failed because it assigned a Boolean to Node's numeric exit code. The corrected runner completed cleanly; the wrapper failure is not a parser failure.
- First expanded malformed-parser run: 249 passed. Further real-AAC/configuration and count-limit guards were added afterward.
- First packet comparison: all 16 existing MP4 fixtures retained the released packet bytes, timestamps and decoder settings at that intermediate revision. Subsequent work added AAC configuration bytes and verified codec fields as the authority for decoder channels/rates. The existing 5.1 fixture already agrees in both places; a controlled stereo/22.05 kHz header variant independently verifies that a six-channel/48 kHz ASC overrides placeholders. An earlier progress message overstated what had been established about the original header; that was corrected explicitly.
- FFprobe reference: 18 files / 18 audio tracks, including both explicitly selected tracks in a generated mixed AAC/Opus video. Packet counts, every packet's bytes and relative DTS, track IDs, rates and channel counts matched. The no-audio fixture remained empty. This proves extraction/reference agreement, not loudness or rendered-PCM conformance.
- Initial new Chrome suite: seven passed, one failed. The intended native-failure probe patched an AudioContext that comparison loading retires, so native decoding still succeeded and the expected preparation panel did not open. The assertion and later teardown timeout remain retained. The corrected prototype-level fault injection passed its intended case; no claim is made that this establishes the teardown timeout's cause.
- Next focused Chrome suite: eight passed. Adding actual AAC fallback coverage then produced eight passes and one failure: an AAC configuration branch incorrectly overwrote the complete codec string with `aac`. The branch was corrected, a pure configuration regression was added, and the isolated real AAC fallback case passed. This was an implementation correction, not an existing baseline defect.

Final local verification:

| Check | Result | Scope |
|---|---|---|
| Final MP4 browser cases, Chrome | 12 passed | Current runtime; one worker, zero retries/skips/errors |
| Final MP4 browser cases, WebKit | 12 passed | Current runtime; one worker, zero retries/skips/errors |
| Related Chrome audio/host suites | 83 passed | Intermediate runtime before the missing-WebCodecs classification fix and three additional MP4 cases |
| Complete focused WebKit profile | 154 passed | Same intermediate runtime; the final committed inventory adds the three cases |
| Ownership/pure checks | 1,170 passed | Includes 257 malformed-audio/selection/allocation guards; hosted count is two lower without neighboring WarpCap sources |
| Release infrastructure | 25 passed | No failures/skips |
| Seven deliberate parser regressions | All rejected at intended assertions | Each retains a passing valid-input setup control |
| FFprobe reference | 18 files / 18 audio tracks matched | Packet counts/bytes, relative DTS, IDs, channels and rates |
| Controlled real AAC header variant | Passed | Header changed from 6/48 kHz to 2/22.05 kHz; FFprobe and parser still report ASC 6/48 kHz |

The count/byte-budget guards intercept copies before intentionally large packet allocations. Exact 256 MiB admission and 256 MiB + 1 rejection use zero-filled encoded backing views and intercept the first copy; they are not successful large-packet decoding or peak-browser-memory tests. The one-million-packet boundary similarly stops before packet expansion.

Negative verification initially rejected a channel-placeholder mutant because the existing fixture already had the correct sample-entry count. A new controlled placeholder case closes that detection gap. A subsequent runner attempt was rejected because it still referenced a renamed assertion; the final runner requires the exact intended named check and a passing valid-container control. Wrong track selection, header bytes treated as media, partial timing publication, packet count/byte ceilings, placeholder channels and missing AAC configuration all fail their intended checks. These are author negative controls, not independent review.

A later ownership run recorded 1,168 passes and one source-guard failure: the retired literal false-audio argument no longer matched the corrected native failure route. The guard now asserts that the captured generation is carried while allowing the confirmed-track argument; browser coverage verifies its behavior with WebCodecs unavailable. No generation check was removed. The final ownership run passed all 1,170.

Both final engines exposed working AAC decoding in this run. Chrome did not expose the native audio-track list; WebKit did. The policy deliberately remains consistent across them. The new cases also verify stale-read retirement and readable stacked notices at a 390-pixel viewport. Existing fixtures were preserved; the legacy WebKit Opus hook attempted nine byte-identical fixture writes, which the local guard skipped without changing bytes or modification times.

Correction to the original author record: final source review attempted to add a duplicate-movie-header guard, but it remained unused at `923eb07`. The added test inserted a header without moving absolute sample offsets, so it rejected for an unrelated media-range failure. The independent review demonstrated acceptance of a second clock when those offsets were repaired. The earlier claim of corrected behavior was inaccurate. The [review-correction record](../mp4-audio-review-fix-2026-10-16/README.md) documents the implemented guard, rebuilt valid-offset fixtures, targeted counterfactual checks and subsequent verification.

The first final preservation helper flagged three nested worktree `.git` pointer files because it included them while the initial snapshot excluded Git metadata by name. Their pre-existing dates were inspected; using the same snapshot scope yields no unrelated differences. The original failed receipt remains retained. A final helper command also encountered the system Python Xcode-license gate; editing was completed with Node, without accepting licenses or changing machine settings.

Final required hosted results remain pending at commit time. They must verify the committed feature and its complete inventories (545 Chromium cases including the existing approved skip; 157 focused WebKit cases). The final PR description and ignored evidence record will retain exact hosted identifiers, reports and archive receipts. Merge/publication remain on hold. A passing isolated or intermediate run is not described as a complete final suite.

The counts and source hashes above describe the original reviewed revision. Its later hosted run passed at `923eb07`, but the independent review identified the padding-policy bypass and duplicate-clock gap. They are addressed in the linked correction record, which owns the newer verification scope and expanded inventories; the original passing results do not establish those corrections.

## Limits and next slices

The parser does not implement fragmented MP4, changing sample descriptions, arbitrary edit programs, QuickTime v2 audio interpretation, complete codec-parameter validation or PCE channel-layout inference. Source metadata can remain readable when packet extraction is rejected. It does not change WebM parsing, the native decode timeout/ownership policy, loudness/true-peak algorithms, source licensing, or FFmpeg distribution. The generic Chrome fallback replacement policy remains separate work. Historical Grid, 44.1 kHz preview amplitude, broad WebKit 7.1 and PR #49 worker-readiness observations remain open; current passes do not establish their repair. No physical Safari listening, OS-installation UI or audio-measurement conformance is claimed.

Primary format references checked: [Apple's v1 sound description](https://developer.apple.com/documentation/quicktime-file-format/sound_sample_description_version_1), [sound description extensions](https://developer.apple.com/documentation/quicktime-file-format/sound_sample_description_extensions), and the [HTML media-track model](https://html.spec.whatwg.org/multipage/media.html#media-resources-with-multiple-media-tracks). Browser availability is measured separately in the new tests; the standardized API alone is not treated as a portability guarantee.

## Reproduction

```sh
npm run test:fixtures
npm run test:ownership
npm run test:infra
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test tests/mp4-audio.spec.ts --workers=1 --retries=0
npm run test:webkit
```

Local verification instead used an explicitly repository-rooted loopback server on port 18849 with byte-checked responses. Fixture generation was not rerun locally. Canonical scrub/playback code, the audio algorithms, WebM parsing and the video demuxer suffix are byte-identical to the released baseline.
