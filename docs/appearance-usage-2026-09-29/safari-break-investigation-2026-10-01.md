# Safari scrub silence — inspection during Jay's break

Jay authorized native desktop testing during a 15-minute break on 2026-10-01, beginning at approximately 4:01:57 p.m. Pacific. Desktop interaction ended before 4:16:57 p.m. The existing loaded comparison was inspected without replacing or reloading its private clips. No media contents, filenames or screenshots are saved here.

## What this inspection establishes

The affected Safari session initially reported `AudioContext.state = suspended`, selected slot `editA`, master mute false, selected-slot mute false, and an available decoded preview buffer. This is the first successfully obtained internal state from Jay's actual comparison. A suspended context cannot produce preview audio at that moment; it is not by itself proof of a bug, because it was sampled while paused, outside a scrub gesture.

After a native pointer interaction on the exposed timeline, the context was running. The selected preview was approximately 12.69 seconds long, its audio start was zero, the continuous processor existed without an error, volume was 100, and Grid used the pointer clock. The loaded `_primeScrubAudioContext` included the preceding inactive/non-closed recovery condition; this was not an old adapter missing that change.

The meter did not retain samples with `dragging = true` during that native pointer interaction. Its duration/event schedule is therefore not established well enough to infer preview output from that interaction alone. A subsequent bounded controller probe dispatched 24 synthetic DOM moves at 40 ms intervals into the real timeline handlers, using the already loaded clips and running context. It measured maximum continuous preview RMS **0.24558**, maximum snippet RMS **0.16528**, and **17** samples with the continuous processor active. The first and last samples reported a running context.

This narrows the problem: the actual selected clip has usable preview audio, and both the short-preview and continuous paths can produce a strong signal in the affected session. Missing decoded PCM and an active application mute do not explain this controlled result. It does **not** establish that Jay's original silent physical gesture produced sound, that sound reached his hardware, or why the original gesture was silent. No additional production fix is justified by these results alone.

## Inspection difficulties and resolution

The initial inspector showed no ordinary calculation results even when `1+1` was entered. A harmless alert verified that console evaluation worked. Larger diagnostic commands did not yield readable results during that phase. Pointer targeting also reported that no window was available. Two desktop-control calls then took approximately two minutes each to fail; a shorter runtime timeout did not consistently bound the underlying desktop operation. These were control failures, not audio tests or proof that Safari itself had frozen.

Jay confirmed the Mac was unlocked. Resetting the computer-use connection restored access and revealed console history/results that had not been visible in the earlier observations. Ordinary `JSON.stringify` diagnostics then worked without alerts. A clipboard operation reported failure although its text appeared afterward; the current prompt was inspected before execution. These failed approaches are retained because they consumed much of the available native test window and limit what was completed.

## Cleanup and current status

The temporary meter's stop command completed, removing its timer and disconnecting each added analyser connection. The temporary drag function and result globals were removed. Web Inspector was closed, both private clips remained loaded, the selected source remained A, and playback was paused. No consent, browser preference, system setting or account setting was changed. No commit, push, deployment or additional production code edit occurred. The helper files are not loaded by the app or included in service-worker assets.

A seek back to the original 6.220574-second position was assigned to the transport videos, but the final visible timeline still showed **2.555922 seconds**. Exact position restoration was therefore **not verified**; do not describe it as fully restored. This may overlap the previously measured native seek/presentation difficulty, but the present observations do not isolate that mechanism.

The bug remains open. An ordinary user listening check after this context was awakened would distinguish continuing hardware/output silence from gesture-specific activation, but that check has not occurred. Further native testing must use another explicitly available window of time; desktop control stopped before the authorized break ended. Background file work after that cutoff does not operate the desktop.

Evidence: [bounded results](safari-break-evidence-2026-10-01/results.json), [read-only meter helper](safari-break-evidence-2026-10-01/probe.js), and [synthetic controller probe](safari-break-evidence-2026-10-01/drag.js). Both helpers passed JavaScript syntax checks. They are temporary diagnostic sources, not a production regression suite, and their names/source-relative position and energy readings are local only.
