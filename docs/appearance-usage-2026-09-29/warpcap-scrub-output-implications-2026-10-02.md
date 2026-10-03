# WarpCap comparison-surface implications — October 2, 2026

This is a read-only source assessment of the current WarpDiff candidate and neighboring WarpCap checkout. No WarpCap files, vendor pin, browser state, account settings or deployment were changed. No embedded native listening test or new WarpCap logic/CI run was performed; the statements below distinguish source configuration from runtime acceptance.

## Launch and version ownership

WarpCap's `ui/comparison.js` lazily navigates its comparison frame to same-origin `warpdiff/`. The iframe in its `index.html` has `allow="autoplay; fullscreen"`. Its host protocol supplies `WARPDIFF_LOAD`, correlated identities and explicit managed-review capabilities for assigned reviews. The viewer retains ownership of native playback, source selection, volume and scrubbing; WarpCap owns task answers, route and task lifecycle. `platform/warpdiff-route.js` and the surface adapter wrap that same comparison runtime.

The local bundled viewer and `warpdiff/VENDOR_LOCK.json` report **3.14.5**, commit `cb9d1087a071b30cb0c1d10a95a526666f6d3c3c`; this is a checkout observation, not an inspection of hosted WarpCap bytes. The standalone candidate is 3.18.12. `scripts/vendor-warpdiff.mjs` stages a separate vendored runtime from a chosen revision. Publishing GitHub Pages therefore does not automatically replace WarpCap's embedded viewer. New output behavior reaches that surface only after its bundle is deliberately updated, verified and deployed.

WarpCap's README identifies Chromium-family browsers as its established browser target and says Safari/Firefox have not been extensively QAed. WarpDiff's workaround is selected by its WebKit capability predicate (`fastSeek` plus `GestureEvent`), not by iframe topology or host capability. Ordinary Chromium keeps direct output even in the candidate with the workaround. Embedding by itself does not select an alternate audio route.

## The two output paths in an iframe

Both paths keep scrub preparation, timing, selected source, gain/mute and listening mix in the viewer's Web Audio engine. The direct path feeds `AudioContext.destination`. The workaround feeds a generated `MediaStreamAudioDestination` into a hidden native audio player inside the child document. It changes final delivery, not task/result schemas or the shared DSP. The canonical shared core/worklet are unchanged by this adapter; WarpCap/WarpSonic's own independent instance does not inherit the output workaround.

Both paths require the preview context to become active through the user interaction. The workaround adds a native player `play()` operation and its failure/cleanup handling. WarpCap already grants autoplay to the frame, but that attribute alone is not proof of successful Safari activation in every session. Native embedded scrubbing must be tested with a real child-frame gesture. Extra output buffering and resource use remain possible and unmeasured, including any perceptible sound/picture offset. There is no microphone capture, additional audio upload or lossy encoding in this generated-stream route.

## Host lifecycle is the important additional boundary

WarpCap's `_cmpStopFrame()` pauses the child's `video,audio` elements and navigates the frame to `about:blank` at final-exit/task-clear boundaries. Those browsing-context transitions differ from merely covering a still-mounted viewer. `_cmpSetHomeCovered()` preserves the task, pauses child media elements and makes the shell inert; `_cmpBlockCoveredPlayback()` also blocks later native play/playing events while Home/logout covers it. These are useful existing protections, not a newly verified embedded scrub test.

The direct scrub processor is not an HTML media element, so pausing only DOM videos/audio is not sufficient by itself to retire its gesture clock or processor. The workaround's hidden player is included in those DOM pause operations, but its processor and gesture timers also need retirement; a pending callback can attempt to start the player again. The host's covered-playback blocker is relevant defense, while prompt cancellation remains the preferable ownership boundary. A covered iframe is not equivalent to a hidden browser tab; WarpDiff's document-visibility handler cannot be assumed to run for every host cover.

This assessment does **not** reproduce a leak or declare those protections broken. It identifies the exact integration schedules that should accompany the bundle update: open Home during a held scrub or delayed player start; return without unsolicited audio; switch/replace/release tasks during preparation; switch between WarpSonic and comparison; and confirm one audible source, no stale sound, and cleanup of stream/player/tracks/timers. Test Chromium direct output and actual Safari embedded output, including ordinary forward/reverse scrubbing, volume/mute and source changes.

## Task activity and analytics boundaries

WarpCap's `ui/task-activity.js` binds media identities specifically to A/B elements inside `layerEditA` and `layerEditB`. The generated preview player lives outside those layers, so the source binding does not classify it as a third asset or a normal viewing start. Gesture counting continues to observe timeline interaction and the assigned elements' clocks. Native pause events still reach the broader frame listener; integration regressions should preserve the intended segment accounting. This is a source assessment, not a new measurement of activity records.

WarpDiff's current `_hostLoadBegin()` permanently retires standalone analytics before host loading. Changing the audio route does not authorize standalone GoatCounter reporting in a WarpCap-owned document. WarpCap's own project/task activity policy remains a separate host concern.

## Assessment

There is no new embedding protocol requirement solely to deliver the generated stream. The direct route remains simpler; the Safari workaround may retain its observed compatibility benefit inside Safari, but standalone listening tests cannot establish that benefit in an iframe. WarpCap's separate vendored copy means the present standalone release and its future embedded upgrade can be validated independently. Include these host lifecycle schedules in the focused review, and run WarpCap's required logic/CI plus embedded browser acceptance before claiming the upgraded comparison surface works.

Sources inspected: neighboring WarpCap `AGENTS.md`, README, `index.html`, `ui/comparison.js`, `ui/task-activity.js`, `ui/warpdiff-protocol.js`, `platform/warpdiff-route.js`, the surface browser adapter, managed-review documentation, vendor lock and vendoring-script references; current WarpDiff host handler, WebKit predicate, scrub-output owner and shared-component documentation. The older handoff-contract proposal explicitly says it is superseded and was not used as evidence of current runtime behavior.
