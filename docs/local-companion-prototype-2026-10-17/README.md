# Open files with optional local preparation — prototype

## Outcome and scope

The package-import usability correction in PR #53 did not satisfy the user's
goal: open their files without needing to understand package manifests or an
external command workflow. This separate feature branch,
`codex/local-preparation-prototype`, implements a repository-only end-to-end
proof. It starts from PR #53's held head `d2c56f782d92bd6803c9e99e1564efe3320a8e53`.
PR #53, main and publishing configuration are unchanged by this slice.

The local parent owns choosing/dropping 1–4 files. The existing WarpDiff app
opens them directly first. If picture/audio cannot be used, **Prepare and open**
explicitly invokes separately installed native tools and automatically sends
the returned copy through normal host admission. There is no user manifest,
per-file terminal command, second picker, engine download or remote upload.

The comparison app, normal loaders, readiness checks, measurement algorithms,
scrub workarounds, service worker and published asset list are byte-unchanged.
The wrapper uses the current same-origin managed-host protocol and public
metadata-only capability reports. Provider completion does not authorize READY.
The returned copy is not a validated prepared-package profile.

The [tool README](../../tools/media-prepare/companion/README.md) describes launch,
policy, execution boundaries and known limits. This is development tooling,
not an installable companion or an integration into the published site.

## Decisions and rationale

- Prove the handoff with a same-origin loopback host. Do not claim that a hosted
  HTTPS page can discover/use localhost across browsers: permissions, mixed
  content and Safari transport need their own design and tests. Relevant
  primary background: [MDN local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
  and [WebKit issue 304164](https://bugs.webkit.org/show_bug.cgi?id=304164).
- Keep existing direct loading and make preparation an explicit action. Only
  current core observations decide whether tools are usable. Failed copies do
  not retry preparation automatically or bypass normal validation.
- Keep original files untouched. Copy compatible AVC picture; encode other
  picture to H.264 up to 1080p; use stereo AAC for video and PCM24 WAV retaining
  channel count/rate for audio-only. Disclose the review-copy policy before
  conversion. No original-source measurement or complete sync claim follows.
- Bind the helper to 127.0.0.1 on a random port. Exact Host/Origin plus a
  per-launch random token protect native requests. Fixed executable argument
  arrays, private input/output paths and file/demuxer allowlists limit exposure.
  This is not an OS sandbox for FFmpeg.
- One reservation spans upload, processing and result ownership. A ten-minute
  job deadline, 512 MiB input bound, 1 GiB accepted output bound and expiry limit
  retained work. A 100 ms output monitor can overshoot temporary disk usage.
  These do not cap all native/browser memory or CPU.
- Cancellation waits for process close, escalating TERM to KILL after 500 ms;
  generation and job IDs fence replacement and late completion. Graceful
  failure/cancel/release/shutdown remove private files.

## Verification

Pre-review control-state run: **22 passed**, 11 Chromium/11 WebKit, one worker,
zero retries, no skipped/flaky cases and no runner errors; 47.3 seconds.
The preceding complete run also passed 22 cases in 46.0 seconds before the
last control-state restriction.

Cases cover ordinary images/video without native processing; DTS video;
FFV1/FLAC MKV; DTS audio-only; unaffected image companions and host order;
cancel followed by new input; drops in the comparison; narrow keyboard
activation; unreadable-media failure/retry; and keyboard isolation while the
comparison is covered. Native execution is never triggered just by selection.

Native/helper tests: **9 passed**, zero failures. They verify authorization,
actual forged Host and oversized Content-Length rejection, exclusive ownership,
stale cancellation, abandoned upload cleanup, invalid-media retry, rejection of
a network playlist without requests, TERM-resistant process retirement, real
AC-3 and ProRes conversion, audio-only eight-channel/48 kHz retention and
temporary-file release. Copied AVC packet hashes and PTS/DTS/duration are equal
to the AC-3 source fixture.

Unchanged app guards: ownership **1,353 passed** and infrastructure **26 passed**.
No complete legacy app suite or hosted workflow was run for this prototype.
Physical Safari, audible listening, HDR/color fidelity, PCM layout/conformance,
hard resource exhaustion, OS installation and hosted-to-local transport remain
unverified. The historical Grid, amplitude and 7.1 observations are not repaired
or reclassified by these results.

## Failed checks and resolutions

1. Initial native suite: five passed/one failed. Node Fetch did not send the
   forged Host override in the intended test, so a properly authorized request
   reached processing. Replaced that probe with `http.request` and an actual
   Host header; the server now demonstrably rejects it. Added a real oversized
   Content-Length probe rather than merely checking the exported limit.
2. Initial browser discovery ran no cases: Playwright's CommonJS transformation
   of the native `.mjs` import produced `exports is not defined`. Tests now
   launch the helper in a native Node ESM child with IPC, exercising its actual
   server without changing the app's module system or adding dependencies.
3. First discovered browser run: **15 passed, two failed, one not run**, with
   one report-level maximum-failure stop. Both failures came from dispatching
   a drop inside the frame that the drop correctly replaces; Playwright lost
   that execution context and timed out. Dispatch from the stable parent now
   proves the new frame actually opens the dropped file. Failed logs/traces
   are retained; this run was not green.
4. Source inspection also restricted drag interception to file drops, fenced
   old frame-load callbacks, made the concealed iframe inert, and hid actions
   that could expose a blank comparison during active processing. The final
   browser run includes those changes and strengthened assertions.

## Evidence and release boundary

Raw logs, reports, screenshots, initial failures, source hashes and preservation
audit are retained in ignored local output:
`output/local-companion-prototype-2026-10-17-2fYJoC/`.
Compact machine-readable results accompany this record.

This slice does not merge, publish, install dependencies, change machine
settings or redistribute FFmpeg. The local prototype is for trying the
workflow before product integration and release review.

## Adversarial review and correction

Review at `a769a7f` found a P2 wrapper regression: `choose()` retired the current
comparison before validating a new selection. Five files or an image/audio mix
therefore discarded a valid comparison. The unchanged app rejects those while
retaining the comparison. The correction validates count, kind, nonempty files
and allowed mix first, then uses a separate status notice on rejection. Only an
accepted replacement may change generation, retire the frame or cancel native
work. New browser checks assert the original iframe survives rejection,
capabilities remain usable, valid replacement clears the notice, and an invalid
selection during native processing leaves that job running until explicit Cancel.

The visual review also examined black initial-video screenshots. Chrome's
immediate screenshot preceded its normal fade and was red after settling.
Playwright WebKit retained a black paused frame, reproduced independently in
the unchanged wrapper-free app and with inert disabled; native Play recovered
both ordinary and prepared playback. This is retained as a visible baseline
limitation. It is not classified as repaired or as physical Safari verification.

After correction, the complete prototype inventory passed **24/24**, 12 per
engine, in 47.9 seconds with one worker, zero retries, no skips/flaky results
and no runner errors. The pinned independent first review passed nine native
checks and 19 controlled browser journeys, including two delayed native-job
retirements. Its original finding and raw evidence remain at
`output/local-companion-independent-2026-10-18/REVIEW.md`; the original reviewed
revision is not retrospectively described as clean.

Focused independent follow-up at **921aad9884d60fa264f66da1992f2220c94d0773**
closed that P2 with no additional material correction finding. Four independent
Chrome/WebKit journeys at 390×650 checked 12 invalid selections, exact retained
iframe/media identity, valid replacement recovery and two native-job retirements.
Client/style HTTP bytes matched disk and all 37 fixture hashes/sizes/mtimes
remained unchanged. This is a focused follow-up, not an independent rerun of the
entire 24-case inventory. Evidence:
`output/local-companion-independent-followup-2026-10-18/REVIEW.md`.

Final ownership/infrastructure checks again passed **1,353/26**. The preservation
audit checked 1,115 pre-existing tracked/nonignored files: the only intentional
change to an existing file is the prototype link in `tools/media-prepare/README.md`;
all other pre-existing file bodies and all 37 fixture hashes/mtimes remain unchanged.
Remaining files are additions for this prototype. Source hashes match the tested
correction. The final record-only commit does not change implementation/tests.

The next practical check is trying actual problem files in the local prototype,
preferably Chromium first because of the retained WebKit paused-picture issue.
Turning this into an installed companion or connecting the published app to it
requires a separate transport/installation slice. No new PR, push, merge or
publication was performed for this prototype. PR #53 remains unchanged and held.
