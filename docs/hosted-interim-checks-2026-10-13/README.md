# Interim feature-branch push and hosted checks — October 13, 2026

Jay confirms the lower tone is gone in installed Safari after the brief-preview
fix. He authorizes pushing `codex/interim-release-review` and running the
proposed hosted checks. **Merge, publication and protection activation remain
held.** This record does not declare complete Safari or multichannel acceptance.

**Outcome: the feature branch is pushed and both hosted checks passed** at
`e72f098347ec1fc06a0e958762c053244adbf1a1` in [run 38508619644](
https://github.com/jayriddle/warpdiff/actions/runs/38508619644), attempt 1.

| Hosted check | Final result |
|---|---|
| Ubuntu Chromium | **423 passed, zero failed/flaky, one existing skip**, 13.2 minutes. [Report summary](final-chromium-summary.json), [test/ownership log excerpts](final-chromium-log.txt). |
| Ubuntu ownership | **523 passed, zero failed**. A standalone runner lacks the two neighboring WarpCap source checks included in the 525-check local result. |
| macOS WebKit | **32 passed, zero failed/flaky/skipped**, 81.3 seconds. [Report summary](final-webkit-summary.json), [test log excerpts](final-webkit-log.txt). |

Both hosted jobs succeeded, with one browser worker and zero test retries.
[Exact run/job metadata](final-run.json) records the tested SHA and job URLs.
The earlier two hosted failures and all corrections are retained below; they
are not hidden by retries or represented as passes.

After the green run, a remote read-back confirmed the feature branch at `e72f098`
and main still at `75eb81f701de89628d432148c46dac87b18f0d98`. Pages still builds
from main `/`, and main protection remains inactive. No merge, publication or
repository setting change occurred. Results recorded after the run are local
documentation only; they have not been pushed to trigger another full gate.

## Scope and remote preflight

- Remote default branch: `main`, at
  `75eb81f701de89628d432148c46dac87b18f0d98`, freshly read before this push.
- GitHub Pages uses the legacy branch build from `main` at `/`. The feature
  branch has no deployment workflow. Pushing it is scoped to test execution.
- The feature branch did not exist remotely at preflight. The push will create
  only `refs/heads/codex/interim-release-review`, without force or tags.
- The existing preview-deployment workflow remains registered but its file is
  absent from this feature branch. No workflow registration is removed here.
- The branch contains safe command quoting, the unintended ISC metadata
  correction, browser FFmpeg removal, release checks, the short-soundtrack
  picture-retention fix and the brief-preview pitch fix. The LGPL replacement
  experiment and broader reliability/prepared-media branch are not ancestors.
- `main` is currently unprotected; the documented protection payload remains a
  proposal. No repository setting will be changed by this task.
- Prior local checks: affected Chromium suites 25/0; expanded WebKit profile
  31/0; ownership 525/0. The earlier full Chromium pass predates the pitch fix,
  so the hosted full-suite result must be read for the exact pushed revision.

## Hosted run

The feature branch was pushed successfully at
`103f92b58709502f43ad1c1eef9eaf39e2945c52`. A read-back confirmed that remote
`main` remained at the preflight SHA. No tags, other feature branches or main
updates were pushed.

The push triggered [`WarpDiff checks`, run 38504321421](
https://github.com/jayriddle/warpdiff/actions/runs/38504321421), attempt 1, for
that exact SHA. Both jobs started and passed installation and fixture
generation; Ubuntu ownership also passed before starting the full browser
suite. The initial WebKit job then failed one test (30 passed), as documented
below. The initial Chromium result was **414 passed, four failed and one existing
skip** (15.7 minutes); hosted ownership passed **523 checks**, with the two
neighboring canonical-repository checks unavailable in a standalone checkout.
The workflow has two jobs:

- **Chromium and ownership** — Ubuntu 24.04, Node 24, native FFmpeg/zsh,
  Chrome media codecs, fixture generation, ownership and complete Chromium.
- **WebKit preparation workflow** — macOS 15, Node 24, native FFmpeg,
  command/preparation/reload and brief-preview pitch checks.

Both browser gates use one worker and zero retries. The workflow has a read-only
token, exact action pins and no merge/deployment step. Hosted failures will be
recorded and addressed on this feature branch before considering a release.

## Initial WebKit failure and test correction

The hosted WebKit job failed the Continuous-entry check during a reverse 0.5×
drag: it expected the processor to be active but read it after activity ended.
The pitch-spectrum regression and fallback check passed. The [failure excerpt](
initial-webkit-failure.txt) and [extracted trace timing](initial-webkit-timing.json)
retain the original result.

The complete trace shows actual held-motion gaps of at most 53 ms. The last
in-page sample was read 46 ms after motion and still reported the native stream
requested/running. Between the sweep's browser-protocol completion and the next
state-read request, tracing introduced **168.782 ms**. That interval alone
exceeds the app's existing **130 ms** idle cutoff. The later read returned
`continuous:false`, one snippet at source rate 1×, and selected/native playback
rates both at 0.5×. The original sweep did not sample the Continuous flag, so
its original during-motion state is not independently established by this trace.

The test helper now optionally invokes a test-only state sampler alongside
motion in the page's clock. The pitch test reads that captured state, asserts
its actual motion age is below 130 ms, and retains the same active/direction,
pitch, playback-rate and cleanup assertions. One reverse 0.5× gesture also
deliberately waits 180 ms afterward and verifies the processor has gone idle,
while its captured moving sample must have been active. This reproduces the
late-read condition without changing the app's idle behavior or hiding it with
retries. An afterEach attachment preserves accumulated gesture evidence on
success or failure.

No application file, vendor pin, playback policy, timing limit or test timeout
was changed for this correction. A diff against `103f92b` confirms the runtime
is unchanged. Local checks for the test correction:

- **14 Chromium checks passed**, 51.6 seconds: new pitch tests plus all existing
  Safari-preview output checks sharing the helper. [Log](local-chromium.txt).
- **31 WebKit checks passed**, 23.0 seconds, zero retries and zero skips.
  [Log](local-webkit.txt), [gesture samples](local-gesture-samples.json).
- **525 ownership checks passed**. [Log](local-ownership.txt).

The complete initial Chromium run finished before a corrected feature-branch
push, so its evidence was retained instead of canceled by workflow concurrency.
The next push will start a fresh pair of hosted checks.

## Initial Chromium failures and portability corrections

The [initial run metadata](initial-run.json) and [failure excerpts](
initial-chromium-failures.txt) retain all four failures. Ubuntu's audio context
uses 44.1 kHz; local checks had used 48 kHz. The corrections affect tests only:

1. **Selected-stream byte accounting:** an exact-byte assertion computed a
   same-rate buffer's frame count from `ceil(duration × rate)`. At 44.1 kHz,
   floating-point rounding added one three-channel frame: expected 2,381,400
   bytes versus 2,381,388 actually retained. The test now uses integer buffer
   length, still asserts exact bytes, and explicitly checks source/context rates.
2. **Fallback analysis rate:** a signal generated at the context rate was
   asserted to retain 48 kHz metadata. The runner correctly retained 44.1 kHz.
   The assertion now checks the configured source rate, retaining exact 8 kHz /
   64,000-byte fallback, phase, alias rejection, level and analysis assertions.
3. **Clear-during-preparation fixture:** hardcoded 48 kHz source buffers used
   filtered downsampling at a 44.1 kHz context, bypassing the OfflineAudioContext
   barrier the test awaited. It timed out waiting for a path it never exercised.
   Source fixtures now match the test context: surround folding enters the
   deliberately blocked offline render, and the current stereo replacement is
   reused. The single-render, stale-publication and identity assertions remain.
4. **Center-only tone measurement:** a rectangular 1,024-sample measurement
   happens to contain whole 1,500/375 Hz cycles at 48 kHz, but not at 44.1 kHz.
   Spectral leakage then looked like front-channel audio: the measured ratio was
   0.011509 against the unchanged 0.01 limit. A separate pure 1,500 Hz sine check
   across 32 phases produced false 375 Hz ratios up to 0.011797 at 44.1 kHz.
   Hann weighting with coherent-gain normalization reduces that false ratio
   below 0.000010. The short-preview test uses that window and retains its
   original channel-level and rejection limits; other band measurements retain
   their existing method.

All four affected cases now run explicitly at **44,100 and 48,000 Hz** through
a test-only AudioContext constructor helper. No runner's native rate is assumed.
The three affected suites passed **28/28 locally**, one worker, zero retries,
including native/Continuous/replacement listening and both-rate cases.
[Log](local-rate-fixes.txt), [summary](local-rate-fixes-summary.json).
Ownership still passed **525/525 locally**. Runtime files remain byte-identical
to `103f92b`; no threshold was relaxed, existing skip expanded, or timeout raised.

The initial artifacts are downloaded locally under
`/tmp/warpdiff-hosted-38504321421-{chromium,webkit}/`. GitHub retains their uploaded
HTML reports and complete failure traces for 14 days. This directory keeps the
run metadata, numerical timing, failure excerpts and local correction results
for lasting review. The artifact upload action succeeded but warned about its
Node 20 declaration being forced onto Node 24; upgrading that action is separate
maintenance and is not the cause of these test failures.

## Corrected hosted revision

Both test corrections were pushed to the same feature branch at
`2e39d0a1b6b2de9d8f17866ccccc841459b96963`. Application code is byte-identical
to the Safari-accepted runtime at `103f92b`. A remote read-back again confirmed
main at `75eb81f701de89628d432148c46dac87b18f0d98`.

The push started [run 38506626141](
https://github.com/jayriddle/warpdiff/actions/runs/38506626141), attempt 1, for
the corrected exact revision. WebKit again finished with 30 passes and one
failure; its new moving-state assertions passed. Chromium finished with
**421 passes, one failure and the existing skip**, 15.0 minutes. All four initial
sample-rate/accounting/measurement failures passed after their corrections.
The [second run metadata](second-run.json) retains both job conclusions.

## Second WebKit result: direct entry is a valid path

The [second hosted gesture samples](second-webkit-gesture-samples.json) show
Continuous active at 0.5× forward/reverse and 1× forward/reverse, sampled 42–45 ms
after motion. Selected and native playback rates agree. The 1× reverse gesture
entered Continuous without any snippet, failing the test's assumption that
every drag must start with a snippet. Native seeking can deliver the first audio
position after motion has already begun; a prepared engine then enters
Continuous directly. This is a valid app path, not lost preview audio.

The test now requires snippets in forced fallback and checks the rate of every
snippet emitted in either normal or fallback entry. It retains all active,
direction, pitch, playback-speed, motion-window and cleanup limits. A separate
direct-entry test models delayed native positions by withholding position
delivery until the actual motion helper reports velocity. It explicitly
requires zero snippets, active Continuous and the correct direction/speed.
This replaces an invalid universal snippet-count assumption with coverage of
both valid startup paths.

The first local direct-entry fixture used a two-sample count as a proxy for
motion; repeated stationary samples still produced a click snippet. The
[failed fixture run](direct-entry-fixture-first.txt) retained its 3 passes and
one failure. Using actual motion velocity corrected that fixture.
The dedicated direct-entry case then passed all six speed/direction gestures
in Chromium ([log](local-direct-entry.txt)). The expanded WebKit profile passed
**32/32 locally**, 29.0 seconds, no retries ([log](local-webkit-entry.txt),
[measurements](local-entry-regressions.json)). Ownership remained 525/525.
Application source and all numerical pitch/mix limits are unchanged.

The next feature push will start another exact-revision run. If the prior
Chromium job has not finished, the configured concurrency policy will cancel
that obsolete run; its partial result will not be presented as a complete pass.

## Second Chromium result: rotation fixture ownership

The remaining Chromium failure was `surface refresh preserves rotation and a
newer layout transform`: expected the first 90° CSS rotation, but observed an
empty transform; its later 180° result was correct. [Failure excerpt](
second-chromium-failure.txt).

The test wrote `video.style.transform` directly while the app's rotation state
remained 0°. The loading helper waits for the active comparison, not completion
of every pending layout. A later valid layout can therefore rebuild the style
from the owned 0° state, which the repaint owner correctly respects. The
fixture now calls `_rotateSlot` for both rotations and deliberately overlaps
`applyZoom` with repaint. It retains exact 90° and 180° expectations, including
the owned centering translation, and tests
preservation with legitimate competing layout writes, without a fixed sleep
or application change. The focused check passed locally ([log](local-rotation.txt)).
The first owner-based local run kept the obsolete bare-rotation string
expectation; it failed because the real transform correctly includes
`translate(-50%, -50%)`. Its [failed log](local-rotation-first.txt) is retained.
The corrected check asserts the complete exact transform rather than discarding
centering or merely matching the angle.

Both earlier full runs finished, so none of their full-suite evidence was
canceled. The next revision combines the valid direct-entry test and owned
rotation fixture before starting a fresh hosted gate.

## Final submitted revision

The combined test corrections were pushed at
`e72f098347ec1fc06a0e958762c053244adbf1a1`. Remote main remains at the original
preflight SHA. [Run 38508619644](
https://github.com/jayriddle/warpdiff/actions/runs/38508619644), attempt 1, tests
this exact revision. The WebKit job passed: **32 tests, zero failures, skips or
flaky results**, 81.3 seconds of browser execution. [Report summary](
final-webkit-summary.json). The complete Chromium suite also passed: **423 tests,
no failures or flaky results, one existing skip**, 13.2 minutes. The entire
workflow concluded **success**.

The application, audio components, vendor pins, service worker and manifest
are byte-identical to the Safari-accepted runtime; only tests and their records
changed while establishing the hosted gate. No merge, publication, PR creation,
protection activation or other branch push has occurred.

## Remaining decisions

Both job conclusions and the tested SHA are verified, and the evidence is saved.
Review the result with Jay. Main protection,
pull-request/merge approval, publication and served-site verification remain
separate actions. Historical FFmpeg distribution remediation and broader
host-load/audio-measurement changes remain separate work.
