# Final adversarial review — WarpDiff 3.18.12, consent scope 4

Reviewed 2026-10-01 against the complete working tree at `/Users/jay/Documents/warpdiff`, including untracked implementation, tests and records. **Recommendation: HOLD release signoff until F1 is corrected and its pending-request regression passes.** F2 is a nonblocking documentation correction. No high-severity consent replay or payload disclosure defect was reproduced in the protected candidate.

The hold is narrow: Clear meets the context/ticket invalidation requirement but does not retire existing collector fetches. This is a bounded lifecycle cleanup defect, not evidence of reporting after No, collecting undisclosed dimensions, or reviving a pre-consent review.

## Candidate identity and preservation

AGENTS.md was read first, followed by the final candidate verification, previous adversarial report, consent-hardening and account-activation records, usage-consent/events/account documents, relevant implementation and tests. The actual files agree:

| Surface | Verified value |
| --- | --- |
| `index.html:3784` / README release | `3.18.12` |
| `sw.js:2` | `warpdiff-v3.18.12` |
| `js/usage.js:11` | consent scope `4` |
| `index.html:3750` / `js/usage.js:17` | `3.18.12/scope-4` |
| `index.html:3762` / SHA-256 of actual adapter bytes | `sha256-bO8wwElt9RcaGKWiHC6ShtHcLylTtGpLt0r71tDFg/A=` |
| Production configuration | fixed GoatCounter endpoint; `_USAGE_ACCOUNT_VERIFIED = true` |

The review preserved **2,138 original files**, including ignored fixtures/dependencies and **309 tracked or untracked repository files**. No original content was changed or removed; no unexpected workspace files appeared outside this report and evidence directory. HEAD remains `761d694fb38a62f299f233ce41eeabc2190a5183`, branch `codex/shared-scrub`; refs, HEAD and index hashes are unchanged. See [before inventory](final-adversarial-evidence-2026-10-01/preservation-before.json), [after verification](final-adversarial-evidence-2026-10-01/preservation-after.json) and [environment](final-adversarial-evidence-2026-10-01/environment.json).

No implementation, existing test, browser-profile preference, account setting, commit, branch or deployment was modified. New executable probes are evidence harnesses only. Disposable copies were removed, browser contexts closed, and owned servers/proxies stopped; the preexisting port-8080 server was left alone. [Cleanup record](final-adversarial-evidence-2026-10-01/cleanup.json).

## Confirmed defects, in priority order

### F1 — Medium / P2: Clear leaves collector requests alive

**Precise locations:** [js/usage.js](../../js/usage.js), line 280, `resetComparison`; lines 69–74, the existing `abortPending` owner; lines 94–104, controller creation, timeout and settlement. [index.html](../../index.html), line 10911, `clearAllMedia` calls `resetComparison`; lines 11184–11187, the confirmed Reset button routes into that owner.

**Minimal reproduction:**

1. In a disposable, intercepted official-origin context, save a dated scope-4 Yes.
2. Make the local collector delay its response for 1,200 ms. Load two valid PNGs and wait for the ready comparison/workspace requests.
3. Click the real Reset button and accept its confirmation.
4. Inspect the existing fetch signals 150 ms later, then allow the delayed responses to finish.

Run the self-contained [Reset-button reproduction](final-adversarial-evidence-2026-10-01/reset-button-proof.cjs) with Node; its mock never opens an upstream connection. The more general lifecycle probe also reproduces this through the real `clearAllMedia()` function.

**Expected:** the Clear boundary retires the old reporting context, tickets **and pending fetches**, using the same cancellation owner as withdrawal, offline, pagehide and host activation.

**Observed:** all **five** prior requests remained pending and un-aborted after Reset, despite the comparison being cleared and the landing screen returning. They subsequently settled without cancellation. The five requests were `/`, `load-attempt-image-2`, `comparison-image-2`, `comparison-active`, and `workspace-wide-tall-image-2`. Both independent lifecycle runs measured **0/5 aborted**; the UI Reset reproduction confirmed the same behavior. Equivalent delayed-request cases for withdrawal, offline, pagehide and host activation aborted their prior fetches.

**Impact and bounds:** Clear retains the old requests and their in-flight capacity until response or the existing three-second timeout. Their network work can finish after the comparison is gone. Old readiness, feature contexts and analysis/preview/Continuous tickets were nevertheless permanently invalidated. These requests were authorized and dispatched **before** Reset; the mock had already received their headers. This is not proof of a new post-Clear dispatch, reporting after refusal, or an ability to retract a received count. Saturation of the 64-request cap was not measured.

**Suggested correction:** keep epoch advancement and route Clear through the existing `abortPending()` owner, so it also aborts and clears the old controllers. Add a behavioral pending-request assertion for the confirmed Reset action alongside the existing context/ticket assertions. Refresh the adapter's HTML integrity hash after any adapter edit, then verify the targeted lifecycle and installed-update cases. No fix was made during this review.

**Evidence:** `pending fetch cancellation: clear` in [initial results](final-adversarial-evidence-2026-10-01/adversarial-results.json) and [targeted follow-up](final-adversarial-evidence-2026-10-01/followup-adversarial-results.json); [actual Reset observations](final-adversarial-evidence-2026-10-01/reset-button-proof.json) and [log](final-adversarial-evidence-2026-10-01/reset-button-proof.txt). The adjacent `context and ticket retirement: clear` case passes, preserving the distinction between invalidation and transport cancellation.

### F2 — Low / P3: the updated planning catalog still says single-item reviews are unimplemented

**Precise location:** [docs/usage-measurement-catalog.md](../usage-measurement-catalog.md), line 183. It says, “Current code counts only 2–4-item comparisons,” and describes single-item reporting as a future implementation change. This contradicts its current-scope header at line 3 and implemented rows at lines 54–55.

**Minimal reproduction:** opt in under scope 4 and load one valid image. Compare its received requests with line 183.

**Expected:** descriptions of the current ready-review population include item counts 1–4, consistent with the authoritative event contract and actual adapter.

**Observed:** the local HTTPS mock receives `v3.18.12/comparison-image-1` and `v3.18.12/workspace-wide-tall-image-1`, while the catalog says that population is not collected.

**Impact:** a reader following this paragraph can exclude valid single-item reviews when interpreting workload or workspace denominators. The README, manuals, disclosure and authoritative event contract correctly describe 1–4; this is not a disclosure expansion or runtime defect.

**Suggested correction:** replace the obsolete present-tense sentence with the implemented 1–4 behavior, or explicitly label it as scope-1 history. Keep deferred proposals distinct from already implemented statistics.

**Evidence:** `workspace context image-1` in [follow-up observations](final-adversarial-evidence-2026-10-01/followup-adversarial-results.json), with corresponding [wire receipts](final-adversarial-evidence-2026-10-01/followup-wire-requests.jsonl). The unchanged catalog text is preserved by the original-file inventory.

## Confirmed protections and behavioral coverage

The principal consent and payload protections passed. These observations combine the independent probes with the existing release suites; direct API fault injection is distinguished from real loading/UI behavior.

| Question | Measured behavior / evidence |
| --- | --- |
| Scope-1/2/3 Yes | Each stayed silent at startup, during actual image loading and old feature/diagnostic attempts. Explicit scope-4 agreement produced only the engaged visit until a new load; no earlier comparison or workspace sample replayed. Three independent renewal cases. |
| Legacy and any-version No | Nine records, including legacy string No, old/current/future/negative/missing/string scope values, stayed off without invitation renewal. Reload and actual file loading remained silent. |
| Failed No write with readable Yes | Both cleanup branches exercised through the real buttons. Successful removal kept later reload/loading silent. Failed removal retained the old readable Yes, but the current document stayed off through further loads and storage notifications, with a truthful warning. |
| Rapid No → Yes | A related top-level window clicked both choices in one task; a same-origin iframe wrote both values before the receiving page handled them. Both notifications were observed. Old loupe/scrub contexts and all three operation-ticket families remained silent; new loads could count. |
| Workspace boundaries | All eight combinations of widths 759, 760, 1,199, 1,200 with heights 599/600 produced their prescribed fixed labels. Exactly six category names occurred across actual receipts. |
| Sampling lifetime | Resizing, duplicate readiness and loupe activation did not resample. New reviews could sample again. Actual video playback/pause did not add a workspace sample. Image item counts 1/2/3/4, plus video and audio, retained the existing context suffix. |
| Incomplete and canceled loading | An actual second image decode was held at its promise boundary. No comparison/workspace event appeared while incomplete. Finishing normally counted once; Clear before release did not count; renewal or offline completion did not revive the old load. |
| Failed/rejected loading | Empty picker input sent nothing. A genuine corrupt PNG produced a fixed failed-load label, with no ready/workspace count or filename in its payload. |
| Offline and reconnect | Real context offline transitions retired contexts/tickets. Already-offline blob loads remained unreported after reconnect; a new eligible load could count. |
| Launch ownership | Saved Yes alone remained silent before top-level managed **and non-managed** host loading. A real same-origin host message reached ready without a count. Iframe loading stayed excluded before/after host negotiation. Later manual-input attempts did not enable a host-owned document. |
| Late host takeover | An explicitly accepted standalone load before host identification emitted its legitimate five requests. Subsequent host takeover stopped further reporting. This is distinct from excluded host startup; delivered standalone requests cannot be retracted. |
| Other lifecycle boundaries | Withdrawal/re-consent, offline/reconnect and dispatched pagehide/pageshow events did not revive old contexts or tickets. Delayed requests were canceled at withdrawal, offline, pagehide and host activation. Clear's cancellation exception is F1. |
| Invalid dimensions / injected labels | NaN, infinity, zero, negative and numeric-string width/height measurements skipped workspace events. Arbitrary feature, surface, operation, outcome, type/count and modified-ticket labels did not escape the fixed sender vocabulary. These are explicit API-boundary attacks, not ordinary browser dimensions. |
| User access | Actual privacy-button clicks and withdrawal succeeded during ready 320×599 and 390×599 comparisons. Expanded Details fits within the scrolling panel. Ignoring the invitation stored only its separate dismissal boolean, never consent. All five appearances remained available without reporting. |

See [independent probe source](final-adversarial-evidence-2026-10-01/adversarial.cjs), [initial observations](final-adversarial-evidence-2026-10-01/adversarial-results.json), [targeted follow-up](final-adversarial-evidence-2026-10-01/followup-adversarial-results.json), and [narrow-window screenshot](final-adversarial-evidence-2026-10-01/narrow-privacy-390.png). The [all-persistence-failed warning](final-adversarial-evidence-2026-10-01/withdrawal-cleanup-true.png) and narrow panel screenshot were visually inspected.

The prior adversarial F1/F2/F4/F5 regressions all pass in the existing production suite: failed withdrawal, queued consent decisions, top-level host startup and N restoring W without deliberate-use attribution. The old disclosure finding is addressed by the current notice **relative to recorded account settings**, not by fresh provider inspection in this review.

## Actual transport observations

Production-host pages used unchanged working-tree bytes, fulfilled locally. A disposable context's `navigator.webdriver` value was overridden to exercise the human production branch; the existing suite separately checks the automation exclusion. The collector hostname's TLS connection terminated in a local mock. Every other external destination was denied; the mock has no forwarding path. Synthetic cookies, private page query/fragment values and private media names were deliberately present.

The initial probe recorded **334 locally received HTTPS requests**, including a dedicated five-request header inspection. [Wire receipts](final-adversarial-evidence-2026-10-01/wire-requests.jsonl) contain actual method/query/headers, not merely calls to the adapter or Playwright's request event.

| Surface | Observed |
| --- | --- |
| Method / fields | GET; only `p`, `t`, `e`, empty `r`, fresh `rnd`, optional `ns` |
| Workspace | `v3.18.12/workspace-<narrow/medium/wide>-<short/tall>-<media>-<1/2/3/4>`; `ns=true` |
| Excluded application data | No exact dimensions, screen resolution, window position, resize history, adjacent-app data, filename/content, raw error, decision timestamp, consent record, URL query/fragment or stable review/user identifier |
| Credential/referrer handling | No Cookie despite a seeded collector cookie; no Referer, Authorization or Origin header |
| Browser-added headers | User-Agent, Chromium/platform/mobile client hints, `Accept-Language: fr-CA`, Accept/encoding/cache and Sec-Fetch headers |
| Network address | Loopback at the mock; this does not model a hosted user's actual address |

The adapter's six labels do not disable provider processing of received IP/header information. The absence of Cookie or query identifiers does not mean the recipient receives no identifying network information. Header observations are specific to Chromium 145 on this macOS environment, not every browser. No request went to live GoatCounter.

## Partial PWA updates

The existing installed-client test passed in the full suite. The additional [real-worker probe](final-adversarial-evidence-2026-10-01/pwa-probe.cjs) used a loopback HTTP server, a real installed/controlling service worker, actual Cache Storage and locally received collector requests. It did not use route interception for these worker tests.

The predecessor was an explicitly **synthesized protected scope-3 variant** of current code: contract/version/scope/hash/cache-name changes and removal of workspace emission in server responses. It is not historical 3.18.11 release bytes. Candidate responses used the actual candidate source and integrity hash.

| Final stage | Result |
| --- | --- |
| Warm coherent protected predecessor | Reporting worked under its scope; no workspace event; predecessor bytes verified in Cache Storage. |
| Fresh candidate HTML / cached predecessor, adapter fetch failure and worker-update attempt | Sharing unavailable; zero collector receipts; real image comparison remained active. |
| Coherent candidate recovery | Scope-3 Yes stayed paused; explicit scope-4 Yes did not replay the preceding load; a new comparison sampled once. |
| Downgraded HTML / cached candidate adapter, failed refresh | SRI blocked reporting; comparison remained usable. |
| Coherent protected downgrade | Newer saved scope-4 Yes could not authorize scope-3 reporting. |
| Matching integrity / incompatible disclosure contract | Reporting stayed off. |
| Successful corrupted adapter response | SRI rejected the bytes; reporting stayed off. |
| Failed refresh reusing corrupted cached adapter | Still silent and usable. |
| Coherent recovery / cache inspection | Reporting resumed for eligible work; no collector URL appeared in any inspected cache. |

All **nine** final stages passed; all stages were service-worker controlled; no page JavaScript exception occurred. [Results](final-adversarial-evidence-2026-10-01/pwa-results.json) retain cache inventories, adapter hashes, server request journals and expected SRI/network console errors. The local collector received 18 requests across the coherent phases. Blocked phases received zero.

The runtime allowlist also excludes the remote collector in source; the actual Cache Storage check exercised the loopback collector. This is not a hosted GitHub Pages/PWA migration test. Individual assets remain network-first rather than atomic. The contract/SRI fence protects the analytics pair, not every app asset. No precise claim about which worker became redundant is needed: the recorded worker-update attempt and failed refresh produced the protected mixed-byte conditions directly.

## Disclosure and counting interpretation

The invitation, expanded Details, README, FEATURES, Markdown/manual and in-app/manual/Getting Started descriptions align with the tested collection: visits after standalone engagement, 1–4-item ready reviews, explicit feature counts, scrub thresholds, fixed reliability categories and one broad workspace sample. They name Jay Riddle and `warpdiff@gmail.com`, make sharing optional, retain appearances without consent and explain no replay, withdrawal and persistence failure. Tablet wording explicitly says touch support is limited and recommends keyboard/mouse or trackpad; it does not promise comprehensive touch support. The planning-catalog exception is F2.

The account configuration was **not freshly inspected**. The existing `docs/usage-account.md` record reports read-only rechecking on 2026-10-01: browser/OS, country and sessions enabled; region, referrer, built-in screen-size, language and individual-pageview collection disabled; private dashboard; 365-day automatic deletion configured. The notice describes that recorded configuration. GoatCounter's disabled built-in screen-size category is expressly distinguished from WarpDiff's six workspace events.

The authoritative event contract correctly limits interpretation:

- Sampling occurs at readiness, not continuously or over the remaining media area. Categories are layout groups, not device types or proved usability thresholds.
- Workspace and comparison requests can be lost independently. For matched release/media/item populations, category shares should use delivered workspace counts; ready comparisons are a separate workload denominator.
- Opted-out/offline/host-owned use is unobserved. These counts cannot estimate all users, an opt-in rate, exact daily people or satisfaction.
- `load-attempt − comparison` includes cancellation, incomplete work, consent changes and delivery loss, not only failures. Reliability categories can overlap.
- Visits are unversioned engaged launches. Participation lacks a media/item cohort and relies on the provider's recorded session setting. Neither is a universal matched denominator for release-specific features.

## Accepted limitations and remaining uncertainties

**Accepted limitations:** if writing No and removing the prior Yes both fail, durable storage still contains Yes. Current-page refusal and a clear warning are the available guarantees; a reload plus manual loading can again use the unchanged record. This was intentionally reproduced and is not scored as a defect. A late host takeover cannot retract earlier explicitly standalone traffic. Candidate protections cannot retrofit an already-running older unprotected document; historical vulnerabilities in the prior review must not be represented as current protected behavior or as fixed inside those old executions. Best-effort delivery and independently lost denominators remain as disclosed.

**Uncertainties / coverage gaps:** no live dashboard count, hosted acceptance, bot filtering, repeat suppression, ignore-IP behavior, aggregation or retention-enforcement result was tested. Recorded settings are configuration evidence, not observed deletion jobs or proof of the hosted provider version/session-storage implementation. No hosted WarpDiff bytes were fetched during this review. Firefox and WebKit binaries were absent; no software was installed. This review freshly exercised Chromium only, not native Safari, native WarpCap, tablet hardware or comprehensive touch interaction. Earlier Safari smoke results remain historical records, not new coverage. Pagehide/pageshow were dispatched lifecycle events; actual BFCache restoration, frozen/crashed tabs and browsers that delay/drop storage notifications were not proved. Exact historical unpublished HTML/adapter pairs were unavailable; worker variants were controlled reproductions. No legal-compliance conclusion follows from these tests.

## Exact verification results and retained failures

Existing tests were unchanged. Browser suites ran from a disposable full working-tree copy because the suite writes PNG fixtures. The final copy preserved bytes **and timestamps**, which matter to WarpDiff's slot ordering. All automated suite retries were disabled.

| Run | Exact result / resolution |
| --- | --- |
| First suite attempt, wrong review-server index handling | 1 passed, 39 failed, 2 interrupted, 284 did not run; interrupted after identifying a directory listing at `/`. Review server corrected. [Log](final-adversarial-evidence-2026-10-01/initial-harness-full-suite.txt), [results](final-adversarial-evidence-2026-10-01/initial-harness-full-suite-results.json). |
| First full run against the app, copy timestamps lost | 319 passed, 6 failed, 1 existing skip; 164.052 s; zero retries. Failure evidence showed swapped Mono/Stereo and short/long slots because copied fixture modification times changed. Corrected the copy operation, not tests or app. [Log](final-adversarial-evidence-2026-10-01/timestamp-copy-full-suite.txt), [results](final-adversarial-evidence-2026-10-01/timestamp-copy-full-suite-results.json). |
| Final full Chromium suite | **325 passed, 1 existing skip, 0 failed, 0 flaky; 152.718 s; two workers; zero retries.** Includes 46 appearance/usage, 13 production and 1 real installed-update test. [Log](final-adversarial-evidence-2026-10-01/full-suite.txt), [JSON](final-adversarial-evidence-2026-10-01/full-suite-results.json). |
| Ownership in disposable copy | 442 passed, 0 failed; two optional neighboring WarpCap canonical-source checks were absent in the copy. |
| Original read-only ownership harness | **444 passed, 0 failed**, including those two neighboring-source checks. [Log](final-adversarial-evidence-2026-10-01/ownership-original.txt). |
| Independent adverse browser probe | 50 passed, 6 failed across 56 cases. Five were review-harness timeouts from requiring Grid's layout-ready flag for single-item Stack and expecting manual loading after managed host activation. One was F1. [Initial source](final-adversarial-evidence-2026-10-01/adversarial-initial.cjs), [log](final-adversarial-evidence-2026-10-01/adversarial.txt). |
| Targeted adverse follow-up | 5 passed, 1 failed across the six cases; overstrict harness waits removed. F1 repeated unchanged. Across distinct cases, **55 passed, one confirmed cancellation failure**. [Log](final-adversarial-evidence-2026-10-01/followup-adversarial.txt). |
| Real Reset-button confirmation | The observation check passed while confirming the defect: five prior fetches stayed alive after confirmed Reset and completed later. It is not a passing cancellation regression. |
| Extended worker probe, first attempt | 6 passed, 3 failed. The synthesized predecessor's What's New backdrop intercepted its initial consent click; two dependent assertions consequently had no saved Yes. Initial source/results/log retained. [Initial results](final-adversarial-evidence-2026-10-01/initial-pwa-results.json). |
| Extended worker probe, corrected interaction schedule | **9 passed, 0 failed**, after dismissing the dialog in the disposable page and accounting for the existing per-document visit. No candidate edit. [Log](final-adversarial-evidence-2026-10-01/pwa-probe.txt). |
| Whitespace / original-file preservation | `git diff --check` exit 0; all 2,138 original files and Git controls unchanged. |

The existing skip is the timestamp-collision placeholder, not a newly skipped release case. The initial system Python command also failed on the macOS Xcode-license shim; the already-bundled Python was used without changing licenses or machine settings. [Setup/failure record](final-adversarial-evidence-2026-10-01/setup-failures.txt) preserves the resolutions. The six media failures were fully resolved by timestamp preservation, so no unrelated media implementation issue was reopened.

Deployment remains a separate action. Complete F1's bounded cleanup correction and a true passing cancellation regression before signing off this candidate; F2 can be corrected with the documentation. Local receipts and successful suites do not establish hosted dashboard acceptance, retention enforcement or legal compliance.
