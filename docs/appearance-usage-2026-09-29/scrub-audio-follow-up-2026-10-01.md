# Scrub silence remains unresolved — 2026-10-01 follow-up

Jay reported that 3.18.12 still has no scrub audio after the earlier preview-context recovery change. That report supersedes any interpretation of the preceding verification as proof that his issue was fixed. The previous change addresses an inactive/interrupted context, with controlled evidence; the actual cause of this continuing silence is not established.

## Native inspection and interruption

An attempt to read the affected comparison's internal state through Safari Web Inspector did not yield usable console results. No successful state snapshot was obtained, and no diagnosis follows from those attempts. Merely seeing waveform/analysis data does not establish that a listening buffer or audible preview is available.

Jay then explained that he was actively working with multiple videos while the inspection was underway, and that the testing was interfering with scrubbing. Native Safari interaction stopped immediately at that point. Subsequent work used a separate headless browser and synthetic repository fixtures. No further native Safari navigation, clicks, preferences, media loading or inspector actions were performed. The inspector may still be open from the earlier attempt; it was not closed automatically because doing so would again control the window Jay was using.

The affected tab's observations cannot be treated as a clean reproduction: active user work and agent inspection overlapped. Private clip names, media and screenshots are not preserved in this record or its evidence. The continuing user report remains valid and unresolved.

## Isolated checks

A disposable headless Chromium context loaded the two known AAC stereo fixtures through the app's real file input, then used browser mouse drags on the timeline. `fastSeek` and `GestureEvent` were supplied to exercise WarpDiff's Safari policy. This is **not native Safari or a WebKit decoding test**. Service workers were blocked and external requests denied. Preview output was measured through an AnalyserNode; a zero-gain destination prevented these test previews reaching the speakers. Native videos were scrubbed while paused, without normal playback.

| Check | Maximum preview RMS |
| --- | ---: |
| Fresh Grid, forward | 0.07803 |
| Grid, reverse | 0.07619 |
| Stack, forward | 0.07527 |
| Stack, reverse | 0.07241 |
| Stack after choosing the next asset | 0.06641 |
| Grid after returning from Stack | 0.07968 |
| First replacement comparison | 0.07430 |
| Second replacement comparison | 0.07244 |
| Third replacement comparison | 0.07680 |

All nine gestures produced a signal, with running contexts and no captured page errors. These probes narrow the investigation but do not disprove Jay's Safari report or establish hardware audibility. They are exploratory observations, not a new production regression suite.

An isolated WebKit run was attempted first. Its expected browser executable was absent despite a partial cache directory. The official Playwright browser download reached its displayed 100% progress but did not finish installing during this investigation. Its owned installer processes were terminated before ending the work. No WebKit result is claimed. Native Safari and system settings were not changed by that installation attempt.

Evidence: [probe source](scrub-audio-follow-up-evidence-2026-10-01/probe.cjs), [full measurements](scrub-audio-follow-up-evidence-2026-10-01/chromium-result.json), [output](scrub-audio-follow-up-evidence-2026-10-01/chromium-output.txt). The helper contains absolute workspace and temporary output paths for reproducibility. It uses synthetic fixture files only. Its headless browser was closed normally after the checks.

## Status

No additional production code changes, commit, push, deployment or live GoatCounter event occurred in this follow-up. The local preview remains on port 8081; it was not restarted. Release remains on hold. Normal Play audibility and the precise Grid/Stack conditions in the affected session are still unknown. Further native testing must occur without competing with Jay's active work, and must distinguish signal production from actual listening before describing the silence as fixed.
