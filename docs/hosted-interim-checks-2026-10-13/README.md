# Interim feature-branch push and hosted checks — October 13, 2026

Jay confirms the lower tone is gone in installed Safari after the brief-preview
fix. He authorizes pushing `codex/interim-release-review` and running the
proposed hosted checks. **Merge, publication and protection activation remain
held.** This record does not declare complete Safari or multichannel acceptance.

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

## Remaining decisions

Read both job conclusions and the tested SHA. Resolve any hosted failures and
retain the evidence. Then review the result with Jay. Main protection,
pull-request/merge approval, publication and served-site verification remain
separate actions. Historical FFmpeg distribution remediation and broader
host-load/audio-measurement changes remain separate work.
