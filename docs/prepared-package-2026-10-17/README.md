# Prepared package and offline file adapter — October 17, 2026

Branch `codex/media-input-contract`, starting at `f7ccde5cb2d8c5b883b09432e6cc714fa161f2d1`. Released baseline remains `19ec1346fbf4f20f96417280bb89ba63b697081c` (3.19.5). This is the initial implementation of slice 3 in the [media input architecture](../media-input-architecture.md), consolidated into unpublished candidate 3.19.6. Work is local; no push, PR, merge, publication or repository-setting change is authorized/performed in this slice.

## What changed and why

The first real processor uses **offline file exchange**. The optional repository-only [Node tool](../../tools/media-prepare/README.md) invokes the user's separately installed FFmpeg/ffprobe, copies AVC picture and creates stereo AAC-LC at 48 kHz/192 kbps. It outputs `review.mp4` plus `warpdiff-package.json`, retains the original and requires an explicit stream index when audio is ambiguous. It adds no server, upload, browser converter or downloaded engine. Standalone users load the MP4 normally; there is no automatic manifest-import picker yet.

`WarpPreparedMedia` supplies version-1 manifest parsing, selected-byte inspection and an explicit one-shot trusted file-provider factory. The provider is not registered automatically; the app still defaults to manual instructions. Registration/discovery does not read files or prepare media. A trusted integration supplies the original and the returned manifest/rendition explicitly. The existing provider registry returns a File envelope with `validation: 'required'`; it cannot load media or publish READY.

Manifest names, sizes and SHA-256 bind the actual selected original/rendition. Unknown producer `ready`/`validated` claims are discarded. Matching hashes do not authenticate the producer or establish source derivation. Without a selected original, the independent inspector explicitly reports `sourceBinding: 'not-checked'`; the file adapter requires the original. Reports contain compact facts, not filenames, hashes, URLs or source bytes.

The inspector checks exactly one video and one audio track, readable stereo AAC-LC/48 kHz, a real movie clock and container audio start, bounded AVC dimensions and video sample tables. The audio demuxer has an opt-in no-copy summary mode after its existing complete compact-table/range validation. Existing metadata and packet-extraction modes are unchanged. The summary does not allocate copied packets or expanded timestamps. Complete AVC parameter sets and native decoding remain separate checks.

The manifest is capped at 16 KiB and each selected file at 64 MiB. Only one inspection can run, including a cancelled read/digest that has not settled. File/WebCrypto work cannot be physically interrupted; cancellation prevents subsequent work/publication, while the reservation stays until settlement. These caps are not a whole-browser/process memory budget. Larger media retain ordinary loading and external-command preparation.

The CLI passes argument arrays without a shell. Both executables use the MOV/MP4 demuxer and a file-only protocol allowlist; a real local HTTP probe confirms a playlist disguised as MP4 makes zero requests. Existing output directories/links reject. It checks the source bytes again after conversion, inspects the output and separately performs a complete FFmpeg decode. Completed manifest publication uses an exclusive link, and failures/cancellation remove owned files without recursively deleting user contents. No helper, tests or FFmpeg executable enters the public Pages allowlist. No runtime dependency or lockfile change is added.

This is a **candidate**, with normal loading required, not a validated strict profile. Full browser decoding, CFR/frame mapping, complete synchronization, source derivation, channel fidelity and professional measurement conformance remain unverified. The stereo copy uses FFmpeg's default downmix and no normalization filter; decoder processing/encoding can still alter samples or levels. It is not original multichannel analysis. The existing Media status prepared-profile value stays unvalidated, and compatibility engines remain in place.

## Measured verification

All completed selected browser runs used one worker, zero retries, no skips/flaky results and no runner errors. Complete selected inventories were checked for uniqueness and one passing result each.

| Check | Result |
|---|---|
| Ownership harness | 1,347 passed: includes 54 package checks and six new compact-summary checks |
| Real external-helper suite | 16 passed, sequential; system FFmpeg/ffprobe |
| Infrastructure | 26 passed, including wiring helper checks into the protected ownership job |
| Final focused browser cases | 12 passed, six Chrome + six WebKit, after the clock and helper-protocol guards |
| Final selected browser matrix | 264 passed, 132 Chrome + 132 WebKit, including the new cases and existing input/report/MP4/command/preparation/host checks; final public runtime before the external-only protocol restriction |
| Package negative controls | Four intended failures detected, each retaining a valid setup control |
| Movie-clock negative control | Intended missing-clock assertion failed when its guard was removed; valid packet-extraction control passed |
| Existing demux-mode parity | Identical results over all 16 existing MP4 fixtures, metadata + packet extraction: 32 comparisons |
| Source/package boundary | 41 served public responses match the checkout; 80 synthetic package files; helper/tool/FFmpeg paths excluded |
| Final packaged smoke | Chrome + WebKit startup, pinned module installation and real package inspection passed; no page errors |
| Offline packaged smoke | Chrome offline reload + package inspection passed; no WebKit offline claim |

The real-helper suite measured:

- All 12 decoded AC-3-fixture picture-frame hashes match after preparation.
- Explicit stream 2 produces a 1,235 Hz measured active-window tone for the 1,234 Hz reference (0.2–0.6 seconds), distinguishing it from the other track.
- Leading-audio onset is 0.1653958333 seconds in the source and 0.1647291667 in the copy: 0.0006666667-second difference, below the one-AAC-packet limit of 0.0213333333 seconds.
- The short-soundtrack fixture remains 3.023031 seconds before and after, with every decoded picture hash retained.
- The six-channel source remains byte-identical while the returned copy has two channels and explicitly unverified source-channel fidelity.

These are measured fixture results through FFmpeg, not universal timing/channel conformance or proof of native browser PCM. Browser cases separately verify normal activation and correlated managed READY only after returned Files enter existing loading. Same-name/same-size altered originals/renditions reject; a matching fabricated hash cannot promote corrupt MP4 data. Cancellation and late reads cannot activate a comparison. Package inspection itself performs no network requests.

The four in-memory inspector mutations skip byte binding, accept mono, ignore cancellation or certify source derivation. Each fails its named behavioral assertion, with all 54 unit checks exercised and the valid byte-bound setup control passing. A separate audio-parser mutation removes the movie-clock guard and fails its intended missing-clock assertion in a complete 290-check malformed-audio run. Setup exceptions are not accepted as successful detection. No tracked source is mutated for these probes.

The public package uses synthetic identity `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`; it is a local fixture, not a Git revision or deployment. Final source hashes and unchanged-owner hashes are retained. Fifteen transport/audio/analysis/preparation/report implementation files remain byte-identical to the starting commit. Only the audio parser's opt-in summary is added; the old modes also match baseline across all 16 fixtures. Protected job names and release gates remain intact; only the new sequential helper check is added to the existing ownership job. No hosted run is claimed.

## Failures and corrections retained

- The first helper suite was **not green**: 14 passed, one failed. The selected-tone assertion divided crossings by the entire padded duration, measuring about 1,111 Hz. Measuring the known active window corrected that test; the source-selection implementation did not change. Final diagnostics retain actual values.
- The first browser attempt failed during test discovery (`exports is not defined in ES module scope`) while importing the external CLI into Playwright's TypeScript/CJS test environment. No browser cases ran. The tests now invoke the separate Node process, matching the intended external boundary.
- The next focused attempt was **not green**: two passed, one failed, nine not run after the configured first-failure stop. A test queried nonexistent `.asset-filename` markup. It now checks the existing media-state owner for the unchanged original filename. The failed result also contains a 60-second teardown timeout; its independent cause remains unestablished. The trace, screenshot, original test and report remain retained.
- Source review found the new package summary could inherit the legacy default movie clock when `mvhd` was absent. The package-only guard now rejects it; a fixture and negative control verify it while legacy extraction remains compatible. A 264-case browser pass before that guard is retained separately; the final matrix and packaged checks rerun after it. The later external-only protocol restriction was verified by the final 16 helper checks and 12 focused end-to-end browser cases; public runtime bytes did not change.
- One documentation patch had a context mismatch and applied no edits. System `python3` refused execution because of the machine's Xcode license state; Node performed the documentation edit instead. No license acceptance, installation or machine-setting change occurred.

## Scope still outstanding

There is no package-import UI, provider discovery, network transport, strict prepared-only mode, complete AVC configuration validation, cross-engine full-file decode proof, source/provenance authentication, channel-preserving analysis sidecar, verified downmix matrix, CFR/frame mapping or professional loudness/true-peak conformance. Direct loading and Opus/edit-list/native/WebCodecs/channel-routing compatibility code remain necessary. The helper intentionally supports only the initial bounded AVC/stereo-AAC recipe.

Complete Chromium CI/focused-WebKit inventories, hosted checks, physical Safari listening and OS PWA installation/migration were not run. Historical Grid, 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate. No independent-agent review was performed for this slice.

Next is an explicit package-import workflow plus stronger timeline/frame/channel/provenance validation, before a strict core profile can replace compatibility handling.

## Reproduction and durable evidence

```sh
npm run test:ownership
npm run test:preparation
npm run test:infra
node node_modules/@playwright/test/cli.js test --config output/prepared-package-2026-10-17-WqTQVX/browser.config.cjs
node output/prepared-package-2026-10-17-WqTQVX/negative-controls.mjs
node output/prepared-package-2026-10-17-WqTQVX/legacy-parity.mjs
node output/prepared-package-2026-10-17-WqTQVX/package-check.mjs
```

The browser config uses the owned ephemeral server and disables global fixture generation. New media are produced under separate temporary directories; pre-existing fixtures are not rewritten. Tools: Node 26.4.0, Playwright 1.58.2, Chrome 155.0.8059.82, Playwright WebKit 26.0 and system FFmpeg 8.1.2. Nothing was installed/upgraded.

[verification.json](verification.json) stores compact structured results. Raw reports/logs, copied failed test, negative-control runners, packages before/after the clock guard, response hashes and preservation snapshots remain ignored under `output/prepared-package-2026-10-17-WqTQVX/`. The initial audit covers 12,429 pre-existing entries, including seven symlinks, outside that new evidence directory and Git internals. Final preservation and the local commit receipt are retained there. Merge/publication remain on hold.

Pre-commit preservation found only the 24 planned file paths and their two new directories: zero unexpected differences across the 12,429-entry starting snapshot. Existing fixture bytes/modification times, unrelated untracked evidence and all seven symlinks were preserved. The owned ephemeral server was retired and its port verified closed; localhost:8080 was untouched. A read-only remote check still showed main at the released baseline and no remote feature branch.
