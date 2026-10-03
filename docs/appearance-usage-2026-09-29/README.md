# Appearances and optional GoatCounter reporting — 2026-09-29

The [final adversarial follow-up](reset-cancellation-verification-2026-10-01.md) corrects Reset's pending-request cleanup and the single-item catalog description, with 61 focused tests and 444 ownership checks passing. The original review and its evidence remain intact.

The [native Safari 27 release checks](safari-release-verification-2026-10-01.md) cover normal file loading, playback/seeking/restart, graphs/scopes, all appearances, narrow windows, and local opt-in/withdrawal/reload behavior. Continuous drag scrubbing and audible quality remain unverified because of native automation limitations; a retained video-scope plot after switching to audio is documented separately. All 23 counting requests stayed on loopback; no deployment or live GoatCounter count occurred.

The [help typography follow-up](help-typography-verification-2026-10-01.md) gives Help and What's New a shared 13px body-text owner and condenses the Getting Started appearance/privacy section. The full sharing disclosure and consent scope are unchanged.

The [Safari tab-return follow-up](safari-tab-restore-verification-2026-10-01.md) adds native seek scheduling, preserved-transform surface refresh and native mono/stereo audio output where volume is writable. The final transport run passed 64 tests and 462 ownership/logic checks; native Safari showed improved post-seek presentation and working scrubs after tab return. The original permanent freeze still needs confirmation with Jay's comparison before publication.

The [Safari scrub-audio follow-up](safari-scrub-audio-verification-2026-10-01.md) resumes the separate preview engine after interruption as well as suspension. A controlled native Safari comparison measured silence in the old adapter and nonzero forward/backward preview PCM after the fix; 28 focused browser tests and 462 ownership checks passed. Physical speaker output and Jay's original silent comparison still need a listening check after reload.

**Current release: 3.18.13, consent scope 4; publication authorized October 3. Standalone 3.18.12 was deployed October 2.** The daily-use addition and verification are recorded in [daily activity](../daily-activity-3.18.13-2026-10-02.md). The historical candidate notes below describe preparation before that publication. The endpoint remains pinned to `https://warpdiff.goatcounter.com/count`. Jay’s collection and 365-day retention choices have been saved and independently verified, and the local integration now uses the matching scope-4 disclosure with one coarse working-space group per ready review. Those historical preparation checks published nothing and sent no synthetic event to the live collector. See the [final release-candidate verification](release-candidate-verification.md) and [account configuration and scope-3 verification](account-activation-verification.md). See the [adversarial fixes and verification record](consent-hardening-verification.md) and [account prerequisites](../usage-account.md). See the [quieter invitation and panel update](quiet-invitation-verification.md), the [scope-2 implementation and verification record](scope2-verification.md), the [event contract](../usage-events.md), and the [endpoint configuration record](#goatcounter-endpoint-configuration-3187), the [consent versioning record](#follow-up-consent-versioning-3186), the [animated Nebula record](#follow-up-animated-nebula-3185), the [calmer, wider Starfield record](#follow-up-calmer-wider-starfield-3184) and the [Solar direction correction](#follow-up-consistent-solar-direction-3183), [larger Starfield record](#follow-up-larger-starfield-3182), and [previous follow-up](#follow-up-fixed-solar-planes-and-a-starfield-appearance-3181) for stationary Solar planes and Starfield as a regular appearance. The original implementation and verification records are retained below.

## Outcome and scope

Implemented Original, Solar, Nebula and Glacier appearances and an opt-in GoatCounter-compatible counting adapter in WarpDiff 3.18.0. The user requested **local testing only**, confirmed strict opt-in, and wanted No to be remembered. Production reporting remains unconfigured; no live GoatCounter account, hosted dashboard, external analytics requests, push or deployment was involved.

Appearance selection is independent of reporting. We discussed potential cosmetic incentives, but no specific gating policy was selected. All appearances are therefore available with reporting off, and withdrawing consent does not remove an appearance.

## Try the local preview

From the project root:

```sh
node scripts/preview-appearance.mjs
```

Open **http://127.0.0.1:8081/?usageTest=1**. The server binds only to loopback, serves the working tree, and prints received counting requests in its terminal. It never forwards those requests. Set `WARPDIFF_PREVIEW_PORT` if port 8081 is occupied.

1. Dismiss What's New / Getting Started if shown.
2. Open **Appearance and privacy** at the right of the header; select a theme.
3. In local test mode, choose **Share usage counts**. The panel shows a visit request.
4. Load 2–4 files. The panel increments its comparison-request count; the local terminal records a volume event plus an active-participant event.
5. Change layouts or replay: the count stays put. Load another set: it increments once.
6. Choose **Turn sharing off**. Load another set: no more analytics requests.
7. Reload: the No preference is remembered, and the invitation is absent.

The panel's local request totals reset with a page reload; they describe **attempted local requests**, not confirmed hosted analytics. Failed requests are counted separately. The local recorder does not perform GoatCounter's aggregation or visitor deduplication.

A normal localhost URL without `usageTest=1` has no reporting, no invitation and disabled sharing buttons, even when the official-site endpoint is configured. Local testing uses `pref_usageConsentTest`; production uses `pref_usageConsent`. A test Yes cannot grant production consent.

## Appearance implementation

- `js/appearance.js` owns selection, persistence and panel interactions. `pref_appearance` is shared across app updates in the same browser/site. Invalid values fall back to Original.
- CSS stays in the single style block in `index.html`. Solar uses two thin CSS ellipses with small highlights and slow rotation. Nebula uses three static radial gradients and five sparse points; Glacier uses two understated cool gradients. There are no generated bitmap backgrounds or new runtime packages.
- The existing logo supplies the mask for themed marks; the media rendering pipeline receives no filters or theme colors. The comparison background, audio visualizations, scopes and semantic slot colors remain unchanged.
- Decorations are children of the landing screen, hidden during comparison. Reduced motion removes orbit/border/logo animation. Page hiding pauses Solar animation. The Original starfield now combines theme, landing visibility, its existing X-key preference, page visibility and reduced motion in one visibility owner. Pending animation frames are canceled when stopped, preventing overlapping chains on rapid stop/start.
- The existing Kelvin logo animation exits under a custom appearance or reduced motion, while hidden, or during comparison; returning to Original or the landing screen resumes it.
- The header selector collapses to an icon during comparison and at narrow widths. Escape closes the nonmodal panel and restores focus; panel input is isolated from media hotkeys. Explicit managed-review hosts hide these controls and cannot report usage.

Screenshots from the real implementation, not the earlier generated concepts:

- [Solar](solar.png)
- [Nebula](nebula.png)
- [Glacier](glacier.png)
- [Appearance/privacy panel](appearance-privacy.png)
- [Neutral four-image comparison](comparison-neutral.png)
- [390-pixel-wide settings panel](mobile-panel.png)

## Counting design

`js/usage.js` is the only consent/reporting owner. It uses GoatCounter's documented browser `/count` endpoint directly through `fetch`, rather than loading a third-party script. A production endpoint must be set deliberately in `_USAGE_ENDPOINT`; `_USAGE_HOST` additionally restricts production reporting to the intended hosting domain. No URL parameter, embedded host message or browser storage value can supply a remote collector.

| Request | Fields and meaning |
| --- | --- |
| Visit | Fixed path `/`, fixed title `WarpDiff`; at most one attempt per document, after consent and while visible |
| Work volume | `comparison-image-2` through `comparison-image-4`, and corresponding `video`, `audio`, or `mixed` labels; `e=true`, `ns=true` so repeat comparisons count |
| Participation | `comparison-active`, `e=true`, session deduplication left enabled |

The adapter permits only these labels. Request parameters are limited to `p`, `t`, `e`, empty `r`, random per-request cache buster `rnd`, and `ns` on volume events. No filenames, media contents, document title, page query string, fragment, referrer, screen dimensions or persistent identifier is included. Requests explicitly omit credentials and browser referrers and disable caching. The PWA service worker does not intercept the collector.

The readiness call is attached to the existing first-frame activation boundary in `checkAllLoaded()` / `startFadeIn()`. A separate comparison epoch increments on clear, rejects stale readiness and counts each new ready batch once. Single-file reviews and failed batches do not count. Interactions within a comparison do not count. Ready batches observed without consent or offline are not saved or replayed later. A new load of the same files is a new comparison.

Both choices are saved locally. Revocation aborts pending requests, and a storage event propagates changed/cleared consent to other open tabs. There is no retry or offline queue. Pending work is capped at eight requests with a three-second timeout. Embedded views, prerendering and production automated browsers are excluded. Reporting errors do not affect media loading or transport.

## Privacy and measurement limits

- No means no analytics request, including no event announcing an opt-out. We cannot calculate the opt-in rate or total audience from these counts.
- Participation counts are an estimate. GoatCounter uses an eight-hour session window; this is not an exact daily count of distinct people. Offline use, blockers, failed requests and rapid activity while the small request cap is occupied can undercount.
- A comparison event means the media set reached the app's readiness boundary, not that someone completed a review or spent a particular amount of time reviewing.
- With a live collector, IP addresses and normal browser headers still reach GoatCounter. The privacy text describes its temporary use of this information instead of claiming that nothing leaves the browser. The site owner can disable unneeded server-side fields in GoatCounter settings.
- The hosted service's acceptance, aggregation, totals, bot rules and session deduplication were **not tested**. Production requests use an opaque cross-origin response, which cannot prove acceptance from the app. A real browser/dashboard smoke test is required when a real site is configured.
- Revocation cannot retract events already received. Clearing browser storage, private sessions, another browser/device, or a different origin can require a new choice. If browser storage itself is unavailable, the current-page preference still applies but cannot persist.
- GitHub Pages separately logs IP addresses for hosting security; absence of WarpDiff reporting does not mean absence of host logs.

## Verification and fixes

The focused browser tests exercise UI actions and real image/video/audio loads. Intercepted requests verify payloads and privacy properties. An additional actual loopback-server run produced **three requests**: one visit, one `comparison-image-4` event and one `comparison-active` event. It reported **zero page JavaScript errors**. The receipt is [local-requests.json](local-requests.json). This is evidence of local transport and payload behavior, not hosted GoatCounter acceptance.

Completed checks:

- Initial appearance/privacy browser suite: **11 passed**.
- First ownership run caught the README version still at 3.17.8; documentation was updated to 3.18.0 alongside app/cache/changelog changes.
- An initial new ownership guard mistakenly counted `===` as an assignment. Narrowing the expression to a single assignment fixed that false positive. The guard now enforces one theme writer.
- First complete Playwright run: **271 passed, 1 skipped, 1 failed**. The failure was the existing narrow two-video audio-format layout check, which failed on its retry too. The new button made the header 47 px rather than 45 px; the first media info bar became 558 px wide and its zoom text ended at x=791.796875 while the bar ended at x=791. Restoring the button's vertical padding recovered the existing header height and layout.
- After that fix, appearance/privacy plus audio-format browser tests: **20 passed**.
- Added coverage for in-flight cancellation, corrupt preferences, and starfield lifecycle: **14 appearance/privacy tests passed**.
- Final `npm run test:ownership`: **436 passed, 0 failed**.
- Final `npm test -- --reporter=line`: **275 passed, 1 skipped**, no failures (1.5 minutes). This includes all 14 new appearance/privacy tests.
- `git diff --check`: passed.
- Real browser screenshots were reviewed at 1440×900 and 390×844. A first screenshot pass exposed a hard outer edge in the haze; a radial alpha mask softened it. The themed header logo now uses the original silhouette as a mask for accurate accent colors. Text contrast was increased for the custom themes.
- The local preview server initially rejected its root path because of a trailing-slash containment check. Resolving the root consistently fixed the 403. A screenshot helper initially waited for a network response after it had already arrived; waiting on the displayed comparison count fixed the missed-event timeout.
- System `python3` was blocked by the machine's unaccepted Xcode license. The already available bundled Python ran the one-time editing script; no machine settings were changed.

## Files and release hygiene

Updated app CSS/markup/readiness hooks, added `js/appearance.js` and `js/usage.js`, adjusted `js/starfield.js`, and included new classic scripts in the service-worker asset list. Version 3.18.0 aligns the app, cache, README and in-app What's New. FEATURES, MANUAL, in-app Manual and Getting Started describe the same behavior. Tests live in `tests/appearance-usage.spec.ts` and additional ownership guards. `scripts/preview-appearance.mjs` is only a developer preview server, not a production dependency.

No commit, push, deployment or hosted GoatCounter account creation has been performed.

## Primary sources consulted

- [GoatCounter tracking-pixel contract](https://www.goatcounter.com/help/pixel)
- [JavaScript API and no_session](https://www.goatcounter.com/help/js)
- [Sessions and visitors](https://www.goatcounter.com/help/sessions)
- [GoatCounter privacy](https://www.goatcounter.com/help/privacy)
- [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection)

GoatCounter's served `count.js` was inspected on 2026-09-29 to verify that `no_session` maps to the `ns` query field. Its SHA-256 was `792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0`. That external script is not shipped or loaded by WarpDiff.

## Follow-up: fixed Solar planes and a Starfield appearance (3.18.1)

Jay asked for Solar's orbital planes to stay stationary with the bodies moving along them, then clarified that the original starfield should become an appearance instead of remaining an X-key Easter egg. That clarification replaces the intermediate idea of an optional starfield switch in every theme; no such switch is shipped.

Changes:

- Added **Starfield** as the fifth appearance, using the existing Ad Astra renderer in the drop area. Original keeps the plain landing background. X no longer toggles anything, and the hidden action was removed from the hotkey registry.
- Migrated a saved `starfieldOn=1` to `pref_appearance="starfield"` when the appearance was Original/unset. An explicit Solar/Nebula/Glacier preference takes precedence. The legacy key is removed after migration, so later selecting Original sticks.
- Solar's two elliptical planes retain their fixed −18° orientation. Four small bodies follow them using CSS motion paths; the outer/inner periods are 60/90 seconds and their directions differ. A ResizeObserver supplies each plane's path in local coordinates on size changes. There is no per-frame JavaScript orbit loop. Reduced motion disables body animation; hidden pages and comparisons pause it.
- Starfield runs only for the Starfield appearance and stops for hidden pages, comparisons and reduced motion. Both the original worker and fallback algorithms remain. Resizing during a comparison can no longer resize the hidden worker canvas to 0×0; it remeasures when shown.
- Version 3.18.1 updates app/cache/README/What's New together. Markdown and in-app documentation describe the new appearance and retired shortcut. GoatCounter configuration and consent behavior were not changed; this remains a local, unpublished preview.

Verification:

- **16 focused appearance/privacy browser tests passed**, including sampled Solar body geometry at 1440px and 390px viewport widths. Plane bounds/transforms remained identical across four sampled times; all body centers stayed on their ellipse, and body positions changed.
- The first geometry test failed: a percentage-based ellipse on a tiny body used that body's reference box, leaving the body near the plane corner (normalized ellipse equation ≈2 instead of 1). Switching to explicitly sized local paths resolved the failure; no tolerance was loosened.
- Legacy preference migration, persistence after returning to Original, and the inert X key passed. Starfield starts/stops when changing appearances and responds to visibility/reduced-motion changes.
- Both the OffscreenCanvas worker and main-thread fallback were exercised through load → resize while reviewing → clear. Both resumed with a 280×180 canvas and zero page JavaScript errors. See [renderer observations](starfield-renderers.json).
- New screenshots: [fixed Solar orbits](solar-fixed-orbits.png), [Starfield](starfield.png), and [five appearance choices](appearance-five-choices.png).
- Final regression checks: **277 browser tests passed, 1 skipped**; **437 structural/pure-logic checks passed, 0 failed**. `git diff --check` also passed.

Browser coverage here is Chromium. The fallback renderer was forced in Chromium; this is not a claim of a separate Safari/Firefox run. Nothing has been committed, pushed or deployed.

## Follow-up: larger Starfield (3.18.2)

Jay requested that Starfield have the same larger presence as the other appearances. Moved the existing canvas out of the 280×180 drop area into the shared landing atmosphere. It now uses the same responsive bounds as Solar, Nebula and Glacier: up to 1040×660 CSS pixels, with a soft elliptical edge fade and 70% opacity. The existing landing stacking context keeps controls in front, and the decoration cannot intercept clicks. Extra static decorative stars are hidden for Starfield so the original animated renderer remains its sole star source.

Both renderers already measure their canvas parent, so the larger container required no animation-algorithm changes. Existing visibility and reduced-motion gates remain in place. App/cache/README versions and What's New are updated to 3.18.2; Markdown and in-app descriptions now explain the broad background.

Verification:

- **16 focused appearance/privacy browser tests passed (7.8 seconds)** and **437 structural/pure-logic checks passed**. `git diff --check` passed. The full media suite was not rerun for this layout-only revision; its earlier 277-pass result belongs to 3.18.1 above.
- Real OffscreenCanvas worker and forced main-thread fallback each painted stars at **1040×660** on a 1440×900 desktop viewport, **1040×595** after loading media, resizing and clearing, and **546×660** on a 390×844 narrow viewport. The narrow canvas deliberately extends beyond the viewport, like the other atmospheres, without horizontal page overflow.
- Both renderers had zero page JavaScript errors. Desktop and narrow screenshots were visually inspected: stars extend beyond the drop area, edges fade, and the title, hints and header stay readable. See [desktop](starfield-wide-desktop.png), [narrow layout](starfield-wide-mobile.png), and [renderer measurements](starfield-wide-renderers.json).
- Verification was in Chromium, including the forced fallback; Safari and Firefox were not separately tested. No commit, push or deployment was performed.

## Follow-up: consistent Solar direction (3.18.3)

Jay pointed out that the Solar bodies should travel in the same direction. Removed the inner plane's reverse animation override. All four bodies now advance in the same direction around the stationary planes; outer and inner periods remain 60 and 90 seconds. This is decorative motion rather than a physical orbital simulation. Updated app/cache/README versions, What's New, and the affected Markdown and in-app descriptions.

Chromium inspection sampled each body's path position one second apart: the outer bodies advanced 1.6667% of their paths and inner bodies advanced 1.1111%, all in the positive direction. **16 focused browser tests passed (7.4 seconds)**, including stationary-plane/path geometry at desktop and narrow sizes; **437 structural/pure-logic checks passed**. `git diff --check` passed. No new tests were added for the one-property correction, and the full media suite was not rerun. Nothing was committed, pushed or deployed.

## Follow-up: calmer, wider Starfield (3.18.4)

Jay requested slower movement and a somewhat wider Starfield. Reduced both renderers' minimum and maximum depth increments to two-thirds of their previous values (0.0003333…–0.002 per frame). This makes a star's center-to-edge journey take 50% longer at the same frame rate. Actual pixel travel also depends on the canvas size; this is not a claim that screen-space speed is exactly one-third slower after widening.

Added a Starfield-only width of min(1250px, 168vw), about 20% wider than the previous min(1040px, 140vw). Height, soft fade, opacity and the 300-star count stay the same. App/cache/README versions, What's New, and affected appearance descriptions are updated to 3.18.4. There is a modest increase in canvas area; no performance benchmark was run, and the pre-existing animation still advances per frame.

Verification:

- **16 focused browser tests passed (7.1 seconds)**; **437 structural/pure-logic checks passed**; `git diff --check` passed. The full media suite was not rerun for this cosmetic adjustment.
- Both worker and forced main-thread renderers painted at **1250×660** on a 1440×900 viewport, **1250×595** after load → resize → clear, and **655×660** on a 390×844 viewport. Neither produced horizontal page overflow or JavaScript page errors. See [renderer observations](starfield-calm-renderers.json).
- Visually inspected the [desktop](starfield-calm-desktop.png) and [narrow](starfield-calm-mobile.png) screenshots; the wider field remains behind readable controls with soft edges.
- Browser verification was in Chromium; no separate Safari/Firefox run, commit, push or deployment.

## Follow-up: animated Nebula (3.18.5)

Jay requested a galaxy hub with moving stars, then asked about the rotation direction and noted abrupt arm endings while trying the preview. The final appearance keeps the violet background haze, adds a soft hub above and left of the logo, and draws two faint spiral arms with 240 deterministically scattered stars. Inner stars turn faster than outer ones (roughly 3–5.5 minutes per orbit); a small subset twinkles gently. The logo, file controls and media review remain in front of the decoration.

Implementation and refinements:

- Extended the existing appearance module with `_setupNebulaGalaxy`, which owns a single cancellable canvas animation chain. Elapsed animation time uses frame timestamps, capped after a stall, and freezes while inactive. Theme changes, hidden pages and media review stop frames; reduced motion retains a still galaxy. Resizing remeasures the shared atmosphere, preserves the star arrangement and caps canvas pixel ratio at 2.
- The first visual pass used broad strokes for the arms; screenshot review showed they looked too much like tracks. Replaced those with overlapping soft cloud sprites, generated once locally, for diffuse dust.
- The initial rotation made the arms lead. Reversed the angular motion so stars and dust now rotate counterclockwise on screen with trailing arms, matching the usual spiral-galaxy arrangement described by [NASA](https://science.nasa.gov/asset/hubble/spiral-galaxy-ngc-4622-spins-backwards/). This remains decorative, not a physical galaxy simulation: real spiral patterns and individual stars need not move together.
- In response to the abrupt endings, both dust and star opacity now taper smoothly over the outer 30% of the radius, reaching zero at the limit. Dust also blends into the hub at the inner ends.
- Updated the app/cache/README version to 3.18.5, What's New, the affected product documentation and the architecture note in AGENTS.md. No new dependencies, network assets or analytics changes.

Verification:

- **17 focused browser tests passed (10.2 seconds)** on the final rotation/taper revision. The added lifecycle test checks changing canvas content while active, frozen content with visible stars under reduced motion, stopping for hidden pages/another appearance/media review, and resuming after clear and a narrow resize without horizontal overflow.
- An initial test using Playwright's simulated clock failed when the browser's reduced-motion change event had not been delivered before a simulated frame advance. The test was changed to brief real-frame observation so it exercises the browser's actual media-query lifecycle; application behavior was not bypassed.
- **438 structural/pure-logic checks passed**; the added guard covers one Nebula setup with gated scheduling and cancellation. `git diff --check` passed.
- Full regression result: **278 browser tests passed, 1 skipped (1.6 minutes)**. The run began before the final rotation/taper refinements; the focused run above covers those changes.
- Visually inspected the final [desktop](nebula-galaxy-desktop.png) and [narrow](nebula-galaxy-mobile.png) screenshots. Preview inspection reported no page JavaScript errors and no horizontal overflow.

Verification is Chromium-only, with no performance benchmark or separate Safari/Firefox run. Nothing was committed, pushed or deployed.

## Follow-up: consent versioning (3.18.6)

Jay requested consent versioning and asked how to describe a useful analytics scope without repeatedly prompting for minor metric additions. Implemented versioning independently of app releases, while preserving the current visits/comparisons-only collection. Broader wording and additional metrics are still a design discussion, not active collection.

Changes and rationale:

- `_USAGE_CONSENT_VERSION = 1` maps to the preserved [scope record](../usage-consent.md). Each new choice stores `choice`, `version` and an ISO `decidedAt` value locally, in the existing production or local-test preference key. None of this record is added to analytics requests.
- A matching, dated Yes permits reporting under the existing gates. An old string Yes, unknown older/newer scope, or incomplete Yes pauses sharing and displays a review invitation. Scope equality is intentional: it also prevents an older app revision from inheriting a newer scope's Yes.
- Legacy No and any-version No stay off without renewed prompting. Routine app releases leave the scope version alone. This avoids turning the feature into a recurring consent prompt or pressuring people who declined.
- One `restoreConsent` validator handles startup and cross-tab changes. A mismatched choice arriving from another tab stops reporting and cancels pending requests. Pre-consent activity remains unreplayed. Current-page choices still work if browser storage cannot be written, but cannot persist in that case.
- App/cache/README version, What's New, the privacy panel, in-app documentation, Markdown docs and AGENTS architecture note now describe versioning. The technical scope number is not added to the end-user flow.
- The local record is a functional consent safeguard, not a central audit trail or legal certification. It depends on local storage and the browser clock. The live service, operator/contact information and actual retention settings still need to be finalized before launch.

Guidance considered:

The [ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/) calls for clear purposes, processing activities, identity and withdrawal information, and cautions against sweeping language. The [EDPB's guide](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en) likewise emphasizes understanding what data is processed, why and how. A bounded category such as comparison-feature usage could describe more than one event; adding an event is not automatically a new purpose. It does not justify collecting arbitrary future metrics. Jurisdiction and the actual implementation matter. No broader permission has been silently added to scope 1.

Verification:

- **22 focused appearance/privacy browser tests passed (15.2 seconds)**, including five new cases for current record persistence, legacy/mismatched/incomplete Yes, continued No, cross-tab scope mismatches, and actual served script upgrades/downgrades.
- Upgrade/downgrade testing replaces the scope constant in the served script and verifies no report until a new current Yes; a No continues through a subsequent upgrade. Separate tests verify a renewed Yes does not replay comparisons completed while paused.
- Existing payload assertions still pass: requests contain only the approved counting fields, with no decision timestamps, scope version, cookies, filenames or referrers.
- **439 structural/pure-logic checks passed**; startup and storage handling are guarded to use the shared validator. `git diff --check` passed.
- Inspected the [desktop review prompt](consent-review-desktop.png), [narrow review prompt](consent-review-mobile.png) and [narrow details panel](consent-review-panel.png). No page JavaScript errors or horizontal overflow. The panel scrolls to its longer explanatory note.
- The full media suite was not repeated for this consent-state change; these results do not replace the earlier full-suite record. Verification was in Chromium with local intercepted/loopback requests, not against hosted GoatCounter.

No commit, push, deployment or production endpoint configuration was performed.

## Planning follow-up: feature measurement catalog

Jay asked for a categorized list of potential measurements covering comparison size, scopes, waveform, spectrogram and the wider feature set. Created the [measurement catalog](../usage-measurement-catalog.md) and linked it from the consent-scope discussion.

The inventory has eight groups: workload; comparison layout/inspection; image/video scopes; audio visualization; playback workflow; audio listening; help/customization/access; and a separate reliability/performance planning category. Each candidate includes the question it answers, a proposed count definition and a priority. Recommended primary reporting is once-per-ready-review feature adoption, with eligible denominators and separate “displayed” versus “interacted with” counts.

Source review confirmed that waveform and spectrogram are presented together, all three video/image scopes share one panel, and audio-only graphs appear automatically. The catalog therefore avoids interpreting panel opens as independent usage of each graph, automatic layouts as deliberate preference, repeated redraws as activity, or technical metrics shown in an info bar as evidence they were read. It also distinguishes one-item review from the existing 2–4-item comparison counters, and repeated item loads from unique files.

Only documentation changed in this planning follow-up. Collection, event allowlists, consent scope, app version and production configuration remain unchanged. Verified the local document references and `git diff --check`; no runtime tests were needed or run. No commit, push or deployment.

## Planning refinement: measure to improve the tool

Jay reframed the catalog around information reasonably valuable for improving WarpDiff. Revised its opening into a decision-first plan: workload, core-tool adoption, reliability, responsiveness, defaults/controls and evidence about targeted releases. Each decision now has a minimal signal, a possible action and an interpretation limit.

The recommended starting set is substantially narrower than the full feature inventory. Detailed mode, appearance, palette, input-method and help metrics become question-specific candidates. Reliability and coarse timing are recognized as potentially high-value while retaining their separate data-design/disclosure review; they are not automatically lower priority just because they need that work. Added an admission rule requiring an actionable question, count definition, relevant denominator, privacy boundary and known ambiguity.

The reference inventory remains available, with “Core candidate” replacing blanket “First wave” labels. Highlighted that low adoption does not prove a feature is unneeded, default visibility does not prove deliberate use, idle open time is not productive work, and before/after release differences do not establish causation. No runtime or consent change. Documentation links and whitespace checked; no browser tests required.

## Planning refinement: scrubbing as an explicit priority

Jay identified scrub-tool usage as valuable information. Added a focused plan to the measurement catalog: adoption among eligible audio/video reviews, coarse repeated-gesture intensity, and surface use (progress timeline, audio waveform, spectrogram). Suggested decisions concern scrub responsiveness, interaction polish, audio/video implementation effort and multi-video synchronization.

Checked the shared gesture handling in index.html: graph scrubs and timeline scrubs can control multiple assets; Shift-drag selects a loop region; clearing media cancels rather than completes a drag. The proposed count therefore treats one valid completed scrub drag as one gesture, excludes clicks, loop editing and automatic seeks, and avoids multiplying by pointer updates or asset count. Audio-preview activation/fallback is a follow-on question with explicit limits on inferring audibility.

Outlined optional in-memory thresholds for intensity so aggregate buckets would not require IDs or exit-time delivery. They remain a proposal with delivery/cohort limitations, not an implemented transport feature. Documentation only; no event, consent, version or runtime changes. Whitespace checks passed; no runtime tests needed.

## GoatCounter endpoint configuration (3.18.7)

Jay created a GoatCounter account and supplied the standard embed snippet with `data-goatcounter="https://warpdiff.goatcounter.com/count"`. Configured that exact endpoint in the existing consent-controlled adapter. The default external `count.js` tag was not inserted: the existing adapter owns when reporting can begin, uses fixed event labels and omits cookies/referrers/media identity. GoatCounter explicitly supports custom browser integrations via its [/count endpoint](https://www.goatcounter.com/help/pixel); its [JavaScript API](https://www.goatcounter.com/help/js) describes the default on-load behavior and event/session options.

Scope and controls:

- Official-host reporting remains restricted to `jayriddle.github.io`, a top-level standalone viewer, and an online/visible visit with current scope-1 consent. Existing per-event consent, offline, prerender and automation guards remain intact.
- The configured account receives only the already defined visit and ready-comparison events if/when this build is published and a user agrees. The feature/scrub/reliability measurement catalog remains a proposal. Consent version stays 1 because this configures the disclosed provider for the same collection scope; it does not introduce those additional metrics.
- Ordinary localhost and other hosts remain disconnected. Local-only `?usageTest=1` retains its loopback collector and separate consent. The query parameter cannot redirect production or make a local Yes count as a production Yes.
- App/cache/README version is 3.18.7. Updated the current user documentation and in-app descriptions to reflect the configured destination. Historical release and verification notes remain historical. Replaced the previous unconfigured-endpoint guard with an exact destination/host guard that also rejects adding the default embed to index.html.

Verification:

- **26 focused appearance/privacy and production-configuration browser tests passed (15.4 seconds)**. This includes four new production-branch tests in `tests/usage-production.spec.ts`.
- The new fixture serves local workspace files under an intercepted official-site URL. A simulated human-browser case suppresses the automation flag solely in that test fixture; a separate test retains the real automation flag and confirms that automated production reporting is blocked.
- Every browser request in that fixture is intercepted or blocked, including the collector. No network request from the tests reached the live GoatCounter account. A cookie deliberately placed on the simulated collector domain was still omitted from the counted request.
- Verified no report before consent, remembered No, renewed/current Yes, the fixed visit/comparison/participation labels, withdrawal, stale scope refusal, host restrictions, local-test separation, payload privacy and no unexpected third-party script requests.
- **439 structural/pure-logic checks passed** and `git diff --check` passed. The full media suite was not rerun for an endpoint/configuration-only change. Browser coverage is Chromium.

### What remains for a live check

This change is in the working tree only: no commit, push or deployment was performed. The endpoint was configured from the supplied snippet, not proven to accept or aggregate counts. Once a deployment/live smoke test is authorized:

1. Use a regular browser on the updated official site and check that no GoatCounter request occurs before consent or after choosing No.
2. Choose Yes, then load a two-image comparison. Confirm the visit and `comparison-image-2` / `comparison-active` events in the GoatCounter dashboard; a network request alone does not prove aggregation.
3. Load a new two-image set and verify work-volume behavior separately from visitor/session deduplication.
4. Turn sharing off, load again and reload the app; verify no further counting requests and no renewed prompt.
5. Retain the actual dashboard observations in this record. Finalize operator/contact and retention information before general release, and select the expanded metric scope before adding any feature or reliability events.

Browser responses to the live collector are opaque in this integration, so the in-app sender cannot confirm hosted acceptance. The dashboard remains the verification surface for that final step.
