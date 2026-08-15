# WarpDiff architecture and WarpCap vendoring review

**Date:** 2026-08-09
**WarpDiff revision reviewed:** `5e1cb8ce1bdac970ff435e5ac862071d8d6b3724` (`v3.12.25`)
**WarpCap copy reviewed:** `/Users/jay/Documents/WarpCap` (the supplied lowercase `/user/jay/Documents/warpcap` path did not exist)
**Mode:** read-only review and non-mutating diagnostics; no production host was contacted

## Executive verdict

WarpDiff's architecture is appropriate for what it is: a feature-rich, no-build, static media-comparison application. Its classic-script global realm is unconventional but deliberate, documented, and guarded. A framework migration, module-system rewrite, or broad state-management rewrite is not justified.

WarpCap's choice to consume WarpDiff as a same-origin iframe containing a plain vendored runtime is also fundamentally sound. The iframe preserves WarpDiff fidelity while isolating the two applications' global state and CSS. Server-side A/B blinding and host-side verdict submission are correctly kept out of WarpDiff.

The most important problems are at the integration boundary, not in the overall architecture:

1. Overlapping `WARPDIFF_LOAD` requests can resolve out of order, allowing an older task's media to overwrite a newer task's comparison surface.
2. The vendored WarpDiff iframe registers a service worker whose cache behavior crosses WarpCap ownership boundaries.
3. The host protocol is duplicated and insufficiently correlated, authenticated, and tested.

The recommended direction is to keep the existing application and iframe/vendor architecture, then harden the small protocol and deployment boundary around it.

## Scope and evidence

The review covered the complete tracked WarpDiff repository and the relevant WarpCap application, backend, browser tests, ownership checks, deployment server, vendoring script, vendored files, and design documents. It evaluated:

- standalone static/PWA architecture;
- subsystem and single-owner boundaries;
- global-state coupling;
- service-worker lifecycle, caching, and versioning;
- performance and memory behavior;
- tests and test gaps;
- the actual WarpCap vendoring, iframe, blinding, and deployment boundary.

Dynamic diagnostics used isolated local servers and headless Chromium. They did not alter either repository and all temporary servers were stopped afterward.

Verification results at review time:

- WarpDiff ownership suite: **265/265 passed**.
- WarpDiff Playwright suite: **125 passed, 1 skipped**.
- WarpCap logic suite: **1049 passed, 0 failed**.
- WarpCap `scripts/ci-check.mjs`: **passed**.
- Targeted WarpCap comparison-workspace pilot: **1 passed**.
- `git diff --check`: clean in both reviewed worktrees.
- WarpDiff was clean; WarpCap had only the pre-existing untracked `docs/premiere-plugin-plan.md`, which was not touched.

## Architectural strengths

### Standalone WarpDiff

1. **The no-build architecture is coherent.** The repository describes the classic-script arrangement and its intentionally shared realm in `README.md:80-94`. Pure logic is extracted where useful, while tightly coupled runtime behavior remains near its state. This is a reasonable tradeoff for a static app with no production dependency chain.

2. **Subsystem extraction follows useful boundaries.** Demuxing and timecode logic are mostly pure; transport, audio decode, and Opus sync are explicitly stateful. The comments at `js/audio-decode.js:1-7` accurately declare its dependencies instead of pretending it is isolated.

3. **Ownership discipline is unusually strong for a global-scope application.** `tests/ownership.test.mjs` checks version sync, script precaching, single-owner invariants, syntax, and pure behavior. This substantially reduces the principal risk created by the shared global realm.

4. **The difficult media paths are designed from measured behavior.** The RVFC loop owner, decode generations, Opus replacement audio, typed-array rendering, and WebCodecs scrub session all encode browser-specific failure modes and are covered by focused tests. Replacing this with generic abstractions would likely hide important timing invariants.

5. **Memory costs are documented and bounded.** The scrub decoder explicitly retains source bytes and budgets display-capped bitmaps between 96 and 192 MiB (`js/scrub-video.js:16-20`, `js/scrub-video.js:55-102`), closes decoded frames, and reserves async bitmap memory before creation (`js/scrub-video.js:123-151`). The cost is high but intentional rather than an accidental unbounded cache.

### WarpCap integration

1. **The iframe is the right isolation boundary.** WarpCap's design document explicitly chooses the real vendored application in a separate document so globals and CSS cannot collide (`WarpCap/docs/comparison-workspace-port.md:180-206`). This is materially safer and more faithful than merging two global applications.

2. **Blinding ownership is correct.** WarpCap rebuilds the client-facing comparison object, applies the server-only swap, and removes `comparison_blind_swap` before delivery (`WarpCap/backend/routes/tasks.js:295-338`). WarpDiff sees neutral A/B slots, not the secret mapping.

3. **The vendor allowlist is appropriately narrow.** The updater copies only the runtime and excludes tests, docs, dependencies, `version.json`, and the large ffmpeg bundle (`WarpCap/scripts/vendor-warpdiff.mjs:42-45`). Keeping ffmpeg out of the vendored tree is justified by deployment limits and the fact that common browser-native formats do not need it.

4. **Vendor seams fail loudly when their anchors move.** The updater validates that its two integration anchors are unique and present (`WarpCap/scripts/vendor-warpdiff.mjs:114-154`), while CI checks the seam, runtime presence, and ffmpeg exclusion (`WarpCap/scripts/ci-check.mjs:82-104`).

5. **The host already limits `postMessage` delivery to the same origin.** `_cmpPost` uses `window.location.origin`, not `*` (`WarpCap/ui/comparison.js:163-167`). This is a good base for tightening the receive path.

## Confirmed high-priority risks

### 1. Older media loads can overwrite the current task

**Severity:** high
**Status:** dynamically reproduced

WarpCap's request has no task ID, generation, or request ID (`WarpCap/ui/comparison.js:175-206`). The child begins asynchronous fetches and unconditionally calls `handleMultipleFiles` when they finish (`WarpCap/warpdiff/index.html:4743-4761`). It has no `AbortController`, generation comparison, or current-request check.

The error reply is also uncorrelated (`WarpCap/warpdiff/index.html:4767-4773`), and the host applies any failure from its iframe to whatever task is current (`WarpCap/ui/comparison.js:84-99`).

An isolated Playwright diagnostic sent an "old" pair whose routes were delayed by 700 ms, then a "new" pair delayed by 50 ms 20 ms later. The final WarpDiff state contained `editA: "old A"` and `editB: "old B"`. The older request completed last and replaced the newer media.

This is more than cosmetic: WarpCap's prompt/questions can describe the current task while WarpDiff displays the previous task. A reviewer could submit a judgment against the wrong pair while believing the surface is current.

**Immediate recommendation:** make the protocol correlated and cancelable.

- Add a unique `requestId` (and preferably `taskId`) to every `WARPDIFF_LOAD`.
- In WarpDiff, increment a load generation and abort the previous request's fetches.
- Before applying files or reporting failure, verify that the request is still current.
- Clear or obscure old media immediately when a new request is accepted.
- Add correlated `WARPDIFF_LOAD_READY` and `WARPDIFF_LOAD_FAILED` replies.
- Disable verdict submission until `READY` matches the current request.
- Ignore stale or unknown replies in the host.

Regression tests should deliberately resolve two loads in reverse order and verify both displayed media and submit gating.

### 2. The embedded service worker crosses WarpCap ownership boundaries

**Severity:** high
**Status:** dynamically reproduced under a local server matching WarpCap's Fly fallback behavior

The vendored iframe registers `warpdiff/sw.js` unconditionally (`WarpCap/warpdiff/index.html:12033-12035`). That worker:

- deletes **every origin cache** whose name is not the current WarpDiff cache (`WarpCap/warpdiff/sw.js:10-16`);
- intercepts every same-origin GET made by a controlled client, not merely WarpDiff runtime assets (`WarpCap/warpdiff/sw.js:19-37`);
- starts `cache.put` without extending the fetch event lifetime (`WarpCap/warpdiff/sw.js:30-34`).

The worker's precache includes `version.json` (`WarpCap/warpdiff/sw.js:2-6`), but WarpCap deliberately excludes that file from the vendor allowlist (`WarpCap/scripts/vendor-warpdiff.mjs:42-45`). This creates host-dependent behavior:

- A plain static server returned 404 for `/warpdiff/version.json`, causing `addAll` and worker installation to fail.
- WarpCap's Express SPA fallback returns the root application HTML with status 200 for unknown non-API paths (`WarpCap/backend/server.js:146-150`), allowing the worker to install while caching the wrong representation as WarpDiff's `version.json`.

In an isolated local Fly-style deployment diagnostic, activation removed a pre-existing `warpcap-owned-probe` cache, leaving only `warpdiff-v3.12.25`. A subsequent iframe request for a same-origin resource outside `/warpdiff/` was stored in WarpDiff's cache. A service worker's scope controls which pages it controls; a controlled page's fetches can still target URLs outside that path.

**Immediate recommendation:** embedded WarpDiff should not register its standalone PWA worker.

- Gate registration in upstream WarpDiff when `window.parent !== window` (or use an explicit embed-mode contract).
- In WarpCap, add a one-time migration that unregisters an existing `/warpdiff/` worker and deletes only cache names owned by WarpDiff.
- Do not delete arbitrary origin caches.
- Harden the standalone worker separately: delete only old `warpdiff-` caches, cache only an explicit runtime/navigation allowlist, cache only suitable successful responses, and use `event.waitUntil` for writes.
- Test both a clean install and migration from the current worker.

Merely stopping future registrations is insufficient because already installed workers persist until explicitly unregistered.

## Other confirmed boundary weaknesses

### 3. The host protocol has duplicate owners

The production comparison surface builds a load message in `WarpCap/ui/comparison.js:175-206`; Lead Console preview independently rebuilds the same mapping in `WarpCap/ui/lead-console.js:1101-1113`. The duplicate can drift in slot order, labels, names, request IDs, or future security fields.

The existing ownership assertion at `WarpCap/tests/logic.test.mjs:2026-2028` counts the exact string `type: 'WARPDIFF_LOAD'`. The preview uses `type:'WARPDIFF_LOAD'`, so the guard reports one owner while two message builders exist.

**Recommendation:** introduce one pure message builder used by both surfaces, give it ownership of request correlation fields, and test its returned structure rather than source whitespace.

### 4. Receive-side origin validation is incomplete

The child accepts `window.parent` based on `event.source` but does not check `event.origin` (`WarpCap/warpdiff/index.html:4732-4736`). It sends failure replies with `'*'` (`WarpCap/warpdiff/index.html:4771-4772`). The host checks the iframe window but not `event.origin` (`WarpCap/ui/comparison.js:88-91`).

Because the documented contract is same-origin, both sides should require the exact origin and use that exact origin as the target. This is defense in depth rather than the primary correctness defect.

### 5. The embedded URL is less portable than it needs to be

Both comparison surfaces use `warpdiff/index.html` (`WarpCap/ui/comparison.js:155-161`, `WarpCap/ui/lead-console.js:1095-1099`). In the local plain-static diagnostic, that URL redirected to a slashless `/warpdiff`, causing relative `js/...` assets to resolve at the site root and fail. `/warpdiff/` loaded correctly, and WarpCap's QC runner already uses the directory form.

**Recommendation:** use `warpdiff/` consistently and test it through every supported static/deployment server.

### 6. The vendor update is traceable but not fully reproducible or atomic

The updater defaults to moving `origin/master`, resolves only a short SHA for display, and records no machine-readable vendor lock (`WarpCap/scripts/vendor-warpdiff.mjs:35-45`, `WarpCap/scripts/vendor-warpdiff.mjs:75-87`). Documentation records the current short SHA (`WarpCap/docs/comparison-workspace-port.md:207-212`), but CI cannot independently prove that every vendored byte corresponds to that revision plus the declared patch.

The script safely creates the archive before touching the destination, but it clears and extracts the live vendor targets before validating and applying the seam (`WarpCap/scripts/vendor-warpdiff.mjs:89-112`, `WarpCap/scripts/vendor-warpdiff.mjs:114-154`). A seam-anchor failure can therefore leave a partially updated working tree that requires restoration.

**Recommendation:** keep the plain-copy model, but:

- require or record an immutable full commit SHA;
- write a tracked lock/manifest containing upstream SHA, WarpDiff version, allowlist, file hashes, and seam-patch version;
- build and validate the complete result in a temporary staging directory, then replace the live allowlisted paths only after every check passes;
- have CI verify the committed vendor tree against the lock.

A Git submodule would add operational complexity without fixing the runtime seam and is not recommended.

## Standalone WarpDiff risks and improvement opportunities

### Service-worker ownership should be fixed upstream

Even outside WarpCap, activation deletes caches it does not own (`sw.js:10-16`) and the fetch handler caches any same-origin GET (`sw.js:19-37`). On a dedicated GitHub Pages origin this is less likely to damage another application, but prefix-scoped deletion and an explicit request policy are still the correct ownership model.

### Corrupted preferences can prevent startup

`_prefs.load` performs unchecked `JSON.parse` (`index.html:3123-3132`), and several module-level initializers call it during boot (`index.html:4461-4470`). A malformed `pref_*` value can throw before the app is usable. Some preferences are sanitized after parsing, but invalid JSON never reaches that sanitation.

**Recommendation:** catch parsing errors, remove or ignore the malformed key, return the supplied fallback, and add a startup test with corrupted persisted values.

### Audio-only visualization has an avoidable overlapping-decode window

Audio-only loading starts `decodeAndComputeAudioSlotViz` and retains the source buffer until it finishes (`index.html:7263-7277`, `js/audio-decode.js:402-418`). If the user opens the separate waveform panel before that finishes, `_ensureAudioVizDecoded` can also start `decodeAndComputeAudioViz` because `waveformData` is still absent (`index.html:6018-6027`). The pipelines use different generation counters, so neither invalidates the other.

This is a code-supported race/performance risk, not a dynamically reproduced correctness failure. It can duplicate native decoding, spectrogram generation, and loudness analysis for a large audio file.

**Recommendation:** expose a shared per-slot decode promise/result and derive both audio-only and panel views from it. Do not broadly merge the video-audio and audio-only state machines; share only the expensive decode/analysis result.

### Scrub memory is bounded but can be large

Each active scrub session retains the full file bytes and a 96–192 MiB bitmap cache (`js/scrub-video.js:16-20`, `js/scrub-video.js:55-102`). With three large video slots, this can create substantial memory pressure in addition to browser decoder surfaces and audio buffers. The code closes frames and cache entries correctly, so this is a product tradeoff rather than a leak.

**Immediate recommendation:** leave the current behavior unchanged unless field evidence shows crashes or tab eviction; the measured scrub benefit justifies it on desktop.

**Optional longer-term improvement:** make the total cache budget global or device-aware, expose memory/cache diagnostics, and degrade cache size on constrained devices. Preserve the current per-GOP logic rather than replacing it with a flat small cache.

### Licensing metadata is contradictory

`README.md:121-123` says redistribution and derivative use are not currently licensed, while `package.json:16` declares ISC. This is a release/governance ambiguity, especially for a repository intentionally vendored into another product.

**Recommendation:** choose one authoritative license policy and make the README, package metadata, and an actual license file agree.

## Testing assessment

The two-layer WarpDiff strategy is strong and should remain: Playwright exercises real browser behavior while the dependency-free ownership harness freezes architectural invariants. WarpCap similarly has broad logic/CI coverage and an end-to-end shell test.

The important gap is that the WarpCap comparison pilot proves iframe mounting, host-shell behavior, and verdict submission, but explicitly does not wait for real pair decoding (`WarpCap/tests/browser/pilot.spec.ts:539-582`). As a result, it cannot detect stale/out-of-order media, a failed worker install, or a submit-before-ready condition.

Add focused browser tests for:

1. two media loads resolving in reverse order;
2. current-request success/failure correlation;
3. submit disabled until matching `READY`;
4. service-worker absence in embed mode;
5. migration from the old worker without deleting WarpCap-owned caches;
6. `warpdiff/` routing under each supported host;
7. vendor-lock verification and seam application from an immutable revision;
8. corrupted standalone preferences;
9. audio-panel activation during an in-flight audio-only decode.

## Recommended sequence

### Immediate

1. Fix and test correlated/cancelable `WARPDIFF_LOAD` handling and ready-gated submission.
2. Disable service-worker registration in embed mode and migrate existing WarpCap registrations/caches safely.
3. Enforce exact message origins on both sides.
4. Consolidate the message builder and replace whitespace-sensitive ownership checks.
5. Standardize the iframe URL on `warpdiff/`.
6. Make `_prefs.load` resilient to malformed JSON.

### Next vendor-hardening round

1. Add a full-SHA vendor lock and byte/hash verification.
2. Stage and validate updates before replacing the live vendor tree.
3. Expand the pilot from "iframe exists" to "the correlated current pair is ready."

### Optional, evidence-driven longer term

1. Share expensive audio decode/analysis results across the two visualization consumers.
2. Add a global/device-aware scrub-memory budget if real devices show pressure.
3. Gradually pass explicit state/context into newly extracted subsystems where it reduces coupling, without rewriting stable transport or audio engines.

## Explicit leave-unchanged recommendations

- **Keep the no-build static application.** The deployment simplicity is a real feature.
- **Keep classic scripts for the current extracted stateful subsystems.** ES modules would require a deliberate state/API redesign, not a mechanical conversion.
- **Keep pure demuxers and timecode/math helpers separated.** Their current boundaries are useful.
- **Keep the single-owner transport/RVFC and Opus-sync implementations.** Their complexity represents required browser behavior and is guarded.
- **Keep WarpCap's iframe boundary.** Do not merge WarpDiff into WarpCap's global application realm.
- **Keep server-side blinding and WarpCap-owned verdict submission.** WarpDiff should remain the display/inspection component.
- **Keep the plain vendored-copy model and ffmpeg exclusion.** Harden traceability and atomicity rather than adopting a submodule or copying the 24 MiB bundle.
- **Keep the current scrub cache policy for now.** Change it only in response to measured memory failures.

## Verification boundary

The review verified the local WarpCap source, vendored runtime, server behavior, tests, and isolated browser behavior. It did **not** contact or inspect a deployed WarpCap host, CDN configuration, production service-worker registrations, production browser caches, or production task data. Any conclusion about currently deployed worker state or live routing remains unverified until checked on the actual deployment.
