# Reliable updates — work and verification record

This feature slice follows released main `342e9bc7ac6fb7d4e6115e9c3078eaa197ec8012` (3.19.3). Candidate 3.19.4 is unpublished. Merge and publication remain on hold pending review.

## Problem and approach

The old worker used stable runtime URLs, default HTTP-cache fetching and network-first writes into a version-named cache. A new document could therefore load older JavaScript, and a new cache could contain older bytes. The Chromium controlled predecessor-policy test reproduces that mismatch with a fresh B document and an A runtime marker after warming the HTTP cache. This is a faithful policy fixture, not a claim that the complete released source was independently rerun unchanged.

Staging now places runtime copies under the complete commit SHA, adds a relative document base and script SRI, and embeds the complete bundle's integrity manifest in the worker. Installation reloads and verifies every entry before activating. Runtime paths read their specific cached release; navigation revalidates online and falls back to the installed document offline, including query settings. No update reloads an existing comparison.

The worker asks open app windows which release they use. Referenced releases remain cached; unidentifiable legacy clients retain previous app caches conservatively. Monotonic installation sequences prevent an older controller's cleanup from deleting a newer installation. Other application scopes and unrelated caches remain outside retirement. The exact historical `warpdiff-ffmpeg` cache is still retired.

Three lazy audio entry points are included with the document because managed frames do not register a service worker and cannot depend on older deployment files staying on the server. The two worklets retain their canonical bytes. The embedded analysis worker changes only its import to include the exact `audio-viz.js` source as a data URL. A document-scoped helper creates at most three background-script URLs. No pinned audio engine file, lock or audio algorithm is edited. Ordinary scripts and their versioned copies remain byte-identical to source.

Relative host media URLs are explicitly resolved against the page URL so the new runtime base does not change host input resolution. Standalone source serving remains build-free. The staged manifest retains the root install/start identity. `version.json` now uses a plain local placeholder and a staged SHA.

A missing/mismatched required script shows a retry notice and prevents main startup. Retry re-fetches script bytes with integrity and cache reload before reloading the page. The independent usage-adapter failure fallback remains available and silent; this slice does not edit the consent adapter, its disclosure or its SRI source pin. First-load late cosmetic script failure also shows the notice. A failed offline install removes its incomplete cache and retains the prior complete bundle.

## Development failures retained

- Initial ownership failed only because README still identified 3.19.3 after the code version bump; the affected docs were then updated.
- The first upgrade tests cut the server connection too early. The initial asynchronous `waitForFunction` predicate could treat its Promise as truthy without requiring a successful installation result. Merely checking worker state inside that predicate did not repair the wait. It now uses an explicit async `expect.poll` result, an activated controller and a release-identity round trip. Earlier runs are retained and are not successful offline verification.
- Source inspection identified a real cleanup race: an older worker could see a newer in-progress cache. The initial timestamp guard covered ordinary installation order. A later negative control demonstrated that clock rollback could still retire a newer cache, so the final guard uses monotonic installation sequences. Dedicated tests inject an unusable wall clock and verify ordering without it. The early browser failures alone did not establish this as their cause; their invalid installation wait was subsequently identified.
- The first retry could reuse bad HTTP-cached bytes. The notice now explicitly reloads and integrity-checks scripts before retrying.
- An initial managed-frame fixture used an empty HTTP 404 as its parent and triggered Chromium's error page. It now uses an ordinary same-origin HTTP 200 host.
- The first relative-input probe omitted the managed host's mandatory display label. The fixture was corrected to supply a valid label and to require READY rather than accepting another terminal reply.

- WebKit's predecessor-policy control refreshed the JavaScript instead of reproducing Chromium's warm-cache mismatch. This is a browser difference, not a failing fixed-loader test. That control remains in Chromium; the WebKit profile selects all six fixed-loader scenarios without a skip. The initial seven-case WebKit run is retained with that control failure.

- The first broad local run used an output-directory configuration whose server inherited that directory. It served a file listing rather than the app. It was interrupted after repeated setup failures; the replacement server sets the repository working directory explicitly. That interrupted run is not an app regression or a green suite.
- Review of the retry path found that optional usage-adapter failures could block recovery of required scripts. Retry now excludes that adapter, and the first-load test keeps it unavailable during recovery.

- Final optional-API review added containment for a throwing `navigator.serviceWorker` getter and synchronous registration failure. The exact-source packaging scenario now deliberately denies that getter, requires usable startup, and checks offline worker/worklet loading without a service worker. The full suites preceded this last boundary containment; final focused browser runs and hosted checks cover the final source.

## Verification

Local results (one worker per run, zero retries):

| Check | Result |
|---|---|
| Complete Chromium | 529 passed, one existing approved skip; 655.1 seconds |
| Complete focused WebKit profile | 142 passed; 134.8 seconds |
| Final update/privacy-focused Chromium | 8 passed |
| Final update-focused WebKit | 6 passed |
| Local ownership | 911 passed |
| Infrastructure | 25 passed |

The complete Chromium run preceded the last cache-order and optional-API corrections. Complete WebKit includes the cache-order correction and precedes optional-API containment. The final focused runs cover both corrections; Chromium was followed by indentation-only formatting. No complete-suite result is represented as a byte-exact full run of the later source. Hosted checks must run the committed candidate. The final PR and ignored handoff record retain exact hosted identifiers and receipts. The hosted ownership total is two lower because neighboring WarpCap sources are absent.

The synthetic artifact contains 72 allowed files. The staged HTML grows from 773,476 to about 1,018,437 bytes; local default gzip grows from 176,135 to about 276,536 bytes. These are local compression measurements, not observed Pages transfer sizes or a speedup benchmark. The extra document data keeps lazy audio code available to older and managed views. Each WarpDiff browser run was serial with one worker; unrelated WarpCap graphics test processes were observed during some local runs, so local elapsed time is not used as a machine-isolated performance comparison.

Structured results and runtime source hashes are in `verification.json`. Raw local logs and temporary probe artifacts are retained under `output/coherent-updates-2026-10-15-6xmxbP/`; they are ignored and unpublished.

The new browser tests use real HTTP-cache and service-worker behavior, synthetic distinct releases and zero retries. The exact-source packaging case compares real worker analysis with the foreground functions and loads both canonical worklets offline. These checks establish loading and numerical parity of the unchanged algorithms, not audio conformance or listening quality.

## Limits and release boundary

Storage may be unavailable or evicted. Legacy pages already loaded before this fix cannot retroactively be repaired; the transition test starts with a complete warmed predecessor. Unknown older clients deliberately defer cache removal, and an abandoned cache may remain until a later cleanup. Source-only manual deployments do not have the staged bundle guarantee. This is version consistency and loading coverage, not CSP deployment, exhaustive network-integrity auditing, audio conformance or physical Safari listening. Historical Grid uncertainty and existing surround capability limitations remain unresolved.

No merge, publication, repository-setting changes or license changes are part of this slice.

## Reproduction

```sh
npm run test:infra
npm run test:ownership
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test tests/app-updates.spec.ts tests/usage-update.spec.ts --workers=1 --retries=0
WARPDIFF_BROWSER_CHANNEL=chrome npm run test:ci
npm run test:webkit
```

The regular configurations use localhost:8080. The retained local configurations instead start an explicitly repository-rooted server on 18758 and validate its response against the checkout. Fixtures were preserved, not regenerated. Temporary distinct-release servers use dynamically allocated loopback ports. Full inventories and strict report validation retain all expected cases with no retries or extra skips.
