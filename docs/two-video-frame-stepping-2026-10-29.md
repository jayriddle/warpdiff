# Two-video Grid frame stepping — October 29, 2026

Branch: `codex/two-video-frame-stepping`, based on published `1ad69d46b22b7c100443c21bac3f2b7b370db772` (3.19.15). Candidate: **3.19.16**. Merge and publication are not authorized. The investigation used headless browsers only; no windows were opened over Jay's work.

## Report and reproduction

Jay reported apparently frozen or repeated pictures while stepping through **two videos in Grid mode in Chrome on Mac**. Jay has not compared that behavior in Stack. Stack coverage below is regression protection, not a reported Stack defect. The exact user files were unavailable; the investigation used generated H.264 controls.

The old tests mostly checked seek times. A new probe read both native decoded pixels and actual Grid screenshot pixels from seven-bit frame markers, with a fixed white guard that rejects blank captures. The controls are 320×180, four seconds, have B-frames and long-enough GOPs to exercise backward decoding, and use matching 24 fps or mixed 24/30 fps timelines.

On unchanged 3.19.15, one burst reached decoded frames **20/25** while the screenshot still showed **5/25**. A second probe reached **17/21** while both displayed pictures stayed at **3/3**, including samples 100 and 500 ms later. There were no page errors. Initial matching-rate slow taps passed. This establishes a native decoded-picture versus composited-picture discrepancy in these controls; it does not establish the cause of every repeated frame in Jay's media. A mixed-rate follower can also legitimately repeat or skip a frame while remaining aligned by time.

## Change and rationale

`_queueFrameStepSeek` in `js/transport.js` owns one in-flight native step per participating video and retains only its latest queued target. Every key still advances the logical reference cursor. Native decode and a matching presentation callback precede the next seek, with a 150 ms **post-decode** fallback for hidden/nonpresenting layers. Videos progress independently, so a hidden Stack follower cannot block the visible video.

State and per-issued-seek tokens fence late frame callbacks and timers. A changed source, removed element, external seek or changed transport retires stale work. The logical cursor stays authoritative through native decode and the seeked-to-animation-frame gap, even beyond the old 750 ms burst limit. Play commits the latest requested position before taking over; pause, restart, scope changes, scrub entry, clear/replacement and page hiding retire queued callbacks and references.

Native video rendering, color handling, audio routing, frame-rate detection and mixed-rate time alignment are retained. There is no canvas replacement, repaint-only workaround, new decoder or bundled converter. The candidate keeps the previous What's New announcement as a quiet maintenance release; detailed history records 3.19.16 separately.

## Verification

Tools: macOS 27.0.1 arm64, Chrome 156.0.8078.48, Playwright 1.58.2, Node 26.4.0 and FFmpeg/ffprobe 8.1.2. Existing tools only; no installations or upgrades. One browser worker and zero test retries throughout.

- Final author Chrome run: **15 passed** — five cases repeated three times; no skips, unexpected failures, flakes or report-level errors, 82.9 seconds. Source hashes match the final runtime and test snapshot.
- Three paired-picture cases check both decoded and displayed frames after forward/backward taps and bursts: 24/24, 24/30 and 30/24 fps. The existing single-video test is retained. The lifecycle case checks Play's requested position, Stack hidden followers, Solo scope, scrub entry and replacement with retired callbacks.
- Pure queue fault checks: **23 passed**, including slow decode before the presentation timeout, a key in the paint gap, hidden fallback, cancellation, repeated target identity and external seek takeover.
- Ownership/pure harness: **1,769 passed** locally, including the two neighboring WarpCap checks absent from hosted checkout. Infrastructure: **29 passed**.
- The same five browser cases are added to the existing WebKit profile and its explicit third shard. Required check names, report completeness gates, one-worker policy and zero retries are retained.
- All **37 existing fixture files** retain their bytes, sizes and nanosecond modification times. All **579 pre-existing non-ignored untracked files** retain their original contents and timestamps. The user's Chrome session and existing server were untouched; the investigation uses separate loopback servers.

Independent adversarial review found **no actionable findings remaining** after the timing and callback corrections. The reviewer independently ran the exact five-case suite in headless installed Chrome (**5 passed**, 24.9 seconds) and WebKit (**5 passed**, 24.1 seconds), plus nine paired displayed/native-frame observations with the second video selected as reference and a Play/Pause handoff. Both suites had zero skips, retries, flakes, unexpected results or report errors. The reviewer also replayed all **23 pure queue checks**. The readable report is retained at `output/two-video-stepping-source-review-20261029-IeRCrB/REVIEW.md` with its structured receipt.

Existing related Chrome coverage: **30 passed** in playback output, restart, playhead clocks, color rendering and held scrub-target handoff. Two legacy transport cases also passed in an isolated source/fixture snapshot, preserving root fixture timestamps. No hosted workflow has been dispatched.

## Failed and superseded attempts

The first minimal serialized-seek candidate allowed only an animation-frame opportunity after decode. Its diagnostic probes improved, but the stronger browser suite still recorded **two passes and two mixed-rate failures**. Those failures are retained rather than relabeled passing. Reusing the existing repaint owner alone also failed; its interrupted run contains one pass, two failures and one unexecuted case. Neither approach remains in the candidate.

The first presented-frame candidate passed all four focused cases and then **20 repetitions**, before the final lifecycle and timing hardening. Independent source review found that its timeout began before decode and could expire during a slow seek; that was corrected to start after decode, with a new negative regression. Per-issuance tokens and an external-position fence also close late callback and paint-gap ownership risks. These earlier passes are not substituted for the final 15-case run.

Test setup failures were kept distinct: an initial TypeScript import combined CommonJS output with `import.meta` and failed before collecting tests; the CommonJS-compatible PNG import corrected it. The lifecycle test initially used a nonexistent slider ID and failed before checking scrub cancellation; selecting `videoProgressContainer` corrected the test. Earlier pure fixtures also needed to settle already-issued synthetic native seeks and to capture the timeout after decode, matching the changed lifecycle. No pixel threshold or behavioral assertion was weakened.

The existing single-video fixture depended on FFmpeg `drawtext` and a Linux font path. Its binary frame markers, B-frame and opening-edit controls remain; the font-dependent overlay is removed so the same fixture runs with the installed Mac FFmpeg. The paired fixtures need no fonts and never rewrite the repository's shared media fixtures.

## Completion-wait and negative verification

The first two-case legacy run had one pass and one failure: its mixed-rate test sampled native times after fixed 40 ms sleeps and observed 0.152382 seconds of intermediate divergence while native targets could still be queued. A separate real-media probe measured a maximum **0.0125 seconds** between the fully settled 24/30 fps positions across 24 steps, below the unchanged **0.020833-second** half-frame bound.

That test now waits only for native readiness, no pending seek and no frame-step queue, bounded at five seconds. It does not wait for alignment or a desired timestamp. The half-frame and ten-step position assertions are unchanged. Both legacy cases passed afterward in **10.1 seconds**. A deliberate independent-clock mutation then failed the intended unchanged drift assertion at **0.204167 seconds**, confirming that the completion wait does not conceal the older synchronization bug. The independent reviewer inspected this test-only adjustment.

The new paired-picture regression also fails against the original transport: the forward-burst assertion expected displayed frames **18/23** but received **15/19**. Both browser negative controls retain secondary 60-second teardown timeouts; the original-transport run also records the maximum-failure stop notice. They establish failure at the intended behavioral assertions, not clean passing runs. Three separate pure mutations each fail exactly their intended check, with no runner exception: accepting the following frame as presentation, accepting a retired issued callback, and starting the timeout before decode. The pure baseline passes all 23 checks.

The reviewer’s extra reference-switch helper initially sampled before the loading opacity transition finished. It rejected its visibility guard before recording frame observations; adding a fully-visible precondition corrected setup without weakening pixel thresholds. The author mutation helper also initially rejected an ambiguous source target before editing any source; an exact target made all three negative controls reproducible.

## Evidence and limitations

Author logs, reports, generated media, screenshots, source hashes and preservation checks are retained under `output/two-video-frame-stepping-2026-10-29-yF0rmS/`. Start with `baseline-probe.json`, `latency-before-queue.json`, `final-chrome.json`, `final-source-hashes.json`, `preservation-current.json` and the matching configuration files. The temporary serialized and repaint-only sources are retained there; they are not shipped.

This is generated-media verification on headless browser renderers, not a physical-display or exact-user-file certification. Variable-frame-rate media still uses the existing estimated timing policy; this change does not introduce exact sample-by-sample VFR stepping. Rapid bursts can coalesce intermediate pictures while preserving the final requested frame. A complete browser inventory and hosted release gate have not been rerun for this unpublished branch. No merge or publication occurred.
