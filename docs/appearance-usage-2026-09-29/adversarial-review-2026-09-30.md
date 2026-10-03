# Adversarial analytics and consent review — WarpDiff 3.18.9

Reviewed 2026-09-30, consent scope 2. **Recommendation: do not publish the analytics implementation as it stands.** Five actionable findings follow. The highest priorities are durable withdrawal, consent-transition invalidation, and an accurate account-specific disclosure. The managed-view startup gap also needs a fix or a verified deployment constraint before claiming those viewers cannot report.

This was a review of the complete working tree, including its untracked implementation, tests, planning catalog and verification records. Repository HEAD was `761d694fb38a62f299f233ce41eeabc2190a5183`. AGENTS.md was read first. No implementation, existing test, preference in the user's browser, account setting, commit, push or deployment was changed. Only this report and its evidence directory were added. All 223 original tracked/untracked files were hash-checked for preservation.

Browser tests used disposable Chromium contexts, local files and intercepted requests. A deny-all proxy blocked external browser connections. A separate terminating HTTPS mock accepted the configured collector hostname locally, without any upstream connection, to inspect actual HTTP headers. **No live GoatCounter count event was sent.** Public documentation and source were read separately; the hosted WarpDiff account was not opened.

## Prioritized findings

### F1 — High: failed withdrawal persistence silently restores the previous Yes

**Locations:** [js/usage.js](../../js/usage.js), lines 120–131 (`choose`), 32–44 (`restoreConsent`), and 100–104 (status text); [docs/usage-consent.md](../usage-consent.md), line 64.

**Minimal reproduction, using the isolated official-origin fixture:**

1. Save a valid scope-2 Yes and load the app.
2. Fault-inject `Storage.prototype.setItem` to throw for `pref_usageConsent` while leaving reads available. Other writes keep working.
3. Click **Turn sharing off**. Inspect the saved record, then reload.

**Expected:** withdrawal stops reporting and cannot silently resurrect an older affirmative record. If persistence fails, the UI must accurately describe the limitation and try to invalidate the older Yes.

**Observed:** this page stops reporting, but storage still contains Yes. The UI nevertheless says “Your choice is remembered in this browser.” Reload sends another `/` request and reports sharing on. Evidence: `failedWithdrawal` in [adversarial-results.json](adversarial-evidence-2026-09-30/adversarial-results.json).

**Impact:** a user who explicitly withdrew can be reported again without another affirmative action. This is specifically a consent-write failure with a readable prior Yes; it is not a claim that a real browser quota condition was induced. The existing storage-failure test covers only invitation dismissal, not this case.

**Recommended fix:** track whether the consent write succeeded. On failed withdrawal, attempt removal/invalidation of the old affirmative record, preserve the in-document refusal against subsequent restoration, and display a truthful persistence warning if durable invalidation also fails. Exercise existing-Yes → failed-No-write → reload, including a failure of the cleanup operation. Do not promise durability when every available persistence operation fails.

### F2 — High: rapid withdrawal/re-consent in related tabs preserves the old review and tickets

**Locations:** [js/usage.js](../../js/usage.js), lines 144–150 (storage listener), 53–57 (invalidation), 159–189 (context/ticket checks); [docs/usage-events.md](../usage-events.md), line 22.

**Minimal reproduction:**

1. With consent, load a ready image comparison in tab A. Capture an operation ticket using `_usage.startOperation('analysis')` to represent delayed work.
2. Open tab B using `window.open(location.href)`. In B, invoke the existing No and Yes buttons consecutively in one task:

   ```js
   document.querySelector('#appearancePanel [data-usage-choice="no"]').click();
   document.querySelector('#appearancePanel [data-usage-choice="yes"]').click();
   ```

3. After A receives the storage notifications, enable its loupe with `toggleMagnifier()` and deliver `analysis-failed` on the captured ticket.

**Expected:** the withdrawal invalidates A's old review and ticket permanently. A new Yes may permit new loads, but cannot revive the preceding review.

**Observed:** A emits `v3.18.9/feature-loupe-image-2` and `v3.18.9/analysis-failed-image-2`. The handler ignores `event.newValue` and reads the final saved Yes for both notifications, so it never calls `abortPending`. The feature action used the real application function; the delayed diagnostic was deliberately injected at the ticket API. Evidence: `rapidRelatedTabs` in the observations.

**Impact:** consent boundaries do not reliably end a review's reporting lifetime; pre-withdrawal work can publish after re-consent. This is **not** evidence of requests while the final choice remains No. The independently opened-tab, frozen-tab and busy-tab variants did not reproduce the failure in this Chromium run; related top-level windows and a same-origin iframe writer did. That distinction is retained in the evidence.

**Recommended fix:** process withdrawal/removal/scope invalidation from each storage event's value, even if a newer Yes already exists. Introduce a consent-decision generation that invalidates contexts/tickets on relevant transitions, then reconcile the current stored choice. Test related windows, queued events and No → Yes before the receiving window handles either notification.

### F3 — High disclosure blocker: header processing is described only as temporary visit distinction

**Locations:** [index.html](../../index.html), lines 14017–14019; [MANUAL.md](../../MANUAL.md), line 19; [docs/usage-events.md](../usage-events.md), line 9; [docs/usage-consent.md](../usage-consent.md), lines 45 and 75.

**Minimal reproduction:** open the current expandable details, opt in in the isolated browser, and inspect the local HTTPS mock's request. Compare the notice with current GoatCounter documentation and its pinned count/settings source below.

**Expected:** the notice distinguishes unavoidable receipt of network headers from any retained browser/OS, country/region and language statistics, and describes the actual site's chosen collection and retention settings.

**Observed:** the notice says IP and headers are used temporarily to distinguish visits. The wire contains User-Agent, browser/platform client hints and Accept-Language. GoatCounter can derive and retain aggregates from these inputs and the network address; `ns=true` does not disable that collection. Current upstream defaults include browser/system and country/selected-region collection. Language collection and individual-hit storage are configurable and are not in those defaults. WarpDiff's actual account settings and deployed GoatCounter version were **not inspected**, so this review does not assert which derived statistics the hosted account currently retains.

**Impact:** the current disclosure gives an incomplete account of processing the provider supports and commonly enables. The confirmed defect is the notice/configuration gap, not proof of undisclosed data already stored in production. Browser/OS clarification is explicitly pending and should remain a publish blocker. Merely linking the provider policy does not tell users the actual site's settings.

**Recommended fix:** inspect and document the account's collection flags, session setting, individual-hit option, region settings, retention and operator/contact details. Either disable unneeded fields or explain the actual retained categories in Details and the overlapping documentation. Assess any materially expanded collection against the accepted scope and renew consent where required; do not reinterpret scope 2 as permission for arbitrary metrics. This review neither changes settings nor decides a legal basis.

### F4 — Medium: top-level managed viewers can send a visit before capability negotiation

**Locations:** [index.html](../../index.html), lines 5737, 5794–5800 and 13641; [js/managed-review.js](../../js/managed-review.js), line 2; [js/usage.js](../../js/usage.js), lines 48–51 and 134–157.

**Minimal reproduction:** in the intercepted official origin, preload standalone scope-2 consent, navigate a top-level viewer, then send a valid same-origin `WARPDIFF_LOAD` with `capabilities.managedReview: true`, a valid image and its required label.

**Expected:** a managed viewer sends no analytics, including when standalone consent already exists.

**Observed:** `/` is dispatched during startup. Only later does `_hostLoadBegin` establish managed mode. The managed media request subsequently reaches `ready`, and no subsequent review events are sent, but the initial visit already escaped the intended isolation gate. Evidence: `managedStartup`.

**Impact:** the exclusion depends on timing and origin. The leak requires a top-level document on the permitted production hostname with readable standalone consent. Actual iframe embedding remains excluded by `top !== self`; an app/loopback/other-origin WarpCap viewer also cannot use the production endpoint. This review did not establish which deployment the current WarpCap application uses.

**Recommended fix:** establish managed/standalone launch identity before usage setup and default an unresolved host-owned launch to reporting disabled. Abort pending usage requests when managed mode activates as defense in depth. Do not rely on a timeout to guess whether a host message will arrive. Add a saved-consent, top-level host-handshake test; the current embedded test covers an iframe only.

### F5 — Medium: restoring the W panel counts as deliberate audio-graph use

**Locations:** [index.html](../../index.html), lines 7148–7149 and 7444–7447; [docs/usage-events.md](../usage-events.md), lines 28 and 34.

**Minimal reproduction:** persist `audioVizVisible=true`, start a fresh consented video review so W is restored automatically, then press **N** twice to hide and restore video. Do not open W explicitly during that review.

**Expected:** restoring the prior panel state does not count as an explicit W-panel opening.

**Observed:** N's exit path calls `toggleAudioViz()`, which sends `feature-audio-viz-video-1`. The probe had no feature event before this restoration and one afterward. Evidence: `restoredAudioPanel`.

**Impact:** feature adoption is inflated by automatic restoration; video-visibility users are credited with a separate panel choice they did not make.

**Recommended fix:** separate user-triggered activation from state application/restoration, as the layout wrapper already does. Count only the explicit W action, and add the saved-W → new-review → N → N case to the behavioral suite.

## Actual transport and provider semantics

[wire-requests.jsonl](adversarial-evidence-2026-09-30/wire-requests.jsonl) contains four requests received by a local TLS endpoint impersonating the configured host for this disposable browser only. The mock never forwards connections. A collector-domain cookie was deliberately present in the test context; the page URL and media names contained synthetic private strings.

| Surface | Observed result |
| --- | --- |
| Method/body | GET; event data in query parameters, no media body |
| Parameters | `p`, `t`, `e`, empty `r`, fresh `rnd`; `ns=true` for load/review volume |
| Paths | `/`, `v3.18.9/load-attempt-image-2`, `v3.18.9/comparison-image-2`, `v3.18.9/comparison-active` |
| Privacy checks | No Cookie, Referer, Authorization or Origin header; no page query/fragment, filename, media contents, decision timestamp or local consent/dismissal value |
| Browser-added data | User-Agent with browser/platform tokens; `sec-ch-ua`, `sec-ch-ua-platform`, `sec-ch-ua-mobile`; `Accept-Language: fr-CA`; Accept, Accept-Encoding, cache headers and Sec-Fetch metadata |
| Network address | Loopback at this mock. A real HTTPS recipient necessarily sees its client's/proxy's network address; the adapter cannot remove that through query-field filtering |

This is Chromium 145 on macOS, not an assertion that every browser emits identical headers. Client hints and User-Agent are not precise measurements of the actual hardware or OS version. No screen dimensions or persistent client identifier were supplied. `rnd` is a per-request cache buster, not a stable identity.

Primary sources were checked on 2026-09-30. Upstream source was pinned to **`c031008a8d28c85b36708824f23b28957e7ed262`**, dated 2026-09-27. This is a reviewed source snapshot, **not a verified hosted deployment version**.

- [GoatCounter pixel API](https://www.goatcounter.com/help/pixel) documents the browser GET counting endpoint and fixed fields. [count.js at the pinned revision](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/public/count.js#L41) maps `no_session` to `ns`.
- [Count handler](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/handlers/count.go#L52) reads User-Agent and, when configured, IP-derived location and Accept-Language. Browser/system parsing is in [hit.go](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/hit.go#L284). [Settings defaults and flags](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/settings.go#L359) distinguish optional collection from the default configuration. Transporting headers does not establish that all optional fields are retained.
- The [provider privacy policy](https://www.goatcounter.com/help/privacy) describes retained aggregates and optional individual-hit storage. This is broader than WarpDiff's temporary-visit wording. Actual account retention, access/public visibility and optional settings remain unknown.
- [Sessions documentation](https://www.goatcounter.com/help/sessions) describes per-path repeat suppression and the account-level switch that disables it. In [memstore.go](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/memstore.go#L295), `ns=true` marks each accepted hit as a first visit without session association. Therefore the volume labels are defensible per-load/event counters; participation is session-deduplicated only if the site's session collection is enabled.

There is a provider-source uncertainty worth resolving before stronger privacy promises: the documentation describes in-memory sessions lasting up to eight hours, while the reviewed source refreshes last-seen and evicts by inactivity. It also serializes session mappings on graceful shutdown ([storage code](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/memstore.go#L128), [shutdown caller](https://github.com/arp242/goatcounter/blob/c031008a8d28c85b36708824f23b28957e7ed262/cmd/goatcounter/serve.go#L376)) and restores/deletes them on startup. Those mappings include the User-Agent/address/site key. I did not establish whether hosted GoatCounter runs this revision or uses this shutdown path. Do not assert that source proves hosted IP retention, or promise an unconditional eight-hour maximum or exclusively RAM-only handling on that evidence.

## Counting interpretations and version gaps

The fixed categories and once-per-load sets are mostly coherent. The review event requires both activation and each assigned slot's readiness. Failed sets are excluded. Ready means usable at that boundary, not completed review work. Late failures can follow readiness.

- `load-attempt − comparison` is not a failure total. Cancellation, consent changes, partial loading and delivery loss also contribute. Analysis and load failures may overlap. These limits are correctly stated in the event contract.
- Analysis attempts/outcomes describe loads containing requested post-decode analysis, not every audio decode. A successful foreground fallback is distinct from terminal analysis failure. Preview counters describe listening-buffer preparation, and Continuous counters describe engine preparation/processor fallback. They are not general crash or audio-compatibility rates; silent videos, unsupported decodes/transcode outcomes and abrupt exits are not fully represented.
- Attempts and outcomes are separate best-effort requests. A denominator can be lost while an outcome arrives. The sender's local totals measure dispatch, not hosted acceptance. No local mock verified GoatCounter aggregation, bot filtering, ignore-IP rules or dashboard receipt.
- Scrub thresholds are cumulative. Their differences estimate bands only for aligned release/media/item populations and time windows. They do not produce exact drag totals, and overlapping feature counts are not distinct users.
- Visits use unversioned `/` and title `WarpDiff`; release-specific visit populations are unavailable. Participation is release-prefixed but has no media/item cohort. Per-release participation cannot safely use unversioned visits as a matched denominator, and summing participation across releases can double-count a session that uses two versions. Confirm the account's session setting before calling participation session-deduplicated.
- Browser/OS breakdowns of `ns=true` feature or workload paths, if enabled, reflect those event counts, not a distinct-device census. Do not infer the entire audience or opt-in rate from consented traffic.

**Appearance-choice reporting is absent.** There is no call from the appearance owner into a reporting feature, and clicking all five appearances after consent and a ready review emitted nothing (`appearanceChoices` evidence). The planning catalog calls this a later candidate. Availability of appearances is independent of consent. Adding popularity counts would require a concrete purpose, event/denominator design and scope/disclosure assessment; “tools used” is not blanket approval for new metrics. The pending browser/OS clarification likewise has not been implemented by this review.

## Service worker, older code and unrelated limitations

The current worker's exact runtime allowlist excludes both the remote count endpoint and the loopback count URL. A real service-worker-enabled local run confirmed that no collector URL entered Cache Storage.

However, [sw.js](../../sw.js), lines 29–39, refreshes each asset independently. A warm-cache probe served harmless revision markers on otherwise unchanged source: initially HTML A/adapter A, then HTML B while the adapter network request failed. The running page received **HTML B/adapter A**, with no JavaScript errors. [pwa-results.json](adversarial-evidence-2026-09-30/pwa-results.json) preserves the observation. This is an existing network-first architecture risk, not a newly demonstrated analytics leak from an actual older build. The reviewed HTML and adapter were semantically identical except for markers.

The browser consent suites explicitly block service workers ([appearance suite](../../tests/appearance-usage.spec.ts), line 5; [production suite](../../tests/usage-production.spec.ts), line 7). Their script-version test does not verify atomic PWA upgrades. APP_VERSION/CACHE_NAME alignment and an asset list do not guarantee a coherent document. Before a material scope rollout, bind disclosure and collector versions or fail closed on a mismatch, and test installed-client partial updates/downgrades. Repository HEAD has no committed `js/usage.js`; exact unpublished historical adapters were not available for a byte-for-byte old-build test.

Other limits kept separate from findings:

- Future scope numbers fail closed, but a current-scope Yes with `decidedAt: "2099-01-01T00:00:00.000Z"` or `"1"` is accepted. This follows the documented parseable-date rule. It is a weak local marker, not proof of contemporaneous consent. Strict ISO/time validation would be hardening; no independent unauthorized acquisition of such a record was demonstrated.
- Total localStorage unavailability can break older application preference code before analytics setup. The prior verification record already acknowledges that limitation. This review does not relabel it as a new analytics regression.
- Operator/contact and actual retention details are already explicitly unfinished in `docs/usage-consent.md:75`. They remain launch prerequisites; this review did not inspect or alter the account to resolve them.
- Separate Safari/Firefox runs, a real WarpCap native launch, actual BFCache restoration, installed cross-release PWA builds and real hosted dashboard aggregation were not verified. The pagehide probe dispatches the lifecycle event in a disposable page; it is not a claim of full BFCache coverage.

## Verification record and evidence

| Check | Result and scope |
| --- | --- |
| Existing focused Playwright suites | **40 passed, no retries, 24.3 s**, two workers; both requested specs, remote browser traffic denied. [Log](adversarial-evidence-2026-09-30/focused-tests.txt) |
| Ownership/pure-logic harness | **442 passed, 0 failed**. [Log](adversarial-evidence-2026-09-30/ownership.txt) |
| Adversarial probes | Reproduced F1, F2, F4 and F5; F3 established from exact text, wire data and primary provider source. [Observations](adversarial-evidence-2026-09-30/adversarial-results.json) |
| Local TLS wire capture | Four requests; test cookie omitted; no media identity/referrer/page query. Browser-added metadata present. [Receipt](adversarial-evidence-2026-09-30/wire-requests.jsonl) |
| Actual service worker | Collector not cached; mixed HTML/adapter revision markers reproduced on partial network failure. [Observations](adversarial-evidence-2026-09-30/pwa-results.json) |
| Cosmetic reporting check | All five choices after consent/ready review: zero new requests |
| Pagehide control | Old review feature/ticket after pagehide: zero new requests |
| Whitespace and preservation | `git diff --check` passed; original-file hashes unchanged |

The existing suite verifies default/No silence, explicit Yes, no replay after ordinary opt-in, dismissal without consent, old/malformed/future-scope records, ordinary cross-tab invalidation, offline/reconnect, duplicate readiness, failed media, scrub click/loop/cancel exclusions, successful analysis fallback versus terminal failure, preview outcomes and Continuous fallback. Those passes are useful evidence, but they omit the failing transitions above. Most ownership guards check source strings or call counts rather than hostile schedules or account behavior; they cannot prove these guarantees alone. The full unrelated media suite was not repeated for this read-only review.

Meaningful failed approaches were retained: independently opened/frozen/busy tabs did not reproduce F2; related windows did. An initial system-Python setup command failed because of the existing Xcode-license gate, so the temporary harness was built with Node instead. No machine settings were changed. Browser/GitHub HTML fetch failures were resolved by reading pinned raw source; no hosted collection test was substituted. The existing 3.18.8/3.18.9 verification records remain intact, including their previously failed checks and resolutions.

The [evidence directory](adversarial-evidence-2026-09-30/) also preserves the probe source and temporary Playwright configuration. These are review harnesses, not added production regression tests. They use `/tmp/warpdiff-analytics-review-2026-09-30` and the reviewed absolute workspace path. Run the deny proxy before any browser harness; the wire probe additionally requires a disposable local certificate and its non-forwarding mock. **Do not adapt a reproduction by sending it to the live account.**

## Publish decision

**Hold publication of analytics.** Resolve F1 and F2, align the disclosure with verified account settings and finish the operator/retention information in F3, and close or demonstrably exclude F4's top-level launch path. Fix F5 before describing these counters as deliberate feature adoption. Preserve the bounded scope: appearance metrics and additional metadata remain proposals until separately assessed. Installed-client scope/disclosure coherence needs its own update test before a material future scope change.

No fixes were implemented. This review establishes local behavior and source-backed provider risks; it does not establish hosted acceptance, regulatory compliance or actual account configuration.
