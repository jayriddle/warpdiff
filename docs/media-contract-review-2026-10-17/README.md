# Media input architecture: adversarial review and PR verification

The reviewed range is released baseline `19ec1346fbf4f20f96417280bb89ba63b697081c` to local candidate `0127f0f738d7d8e92b675ae84fb88e3f82d52f4e`, the three initial contract, capability-report and prepared-package commits. The user authorized an adversarial review, corrections, a pull request and required hosted checks. Merge and publication remain on hold. Candidate version remains 3.19.6.

## Independent findings and corrections

Three independent reviewers examined contracts/admission, package inspection/parser changes, and the external helper. They used pinned source, targeted fault probes and real media/executables; they did not independently run the complete browser inventory. Four actionable findings were accepted:

1. **P2: cancellation during final package publication could return success.** Aborting immediately after the first exclusive rendition link still created the manifest. The helper now checks cancellation after each awaited publication boundary and before returning. Six deterministic cases abort after rendition link/unlink and manifest open/write/link/unlink; every case requires AbortError and owned-file cleanup.
2. **P2: helper cancellation could settle before the executable exited.** A controlled executable ignored TERM and remained alive after the old helper rejected and removed output. The new bounded argument-array runner waits for `close`, sends TERM on cancellation/timeout/output-limit failure, and escalates to KILL after 500 ms. It bounds both output streams and removes listeners/timers at close. Cleanup follows retirement. This reproduced a lifecycle defect with a stub; it did not establish that ordinary FFmpeg remained alive.
3. **P2: implicit HE-AAC could pass the advertised AAC-LC package profile.** A real AudioToolbox-encoded, fully FFmpeg-decodable HE-AAC file retained the AOT2 `mp4a.40.2` string with active SBR. The parser now retains SBR evidence for the opt-in compact summary; the package requires explicit absence. Configurations beyond the existing 64-byte extension scan remain unverified and reject for this recipe. Legacy decoder codec strings, sample values and packet extraction stay compatible. Ordinary direct HE-AAC loading remains under its existing owners.
4. **P3: reports could call a fallback MP4 movie clock verified.** Removing `mvhd` from a 48 kHz movie-clock fixture preserved old parser arithmetic but Chrome's new report labeled 6.912 seconds known instead of withholding confidence; the intact file reported 0.144 seconds. Picture admission failed and no READY bypass occurred. Metadata now adds `timelineVerified`; capability reports require it for MP4 even after successful legacy audio decoding. Existing numeric decode timing remains compatible.

The report and inspector still cannot authorize READY. Preparation remains explicit; the app ships no FFmpeg executable, downloader or converter. Matching hashes do not authenticate the producer or prove source derivation. Full browser decoding, CFR/frame mapping, complete sync, channel fidelity and professional measurement conformance remain unverified. There is no package-import UI or strict prepared-only mode in this PR.

## Verification

The compact [verification record](verification.json) records final local counts, correction-review outcomes and source identities. Hosted results are attached to the PR and retained in the local work record after the candidate is pushed; a local pass must not be interpreted as hosted verification.

- Ownership, infrastructure and the real external-tool suite run locally before push.
- Selected input/report/MP4/command/preparation/host browser cases run in Chrome and WebKit with one worker and zero retries.
- Legacy audio-demux metadata and extraction values match the reviewed target across all 16 existing MP4 fixtures: 32 comparisons. The only additive metadata field is movie-clock confidence.
- The reviewers recheck their specific findings against the correction. Targeted original reproducers and negative controls distinguish the corrected behavior from the reviewed version.
- The PR triggers complete sharded Chromium results, the focused WebKit profile, ownership/infrastructure/helper checks and public-file staging. Publication must be skipped because this is a pull-request event.

Existing fixture bytes/modification times and unrelated evidence are preserved. New logs, reports, review probes and packages stay under ignored `output/` directories. The owned verification server uses an ephemeral loopback port; the user's localhost:8080 server is untouched. No dependency or machine upgrade is required.

The original independent records are retained in:

- `output/contract-adversarial-2026-10-17-amw1t4/REVIEW.md`
- `output/prepared-inspector-adversarial-20261017-MK5SIO/REVIEW.md`
- `output/tool-adversarial-2026-10-17-impF5G/REVIEW.md`

The parent work log, source/package proofs, test logs, report inventories and final hosted receipts are under `output/media-contract-adversarial-2026-10-17-dvpt1e/`. See `WORK-RECORD.md` there for the final PR/check outcome.

Physical Safari listening, OS PWA migration, exhaustive process/filesystem races and physical memory/storage exhaustion are outside this verification. Historical Grid `topGap = -899`, 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate and are not described as fixed.

Final pre-push results: **1,353 ownership**, **26 infrastructure**, **23 helper** and **268 selected browser cases** (134 Chrome +134 WebKit), plus **four focused new-regression cases**. Browser inventories are complete with one worker, zero retries/skips/flaky results and zero runner errors. All three focused independent follow-ups found no remaining actionable finding.

The first selected browser run was not green:167 passed, one failed, one interrupted and99 not run. The new HE-AAC test mutated a copied configuration offset; the corrected test locates unique fixture bytes and requires valid changed-container tables before asserting rejection. The failure also recorded a60-second timeout whose separate teardown cause remains unestablished. Its original source, report, log, screenshot and artifacts remain retained. This correction changed only the test.

## First hosted run and test corrections

[Run39053153307](https://github.com/jayriddle/warpdiff/actions/runs/39053153307), at186fd92, was **not green**: Chromium573 passed with one approved skip; WebKit177 passed/seven failed. Hosted ownership1,351, infrastructure26, helper23 and package staging passed. All80 packaged files and five downloaded report/package archive digests matched; publication was skipped.

Independent trace diagnosis found five READY polls stopped around4–5 seconds while the app’s10-second first-frame verifier was active. Those traces do not establish eventual readiness. The corrected tests await a correlated terminal up to15 seconds and then immediately assert the exact result; wrong FAILED replies fail, and MP4 tests retain their full reply-array assertion. One5-second metrics poll missed analysis whose LUFS/true-peak values appear in the later retained capture; that specific asynchronous wait is now15 seconds. Application deadlines and global test timeouts/retries are unchanged.

The existing exact-package worker/worklet test returned **61,483,632 bytes** through Playwright. All behavioral assertions passed, but the60-second budget expired at final cleanup. The correction compares every returned array element/scalar/field inside the browser and returns compact first-mismatch diagnostics/counts instead. Worker-only execution, intentional fallback and both canonical worklet loads remain required; the return must stay under4KiB. Fourteen independent comparator checks detect altered samples, missing keys, type/length changes, NaN and signed zero.

All14 focused cases (the seven affected cases in Chrome/WebKit) passed locally with one worker, zero retries and zero runner errors. Ownership1,353 and infrastructure26 passed again. Every one of the41 public runtime source files is byte-identical to186fd92; these are test/evidence corrections. Raw failed-run reports/traces are preserved in the parent evidence directory; focused results and follow-up records are under`output/media-contract-hosted-followup-2026-10-17-iroPau/`. A fresh complete hosted run remains required.
