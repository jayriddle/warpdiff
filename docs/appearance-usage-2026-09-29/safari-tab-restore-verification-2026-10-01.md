# Safari tab return and backward-seek playback — 2026-10-01

WarpDiff 3.18.12 now serializes Safari's native drag seeks, refreshes video surfaces after tab return, and keeps ordinary desktop mono/stereo video audio on its native output. The local candidate is updated; nothing was committed, pushed or deployed. Consent scope 4 and the analytics adapter are unchanged.

Jay reported frozen pictures with working scrub audio after leaving and returning to a Safari tab, and delayed moving pictures after seeking backward and pressing Play. The loaded user comparison was observed as two videos in Grid. Its files and tab were left intact; their private filenames were not copied into this record. Testing used a separate Safari window and known repository fixtures.

## Diagnosis and changes

The original native Grid scrub path could replace an unfinished seek every 100 ms. Stack already waited for seek completion, but only through a shared active-video state. A cold or slow decoder therefore had no per-video backpressure in Grid. `js/transport.js` now owns `_queueNativeScrubSeek`: each participating visible video has one in-flight seek, one latest pending target, and a display-frame wait after `seeked`. Same-time targets cannot create a deadlock. Timeline and waveform/spectrogram drag paths use the same owner. Other browser scrub policies remain outside this queue.

Normal release cancels queued work before applying the final pointer position. Media clear cancels it without finalizing or resuming an old comparison. Hiding the document retires the gesture and its deferred resume, including a resume already scheduled by blur. An interrupted drag ends paused; a new Play remains available. Existing playback outside a drag is not deliberately paused by this handler.

`_onPageRestore` previously recalculated geometry only. It now also refreshes hardware video surfaces through `_forceVideoRepaint`, with one coalesced restore timer. The repaint owner preserves rotation and any newer layout transform, and handles overlapping refreshes. It uses the browser's normalized CSS string when recognizing its own temporary transform.

The backward-seek delay was a separate issue. A local control page using only native video elements advanced frames by the 500 ms sample. Adding `MediaElementSource` audio routing, with no WarpDiff transport or synchronization code, reproduced the unchanged picture through that sample while the media clock advanced. This strongly implicates Safari's Web Audio/video handoff in the measured case; it is not proof that all Safari startup delays have the same cause.

`js/audio-routing.js` now keeps Safari mono/stereo **video** on native audio output when a detached-element probe confirms writable native volume. `_setMediaVolume` owns all media volume writes and combines master level with each direct output's audibility. Inactive elements stay unmuted at zero volume. Source changes use a short cancellable native volume fade, reverse from the current level, and settle immediately when the page hides. Clear cancels their timers. These native volume fades are timer-driven; they are not sample-accurate Web Audio envelopes.

Verified surround audio, audio-only media, Opus replacement, the optional slow-playback experiment, other browsers, and platforms with locked native volume retain the existing graph path. Surround retains the shared listening matrix and center controls. The volume-capability gate avoids making inactive clips audible on platforms that cannot apply native volume. No iPad/iPhone hardware run was performed.

README, FEATURES, MANUAL, the in-app Manual and AGENTS now describe the changed Safari behavior and the remaining surround startup limitation. The concise What's New summary remains three user-facing bullets; this unpublished fix was not added as another development note. The previous [Help typography correction](help-typography-verification-2026-10-01.md) remains intact.

## Native Safari results

Native Safari 27.0 was controlled through the supported computer-use tools. The isolated server bound to loopback on port 51455 and never forwarded requests. The QA buttons fetched known synthetic MP4 fixtures and dispatched DOM gestures through the real scrub controller. Those gestures are **synthetic DOM input**, not a sustained physical mouse/trackpad drag. Tab changes themselves used the native Safari UI. The Mac locked once during testing; work resumed after Jay unlocked it.

The fixtures are 960×540, 24 fps H.264 with AAC stereo, 3.023 and 4.023 seconds, with different colors each second. Presentation observations come from an additional `requestVideoFrameCallback` observer per video. Canvas samples confirm coarse fixture colors only; they are not a color-fidelity calibration. Measurements do not establish audible quality or exact A/V synchronization.

| Check | Measured result |
| --- | --- |
| Original Grid drag | Forward drag reached 2.566 s with 11 observed presentations per video. |
| Original tab return | A backward drag after a real tab change reached 0.301 s and presented the correct early frames. The permanent user-reported freeze did **not** reproduce with these small fixtures. |
| Original backward seek + immediate Play | At 100 ms, both presented the requested frame near 0.450 s. At 500 ms the presentation count and PTS were still unchanged, while media time advanced to about 0.79 s. |
| Wait for `seeked` before Play | Still held the seek frame at the 500 ms sample. This failed experiment was not shipped. |
| Repaint after `seeked`, then Play | Also held the seek frame at 500 ms. This failed playback workaround was not shipped. Surface repaint is used for tab restoration instead. |
| Plain native-video control | With blob-backed fixtures and no WarpDiff code, PTS advanced from 0.450 to 0.690 s by the 500 ms sample. |
| Native control + Web Audio | PTS stayed at 0.450 s through 500 ms while media time advanced to about 0.84–0.85 s. |
| Updated app, mono/stereo native audio | By 500 ms, PTS advanced to 0.690/0.713 s, with 38/43 observed presentations versus 32/33 at 100 ms. The specific half-second presentation hold was removed in this run. This is not a promise of instant startup. |
| Updated Grid drag and tab return | Forward drag had 31 presentations per video; backward drag after tab return added 30 per video and reached 0.301 s. No pending queue remained at either completed boundary. |
| Rotated Grid tab return | The complete `translate(-50%, -50%) rotate(90deg)` transform survived hidden/visible restoration and the next backward drag. |
| Updated Stack drag | The visible video presented 32 more frames through a forward drag; the hidden follower was settled at release. Both reached the same final target. |
| Output isolation | Native observations reported two direct outputs, zero MediaElementSource routes, and volumes 1/0 for the selected/inactive pair. |

The final held-drag/real-tab-change observations are preserved alongside these runs. They verify retirement of unfinished gesture work and the absence of automatic playback after return. The final build also passed the writable-volume capability gate on this Mac.

## Automated verification and retained failures

- **64 transport tests passed, no retries, 52.3 s** in the final Chromium run. These cover the Safari scheduling branch with controlled slow seeks, volume/mute/source changes, late callbacks, volume-locked platforms, verified surround monitoring, ordinary scrub decoders, canceled/rejected Play, lost mouseup, clear/reload, Sync/Solo, loop ranges, pause snapping, Stack switching, native audio fades and Opus replacement. The Safari branch in Chromium is selected by controlled capability fixtures; this does not turn Chromium into WebKit.
- **462 ownership and logic checks passed, 0 failed.** Added executable tests use the shipped queue and volume owner with slow completions, independent videos, same-time targets, paint waits, rapid fade reversal and cleanup. They accompany structural single-owner guards.
- The first focused run had **17 passes and one failure**: the repaint left `translateZ(0px)` behind because its comparison used the unnormalized `translateZ(0)` string. Capturing the assigned CSS value fixed it. The next focused run passed all 18 tests. Both logs remain available.
- A broader intermediate transport run passed 62 tests, and the first surround-focused addition passed five tests. The final 64-test run adds the locked-volume case and includes the final capability gate.
- The first plain-video control used direct HTTP media URLs on a server without byte-range support. Both videos stayed at `readyState = 0`; those observations are retained but excluded from playback conclusions. Blob-backed controls corrected the fixture transport.
- The existing ownership and whitespace checks passed. Native test collector receipt count was zero. No live GoatCounter count was sent.

## Evidence and limitations

Evidence is in [safari-tab-restore-evidence-2026-10-01](safari-tab-restore-evidence-2026-10-01/):

- [baseline-observations.json](safari-tab-restore-evidence-2026-10-01/baseline-observations.json), [wait-seeked-observations.json](safari-tab-restore-evidence-2026-10-01/wait-seeked-observations.json) and [seek-repaint-observations.json](safari-tab-restore-evidence-2026-10-01/seek-repaint-observations.json) retain the original and unsuccessful alternatives.
- [observations.json](safari-tab-restore-evidence-2026-10-01/observations.json) contains the native controls and updated app runs. Early `baseline` labels also appear on the first queue-only revision; timestamps and the archived baseline distinguish them. Later `updated-app` records include direct-output and queue state.
- [final-transport-tests.txt](safari-tab-restore-evidence-2026-10-01/final-transport-tests.txt), [ownership.txt](safari-tab-restore-evidence-2026-10-01/ownership.txt), and [focused-tests-initial-failure.txt](safari-tab-restore-evidence-2026-10-01/focused-tests-initial-failure.txt) preserve verification and the resolved failure.
- [final-source-hashes.json](safari-tab-restore-evidence-2026-10-01/final-source-hashes.json) identifies the final source. `server-info.json` identifies the earlier server-start snapshot and is not the final source hash list.
- [restored-grid.jpg](safari-tab-restore-evidence-2026-10-01/restored-grid.jpg) shows the rotated comparison after returning to the tab. A still screenshot does not prove continuous playback.
- The local server, QA panel and plain-video control are retained as reproducible test harnesses. They are not production scripts, added service-worker assets or shipped analytics. Temporary test clips and the isolated Safari window are cleaned up; the normal preview remains available on port 8081.

The original permanent freeze was not reproduced with the known short clips. These changes close the identified scheduling and surface-restoration gaps, but the same comparison that Jay used still needs a reload and retest to confirm that symptom is gone. Native surround playback, audible source-switch quality, long/high-resolution footage, touch devices, and installed-PWA cross-version behavior were not newly verified. The final transport changes do not remove every possible Safari decode/startup delay. Publication remains pending confirmation of the originally reported Safari scenario.
