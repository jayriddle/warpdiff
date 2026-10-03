# Account configuration and consent scope 3 — 2026-09-30

Jay completed the remaining setup decisions: operator **Jay Riddle**, public privacy contact **warpdiff@gmail.com**, browser/OS, country and sessions enabled, region/referrer/screen size disabled, language and individual-pageview storage kept disabled, and **365-day retention**.

## Account action and evidence

Codex applied the approved changes in the authenticated GoatCounter settings page in Safari. The page returned **Saved!** and the approved values. Following its Settings link independently loaded the saved configuration: browser/OS, country and sessions on; region, referrer, screen size, language and individual pageviews off; retention 365 days. Dashboard access remained limited to logged-in users and the public counter remained disabled. The unused region-country filter was left intact while region collection is disabled.

The first save attempt was interrupted by reloading before the response completed. Safari displayed a form-resubmission warning. Codex canceled that warning and navigated to the settings URL; it still showed the original settings. The full approved configuration was then reapplied and saved, and the successful response and subsequent independent settings navigation were verified. No form resubmission or purge was performed. No hosted count event was sent.

The [account record](../usage-account.md) preserves the original values, final configuration, operator/contact, and remaining provider uncertainty. Setting retention does not verify that a deletion job has run. The hosted deployment version and exact session-storage lifecycle remain unverified; no unconditional RAM-only or eight-hour maximum promise is made.

## Local integration

- Finalized the expandable privacy Details, in-app Manual/Getting Started and README, FEATURES and MANUAL to describe actual browser/OS and country statistics, private dashboard access, configured retention and contact. The bounded short invitation remains unchanged.
- Incremented consent scope from 2 to **3**. Earlier Yes records require another explicit Yes; all saved No records stay off. No earlier or paused activity is replayed. No appearance metrics or new feature events were added.
- Matched the HTML and adapter contract at `3.18.11/scope-3` and refreshed the adapter SHA-256 integrity hash.
- Enabled the verified production configuration **in the local working tree**. Reporting still requires the official hostname, current consent, explicit standalone engagement and the existing online/host/automation gates. Local test mode stays isolated. No commit, push or deployment occurred.

## Verification

The first focused browser run encountered two timeout failures: the theme-persistence test and production consent-reload test had stale `lastSeenVersion=3.18.10` fixtures. Reloading the current 3.18.11 app displayed What's New over their click targets. The run was stopped after these failures rather than waiting through further repetitions. The fixtures now derive the actual app version. The production release-path expectation was also changed from a hardcoded version to the actual app version. The [initial log](account-activation-evidence/initial-focused-tests.txt) is retained.

The final run used two Chromium workers with **no retries**:

- **51 browser tests passed in 25.0 seconds**, including two new checks for exact provider disclosure before consent and scope-2 Yes → scope-3 review → fresh Yes without replay. Existing cases covered withdrawal persistence failures, queued cross-tab No → Yes, host startup, restored W state, offline exclusions and real-service-worker partial updates/downgrades. [Final log](account-activation-evidence/focused-tests.txt).
- **444 ownership/pure-logic checks passed, 0 failed**, including document/adapter contract, integrity and app/cache version alignment. [Log](account-activation-evidence/ownership.txt).
- The expanded privacy panel fit within **1280×800 and 390×800** viewports without horizontal overflow. The mobile screenshot was visually inspected; the panel scrolls for the remaining details and choices. [Desktop](account-activation-evidence/privacy-1280.png), [mobile](account-activation-evidence/privacy-390.png).
- `git diff --check` passed.

Production browser tests intercepted every request using local files and a mock collector. The installed-update fixture blocked external destinations with an unreachable proxy. Screenshot checks blocked non-local destinations. These checks do not prove hosted acceptance or aggregate dashboard behavior.

The unrelated full media suite was not repeated for this configuration/disclosure change. Safari was used for account settings, not a separate app-behavior run; Firefox, native WarpCap, actual BFCache and historical unprotected installed releases were not newly verified.

## Remaining release work

There are no outstanding operator/contact, retention or collection-choice decisions. The working tree is ready for release review, subject to the broader repository changes. Publication and a deliberately consented hosted dashboard smoke test remain separate actions; neither was performed here. A local sender or opaque response cannot establish hosted delivery.
