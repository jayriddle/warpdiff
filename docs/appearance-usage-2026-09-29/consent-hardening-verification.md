# Adversarial analytics fixes — WarpDiff 3.18.10

Date: 2026-09-30. Working tree remains unpublished and uncommitted. Existing appearance/analytics work and the original adversarial report/evidence were preserved. No production count was sent and no account setting was changed.

**Outcome:** F1, F2, F4 and F5 are corrected and covered by behavioral regressions. Installed-client disclosure/collector mismatch protection is implemented and tested. F3 remains a publication prerequisite because authenticated account settings were unavailable. `_USAGE_ACCOUNT_VERIFIED = false` holds hosted reporting off; explicit loopback testing still works.

## Findings, changes and limits

| Finding | Resolution |
| --- | --- |
| F1: failed No save restores older Yes | Writing No first stops reporting and retires the review. If saving fails, try removing the older record. A local refusal latch prevents restoration within the current document. The UI distinguishes successful removal from failure of both operations. |
| F2: queued No → Yes revives old work | Every consent-key storage notification, regardless of its value, invalidates the prior context before reading the current saved choice. This deliberately processes each transition rather than coalescing them into the latest Yes. A decision generation also fences operation tickets. Explicit decisions invalidate the previous generation too. |
| F3: incomplete provider disclosure | Removed the temporary-visit-only account of header processing. Details and documentation distinguish receipt from configurable retained metadata. Actual enabled categories, retention, operator/contact and account visibility are still unverified. Hosted reporting is held disabled; the verification list and activation procedure are in [usage-account.md](../usage-account.md). |
| F4: top-level host startup leak | Saved Yes alone never dispatches a visit. Explicit Yes or an accepted manual file load establishes standalone use. An accepted host load permanently disables reporting for the document and aborts requests before capability negotiation or media work. No timeout guesses ownership. |
| F5: N restores W and reports adoption | Automatic N-mode hide/restore calls apply the audio-panel state without reporting an explicit W action. Actual toolbar/keyboard openings retain their existing count. |

**Withdrawal limit:** when both consent writing and old-record removal are rejected, no durable change has occurred. The warning explicitly says the old permission could return and asks the user to clear site data before reopening. Tests verify current-page refusal even after an unrelated storage notification, and separately verify that a reload plus manual load can still use the old Yes in this all-failed case. This limitation is disclosed, not claimed to be fixed by an in-memory latch. With successful removal, reload and subsequent loads remain silent until fresh consent.

**Launch/counting consequence:** `/` now means an engaged standalone launch, not every opening of WarpDiff. A saved Yes waits for manual loading; explicit Yes can start the visit without loading files. All host-loaded documents are excluded, including non-managed host loads, once the host request is accepted. A document already explicitly used standalone may have reported before a later host takeover; aborting cannot retract delivery. Hosts must identify their launch before exposing standalone load/opt-in actions. The regression exercises the real same-origin managed message, required labels, valid image, ready result and zero requests with saved consent. A second test proves pending-request cancellation on later host takeover.

Scope 2 is retained because these code fixes narrow collection and add no categories. It does not authorize appearance-choice reporting or arbitrary metadata. Before hosted activation, reconcile the final account-specific disclosure with accepted scope and renew consent for materially expanded processing.

## Partial update protection

- HTML contains a harmless fallback implementing the usage hooks and pins `js/usage.js` with SHA-256 subresource integrity. Rejected/missing collector bytes leave comparisons usable and sharing disabled, with an explanatory status.
- The collector checks a matching document/disclosure contract. New adapters cannot activate under a mismatched document even if script integrity succeeds.
- Ownership guards verify the current file's exact integrity hash and matching contract. Every adapter edit must refresh the HTML hash.
- A new test runs the actual service worker against a local HTTP server. It installs a matching predecessor variant, warms its cache, serves newer HTML while the adapter network request fails, recovers to a coherent update, then repeats in the downgrade direction. Both mismatches block reporting while a real image review works. A separate incompatible-disclosure case passes integrity but remains silent. No collector URL enters Cache Storage; there are no page JavaScript exceptions.
- These are controlled variants of the current implementation, not a byte-for-byte reconstruction of unpublished historical adapters. This protection does not make all app assets atomic, and cannot retrofit checks into an already-running old document lacking the protection.

## Verification and meaningful failed checks

All count requests in production-branch browser tests are fulfilled locally by interception. Unknown external requests are denied. Most production regressions explicitly simulate the future verified flag and refresh the fixture's integrity hash; a separate test runs the shipped false flag and checks that saved Yes cannot report. The installed-worker test uses a loopback server and an unreachable external proxy. Local screenshots use disposable contexts. The real user browser's consent preferences were not changed.

| Check | Result / evidence |
| --- | --- |
| Six new adverse-schedule/storage/counting tests before fixes | **6 failed**, reproducing both F1 storage cases, related-window and iframe F2, F4 startup, and F5 restoration. [Log](consent-hardening-evidence/regressions-before.txt) |
| Same six immediately after fixes | **6 passed, 3.7 s, no retries.** [Log](consent-hardening-evidence/regressions-after.txt) |
| Appearance + production tests before final publication hold | **46 passed, 24.9 s.** [Log](consent-hardening-evidence/focused-before-publication-hold.txt) |
| Real service-worker update test | **1 passed, 2.0 s.** [Log](consent-hardening-evidence/installed-update.txt) |
| Full browser suite after code fixes/update protection | **309 passed, 1 skipped, 2.6 min, two workers, no retries.** The skip is the existing timestamp-collision placeholder. This run preceded the final hosted-disable flag and provider-wording edits. [Log](consent-hardening-evidence/full-suite.txt) |
| First focused run after final hold/wording edits | **48 passed, 1 failed.** The sole failure expected the old text “not connected” while the UI now said “unavailable.” Corrected the stale assertion. [Log](consent-hardening-evidence/final-focused-stale-wording-failure.txt) |
| Final focused run | **49 passed, 24.9 s, two workers, no retries.** Includes the shipped-off configuration and explicit reload limit when both withdrawal persistence operations fail. [Log](consent-hardening-evidence/final-focused.txt) |
| Ownership / pure logic | **444 passed, 0 failed.** [Log](consent-hardening-evidence/ownership.txt) |
| Whitespace | `git diff --check` passed. |

Screenshots: [old permission successfully removed](consent-hardening-evidence/withdrawal-old-permission-cleared.png); [both storage operations unavailable](consent-hardening-evidence/withdrawal-storage-unavailable.png). The latter was visually inspected at 1280×800: the warning wraps within the privacy panel and its actions remain visible. No appearance or media-rendering behavior was changed in this hardening pass.

## Remaining work before hosted reporting

The GoatCounter dashboard opened at its sign-in form. The user was asked to sign in; no authenticated settings were inspected. Complete [the account record](../usage-account.md), finalize the actual disclosure/retention/contact information, decide whether renewed scope is needed, and only then enable the verified flag and refresh integrity. Provider documentation was rechecked, but it does not establish this account's settings or deployed version.

No live hosted acceptance/aggregation test, Safari/Firefox run, native WarpCap launch, actual BFCache restoration, or historical installed-release migration was performed. No commits, pushes or deployment occurred. The original adversarial report remains valid historical evidence; this record documents the subsequent fixes and their bounded verification.
