# Safari scrub output investigation — 2026-10-01

## Current status

The reported Safari scrub silence is resolved in Jay's tested comparison **with the output workaround**, but its cause remains unresolved. After the output change and cleanup, Jay reported **“It works.”** Earlier, he confirmed that only the alternate native media output produced sound: the existing and fresh direct Web Audio outputs were silent despite rendering PCM. The workaround is implemented in the unpublished 3.18.12 candidate, and native cleanup is complete. His confirmation is recorded as a successful real-use result; it does not separately itemize each forward/reverse/tab-return case or establish a fresh-load native test. Jay subsequently tested the public **3.17.5** release in Safari and reported working scrub audio. That is a significant regression control; a general Safari output defect is not an established diagnosis. See the comparison below.

Jay confirmed that normal playback was audible, loaded a new pair of clips and explicitly authorized inspection of that Safari window. This report supersedes any interpretation of earlier signal measurements as confirmation that the reported issue was fixed.

The affected local page is `http://127.0.0.1:8081/?usageTest=1`, displaying the unpublished 3.18.12 candidate. The preview server was not restarted and the clips were not replaced or reloaded by the agent. Native inspection used the authorized existing Safari window through the computer-use tool. Private media names, content and screenshots are not saved in the evidence.

## Confirmed observations

The new comparison contains two AAC stereo, 48 kHz videos, approximately 15 seconds long. Its selected audio source was B, master and source mute were both false, and volume was 100. A matching 15.0187-second listening buffer and Continuous processor were ready with no processor error. Safari normal video playback uses two native output routes and no MediaElementSource routes in this comparison. Consequently, audible normal playback does not itself establish that the independent Web Audio preview output is audible.

Fresh, explicitly executed console reads showed the preview context in `running` state. Its clock advanced from approximately 488 to 622 seconds during the investigation. Thus the inactive/interrupted-context condition addressed in the preceding change does not explain this observed state. Initial repeated accessibility snapshots retained an older diagnostic panel value; that was not treated as evidence of a frozen audio clock. A fresh evaluation read the advancing clock successfully.

Initially, two held desktop-drag attempts failed with `noWindowsAvailable`, followed by an explicit Mac lock report. Interaction paused until Jay unlocked the Mac and said to continue. Later computer-generated movement arrived with `mousemove.buttons=0`, which correctly triggers the application's lost-mouseup recovery. Such drags are not valid sustained scrub tests; the recovery guard was preserved.

Jay's actual subsequent drag produced a post-gain peak RMS of approximately **0.07410**, with **337** drag samples, while he reported no sound. The selected processor still matched the listening buffer and had no error; mute remained off. This distinguishes valid gesture processing and rendered PCM from audible output. No raw PCM or private media names were saved.

The one-second output tests deliberately do **not** move the video or timeline:

| Test | Rendered peak RMS | Listening result |
| --- | ---: | --- |
| Existing context → direct destination | Signal was present in the earlier sample probe | Jay reported silence |
| Fresh context → direct destination | 0.19160 | Jay reported silence |
| Existing context → media stream destination → native audio player | 0.17967; play promise resolved | Jay reported sound: “Alternate output only” |

The fresh context's initial recorded state was suspended before asynchronous resume, but it subsequently rendered and completed its one-second source. No fresh-context playback result was mistaken for a timeline seek. The evidence identifies the working delivery path in this Safari session; it does not determine the underlying WebKit/OS cause or measure speaker output with a microphone.

## Implementation and ownership

`js/scrub-audio.js` now owns `_setScrubPreviewOutput`: one Safari-only `MediaStreamAudioDestinationNode` feeding a hidden native `<audio>` player. Continuous passes the destination through the shared component's existing `update({destination})` API; the snippet fallback connects its final gain to the same sink. Processing, PCM, listening matrices and media time remain unchanged. Chrome/Firefox continue using the direct Web Audio destination. No canonical shared file or vendor lock was changed; the component check still reports pinned 1.3.1 files matching.

The pointer gesture resumes the processing context and starts the player. Both input surfaces now do that after settling an old gesture and capturing/pausing normal playback; loop-marker-only movement never starts a player. Idle/release stops preview processing and pauses the player after the existing 30ms processor/10ms snippet fade plus a 10ms margin. Hiding the document pauses immediately, including a pending released-gesture fade. Clear removes the player, stops generated tracks, disconnects the stream destination and removes its context listener; a closed context retires the sink defensively. Delayed pause and rejected play use identity/generation checks so they cannot affect a newer gesture or comparison. The player sits outside media layers and is excluded from transport participants. The locally generated stream requires no microphone permission, external upload or network connection.

`index.html` routes clear/hide handling through that owner and exposes the read-only sink state for tests. The existing lost-mouseup guard remains unchanged. README, FEATURES, MANUAL, in-app Manual, AGENTS and the shared-component adapter notes describe the new behavior. Detailed development history remains in the archive; the concise What's New popup was not expanded.

The adapter functions were copied exactly into a one-time local verification script and injected into Jay's already loaded comparison. The page title visibly changed to confirm successful load, and the inspector was closed. This avoided replacing or reloading the clips. A fresh page served by the same preview server uses the production adapter and updated inline clear/visibility/gesture wiring. The already loaded page's old inline wiring remains an explicit limit of this live patch, rather than evidence of a complete fresh-load native run.

## Temporary diagnostics

[probe.js](safari-output-evidence-2026-10-01/probe.js) is an explicitly loaded localhost-only diagnostic helper, not an application asset. It observes gesture metadata, context state, preview readiness and post-gain signal energy. It does not record filenames or export audio samples, contact any remote collector, alter consent, or change persistent preferences.

The first helper revision was verified before the lock. After unlocking, further revisions were visibly installed and the four output controls were exercised. Version 3 adds fresh-context and native-stream samples and bounds/removes their sources and players after each test. A nonzero AnalyserNode reading does not prove that the speakers receive sound; Jay's listening response supplies the physical audibility evidence for the alternate sample.

The helper's stop operation removes its listeners, added analyser branches, interval and visible controls. After the second lock, Jay unlocked the Mac again. The stop operation was executed, diagnostic script tags removed, and title restored to `WarpDiff`; the accessibility tree confirmed that all four test buttons and the diagnostic panel disappeared. The inspector was then closed and its disappearance verified. Clips and preferences were preserved; the observed comparison stayed paused around 9.127 seconds. Removing the live script tag does not undo its function definitions: the corrected preview output remains available in this already loaded comparison.

## External evidence and its limits

The [WebKit report on silent running AudioContexts](https://bugs.webkit.org/show_bug.cgi?id=291892), including its macOS comment, describes an output failure where normal HTML media can work while Web Audio remains silent. A [related focus-loss report](https://bugs.webkit.org/show_bug.cgi?id=276016) discusses interrupted and running-but-stalled contexts. These are possible investigative leads, not proof that either browser defect caused this WarpDiff session. No browser/system setting or Safari installation was changed.

## Verification and remaining work

New automated checks, all with no retries:

- **16 passed, 26.2s**: new Safari output-policy tests plus existing Continuous/full-rate suites. These verify signal in the actual generated stream when the direct destination is deliberately silenced, forward/reverse Continuous and snippet fallback, idle/mute/volume, rapid re-entry, hidden-tab cancellation, clear/replacement, loop-marker exclusion, stale play rejection and ordinary Chromium's direct-output path.
- **27 passed, 27.7s**: existing native scrub scheduling, WebCodecs scrub, drag recovery, cancellable play intent and decoded timeline checks.
- **467 passed, 0 failed**: ownership/pure-logic harness, including five new sink-owner guards. JavaScript syntax and whitespace checks passed; pinned shared scrub files matched.
- A first six-test output run passed before the hidden/rejected-play case was added; its detailed terminal output was not retained. The strengthened seven-test run first failed its quarter-volume RMS comparison: the measured peak ratio was 0.602 versus the unchanged upper bound 0.45. The sweep started immediately after changing volume and included already buffered full-level output. The test now waits for prior output to drain and the pointer to become idle before a new quarter-level sweep; the bounds were not widened and production code was not changed to satisfy it. The final **7 passed, 24.7s** run also delivers the actual retired pause callback after a newer gesture, verifying that it cannot pause the new player. The meaningful failed run is retained alongside the passing log.

There are **43 distinct passing behavioral checks** across the updated output suite, existing Continuous/full-rate suites and the focused application regression run, plus 467 ownership/pure-logic checks. Logs: [output and component suites](safari-output-evidence-2026-10-01/output-tests.txt), [application regressions](safari-output-evidence-2026-10-01/regression-tests.txt), [first strengthened run](safari-output-evidence-2026-10-01/hostile-first-run.txt), [final strengthened run](safari-output-evidence-2026-10-01/hostile-final-run.txt), [ownership](safari-output-evidence-2026-10-01/ownership.txt).

The automated browser is headless Chromium with a controlled Safari policy and muted speakers. It verifies PCM and lifecycle, **not native Safari speaker audibility**. Jay subsequently confirmed that scrubbing works with the live output change. Fresh-load native behavior, individually documented tab-return listening, exact added latency, iOS/iPadOS, Firefox and graph-based surround playback remain unverified. No full unrelated application suite was repeated.

## Tradeoffs after listening confirmation

- **Possible additional latency:** preview PCM now passes through a generated media stream and native media player. This can introduce buffering between processing and speaker output, including when restarting after idle. The extra end-to-end delay has not been measured; the passing PCM/cleanup tests do not establish a millisecond speaker-latency bound.
- **Additional resources:** one stream destination and one reused native player add some processing/memory and potentially power use. These costs have not been benchmarked. No extra full-length decoded clip copy is introduced by this adapter. The player pauses on idle/release/hide and its generated tracks are stopped on clear.
- **Additional Safari maintenance and playback policy:** there is another browser-specific output path and native `play()` must succeed. It is started inside the pointer gesture, with generation-fenced rejection handling and a retry notice. The native listening confirmation applies to Jay's desktop Safari session, rather than every WebKit device.

The adapter retains the same PCM, Continuous processing, selected source, listening mix, gain/mute controls and normal playback behavior. WarpDiff adds no lossy encoder in this delivery path. The existing Continuous transient-softening tradeoff predates this correction. Its value is audible scrub preview in the affected Safari session; responsiveness should be checked in further real use before claiming exact audio/picture timing.

## Released-version control and regression assessment

Jay reported on 2026-10-01 that the current GitHub Pages **3.17.5** build scrubs with audio in Safari. The public document, adapter, routing, decoder, monitor, shared core, worklet and vendor lock were retrieved read-only from the public site. All eight matched commit `a950a15b73dcb4aaf4e0e205d372c0a483767607` byte for byte. [Source hashes and comparison](safari-output-evidence-2026-10-01/public-baseline-comparison.json) identify this verified baseline, rather than assuming repository HEAD is the deployed release. HEAD is an unpublished 3.17.8 development state; the working candidate is 3.18.12.

The most relevant output-routing difference was introduced during the earlier Safari picture investigation in this working tree. Released 3.17.5 connects supported video soundtracks through `MediaElementAudioSourceNode` into the same Web Audio context used for scrubbing. The candidate keeps desktop Safari mono/stereo video on native media output when native volume is writable. This addressed a measured picture-start delay with a plain MediaElementSource control, but also removes that video's use of the shared Web Audio output. Native Play therefore cannot be assumed to activate or recover the independent scrub destination. This is a **causal hypothesis**, not proof that the routing change caused the user's silence. The old and new pages also have different origins and histories; no same-origin, same-clip, one-change-only native listening comparison has yet been completed.

The shared Continuous processor changed from 1.2.1 in the release to 1.3.1 in the candidate, adding linked source-level matching and synthesis lookahead. That remains a difference to control. However, the user's silent short-preview path and silent fresh-context sample bypassed that processor and still produced measured PCM. A failure solely inside the newer Continuous DSP therefore does not explain the complete observed output pattern. Audio decode and video listening-buffer preparation differ from this baseline only by fixed analytics outcome hooks; no new codec conversion, listening matrix or sample-rate conversion was introduced by those hooks. Analytics itself is not an established cause.

The source comparison does not prove a general Safari defect, a confirmed application regression, or a need for the extra native-stream output in every Safari session. The workaround's successful listening result is preserved, but it should not substitute for identifying the regression. The next useful causal test is an isolated, same-origin comparison of the released path and candidate without the bridge, followed by restoring only released native routing while retaining current seek handling. It must measure pictures and use an actual listening check: nonzero PCM alone previously missed this issue. Reverting all routing changes without that check could restore the measured picture delay.

No production code was changed, no commit/push/deployment occurred, and no user comparison was reloaded during this source comparison. Native UI cleanup closed only the separate synthetic codec-check tab; the user's public release tab remained active and both WarpDiff tabs were retained.

## Codec/layout follow-up and its limits

Four new behavioral cases in `tests/safari-preview-output.spec.ts` passed without retries (**21.1 s**) for FLAC and Opus, each at 5.1 and 7.1. Each checks original six/eight-channel analysis, a three-plane video listening buffer (Full Mix left/right plus retained center), enabled Center Only, forward Full Mix and reverse Center Only PCM in the generated native stream, and sink cleanup. They use Chromium decoding with Safari policy and user-agent fixtures; they are **not actual Safari codec support or speaker tests**. [Codec run](safari-output-evidence-2026-10-01/codec-output-tests.txt). The ownership harness again passed 467 checks.

A separate real Safari tab used synthetic FLAC-in-MP4 5.1 plus the ordinary AAC reference through a local test iframe, excluded from analytics. The FLAC slot did not acquire an original analysis buffer or listening preview. It entered the existing automatic FFmpeg transcode fallback. Fresh diagnostic evaluation showed conversion phase `transcode`, 0 percent, FFmpeg loaded and busy; the check timed out at 45 seconds and a later check still found no preview. The reference's stereo preview did decode. The context was running, so this failure precedes delivery through the new scrub output. It establishes a limitation of this particular end-to-end native test, not blanket unsupported FLAC, a proven terminal converter error, or a failure of the bridge. The converter's successful completion was not verified.

The initial harness tried asynchronous preparation without first priming from a real button gesture and observed a suspended context. It was corrected to prime inside the native button's click before awaiting decode. The subsequent running-context FLAC preparation timeout remained. The [harness HTML](safari-output-evidence-2026-10-01/codec-check.html) and [source](safari-output-evidence-2026-10-01/codec-check.js) preserve the test; they are not app/service-worker assets. The test did not reach native FLAC 7.1 or Opus cases before Jay's released-version report redirected investigation. Standalone `.flac` files, native Opus surround, and successful native surround conversion remain unverified. Closing the disposable tab retired its iframe/conversion work without replacing Jay's private clips. No remote collection was sent.

The reported silent-scrub symptom is closed by Jay's real-use confirmation. No commit, push, deployment, account-setting change or live GoatCounter event occurred.
