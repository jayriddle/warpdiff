# PR #55 hosted fixture portability — 2026-10-19

This checkpoint records the first hosted run and its test-only correction. Final hosted status belongs to [PR #55](https://github.com/jayriddle/warpdiff/pull/55). Merge and publication remain on hold. Production app files are byte-identical to the independently reviewed runtime `07cc05a`; these corrections affect fixture preparation, test coverage and records only.

## Initial hosted result

Feature `9940113ccf75baf43299ebe0bf841da5efb5e009` ran as synthetic merge `954c76c1357864a6617abb54738dc1a2b6f9aec2`. The merge tree exactly matched the feature tree. [Run 39349265029](https://github.com/jayriddle/warpdiff/actions/runs/39349265029) was **not green**:

- Chromium: **644 passed, two failed, one approved timestamp-collision skip**, across three complete reports. Both failures were the helper's full audio-packet preservation assertion, before app assertions, in continuous-preview and slow-cadence cases. No retries or runner errors occurred.
- Ownership **1,405**, infrastructure **26**, preparation **34**, and public staging passed. Two additional local ownership checks inspect neighboring sources absent in CI.
- WebKit had six observed 60-second readiness timeouts: Difference plus the five High 4:4:4 reference cases. Ordinary High controls completed. Its log progressed to case **194/246** before cancellation. There is no complete WebKit verdict.
- After Chromium failed, the unfinished WebKit job was deliberately cancelled to inspect its partial log before correcting the next revision. The run's final API conclusion is cancelled; this does not erase its two Chromium failures or six observed WebKit timeouts. Trace artifacts were not uploaded after cancellation; the console log remains retained.
- Both uploaded package archives matched GitHub's SHA-256 digests, and all **86 staged file hashes** matched locally regenerated staging for the exact synthetic merge. Nothing published.

## Corrections and evidence

Ubuntu FFmpeg **6.1.1-3ubuntu5** reproduced the loss of the final delayed FLAC packet in both metadata-copy and verified-software modes: **46 of 47** packets remained, omitting PTS **4.582000**. The existing network-disabled Linux container used Node **24.21.0**. Original reproduction logs and files are retained.

For this single-FLAC test fixture, the helper now reads the audio track through a separate input with edit-list processing disabled and restores its original constant start offset. The final guards still require **every packet hash, PTS and DTS** to match the original. Verified-software mode still checks every decoded video frame hash and video PTS. No audio is downmixed or reencoded, and no tolerance is relaxed. Nonconstant/invalid mappings fail the original guards. This is test-only media handling, not an app or external preparation change.

Two new Node regression cases generate their own delayed 7.1 FLAC fixtures and check complete packets, eight channels, 0.166-second start, 4.5-second duration, and unchanged input bytes/mtime. Both modes pass on macOS FFmpeg **8.1.2** and Ubuntu **6.1.1**. Against the original helper, both fail at the intended packet-preservation assertion on Ubuntu. The protected serial preparation command includes these tests; its strict infrastructure assertion was extended rather than weakened. Node 24+ built-in type stripping loads the test-only helper without adding a dependency.

WebKit's native color tests now select ordinary AVC High at the same 640×360 authored patch layout and color declarations. Chrome retains the lossless High 4:4:4 software-path controls and negative compositor tests; CLI diagnostics retain their existing defaults. Actual fixture profiles are asserted. The RGB Difference, displayed-picture, lifetime and input-budget assertions remain; no skips, retries, timeout extensions or weaker color tolerances were added. A fresh hosted run is needed to confirm the hosted WebKit result.

Local correction verification: **38 Chrome/WebKit browser passes**, **36 preparation tests**, **1,407 ownership checks**, **26 infrastructure tests**. Browser runs used one worker, zero retries, no skips and no runner errors. The original local fixtures remain untouched; generated media and browser checks use owned temporary/snapshot directories.

Compact measurements are in `verification.json`. Full logs, archives, package hashes, offline Linux probes, negative controls and raw browser reports remain under `output/sdr-color-hosted-2026-10-19-6FHBVJ/`. Earlier independent review findings and historical full-suite uncertainty remain documented in the [color correction record](../scrub-color-review-fix-2026-10-19/README.md); these fixture corrections do not establish physical display or acoustic conformance.
