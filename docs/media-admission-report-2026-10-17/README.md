# Media capability reports — October 17, 2026

Slice 2 of the [media input architecture](../media-input-architecture.md), implemented on `codex/media-input-contract` from foundation commit `9d6175032bcd96ebc16bf9473334b53f825d32d0`. Released baseline: `19ec1346fbf4f20f96417280bb89ba63b697081c`, version 3.19.5. The foundation and this slice share unpublished candidate 3.19.6. Work is local; no push, PR, merge, publication or repository-setting change is part of this slice.

## Outcome and decisions

**Media status** is a header action after loading. It opens a native modal dialog showing each input's observed picture, readable pixels, native playback, audio decoding, loaded-file analysis and scrub-audio availability. Missing evidence stays **Not verified**; unavailable audio tools retain their track-selection/preparation explanation. Refresh makes a bounded check of current image/video frames without starting playback or preparation.

The report is intentionally conservative. Native duration is reported metadata. Known container audio start is separate from fallback zero. Exact frame rate/CFR, full A/V synchronization, original channel fidelity and professional measurement conformance are not certified. Completed analysis describes audio decoded from the loaded file, including a compatibility copy; it does not establish the original deliverable's fidelity.

The pure `WarpMediaInput.assessCapabilities` policy returns frozen version-1 `direct-capabilities-v1` reports. The new `js/media-admission.js` observes existing loading, decoding, analysis and listening-buffer owners. It does not introduce another acceptance state machine. The current media object and loading token fence observations; clear/reload retires evidence and closes the dialog. An old snapshot cannot mutate a new report. Raw bytes, filenames, URLs and credentials are excluded from report data; the dialog adds the current filename with `textContent`.

Same-origin hosts can read `WarpDiffHostAPI.capabilities.mediaInputReportVersion` and call `readMediaInputReports()` for an immutable slot-keyed snapshot. This additive metadata getter has no loading, preparation, command-dispatch or READY authority. Existing host messages and the command-catalog API remain.

MP4/WebM metadata comes from parsing already performed by existing decode paths. Opening/refreshing the report creates at most one 1×1 canvas and two pixel draws per current image/video. It adds no file read, demux pass, media element, decoder, timer or background polling loop. Manual paused video without readable pixels remains unknown until an existing observation or explicit Refresh succeeds. The existing managed-video verifier may verify the source through its detached element while comparison-element pixel access remains unknown.

All playback clocks, Opus replacement, channel matrices, analysis algorithms, native/WebCodecs fallbacks and external command behavior retain their owners. Byte comparisons against the foundation confirmed 13 unchanged parser/transport/audio/preparation implementation files. The decoder changes only publish/reuse observation facts. The new classic script is in the service-worker asset list. README, FEATURES, MANUAL, in-app Manual, architecture and agent guidance are aligned. The visible report advances What's New to two concise 3.19.6 bullets; unpublished iterations remain consolidated.

## Verification

Browser runs used one worker and zero retries. Their complete selected inventories had no unexpected skips, flaky results or runner errors after correction.

| Check | Measured result |
|---|---|
| New pure capability/evidence checks | 49 passed through ownership |
| Ownership harness | 1,287 passed |
| Infrastructure | 25 passed |
| Selected browser regression matrix | 272 passed: 126 Chrome, 126 WebKit, 10 release-announcement checks per engine |
| Final report/UI checks after presentation corrections | 20 passed: 10 Chrome, 10 WebKit |
| Four deliberate policy/ownership faults | All rejected by intended behavioral assertions; positive control retained |
| Final source serving | All 40 public source responses byte-identical to the checkout |
| Synthetic local package | 78 staged files; new runtime present at stable and release-pinned paths |
| Packaged startup, install, status UI | Chrome and WebKit passed, no page errors |
| Packaged offline reload/report | Chrome offline emulation passed; WebKit offline not claimed |
| Visual inspection | Desktop 1280×800 and narrow 390×844 screenshots in both engines |

The 272-case matrix covers the input/preparation boundary, new reports, MP4 audio, command quoting, external preparation and host loading. Release-announcement assertions are copied exactly from the modified loop in `tests/warpdiff.spec.ts` without its file-level fixture-writing hook; the copy location/range is retained. Those 20 are copied assertions, not a run of the complete parent spec. The final 20 run directly from `tests/media-admission.spec.ts` after the in-app Manual paragraph, centering and user-facing loading labels were finalized. The broader matrix preceded those final presentation changes; it is not represented as an exact-commit full-suite run.

The new cases use actual decoded images, single/multiple-track MP4s, silent video, WAV and corrupt input. They check immutable host snapshots, literal filenames, uncertainty in source fidelity/timing, withheld multi-track tools, failure retirement, stale tokens, first-frame verification despite forged provider claims, focus restoration, dialog key ownership with active loop markers, centered desktop/mobile bounds, scrolling and bounded refresh draws. FFmpeg is a separately installed test-fixture tool; no engine is packaged with WarpDiff.

Four in-memory negative controls deliberately accept native metadata as picture evidence, treat fallback zero as known timing, certify original fidelity from decoded audio, and accept a replaced observation owner. Each fails its named behavioral assertion while the valid native-picture control passes. The runner requires the complete 49-check inventory and does not accept setup exceptions as successful detection. No production file is mutated for these probes.

The package uses synthetic identity `dddddddddddddddddddddddddddddddddddddddd` to exercise exact working-tree staging. It is a local fixture, not a Git revision or published artifact. Both engines registered a controller and cached the new report runtime at its pinned path. Chrome additionally reloaded offline and produced a fresh loaded-image report. WebKit was tested online for package installation and UI only.

Tools: Node 26.4.0, Playwright 1.58.2, installed Chrome 155.0.8059.82, Playwright WebKit 26.0 and system FFmpeg 8.1.2. No tool or dependency was installed/upgraded. The selected matrix and final feature configurations, with the owned ephemeral server URL, are retained in the evidence directory. Commands used:

```sh
npm run test:ownership
npm run test:infra
node node_modules/@playwright/test/cli.js test --config output/media-admission-report-2026-10-17-0oZaZh/browser.config.cjs
node node_modules/@playwright/test/cli.js test --config output/media-admission-report-2026-10-17-0oZaZh/final-ui.config.cjs
node output/media-admission-report-2026-10-17-0oZaZh/negative-controls.mjs
node output/media-admission-report-2026-10-17-0oZaZh/visual-package-smoke.mjs
```

## Failures retained and corrected

The first focused attempt was **not green**: six passed, one failed, eleven did not run after the configured first-failure stop. Shared `.analysis-btn` CSS overrode the native `[hidden]` styling, leaving Media status visible after clear. An explicit hidden rule corrected it. That report also contains a 60-second teardown timeout and the expected maximum-failure runner message; the timeout's independent cause was not established. Later complete selected runs and final feature runs passed without it.

Source inspection also found the app's global keyboard handlers could consume dialog keys, including Escape with active loop markers. Both handlers now defer while the native dialog is open; a real-browser case confirms Grid/loop state stays unchanged and Escape closes the dialog.

The first package screenshots exposed a top-left dialog caused by the global CSS margin reset. `margin: auto` corrected placement. Final browser assertions check centering on desktop and narrow viewports plus access to the last row by scrolling. Initial screenshots/package evidence remain beside the corrected evidence. The loading line now uses “loaded,” “preparing” and “unavailable” in the UI; API admission enums retain their versioned meaning.

## Limits and next slice

This is evidence inventory for direct loading, not validation of a prepared-media recipe. There is no installed processor, provider picker/transport, preparation negotiation, strict input mode, full-file integrity check, CFR validation, source/channel provenance binding or loudness/true-peak conformance proof. Provider outputs still need ordinary actual loading/decoding and later recipe validation. Playback compatibility workarounds remain necessary until a verified prepared profile replaces them.

The complete Chromium CI inventory, complete focused WebKit profile, hosted checks, physical Safari listening and OS PWA installation/migration were not run for this local slice. Historical Grid, 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate; this work does not establish their cause or repair.

Next is slice 3: define and validate a prepared package's actual picture, timeline, selected audio and source/provenance requirements, then implement one explicit external processor transport. Files returned by that transport must re-enter existing admission; a provider's success or sidecar must never authorize READY.

## Evidence and preservation

Compact measured results: [verification.json](verification.json). Raw logs, reports, traces, before/after screenshots, synthetic packages, negative-control runner, server/source proof and preservation snapshots remain in the ignored local directory:

`output/media-admission-report-2026-10-17-0oZaZh/`

The initial preservation snapshot covers 11,979 pre-existing entries outside this new evidence directory and Git internals. The pre-commit audit found only the 19 planned file paths and their new documentation directory: zero unexpected differences, removals or fixture-byte/timestamp changes. All seven existing symlinks and unrelated untracked evidence were preserved. The final audit and local commit receipt are retained there. The owned ephemeral verification server was retired and its port verified closed; the user's localhost:8080 was untouched. A final read-only remote check still reported main at the released baseline and no remote feature branch.
