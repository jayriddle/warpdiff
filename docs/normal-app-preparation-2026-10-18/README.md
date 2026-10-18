# Normal WarpDiff preparation connection — 2026-10-18 PT

## Scope and release boundary

The user authorized connecting the reviewed local preparation prototype to the
normal app, tests, adversarial review and a PR. Merge/publication remain held.
Branch: `codex/normal-app-preparation`, starting from `40cdfd4`. The complete PR
also contains the related, still-held PR #53 usability work and reviewed local
prototype; main remains the PR baseline. PR #53 is not merged or changed here.

Normal Load/drop is preserved. A current video/audio failure offers the
Preparation dialog. The user explicitly connects a separately running local
tool, approves its separate connection window, then chooses Prepare and open.
Selected affected files are prepared locally and returned as Files; unaffected
comparison files retain their established slot order. No manifest, per-file
terminal command, second picker, port scan, remote preparation upload, engine
download or in-browser FFmpeg is involved. The safe copied command remains under
Other ways to prepare. The helper's launch page opens normal WarpDiff; the old
managed wrapper is now only `/demo.html` development reference.

## Ownership and trust boundaries

- `preparation-connection.js` owns version-1 popup/MessagePort transport. A
  strictly parsed `http://127.0.0.1:port` address, exact source window/origin,
  random nonce and explicit local approval precede any File transfer. The
  native bearer token stays in the helper page. No CORS endpoint is added.
  [Window.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
  and [MessagePort.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage)
  define the browser transport. The production trust boundary is the entire
  `jayriddle.github.io` origin; loopback HTTP/HTTPS is allowed for local use/tests.
- `local-preparation.js` owns comparison File references and generation-fenced
  issue/prepare UI. Connecting or discovering an adapter does not prepare.
  Clear/replacement cancels work; invalid selections retain it. Managed-host
  entry disconnects and cannot inherit standalone source authority.
- The new `local-review-copy-v1` recipe is separate from the unchanged copied
  command recipe. The trusted registry reconstructs output policy, strips
  provider acceptance claims and always requires normal loading.
- Internal prepared reloads reuse the existing strict image/initial-video-frame/
  audio-only-analysis readiness owner, with no replyWindow or new public host
  message. They retain normal standalone usage mode. A returned File's shape
  or successful FFmpeg conversion cannot authorize admission. Prepared-profile
  validation, original fidelity and measurement conformance remain unverified.
- The helper page invokes the existing fixed native API on its own origin;
  native input/output limits, private paths, exact Host/Origin/token checks,
  TERM→KILL retirement and one-job reservation remain in force. Port/comparison
  generations fence stale results. Native files are not in the Pages allowlist;
  the two browser modules are pinned/staged/offline assets.

## Preparation policy and known limits

The external processor is unchanged: compatible H.264 picture is copied; other
video can become H.264 up to 1080p; video audio becomes stereo AAC. Audio-only
PCM24 retains channel count/rate, not certified speaker-layout fidelity. It
rejects ambiguous multiple streams. Originals stay on disk. Input 512 MiB,
accepted output 1 GiB, ten-minute job deadline; the 100 ms output monitor can
overshoot temporary disk use. These do not cap all native/browser memory or CPU.

No native installer/signing/updater, crash recovery, all-format guarantee,
HDR/color or loudness/true-peak certification is included. Physical Safari and
devices require separate verification. The existing paused WebKit black frame
until Play is retained; earlier Grid/amplitude/7.1 observations are not repaired
or reclassified. The published app gains this feature only after a reviewed
release; use the locally served normal app for this candidate.

## Verification so far

- New normal-app integration inventory: **26 passed**, Chrome and Playwright
  WebKit, one worker, zero retries; 40.3 seconds. It uses separate HTTPS app and
  HTTP loopback origins, real DTS/FFV1/audio-only conversion, local approval,
  no-file connection, automatic return, cancellation/replacement, corrupt-output
  rejection, blocked popup/address checks, handshake guards, narrow keyboard
  operation and managed-host isolation. A controlled negative event isolates
  the wrong-origin guard; it is not a claim that browsers permit origin spoofing.
- Ownership: **1,360 passed**; native external/helper checks: **32 passed**;
  infrastructure: **26 passed** after updating the protected command assertion
  and tracking the new public browser modules. No fixture regeneration or
  dependency/machine-setting changes were made.
- Broader loading/preparation regressions, final pinned review, staged-package
  checks and required hosted checks are pending at this implementation checkpoint.

## Failed checks retained

The first exploratory probe met the normal welcome backdrop. After dismissing
it, Chrome prepared AC-3 successfully, but this WebKit runtime decoded AC-3
directly, making the expected preparation offer a wrong test assumption. Actual
DTS/FFV1 fixtures now exercise both engines without forcing a decode failure.

The initial integration inventory had **20 passed/two failed**: navigating a
real connection popup caused its intended disconnect/close and invalidated the
negative-origin test. The next run had **20 passed/three failed/one not run**:
Chrome cleared opener/navigation state, while narrow Tab traversal exposed a
real dialog defect in both engines. Explicit traversal now includes visible
buttons/links and excludes descendants of collapsed guidance. A focused run
then passed three/four; Chrome's attacker message was sent before its navigation
settled. Waiting for the attacker's actual load corrected that harness error.
The complete 26-case run subsequently passed. Earlier failed reports, timeout
errors and maximum-failure stops remain preserved and are not called green.

The first infrastructure run failed two safeguards: the old exact preparation
command assertion, and refusal to stage untracked new modules. Both were
corrected without weakening the gate; 26 checks then passed.

Raw evidence and before-state hashes/fixture mtimes:
`output/normal-app-preparation-2026-10-18-4ykElw/`.
Final review/hosted results will be appended before PR handoff.

## Adversarial correction checkpoint

The adversarial source review found that the helper installed its port listener
before rejecting an untrusted launch origin. A crafted later CONNECT could
re-enable approval. Launch identity validation now precedes listener setup;
disconnecting is terminal for that window. Native VM checks cover invalid
origins, missing opener/nonce, valid production/local origins and late CONNECT.
The preparation modal now retires Appearance's capture handler and both app
hotkey handlers exempt it. Typing, remapping and native Space remain local.
Eight focused browser checks passed across Chrome/WebKit, one worker/zero retries.
Ownership remained 1,360; the helper native inventory increased from nine to ten
passing checks.

An initial broader regression run was interrupted at 154 passes/two failures/
124 not run after obsolete implicit-command-panel expectations and a mid-run
test-source update made it unsuitable as final verification. It is not green.
The corrected integration attempt also retains a Chrome companion-order timeout:
the source names remained unchanged while native work ran unusually long, and
cleanup timed out. No cause or processor repair is claimed. The isolated case
subsequently passed in both engines, as did a direct native padding probe. The
interrupted attempt additionally contained an invalid late-CONNECT harness:
normal app disconnect correctly closes its popup; the focused replacement uses
an independent controlled opener to exercise a still-open, disconnected bridge.
Further full inventories and independent browser checks are pending.

## Corrected candidate and independent outcome

At `b520fb3`, the complete new integration inventory passed **32/32** in
44.8 seconds, one worker and zero retries. Native preparation/helper checks
passed **33/33**, ownership **1,360/1,360**, and infrastructure **26/26**.
The unexplained earlier companion timeout remains historical evidence; this
passing run does not establish its cause or claim a processor repair.

The adversarial reviewer found no remaining material finding in the corrected
scope. Independent execution passed **12/12** selected integration cases,
**four** custom keyboard/origin checks and **two** real-public-origin transport
probes. Chrome and WebKit navigated the actual GitHub Pages origin, temporarily
injected only candidate transport/test controls, approved the local popup and
explicitly prepared a fixed AC-3 fixture. Both returned a 26,572-byte MP4 and the
unchanged released app decoded its audio. No native API request occurred before
Prepare. This verifies the transport under the production HTTPS origin; it does
not mean the candidate is deployed, nor replace physical Safari verification.
The public site remained 3.19.7 at `72dcec3`.

Independent evidence: `output/normal-preparation-independent-2026-10-18/REVIEW.md`
and `review.json`. The reviewer preserved all 37 fixture hashes/sizes/mtimes.
Author preservation checks found no missing or unexpected changed pre-existing
files. Exact `b520fb3` staging produced **86** stable/pinned public files; native
helper, bridge and processor files are absent. Further staged/offline and broader
regression results, required hosted check receipts, final hashes and preservation
are retained in the author evidence directory's final verification record and PR.
These later checks must be inspected before merge consideration. Merge and
publication remain held; this record does not authorize release.

## Hosted-test correction

Initial PR #54 hosted run `39146174521` at `8e54dad` was **not green**:
Chromium shard 1 failed the audio-format external-reload test because its L
shortcut was sent while the new Preparation modal was open. That modal correctly
owns its keys; the old test implicitly expected the command panel. Source search
also found four MP4 fallback branches expecting that old panel directly.

Only `tests/audio-format.spec.ts` and `tests/mp4-audio.spec.ts` were adapted:
choose Other ways to prepare → manual command before exercising that fallback,
and dismiss current preparation guidance before unrelated control checks.
Decoder support, no-audio, generation, error, source-metadata and actual shell
conversion assertions remain intact. All **44** relevant Chrome/WebKit checks
passed, one worker/zero retries, 51.9 seconds. Independent source review found
no material issue in the adaptation. No production change was needed.

The initial hosted run was cancelled after the recorded shard failure; partial
passes/cancelled jobs are not a complete passing inventory. A fresh hosted run
of the corrected commit is required. Final receipts are kept in the author
completion record and PR; source runtime bytes remain those reviewed at b520fb3.
