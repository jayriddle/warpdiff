# Feature branch review — October 14, 2026

Jay requests review and correction of `codex/interim-release-review`, with merge
and publication held. Earlier authorization to push this feature branch and
run hosted checks remains in force. No main/protection/Pages settings are changed.

**Outcome: review corrections are committed and pushed; both hosted jobs
passed** at `86dcd2634249a2e859b7723514cddf62623b84d5` in [run 38628574447](
https://github.com/jayriddle/warpdiff/actions/runs/38628574447), attempt 1.
No remaining blocking issue was found within this interim-release scope.

| Final hosted verification | Result |
|---|---|
| Ubuntu Chromium | **433 passed, zero failed/flaky, one existing skip**, 11.0 minutes. [Report summary](hosted-chromium-summary.json), [log excerpts](hosted-chromium-log.txt). |
| Ubuntu ownership | **523 passed, zero failed**. Two neighboring WarpCap source checks are unavailable in the standalone runner; local ownership passed 525. |
| macOS WebKit | **42 passed, zero failed/flaky/skipped**, 118.6 seconds. [Report summary](hosted-webkit-summary.json), [log excerpts](hosted-webkit-log.txt). |

Both browser gates used one worker and zero retries. The one Chromium skip
is the existing timestamp-collision placeholder, not a new exception. The
new keyboard, focus-preservation, narrow-window visibility and format checks
all passed. Native conversion, packet retention, original-pitch previews and
the full real-time audio cases passed on the hosted runner. The uploader
successfully saved both reports, with no old Node 20 forced-runtime warning.
[Run/job metadata](hosted-run.json) and report metadata establish the exact
tested revision.

After completion, remote read-back confirmed this feature head and main still
at `75eb81f701de89628d432148c46dac87b18f0d98`, unprotected. Pages remains a
legacy build from main `/`. **No merge, publication or setting activation.**
Final result notes are saved locally after the green run; they are not pushed
to create another documentation-only full test cycle.

## Scope and baseline

Reviewed the feature branch at local `1b78a8d`, against freshly fetched main
`75eb81f701de89628d432148c46dac87b18f0d98`. Remote feature head was `e72f098`;
`1b78a8d` adds the previous hosted-result record only. The prior hosted checks
passed at `e72f098`: 423 Chromium passes / one existing skip, 32 WebKit passes,
and 523 standalone ownership checks. See the [prior full record](
../hosted-interim-checks-2026-10-13/README.md).

This is a review of the small interim release: literal external terminal
commands, removal of browser FFmpeg distribution/execution, preparation and
explicit reload, legacy host capability fencing, service-worker retirement,
original-pitch brief previews, and the hosted tests. It is not a complete audit
or a review/merge of the separate reliability/prepared-media or FFmpeg
redistribution experiments.

Read the runtime diff and current owners in `index.html`, `js/audio-decode.js`,
`js/scrub-audio.js`, `js/transport.js`, and `sw.js`; reviewed the affected browser
and ownership tests, fixture/real-shell execution, CI/browser profiles, package
license changes, Pages exclusions, and release records. The earlier test
corrections retain explicit sample/byte/timing/pitch bounds: they account for
44.1/48 kHz device rates, sample active gestures within the actual motion
window, permit verified direct Continuous entry, and exercise rotation through
its application owner. They do not remove the broader 7.1 FLAC assertions.

## Findings and corrections

1. **Preparation-panel keyboard focus escaped behind the backdrop.** Shift+Tab
   on Close moved to background controls; Tab after the final control could do
   the same. The modal panel now wraps Tab/Shift+Tab through its enabled visible
   controls. Escape retains the existing close/focus-return owner. Tests cover
   ordinary commands, control-character rejection, unsupported formats, and
   managed hosts where the download link is the final control. The dialog has
   explicit modal semantics and a description.
   A subsequent 390-pixel-wide visual check found that suppressing focus
   scrolling could leave the reload button partially clipped. A new negative
   regression at 390×480 failed on the original wrap ([log](
   narrow-focus-before.txt)). Focus wrapping/restoration now reveals the
   focused control, including after another entry grows the panel; reopening
   resets the scroll to the heading. This additional correction supersedes
   the first pushed review revision and its hosted run.
2. **New entries could remove focus from download/reload controls.** Rendering
   preserved a focused slot's Copy button but destroyed and replaced the
   common download and Load prepared files controls without restoring focus.
   The existing renderer now preserves those controls too. Regression tests
   add a second entry while each common control owns focus.
3. **A ready-to-copy MP4/MOV command was offered for other containers.** A real
   one-second VP9/Opus WebM file failed the shipped command with exit **8**:
   `Option ignore_editlist not found`. See [native reproduction](
   webm-command-before.json). The command also attempted AAC output with the
   original `.webm` extension. The interim app now offers this command for
   `.mp4`, `.mov`, `.m4v` (case insensitive), and extensionless names; other
   extensions show a preparation notice and disable Copy. This deliberately
   stays within the existing MP4/MOV command rather than introducing a general
   conversion policy. The panel and product docs state the format limit and
   that the copied video codec must work in the browser. Real FFmpeg tests now
   cover MOV, M4V and uppercase MP4 alongside adversarial names.
4. **The report uploader declared an old runtime.** The previous hosted run
   warned that upload-artifact v5's Node 20 runtime was forced to Node 24.
   Updated both jobs to the official v7.0.2 commit
   `cf430e030ddbb5b0abf93d22962f4752f3646cd9`, whose `action.yml` declares
   `node24`. Verified the official release/tag/commit and metadata before
   editing. Default archived reports remain enabled; the optional direct
   single-file mode is not selected. See [release safeguards](
   ../release-safeguards.md) for primary-source links.

Product descriptions were updated together in README, FEATURES, MANUAL and
in-app help; AGENTS/CLAUDE record the preparation contract. The unpublished
candidate remains **3.19.1**, with the existing matching service-worker version.
Pinned shared scrub controller/DSP files and normal playback behavior are
unchanged by these corrections.

## Verification, including failures

Saved text logs remove terminal color sequences and trailing whitespace; test
names, assertions, failures and counts are preserved.

- Initial negative regression run: **three failures, one not run**, recorded in
  [reproduced-failures.txt](reproduced-failures.txt). Focus wrapping and download
  focus failed; the reload-focus check timed out. The runner stalled during
  failure cleanup and was interrupted. The WebM case did not run in that batch;
  its independent native-command reproduction above confirms the format bug.
- First corrected Chromium focused run: **39 passed, one failed**, zero retries,
  [full log](chromium-focused.txt). All nine new regression cases passed. The
  existing carriage-return rejection test failed in **context teardown**, not
  its command assertions (`Tearing down "context" exceeded ... 60000ms`);
  the reported run lasted 17.3 minutes. No root cause is established here, and
  this is retained as a failed run, not silently counted as a pass.
- Initial corrected WebKit profile: **41 passed**, zero retries, **28.8 seconds**,
  [log](webkit.txt). Three managed-host focus-wrap assertions were then added
  to the existing host cases and must be covered in final verification.
- Local ownership: **525 passed, zero failed**, [final log](ownership-final.txt).
- `vendor-scrub-audio --check`: pinned v1.3.1 files match. `git diff --check`
  passed. Native FFmpeg tests preserve originals and compare all retained
  video packets, including short/delayed audio; source pitch and playback-speed
  assertions remain in the browser gate.

- The first broad local Chromium run was interrupted after recurring real-time
  audio failures. [Its partial log](chromium-full.txt) is not a full-suite pass.
  Retained [trace errors](interrupted-trace-errors.json) identify zero measured
  Continuous RMS (expected >0.01) and `Audio clock did not advance` in dialogue
  tests. The isolated Continuous case also failed under bundled Node 24.19.0
  ([log](continuous-isolated.txt)), so changing the test-tool runtime did not
  resolve the audio failure.
- A blank-page oscillator probe, with no WarpDiff code, reproduced the clock
  limitation in both bundled Chromium and Chrome: each reported `running`
  at 48 kHz but advanced only **0.005333 s** during **1.001–1.002 s** of wall
  time. [Measured results](standalone-audio-clock.json). This establishes a
  local headless-audio limitation independently of the application; it does
  not identify the underlying browser/device/OS cause. No audio assertions,
  retry policy, system audio settings or application audio routes were changed.
- A second focused Chromium run under Node 24 had **39 passes / one failure**
  ([log](chromium-focused-final.txt)); the M4V conversion exited successfully,
  but its subsequent ffprobe process returned no exit status. An independent
  native rerun converted and probed that same case successfully in **20 ms**,
  confirming H.264 plus stereo AAC/48 kHz and a one-second duration ([evidence](
  m4v-probe.json)). The transient process failure remains recorded. The test
  now checks probe errors explicitly before examining status/output, so any
  later process failure has a useful diagnosis.
- Final local WebKit: **41 passed**, zero retries, **28.7 seconds**, including
  the added managed-host focus checks and explicit probe-error check
  ([log](webkit-final.txt)).
- Final local command suite: **19 passed**, zero retries, **5.4 seconds**,
  including all real native conversions/probes and original/video-packet
  preservation ([log](commands-final.txt)).
- After the narrow-window correction, local preparation and command suites:
  **37 passed**, zero retries, **11.3 seconds** ([log](workflow-final.txt)).
  The new check verifies full visibility after backward Tab wrapping, a panel
  refresh that adds another command, and closing/reopening.
- Latest local WebKit profile, including that additional regression:
  **42 passed**, zero retries, **28.9 seconds** ([log](webkit-latest.txt)).
  Ownership was rechecked after the correction: **525 passed, zero failed**.

The first push (`122dc31cadabfe9bb92e675b1845c8718c22e254`) started [run
38627199812](https://github.com/jayriddle/warpdiff/actions/runs/38627199812).
Its WebKit job succeeded before the narrow-window correction was ready;
Chromium was still running. Pushing `86dcd26` superseded that revision through
the existing concurrency policy: the first run is cancelled, its Chromium job
cancelled, and its WebKit job successful ([retained metadata](
superseded-hosted-run.json)). The completed final run above tests the corrected
revision, including the extra visibility regression. The cancelled run is not
represented as a complete pass or as a product failure.

## Remaining limits and release holds

- The format guard uses the filename extension. It is not a parser or a
  guarantee that a renamed file contains MP4/MOV, or that every copied video
  codec is supported. Extensionless commands retain the existing MP4/MOV
  assumption. Other formats need external preparation suited to their input.
- The stereo AAC output is a compatibility copy; originals remain necessary
  for multichannel/original-source analysis. General preparation modules and
  an input-media contract remain separate planned work.
- The two broader WebKit native 7.1 FLAC decoding failures remain documented,
  outside the focused profile, with their assertions retained. Installed
  Safari's lower-tone acceptance came from Jay; hosted WebKit is not a full
  physical-device listening certification.
- Broader host-load error containment, measurement accuracy, memory/range
  loading, malformed MP4 guards, architecture/CSP, and package/repository
  hygiene remain separate work. Package metadata still has the stale 1–3
  description and nonexistent `main` entry point. This interim release does
  not claim to resolve all twelve original findings.
- `UNLICENSED` / `private: true` remain the core metadata; no new reuse grant
  is made. Current browser FFmpeg assets are absent, but historical Git objects
  and previous distributions require their separate remediation.
- Main is still unprotected at the baseline SHA. Pages still builds from main
  `/`; the stale preview workflow registration remains untouched. Protection
  activation and a final release decision precede any approved merge.
- **No merge, publication, deployment, history rewrite or settings activation.**
