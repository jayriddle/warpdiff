# Small interim release review — October 12, 2026

Status: local candidate under review. No push, merge, publication or remote
protection activation is authorized or performed in this slice.

October 13 follow-up: the human Safari check exposed a brief-preview pitch
mismatch. The [local fix and verification](../safari-scrub-pitch-2026-10-13/fix.md)
supersedes the unchanged-runtime assumption for that adapter. The complete
gate below describes the earlier revision; the affected Chromium suites,
expanded WebKit profile and ownership checks have passed for the local fix.
Installed Safari listening acceptance and exact-revision release checks remain
pending before publication.

## Agreed release scope

Jay selected option **1**, the small interim release removing browser FFmpeg
conversion and retaining safe external commands and explicit reload. This
confirms the earlier interim-release preference. It does not approve combining
the later 3.19.5 foundations work into this publication.

The review branch is `codex/interim-release-review`, created from
`codex/external-media-preparation` at
`c87479a7e04ad9791c5df0404430abfd41ec29bb`.
The last locally recorded `main` baseline is
`75eb81f701de89628d432148c46dac87b18f0d98`. Remote HEAD was not refreshed in
this slice and must be checked before any approved push/PR.

The candidate retains the reviewed POSIX filename quoting and clipboard fixes,
the branch-rename record, the correction of unintended ISC package metadata
to `UNLICENSED` / `private: true`, and the engine-free **3.19.1** app. No new
reuse license is granted. The license correction does not attempt to change
the terms of third-party components or resolve past FFmpeg distributions.

The broader host-load containment, BS.1770/FIR measurement corrections,
prepared-media producer/contract and versioned channel mixing remain committed
on `codex/reliability-foundations` at `eabcb6e`. The LGPL replacement experiment
remains on `codex/ffmpeg-distribution` at `dca2736`; it is not included here.
Existing unrelated untracked evidence/output was left untouched.

## Review and necessary fixes

Reviewed the application delta from local `main`, including bundle/loader and
conversion-state removal, decoder fallback routing, source retention, command
generation/copy, focus restoration, managed reload instructions, clear/reload
retirement, terminal decode status, service-worker cache retirement and aligned
documentation. This is a focused release review, not a whole-repository audit.

One material workflow bug was reproduced: a short audio track could cause
`-shortest` to truncate copied picture. Two generated H.264/AC-3 inputs had
48 video packets and a 2-second picture, with 0.7-second soundtracks starting
at 0 and 0.5 seconds. The original copied command retained only **14** and
**26** packets, with picture durations **0.583008** and **1.083008** seconds.
Both new regression checks failed before the fix at packet equality.

The copied command now applies `-af apad` before `-shortest`, retaining every
video packet while padding the short soundtrack with silence. The same
diagnostic now retains **48/48 packets** and **2.000000 seconds** for both
inputs. This carries over only the external-command fix from the later work;
it does not include the prepared-media producer or its listening policy.
The regression also checks unchanged original bytes, stereo AAC at 48 kHz,
audible sound and a silent tail. Instructions describe the padding consistently.
FFmpeg documents this use of [apad with shortest](https://ffmpeg.org/ffmpeg-filters.html#apad).

Release safeguards were adapted from the foundations proposal to this branch's
actual tests: complete Chromium plus ownership, and focused macOS WebKit
command/preparation/reload. They do not call absent measurement/contract files.
The workflow remains local. See [release safeguards](../release-safeguards.md).
No runtime dependencies or browser FFmpeg assets were added. A stale fixture
comment referring to browser WASM conversion was corrected.

The first complete gate finished with **414 passed / 1 failed / 1 existing
skip**, zero retries, in **10.5 minutes**. The sole failure was the existing
Solo handoff test: it compared a source paused at transfer with a target read
after a 250 ms wait plus further browser/driver calls. The observed late gap
was **0.322441 seconds**, above its 0.3-second limit. A teardown timeout was
also logged; its partial trace archive contains only resource entries, with
no usable clock/event trace. Exact delivery timing and the teardown cause
are not independently established from that failure.
The complete log, screenshot/error-context and JSON summary are retained.

Only the relevant test correction from the later branch was carried over:
read both clocks in the task that initiates transfer, require a **less than
50 ms** initial gap, then independently require the old source paused and the
new target playing/advancing. The later Sync convergence assertion is retained.
This is a stronger check of transfer accuracy; it does not compare a moving
clock to an intentionally stopped one. No transport/runtime change or higher
drift tolerance was introduced. A new complete run is required after this
test-only correction; the earlier failure is not relabeled as a passing gate.

Three focused corrected handoff runs passed in **8.7 seconds**, zero retries.
The largest immediate difference between native `currentTime` readings was
**0.026 ms**; the intentionally later difference was **272.7–284.4 ms** as the
new target played and the old source stayed paused. This measures API clocks,
not acoustic or presented-picture synchronization. See [clock readings](solo-handoff.json).

The second complete gate finished with **414 passed / 1 failed / 1 existing
skip**, zero retries, in **13.4 minutes**. Solo passed. The sole new failure
was the Safari-policy preview check after clear/reload: its later sweep
reported zero RMS. This is a Chromium test of routing policy, not an installed
Safari observation. Its trace archive was incomplete, but the full deflated
`test.trace` event entry was recovered read-only from local ZIP headers.
No partial browser trace was presented as complete.

The replacement sweep's **driver API start gaps** had a **198.468 ms median**,
**374.225 ms maximum**, and **15/15 gaps above 130 ms**. RMS-read calls started
a median **153.1205 ms** after the corresponding move-call start. These are
driver timestamps, not direct DOM event-arrival or acoustic sample telemetry;
they do not establish timing as the sole cause of the historical silence.
They show that the old test did not establish the continuous-motion premise
inside the app's 130 ms idle window. See [recovered timing](preview-driver-timing.json).

The test also waited for a processor after reload without requiring the new
decoded listening buffer. It now requires both. The reviewed test-only
`moveHeldPointer` helper schedules held movement and RMS sampling in one page
evaluation, through the real document handler, while retaining trusted
Playwright down/up gestures. Actual motion gaps must remain below **130 ms**;
the existing RMS **>0.01**, idle/mute **<0.001**, volume-ratio and clear/source
retirement assertions remain. Volume ratios now explicitly require an audible
full-volume reference. Successes attach compact sweep results; failures retain
the full motion/PCM diagnostic. The preview suite then passed **11/11**, zero
retries, in **56.4 seconds**. Runtime, decoder and listening/DSP files were
unchanged. The third complete gate is required after these test changes.

## Verification

The final complete gate passed on the revised tree. All release browser runs
used **one worker and zero retries**, with `CI=1` requiring an owned server.
No skip or retry was added to resolve a failure.

| Check | Final measured result |
| --- | --- |
| Complete Chromium release gate | **415 passed / 0 failed / 1 existing skip**, **12.7 minutes**, zero flaky outcomes. [Log](full-verified.txt), [summary and motion/clock results](full-verified-summary.json). |
| Focused macOS Playwright WebKit workflow | **28 passed / 0 failed**, **20.1 seconds**. Commands, external preparation, short-audio picture preservation and explicit AAC reload. [Log](webkit.txt). |
| Final ownership harness | **525 passed / 0 failed**. [Log](ownership-final.txt). |
| Command/preparation focused Chromium | **27 passed / 0 failed**, **10.2 seconds**. [Log](focused-chromium.txt). |
| Corrected Solo handoff | **3 consecutive passes**, **8.7 seconds**, zero retries. [Log](solo.txt), [readings](solo-handoff.json). |
| Corrected preview suite | **11 passed / 0 failed**, **56.4 seconds**. The subsequent complete run also passed these checks. [Log](preview.txt). |
| Source stability | **93 runtime/tooling/test hashes** unchanged through the final Chromium and WebKit gates. [Source/evidence receipt](source-and-evidence.json). |
| Narrow scope | **15 sensitive runtime/pin files byte-identical to local main**; retired engine and later prepared-contract files absent; locked dependencies unchanged. [Receipt](scope-verification.json). |
| Workflow/tooling | YAML structure/action pins/triggers, fixture generation, `bash -n`, and `git diff --check` passed. Hosted execution remains pending. |
| Panel UI | **1280×800** and **390×844** captures inspected; panel/load control fit, no page errors or engine requests. [Geometry](ui-verification.json), [desktop](panel-desktop.png), [phone](panel-mobile.png). |

The complete gate's largest recorded preview motion gap was **62.5 ms**, below
the 130 ms input limit. At Solo transfer the two API clocks read identically;
the later paused-source/moving-target difference was **328.515 ms**, which
illustrates why the retired 300 ms late comparison was misleading. The tighter
50 ms transfer assertion and subsequent play/Sync assertions passed.

The one existing skip is the timestamp-collision toast placeholder, which
lacks near-identical last-modified fixture inputs. The broader native WebKit
7.1 FLAC checks remain outside this focused profile, with their original
failures/assertions documented rather than relabeled as fixed.

The original interim candidate's prior **413-pass Chromium / 525 ownership /
26 focused WebKit** results remain in
[its verification record](../external-preparation-2026-10-11/README.md).
They are not substituted for tests of this revised tree. This is local macOS
verification, not native Ubuntu CI or installed-Safari acoustic certification.

Raw diagnostics/logs are under `/tmp/warpdiff-interim-review-20261012/`.
The first ad-hoc probe could not connect because the prior local server had
ended. An owned preview was started; the probe then reproduced the truncation.
This was a setup failure, not an application failure.
The bundled Python lacked a YAML parser; the installed Ruby YAML parser then
validated the workflow syntax, push/PR/manual triggers, two jobs, read-only
permissions and 40-character action pins. This is static validation, not a
hosted-job result. Fixture generation and shell syntax validation completed.

## Remaining review decisions and limits

- Native hosted Ubuntu Chrome and macOS WebKit results require an approved
  feature-branch push. Main protection remains a proposal.
- Installed Safari and human listening remain unverified. The narrow review
  needs an unsupported soundtrack → copied command → externally prepared AAC
  → explicit reload check, plus ordinary playback/scrub. It does not need the
  broader prepared-package channel-policy approval before shipping this scope.
- Original loudness/true-peak algorithms and legacy host-load handling remain
  unchanged, including the independently reviewed limitations. Professional
  measurement accuracy is not newly certified by this release.
- Stereo AAC is a compatibility copy. It does not retain original multichannel
  analysis or promise identical balance to the later explicit prepared mix.
  Keep the original. Other containers/video codecs may need another command;
  Windows terminal syntax is not supported by the copied POSIX template.
- Native 7.1 FLAC decode limits in the broader WebKit checks remain documented.
- Removing current FFmpeg assets does not erase Git history, old deployments,
  HTTP caches, older open documents or other copies. Historical remediation
  remains separate; no history rewrite or destructive cleanup is performed.

Next: Jay reviews this candidate and completes the
[human workflow/listening checklist](human-review.md). Then obtain explicit
approval to push **only the interim feature branch** for hosted checks. Inspect
those exact-revision results before any protection activation or release.
Publication remains a separate explicit decision. The localhost preview is
available for reviewing version 3.19.1; refresh any older open document first.
