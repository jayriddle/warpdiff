# Release checkpoint — October 2, 2026

**The next step is a focused independent review of the current Safari changes. The full current-candidate regression run is now complete and green.** Give the reviewer the [prepared prompt](focused-safari-review-prompt-2026-10-02.md). Resolve material findings and verify their fixes, then make the standalone deployment decision. WarpCap's separate bundled viewer requires its own update and acceptance process.

This checkpoint is preparatory verification, not an independent adversarial review or a deployment. No production code, user browser preferences, loaded private clips, hosted account settings or WarpCap files were changed. No commit, push, deployment or live GoatCounter count was performed. Existing local preview servers were preserved. The existing test fixture owner rewrote synthetic image/readme timestamps as described below.

## Candidate identity and scope

The candidate is **WarpDiff 3.18.12**, cache `warpdiff-v3.18.12`, consent scope 4, disclosure/adapter contract `3.18.12/scope-4`. HEAD is `761d694fb38a62f299f233ce41eeabc2190a5183`, branch `codex/shared-scrub`, with substantial tracked and untracked release work. HEAD alone does not identify this unpublished candidate.

The existing server at `http://localhost:8080/` returned HTTP 200 and bytes exactly equal to the workspace `index.html` before testing. The complete [source/hash receipt](release-checkpoint-evidence-2026-10-02/release-hygiene.json) identifies the tested runtime. Its key SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `index.html` | `83b3ca8d7f5b2f97cdad044b295717ee7d801d2c09e43ed35d5fbe68172197bf` |
| `js/audio-routing.js` | `00651e48a5fba299d52734827713527352ae82f745f4e6467cb6ce580ae67573` |
| `js/scrub-audio.js` | `10ca4e28959470852fcf5ce882fa5f6c3b764dde330bbad7fab4cecfe8e267da` |
| `js/transport.js` | `0ae854a3941350a2989ba510788dab82a90460473709bc23095cfee06bfde67c` |
| `js/usage.js` | `0fd76c51389ef14581f607c47fce204edcac2464f5bc57d7314bb33586e38251` |
| `sw.js` | `a235ecf287e35c45ce6ee6f22f90461815d60e952a0315b9487d60b924a3d51b` |

Compared with the previous independent review's preservation inventory, five production HTML/JavaScript/service-worker files changed: `index.html`, `js/audio-routing.js`, `js/scrub-audio.js`, `js/transport.js` and `js/usage.js`. The last change is the documented Reset cancellation fix. The Safari changes introduce native seek scheduling/restoration, writable native video gain routing, scrub-context priming and generated-stream preview output. Shared DSP pins and analytics collection categories remain unchanged.

## Verification completed in this checkpoint

| Check | Measured result |
| --- | --- |
| Complete Playwright suite | **344 passed, 1 existing skip, 0 failed, 0 flaky, 0 retries**; 345 cases, two workers, headless Chromium; 190.977 seconds |
| Ownership/pure logic | **467 passed, 0 failed**, exit 0 |
| App/cache alignment | 3.18.12 matches `warpdiff-v3.18.12` |
| Analytics integrity and disclosure contract | Current SHA-256 matches HTML integrity; both contracts equal `3.18.12/scope-4` |
| Extracted-script cache coverage | Every HTML `js/` script is in the service-worker asset list |
| Shared component pins | Scrub 1.3.1 and playback 0.1.0 files match their committed lock hashes |
| QA packaging inspection | Local diagnostic references absent from HTML references and service-worker assets; `docs/`, `tests/` and Markdown are excluded by `_config.yml` |
| Existing-file preservation | **518 pre-existing tracked/untracked files hash-checked; zero byte changes or removals** |
| Fixture preservation | All existing fixture bytes unchanged; media fixture timestamps unchanged |
| Tracked whitespace | `git diff --check` passed |

Commands, machine-readable results and full logs are preserved in [invocations](release-checkpoint-evidence-2026-10-02/invocations.json), [result summary](release-checkpoint-evidence-2026-10-02/results-summary.json), [Playwright JSON](release-checkpoint-evidence-2026-10-02/full-tests.json), [browser log](release-checkpoint-evidence-2026-10-02/full-tests.log), and [ownership log](release-checkpoint-evidence-2026-10-02/ownership.log). The behavioral runner exited 0. The pre-existing skip is “shows warning toast for timestamp collision,” which needs fixtures with nearly identical modification times; it was not newly skipped to obtain a passing result.

The existing `ensureFixtures()` owner in `tests/warpdiff.spec.ts` rewrote eight synthetic PNGs and `readme.txt`, changing their timestamps but not their bytes. This is retained in the [preservation summary](release-checkpoint-evidence-2026-10-02/results-summary.json). No fixture generation or timestamp-copy workaround was needed. There were no failed test runs in this checkpoint. An initial lock-file lookup used the wrong directory; discovery resolved the locks to `js/SCRUB_AUDIO_LOCK.json` and `js/PLAYBACK_AUDIO_LOCK.json` before pin verification. Runtime Node/color deprecation warnings in the log did not cause test failures.

The full run includes media/transport, source handoff, scrub output scheduling/PCM, consent/official-host fixtures and the real local service-worker update test. Official-host counting requests were intercepted locally by the production suite; the installed-client test selected a loopback collector and denied external destinations. No live account acceptance or dashboard aggregation was tested.

## Evidence limits and the release decision

Jay's October 2 report that both direct output and the shipping workaround sounded audible while scrubbing his original clips closes the original-clip audibility prerequisite. The [root-cause record](safari-root-cause-investigation-2026-10-01.md) preserves the exact distinction between human listening and local preparation receipts. The historical silent-output trigger remains unidentified. This checkpoint adds no new native Safari hearing, picture-presentation, tab-return or embedded-host test.

The automated Safari capability fixtures use Chromium, not native WebKit. They establish scheduling, policy and signal-flow behavior, not speaker audibility or native surround/mobile support. Native FLAC-in-MP4 preparation, Opus/FLAC surround coverage and extra output buffering latency retain the limitations in the [Safari output record](safari-output-investigation-2026-10-01.md). The partial-update test verifies the analytics integrity/disclosure gate; it does not prove atomic upgrades for every media asset. Packaging was inspected in source/configuration; no Jekyll build was run. The existing configuration does not exclude `scripts/`, while the diagnostic browser helpers/evidence are under excluded `docs/` and `tests/`.

The review should concentrate on stale callbacks, pending player starts, Clear/replacement, source/mute/volume changes, and host coverage during scrubbing, with native platform coverage stated accurately. Repeat broader testing only when a finding or subsequent edit warrants it. Passing this full suite does not replace that independent review.

The neighboring local WarpCap bundle was previously observed as 3.14.5; standalone publication will not update it. The [WarpCap source assessment](warpcap-scrub-output-implications-2026-10-02.md) identifies Home/logout/task-release schedules for a future bundled upgrade, without claiming a reproduced leak. Keep the standalone release decision separate from that upgrade. Once material review findings are resolved, the next standalone action is commit/publish and verify the deployed version plus a fresh consented smoke check; publication was not authorized or performed by this checkpoint.
