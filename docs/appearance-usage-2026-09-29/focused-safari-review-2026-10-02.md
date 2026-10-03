# Focused independent Safari and host-lifecycle review — October 2, 2026

**Standalone WarpDiff: SHIP recommendation. Future WarpCap bundle upgrade: HOLD.** No actionable standalone production defect was reproduced in the current 3.18.12 bytes. One medium-priority host lifecycle defect was reproduced in isolated browser fixtures using the actual WarpCap transition functions; it affects both the current bundle and the candidate. One nonblocking test-observation defect explains the fresh full-suite failure.

This was an adversarial, read-only review. Production code, existing tests, prior records, both repositories' Git state, original fixtures and their timestamps were preserved. No fix, commit, push, deployment, vendor upgrade, live GoatCounter event, account-setting change, preference change or interaction with Jay's loaded Safari comparisons occurred. Only this report and its [evidence directory](focused-safari-review-evidence-2026-10-02/) were added. “SHIP” is a review recommendation, not a publication action.

## Exact candidate and environment

WarpDiff HEAD is `761d694fb38a62f299f233ce41eeabc2190a5183`, branch `codex/shared-scrub`, ahead six commits, with the substantial tracked and untracked changes listed in [the before inventory](focused-safari-review-evidence-2026-10-02/preservation-before.json). The candidate has app version **3.18.12**, cache **warpdiff-v3.18.12**, consent scope **4**, and matching document/adapter contract **3.18.12/scope-4**. Its adapter integrity is `sha256-D9dsUTie8UWB9gfEf84gTtysJGT1vFfXMUuzNYbjglE=`.

The independently calculated production hashes exactly match the October 2 release checkpoint; none of its 32 recorded source hashes differs. Key reviewed files:

| File | SHA-256 |
| --- | --- |
| `index.html` | `83b3ca8d7f5b2f97cdad044b295717ee7d801d2c09e43ed35d5fbe68172197bf` |
| `js/scrub-audio.js` | `10ca4e28959470852fcf5ce882fa5f6c3b764dde330bbad7fab4cecfe8e267da` |
| `js/audio-routing.js` | `00651e48a5fba299d52734827713527352ae82f745f4e6467cb6ce580ae67573` |
| `js/transport.js` | `0ae854a3941350a2989ba510788dab82a90460473709bc23095cfee06bfde67c` |
| `js/usage.js` | `0fd76c51389ef14581f607c47fce204edcac2464f5bc57d7314bb33586e38251` |
| `sw.js` | `a235ecf287e35c45ce6ee6f22f90461815d60e952a0315b9487d60b924a3d51b` |

[Environment and all runtime hashes](focused-safari-review-evidence-2026-10-02/environment.json), [fresh release hygiene](focused-safari-review-evidence-2026-10-02/release-hygiene.json), and [frozen candidate HTML/scripts](focused-safari-review-evidence-2026-10-02/candidate/) identify the bytes. The pre-existing localhost:8080 server returned HTTP 200 and the same HTML hash. It was preserved. The isolated suite used its own loopback server; the existing cross-origin host test still references port 8080 explicitly.

WarpCap HEAD is `49b5deddbcd634090d5a64e89aa5265bb1ea429e`, branch `codex/shared-scrub`, with one pre-existing untracked document. Its actual vendor is **3.14.5**, commit `cb9d1087a071b30cb0c1d10a95a526666f6d3c3c`. Recomputing the vendoring script's ordered path/byte digest gave **6b83ba4de73a6591b7429b6e2f64ba5dcb5ae9a742cd99786988d05d18ab4042**, exactly matching `warpdiff/VENDOR_LOCK.json`. Publishing standalone WarpDiff will not change this bundle.

Tests ran on macOS arm64, Node v26.4.0, installed Playwright Chromium **145.0.7632.6**. SafariDriver reports Safari **27.0 (22625.1.29.11.27)**. The Playwright WebKit and Firefox executable paths do not exist. No browser was installed or preference changed. There was **no fresh native Safari, Playwright WebKit, Firefox, physical speaker-listening or full native WarpCap run**. Chromium's injected `fastSeek`/`GestureEvent` capabilities select the Safari policy; they do not simulate WebKit decoding or hearing.

## Findings, in priority order

### F1 — P2 / medium: WarpCap cover does not retire the viewer's scrub/play intent

**Owners and locations:** WarpCap `ui/comparison.js:2622–2640` (`_cmpSetHomeCovered`), `ui/home.js:1055–1067` (`_setTaskSurfaceCovered`), `ui/home.js:1077–1085` (Home cover/focus), and `auth.js:465–469` (pending-logout cover). The candidate's affected deferred continuation is `index.html:9995–9998`; its hidden-document cancellation is `index.html:10010–10020`. The current bundled 3.14.5 has the equivalent continuation at `WarpCap/warpdiff/index.html:10025–10029`.

**Reproduction A — deferred resume after Home return:**

1. Use the retained host fixture with the candidate, ordinary Chromium, and two synthetic AAC videos.
2. Click the real child Play button, then use real mouse input to start a held timeline scrub. Confirm both videos have paused and the gesture is active.
3. Hold **only the actual `endScrubDrag` resume rAF callback**, identified by its `resumeGeneration` closure. Other animation callbacks and native media operations remain normal.
4. Invoke the actual WarpCap `openHome()` function. Its focus transition delivers a real child-window blur, which finishes the scrub and queues that resume.
5. Invoke the actual `closeHome()` without a new child Play action or pointer gesture.
6. Deliver the held callback after return.

**Expected:** entering Home invalidates the preceding task's pending gesture-resume intent. Returning enables interaction but does not restart playback.

**Observed:** both candidate videos change from paused to playing by the 120 ms sample, with no new child gesture. Repeating with the actual current **3.14.5** vendor produces the same result. The child document remains visible throughout, so the new hidden-tab cancellation cannot retire this callback. This is a controlled delayed-continuation reproduction, **not** a claim that the precise delay occurred in a native production session.

The paired control delivers the same callback **while Home remains open**. `_cmpBlockCoveredPlayback` correctly pauses its native play attempts, and later return stays paused. The blocker works; it cannot reject a stale intent delivered after its `_homeOpen`/`_logoutRequest` flags have cleared. A final [archived-source replay](focused-safari-review-evidence-2026-10-02/archived-host-replay-results.json) reproduced the same restart in both frozen viewers, verifying the retained reproduction's source routing.

**Reproduction B — pending logout without a child focus transition:** start a real held scrub with an established nonzero post-gain signal, then set the fixture's pending-logout token and call the exact `_setTaskSurfaceCovered(true)` owner. Backend saving and unrelated Home rendering are stubbed; no child visibility event or blur is injected.

**Observed:** in ordinary Chromium, the actual direct-output Continuous processor remains active and connected after cover. Post-gain RMS is **0.06471 at 40.3 ms** and **0.02534 at 80.5 ms**; it becomes inactive with RMS zero at **200.1 ms** through the ordinary idle timeout. `isDragging` remains true even after uncovering. In Chromium with the Safari policy, the processor likewise remains active through the 81.5 ms sample, but the host pauses the hidden native preview player and blocks its restarts. That case does **not** prove audible sound behind the cover. Neither case reproduced an unbounded sound leak.

**Impact:** host coverage pauses DOM media without owning direct-worklet cancellation, gesture retirement or deferred resume. It permits a bounded direct-output tail during pending logout and stale playback restart after a delayed Home continuation. A later pointer recovery can also encounter retained gesture state. The future candidate introduces another native-player lifecycle but does not create this underlying host defect: reproduction A also fails with the current vendor. This is a **host integration blocker**, not a standalone regression.

**Proposed fix:** expose one supported viewer suspension operation and route host cover through it before changing focus. It should invalidate gesture/play generations, cancel queued native seeks and deferred resumes without finalizing an old pointer, stop preview processing/player delivery, and pause transport while retaining loaded media. Uncovering should only restore input. Use that same owner for Home, pending logout and workspace coverage. Do not rely solely on pausing `video,audio`, a play-event blocker, or document visibility. Add the two schedules and the covered-play positive control to the host integration regressions. **No fix was implemented.**

Evidence: `Home delayed scrub resume candidate/vendor` and `logout cover without child focus transition` in [the second observations](focused-safari-review-evidence-2026-10-02/second-adversarial-results.json); [positive control](focused-safari-review-evidence-2026-10-02/host-blocker-control-results.json); [exact extracted host functions](focused-safari-review-evidence-2026-10-02/host-functions.js); [reproduction harness](focused-safari-review-evidence-2026-10-02/adversarial.cjs). The fixture executes unchanged extracted lifecycle functions and real child media/controller code, with a minimal parent shell and stubbed unrelated task/backend/activity services. It is not full authenticated WarpCap acceptance.

### F2 — P3 / low: AC-3 regression polls for a transient label and can miss it

**Location:** `tests/audio-format.spec.ts:58`, followed by its final AAC assertion at line 59.

**Minimal reproduction:** run the unchanged full suite from the retained timestamp-preserving copy with two workers and zero retries. The failure occurred at the initial expectation for `Dolby Digital`; the locator instead observed the successfully transcoded `AAC · Stereo · 48 kHz` label.

**Expected:** the regression establishes that original AC-3 metadata is published and then replaced by AAC metadata after real conversion.

**Observed:** the full run failed one polling assertion. Three fresh instrumented runs, calling the original `_setVideoAudioFormat` owner before recording its resulting DOM text, all recorded `Reading audio… → Dolby Digital → Reading audio… → AAC · Stereo · 48 kHz`. The original-codec label lasted approximately **161.6, 147.7 and 134.7 ms**. The unchanged test then passed in a targeted two-worker, zero-retry invocation. These observations support a transient-state observation race; no incorrect final source label or failed conversion was reproduced. The exact original failed run cannot retrospectively prove every intermediate write, so its failure is retained rather than rewritten as passing.

**Impact and proposed fix:** this test can falsely reject correct fast conversion. Observe mutation history or the metadata publication boundary before initiating the file load, then assert the ordered original/final states. Retain the real WASM conversion and final UI assertion. Do not slow production conversion merely to lengthen a pollable label. This is nonblocking test reliability work; **no test or product edit was made**.

Evidence: [full-suite JSON](focused-safari-review-evidence-2026-10-02/regressions.json), [failure context](focused-safari-review-evidence-2026-10-02/regression-artifacts/audio-format-source-format-442f4-eal-AC-3-to-AAC-transcoding-chromium/error-context.md), [three real transition traces](focused-safari-review-evidence-2026-10-02/format-diagnostic-results.json), and [unchanged targeted test](focused-safari-review-evidence-2026-10-02/format-followup.json).

## What passed, and what those results establish

| Area | Fresh evidence and bounds |
| --- | --- |
| Safari sink ownership and teardown | All 11 existing output tests pass. Continuous/snippet forward and reverse PCM, idle/release, mute/volume, re-entry, Clear/replacement, hidden-tab cancellation, retired pause/rejection, marker exclusion and ordinary Chromium's direct route are covered. They are Chromium signal/policy checks. |
| Late player promise settlement | Independent probes invoke real native `play()` immediately but hold its returned promise settlement. Mixed success/rejection callbacks delivered after Clear leave the old player paused, detached and without `srcObject`; its generated track is ended and the current sink remains null. Both Continuous and forced snippet fallback pass, with an actually started-player positive control and zero page errors. |
| Pending preparation | Holding the real `addModule` promise settlement establishes pending preparation with no node. Clear followed by late settlement publishes no node, buffer or sink; no page error occurs. The corrected prototype hook observes the replacement context. |
| Original analysis preservation | Every Float32 sample of both original audio-only analysis buffers was hashed before/after 12 rapid source/volume changes during preview. All three channel hashes remain identical; no page error occurred. This probe does not establish speaker quality or all codec PCM paths. |
| Native video seek/routing policy | All 206 non-skipped `warpdiff.spec.ts` cases pass, including the changed-area slow-seek queue, final seeks/cancellation, lost release, hidden/deferred resume, repaint rotation/newer-layout writes, native volume/source fades, writable-volume gate, graph-surround fallback, Sync/Solo and loops. This does not prove actual Safari picture presentation. |
| Firefox discrimination | Independent `fastSeek`-only fixture leaves `_IS_WEBKIT_MEDIA` false, retains two graph routes and creates no alternate preview player. It tests the predicate, not Firefox execution. |
| Native output fallback boundaries | The existing verified-surround, volume-locked, audio-only and Opus/replacement tests pass. These paths remain graph based; mono/stereo native-video behavior must not be generalized to them or to iOS hardware. |
| Host normal cover and final removal | The normal isolated Home schedule remains paused after return; the preview becomes inactive. Actual `_cmpStopFrame()` navigates the child to `about:blank`, hides/inerts it and invalidates host readiness. No full task-release/save or native unload-resource proof is claimed. |
| Analytics boundaries | **46 appearance/usage + 14 production + 1 real installed-update tests pass**. Includes real confirmed-Reset pending-fetch cancellation, decline preservation, permanent host ownership, no consent/no startup reporting, allowlisted payloads, integrity/disclosure mismatch and partial upgrades/downgrades. External destinations are intercepted or denied; no live event or hosted dashboard acceptance was tested. |
| Pins/cache/package source | Scrub **1.3.1** and playback **0.1.0** files match their lock hashes; canonical-source checks pass. Every referenced `js/` script is in service-worker assets. No diagnostic reference occurs in HTML. `docs/`, `tests/` and Markdown are excluded by Jekyll configuration. No Jekyll build/deployment was run; `scripts/` remains unexcluded as previously recorded. |
| Required host checks | WarpCap logic **1,206 passed, 0 failed**, and CI passes. CI warns that the existing HANDOFF priorities are 25 days old. These checks ran against the unchanged current 3.14.5 bundle, not a vendored candidate. |

Source inspection confirms the hidden player is outside `.asset-layer` and `layerEditA/layerEditB`. WarpCap `ui/task-activity.js:206–215` binds asset identities only in those two layers; `:198–203` ignores a play target not in its bound media. Its broad pause handler at line 188 still samples/closes segments. **No full candidate activity-segment accounting test was performed**, so absence of a third identity is source evidence, not proof that every segment total is unaffected. Candidate acceptance must measure that boundary.

The actual adapter/session route was also read: `platform/warpdiff-route.js`, the comparison browser adapter, runtime bridge/deactivation and final frame removal, plus WarpSonic's existing `_cancelWarpSonicPlaybackForSurfaceTransition` owner. Full WarpSonic↔comparison switching, authenticated task replacement/release and managed activity records were not exercised with the candidate. They remain upgrade acceptance obligations, not additional reproduced failures.

## Exact runs, failed probes and resolutions

| Run | Result |
| --- | --- |
| Initial disposable-suite discovery | Exit 1 before any browser test: the copy omitted README/FEATURES/MANUAL/config files read by the discovered ownership harness. Corrected the copy only. [Initial log](focused-safari-review-evidence-2026-10-02/initial-harness-regressions.log) and JSON retained. |
| Full suite after correcting the copy | **343 passed, 1 failed, 1 existing skip; 345 cases; 186.270 s; two workers; zero retries; zero flaky results.** F2 is the sole failure. [Log](focused-safari-review-evidence-2026-10-02/regressions.log), [JSON](focused-safari-review-evidence-2026-10-02/regressions.json), [invocation](focused-safari-review-evidence-2026-10-02/regression-invocation.json). |
| Targeted unchanged AC-3 regression | **1 passed**, 1.524 s total, 640 ms test body, two workers configured, zero retries. This does not make the earlier full run green. |
| Original WarpDiff ownership/pure logic | **467 passed, 0 failed**, exit 0. The disposable copy's discovery-side harness reports 465 because its optional neighboring canonical-source checks are unavailable there. |
| First independent harness | Four observations succeeded; five harness errors: a held preparation hook was attached to a context subsequently replaced; two Home probes had not established child focus/blur; two RMS probes sampled immediately after attaching a new analyser. [Source](focused-safari-review-evidence-2026-10-02/initial-adversarial.cjs), log and JSON retained. No product change. |
| Second independent harness | Eight observations succeeded, including both host resume reproductions. One preparation-harness error remained because Playwright page routing does not intercept this AudioWorklet module fetch. [Second source](focused-safari-review-evidence-2026-10-02/second-adversarial.cjs), log and JSON retained. |
| Preparation follow-up | Correct prototype-level promise-settlement hook; **one successful observation**, no stale node/buffer/sink or page error. |
| Additional focused observations | Covered-play positive control passes; three real AC-3 transition traces pass; original audio-only PCM hash comparison passes. In total **12 distinct independent cases have successful observations**. A successful observation may reproduce a defect: the two deferred-resume cases are F1, not passing release behavior. |
| WarpCap logic/CI and whitespace | Logic exit 0, CI exit 0 with the existing freshness warning, `git diff --check` exit 0. [Host logic](focused-safari-review-evidence-2026-10-02/warpcap-logic.log), [CI](focused-safari-review-evidence-2026-10-02/warpcap-ci.log). |
| Preservation | **551 original WarpDiff files and 1,064 original WarpCap files checked: zero byte changes, removals, timestamp changes or unexpected additions.** HEAD and captured Git controls remain unchanged. This inventory includes tracked/untracked files and original WarpDiff fixtures; dependency caches and other ignored host artifacts are outside its coverage. [After inventory](focused-safari-review-evidence-2026-10-02/preservation-after.json). |

The existing skip is “shows warning toast for timestamp collision”; no new skip was introduced. Media fixtures were copied with timestamps preserved, so the previous review's lost-timestamp/slot-order failure was not repeated. Original fixture bytes and timestamps remained unchanged. A one-line results-printing helper also had a corrected syntax error; it never ran product code or affected test results.

Owned disposable browser contexts and loopback servers were closed, and suite copies removed; [cleanup receipts](focused-safari-review-evidence-2026-10-02/README.md) identify them. The pre-existing preview/test servers were left alone. Independent probe external-request lists are empty; the suite's production fixtures fulfill collector requests locally, and the installed-client test uses only its local collector with an unreachable external proxy.

## Native evidence and remaining limitations

The prior records were read, including their failed controls and actual checkpoint JSON. They are historical evidence, not fresh native results from this review. In the original Safari failure, hundreds of real drag samples and strong post-gain PCM accompanied human-reported silence; a generated-stream/native-player sample was audible. The trigger remains unidentified. All six later fresh variants were audible, and Jay's October 2 statement that **both number 2 and number 5 have sound while scrubbing the original clips** establishes current original-clip audibility on both routes. It does not separately establish a new complete source/mute/volume/tab-return acceptance run. Nonzero PCM has never been substituted for listening evidence here.

No fresh actual Safari picture/tab restoration, end-to-end speaker latency, long/high-resolution footage, OS-induced context interruption, installed media-asset upgrade atomicity, iOS/iPadOS writable-volume behavior, graph-based native surround listening, native Opus/FLAC surround conversion completion, or complete authenticated host lifecycle/activity run was established. The earlier native FLAC-in-MP4 preparation timeout remains a preparation limitation, not evidence that the stream sink fails. The direct-path historical silence did not reproduce during this review; these results do not identify its cause or establish that removing the workaround would be reliable in the earlier state.

The snapshots preserve candidate HTML/scripts/locks and the reviewed host source/vendor plus the synthetic fixtures used by the independent probes. The full-suite runner depends on existing project dependencies, its broader fixture set and unchanged ffmpeg bundle, identified by the original-file inventory rather than duplicated in this bundle. This is a local retained review record; no off-device archival or deployed-byte retrieval is claimed.

## Separate release decisions

**Standalone WarpDiff — SHIP this exact candidate.** No material standalone production finding remains from this review. The previous Reset/fetch defect is corrected and its regression passes. F2 is a nonblocking observation flaw with retained failing evidence and a passing unchanged follow-up. Retain the Safari output workaround and its stated codec/latency/native-platform limitations. There is no requirement to identify the historical silent-output trigger or update WarpCap before standalone publication. Commit/publication authorization and deployed-version verification remain separate actions, not performed here; a live collector smoke event also requires separate authorization.

**Future WarpCap bundle upgrade — HOLD.** Before accepting/deploying a candidate bundle: correct F1 through one viewer-suspension owner and verify both delayed-resume and pending-logout schedules with the covered-play control; then run the candidate through actual host task replacement/release, final frame removal and WarpSonic↔comparison transitions, checking A/B activity identity and segments. If claiming Safari support for that upgraded surface, complete native embedded listening/source/mute/volume/tab-return acceptance with real child gestures and explicit latency/codec limits. Green current-bundle host logic/CI is not candidate integration acceptance. No vendor update is required to finish this standalone review, and none was made.
