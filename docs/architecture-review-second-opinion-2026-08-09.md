# Independent architectural review

The excluded review artifact was not accessed. I made no repository changes, commits, pushes, deployments, or external-service requests. Both repositories’ tracked worktrees remained unchanged; WarpCap’s pre-existing untracked document was left untouched.

## Executive assessment

WarpDiff and WarpCap have unusually strong ownership documentation, regression harnesses, media-lifecycle cleanup, and explicit deployment/version contracts for no-build applications. Vendoring through a same-origin iframe is the right architectural boundary and should remain.

The most consequential issues are:

1. WarpCap’s development server exposes its repository root—including the live local SQLite database—to every interface.
2. WarpDiff has a reproducible last-request-loses race, allowing an old comparison to replace a newer task’s media.
3. WarpCap task mutations are not atomically tied to the current assignee/status; delayed saves, releases, or submissions can contaminate or complete reassigned work.
4. WarpDiff’s audio generation counters reset, allowing stale async decode completions to pass their freshness check.
5. WarpDiff’s service worker deletes caches it does not own.
6. WarpCap deliberately excludes WarpDiff’s FFmpeg runtime while retaining a loader that requires those local files, so the embedded transcode fallback is broken.

I would treat the first four as release-blocking before exposing either application to untrusted LAN users or relying on rapid multi-user task transitions.

## Findings

### 1. Critical — WarpCap serves the live local database and repository internals

**Classification: dynamically confirmed defect.**

The Express server mounts the entire repository root before its routes: [backend/server.js](/Users/jay/Documents/WarpCap/backend/server.js:63). The default database lives inside that static tree at `backend/data.db`: [backend/db.js](/Users/jay/Documents/WarpCap/backend/db.js:5). The server also listens without an explicit loopback host: [backend/server.js](/Users/jay/Documents/WarpCap/backend/server.js:171).

Against the already-running local server I confirmed:

- `/backend/data.db` → `200 application/octet-stream`, 1,531,904 bytes
- `/backend/server.js` → `200`
- `/docs/HANDOFF.md` → `200`
- `/tests/logic.test.mjs` → `200`
- The process listened on `TCP *:3000`

I inspected only status, type, and size—not database contents.

The production database is safer because Fly places it at `/data/data.db`: [fly.toml](/Users/jay/Documents/WarpCap/fly.toml:10), and the Docker build excludes the local database, docs, and tests: [.dockerignore](/Users/jay/Documents/WarpCap/.dockerignore:25). Production still serves backend source because it is copied beneath the static root. Cloudflare Pages also deploys tracked files as-is, a fact the repository itself acknowledges: [.gitignore](/Users/jay/Documents/WarpCap/.gitignore:63).

**Recommendation:** replace root-wide static serving with an explicit client allowlist or a generated public directory. At minimum, deny `backend/`, `docs/`, `tests/`, scripts, configuration, and dotfiles before the SPA fallback. Bind local development to `127.0.0.1` by default, with an explicit LAN opt-in.

---

### 2. High — WarpDiff lets an older load overwrite a newer comparison

**Classification: dynamically confirmed defect, inherited by WarpCap.**

Each `WARPDIFF_LOAD` independently fetches its media and applies the result when its own `Promise.all` completes: [index.html](/Users/jay/Documents/warpdiff/index.html:4732), [index.html](/Users/jay/Documents/warpdiff/index.html:4741), [index.html](/Users/jay/Documents/warpdiff/index.html:4753). There is no request identity, generation, or abort controller. Every successful completion calls `handleMultipleFiles`, which clears the current media and replaces it: [index.html](/Users/jay/Documents/warpdiff/index.html:4796), [index.html](/Users/jay/Documents/warpdiff/index.html:4814).

I sent:

1. A deliberately slow request named `SLOW_OLD.png`.
2. Twenty-five milliseconds later, a fast request named `FAST_NEW.png`.

After both settled, WarpDiff displayed `SLOW_OLD.png`.

This matters more inside WarpCap because the task key is advanced when the message is sent, not when WarpDiff acknowledges successful application: [ui/comparison.js](/Users/jay/Documents/WarpCap/ui/comparison.js:273). An old pair can therefore appear beside a new task’s prompt and questions—the worst possible failure mode for blinded evaluation integrity.

**Recommendation:** give every load a monotonically increasing `requestId`; abort prior fetches; check the active generation before `clearAllMedia` and after every asynchronous boundary; and return `WARPDIFF_LOAD_APPLIED`/`FAILED` with the same ID. WarpCap should not commit `_applyComparison._key` until the matching success acknowledgment arrives.

Add a regression test with slow-old/fast-new and fast-old/slow-new permutations.

---

### 3. High — WarpCap task writes are not atomic with claim ownership

**Classification: code-supported concurrency defect.**

Annotation save performs a read-time authorization check, followed by a separate unguarded upsert: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:669), [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:685). It does not require `status='in_progress'` at the write.

Consequences:

- A completed task’s assigned user can continue changing `task_annotations`.
- A delayed autosave can pass the ownership read, then overwrite a new claimant’s work after release and reassignment.
- The client’s debounce only rechecks that some current task exists before sending; it has no captured task generation or abort signal: [task-queue.js](/Users/jay/Documents/WarpCap/task-queue.js:397).

Submit is also vulnerable. It checks the owner before entering the task lock: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:714). Inside the lock it re-reads only `status`, not the owner: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:831). It writes annotations, versions, reviews, and possible review tasks before a final update that tests only `status='in_progress'`: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:836), [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:935).

Therefore:

- If release wins, an old submit can still write side effects before returning conflict.
- If another user reclaims the task before the final update, the old submit can complete the new user’s claim because the final update does not test `assigned_user_id`.
- Release similarly persists its annotation copy before its guarded ownership election: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:976).

The in-process keyed lock does not make the database sequence transactional and does not coordinate multiple Fly processes.

**Recommendation:** put each mutation in a database transaction and use a claim token/revision or conditional statement requiring all of:

```sql
task_id = ?
AND status = 'in_progress'
AND assigned_user_id = ?
AND claim_revision = ?
```

Do the ownership election before dependent writes, or roll everything back when it loses. Add races for save-vs-release, submit-vs-release, and old-owner-vs-reclaim using two independent database connections.

---

### 4. High — Audio decode freshness counters have an ABA failure

**Classification: dynamically confirmed defect.**

Both audio paths correctly capture a per-slot generation and reject stale completion: [js/audio-decode.js](/Users/jay/Documents/warpdiff/js/audio-decode.js:14), [js/audio-decode.js](/Users/jay/Documents/warpdiff/js/audio-decode.js:127), [js/audio-decode.js](/Users/jay/Documents/warpdiff/js/audio-decode.js:402).

But `clearAllMedia()` resets both maps to empty objects: [index.html](/Users/jay/Documents/warpdiff/index.html:9559). The next load starts at generation `1` again. A decode from the previous load that captured `1` therefore compares equal to the new file’s `1`.

I reproduced this mechanism for both counters:

```text
oldV=1 currentV=1 staleVideoPasses=true
oldA=1 currentA=1 staleAudioPasses=true
```

A stale completion can overwrite waveform, metrics, buffers, or Opus synchronization state belonging to the new asset. The ownership suite currently requires the unsafe reset: [tests/ownership.test.mjs](/Users/jay/Documents/warpdiff/tests/ownership.test.mjs:191), so the defect is protected rather than detected.

**Recommendation:** use one monotonic load epoch that never resets, captured by every decode, or increment each slot’s counter during clear instead of replacing the maps. Reverse the ownership assertion and add a delayed-decode-across-reload test.

The separate scrub-session generation is already monotonic and correctly closes stale sessions: [index.html](/Users/jay/Documents/warpdiff/index.html:4205), [index.html](/Users/jay/Documents/warpdiff/index.html:4231), [index.html](/Users/jay/Documents/warpdiff/index.html:4283). That design should remain unchanged and should be copied for audio.

---

### 5. High as a component — WarpDiff deletes caches owned by other applications

**Classification: dynamically confirmed defect.**

On activation, WarpDiff deletes every origin cache whose name is not its current cache: [sw.js](/Users/jay/Documents/warpdiff/sw.js:10). Cache Storage is origin-wide, not service-worker-scope-wide.

I created `unrelated-component-cache`, activated WarpDiff’s worker, and observed:

```text
keys=["warpdiff-v3.12.25"]
sentinelExists=false
```

The vendored worker has the same behavior: [warpdiff/sw.js](/Users/jay/Documents/WarpCap/warpdiff/sw.js:10). Its fetch interception is safely scoped to `/warpdiff/`, but activation can still delete any present or future WarpCap cache, ML model cache, or component cache. It also deletes WarpDiff’s own separately named `warpdiff-ffmpeg` cache.

**Recommendation:** delete only keys with an owned prefix, such as `warpdiff-runtime-`, retaining the current version. Include a cache-ownership regression test.

The version coupling itself is good: `APP_VERSION` and the cache version are checked together, and all loaded `js/*` files are precached: [tests/ownership.test.mjs](/Users/jay/Documents/warpdiff/tests/ownership.test.mjs:65).

---

### 6. Medium — Embedded FFmpeg fallback is structurally broken

**Classification: dynamically confirmed deployment defect.**

Standalone WarpDiff loads FFmpeg from local `./ffmpeg/*` paths: [index.html](/Users/jay/Documents/warpdiff/index.html:5592), [index.html](/Users/jay/Documents/warpdiff/index.html:5630). Those files exist in the standalone repository, although they are omitted from the service-worker precache, so a fresh offline installation cannot transcode.

WarpCap’s vendor script explicitly excludes the entire FFmpeg directory: [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:42). The vendored loader remains unchanged and still requests local files. Against WarpCap’s local server, all three missing paths returned the 382 KB SPA HTML with status 200:

- `ffmpeg.min.js`
- `ffmpeg-core.js`
- `ffmpeg-core.wasm`

This is worse than a clean 404: the script `onload` can fire after an HTML-as-JavaScript parse failure, and the WASM prefetch can cache HTML as WASM. The CI gate confirms only that FFmpeg is absent: [scripts/ci-check.mjs](/Users/jay/Documents/WarpCap/scripts/ci-check.mjs:82).

**Recommendation:** either remove/disable the embedded transcode UI with an explicit unsupported message, or patch the vendored loader to WarpCap’s pinned CDN/self-hosting owner. Also terminate missing `/warpdiff/*` asset requests as honest 404s instead of the SPA fallback.

---

### 7. Medium — Re-vendoring is fail-fast but not transactional or fully attestable

**Classification: code-supported process risk.**

The current vendored runtime is clean: WarpDiff is at `5e1cb8c`; every vendored JS file, service worker, manifest, and image matched it byte-for-byte. `index.html` differed only in the two documented parent-frame seam changes.

The good parts should remain: vendoring from a git ref rather than the working tree, a strict runtime allowlist, and anchor validation: [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:13), [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:47).

The failure path is unsafe. After creating a valid archive, the script deletes the destination allowlist and extracts directly into the live vendor directory: [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:89), [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:103). Only afterward does it validate and reapply the seam: [scripts/vendor-warpdiff.mjs](/Users/jay/Documents/WarpCap/scripts/vendor-warpdiff.mjs:114). A missing anchor leaves a partially updated, unpatched vendor tree.

Provenance is recorded only in mutable documentation: [docs/comparison-workspace-port.md](/Users/jay/Documents/WarpCap/docs/comparison-workspace-port.md:207). CI checks seam presence, not equality to a recorded upstream SHA.

**Recommendation:** extract and patch in a temporary directory, validate hashes and runtime behavior there, then atomically replace the destination. Generate a tracked provenance manifest containing upstream SHA, version, file hashes, exclusions, and patch identity. Add a read-only `--check` mode.

---

### 8. Medium/High before multi-tenant use — project membership does not constrain lead powers

**Classification: code-supported security boundary; acceptable only under the current trusted-global-lead model.**

`canWorkIn` correctly owns annotator claim access: [backend/access.js](/Users/jay/Documents/WarpCap/backend/access.js:45). Lead routes generally use only the global lead/admin role check: [backend/middleware/authMiddleware.js](/Users/jay/Documents/WarpCap/backend/middleware/authMiddleware.js:49). For example, a lead may name any project ID and read its operational state or change its settings: [backend/routes/reviews.js](/Users/jay/Documents/WarpCap/backend/routes/reviews.js:34), [backend/routes/reviews.js](/Users/jay/Documents/WarpCap/backend/routes/reviews.js:255).

This is not tenant isolation. It is reasonable if every lead is an organization-wide administrator, but it becomes a data-boundary vulnerability as soon as project leads are intended to be scoped.

**Recommendation:** retain the current model for a small trusted pilot, but explicitly document “lead is organization-global.” Before multi-tenant or delegated-project rollout, add a `canLeadProject` owner and apply it consistently.

A smaller role inconsistency exists in task detail: assigned users or exact role `lead` may view a task, but `admin` is omitted: [backend/routes/tasks.js](/Users/jay/Documents/WarpCap/backend/routes/tasks.js:632).

---

### 9. Medium — deployment can report success while the two hosts differ

**Classification: code-supported operational risk.**

WarpCap pushes Cloudflare Pages first, then deploys Fly: [scripts/deploy.sh](/Users/jay/Documents/WarpCap/scripts/deploy.sh:43). These are necessarily non-atomic. More importantly, the parity check’s failure is ignored and the script still prints that both hosts were deployed: [scripts/deploy.sh](/Users/jay/Documents/WarpCap/scripts/deploy.sh:49).

Pages deployment is asynchronous, so even a successful push can reasonably return the old stamp during the immediate check. Conversely, a Fly failure after the push leaves genuine drift.

The parity checker itself is thoughtfully written and distinguishes down, unstamped, drifted, and locally ahead states: [scripts/deploy-status.sh](/Users/jay/Documents/WarpCap/scripts/deploy-status.sh:19).

**Recommendation:** retain the stamp/checker, but poll each host to a bounded deadline for the expected SHA, fail the deploy command if either never converges, and print partial-deploy recovery instructions. Do not say “to both hosts” after an ignored failure.

CI runs logic, type, hygiene, and backend tests but no browser or Docker smoke test: [.github/workflows/ci.yml](/Users/jay/Documents/WarpCap/.github/workflows/ci.yml:8). The deterministic same-base native-module build is strong: [Dockerfile](/Users/jay/Documents/WarpCap/Dockerfile:20). Adding a container build plus `/health` smoke test would protect that boundary.

---

### 10. Medium — ownership discipline is strong, but string guards do not establish a real subsystem boundary

**Classification: architectural risk with a confirmed guard blind spot.**

Both applications use classic scripts sharing a global lexical environment. WarpDiff’s subsystem extraction is useful, but stateful files explicitly depend on globals in `index.html`: [js/audio-decode.js](/Users/jay/Documents/warpdiff/js/audio-decode.js:1). WarpCap improves this with one `session` bag and one per-video `state` bag: [index.html](/Users/jay/Documents/WarpCap/index.html:43), [index.html](/Users/jay/Documents/WarpCap/index.html:2301). Its load-order dependencies are candid and well documented: [index.html](/Users/jay/Documents/WarpCap/index.html:1496).

The ownership guard claims exactly one `WARPDIFF_LOAD` sender by counting the exact spaced string: [tests/logic.test.mjs](/Users/jay/Documents/WarpCap/tests/logic.test.mjs:2023). Production lead-preview code contains another sender formatted without that space: [ui/lead-console.js](/Users/jay/Documents/WarpCap/ui/lead-console.js:1101). The QC runner contains another: [qc/qc-runner.js](/Users/jay/Documents/WarpCap/qc/qc-runner.js:309). The preview also handles WarpSonic errors but not WarpDiff failures: [ui/lead-console.js](/Users/jay/Documents/WarpCap/ui/lead-console.js:1218).

**Recommendation:** create one protocol adapter responsible for building, sequencing, posting, acknowledging, and failing WarpDiff loads. Consumers should call it rather than construct messages. Replace textual occurrence tests with AST parsing or runtime contract tests.

I would not recommend a wholesale module rewrite. Continue extracting boundaries incrementally around high-risk protocols, task mutations, and asynchronous resource owners.

---

### 11. Lower-priority security and performance risks

**Code-supported risks:**

- The vendored iframe accepts parent messages based on `event.source` but does not validate `event.origin`; its failure response uses `'*'`: [warpdiff/index.html](/Users/jay/Documents/WarpCap/warpdiff/index.html:4732), [warpdiff/index.html](/Users/jay/Documents/WarpCap/warpdiff/index.html:4771). Current same-origin use limits exposure, but both sides should validate the origin and matching request ID.

- WarpCap disables CSP because of its inline architecture: [backend/server.js](/Users/jay/Documents/WarpCap/backend/server.js:26), while seven-day bearer tokens live in `localStorage`: [auth.js](/Users/jay/Documents/WarpCap/auth.js:107). I found no confirmed XSS path, and the UI generally uses escaping/text content, but any future XSS would gain the full token. Incremental CSP hashes/nonces or moving the inline block to external files would materially reduce impact.

- Whisper, speaker embedding, and classification execute pinned CDN-delivered code and large models at runtime: [ml/whisper.js](/Users/jay/Documents/WarpCap/ml/whisper.js:47), [ui/analysis-engines.js](/Users/jay/Documents/WarpCap/ui/analysis-engines.js:255). FFmpeg core is similarly fetched from a CDN: [transcode.js](/Users/jay/Documents/WarpCap/transcode.js:32). Pinning is better than floating versions, but self-hosting with integrity/provenance would reduce supply-chain and availability risk.

- Whisper resamples and retains full audio, then runs chunked transcription from the page realm: [ml/whisper.js](/Users/jay/Documents/WarpCap/ml/whisper.js:83), [ml/whisper.js](/Users/jay/Documents/WarpCap/ml/whisper.js:237). Use a worker, cancellation generation, progress, and an explicit duration/memory budget before treating long-media analysis as robust.

- WarpDiff’s scrub sessions intentionally retain full file bytes plus 96–192 MB of cached bitmaps per active session: [js/scrub-video.js](/Users/jay/Documents/warpdiff/js/scrub-video.js:16), [js/scrub-video.js](/Users/jay/Documents/warpdiff/js/scrub-video.js:79). With three slots, aggregate cache capacity can reach roughly 576 MB before file bytes, video decoders, and audio buffers. The GOP-aware cache is measured and materially improves reverse scrubbing; do not simply reduce it. Add an aggregate per-page budget or low-memory mode, then measure before changing desktop defaults.

## Strengths and areas to leave unchanged

- **Iframe vendoring is the right boundary.** A separate document keeps WarpCap and WarpDiff globals/CSS isolated while preserving the real comparison application: [docs/comparison-workspace-port.md](/Users/jay/Documents/WarpCap/docs/comparison-workspace-port.md:196).

- **Server-side blinding is correctly placed.** WarpDiff receives neutral A/B labels and never receives the server’s swap mapping: [ui/comparison.js](/Users/jay/Documents/WarpCap/ui/comparison.js:169). Keep verdict ownership in WarpCap and display ownership in WarpDiff.

- **WarpDiff cleanup is comprehensive.** It revokes blob URLs, stops Opus audio, closes scrub sessions and bitmap caches, removes magnifier clones, and closes the AudioContext: [index.html](/Users/jay/Documents/warpdiff/index.html:9470), [index.html](/Users/jay/Documents/warpdiff/index.html:9550), [index.html](/Users/jay/Documents/warpdiff/index.html:9565). Preserve this lifecycle design while fixing the counter reset.

- **WarpCap’s state consolidation and selective render scheduler are worthwhile.** Selection-only renders avoid persistence, and the full-render diff guard detects stale regions: [ui/render-scheduler.js](/Users/jay/Documents/WarpCap/ui/render-scheduler.js:120). Undo derives its snapshot manifest from the canonical empty state: [ui/undo.js](/Users/jay/Documents/WarpCap/ui/undo.js:31). Both should remain.

- **Backend authentication fundamentals are sound.** The server refuses a missing JWT secret, hashes passwords with bcrypt, refreshes roles from the database on every request, rate-limits credential endpoints, and bounds JSON bodies: [backend/auth.js](/Users/jay/Documents/WarpCap/backend/auth.js:6), [backend/middleware/authMiddleware.js](/Users/jay/Documents/WarpCap/backend/middleware/authMiddleware.js:16), [backend/server.js](/Users/jay/Documents/WarpCap/backend/server.js:44).

- **Public media is an explicit pilot tradeoff.** The route has correct Range and honest-404 behavior and is clearly documented as non-sensitive: [backend/server.js](/Users/jay/Documents/WarpCap/backend/server.js:118). Keep it for the stated non-sensitive pilot; make signed URLs a launch gate before sensitive media.

- **Cache/version hygiene is generally good.** WarpCap’s revalidation headers avoid mixed-version classic scripts: [_headers](/Users/jay/Documents/WarpCap/_headers:1). WarpDiff couples its app/cache versions and exposes the deployed SHA. Fix cache ownership without abandoning these mechanisms.

- **The suspected WarpDiff Scale-control obstruction did not reproduce.** At 1280×720, 1024×640, and 800×600, both Fit and Ref were visible, topmost at their centers, and clickable. No change is justified from this review.

## Verification performed

All existing suites passed:

- WarpDiff ownership harness: **265 passed, 0 failed**
- WarpDiff Playwright: **125 passed, 1 skipped**, 2.2 minutes
- WarpCap logic harness: **1,049 passed, 0 failed**
- WarpCap required CI checker: **all checks passed**
- WarpCap backend API suite: **91 passed, 0 failed**
- WarpCap pilot browser suite: **52 passed, 0 failed**

Targeted diagnostics additionally confirmed:

- Slow-old WarpDiff load overwrote fast-new load.
- Both audio generation counters exhibit the reset-to-1 ABA condition.
- WarpDiff activation deleted an unrelated Cache Storage entry.
- Fresh WarpDiff cache contained the application shell but not FFmpeg runtime files.
- Vendored FFmpeg paths returned SPA HTML instead of runtime assets.
- WarpCap’s local server exposed the database and repository files on an all-interface listener.
- The vendored runtime matched upstream `5e1cb8c` except for the two intended seam edits.
- Scale-control pointer hit-testing passed at three viewports.

The green suites are meaningful, but they currently lack adversarial request-order, task-claim election, service-worker cache-ownership, vendored-transcode, and static-root exposure tests.

## Recommended remediation order

1. Restrict WarpCap static serving and default listener binding.
2. Introduce a request-ID/acknowledgment protocol for every WarpDiff host load.
3. Make task save/release/submit transactional and claim-revision guarded.
4. Make all WarpDiff async generations monotonic and fix the ownership test.
5. Namespace service-worker cache deletion.
6. Either wire or explicitly disable vendored FFmpeg.
7. Make vendoring transactional with generated provenance.
8. Add project-scoped lead authorization before expanding beyond trusted organization-wide leads.
9. Make deployment parity a truthful, blocking convergence check.
10. Add the missing concurrency, cache, vendoring, and security-boundary tests.
