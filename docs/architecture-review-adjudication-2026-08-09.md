# WarpDiff / WarpCap architecture-review adjudication

**Date:** 2026-08-09

**WarpDiff revision adjudicated:** `5e1cb8ce1bdac970ff435e5ac862071d8d6b3724` (`v3.12.25`)

**WarpCap revision adjudicated:** `179724f485fdce9fc85ea03a7e606b98ff525f78` (vendors WarpDiff `v3.12.25`)

**Inputs:** [architecture review](architecture-review-2026-08-09.md) and
[independent second opinion](architecture-review-second-opinion-2026-08-09.md)

**Mode:** source adjudication plus isolated, non-mutating local diagnostics. No repository file was
changed during the diagnostic phase; no commit, push, deployment, or external service was used.

## Executive decision

Neither review is sufficient alone.

- The first review is stronger on the WarpDiff/WarpCap integration boundary: request correlation,
  embedded service-worker behavior, URL portability, malformed preferences, and vendor mechanics.
- The second review finds the most serious omitted WarpCap issues: repository/database exposure,
  non-transactional task mutations, audio-generation ABA, and the broken embedded FFmpeg fallback.
- Both are correct that the same-origin iframe and plain-vendor architecture should remain.

The merged release blockers are:

1. WarpCap exposes its repository root and local database when the development server is reachable.
2. An older WarpDiff load can overwrite a newer task's comparison media.
3. WarpCap task saves, submits, and releases are not transactionally tied to the current claim.
4. WarpDiff audio decode generations reset and admit stale completions after clear/reload.
5. Embedded WarpDiff registers a service worker that deletes caches it does not own and caches
   same-origin resources outside the WarpDiff runtime.

## Evidence classifications

- **Dynamically confirmed defect:** reproduced against the adjudicated source in an isolated local
  runtime, or independently reproduced by both reviews against the identical revision.
- **Statically supported risk:** a concrete unsafe path exists in current source, but this
  adjudication did not reproduce the full race or production consequence end to end.
- **Optional architectural preference:** a potentially useful improvement without a demonstrated
  present correctness failure.

Green baseline suites do not change these classifications: the relevant adversarial properties are
not currently exercised by those suites.

## Points of agreement

Both reviews correctly agree that:

- The same-origin iframe is the right isolation boundary. Merging WarpDiff into WarpCap's global
  realm would increase CSS and global-state collision risk.
- Server-side A/B blinding and WarpCap-owned verdict submission should remain.
- A stale-load race can put an older pair beside a newer task.
- WarpDiff's service worker deletes caches it does not own.
- The host protocol has duplicated builders and lacks request correlation.
- Vendoring is narrowly allowlisted and traceable, but not transactional or fully attestable.
- The classic-script/no-build model is deliberate; a framework or module-system rewrite is not
  justified by these findings.
- WarpDiff's scrub cache is large but bounded and measured, not a demonstrated leak.
- Existing test coverage is broad but misses adversarial request ordering, cache ownership,
  claim-election races, and several deployment-boundary properties.

## Findings unique to each review

### First-review-only findings

- Corrupt `pref_*` JSON can abort WarpDiff startup.
- `warpdiff/index.html` is non-portable under WarpCap's supported `npx serve` setup;
  `warpdiff/` is stable.
- Embedded WarpDiff precaches an absent `version.json`, leading either to service-worker install
  failure or to the WarpCap SPA being cached as WarpDiff JSON, depending on server fallback behavior.
- Service-worker cache writes are not attached to the fetch event lifetime.
- Audio-only visualization and the waveform panel can initiate overlapping expensive decodes.
- WarpDiff's README and package licensing metadata conflict.
- Exact-origin validation is missing on both sides of the iframe protocol.

### Second-review-only findings

- WarpCap statically exposes its repository root and local database.
- Save, submit, and release are not transactionally tied to the active task claim.
- WarpDiff's audio generation counters have an ABA/reset defect.
- Embedded FFmpeg is excluded while its loader and auto-transcode UI remain active.
- Project membership does not constrain global lead powers.
- Deployment can report two-host success after ignoring parity-check failure.
- `admin` is omitted from the single-task detail authorization check.
- CSP/token exposure, CDN provenance, and long-media Whisper risks exist.
- Browser and container smoke tests are absent from CI.

## Dynamically confirmed defects

### 1. Critical on an untrusted LAN — WarpCap exposes the repository and local database

The current server returned `200` for `/backend/data.db`, `/backend/server.js`,
`/docs/HANDOFF.md`, and `/tests/logic.test.mjs`, and listened on `TCP *:3000`. The diagnostic read
only response status, type, and size for the database.

The mechanism is root-wide static serving (`WarpCap/backend/server.js:63-72`), the default database
inside that tree (`WarpCap/backend/db.js:5-14`), and `app.listen` without a loopback host
(`WarpCap/backend/server.js:171-173`).

**Adjudication:** confirmed, with an important scope qualification. The local database exposure is
critical when development is reachable from an untrusted network. Fly places the production database
outside the static tree, but production still exposes copied repository internals under the current
root-wide static mount.

### 2. High — an older comparison load can replace a newer task's media

WarpCap's load message has no request ID, task ID, generation, or abort signal
(`WarpCap/ui/comparison.js:175-206`). WarpDiff independently fetches every message's files and applies
the result whenever that message's `Promise.all` completes (`WarpDiff/index.html:4732-4761`). The host
advances `_applyComparison._key` when it sends the message, before any child acknowledgment
(`WarpCap/ui/comparison.js:273-275`).

The current-source diagnostic sent a 700 ms `old` pair followed 20 ms later by a 50 ms `new` pair.
After both settled, `mediaData.editA` and `mediaData.editB` contained `old A` and `old B`.

**Adjudication:** confirmed with very high evidence quality. Prompt/questions can describe the new
task while WarpDiff displays the old pair, directly compromising evaluation integrity.

### 3. High — audio decode generation counters have an ABA failure

Both paths increment per-slot counters (`WarpDiff/js/audio-decode.js:14-20` and `:402-407`) and reject
stale completion by equality. `clearAllMedia()` replaces both maps with empty objects
(`WarpDiff/index.html:9559-9560`), so the next decode reuses generation `1`.

In a controlled runtime diagnostic, an old decode captured generation `1`, the counter map was reset,
a new decode captured generation `1`, the new decode resolved, and then the old decode resolved. The
final installed audio-only visualization belonged to the old decode. The ownership harness currently
requires both unsafe resets (`WarpDiff/tests/ownership.test.mjs:191-203`).

**Adjudication:** confirmed. Use a monotonic load epoch or monotonic counters that never reset.

### 4. High — embedded service-worker cache ownership is unsafe

The embedded app registers `sw.js` unconditionally (`WarpCap/warpdiff/index.html:12033-12035`). The
worker deletes every cache except its current one (`WarpCap/warpdiff/sw.js:10-16`) and handles every
same-origin GET made by a controlled client (`WarpCap/warpdiff/sw.js:19-37`).

In an isolated browser context, activation deleted a `warpcap-owned-probe` cache. After the child was
controlled, a fetch of `/docs/HANDOFF.md` was added to the `warpdiff-v3.12.25` cache.

The precache also includes `version.json` (`WarpCap/warpdiff/sw.js:2-6`), which the vendor allowlist
excludes (`WarpCap/scripts/vendor-warpdiff.mjs:42-45`). WarpCap's SPA fallback returns root HTML for
that missing path (`WarpCap/backend/server.js:146-150`), allowing installation with the wrong cached
representation.

**Adjudication:** confirmed. Embedded WarpDiff should not register its standalone PWA worker. Existing
registrations require a one-time, narrowly owned migration; simply stopping future registration is
insufficient.

### 5. Medium — embedded FFmpeg fallback is structurally broken

WarpDiff still auto-starts the transcode path and loads `./ffmpeg/ffmpeg.min.js`,
`ffmpeg-core.js`, and `ffmpeg-core.wasm` (`WarpCap/warpdiff/index.html:5348-5355`, `:5602-5660`). The
vendor script deliberately excludes `ffmpeg/` (`WarpCap/scripts/vendor-warpdiff.mjs:42-45`). All three
paths returned the 382 KB WarpCap HTML shell with status `200` under the current server.

**Adjudication:** confirmed but not a common-format release blocker. Keep the large FFmpeg binaries
excluded; either connect the fallback to a real WarpCap-owned source or explicitly disable it in
embed mode with an honest unsupported message. Missing `/warpdiff/*` assets must return 404 rather
than the SPA.

### 6. Medium — malformed preferences abort WarpDiff boot

`_prefs.load` performs unchecked `JSON.parse` (`WarpDiff/index.html:3123-3132`), and boot-time state
loads begin at `WarpDiff/index.html:4451`. With `pref_audioVizVisible` set to malformed JSON,
Chromium raised a parse error and the landing state remained `Loading…`.

**Adjudication:** confirmed. Catch parse failure, remove or ignore the malformed key, and return the
provided fallback.

### 7. Low/medium portability — `warpdiff/index.html` breaks under `npx serve`

The two product surfaces use `warpdiff/index.html` (`WarpCap/ui/comparison.js:155-161` and
`WarpCap/ui/lead-console.js:1095-1099`). In the supported `npx serve` setup, that path redirects
through `/warpdiff/index` to slashless `/warpdiff`, so relative `js/*` requests resolve at the site
root and fail. Express serves the explicit file correctly; the defect is host-specific. WarpCap's QC
runner already uses `warpdiff/`.

**Adjudication:** confirmed under the supported static host. Standardize on `warpdiff/`.

## Statically supported risks

### 8. High — task writes are not atomic with claim ownership

Annotation save reads ownership and separately upserts the annotation without requiring
`status='in_progress'` at the write (`WarpCap/backend/routes/tasks.js:669-703`).

Submit checks ownership before entering an in-process lock (`:714-724`), re-reads only `status`
inside it (`:831-835`), writes annotations, versions, reviews, copy-back, and possible review tasks
(`:836-909`), then conditionally completes only on `task_id` plus `status='in_progress'`
(`:934-940`). Release similarly writes its working copy before the guarded ownership election
(`:969-991`). The client debounce captures no task identity or abort signal
(`WarpCap/task-queue.js:397-420`).

**Adjudication:** strongly supported concurrency defect, although this adjudication did not run a
full two-connection race. An in-process mutex does not provide transactionality or multi-process
coordination. A claim revision/token is needed to prevent release/reclaim ABA, including reclaim by
the same user.

### 9. Medium — protocol duplication and incomplete origin validation

Two product builders exist at `WarpCap/ui/comparison.js:175-206` and
`WarpCap/ui/lead-console.js:1101-1113`. QC is a third, separate protocol consumer at
`WarpCap/qc/qc-runner.js:327-332`. The current ownership guard counts the whitespace-sensitive string
`type: 'WARPDIFF_LOAD'`, so it misses the preview builder (`WarpCap/tests/logic.test.mjs:2026-2028`).

The child checks `event.source` but not `event.origin`, and its failure reply targets `*`
(`WarpCap/warpdiff/index.html:4732-4736`, `:4771-4772`). The product host checks the iframe window but
not origin (`WarpCap/ui/comparison.js:88-91`).

**Adjudication:** duplication/correlation is a real correctness risk. Origin validation is secondary
defense in depth because source-window checks already meaningfully restrict senders.

### 10. Medium process risk — vendoring is non-transactional and weakly attested

The script resolves only a short SHA (`WarpCap/scripts/vendor-warpdiff.mjs:80-87`), removes live
allowlisted paths and extracts directly into the destination (`:89-112`), then validates and patches
the seam (`:114-154`). A seam-anchor failure can leave a partially updated working tree. Provenance
is recorded in mutable prose rather than a machine-verifiable manifest.

**Adjudication:** supported. Preserve git-ref input, the strict allowlist, anchor validation, the
plain-copy model, and FFmpeg exclusion. Add staging, a full immutable SHA, file hashes, seam-patch
identity, and a read-only verification mode.

### 11. Medium operational risk — deploy can report success despite drift

WarpCap pushes Pages, then deploys Fly (`WarpCap/scripts/deploy.sh:43-47`). It ignores the parity
check's failure and prints `Deployed ... to both hosts` (`:49-51`).

**Adjudication:** supported. Poll both hosts for the expected stamp to a bounded deadline, fail if
either does not converge, and print partial-deploy recovery instructions.

### 12. Launch gate — global lead powers are not project-scoped

`canWorkIn` owns annotator project access (`WarpCap/backend/access.js:45-50`), while lead routes use
the global lead/admin role gate (`WarpCap/backend/middleware/authMiddleware.js:49-56`). For example,
monitoring and project-settings routes accept a caller-supplied project without a membership check
(`WarpCap/backend/routes/reviews.js:34-44`, `:253-269`).

**Adjudication:** not a defect under the documented trusted organization-wide lead model. It becomes
a security boundary before delegated project leads or multi-tenant use. The smaller omission of
`admin` from task-detail authorization (`WarpCap/backend/routes/tasks.js:641-644`) is a current role
inconsistency unless deliberately specified.

### 13. Governance — licensing metadata conflicts

`WarpDiff/README.md:121-123` says redistribution and derivative use are not licensed, while
`WarpDiff/package.json:16` declares ISC and no license file is present.

**Adjudication:** confirmed governance ambiguity. Choose one authoritative policy and align all
metadata before external distribution or derivative licensing decisions rely on it.

### 14. Low performance risk — overlapping visualization decode

Audio-only loading retains `audioFileBuffers[slot]` while `decodeAndComputeAudioSlotViz` runs
(`WarpDiff/index.html:7263-7277`). Opening the W panel before it finishes can start
`decodeAndComputeAudioViz` because `waveformData` is still absent (`:6018-6027`). The paths use
different generation counters.

**Adjudication:** plausible performance risk, not a reproduced correctness failure. Share the
expensive per-slot decode/analysis promise only if measurement shows meaningful duplication.

### 15. Lower-priority security and long-media risks

- CSP is disabled for the inline architecture (`WarpCap/backend/server.js:26-30`), while bearer
  tokens live in localStorage (`WarpCap/auth.js:107-115`). No XSS path was found.
- Whisper and analysis engines load pinned CDN code at runtime
  (`WarpCap/ml/whisper.js:47-65`, `WarpCap/ui/analysis-engines.js:255`). Pinning is preferable to
  floating versions, but self-hosting would reduce availability and provenance risk.
- Whisper resamples full audio and invokes chunked transcription from the page's application flow
  (`WarpCap/ml/whisper.js:83-95`, `:220-246`). The reported long-video freeze is real evidence that
  warrants diagnosis, but neither review established Whisper as its cause.

**Adjudication:** real exposure multipliers and robustness concerns, not confirmed current security
defects. Diagnose the actual long-media failure before choosing a worker or memory-budget fix.

## Direct disagreements and reconciliation

### Service-worker fetch scope

The first review is correct. The second review's statement that fetch interception is safely scoped
to `/warpdiff/` is false. Service-worker scope limits which documents are controlled, not the
destination URLs those controlled documents request. Current source and the isolated diagnostic
both show that a controlled WarpDiff page can cache other same-origin resources.

### FFmpeg exclusion

This is reconcilable rather than a reason to vendor the binary. The first review is right that the
large FFmpeg bundle should remain excluded. The second is right that retaining an active local loader
and a “no install required” fallback is broken. Keep the exclusion and make the embed behavior honest.

### Number of protocol owners

The first review correctly identifies two duplicated product builders. The second's count of three
is literally correct when the QC engineering surface is included. QC must participate in protocol
version/contract tests, but it does not necessarily need to share product adapter lifecycle state.

### Fit/Ref scale controls

The second review's stable-state clicks are reproducible, but “no change justified” is too broad. At
1024×640, an immediate opening-state diagnostic observed a visible Fit center hit-testing to
`#videoControls` and Ref temporarily below the viewport; after the 300 ms transition, both controls
were topmost and clickable. This reconciles the second review with WarpCap's live-QC report: there is
a transient transition/hit-test gap, not a confirmed persistent obstruction. It is low-severity UI
residue, not an architectural blocker.

## Outdated, overstated, or insufficiently supported claims

- No source finding is outdated: both reviews inspected the revisions adjudicated here.
- The second review's service-worker fetch-scope assertion is incorrect.
- The second review's “first four are release-blocking” statement needs its stated threat-model
  qualifier: local database exposure is critical for untrusted LAN use; the production database is
  outside the static tree.
- The second review originally demonstrated the audio ABA mechanism mainly through counter reuse.
  The current controlled-promise diagnostic strengthens that to an actual stale overwrite.
- The first review's “insufficiently authenticated protocol” wording overstates the current attack
  surface. Missing origin checks matter, but the source-window checks are already meaningful.
- The first review's URL issue is real under `npx serve`, not under Express.
- Project-scoped lead authorization is a future boundary under the current trusted-global-lead model.
- The Whisper worker recommendation is directionally plausible, but the reported freeze's mechanism
  remains undiagnosed.
- Neither review established real-device memory failures from WarpDiff's bounded scrub cache.

## Merged severity-ranked recommendations

1. **Critical:** replace root-wide static serving with explicit public mounts or a generated public
   directory; add deny/404 tests; bind local development to `127.0.0.1` unless LAN mode is explicit.
2. **High:** add correlated, cancelable WarpDiff loads; clear or obscure old media immediately;
   acknowledge applied/failed requests; gate submission on the current matching acknowledgment.
3. **High:** add a monotonic claim revision/token and make save, release, and submit transactional,
   with ownership election before dependent writes.
4. **High:** make audio/load generations monotonic across clear and reload.
5. **High:** suppress the standalone service worker in embed mode; migrate existing `/warpdiff/`
   registrations; delete only owned `warpdiff-*` caches; restrict standalone caching to explicit
   WarpDiff assets and extend cache-write event lifetime.
6. **Medium:** return honest 404s for missing `/warpdiff/*`; either connect embedded FFmpeg to a real
   owner or state that transcoding is unavailable.
7. **Medium:** consolidate product load construction/sequencing into one adapter, require exact
   origins, use `warpdiff/`, and add protocol-contract tests for QC.
8. **Medium:** make `_prefs.load` resilient to malformed JSON.
9. **Medium:** stage, patch, hash, and validate vendor updates before replacing the live tree; record
   a full-SHA provenance manifest.
10. **Medium:** make deploy parity a bounded, blocking convergence check.
11. **Governance/launch gates:** resolve licensing; add project-scoped lead authorization before
    delegated or multi-tenant use.
12. **Evidence-driven later:** overlapping decode, aggregate scrub budgeting, CSP, dependency
    self-hosting, and long-media analysis isolation.

## Explicit leave-unchanged list

- Keep the same-origin iframe boundary.
- Keep server-side blinding and WarpCap-owned verdict submission.
- Keep the no-build/classic-script architecture for now.
- Keep pure demux/timecode/math boundaries and existing transport/RVFC/Opus-sync owners.
- Keep the plain vendored-copy model; do not introduce a submodule.
- Keep FFmpeg binaries excluded from the vendor tree.
- Keep current desktop scrub-cache defaults until field evidence shows memory failures.
- Keep WarpCap's `session`/`state` bags, selective render scheduler, and manifest-derived undo.
- Keep public `/media` for the documented non-sensitive pilot; signed media remains a sensitive-data
  launch gate.
- Do not undertake a broad module, state-management, framework, or CSP rewrite as part of these fixes.
- Do not redesign stable-state Fit/Ref controls based on these reviews alone.

## Smallest safe implementation sequence

1. Add failing regressions for static exposure, reverse-order loads, claim races, audio ABA, cache
   ownership/migration, malformed preferences, missing FFmpeg assets, and `npx serve` routing.
2. Independently close the WarpCap static-root/listener exposure and add honest `/warpdiff/*` 404s.
3. Introduce claim revision and convert save/release/submit into election-first database transactions.
4. Fix upstream WarpDiff: monotonic load/audio epochs, abort/correlation/ack protocol, safe
   preferences, embed-mode service-worker suppression, and owned cache policy.
5. Re-vendor that upstream revision and, in the same WarpCap integration slice, install the shared
   host adapter, ready-gated submission, exact-origin checks, old-worker migration, and `warpdiff/`
   URLs.
6. Explicitly disable or correctly route embedded FFmpeg.
7. After correctness is restored, add the vendor manifest/staging flow and truthful deploy
   convergence check.
8. Defer CSP, shared decode, scrub-budget, and broad module work until measured evidence justifies it.

## Verification boundary

Current, non-mutating checks completed during adjudication:

- WarpCap logic harness: **1,049 passed, 0 failed**.
- WarpCap `scripts/ci-check.mjs`: **passed**, including the TypeScript and documentation gates.
- WarpDiff ownership harness: **265 passed, 0 failed**.
- `git diff --check`: clean in both repositories.

Targeted isolated diagnostics reproduced:

- slow-old WarpDiff load overwriting fast-new media;
- audio-generation reset admitting an old completion after a new completion;
- service-worker activation deleting an unrelated cache;
- a controlled WarpDiff client caching `/docs/HANDOFF.md`;
- WarpCap serving its local database and repository files on an all-interface listener;
- vendored FFmpeg paths returning the WarpCap SPA instead of runtime assets;
- malformed WarpDiff preferences aborting startup;
- `warpdiff/index.html` redirecting to a base URL that breaks relative runtime assets under
  `npx serve`;
- stable-state Fit/Ref hit-testing succeeding, with a separate transient opening-state miss.

The adjudication did **not** inspect deployed hosts, production data, production browser caches,
CDN configuration, or real-device memory pressure. It did not dynamically reproduce the task-claim
race across two database connections. Those boundaries remain explicit rather than inferred.
