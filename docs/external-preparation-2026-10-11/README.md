# External preparation interim release — October 11, 2026

Status: local review candidate on `codex/external-media-preparation`. Nothing has
been merged, pushed or published. The current public app and old repository
history have not been changed by this work.

## Decision and scope

Jay chose: “a small interim release that removes browser FFmpeg conversion and
retains the safe external command and reload workflow.” This replaces the
proposed integrated LGPL release as the current publication approach. No new
permission to modify or redistribute WarpDiff's original code was adopted.
The original README restrictions and `UNLICENSED` / `private: true` package
metadata remain in place.

The branch starts at `be12fd1b8de85df8aed89f2bb0f5a76fac9ea599`, retaining the
earlier reviewed command-quoting, basename/clipboard, main-rename record and
license-metadata corrections. The separately tested LGPL candidate remains on
`codex/ffmpeg-distribution` at
`dca2736d0972bd4f1834468a1fcb0a353f460a57`. This branch does not descend from that
candidate and does not introduce its engine, wrapper, source archives or build
tooling into the interim release. The LGPL candidate's review record remains
available on that preserved branch.

This is a static, no-build release. It adds no preparation provider, installer,
extension or native helper and makes no architectural changes to transport,
Opus replacement, scrub engines or audio measurements.

## What changed

- Removed the four `ffmpeg/` browser assets: wrapper, generated core JavaScript,
  WASM and worker stub. Their previous total was **24,492,033 bytes**. The
  current tracked file tree contains no `ffmpeg/` assets. The Pages configuration
  also excludes that directory to prevent stray copies from entering a build.
- Removed browser engine loading/prefetching, the unconsumed WASM cache writes,
  conversion queues, progress/toast state, conversion controls and automatic
  source replacement. `index.html` shrank from 786,495 to **758,008 bytes**.
- Retained native decoding and WebCodecs. A current unsupported video soundtrack
  registers an external command and opens **Prepare audio externally**. A
  persistent **Prepare audio** header button reopens it. Entries use the
  comparison's slot order, render filenames as text, and have keyboard focus,
  Escape, close-button and backdrop behavior.
- The panel links to FFmpeg's download information. It neither downloads nor
  invokes that software. Users install FFmpeg independently, run the copied
  command from the source file's folder, then use **Load prepared files**,
  **Load (L)** or drop to load the output with their other comparison files.
  This uses the existing loader and starts a fresh comparison. The original
  file is retained until the user supplies a new selection.
- Managed reviews receive host-specific reload instructions and no local file
  picker in this panel. The legacy host capability is false locally; a host
  cannot enable the removed converter by sending `ffmpegTranscode: true`.
- Commands retain POSIX single-quote escaping and `./` path prefixes. They
  preserve extensionless basenames and use `_aac.mp4` when no suffix exists.
  C0/C1/DEL terminal controls prevent command generation and disable Copy;
  users must rename the source first. The copy owner independently rejects
  unsafe commands. Clipboard denial/unavailability and late completions after
  clear remain handled.
- Terminal statuses now distinguish preparation from successful decoding.
  Unsupported audio does not remain labeled “Decoding audio…” or report
  “Audio decoded.” Source-format labels continue to describe the supplied file
  until a prepared file is explicitly loaded.
- Service-worker activation removes old WarpDiff version caches and the exact
  legacy `warpdiff-ffmpeg` cache. It retains unrelated host caches and does not
  intercept retired engine paths. This does not purge browser HTTP caches,
  already-open older documents, Git history or other people's copies.
- Updated README, FEATURES, MANUAL, in-app Manual, release notes and both agent
  reference documents. Version/cache are **3.19.1**. This behavior change is
  included in the concise What's New summary alongside the info-bar release.

The existing external template remains a **stereo AAC compatibility copy** of
the first video/audio streams, using video stream-copy, applied edit lists,
48 kHz / 192 kbps AAC, `-shortest` and `+faststart`. It is aimed at MP4/MOV
inputs. Other containers or video codecs can require a different command.
The UI explicitly asks users to retain their original for multichannel or
original-source measurements. Channel-preserving preparation and a verified
media contract remain future work; no claim of original-source analysis is
made for a lossy prepared rendition.

## Verification

The final complete Chromium run passed: **413 passed, 1 existing skip, zero
failures/retries**, with one worker, in **5.8 minutes**. The application and
test-file hashes recorded in `release-tree-verification.json` remained unchanged
through that run. The skipped check is identified in the full log; the two
broader WebKit failures below remain a separate limitation.

Measured checks already completed:

- **525 ownership checks passed**, zero failures, after updating guards for
  removed converter owners. Original measurement algorithms and pinned shared
  scrub/playback components are byte-identical to the branch base.
- The focused Chromium workflow ran successfully three times during review:
  **33 passed**, no retries. The full final run includes the later surround
  fallback check and all existing Chromium coverage.
- **26 focused WebKit checks passed**, zero failures/retries. These cover all
  copied-command checks, the new external-preparation suite, surround
  fallback guidance and the real AC-3 → external AAC → browser reload test.
  This is Playwright WebKit, not certification of the installed Safari app.
- The command checks cover 25 adversarial name fixtures: 23 allowed names
  round-trip through three available POSIX shells (**69 exact argument
  comparisons**), while newline/carriage-return fixtures are rejected. Nine
  isolated terminal controls are also rejected. Installed native FFmpeg
  converts seven allowed filename cases; ffprobe verifies video/AAC output.
- Real external conversion plus the panel's file picker, and separately the
  **L** shortcut, reload audible stereo AAC and update the source label only
  after loading. Conversion does not automatically replace the original.
- Four retired static asset URLs return **404**, the files are absent locally,
  and observed app workflows request no `/ffmpeg/` assets. Controlled worker
  installation/activation checks confirm an engine-free asset list, removal
  of only owned legacy caches and no interception of host media.
- Desktop **1280×800** and narrow **390×844** screenshots were visually
  inspected. The panel and load button fit both viewports, commands wrap,
  and both captures had zero page errors and engine requests.
- [Release-tree verification](release-tree-verification.json) records removed
  asset sizes, original-code licensing metadata, preserved branch identity,
  component equivalence and SHA-256 hashes of the runtime/test files.
  [UI verification](ui-verification.json) records geometry and the observed
  WebKit surround fallback. Screenshots: [desktop](panel-desktop.png),
  [narrow screen](panel-mobile.png).

Saved logs: [complete Chromium](full-chromium-final.txt),
[ownership](ownership-final.txt), [focused Chromium](focused-reload.txt),
[focused WebKit workflow](webkit-workflow-final.txt), and the
[broader WebKit run with two failures](webkit-broader-final.txt).
Earlier failed/interrupted runs are saved alongside these logs.

Native FFmpeg remains a **development/test requirement** for fixture generation
and independent external-conversion verification; it is not shipped by the app.
Windows command syntax, the actual installed Safari application, exhaustive
codec fidelity and professional loudness/true-peak accuracy were not verified.

## Failed checks and corrections

These failures are retained rather than represented as a clean first run:

1. The first ownership run detected a cache guard that allowed only versioned
   caches and then stopped when an old guard tried to extract the removed
   `_applyTranscodedFile` function. The checks now cover the exact retired
   cache and the remaining routing/clipboard owners. The completed run has
   525 passing checks.
2. The first full Chromium run was deliberately interrupted during review
   after discovering misleading terminal decode messages. The final complete
   run was restarted after the source and reload workflow were finalized.
3. An exploratory **33-test WebKit run** stopped with **2 failures, 1 pass,
   1 interrupted, 29 not run**. The two source-format tests attempted to
   interact through the newly opened preparation backdrop. Their metadata
   assertions were preserved; the tests now dismiss the guidance before
   inspecting comparison controls.
4. A **25-test WebKit workflow run** produced **24 passes and 1 failure**:
   closing the panel did not restore focus to the clicked header button.
   WebKit does not always focus clicked buttons. The open/close owner now
   accepts the actual opener; the broader follow-up and final workflow run
   confirm the correction.
5. A subsequent **33-test broader WebKit run** produced **31 passes and 2
   failures**. The remaining tests wait for a decoded three-plane listening
   buffer from 7.1 FLAC, or decoded buffers from both surround FLAC inputs.
   This WebKit runtime did not supply the required buffers. Those existing
   assertions were retained and the failures were not labeled fixed. An
   independent observation confirmed `decoded: false`, `preparation: true`
   and the original `FLAC · 7.1 · 48 kHz` metadata. The final focused workflow
   checks the deliberate external-preparation route, not native surround
   decoding or Center Only availability on that unsupported input.

The two broader WebKit failures remain a documented coverage/capability limit.
Removing browser conversion means inputs that native/WebCodecs decoding cannot
handle require preparation outside the app. A passing focused run must not be
described as universal WebKit/Safari audio support.

Previous long parallel Chromium runs on the LGPL candidate had unresolved
timing-sensitive scrub/info-bar failures. This release's full verification uses
one worker and zero retries. That does not establish a stable parallel CI gate;
CI/release protection is still a separate planned phase.

## Publication and historical remediation

The candidate is prepared for local review only. Publishing requires Jay's
approval; pushing `main` would trigger the existing Pages deployment. After an
approved deployment, verify the actual served commit/version, absent engine
URLs and fresh/updated PWA behavior.

Removing the current files does not remove the two historical nonfree WASM
objects or retrospectively cure past distributions. Existing Git branches,
tags, releases/deployment artifacts and cached references need a separate
inventory and concrete removal plan. No history rewrite, force push, branch
deletion, external contact or public cleanup was performed. The preserved
LGPL experiment also remains local and unpublished.

Host-load exception handling, channel weighting/validated true peak, large
scrub-input budgets, source-preserving preparation, CI/release protection,
architecture/CSP/storage hygiene and dependency/tooling cleanup remain outside
this interim release. The removed browser converter eliminates its particular
prefetch-cache/double-download problem and obsolete wrapper from the release
file tree; it does not address those other findings.
