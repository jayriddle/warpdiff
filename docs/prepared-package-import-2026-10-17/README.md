# Explicit prepared-package loading

Candidate 3.19.7 on `codex/prepared-package-import`, based on released 3.19.6 at `91665d99c4ee33331d2c34c975b2dc2ddd43b759`. The user authorized implementation, testing, independent adversarial review and a PR for review. Merge and publication remain on hold.

## Behavior and boundaries

The header's **Package** button opens **Load prepared package**. Users explicitly select the manifest and prepared MP4, optionally the original for byte matching, and up to three companion images or videos. Selection does no inspection reads. **Check package** uses the existing bounded inspector without clearing or replacing the comparison. The summary distinguishes matched selected bytes and inspected stereo format from declared picture-copy/downmix/no-normalization claims and unverified derivation/conformance. The original is not loaded automatically.

Only **Load comparison** calls `handleMultipleFiles`. Normal timestamp ordering, media decoding, analysis, activation and partial manual-failure behavior remain with the loader. Container inspection is a candidate, not complete AVC validation or full-file decoding. An invalid AVC candidate can leave manual picture evidence unknown or unavailable; neither the inspector nor UI can certify a picture or authorize host READY. Managed hosts retain their existing strict load/first-frame protocol. The UI hides and rejects this standalone action while managed review is active.

Clear/reload, new loading, selection changes and Cancel/Escape invalidate the candidate and abort pending inspection. An unsettled File/WebCrypto operation retains the inspector's existing single reservation; reopen cannot overlap it and stale completion cannot load media. Clear/close resets file inputs and candidate references. File-picker cancel is distinguished from dialog cancel. Appearance's existing keyboard owner closes before the new modal opens; plain Tab/Shift+Tab explicitly cycles visible enabled controls, while Ctrl/Meta/Alt browser navigation remains available. Drops inside the native modal/backdrop do not enter the ordinary loader.

The new UI owner is `js/prepared-import.js`, included in script loading and SW ASSETS. The inspector, demuxers, provider API, preparation CLI, audio/transport/analysis algorithms and dependency files are unchanged. The browser has no FFmpeg wrapper, engine, downloader or converter. The repository-only external tool and copied-command/direct-loading workflows remain available. This is not prepared-only mode, provider discovery, network transport or a new host protocol.

## Adversarial findings and corrections

An independent reviewer examined baseline → initial candidate `4949b85059999d2fb7189686de798aa71e349340` and ran real-inspector Node/browser fault probes. Thirteen Node checks passed for manifest/read/digest cancellation, reservation retention, stale-result fences and managed rejection. Browser probes corroborated async supersession, replacement selection, explicit handoff, native drops and corrupt-AVC uncertainty. Two P2 findings were accepted:

1. Bubbling cancel events from all four native file inputs closed/reset the entire package form. The dialog handler now requires its own target; a dismissed chooser preserves selection/candidate, while dialog Escape still cancels.
2. Opening Package with the Appearance panel still open left Appearance's capture-phase handler consuming Escape. The opener now calls `_closeAppearancePanel()` before showing the modal. Chromium's actual Shift+Tab/Enter route reproduced the defect; WebKit's direct-focus/Enter route reproduced it, while WebKit's default Tab policy limited the full header route.

Strict content-area Tab observations are recorded separately from the P2 defects: native focus may leave the content area, and WebKit can skip buttons despite `tabIndex=0`. An explicit modal control cycle is a scoped usability improvement, not a claimed native browser security repair.

Original review, Node/browser probe code, raw passing/failing results and preservation receipts: `output/prepared-import-adversarial-2026-10-17-y7jGyo/README.md`.

The independent correction follow-up at **`e7c10c911e5924570b9ac4f2ca1b2c54ecbb441f`** closed both P2 findings and found no new concrete issue in the examined scope. **28 checks passed: 14 Chromium +14 WebKit**, one worker, zero retries/skips/flaky results, runner errors, page errors or unhandled rejections; 13.0 seconds. Probes cover all four chooser-cancel targets, real dialog cancellation/Escape, Appearance keyboard ownership, complete forward/backward control cycles, modified-Tab preservation, pending digest cancellation/reservations, managed supersession and corrupt-AVC uncertainty. Twelve relevant runtime responses matched the exact git target and local files. The follow-up did not rerun the author's broader suites and is not a full audit. Record: `output/prepared-import-adversarial-followup-2026-10-17-0knDCN/README.md`.

## Measured local verification

- **1,353 ownership checks passed**, including the two local neighbor-source checks absent from hosted checkout.
- **26 infrastructure checks passed**, retaining public staging and release gates.
- **23 real external-preparation tests passed**; the CLI remains unchanged.
- **98 selected browser cases passed: 49 Chrome +49 WebKit**, including all 20 new importer cases per engine plus existing package/provider/external-preparation integrations. Complete unique inventory, one worker, zero retries/skips/flaky results and zero runner errors; 51.2 seconds.
- New cases exercise no read/network on selection, explicit loading, optional original/companions, altered bytes/identity, malformed manifest, input invalidation, cancellation/reservations/reopen, normal and managed supersession, reset references, MIME normalization after inspection, literal filenames/forged claims, invalid AVC uncertainty, narrow viewport/key/drop behavior, queued close events, file-input cancel and Appearance Escape ownership.
- All **42 public source responses** matched git target `e7c10c9` and local files. Staging produced **82 files** at that target. Fresh Chrome and WebKit contexts passed exact-package startup, service-worker control, real package inspection preserving the current comparison, original byte matching, input-cancel preservation, and explicit normal loading/analysis. Prepared profile remained `not-validated`; neither context reported page errors. Chrome additionally passed offline-emulated reload, inspection and loading/analysis. WebKit was tested online; no WebKit offline result is claimed. Both engines' summary/action screenshots were visually inspected.

The final verification-note commit changes only this README and its JSON record after `e7c10c9`; runtime and test bytes remain identical to the independently reviewed and package-tested target. Hosted checks must establish the final PR head separately.

The global fixture generator was disabled for local browser configs. Existing fixture bytes and mtimes are preserved; helper outputs use separate temporary directories. Source serving uses an owned ephemeral server, leaving the user's localhost:8080 alone. No dependencies or machine settings changed.

## Failed attempts retained

The initial ownership check had 1,352 passes/one README-version mismatch, corrected with affected documentation. Infrastructure had 25 passes/one failure because the new public script was still untracked; tracking it satisfied the existing staging gate.

Browser development attempts were not green: 0 passed/two failed/34 unrun (null-slot helper, interrupted); one passed/one failed/34 unrun (an initially hidden video was not yet observed); nine passed/one failed/26 unrun (managed fixture omitted mandatory labels); 15 passed/one failed/20 unrun (test incorrectly demanded manual FAILED/unavailable rather than conservative unknown); and 36 passed/one failed/three unrun (boundary-only Tab handling missed WebKit's platform policy). Test setup/expectations were corrected without inventing stronger manual admission. Several attempts also retain 60-second timeout and first-failure runner-error records; their separate teardown cause is not established. The final 98-case run has no such failures. Original specs, logs, JSON reports and diagnostics are retained in the local record.

## Scope and evidence

Limits remain 16 KiB per manifest, 64 MiB per prepared/original file and one active inspector reservation. These are not a whole-browser memory budget. No exact CFR/frame mapping, complete A/V synchronization, source derivation/authentication, original multichannel fidelity, professional loudness/true-peak conformance, physical OS picker UI or physical Safari listening is certified. File-input cancellation is tested using the native event shape; Chromium keyboard reachability and WebKit direct-focus activation are distinguished. Existing historical Grid, 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate.

[verification.json](verification.json) contains compact results and source hashes. Full self-contained work record, failure history, inventories/reports, source/package smoke, independent follow-up, preservation and final hosted receipts are retained under `output/prepared-package-import-2026-10-17-RyF7Mb/WORK-RECORD.md`. Required hosted checks are not claimed by this local record; the PR must retain their exact final head and publication-skipped outcome. No merge/publication is authorized.
