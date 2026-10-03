# Native Safari release checks — 2026-10-01

Tested WarpDiff **3.18.12**, consent scope **4**, in the installed **Safari 27.0** on Jay's Mac. Jay asked whether the focused Safari testing could be performed autonomously. Native file loading, ordinary playback/seeking/restart, analysis-panel rendering, appearances, narrow-window controls, and local opt-in/withdrawal checks completed successfully within the limits below. No new analytics blocker was observed in those completed checks. This is a focused compatibility record, not a complete Safari regression or audio-quality certification.

**Still unverified:** a sustained forward/backward scrub drag and its audible quality. The native automation delivered a seek at the drag's starting point rather than a useful continuous gesture. A minor retained video-scope display was also observed after switching to audio. Neither result is silently counted as a pass.

No production application code was changed in this testing turn. No commit, push, deployment, hosted dashboard test, or live GoatCounter count was performed.

## Environment and isolation

- Opened a dedicated Safari QA window with only the local test page, at `http://127.0.0.1:51454/?usageTest=1`. The user's original Safari tabs were retained. Safari's native Develop menu identified Safari 27.0; actual collector requests also contained `Version/27.0 Safari/605.1.15`. The UA's compatibility string `Mac OS X 10_15_7` is not evidence of the machine's actual OS version.
- A [loopback-only server](safari-release-evidence-2026-10-01/local-server.cjs) served the current working tree and terminated the local test collector itself. It has no forwarding path. `usageTest=1` uses the adapter's separate local consent key and loopback endpoint; it cannot grant consent for the official site.
- Used existing repository PNG, H.264/AAC MP4, and mono/stereo WAV fixtures. Temporary copies preserved original file bytes and modification times for normal native file-input loading.
- Initially added an explicitly enabled [QA panel](safari-release-evidence-2026-10-01/fixture-panel.js) to served HTML only, using `safariFixtures=1`. It offered a picker bypass and read-only observations of application/media state. Only the first image load used that bypass. Later video, audio, image and four-image loads used Safari's normal file picker.
- The QA panel observes state and global errors; it does not set media clocks, synthesize consent, force visibility, or invoke analytics. It calls the real application loading handler when its fixture buttons are used. Neither the panel nor its script tag was added to production HTML.
- Removed the QA query flag for the final narrow-window video/image, consent, withdrawal, and reload checks. Those pages received unchanged application HTML. The local test mode remained enabled.
- Safari Responsive Design Mode supplied 640 × 540 and 360 × 540 viewports. These are desktop Safari resizing checks, not physical iPad/iPhone or touch-input tests. No browser security/privacy preference or OS setting was changed.

Production preservation checks compare the start-of-run hashes in [server-info.json](safari-release-evidence-2026-10-01/server-info.json) with the final files. `index.html`, `js/usage.js`, and `js/appearance.js` are byte-for-byte unchanged. Test evidence and this documentation were the only additions made in this turn.

## Completed native behavior checks

| Area | Observed behavior | Limit |
| --- | --- | --- |
| File loading | Native picker loaded a PNG pair, two MP4 videos, mono/stereo WAV files, and four PNG images. Ready comparisons became visible with the expected labels and metadata. | Small existing fixtures; not a codec or large-file matrix. |
| Replacement and Reset | Replaced video with audio and images. Canceling Reset retained the comparison; accepting Reset returned to the landing screen. | Not a resource-leak benchmark. |
| Video transport | Play/pause, timeline click seeking, and R restart worked. Both video elements reached `readyState=4`, had no media error, and advanced during playback. Native frame-rate detection displayed 24 fps. | No measured A/V-sync, color-pipeline or audible-quality comparison. |
| Audio transport | Play/pause, a graph click seek, and R restart worked. Both audio elements reached `readyState=4`, had no media error, and advanced during playback. | No listening assessment or exact timing alignment assertion. |
| Video audio graphs | W displayed the L/R waveform and spectrogram; source audio metadata and loudness/peak values appeared. | Rendering and completion verified, not reference PCM/analysis accuracy. |
| Image/video scopes | V displayed histogram, waveform monitor, and vectorscope. | Visual rendering check; numerical/color fidelity not measured. |
| Audio-only graphs | Mono/stereo waveforms, spectrograms and loudness/peak values appeared. | Synthetic tones, not speech/surround coverage. |
| Four-image layout | Native four-file loading displayed Image-1…4 in a 2 × 2 Grid. Stack and return to Grid worked. | Four-video/audio layouts not repeated here. |
| Appearances | Selected Original, Solar, Nebula, Starfield and Glacier with sharing off; all rendered. Glacier survived reload. | No performance benchmark, reduced-motion setting test or separate light-theme run. |
| Solar motion | Two snapshots 9.402 seconds apart showed exactly unchanged orbital-plane transforms/bounds and advancing offsets/positions for all four bodies. | Decorative animation, not a physical simulation test. |
| Narrow layout | At 640 × 540, transport remained reachable. At 360 × 540 the header wrapped, Appearance and privacy remained reachable, and the disclosure/buttons were readable and scrollable. | With both analysis panels open, little media space remains; closing panels restores room. Desktop pointer/keyboard only. |

Representative native media observations, preserved in [observations.json](safari-release-evidence-2026-10-01/observations.json):

- MP4 durations: 3.023 and 4.023 seconds. A native seek placed both video elements at 2.702450 seconds while paused. After restart and playback they were observed at 0.929726 and 0.940383 seconds, both running and ready, with no media error.
- WAV durations: 3 seconds each. After graph seek/restart/playback, the elements were observed at 0.599703 and 0.686962 seconds, both running and ready, with no media error. These reads are sequential, so their difference is not treated as an atomic synchronization measurement.
- Video analysis produced −21.9 LUFS and −20.2 dBTP for both test clips; WAV values were −21.7/−21.3 LUFS and −21.1/−18.1 dBTP. The video analysis records report decoded durations of 3.134688/4.179583 seconds, longer than the native elements' container durations. The cause and PCM timing fidelity were not investigated in this smoke test; these are completion/rendering observations, not an accuracy assertion.
- Solar outer-body offsets advanced 2.86% → 18.526667% and 52.860001% → 68.526665%; inner offsets advanced 26.906666% → 37.351112% and 76.90667% → 87.351112%. Both planes' bounding rectangles and transforms remained identical. Nebula and Starfield were inspected visually, without an equivalent numerical animation sample.

## Consent and actual local transport

The final [collector receipts](safari-release-evidence-2026-10-01/collector.json) contain **23 requests: 3 visits and 20 events**, all received on loopback. The server returned 200 for each collector request. This proves local transport receipt, not hosted acceptance, filtering, session deduplication or dashboard aggregation.

| Transition | Measured result |
| --- | --- |
| No choice, load without answering | Images/video could load and tools could be used with zero collector requests. Loading quietly dismissed the invitation without granting consent. |
| Choose Yes during an existing video review | One visit; zero ready-review/event requests for that preceding review. |
| Reload with saved Yes, then manually load video/audio | New manual reviews reported the defined load/readiness/participation/workspace and preparation events. The page showed 1 visit, 2 ready reviews, 14 events, 0 failed requests. |
| Turn sharing off | Further image/four-image loads, features, Reset, appearance changes, and a narrow video load left the collector at 16 requests. No remained saved across reload. |
| Choose Yes during the existing narrow video review | One new visit, no replay of that review. |
| New four-image review at 360 × 540 | Reported load attempt, ready review, participation, and one `workspace-narrow-short-image-4` event. Explicit Stack/Grid actions each reported their defined feature once. The page showed 1 visit, 1 ready review, 6 events, 0 failed requests. |
| Turn sharing off again, reload, load a native image pair | Saved No was shown and page totals were 0 visits, 0 ready reviews, 0 events, 0 failed requests. The collector remained at **23** requests, with its last request at **19:44:33.852 UTC**. |

Receipt inspection confirms GET requests, approved query keys only (`p`, `t`, `e`, `r`, `rnd`, optional `ns`), empty `r`, and no Cookie, Referer, Authorization or Origin header. Event labels have the expected `v3.18.12/` prefix; visits use `/`. No fixture filenames, media contents, exact viewport dimensions, page query, or local consent record were added to counting payloads. Browser-generated User-Agent and Accept-Language headers remain visible, as disclosed. This local same-origin request check does not replace the earlier isolated cross-origin HTTPS wire review.

The adapter's local page totals count attempted dispatch, while these receipts confirm actual local receipt. Neither proves the real GoatCounter dashboard's behavior. No live analytics request was sent.

## Failed approaches and remaining observations

**Occluded original window.** Initial native picker selections did not enable Upload, and the first fixture-bypass image review appeared blank. Its state record says `visibility: hidden`. Moving only the QA tab into its own visible Safari window resolved this; subsequent normal file-picker loads and rendering worked. This was an automation/window-state obstacle, not established application breakage. The first preserved record also used an incorrect media selector, so its empty media list is not a successful readiness assertion.

**Unintended navigation.** One address-bar paste attempt unexpectedly opened an unrelated external search. Its cause was not established. It was immediately corrected by setting the address field directly, which was used thereafter. The unrelated search text is omitted from the project evidence. This is why the record claims no live analytics delivery, rather than claiming that absolutely no external browser navigation occurred.

**Continuous scrubbing remains unverified.** Several native coordinate drags sought to their starting position or left the position unchanged. The observer captured only one mousemove in the recorded `native-drag-1` attempt; both videos ended paused at the initial seek position, and no completed-scrub analytics event was emitted. Click seeking is verified. A sustained forward/backward gesture, preview audibility, pitch/level quality and stop-on-hold behavior are not. The installed Playwright WebKit executable was absent; no software was installed and no WebKit substitute was run. This does not establish that real manual scrubbing is broken.

**Retained video-scope plot on audio replacement.** After W and V were visible in a video review, loading the WAV pair restored the scope panel below the audio graphs with the prior RGB plot still visible. Audio loading/graphs/playback continued. The current source and repository HEAD both restore `videoScopesVisible` without an audio-only check, so the restoration condition predates these analytics changes. This is a bounded display observation, not a newly established analytics regression; no production fix was included in a testing-only turn. A dedicated reproduction/fix would need to address both panel restoration and clearing old plot content.

**Error observation coverage.** The optional QA listeners recorded zero global errors or unhandled rejections across their 11 stored observations. They were absent during the later unchanged-HTML narrow-window checks, so this does not prove an error-free full Safari session. Transient blank video frames while loading were followed by visible fixture frames; no persistent rendering failure was reproduced.

Not covered: physical iPad/iPhone/Android, older Safari, Firefox, actual native WarpCap, full codec/transcode/Opus/surround behavior, installed-PWA offline/update transitions, BFCache, reduced motion, long sessions, or hosted analytics aggregation. Earlier Chromium and ownership results remain in their original records; they were not rerun merely to add this document.

## Evidence, preservation and cleanup

- [Derived checks](safari-release-evidence-2026-10-01/checks.json): collector totals/payload checks, Solar comparisons, native media snapshots, error observations, unchanged production hashes and fixture cleanup.
- [Native state observations](safari-release-evidence-2026-10-01/observations.json): actual media readiness/clocks/metrics, appearance, viewport and Solar computed state. These are snapshots, not a comprehensive assertion suite.
- [Collector receipts](safari-release-evidence-2026-10-01/collector.json) and [local asset requests](safari-release-evidence-2026-10-01/server-requests.json): actual Safari requests. Screenshots and accessibility observations used for visual/UI checks are preserved in the conversation tool history, not claimed as standalone files here.
- [Server information](safari-release-evidence-2026-10-01/server-info.json), [server source](safari-release-evidence-2026-10-01/local-server.cjs), and [optional panel](safari-release-evidence-2026-10-01/fixture-panel.js) preserve how the observations were obtained. A rerun creates fresh fixtures and replaces these evidence JSON files; copy them first if preserving this run.

Exited Responsive Design Mode, closed only the dedicated QA window, stopped the owned local server, and verified removal of its temporary fixture directory. The user's original Safari tabs were retained. Ephemeral loopback-site preferences may remain in Safari; no global site-data clearing was performed. Local No and Glacier affected only this test origin, not the official site. `git diff --check` completed successfully. Existing working-tree changes and prior verification/review records were retained.

The completed Safari checks support the current release's ordinary desktop use and consent gate. Before calling scrubbing fully verified in native Safari, one real forward/backward drag and brief listening check is still needed. The retained scope display can be handled as a separate small usability fix; this record does not silently broaden the analytics review into a full media audit.
