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

Final control-state run: **22 passed**, 11 Chromium/11 WebKit, one worker,
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
