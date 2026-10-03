# GoatCounter account verification — publication prerequisite

Status on 2026-10-01: **approved collection settings saved and verified on 2026-09-30 and rechecked read-only on 2026-10-01; operator, contact and 365-day retention confirmed. Scope-4 integration prepared locally. Publication and hosted delivery remain unverified.**

The destination is `https://warpdiff.goatcounter.com/count`. The initial in-app-browser attempt reached a sign-in form. After Jay reported signing in, the authenticated account was located in Safari. The initial read-only inspection on 2026-09-30 found “No data received” and zero visits. Later, after Jay explicitly selected the collection settings and 365-day retention, Codex saved them in the same authenticated settings page. No test count was sent. Credentials and the sign-in email are intentionally not recorded here; the separately supplied public privacy contact is recorded below.

## Initial inspection — before approved changes

The values below were read from the authenticated settings controls, not inferred from provider defaults. They describe the account at inspection time, not a verified ingestion or deletion result.

| Item | Actual account value |
| --- | --- |
| Browser and operating-system collection | Enabled (User-Agent checkbox) |
| Country collection and selected regions | Country enabled; Region enabled for `US, RU, CN` |
| Language collection | Disabled |
| Session collection / repeat suppression | Enabled |
| Individual-pageview storage | Disabled |
| Referrer and campaign collection | Enabled at the provider; WarpDiff sends empty referrer and no campaign parameters |
| Screen-size collection | Enabled at the provider; WarpDiff does not supply screen dimensions |
| Data retention / automatic deletion period | `0` days; UI explicitly defines this as never automatically deleting |
| Dashboard public visibility / access | Only logged-in users |
| Public visitor-counter embedding | Disabled |
| Ignored IP addresses | Empty |
| WarpDiff operator identity | Jay Riddle — confirmed by Jay on 2026-09-30 |
| Public privacy-contact route | [warpdiff@gmail.com](mailto:warpdiff@gmail.com) — supplied by Jay on 2026-09-30 |
| Hosted provider version / session-handling clarification, if making implementation-specific promises | Unverified |

## Approved configuration — saved and verified

| Setting | Saved value | Reason |
| --- | --- | --- |
| Browser/OS | Keep enabled | Helps prioritize browser compatibility and reliability work. Explicitly disclose retained browser/OS counts. |
| Sessions | Keep enabled | Allows repeat suppression for visits and participation; still an estimate, not a daily census. |
| Country | Enabled — Jay confirmed on 2026-09-30 | Understand audience geography and potential localization needs; include country-level counts in the disclosure. |
| Region | Disabled | State/region detail is not needed for the current product questions. The dormant country filter remains `US, RU, CN`, but region collection is off. |
| Referrer and screen size | Disable both | The adapter does not provide them; align provider configuration with the documented exclusions. |
| Language and individual pageviews | Keep disabled | Avoid adding these retained categories. |
| Dashboard access and public counter | Keep private / disabled | Counts remain restricted to account users. |
| Retention | 365 days | Jay selected one year of retention. This verifies configuration, not an observed deletion job or a legal retention prescription. |

Jay confirmed all the settings above, the operator name Jay Riddle and the public privacy contact warpdiff@gmail.com on 2026-09-30. Browser/OS, country and sessions were already enabled; language and individual pageviews were already disabled. Codex disabled region, referrer and screen size, set retention to 365 days, and clicked Save. The returned page showed “Saved!” with the approved values. Following the Settings link loaded a fresh page that independently confirmed those values, private dashboard access and the disabled public counter.

The first save attempt was interrupted by a reload while the form was still submitting. Safari offered a form-resubmission alert; Codex canceled it and reopened the settings URL. That page still showed the original settings. Codex reapplied the full approved configuration, saved again, waited for the resulting Saved message, and verified a fresh page. No resubmission, purge, hosted test event or deployment was performed.

The 2026-09-30 configuration first used scope 3 to clarify provider processing. On 2026-10-01, scope 4 added one coarse window-width/height group per ready review. No appearance-choice events were added; exact dimensions and resize history are excluded. GoatCounter’s screen-size checkbox remains off.

Provider paragraph for the verified configuration:

> If you agree, WarpDiff sends fixed usage and reliability counts to its GoatCounter account to help Jay Riddle improve the tool. GoatCounter receives your IP address and browser headers to process requests and distinguish repeat visits, and retains browser, operating-system and country-level counts. GoatCounter’s built-in region, language, referrer, screen-size and individual-pageview collection are disabled. WarpDiff separately reports one broad window-size group per ready review, without exact dimensions or resize history. The dashboard is private, and its statistics are configured for automatic deletion after 365 days. No media, filenames or raw errors are sent. Privacy questions: [warpdiff@gmail.com](mailto:warpdiff@gmail.com).

This paragraph complements the existing exact event categories, local consent storage, withdrawal and no-replay explanation. It makes no unconditional RAM-only or eight-hour maximum promise. The local working tree enables the verified production configuration, subject to current scope-4 Yes and all existing gates. This does not deploy it or prove hosted acceptance.

The [provider privacy policy](https://www.goatcounter.com/help/privacy) describes configurable aggregate metadata and optional individual-pageview storage. Receipt of an IP address or header is different from retaining statistics derived from it. Do not describe all processing as temporary visit distinction. The [sessions documentation](https://www.goatcounter.com/help/sessions) makes repeat suppression dependent on the site's session setting. Do not call participation session-deduplicated until that setting is verified.

The adversarial review identified differences between session documentation and one upstream source snapshot. We have not verified the hosted version or shutdown path. Do not promise an unconditional eight-hour maximum or exclusively in-memory session handling, and do not claim that the source proves hosted IP retention.

## Activation procedure

1. Inspect authenticated settings, record actual values above, and settle operator/contact information and retention. If changes are appropriate, describe the exact proposed settings before applying them.
2. Finalize the in-app Details, MANUAL, event contract and scope record to describe the actual enabled categories and retention. Browser/OS, appearance preferences and any other additional measurements are not silently authorized by scope 2. Assess the final processing against the previous notice; increment scope and renew Yes for a material expansion.
3. Update the HTML disclosure contract and collector contract together. Enable `_USAGE_ACCOUNT_VERIFIED` only once those prerequisites are met, and refresh the HTML's SHA-256 integrity value after changing `js/usage.js`.
4. Run ownership, consent/production and installed-update tests. Production tests use the shipped verified configuration in isolated intercepted pages; a separate test simulates the emergency disabled configuration.
5. Obtain publication authorization separately. A live dashboard smoke test, if authorized, is a separate step from local transport tests. No local test proves hosted aggregation, retention, bot filtering or ignore-IP behavior.

See [hardening verification](appearance-usage-2026-09-29/consent-hardening-verification.md) for the consent fixes and [release-candidate verification](appearance-usage-2026-09-29/release-candidate-verification.md) for scope 4 and the final checks.
