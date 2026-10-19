# Reported scrub color and A/V handoff — 2026-10-19

Status: local corrections on `codex/sdr-color-verification`; merge and publication remain on hold. The starting commit was `8a9bcbde0d423b87ced720d7a52bcae902e49043`, reporting version 3.19.9. Final suite results and source/preservation receipts are recorded in `verification.json`.

## Report and reproduction

Jay reported that clicking to scrub made the picture darker/more contrasty, then also reported possible A/V misalignment during normal playback. He identified the file already loaded in Chrome. Its existing filename label was read without seeking, reloading or changing the comparison; a matching local source was found in Downloads. Browser blob export was unavailable. The original was read locally, never uploaded, rewritten or added to Git. Source-specific paths, captures and PCM remain in ignored local evidence.

Jay subsequently identified Bluetooth headphones/speakers as the output and said that other playback stays synchronized with the same headphones. This is user-observed comparative evidence, not an acoustic measurement. It makes a blanket attribution to Bluetooth inappropriate and supports checking WarpDiff's independent output route. The physical listening result after correction remains pending.

The source is ordinary AVC High, 1920×1056 at 24 fps, with stereo AAC at 32 kHz and a three-second duration. Neither its native interpretation nor its WebCodecs output reported a color-metadata disagreement; both reported BT.709/limited. Raw canvas RGB agreed. Nevertheless, after waiting for the actual picture to become visible, scrub compositor samples were up to **12/255 darker**; a cached revisit reached 13 codes, including small resizing differences. Matching metadata/readback did not establish matching presentation.

The preceding color investigation's lossless x264 fixtures used High 4:4:4 Predictive and emitted **I420** in WebCodecs. Ordinary High-profile controls emitted **NV12**. On this macOS Chrome runtime, I420 matched without the historical curve, while NV12/BT.709 needed it. Thus the earlier blanket retirement was too broad. The historical record is retained and prominently qualified rather than rewritten as a successful test of the missing path.

## Corrections

1. `_scrubVideoPresentationFilter` in `js/scrub-video.js` scopes compensation to measured macOS NV12 output with BT.709 primaries, matrix and transfer on an sRGB output profile. I420 remains unfiltered. Explicit sRGB output remains unfiltered where used. Unknown/unsupported macOS NV12 combinations and wide-gamut NV12 output return to native seeking before painting. BT.709 sources use an sRGB canvas backing even on a P3 display; other declared primaries retain the existing managed-gamut choice. The correction uses an absolute fragment on the stable document URL, preserving its query and avoiding the staged release base. Reattached canvases and cached ImageBitmaps retain the session's correction.
2. Untagged containers keep native seeking. Observing an inferred native `VideoFrame` no longer authorizes switching rendering paths; that temporary observation helper was removed. Late rejection retains generation fencing and immediately closes the session/releases its encoded-input reservation. Native seeking can be less responsive with sparse keyframes; source tags are not guessed or rewritten.
3. Ordinary mono/stereo video with writable native volume now keeps the browser's combined native A/V output in Chrome as well as Safari. The existing direct-output owner retains master volume, selection, cancellable fades, mute and cleanup. Surround, audio-only, volume-locked output, slow-playback processing, and both pending and active Opus replacement retain their required graphs. Pending Opus is excluded before its active flag is published.

The SVG curve itself is the previously measured table, not a new source-color transform or a claim of colorimetric accuracy. Chromium has also [documented interpretation differences among platform decoders](https://groups.google.com/a/chromium.org/g/blink-dev/c/epSTNPYkLIs/m/XYUoERtaAgAJ); the local before/after experiments, rather than that discussion, establish these particular corrections.

## Normal-playback audio evidence

The app's listening PCM was compared with separately decoded FFmpeg PCM at 48 kHz. Three windows at 0.4, 1.2 and 2 seconds matched with **zero sample offset** and normalized correlations above 0.999996. The source's reported video/audio starts were both zero; Opus replacement was inactive.

Before correction, ordinary stereo had a `MediaElementAudioSourceNode` route. Its AudioContext reported **168 ms output latency**, plus 5.33 ms base latency. A parallel, silent AudioWorklet tap correlated the actual native-media graph samples with the reference. Mapping those samples through `getOutputTimestamp()` and video frame presentation metadata estimated audio **174.7–183.2 ms behind** frames during the measured interval. This is a browser-clock estimate, not an acoustic loopback or physical screen measurement.

After correction, the same file had a direct native output at full selected volume and **zero native-media graph routes**. PCM/reference agreement stayed unchanged. The 168 ms context still exists for decoded preview/analysis, but ordinary video playback no longer sends its sound through that independent output clock. Native speaker synchronization is delegated to the combined media element; physical listening confirmation remains necessary.

## Regression coverage

- Authored ordinary High-profile HD fixtures cover BT.709 limited/full range, a 601 matrix, explicit sRGB and untagged input, alongside the original lossless controls. Fixture generation asserts the actual codec profile and each requested color field; frame metadata is set explicitly before encoding.
- Chrome and WebKit tests check visible picture content, native-versus-scrub screenshots, native fallback and released input bytes. Cache hits are exercised. Removing required NV12 compensation must create a visible error; applying the curve to software controls must also create an error.
- A relative release base plus document query/fragment exercises SVG resolution through real HTTP responses.
- New 32 kHz mono/stereo browser checks require zero `createMediaElementSource` attempts through load, scrub, resumed playback, mute and clear. Existing direct-output controls now exercise Chrome's actual path without pretending it is Safari.
- Existing PCM/envelope tests deliberately select the graph fallback through its detached capability probe while preserving real volume behavior on loaded elements. Synthetic Opus tests explicitly promote their previously ordinary sources to graph routing. Real surround and Opus tests remain intact.
- Decoder-policy tests use explicitly declared SDR copies in their own output directories. Existing fixture bytes/timestamps and source/audio packet preservation checks remain intact; this is not a preparation strategy for user media. No new capability skips are accepted.

## Failures and rejected approaches retained

- Initial actual-file captures were premature and included black/hidden presentation. They are invalid color evidence. The corrected probe waits for the visible layer and rejects captures without expected picture contrast; regression fixtures also require a visible authored signal.
- Initial hardware fixtures lacked complete container/frame declarations: four browser cases fell back instead of exercising their named tagged paths. `write_colr` and explicit frame `setparams`, with asserted FFprobe fields, corrected the harness. Earlier reports are retained and do not substitute for the corrected run.
- A subsequent NV12/601 case differed by 63 codes despite the transfer curve: 21 passed/one failed. That combination now uses native seeking. The correction was not generalized to an unverified matrix.
- After the complete suites passed, an additional forced Display-P3 run found **seven passes/five failures**: NV12 compositor errors reached 11 codes; unnecessary P3 canvas backing also added 3–4 codes of readback difference. A controlled same-source probe isolated those paths. Using an sRGB backing fixed the software differences; NV12 remains native on wide-gamut output because the transfer table still did not match saturated colors. The final P3 run passed 12/12 without relaxing tolerance. Its initial report/log and controlled captures remain in ignored evidence; the initial test-output directory was reused by the passing run.
- Two broad Chromium attempts were interrupted for decoder-policy fixture updates: the first near case 122, the second after reaching case 367, where an older restart test still required a live decoder for its untagged fixture. Neither is a complete passing suite. The restart and bounded-input suites now also use declared SDR copies and passed all eight focused checks. A focused startup also failed because an interrupted run's owned HTTP server had not retired; only that server was stopped before retrying. Logs retain the interruptions and scoped process cleanup.
- A separate moving fixture with a half-second leading empty video edit reproduced wrong scrub picture mapping while audio remained on the original timeline. A proposed single-edit restriction also rejected an existing fixture with a valid 23 ms leading edit, producing 11 ownership failures. That restriction was reverted; **no parser change remains**. The larger edit-list mapping issue remains open and is not the explanation established for the reported file, whose starts are zero.

## Limits and release boundary

These corrections target continuity with the browser's native presentation, not the source creator's intended color, display calibration, HDR mastering, complete file integrity or rendered-PCM conformance. Matrix/range controls do not establish every codec, driver, display profile or midstream format change. Physical Chrome/Safari listening and calibrated display measurements have not been performed in this follow-up.

Scrub audition still uses a processing/output clock and remains subject to device latency. This change does not promise to eliminate that delay or compensate surround/Opus graph output on every device. It does not establish that the original source's lips and speech were synchronized. The separate leading-video-edit finding, historical Grid observation, 44.1 kHz amplitude and wider WebKit 7.1 observations remain open/separate.

No merge, push, publication, repository setting or hosted workflow was requested or performed for this follow-up. A local audible/visual recheck of the reported file is required before release consideration.

Ignored evidence: `output/scrub-handoff-2026-10-19-JBKU0j/`. Start with `actual-file-srgb-confirmed.json`, `decoder-profile-results.json`, `audio-route-before.json`, `audio-route-results.json`, `guard-mutations.json`, and the final suite/preservation receipts. Media captures and PCM are local-only investigation material.

## Completed checks and revision scope

The complete Chromium run passed **646 tests with one existing approved timestamp-collision skip** in 661.9 seconds. The complete focused WebKit profile passed **243 tests, no skips** in 314.2 seconds. Both used one worker, zero retries and zero runner errors, and their reports passed the complete/disjoint inventory gate. They ran from the isolated `checkout/` on port 58182, preserving the working fixtures from the legacy suite's writes.

Those complete suites preceded the final wide-gamut guard, BT.709 backing-store change and corresponding color assertions. Their exact source receipt is `final-source-snapshot.json`; the final targeted color/native-output runs cover the subsequent changes. Do not describe the complete suites as executions of the final committed bytes. No further audio-routing change followed them. Local ownership is **1,381 passed** (including two optional neighboring-source checks), infrastructure **26 passed**; the final targeted counts and final source hashes are in `verification.json`.

Final-source targeted runs passed **28/28** Chrome/WebKit color/native-output cases and **12/12** forced Display-P3 color cases. Both inventories were checked, with no skips, retries or runner errors. The controlled harness passed 37 decoder checks and eight routing policies; all 11 deliberate mutations failed their intended assertions. Earlier routing/source-handoff checks passed 20/20, and restart/input fixture checks passed 8/8. `final-candidate-source-snapshot.json` identifies the final runtime/test bytes. Forced color profiles are browser experiments, not physical wide-gamut display verification.

The reported clip's final browser probe retained native seeking with zero encoded-input bytes, no overlay and **zero raw/display sample difference**. Resumed playback had zero graph routes, full selected native volume and native mute off. This is local browser evidence; physical lip synchronization remains a user recheck.

A separate Chrome listening-preview tab was opened on the loopback diagnostic server, with the original comparison untouched. Automatic chooser selection was blocked by the extension's file-URL access setting. No permission was changed and no file was loaded there; Jay must use Load to select the clip. The server remains running for that local recheck. A summary-writer syntax error was corrected before generating the final JSON; it did not affect app or test execution.
