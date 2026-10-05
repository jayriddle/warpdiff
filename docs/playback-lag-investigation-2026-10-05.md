# Chrome scrubbing investigation — 2026-10-05

Status at the local investigation checkpoint: **scrubbing lag reproduced with the corrected clip; local 3.18.14 candidate implemented and checked**. Backward and back-and-forth picture stalls are reduced, not eliminated. The first investigation below used the wrong clip and focused too heavily on normal playback. It made no product changes; its negative results do not rule out the later scrubbing reproduction. The corrected-file follow-up at the end records the changes, failed experiments, evidence and remaining limits. At that checkpoint nothing had been committed, pushed or deployed, and the original media and user’s browser preferences were not changed. Jay subsequently confirmed “Much better!” and requested deployment; release verification is recorded separately.

## Initial report and source identification

Jay reported severe lag with one approximately 44 MB video in WarpDiff 3.18.13, in Chrome, continuing after loading. He subsequently clarified that **controls are slow**, and named a specific MP4 in Downloads. Measurements below use that exact named file. Its measured metadata is 1,684,418 bytes, 8.041667 seconds, H.264 High, 1280×704 yuv420p, 24 fps, approximately 1.60 Mbps video, and AAC LC mono at 48 kHz. Its size differs from the initial description; it is not established that this is the original 44 MB example.

Before the path was provided, the live comparison contained another video: 124,085,028 bytes, 14.791667 seconds, H.264 High 4:4:4 Predictive profile with yuv420p pixels, 1280×720 at 24 fps, approximately 66.9 Mbps video, AAC stereo at 48 kHz. It was tested separately. The unusual profile was a hypothesis, not a diagnosis; it played normally in these isolated measurements. The live comparison changed again during observation. We did not control the user's loads or mistake different clips for one reproduction.

No media filename, contents, screenshot of media, or raw private page content is saved in this evidence directory. Original files remain in Downloads and are never served by the diagnostic server or sent externally.

## Inspection and measurements

Read-only inspection of the user's Chrome tab found one native video, fully ready, with the waveform/spectrogram panel active; no live scopes or difference rendering was identified. No captured warnings/errors appeared. The tab uses localhost without usageTest, so the GoatCounter endpoint is disabled. The analytics adapter has no playback-frame loop. The 3.18.12 → 3.18.13 release did not modify the native playback implementation. These facts narrow the investigation; they do not prove that browser state, third-party extensions, or every feature combination is irrelevant.

Fresh, isolated system Chrome was launched with a disposable profile, muted output, service workers blocked and external page requests aborted. The viewport was 1643×1478 CSS pixels, device scale factor 2. Cases ran serially. The tested browser binary was **154.0.8037.98**; the user's already-running Chrome process was **154.0.8037.93**. Fresh/headless rendering is a material limitation, so these results cannot rule out a problem in the existing browser, split-view arrangement, extensions, or long-lived tab.

For the named clip, measurements began at one second and ran for approximately 6.04 seconds:

| Case | Frame count | Dropped frames | Main-thread tasks ≥50 ms | 95th-percentile animation interval |
| --- | ---: | ---: | ---: | ---: |
| Plain native video | 140 | 0 | 0 | 16.8 ms |
| Plain video through MediaElementSource | 144 | 0 | 0 | 16.8 ms |
| WarpDiff, W closed | 145 | 0 | 0 | 16.7 ms |
| WarpDiff, W open | 145 | 0 | 0 | 16.7 ms |

The plain native case advanced about 5.82 seconds during the 6.04-second observation, including its startup. The other cases advanced approximately 6.00–6.04 seconds. These counters are browser presentation observations, not an audible-output assessment. There was no sustained waiting or stall signal in these runs.

Nine repeated loads of the same clip then exercised **36 real play/pause button clicks and nine 30-move timeline drags**, with W enabled. Button automation round trips were **6–40 ms** (including automation transport); synchronous playAllMedia work took at most **1.0 ms**, pauseAllMedia at most **0.1 ms**. No ≥50 ms main-thread task was recorded during the interaction windows. The first cycle had a single input-arrival delay of approximately **204 ms**; later cycles' maximum arrivals were approximately **14.8–15.9 ms**. That one-off startup observation was retained, and did not reproduce the severe continuing lag.

After these cycles, there was one native audio route, dragging had ended, and the current scrub cache stayed at **55 frames / 198,246,400 estimated bytes**. JavaScript heap snapshots varied approximately 20–43 MB with collection; this does not measure all native media or GPU memory and does not establish absence of a leak. A final native play measurement again showed 145 frames, no drops, no long tasks, and a 16.8 ms animation-interval p95. That final probe deliberately used video.play directly; it is not evidence that the app's scrub-decoder suspension ran at that particular playback start.

The earlier loaded, larger clip also showed no dropped frames or ≥50 ms main-thread tasks in all four player/graph/W combinations. A single initial plain-player animation gap was 100 ms; subsequent cases had maxima around 16.8 ms. This observation did not support blaming its encoding as the cause of Jay's control lag.

System memory inspection showed no swapping at that observation and no broad memory-pressure evidence. That is a snapshot, not a guarantee about an earlier lag episode.

## Boundaries and failed approaches

- The supported browser inspection proxy exposes DOM/media properties but not getVideoPlaybackQuality or input.files. The attempted reads failed at the tooling boundary; they were not application errors. Full measurements therefore ran in isolated development browsers.
- Opening chrome://media-internals was rejected by browser URL policy. No alternate UI, CDP connection or shell workaround was used to reach that internal page.
- A separate local diagnostic tab was created on 127.0.0.1:8095, preserving the original comparison. Extension file loading failed because its existing file-URL permission is disabled. No permission setting was changed. The normal Mac picker approach was not completed: live browser state changed while the user was actively working, and the agent did not take over the user's task window.
- The diagnostic HTML is local and uses an iframe with a different origin/port from the user's original app, with playback/input timing shown as text. It has no remote collection destination. It still needs an actual loaded clip before it can measure the running user's Chrome environment.
- The diagnostic document itself was verified in disposable Chrome with the named local clip: no script errors, 140 presented frames, no drops or long tasks, approximately 5.81 seconds of media advance in a 6.00-second window including startup. diagnostic-selfcheck.json preserves that limited validation. The created user-Chrome tab was retained for follow-up, and the original comparison was preserved.
- No fix or release was manufactured from these negative reproductions. A reload-and-reopen check was requested to distinguish accumulating state from an immediately reproducible issue.

## Evidence and next check

[Evidence directory](playback-lag-evidence-2026-10-05/) contains initial.json (different earlier clip), reported-clip.json (named clip), controls.json (nine interaction cycles), and the local harness source. Sources require the existing local project dependency path and an explicit local media argument; no source contains the user's clip path. measure.cjs and controls.cjs use the existing 8080 app server without changing it. server.cjs serves project assets and the diagnostic document on loopback port 8095; it does not expose Downloads.

Initial proposed next check (superseded by the corrected-file follow-up below): determine whether reloading the affected tab and reopening the same named clip restores responsiveness. If it does, investigate the old tab's retained state and the load/clear sequence rather than changing the decoder solely on file size. If it does not, capture real foreground input/presentation timing in the running Chrome environment and compare a plain native player with the app. No full repository suite was run at that stage because no product code had been changed.


## Corrected-file scrubbing follow-up — October 5, 2026

### Scope and reproduction

After rebooting, Jay supplied a different Downloads file and clarified that the problem is **scrubbing, not normal playback**. This follow-up used that exact corrected source, locally and read-only. Its measured properties are 95,137,230 bytes, 14.75 seconds, 354 frames at 24 fps, 1280×720 yuv420p, H.264 **High 4:4:4 Predictive** at approximately 51.4 Mbps, and AAC LC stereo at 48 kHz. The declared H.264 profile and actual 4:2:0 pixel format are distinct facts. There are only two video keyframes, at **0 and 10.416667 seconds** (decode indices 0 and 250).

Fresh system Chrome **154.0.8037.98**, headless, reproduced long picture freezes during backward and zigzag drags. The timeline continued responding. No main-thread task of at least 50 ms was recorded in these drag windows, and scrub dispatch generally cost only a few milliseconds at most. This evidence identifies a decode/presentation bottleneck in the isolated reproduction; it does not prove every reported control symptom has the same cause.

The existing user-owned 8080 server was preserved. Initially it was unavailable; a new server attempt raced with the user's restarted server and selected another port. Only our newly created extra server was stopped. No user browser window, comparison, extension permission or preference was altered during this follow-up. Development browsers had disposable contexts, muted output, blocked service workers and intercepted external requests. No live analytics count was sent. The original video was never copied into the repository or exposed by a new file server.

The benchmark made a cold initial click, held for 800 ms, then sent 100 timeline moves with a 15 ms pause after each automation move. Actual motion cadence was roughly 33 ms, including automation and display timing. Forward and backward traversals covered 10–85% of the timeline; zigzag covered roughly 25–65%. Each direction used a fresh context. The table measures the largest gap **between paints after dragging began**; it excludes delay before the first paint and is not a typical/median latency guarantee. Paint counts include progressive intermediate frames and therefore are not a count of exact pointer targets. Native fallback can show frames not recorded by the overlay paint listener.

| Direction | 3.18.13 longest overlay paint gap | Final local candidate | Overlay paints before → after | No-progress fallback checks before → after |
| --- | ---: | ---: | ---: | ---: |
| Forward | 49.8 ms | 66.4 ms | 202 → 101 | 1 → 2 |
| Backward | 1,800.1 ms | 816.0 ms | 25 → 62 | 51 → 19 |
| Zigzag | 1,100.0 ms | 399.8 ms | 61 → 91 | 30 → 4 |

Forward's maximum paint gap increased slightly, while its maximum measured pointer-to-picture time difference fell from about 1.33 s to 0.13 s. A progressive stream can paint often while remaining far behind the pointer; paint count alone is not responsiveness. Backward's maximum difference fell from about 5.93 s to 2.57 s. Zigzag's maximum remained about 6.20 s versus 6.77 s; that maximum includes the initial large jump before catching up, so **these changes do not solve every cold seek**. Zero ≥50 ms main-thread tasks and zero page script errors were recorded in all three final cases.

### Findings and implementation

The decoder trace showed a queue of 24 submitted samples while emitted frames lagged behind. The old retarget condition compared the pointer with **submitted** work. Retreating behind the queue could reset a decoder even though it had not yet emitted the requested frame. That discarded useful progress and restarted a potentially 250-frame dependency chain. The old paint floor could also remain at a later request and suppress the retreated target. The original RGBA bitmap cache could retain only **54** frames at this resolution within its estimated 192 MiB ceiling, much less than the 250-frame first GOP.

Current primary Chromium source shows that its FFmpeg decoder disables frame threading in low-delay mode ([FFmpeg decoder](https://chromium.googlesource.com/chromium/src/+/HEAD/media/filters/ffmpeg_video_decoder.cc)); the Mac VideoToolbox decoder lists H.264 profiles through High ([VideoToolbox decoder](https://chromium.googlesource.com/chromium/src/+/HEAD/media/gpu/mac/video_toolbox_video_decoder.cc)). The High 4:4:4 profile therefore suggests a software path on this Mac. This is an inference supported by source and the configuration experiment, **not a verified internal decoder name for the running Chrome build**. HEAD source is not pinned to Chrome 154. The [WebCodecs specification](https://www.w3.org/TR/webcodecs/) describes the queue, reset, flush and hardware preference semantics.

The local candidate changes the existing owner in `js/scrub-video.js`:

- Requests software decoding with throughput rather than low delay **only for AVC profile f4** (High 4:4:4 Predictive). Other codecs retain their existing configuration preference. Hardware selection is a browser preference; it is not a universal implementation guarantee.
- Uses the emitted presentation-time high-water mark to decide whether a same-GOP retarget can continue. Updates the paint floor on retreat, and rechecks pending frames against the latest target before painting.
- Retains compact **full-resolution I420 VideoFrame clones** for that software-preferred profile when no resizing is needed. Opaque frames, resized previews and other codecs retain ImageBitmaps. Cache entries use their own byte costs, including full coded-frame allocation rather than only visible dimensions. The final real clip retained **142 frames / 201,208,320 estimated pixel bytes**, below 201,326,592 bytes (192 MiB). This is an estimated retained-pixel budget, not a cap on file bytes, all native allocations, decoder buffers or total browser memory. No source pixels are downsampled by this new path, and no media is transcoded by the app.
- Makes unresolved bitmap reservations evictable. An evicted, replaced or cleared reservation cannot publish or refund a newer entry. Removal, eviction and clear route through one cache-removal owner.
- Flushes only at **file end** to release buffered final frames; same-GOP continuation elsewhere retains its no-flush behavior. Reset/suspend cancellation of a flush is harmless. No new playback clock, audio route or analytics event is added.

Version and service-worker cache are aligned at **3.18.14**, with matching README/manual/feature guidance and architecture notes. The existing important What’s New summary remains; this is a quiet maintenance candidate. The sharing scope, matching disclosure/adapter contract and adapter integrity hash are unchanged because analytics was not modified. No commit, push or deployment occurred.

### Experiments rejected or limited

The [experiment summary](playback-lag-evidence-2026-10-05/scrub-experiment-summary.json) and original observations preserve all measured variants. They are local prototypes, not shipped alternatives.

- Paint-floor adjustment alone did not fix the problem (backward gap about 1.75 s). Tracking decoded progress alone also left roughly 1.72 s backward and 1.10 s zigzag gaps.
- Reducing bitmap resolution to fit a full GOP made backward results worse (about 2.07 s) and softened previews. Combining that with throughput improved some timings, but was not chosen.
- Throughput preference alone improved forward tracking, but left about 1.33 s backward and 0.95 s zigzag gaps. Compact planar caching alone also left large stalls. Their combination plus retarget progress produced the useful improvement.
- A raw-cache/throughput run briefly overlapped a local encode; its timings were not used as the final result. Later scoped and final runs were serial, with no encode competing.
- A sparse temporal-cache experiment could serve adjacent frames; it did not improve the result enough and was rejected. The final cache still serves the exact decoded frame. An opportunistic idle-prefetch variant likewise showed no meaningful additional benefit and was not adopted.
- Disabling the overlay and using native Chrome seeking gave only 4/6/3 presented frames during the forward/backward/zigzag windows, with maximum gaps around 1.13/1.80/1.68 s. Native seeking is not a demonstrated cure for this source.
- A private **lossless GOP-12** copy with otherwise identical decoded pictures and audio improved zigzag but still stalled badly in reverse (about 1.42 s, 93 resets). Dense keyframes alone were not sufficient with the old restart policy.
- A private **all-intra lossless** control copy scrubbed with approximately 67/98/67 ms maximum gaps under the original app. All **354 decoded video frame hashes and frame times** match the source, and all **693 AAC packet hashes and times** match. Its size is 120,282,133 bytes. This strongly supports dependency-chain cost as a contributor. Both private derivative files are only in the temporary investigation directory; neither is part of WarpDiff or proposed automatic processing. The original is untouched.

### Verification and remaining limitations

| Check | Result |
| --- | --- |
| Ownership/pure-logic harness | **495 passed, 0 failed**, including 26 controlled decoder/cache checks |
| New checks against original HEAD decoder | **14 failed, 12 passed**, demonstrating that they distinguish the old faulty behavior; no production revert was performed |
| Existing browser WebCodecs scrub tests | **8 passed**, one worker, no retries; 15.0 s |
| Playback/restart and media cleanup suites | **6 passed**, one worker, no retries; 26.2 s |
| Continuous and full-rate scrub suites | **9 passed**, one worker, no retries; 14.0 s |
| Exact corrected clip at EOF | Last frame at 14.708333 s released; cold end request took about 773 ms |
| Corrected-clip cache fidelity | Revisiting 6.25 s was an exact cache hit; canvas pixels matched the uncached decode pixel for pixel at 1280×720 |
| Corrected-clip suspend/resume | Decoder suspended and cache retained; a fresh decoder reused the final cached frame |
| Playback after corrected-clip scrubbing | Native time advanced about 0.997 s in 1 s; scrub decoder suspended |
| Corrected-clip clear | Session dead; cache 0 frames / 0 bytes |
| Syntax/whitespace | JavaScript syntax check and `git diff --check` passed |

The first ownership run had **494 passed / 1 failed**: an older structural guard expected two literal bitmap refunds. The new per-entry removal owner intentionally replaces those writes. The guard was updated to require reservation before asynchronous work and the single removal owner; controlled scheduling tests separately verify eviction/replacement/clear behavior. This was a stale structural assertion, not a hidden failing browser test. One patch application also failed to match an exact comment divider; no file changed on that failed attempt, and the insertion was reapplied against a stable code line.

The production modules were not broadened into a proxy/transcode system, the cache ceiling was not raised, and no audio algorithm was replaced. Nevertheless, sparse-keyframe, high-rate software video still has unavoidable work to reach an uncached point. The first long backward crossing can remain conspicuous. A smaller or longer GOP, multiple clips, another OS/browser, real display-gamut treatment, installed-PWA updates and long-lived user profiles can differ. The headless tests were muted: they measure preview processing and picture behavior, not Jay's audible output. The full unrelated suite and Safari were not rerun for this Chrome-focused local candidate.

**User retest, October 5:** after receiving the local 3.18.14 candidate and instructions to retry the corrected clip, Jay reported **“Much better!”** This confirms a practical improvement in his retest. It does not establish that all cold-seek delays are gone or that every clip/browser has been checked.

At that retest checkpoint the candidate remained local **3.18.14** and the deployed release remained **3.18.13**. The full unrelated suite had not yet been rerun, and no commit, push or deployment had followed the confirmation. Jay then explicitly requested **deploy**, initiating the complete release checks and publication process. Raw investigation evidence remains local; this self-contained record and the controlled regression harness accompany the release source.

**Release gates completed, October 5:** the complete Playwright rerun passed **371 tests with one existing skip, zero failures and zero retries**, two workers, 3.6 minutes. The final Node harness passed **495 checks, zero failures**; syntax and whitespace checks passed. The first complete run exposed two stale release-note assertions that expected the old dismissal version; these now compare with the actual app header, and all six focused cases passed. That run also hung after 371 reported results while default discovery imported the separate asynchronous Node harness. Only its owned runner/worker were terminated (exit 143). Browser discovery now selects `*.spec.ts`, and the complete rerun finished normally. Exact hang internals were not established. Both initial and final logs are preserved locally in `docs/deployment-3.18.14-evidence-2026-10-05/`; no failed check was discarded. These are pre-publication results; the release commit and live deployment receipt are recorded separately after publication.

### Evidence

The [evidence directory](playback-lag-evidence-2026-10-05/) contains the cold baseline, final candidate, native-seek observations, prototype results, decoder feeds/outputs trace, boundary/fidelity checks, controlled HEAD comparison, test logs and executable local harnesses. `original-scrub-video.js` and `final-scrub-video.js` snapshot the compared decoder source. The final source SHA-256 is **79998e363d3cf10d2514f7b1067673e351c480bc2b7c6fdd83c7703cf08154ad**, based on repository HEAD **d09fe893bd5192fe6fae46fde92e4960a422266a**. Benchmarks require a separately supplied local file argument and the existing 8080 server. No media, media screenshot, original filename or raw private-page content was added to evidence.
