# Optional usage event contract — scope 4

Implemented in 3.18.8, with consent/launch/counting corrections in unpublished 3.18.10. Account collection settings and the provider disclosure are verified in [the account record](usage-account.md); hosted delivery and publication remain separate checks. The only collector is `js/usage.js`; the official destination is `https://warpdiff.goatcounter.com/count`. Local `?usageTest=1` uses only a loopback endpoint and independent consent. See [consent scopes](usage-consent.md).

## Payload and privacy

Engaged visits use path `/`: at most one dispatch per document after explicit Yes or an accepted manual file load, subject to consent. Saved Yes alone does not report at startup. This does not measure every app opening. Every event uses `v<APP_VERSION>/<label>-<media>-<items>` except participation, which uses `v<APP_VERSION>/comparison-active`. Release in the path preserves historical release breakdowns independently of GoatCounter’s page-title behavior. Media is exactly `image`, `video`, `audio` or defensive `mixed`; items is 1, 2, 3 or 4. No media identity enters the adapter. Event titles are `WarpDiff <APP_VERSION>`; visit title is `WarpDiff`.

Only `p`, `t`, `e`, empty `r`, random cache-buster `rnd`, and optional `ns` are sent. `rnd` is fresh per request, not an identifier. `ns=true` requests volume counting for all events except participation (session-deduplicated only if the account enables sessions). No cookies, referrer, query string, fragment, exact dimensions or monitor resolution, persistent user/review identifiers, file names/contents, raw errors, logs, stack traces, cursor paths or media timestamps. The consent record and separate invitation-dismissal preference stay local; neither is reported. Network IP addresses and browser headers necessarily reach GoatCounter. Account settings can enable retained derived metadata and individual-pageview records; `ns=true` does not disable those categories. The verified account retains browser/OS and country counts, with sessions enabled, in a private dashboard configured for automatic deletion after 365 days. GoatCounter’s built-in region, referrer, screen-size, language and individual-pageview collection are disabled. The separate workspace labels below contain only six coarse categories. Operator: Jay Riddle; privacy contact: [warpdiff@gmail.com](mailto:warpdiff@gmail.com). See [account verification](usage-account.md).

Requests require a matching document/adapter contract and verified production configuration (or loopback test), an explicitly established standalone launch, current scope-4 Yes, the configured host (or explicit loopback test), online state, a non-embedded/unmanaged document and no production automation/prerendering. No external analytics script is loaded. Requests time out after three seconds; at most 64 are in flight. There is no queue, storage, retry or offline replay. Counts are best effort: dispatch does not prove delivery, and opaque hosted responses do not confirm acceptance. Collector failures appear only in the local test status; they are never recursively reported.

Visits have no release prefix and cannot provide a matched release-specific denominator. Participation has a release prefix but no media/item cohort; summing releases may count the same provider session more than once. Event-based browser/OS breakdowns, if enabled, describe counted events, not a distinct-device census. Opted-out use is unobserved, so none of these figures yields an opt-in rate.

## Ready reviews and load outcomes

| Label | Meaning / denominator |
| --- | --- |
| `load-attempt` | One accepted load of 1–4 assigned files, started while sharing was allowed. Picker cancellation or rejected input is not counted. |
| `comparison` | One ready review: the existing first-frame/activation boundary **and** every assigned slot’s ready callback. Single-item reviews use item count 1. Broken or incomplete sets do not qualify. Reloading the same files creates another load/review. |
| `comparison-active` | Participation estimate emitted with a ready review; session deduplication depends on the account’s session setting. Not an exact daily headcount. |
| `load-failed` | One or more assigned slots reported a loading error. At most once per load; no error text or per-file counts. A late error can follow an earlier ready review. |

A review remains eligible for feature counts only if its ready event was dispatched. A load that began before consent cannot become reportable through later consent. Every consent-storage mutation (including queued No → Yes), explicit decisions, clear, host activation, scope invalidation, pagehide and going offline invalidate current load/review contexts and diagnostic tickets. Re-enabling sharing or reconnecting does not revive them; start a new review. Per-load sets and tickets exist only in memory and never leave the device.

Clearing or replacing a comparison also aborts the previous pending collector requests through the same cancellation owner. Declining the Reset confirmation leaves that comparison and its requests intact. Canceling a fetch cannot retract a count already received by the collector; the document's engaged visit is never replayed after cancellation.

Do not interpret `load-attempt − comparison` as a failure count: it includes cancellations, incomplete work, consent changes and dropped requests. `load-failed` and an analysis failure can describe overlapping problems; do not sum them as unique failures.

## Working space

After a ready review’s comparison count is dispatched, one `workspace-<width>-<height>` event is attempted, with the same release/media/item suffix and `ns=true`. Width is narrow below 760 CSS pixels, medium from 760 through 1,199, and wide from 1,200 upward. Height is short below 600 CSS pixels and tall from 600 upward. The six fixed combinations are the only allowed labels. Dimensions must be finite and positive; invalid measurements skip this event. Sampling uses the current window’s layout viewport, not screen dimensions or the remaining media area. Raw values are discarded locally and never added to query fields, storage or labels.

The purpose is to prioritize responsive layouts, including side-by-side windows. These are design categories, not device types or proven comfort thresholds. The review-readiness owner samples once; duplicate readiness, playback, feature activation and resizing do not sample again. Failed, pre-consent, embedded/host-owned and offline reviews remain excluded. A missing workspace count does not prove a different size: dispatch/delivery can fail independently of the comparison event. For aligned release/media/item cohorts, compare each category with the sum of delivered workspace counts; ready reviews are a separate workload denominator. This does not measure time spent, later resizing, panel crowding, device model or adjacent apps.

Browser/OS classification can misidentify iPads as Macs. Narrow windows also occur on desktop computers. Keyboard-centric feature adoption can reflect touch-access limitations, so low counts alone should not determine whether a feature is useful. No input-capability, keyboard-presence or touch-behavior metric is added.

## Feature use

Each `feature-<name>` event counts at most once per counted ready review, per feature/mode. Automatic initial/restored layout and automatic audio graph display are not explicit use. Playback, layout and repeated readiness never add new review counts.

| Names | Trigger and useful comparison population |
| --- | --- |
| `stack`, `grid` | Explicit toolbar or keyboard layout selection; compare with ready reviews of the same media/count. Automatic resize/restoration excluded. |
| `scopes` | Opening the combined video scopes panel; image/video reviews. All three scopes appear together, so this does not claim individual histogram/waveform/vectorscope choices. |
| `audio-viz` | Opening the combined waveform/spectrogram panel; video reviews. Automatic audio-only graphs and restoring saved W-panel state after N → N are not counted as explicit openings. |
| `difference` | Enabling a valid difference pair; image/video reviews with 2–4 items. |
| `wipe` | Enabling a valid image wipe; image reviews with 2–4 items. |
| `loupe` | Enabling the zoom loupe; image/video reviews. Linked loupe is not distinguished. |
| `tile-check` | Enabling Tile Check; image reviews. No analysis scores or heatmap contents. |
| `loop` | Establishing both loop markers, or completing a meaningful Shift-drag region; audio/video reviews. |
| `solo` | Entering Solo playback; multi-video reviews. |
| `listening-full`, `listening-dialogue`, `listening-center` | Selecting listening presets while the selected source has a verified center layout. No levels or source identities. |

These describe explicit activation, not attention or time spent. Basic eligible denominators come from ready review type/count. Listening availability is narrower than “all audio/video reviews”; this release does not report verified-center availability, so listening counts must not be presented as a precise eligible adoption rate. Audio-source switching, individual scopes, graph settings, performance timings and detailed crash diagnostics remain deferred.

## Scrubbing

- Only a completed mouseup after motion beyond the app’s drag threshold, with a valid media duration, is counted. Click seeks, loop-marker drags, Shift-drag loop selection, blur/lost-mouseup recovery and clear/cancel do not count.
- `scrub-timeline`, `scrub-waveform`, `scrub-spectrogram`: at most one per surface per counted review. Surface is where the gesture started; the audio-slot canvas’s top 40% is waveform, bottom 60% spectrogram. Pointer positions used locally for classification are not sent.
- `scrub-threshold-1`, `scrub-threshold-2`, `scrub-threshold-6`, `scrub-threshold-21`: emitted once as the review crosses 1, 2, 6 and 21 completed drags, across all surfaces. These are cumulative thresholds, **not four disjoint bucket counts**. Stop emitting frequency events after 21; no per-frame/pointer event stream.
- For an aligned release/media/item cohort, approximate completed-band populations are T1−T2 (1 drag), T2−T6 (2–5), T6−T21 (6–20), and T21 (21+). T1 / counted ready audio/video reviews estimates scrub adoption. Cross-day windows and dropped requests can distort differences; clamp nothing silently and do not claim an exact total drag count.

## Reliability categories

Counts are per load containing at least one occurrence, not per file/job. Each operation family has an attempt denominator, emitted once per load when that work is requested. Outcomes hold a ticket captured at the request, so late results cannot attach to a replacement load or a new consent decision.

| Attempt | Outcome | Definition |
| --- | --- | --- |
| `analysis-attempt` | `analysis-fallback` | Background analysis worker failed/unavailable, but foreground waveform/spectrogram/metrics calculation succeeded. |
| `analysis-attempt` | `analysis-failed` | Worker path and foreground calculation both failed for a current job. Successful compatibility fallback is not a failure. |
| `preview-attempt` | `preview-reduced` | Scrub listening preparation chose the existing memory-limited, reduced-rate plan. Ordinary sample-rate conversion is excluded. |
| `preview-attempt` | `preview-unavailable` | Current decoded media could not produce its scrub listening buffer (for example memory/layout/allocation failure). Original analysis may still be usable. |
| `continuous-attempt` | `continuous-fallback` | Selected Continuous engine reports a preparation or processor error and uses the existing short-preview fallback. Reset/cancellation does not count. |

No global exception listener, raw console capture, arbitrary diagnostic text or newly invented timeout is added. Silent/no-audio video is not reported as an audio decode failure. The native decoder’s short timeout that triggers WebCodecs is not a terminal failure. Transcode outcomes, detailed browser crash reporting, video scrub decoder failures and performance timings are not part of this first set.
