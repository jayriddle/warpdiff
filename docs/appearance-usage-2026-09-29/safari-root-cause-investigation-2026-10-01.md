# Safari scrub silence: controlled regression investigation — 2026-10-01

## Objective and current result

Jay's public 3.17.5 Safari listening result establishes a useful control for the candidate's earlier scrub silence. The new native-stream workaround is audible in his tested comparison, but the underlying cause has not been identified. This work prepares a controlled causal comparison rather than changing more production behavior without listening evidence.

Six local variants have been implemented and verified for their intended route, processor and signal behavior in Chromium. Jay then tested all six in actual Safari and reported **“I ran through all 6 and heard audio on all of them.”** Their final listening votes and forward/reverse signal records corroborate that result, after some retries. This does **not reproduce the earlier persistent silence** or establish its cause. It weakens a deterministic failure attributed solely to the new routing branch or processor. No production file was edited in this follow-up, and no commit, push, deployment, remote analytics request, account setting or browser/system preference change occurred.

## Controlled setup

The dedicated server is at **http://127.0.0.1:8094/v/release/**, bound only to loopback. Run it with `node docs/appearance-usage-2026-09-29/safari-root-cause-evidence-2026-10-01/server.mjs` from the repository. The original port-8081 preview is preserved.

Each variant uses the same scheme, hostname and port; the same two generated AAC stereo fixtures; the same selected A source, Grid view and 100% master setting; fresh in-memory preferences; and a fresh top-level document. Fixture PCM, names and channel preparation do not change between variants. No file input or private media is needed. Diagnostic records contain state, energy and explicit listening votes, not audio samples or private filenames.

The verified deployed baseline is commit `a950a15b73dcb4aaf4e0e205d372c0a483767607`. Eight publicly retrieved source files matched this commit byte for byte in the [preceding comparison](safari-output-evidence-2026-10-01/public-baseline-comparison.json). The dedicated server freezes relevant candidate HTML/scripts in memory at startup and uses the baseline's own tracked scripts for the release. [Snapshot hashes](safari-root-cause-evidence-2026-10-01/source-snapshot.json) identify the run. This is not repository HEAD presented as the public release.

The test server adds a common diagnostic panel and in-memory preference/worker prelude to each document. It supplies no service worker, uses no-store responses and a policy that prevents external resource connections. These are deliberate controls: installed-client caching and persistent preference history are excluded from the initial experiment, not proven irrelevant to the original bug. The harness exposes a state snapshot without changing the selected clock or core processor algorithms. Its AnalyserNodes are non-output branches attached to final gains; they measure PCM and do not establish sound at the speakers.

The Play scrub check button starts synthetic forward/backward pointer sequences through the real timeline handlers from a trusted native button click. This keeps audio activation within an actual gesture, unlike triggering playback after asynchronous preparation without one. The sequence is approximately 1.5 seconds per direction at 45 ms intervals, followed by release. It is a controller test, not a claim of actual human dragging or of perfect audio/video timing. A physical timeline drag and real tab-return check follow any identified result.

## Variants and interpretation

| Number | Variant | Controlled difference |
| --- | --- | --- |
| 1 | Released 3.17.5 | Complete released HTML/scripts; shared video and scrub Web Audio output; core 1.2.1 |
| 2 | Candidate, direct scrub output | Current candidate with only the native-stream scrub sink replaced by a direct-destination return |
| 3 | Candidate, old video audio route | Number 2 with only the new Safari mono/stereo native-output branch disabled; new seek handling and core 1.3.1 retained |
| 4 | Candidate, old scrub processor | Number 2 with released core/worklet 1.2.1; new native video output retained |
| 5 | Candidate, alternate output | Unmodified candidate audio scripts, including the user-confirmed native-stream workaround |
| 6 | Candidate, playback audio session | Number 2 with page-local `navigator.audioSession.type = 'playback'` before context creation, only where supported |

Begin with **1, 2 and 3**. On each page, Load test clips, Play scrub check, and select the listening result. Votes are appended only to the local [result log](safari-root-cause-evidence-2026-10-01/results.jsonl).

- **1 and 3 audible, 2 silent:** points specifically to the new native video output's interaction with the direct scrub destination. Repeat 2 → 3 → 2 with fresh documents before calling the branch causal. Check pictures too: restoring the graph can reintroduce the measured seek-start delay.
- **1 audible, 2 and 3 silent:** restoring video routing alone is insufficient. Number 4 controls the processor update; gesture ordering/lifecycle, optional slow-playback integration and other post-release changes remain candidates.
- **All three audible:** the fresh synthetic case does not reproduce the failure. Try real tab return, idle and comparison replacement while preserving that controlled case, then compare the same problematic clips. Do not declare the bug fixed from an unreproduced fresh case.
- **Local 1 silent while public 3.17.5 is audible:** investigate origin-specific policy/history, actual loaded public sources/cache and the harness's activation controls before blaming a post-release code change.
- **2 silent, 6 audible:** the page's audio-session selection is a narrower candidate than an extra native player. It still requires repeated native listening and picture checks before production adoption.
- **5 audible while direct variants remain silent:** confirms the bridge's delivery benefit in that controlled run, without identifying the earlier failure's trigger.

After isolating a reproducible failure, change only the responsible owner, repeat the failing schedule with an actual drag and tab switch, and add an appropriate behavioral regression. Speaker audibility remains a native listening criterion; an automated nonzero analyser alone is insufficient. A same-origin initial comparison controls several confounders but does not replace real-clip or installed-PWA verification.

## Verification and failed approaches

The first Chromium run completed all six variants with nonzero forward/backward PCM and the expected route counts. It used `setViewMode('split')`, an internal layout name that was not the intended known two-video layout. The harness was corrected to use `side-by-side` before the retained final verification. That initial run is preserved in [chromium-initial-results.jsonl](safari-root-cause-evidence-2026-10-01/chromium-initial-results.jsonl); its entries precede the addition of request User-Agent identification and are explicitly Chromium results, not Safari.

The reproducible [verification script](safari-root-cause-evidence-2026-10-01/verify.mjs) then passed checks across all six final variants: exact expected core version, native/graph route counts, common selected setup, forward/backward signal above 0.01 RMS, running and advancing context, active processor, absence of processor/page errors, correct bridge use and processor stop after release. These are six control cases with multiple assertions, not additions to the production Playwright suite. Chromium was capability-configured for the Safari branch and speakers muted; no WebKit or physical audibility claim follows.

| Final Chromium case | Graph/native routes | Forward peak RMS | Reverse peak RMS |
| --- | --- | ---: | ---: |
| Release | 2 / 0 | 0.06279 | 0.06265 |
| Candidate direct | 0 / 2 | 0.07343 | 0.07278 |
| Restored routing | 2 / 0 | 0.07290 | 0.07278 |
| Old processor | 0 / 2 | 0.06271 | 0.06219 |
| Alternate output | 0 / 2 | 0.07345 | 0.07281 |
| Playback session | 0 / 2 | 0.07280 | 0.07276 |

Chromium has no `navigator.audioSession` in this run, so number 6 does not validate that API's effect. It validates the fallback/control path only. [Structured results](safari-root-cause-evidence-2026-10-01/chromium-verification.json) and [run output](safari-root-cause-evidence-2026-10-01/chromium-verification.txt) preserve the exact measurements. External requests were denied, and no remote request was attempted by the final run. Source syntax and repository whitespace checks passed.

Native control initially selected an unrelated Safari sign-in window. No action was taken in its content. The Window menu selected the known main browser window, and a **new** loopback test tab was opened. Its panel was visibly Ready — load test clips. Safari then reported user activity and a fresh state showed another user tab active. Native actions stopped instead of competing with that use. The disposable test tab is left available for Jay's listening check; existing WarpDiff comparisons were not reloaded or replaced. There was no completed native audition in this follow-up. The dedicated server remains running for the pending checks and should be stopped and the disposable tab closed when those checks are complete.

Sources: [server](safari-root-cause-evidence-2026-10-01/server.mjs), [probe](safari-root-cause-evidence-2026-10-01/probe.js). These files are explicit local QA tools, absent from app HTML and service-worker assets. Root-cause diagnosis and any production correction remain pending the controlled native result.

## Native six-variant result and brief gaps

Jay completed the checks himself after the agent stopped operating Safari. All six final listening votes were Yes. The request User-Agent reports Safari 27.0; this is a browser-supplied string, not an independently inspected installed-version number. The final native comparisons retained the intended graph/native routes and core versions. Number 2 was audible with zero native graph routes and no alternate scrub output. Number 4 began its first forward test with a suspended context, then reached running and produced signal; an initially suspended context alone therefore does not establish the reported failure. Number 6 exposed a supported `audioSession.type` set to playback, while the preceding successful direct tests reported auto. Forcing playback type was not necessary for those successful fresh cases.

| Native final/retried case | Forward peak RMS | Reverse peak RMS | User heard scrub sound |
| --- | ---: | ---: | --- |
| Release | 0.06440 | 0.06049 | Yes |
| Candidate direct | 0.07537 | 0.08636 | Yes |
| Restored routing | 0.07497 | 0.07223 | Yes |
| Old processor | 0.06441 | 0.05444 | Yes |
| Alternate output | 0.07534 | 0.07898 | Yes |
| Playback session | 0.07536 | 0.07223 | Yes |

Jay additionally reported a moment of silence on a couple of first attempts which did not recur on retry, and proposed a hanging scrub-buffer preparation. The raw observations preserve two relevant incomplete passes: the first candidate reverse pass had RMS 0, zero active processor samples, a ready buffer/node, no processor error and an advancing running context; its picture time remained near the initial reverse target. The first alternate-output forward pass had only 10 active samples and was inactive with the native player paused at the final sample. Those runs must not be omitted or presented as uninterrupted success.

The phase-one observer did not record why the gestures ended. The pattern is consistent with a cancelled automatic drag, but that is an inference. Moving a physical mouse with no button held during a synthetic drag invokes the application's existing lost-mouseup guard. A user could naturally move toward the listening-result buttons while the automatic sequence runs. This concerns the **QA gesture**, and is not an explanation of the original private-clip failure: that earlier real held drag produced hundreds of active samples and strong PCM while being inaudible, and a fresh plain sample also rendered PCM but was silent.

In the subsequent reply, Jay did not remember which test numbers briefly sounded silent, offered to rerun them, and said he believed he might have bumped the trackpad. This is consistent with the cancellation control below, but does not establish the cause of those earlier gaps. Repeating all six fresh variants is unnecessary; the next native test isolates a real tab transition on number 2 and records any physical-pointer interruption.

Evidence: [native phase-one records](safari-root-cause-evidence-2026-10-01/native-phase1-results.json), [complete append-only receipts](safari-root-cause-evidence-2026-10-01/results.jsonl). The original helper and source snapshot are preserved as [phase1-probe.js](safari-root-cause-evidence-2026-10-01/phase1-probe.js) and [phase1-source-snapshot.json](safari-root-cause-evidence-2026-10-01/phase1-source-snapshot.json). The phase-one Chromium structured file was reconstructed from its unchanged append-only receipts after the repeated control command reused its output filename; it explicitly records that reconstruction and matches the retained original run log. Phase-two structured results have a separate filename.

## Preparation and lifecycle diagnostic extension

Only the localhost QA tools changed. The new helper observes the original owners for decoded-audio finalization, original analysis, video listening-buffer preparation and Continuous preparation. It returns their **original promises** and records start/settlement, pending stage, selected-buffer identity, processor error/bytes and context state. It also records trusted/untrusted mouse events, gesture cancellation, first processor activation and the first sampled signal above 0.001 RMS. It does not modify the canonical worklet, its processing, original PCM, application cancellation rules or production scripts. A pending stage is now distinguishable from a ready buffer with an inactive/cancelled gesture or rendered-but-inaudible output.

An interrupted automatic gesture is flagged and its listening buttons remain disabled. The UI asks the tester to keep the pointer still and repeat it; the guard is not bypassed. A separate follow-up panel on number 2 supports a real quiet-tab interval, three replacements, one minute of idle, and two seconds of normal playback. Visibility events record the actual hidden duration. Context identities and closure events distinguish the old comparison from its replacement. A plain direct-output sample is offered only after a valid silent vote and explicitly says the picture stays still.

The next native check is **number 2**, with the refreshed helper: load the fixtures, confirm a valid scrub, open the quiet tab for 30 seconds, return, and repeat the scrub with the pointer still. If needed, the replacement/idle controls remain available. There is no reason to repeat all six fresh variants. This checks a plausible lifetime trigger while preserving the known source and route. The same original clips and old origin/tab history have not yet been controlled; all fresh cases succeeding can reflect a state-dependent fault, a clip-specific condition or changed browser output state. A prior alternate-output action may have changed that state, but no observation establishes that mechanism.

## Phase-two verification and limits

The six control variants passed again after adding the observers; [phase2-controls.txt](safari-root-cause-evidence-2026-10-01/phase2-controls.txt) and [phase2-chromium-verification.json](safari-root-cause-evidence-2026-10-01/phase2-chromium-verification.json) retain that run. The lifecycle diagnostic then passed a fresh candidate, three replacements (all three previous contexts closed), normal playback, a deliberately induced real mouse cancellation, a successful retry, a controlled visibility fixture, and an actual one-minute idle in headless Chromium. The visibility fixture is **not** a real Safari tab transition. No new native lifecycle listening result is claimed.

The cancellation control generated a real trusted mousemove with `buttons = 0`. It observed dragging true before dispatch and false afterward, called the real stop owner, and retained a ready selected buffer with no pending Continuous preparation. The test flagged the interrupted sweep and disabled its listening vote. This establishes that this kind of test interruption can create a gap without a buffer hang; it does not prove that it caused Jay's two earlier gaps.

A separate fault control deliberately dropped the analysis worker's init message before it could acknowledge it. The diagnostic correctly showed original analysis and decoded-audio finalization pending, no published preview, an active analysis job and no Continuous node. The disposable context was closed afterward. This is **fault injection to validate the diagnostic**, not a reproduced application stall. Its state differs from the previously inaudible session's ready buffer, ready processor and strong output PCM.

In the successful synthetic Chromium lifecycle run, eight video listening preparations completed in approximately **0.1–0.3 ms**, four Continuous preparations in **7.7–12.3 ms**, and serialized original-analysis jobs in **560–1367 ms**, including queue wait. The selected mono/stereo buffers already matched the context rate, allowing the core's existing direct buffer reuse. First sampled signal was approximately **138–143 ms** after each automatic gesture began, sampled every 45 ms. That includes controller cadence, startup/ramp and analyser observation; it is **not an exact onset or speaker-latency measurement**, and is not a native Safari timing result. No successful-run job remained pending.

The first lifecycle run failed only its event-observer assertion. A microtask captured dragging true before the application's later listener cancelled it, while the stop trace already recorded dragging false. Native event dispatch may checkpoint microtasks between listeners. The observer was moved to the next task to sample after full dispatch; the production guard was unchanged. [Failed run](safari-root-cause-evidence-2026-10-01/lifecycle-first-run.txt) is retained. The final [lifecycle log](safari-root-cause-evidence-2026-10-01/lifecycle-verification.txt), [structured results](safari-root-cause-evidence-2026-10-01/lifecycle-verification.json) and [reproducible script](safari-root-cause-evidence-2026-10-01/verify-lifecycle.mjs) show all checks passing. Syntax and repository whitespace checks passed. The existing production ownership/media suites were not repeated for these QA-only edits.

Native window control was not used in this extension. Jay's loaded media, consent and browser preferences remain intact. The dedicated server remains available on port 8094 for the pending native follow-up. The **persistent Safari scrub silence remains unexplained**; the successful fresh listening checks, short startup/gap question and earlier running-but-inaudible output must remain distinct.

## Native tab-return follow-up completed

On October 1, Jay reported that the requested checks were complete and sound was audible both times. The local native-browser receipts contain a fresh number-2 audition and another audition after two actual visibility transitions. Both listening votes are Yes. The recorded hidden intervals were **22,443 ms** and **7,783 ms**, rather than a single uninterrupted 30-second interval. This verifies those actual transitions without claiming the precise originally proposed schedule.

Both forward and reverse gestures remained active for all 32 sampled steps, with 30 active-processor samples each, no cancellation, no physical-pointer interruption, no processor error and no pending preparation. Direct output was used throughout: no alternate-output bridge, zero native media graph routes and two native output routes. The context was running and advancing at each audition boundary. The first sampled signal appeared at **143/144 ms** in the fresh forward/reverse checks and **139/145 ms** after return. These are 45-ms-cadence analyser observations, not physical speaker latency. Jay's listening votes separately establish audibility.

Native video listening-buffer preparations completed in **0/1 ms**, selected Continuous preparation in **4 ms**, and original audio analysis in **407/945 ms**, including serialization wait. No job remained pending at either audition. Those measurements apply to the short synthetic stereo fixtures. They do not bound large-file preparation or explain the original private-clip failure. Media `seeking` flags were still set in some final samples; this audio follow-up did not independently verify picture presentation or native playback-start latency.

Exact receipts are preserved in [native-tab-return-results.json](safari-root-cause-evidence-2026-10-01/native-tab-return-results.json). UTC receipt timestamps fall on October 2; the user-facing test date here is October 1 in America/Los_Angeles. The completed native check failed to reproduce persistent silence or a buffer hang. It does not identify a root cause and does not justify removing the workaround on its own.

## Preparing the same-clip comparison

The next useful difference is the media itself. The localhost helper now has **Load my two video clips**, which opens a browser file picker and routes the chosen pair through the application's existing loading owner. It labels the diagnostic as user-selected, uses the same direct-output candidate and observes the same preparation stages. A one-file or non-video selection is rejected without replacing the current comparison. The initial selected source is A; ordinary source-selection controls remain available. The automatic audition still tests both directions with the pointer stationary.

Selected files stay in browser memory and are not posted to the diagnostic endpoint. The helper sends local timing/state, channel/rate/duration metadata and sampled RMS, without filenames or PCM. The same-origin server policy still blocks remote connections. Preparation waits up to two minutes for both video listening buffers; an incomplete preparation records its pending stage and keeps the audition disabled if either buffer is absent. This limit is a diagnostic bound, not proof that a long-file decode has failed. The original private comparison on port 8081 is untouched.

Before this extension, the exact prior helper and source snapshot were preserved as [phase2-probe.js](safari-root-cause-evidence-2026-10-01/phase2-probe.js) and [phase2-source-snapshot.json](safari-root-cause-evidence-2026-10-01/phase2-source-snapshot.json). The owned port-8094 server was restarted for the updated helper; production script hashes still match the preceding native run. Existing open test documents need refreshing to receive the new control.

The disposable Chromium [file-selection control](safari-root-cause-evidence-2026-10-01/verify-user-clips.mjs) passed: rejecting a single selected file preserved the original context and node; accepting a pair retired the old context, matched the new selected buffer and produced uninterrupted direct-output signal in both directions. Synthetic files were given private-marker names to verify that neither the result objects nor collector receipts included filenames. No page error occurred. [Log](safari-root-cause-evidence-2026-10-01/user-clips-verification.txt) and [structured results](safari-root-cause-evidence-2026-10-01/user-clips-verification.json) preserve the check. This verifies the new QA control, not native Safari audibility with Jay's actual clips. No application code, pinned shared component, preferences, commit or deployment changed in this follow-up.

## Original-clip listening check — October 2

The owned loopback test server was started again on October 2 after confirming that port 8094 had no listener. Its preceding source snapshot was preserved before the server wrote a new one. Both candidate and workaround documents, plus the local helper, returned HTTP 200. The normal port-8081 preview and previously loaded private comparisons were not manipulated.

Jay then reported: **“Both 2 and 5 have sound when I scrub the original clips.”** This confirms audible real-use scrubbing of the original pair through both direct Web Audio output and the candidate's generated-stream/native-player workaround. The report does not separately itemize direction, source switching, volume/mute behavior, picture presentation or a new tab-return schedule; those must not be invented from it.

The contemporaneous native-browser receipts contain 25 preparation starts and 25 successful settlements across the two variants. Original analysis completed in approximately 1.9–3.8 seconds including serialized queue wait; video listening preparation took 0–1 ms and Continuous preparation 1–4 ms in these runs. There was no recorded failed preparation. **No new automatic scrub-result or listening-vote receipt was submitted** for these manual scrubs, so the listening evidence is Jay's explicit report; the collector does not independently measure speakers or establish uninterrupted per-gesture PCM. The helper identifies user-selected loading in the first candidate run, while subsequent ordinary application loads retain its generic fresh-phase label. The user's statement identifies those as the original clips, without exporting media names or bytes.

The exact local records and the user report are preserved in [native-original-clips-results-2026-10-02.json](safari-root-cause-evidence-2026-10-01/native-original-clips-results-2026-10-02.json). The original-clip audibility check is complete. The failure was not recreated, and its trigger remains unresolved. The results support current audibility of the shipping workaround; they do not show that its removal would be reliable in the earlier failing browser state.

### Route comparison and decision boundary

Direct output is the simpler architecture: the existing scrub processor/gain feeds `AudioContext.destination`, without an extra stream, media element, player-start promise or delayed player-pause lifecycle. The workaround retains that same scrub processing but feeds a generated stream to a native audio player. Its additional owner must handle startup policy/rejection, fade-delayed pause, stale callbacks, hidden-tab stopping, source/context replacement and track/player cleanup. Those are additional potential application failure points. Extra output buffering/resource cost is possible and remains unmeasured; the route does not introduce a lossy encoder or a new source analysis buffer.

The workaround's demonstrated advantage is that it was audible in the original session while both existing and fresh direct-output samples were silent. Today's success on both paths does not establish a general reliability winner. Direct output is preferable for simplicity when reliable; retaining the Safari workaround for the initial release is a defensible compatibility decision pending the focused review. No route was changed in response to this comparison. An analyser's nonzero PCM cannot reveal silent physical output, so a dependable automatic fallback cannot be inferred from the current meter alone.
