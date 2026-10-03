# Potential usage measurements for WarpDiff

Planning catalog — 2026-09-29, updated 2026-09-30. The selected first set was implemented under scope 2; the current release candidate uses [consent scope 4](usage-consent.md), adding a coarse working-space sample. The [event contract](usage-events.md) is authoritative for what actually reports. The remaining candidates below are future ideas, not enabled collection. Nothing has been published by this work.

## Working-space addition — 2026-10-01

Implemented: six window-width/height groups, sampled once per consenting ready review, to guide responsive layout work. Width boundaries are 760 and 1,200 CSS pixels; height boundary is 600. See the event contract for interpretation. Exact dimensions, monitor resolution, resizing, remaining media area and input-capability tracking remain deferred. Tablets can run the app but keyboard/hover/precise-drag features limit touch-only access; low feature use must not be treated as proof of low value.

## Decision-first measurement plan

Jay clarified the governing question: **what data would be reasonably valuable for improving WarpDiff?** This narrows the previous inventory. A feature being measurable is not, by itself, a reason to measure it. Before adding a metric, name the product decision it could change, the smallest useful data, and the alternative explanations for its result.

| Improvement decision | Smallest useful evidence | What we could do with it | Interpretation limit |
| --- | --- | --- | --- |
| Which workflows deserve development and test effort? | Ready reviews by image/video/audio and item count 1–4 | Prioritize the layouts, media paths and comparison sizes that carry the workload | Repeated loads are not unique files or people; ready sets do not establish completed reviews |
| Which tools are part of real review work? | Share of eligible reviews using scopes, audio analysis, Difference, wipe, loupe, Tile Check, and playback/listening controls | Improve heavily used tools and protect them against regressions; investigate low adoption before removing anything | Low use may reflect specialist value, limited eligibility or poor discoverability |
| Where does the tool prevent people from working? | Attempted loads and bounded outcomes; usable audio-analysis availability; broad failure categories | Fix the failures that affect the most eligible work | Failed loads need their own denominator; abrupt tab closure is an unknown outcome, not a proven failure |
| Where does waiting hurt the experience? | Coarse time-to-ready and time-to-analysis buckets, separated by media type and outcome | Focus performance work and loading feedback on slow paths | Timing alone cannot distinguish slower devices, larger files or a regression; foreground/hidden time needs an explicit rule |
| Which defaults or controls should change? | Deliberate changes to layout, Fit/Ref, scope mode, Solo, listening presets and panel balance | Test different defaults or make repeatedly selected controls easier to reach | Restored settings are not new choices; several selected modes do not reveal a preferred final mode |
| Did a release improve the targeted workflow? | The same small measures before and after a change; coarse app release only where needed | Check whether a fix reduced failures/waiting or a UI change increased tool adoption | Aggregate changes are evidence, not proof of causation; audience and workload may have changed |

### Recommended starting set

Start with four kinds of evidence, rather than enabling the entire feature inventory:

1. **Workload:** media type and 1–4-item ready sets. Derive total item loads instead of emitting another event.
2. **Core tool adoption:** one count per eligible review for the major comparison/analysis tools. Scrubbing is an explicit priority, including a coarse measure of repeated use as described below. For waveform/spectrogram and scopes, distinguish valid display from deliberate interaction. Add individual mode breakdowns only when they answer a real design choice.
3. **Reliability:** load/analysis success and fixed failure categories, with matched attempts/eligible denominators. This is high-value information, not merely a low-priority extra.
4. **Responsiveness:** a few coarse readiness/analysis timing buckets if performance is a current improvement target; settle what is timed and when the timer pauses before collecting them.

The first fixed reliability categories are now defined and disclosed under scope 2. Timings and detailed diagnostics remain deferred. Reliability may be more useful than a detailed palette or appearance popularity chart. See the event contract for the implemented subset.

**Defer by default:** individual appearance/palette popularity, exact shortcut choices, every play/pause or source switch, exact zoom/gain settings, and general-purpose time-in-app. Also avoid return-user tracking or extra device/file metadata unless a concrete decision warrants revisiting them. Open time includes idle time and is not a reliable measure of productive review.

**Add only for a specific question:** toolbar versus keyboard entry, help-panel openings, option-level mode counts, initial configuration snapshots, and feature combinations. These can help a targeted UI change, but should not become a permanent detailed interaction log by default.

### Admission and review rule

For each proposed metric, write a sentence of the form: “If this result is high/low, we would consider changing ___.” Require a defined count, eligible denominator where relevant, privacy boundary and known ambiguity. Prefer an existing aggregate or a coarser count when it answers the same question. After using the data, remove or stop adding detail that does not affect a decision.

Examples: a high number of video reviews with unavailable audio analysis would prioritize compatibility work; frequent deliberate Ref selection could motivate a default or visibility experiment; infrequent Tile Check use would not by itself justify removal because it serves a specialized image workflow. Automatic display of an audio graph is exposure, not evidence of attention. An increase in adoption after moving a control is a useful signal to investigate, not a complete explanation of why it changed.

All reports concern consenting, reportable activity. They do not describe the entire audience, and aggregate telemetry should not be used to infer individual satisfaction or intent.

## Catalog and priorities

**Core candidate** marks a feature worth considering within the decision-first plan above, not a recommendation to enable every listed row. **Later** means retain the idea for a specific question. **Separate review** means a different kind of information needing a concrete data design and disclosure; it is not a statement of low product value. The tables below are a reference inventory, not a collection checklist.

### 1. Workload and comparison size

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Visits | How often WarpDiff is opened | Existing visit event, at most one attempt per document after consent; not an exact count of people | Existing |
| Ready review sets by media type | Image, video and audio workload | One event at readiness for each new set; distinguish single-item review from 2–4-item comparison | Implemented for 1–4 in scope 2 |
| Items per set: 1, 2, 3, 4 | Typical comparison size; demand for four-item support | Number successfully ready at the readiness boundary, not file-picker clicks | Implemented for 1–4 in scope 2 |
| Total item loads reviewed | Overall volume of assets handled | Derive from set-size counts: sum of size × ready sets; repeat loads count again, so this is not unique files | Derived |
| Hidden/restored slots | Whether users reduce a multi-item comparison while working | Once per review when a slot is deliberately hidden or restored; never send its name | Later |
| Files loaded by drop vs picker | Which loading workflow matters | Successful user-initiated load, categorized by entry method; exclude host messages | Later |

The public UI normally loads one media type at a time. The existing adapter allows a mixed label defensively; do not present mixed-media review as an ordinary advertised workflow. A layout change, slot hide or audio-source switch never creates a new ready set.

### 2. Comparison layout and inspection

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Stack / Grid displayed | Which layouts host real work | Once per review per layout when it is actually shown; distinguish initial/restored layout from a deliberate switch | Core candidate |
| Deliberate Stack / Grid switch | How often users need both layouts | Once per review after a successful user switch, regardless of keyboard or toolbar | Core candidate |
| Grid Inline / Offset | Demand for the alternative three-item arrangement | Once per eligible three-item review per explicitly selected layout | Later |
| Stack Fit / Balance | Whether equal-area inspection is useful | Once per eligible Stack review per selected mode; keep restoration separate from explicit choice | Later |
| Difference mode | Adoption of pixel-difference review | Once per review when a valid difference pair becomes active | Core candidate |
| Image wipe | Adoption of direct side-by-side reveal | Once per eligible image review when a valid wipe pair becomes active | Core candidate |
| Difference/wipe pair switching | Whether multi-pair comparisons matter | Once per review when a different valid pair is selected; no pair identities or slot labels | Later |
| Zoom loupe / linked loupe | Demand for pixel-level inspection | Once per review per enabled mode | Core candidate |
| Zoom/pan and native-size view | Whether users inspect beyond the fitted overview | Once per review per operation family; never collect zoom coordinates or pointer paths | Later |
| Rotation / black-and-white view | Use of presentation aids | Once per review per successfully applied feature | Later |
| Tile Check | Adoption of seamless-texture review | Once per eligible image review when the tool shows a valid preview | Core candidate |
| Tile Check 3×3 / Offset / Heatmap | Which inspection options are used | Once per review per selected option; no scores, heatmaps or seam results sent | Later |

Default Grid placement is not evidence that a user prefers Grid. Report initial presentation and explicit switching separately.

### 3. Video and image scopes

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Scopes panel displayed | How many visual reviews include scope analysis | Once per eligible review when the visible panel has valid source data; separate image and video contexts | Core candidate |
| Scopes deliberately opened | Whether users actively discover/select the tool | Once per review after an explicit successful open, separate from a restored preference | Core candidate |
| Histogram mode selected | Use of RGB, RGB + luma and CDF | Once per review per deliberately selected mode | Core candidate |
| Video waveform mode selected | Use of luma, RGB parade and RGB overlay | Once per review per deliberately selected mode | Core candidate |
| Scope source changed | Whether users compare measurements between assets | Once per review after a successful source change; never send source labels or filenames | Later |
| Vectorscope displayed | Exposure to color analysis | Already implied by a valid scopes panel display; do not add a misleading independent “used” count | Derive from panel display |

All three scopes are displayed together. We cannot infer which one a person looks at. The video waveform monitor measures image signal levels and must be named separately from the audio waveform. A scope refresh during playback is not another use.

### 4. Audio waveform, spectrogram and loudness views

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Audio visualization displayed | How many reviews include usable audio analysis | Once per review when valid analysis is visible; context: audio-only, video W panel, or video audio-focus mode | Core candidate |
| Video audio-analysis panel deliberately opened | Demand for examining a video's soundtrack | Once per review after an explicit open; do not count a no-audio/empty panel as successful analysis | Core candidate |
| Audio waveform interaction | Direct use of the waveform as a review surface | Once per review after a valid seek/scrub or loop-selection gesture on this surface | Core candidate |
| Spectrogram interaction | Direct use of the spectral view | Once per review after a valid seek/scrub or loop-selection gesture on this surface | Core candidate |
| Waveform / Waveform + LUFS / LUFS only | Adoption of loudness-envelope inspection | Once per review per successfully selected available mode | Core candidate |
| Shared Fit / Ref scale | Whether absolute-level comparison matters | Once per review per selected setting; the scale controls both waveform and spectrogram | Core candidate |
| Spectrogram linear/log scale | Frequency-scale preference | Once per review per selected setting; do not count hidden redraws | Later |
| Spectrogram palette changes | Whether palette customization helps | Once per review when changed; exact palette popularity only if worth the extra breakdown | Later |
| Waveform/spectrogram split resized | Whether the default balance meets needs | Once per review after a completed resize, without exact panel geometry | Later |
| Audio-focus mode for video | Demand for reviewing audio without the picture | Once per video review when activated and usable analysis is shown | Core candidate |

Waveform and spectrogram appear together in the W panel and automatically for audio files. Their visibility is not two independent user choices. Interaction counts provide stronger evidence of active use, but still miss people who inspect a graph without clicking. LUFS/LRA/true-peak values being present in an info bar likewise cannot establish that someone read them. Never send the measured loudness values or spectral data.

### 5. Playback and review workflow

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| User starts playback | Whether ready media is played | Once per playable review after a user play action succeeds; exclude automatic restart/wrap | Core candidate |
| Frame stepping | Adoption of frame-accurate review | Once per video review after a valid step; holding a key is not a stream of analytics events | Core candidate |
| Timeline scrubbing | Use of interactive seeking | Once per review after a valid completed scrub gesture; no timestamps, path or direction history | Core candidate |
| Custom loop region | Adoption of repeated section review | Once per review after a usable loop range is set; no in/out times | Core candidate |
| Sync / Solo playback | Demand for independent playback control | Once per eligible multi-video review per deliberately selected mode | Core candidate |
| Range Sync / Full | Handling unequal-length clips | Once per eligible review per deliberately selected range; automatic defaults are presentation, not choice | Later |
| Playback speed | Demand for slow/fast review | Once per review per slow/normal/fast category selected; finer rate labels only if needed | Later |
| Frame gallery capture / revisit | Whether pinned moments help comparisons | Once per video review per operation family; never send images or timecodes | Later |
| Copy timecode or range | Integration into note-taking/review workflows | Once per review after successful copy; never capture clipboard contents | Later |
| Timecode format choice | Formatting needs | Once per review per deliberately selected format, without copied output | Later |

Successful action families can be counted without logging keystrokes, cursor movements or every transport transition. A timeline scrub and a graph interaction may both describe one gesture; these are different reports and must not be summed as independent actions.

### Scrubbing: prioritized measurement plan

Jay specifically wants to know how much the scrubbing tools are used. A binary adoption count alone cannot distinguish an occasional scrub from a workflow built around repeated scrubbing, so this is a justified exception to deferring all usage-intensity measurements.

| Question | Proposed measure | Improvement decision |
| --- | --- | --- |
| How often is scrubbing part of review? | Share of eligible, reportable audio/video reviews with at least one valid scrub drag | How much development and regression-test effort scrubbing deserves |
| Is it occasional or sustained use? | Reviews with 1, 2–5, 6–20 or 21+ completed scrub gestures | Whether speed, responsiveness and repeated-drag comfort deserve priority; these are initial proposed buckets, not established usage patterns |
| Where do people scrub? | Once per review per surface: progress timeline, audio waveform, spectrogram | Which interaction surfaces need the most polish or clearer affordances |
| In which workflows? | Separate audio-only and video review; use set-size context only if it helps single/multi-item scrub decisions | Prioritize audio versus frame-preview work and multi-video synchronization |

**What counts:** one valid completed pointer drag that actually changes the review position, regardless of how many pointer moves, decoder requests or painted frames occur during it. A click-to-seek/audition is a separate interaction, not a scrub drag. Shift-drag loop selection, loop-marker adjustment, frame stepping, programmatic seeks, automatic playback and canceled/invalid gestures do not inflate scrub counts. A waveform drag contributes to scrub adoption and waveform-surface adoption, but is still one gesture in the intensity count. It counts once even if several synced assets move.

**How to keep intensity coarse:** keep the exact gesture count only in memory for the current review. Candidate reports are one-time threshold events at 1, 2, 6 and 21 gestures. Differences between those nested totals approximate the proposed intensity buckets without a user/comparison identifier or reliance on an exit-time report. Threshold totals must use the same cohort; interrupted reporting, consent withdrawal, delivery loss and reporting-period boundaries can make the derived buckets approximate. This transport design still needs validation before implementation.

**Useful next question:** whether a user scrub activates an available audio-preview route. Keep readiness, preview activation, mute state and fallback behavior conceptually separate; activating a route cannot prove the user heard it. Broad video-preview/audio-preview fallback or failure categories belong to the reliability design, not a fictional user choice between Continuous and snippets—Continuous is the standard and snippets are a fallback.

Do not collect scrubbed timecodes, clip positions, cursor paths, recordings, audio samples or gesture-by-gesture histories. Repeated scrubbing indicates use, but does not establish satisfaction: it can reflect careful inspection or difficulty finding a moment. No new measurements are enabled by this plan.

### 6. Audio listening and comparison

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Audio source switching | Whether users listen across alternative assets | Once per eligible multi-source review after a deliberate successful switch | Core candidate |
| Full Mix / Dialogue Focus / Center Only | Demand for dialogue-focused listening | Once per review per explicitly selected available preset; default Full Mix is not a deliberate choice | Core candidate |
| Custom center/background adjustment | Demand for listening-mix tuning | Once per review after a completed adjustment; no exact gain values needed | Later |
| Scrub preview available / used | Whether audible scrubbing reaches users | Separate capability/readiness from a user gesture that activates a preview; do not equate “scheduled” with actually heard | Later |
| Explicit mute/volume adjustment | Need for quick listening controls | Once per review per operation family; persisted mute is not a new action | Later |

Dialogue Focus and Center Only require verified center-channel support. Their adoption denominator should be eligible reviews, not all audio/video loads. Reporting a coarse “center controls available” flag would itself be a proposed new field and must be included in the planned scope. Do not transmit sample rates, channel maps or codec details just to obtain that denominator.

### 7. Help, customization and app access

| Candidate | What it tells us | Counting definition | Priority |
| --- | --- | --- | --- |
| Manual / Getting Started / hotkey list opened | Where users seek help | Once per document per panel explicitly opened; exclude automatic welcome/changelog display | Later |
| Hotkey customization | Demand for tailored controls | Once per document after a binding is saved; never send the chosen key sequence | Later |
| Appearance selected | Popularity of cosmetic choices | Once per document per explicitly selected appearance; automatic animation frames are never events | Later |
| Browser fullscreen | Demand for uncluttered review | Once per document after successful entry | Later |
| Standalone app vs browser | Whether people use the installed experience | Optional coarse launch context; display mode is not proof of an installation or a unique device | Separate context review |

These can be described as app-feature usage, but they are less central to deciding which comparison tools to improve. No telemetry about refusals is proposed.

### 8. Reliability and performance — separate planning category

Potential questions: Are loads failing? Is audio analysis unavailable? How often is a compatibility fallback needed? Are ready/loading times long enough to affect the workflow?

Possible future measurements are fixed failure categories, coarse timing buckets, and fallback availability/activation. User-triggered transcode-tool use could be a feature-use count; automatic decoder/transcode failures are diagnostics. This category needs a separate data design and consent review before collection, including whether a distinct choice is appropriate. Keep free-form errors, stack traces, codec/file metadata, exact timestamps and filenames out of the initial feature-use scope. Do not infer reliability from feature absence: low scopes use could mean preference, discoverability, ineligible media or a rendering failure.

## Counting rules that make the results useful

### Use per-review adoption as the primary measure

For most tools, send one count per feature (or bounded feature value) per reportable ready set. For example, opening and closing scopes ten times during one comparison still counts as one review with scopes. This answers how often the tool participates in actual work without over-weighting repeated clicks by one person.

A counted ready set includes single-item reviews and 2–4-item comparisons, as implemented since scope 2 and retained in the current scope 4. Clearing/reloading, including the same files, begins a new set. Hiding a slot does not change the original set size.

If repeated intensity later becomes important, add a coarse per-review bucket for a small number of tools, rather than raw action streams. That is a later proposal; don't promise exact usage intensity from a once-per-review metric.

### Separate three concepts

- **Available:** the feature can work for this review. Needed for an eligible denominator.
- **Displayed:** the usable panel/mode is visible, including automatic or restored presentation.
- **Interacted with:** a person successfully chooses or operates it.

These are not interchangeable. Only add an availability metric where it improves a specific decision, such as dialogue presets requiring a discrete center. Use matched cohorts: the numerator and denominator must refer to the same media type, eligibility, consent state and reporting period. Sets whose readiness occurred before consent or offline should not later contribute orphan feature-adoption counts to a denominator they never joined. A new ready set after consent can be counted normally.

### Keep the data small and bounded

Use fixed event labels and a short list of justified context values: image/video/audio, set size 1–4, feature/mode and—where needed—automatic/restored versus deliberate entry. Avoid multiplying every event by every dimension. Keep separate event families conceptually distinct; “displayed,” “opened” and “interacted” counts overlap and cannot be added together as a total.

Deduplicate within the current review in memory; no uploaded comparison ID, user ID or file fingerprint is required for per-review adoption. This means we cannot reconstruct a person's workflow, identify returning individuals or freely join arbitrary feature combinations. A specific useful co-use question could instead be answered by a separately defined aggregate emitted from local state, if later justified.

All entry points for an action—toolbar, keyboard or pointer—must converge on the same committed-state hook. Count successful behavior, not a click whose feature was unavailable. Never instrument per-frame draws, audio samples, seeks on every pointer move, background analysis completion as user activity, or automatic loop wraps. Preserve the current no-pre-consent reporting, no offline replay, and no-reporting-with-No behavior.

Before implementation, review request volume. The current adapter has a small in-flight request cap; emitting every default-visible feature simultaneously at readiness could silently drop observations. Select a lean first wave and design a bounded, consent-cancellable send path before assuming all the catalog rows can be enabled together. Hosted GoatCounter acceptance and aggregation still require a real dashboard test. This catalog is not a promise of funnel analysis or exact per-person counts.

## Example questions for a first dashboard

These are proposed questions, not measured results:

- How many single-item reviews and 2-, 3-, or 4-item comparisons were ready this week, split by media type?
- What share of eligible visual reviews displayed scopes? What share explicitly opened them?
- How often do users select RGB parade or CDF after opening scopes?
- For video with usable audio analysis, how often is the W panel opened? For audio-only review, how often are the waveform and spectrogram directly interacted with?
- What share of eligible reviews uses Ref scale, LUFS views, wipe, Difference or the loupe?
- How often are Solo playback, custom loops, frame stepping and audio-source switching used?
- Among reviews with verified center controls, how often are Dialogue Focus and Center Only selected?

Report these as activity among people who agreed to sharing. They cannot supply the opt-in rate, the number who chose No, exact daily unique people, time spent, attention to a displayed graph, or a defensible “nobody needs this feature” conclusion.

## Consent and implementation status

This catalog provides the concrete categories needed to refine the candidate feature-use consent wording. A potential scope would cover visits, review-set size/type and use of comparison, analysis, playback and listening tools. The short invitation can summarize those families, with representative examples and a detailed list available from Details. Reliability data, launch context and other additions need a separate decision rather than being implied by a general “improve the app” phrase.

The first set is defined in [usage-events.md](usage-events.md) and implemented under scope 2. Other candidates remain deferred. Any expansion must update the applicable contract, disclosure and tests; material changes require another consent scope. A saved No remains off.

## Inventory verification and work record

Reviewed FEATURES.md and MANUAL.md against the current controls and handlers: the hotkey registry, toggleAudioViz, toggleVideoScopes, histogram/waveform mode handlers, shared Fit/Ref controls, audio-focus mode, image wipe and Tile Check. This confirmed the important joint-display cases (waveform + spectrogram, and the three scopes), automatic audio-only visualization, remembered panel/layout choices, image-only wipe and center-layout requirements.

This work added documentation only. No analytics hooks, collection labels, consent version, app version or runtime behavior changed. No browser tests were needed for the catalog; Markdown references and git whitespace checks were verified. No commit, push or deployment was performed.
