# Usage-sharing consent scopes

This is the maintained record linking `_USAGE_CONSENT_VERSION` in `js/usage.js` to the data collection described to users. Retain prior scopes when adding a new one. This version is independent of `APP_VERSION`: appearances, bug fixes and ordinary app releases do not require a fresh Yes.

## Scope 1 — visits and comparisons (2026-09-29)

Introduced in the local 3.18.6 preview. The 3.18.7 working tree configures `https://warpdiff.goatcounter.com/count` for the official site. This does not itself publish the build or verify dashboard acceptance.

- **Purpose:** help WarpDiff's developer understand visits and comparison volume to guide development.
- **Collection:** visits; new ready comparisons of 2–4 files, labeled by media type and number of files; comparison participation. GoatCounter receives network IP addresses and browser headers, disclosed in Details with its privacy link. No analytics cookies are used.
- **Recipient:** WarpDiff’s GoatCounter site, `https://warpdiff.goatcounter.com/count`. Local test mode uses only the loopback collector and a separate consent preference.
- **Exclusions:** no media, filenames, contents, page query strings, referrers, screen sizes, persistent user IDs, feature-usage events, duration tracking, performance timings or error reports. The fixed-label allowlist in `js/usage.js` enforces what may be sent. The consent record itself is never reported; a refusal produces no analytics request.
- **Choice:** No thanks / Share usage counts. All appearances and app functionality remain available either way. Appearance and privacy allows withdrawal; withdrawal stops future reporting but cannot retract counts already received. Offline and pre-consent comparisons are not queued or replayed.

Initial invitation wording:

> Help shape WarpDiff
>
> Share visit and comparison counts with GoatCounter, including media type and file count. Files, filenames and media contents are never sent. Every appearance is available either way. Details

Details explains the purpose, data sent, IP/header handling, provider privacy link, local storage, withdrawal, and the distinction from GitHub Pages hosting logs. A legacy or mismatched Yes changes the invitation heading to “Review usage sharing” and adds “Please review the current details. Sharing is paused until you agree again.”

## Scope 2 — usage and basic reliability (2026-09-30)

Implemented in the 3.18.8 working tree; publication and real dashboard acceptance remain separate steps.

- **Purpose:** help WarpDiff’s developer improve comparison features and reliability.
- **Collection:** Optional statistics help WarpDiff’s developer improve the tool: visits; ready reviews of 1–4 items; use of Stack/Grid, scopes, audio graphs, Difference, wipe, loupe, Tile Check, loops and listening tools; completed scrub drags by surface and frequency band; and fixed counts of loading failures, audio analysis failures and compatibility fallbacks. Events include the app release, media type and item count. No filenames, media contents, raw errors, logs, pointer paths or playback positions are sent.
- **Counting:** With consent, sharing counts visits, ready reviews of 1–4 items, deliberate comparison-tool use, completed scrub drags, and basic failure/fallback categories, labeled by app release, media type and item count. Features count once per ready review; scrub frequency uses thresholds of 1, 2, 6 and 21 drags. Waveform and spectrogram appear together; their separate scrub surfaces indicate interaction, not separate panel choices. Reloading a set counts again. No files, filenames, contents, raw errors or logs are sent. Failed/canceled sets are not ready reviews; no offline or pre-consent activity is replayed.
- **Recipient and choices:** same GoatCounter destination, network IP/header handling, local test isolation and withdrawal behavior as scope 1. No persistent user/comparison IDs, duration tracking, performance timings, session recordings or central consent records. No is never sent.
- **Compatibility:** previous Yes is paused until an explicit scope-2 Yes; all saved No choices remain off.

Initial 3.18.8 invitation:

> Help improve WarpDiff by sharing optional usage statistics through GoatCounter: visits, reviews (media type and item count), comparison tools used, scrubbing frequency, and basic failure and fallback counts. Files, filenames and media contents are never sent. All appearances remain available either way.

The [event contract](usage-events.md) defines the exact vocabulary, counting and limitations. This is a bounded feature/reliability scope, not permission for arbitrary future metrics.

## Presentation refresh — 3.18.9 (same scope 2)

The short invitation now says:

> Help improve WarpDiff with optional counts of visits, reviews, tools used, scrubbing frequency, and basic failures or fallbacks. No files, filenames or media contents are sent. All features and appearances are available either way.

A prominent “What’s shared and who receives it” control opens the full categories, named GoatCounter recipient, IP/header explanation, privacy link and withdrawal details. The combined panel puts this request and its choices before appearances. The collection purpose, categories, recipient and consent scope have not changed. Existing scope-2 Yes remains valid; No remains off.

Starting an accepted file load without answering stores only a local boolean: `pref_usageInvitationDismissed` (or `pref_usageInvitationDismissedTest` in loopback tests). This suppresses future automatic invitations, including across reloads and app updates. It does not create or change a consent record, imply Yes/No, or send an event. A dismissed outdated Yes stays invalid. The choice remains accessible in settings. An explicit Yes/No clears this presentation flag so a later material scope change after a renewed Yes can request review normally. Cross-tab updates follow the same flag; clearing storage permits a fresh invitation. If writing fails, suppression applies for this page only. Merely opening settings/details or canceling the file picker does not count as continuing into a review.

## Scope 3 — verified provider processing (2026-09-30)

Prepared in the unpublished 3.18.11 working tree after Jay confirmed the operator, contact, collection choices and 365-day retention. The authenticated account showed Saved, and an independent settings-page navigation confirmed persistence. Publication and hosted delivery are separate checks.

- **Purpose and events:** same bounded usage/reliability purpose and event vocabulary as scope 2; no new feature or appearance events.
- **Provider processing:** GoatCounter receives IP addresses and browser headers for request processing and repeat-visit distinction. Browser/OS and country counts are retained; sessions are enabled. Region, referrer, screen-size, language and individual-pageview collection are disabled. The dashboard is private, with automatic deletion configured after 365 days. No unconditional eight-hour or RAM-only handling promise is made.
- **Operator/contact:** Jay Riddle; [warpdiff@gmail.com](mailto:warpdiff@gmail.com).
- **Compatibility:** every earlier Yes, including scope 2, requires a fresh explicit scope-3 Yes. All saved No choices remain off. No paused, offline or pre-consent work is replayed.
- **Disclosure:** the short invitation retains its bounded category summary; expandable Details now names the operator, contact, actual retained categories and retention. The document and adapter contract is 3.18.11/scope-3, with a refreshed integrity hash.

The new scope addresses the incomplete earlier provider notice; it does not reinterpret earlier acceptance as approval for additional metadata. Account settings are recorded in [usage-account.md](usage-account.md).

## Scope 4 — coarse working space (2026-10-01)

Introduced in the unpublished 3.18.12 release candidate. Existing provider configuration, purpose, recipient, retention, contact and usage/reliability event vocabulary remain as described in scope 3.

- **Added purpose:** improve layouts for the available window space, including side-by-side workflows.
- **Added data:** one of six broad window-width/height combinations per counted ready review, with existing release/media/item context. Width: narrow under 760 CSS pixels; medium 760–1,199; wide 1,200+. Height: short under 600; tall 600+. These groups are layout categories, not device classifications.
- **Sampling:** once at review readiness, under the existing consent and launch gates. Invalid dimensions skip the sample. No resampling on resize, playback or feature use; no consent/offline replay.
- **Exclusions:** no exact dimensions, monitor resolution, remaining comparison-area measurements, window positions, resize history, input capability or adjacent-window data. GoatCounter’s built-in screen-size collection remains disabled.
- **Compatibility:** all earlier Yes, including scopes 2 and 3, require fresh scope-4 Yes. Any saved No stays off. Document/adapter contract: 3.18.12/scope-4, with refreshed SHA-256 integrity.
- **Presentation:** the short invitation adds “broad window-size groups”; Details gives the exact categories, sampling and exclusions. All appearances/features remain available without sharing.

The [event contract](usage-events.md) is authoritative for counting and denominator limits. Appearance reporting and detailed remaining-media-area or resize measurements remain deferred.

## Local record and compatibility

New choices use the existing `pref_usageConsent` key (or `pref_usageConsentTest` locally) with a JSON record:

```json
{"choice":"yes","version":4,"decidedAt":"2026-09-30T20:00:00.000Z"}
```

This timestamp is illustrative. Actual decisions use the browser's current time; it is not a trusted server timestamp or a central consent audit log. The local record can be cleared, changed or lost with browser storage. Do not treat versioning alone as proof of legal compliance.

- Matching version + Yes + a parseable decision timestamp: sharing permitted subject to the existing visibility, host, online and embedding gates.
- Legacy string Yes, mismatched/future version, missing/invalid timestamp: sharing paused, invitation requests review. No events accumulated during the pause are replayed after acceptance.
- Legacy string No or any-version record with choice No: sharing stays off, without prompting again.
- Missing/corrupt/unrecognized record: no sharing until an explicit current choice.
- Startup and cross-tab storage changes use the same validator. Removing consent or replacing it with a non-current record stops reporting and cancels pending requests in listening tabs.
- If saving No fails, the adapter attempts to remove the old permission and latches No in this document. Successful removal leaves the next launch unconsented; it may ask again. If removal also fails, the UI warns that the previous Yes remains and tells the user to clear site data before reopening. No implementation can promise durable withdrawal when all available durable operations fail. A failed Yes save is explicitly described as applying only to this page. Old unversioned app builds see a structured record as unknown, so they fail closed rather than inherit its Yes.

## Hardening — unpublished 3.18.10 (scope 2 retained; production held off)

The fixes narrow reporting and add no categories. Each consent mutation invalidates the previous review and all operation tickets before reconciling stored state, even when a newer Yes is already stored. A failed withdrawal remains off in the current document despite subsequent restoration attempts.

A saved Yes alone sends no startup request. An accepted manual file load or an explicit Yes establishes standalone use. Every accepted host launch disables reporting for the rest of that document and aborts pending requests before capability negotiation. No timeout guesses launch ownership. Hosts must identify themselves before offering standalone file-load/opt-in actions; a later host message cannot retract a request already sent during explicit standalone use.

The document pins the collector bytes with SHA-256 subresource integrity; the collector also checks a document/disclosure contract. The HTML supplies a harmless fallback so rejected or missing adapters cannot block comparisons. Updating the adapter requires refreshing the hash. Contract changes and tests must accompany material scope changes. This prevents mismatched protected revisions; it cannot retrofit checks into an already-running older unprotected document.

Hosted reporting is disabled pending [account verification](usage-account.md). The prior temporary-visit-only wording was incomplete. Details now distinguishes receipt of IP/headers from configurable retained metadata and makes the verification gap explicit. This clarification does not turn scope 2 into permission for expanded data. Before activation, settle the actual settings, operator/contact and retention, then assess and version the final disclosure; renew Yes if it adds materially different processing.

## Changing scope

1. Identify the actual purpose, data categories, recipients and privacy effects of the proposed metrics; review whether the existing description really covers them.
2. For a material expansion, add a new scope section here, update the invitation, Details and user documentation, and increment `_USAGE_CONSENT_VERSION` together with the collection change. Never silently redefine a recorded scope.
3. A previous Yes becomes inactive until a new Yes for that scope. No stays off. Routine app releases leave the scope version alone.
4. Check old/current/future records, malformed data, cross-tab changes, no pre-consent replay and unchanged request payload privacy.

It is possible to describe a defined family of usage events, such as counts of which comparison tools are used, without listing every button identifier in the short invitation. That does not authorize arbitrary future collection. Scope 2 implements the bounded feature/reliability contract above. Additional purposes, recipients or data categories require another review; genuinely separate purposes may need separate choices.

Sources consulted for the design discussion (not a jurisdiction-specific legal opinion): [ICO: valid consent](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/), [EDPB: lawful processing guide](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en). Their guidance calls for specific purposes, understandable information about data and processing, and an easy way to withdraw. ICO explicitly cautions against sweeping language and treating silence as expanded consent. Scope 3 records the settled operator/contact and collection/retention configuration; a short invitation is not a complete privacy notice.

