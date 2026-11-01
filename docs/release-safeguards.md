# Testing and publication safeguards

The protected GitHub checks remain **Chromium and ownership** and
**WebKit preparation workflow**. Main protections were activated October 14,
2026; their API readbacks are retained in the activation and publication
records. GitHub Actions publishing was activated with PR #46 on October 15.
Each new feature slice still needs its own release authorization.


## Check triggers and coverage

`WarpDiff checks` runs on pull requests targeting `main`, pushes to `main`,
and explicit manual dispatch. Feature-branch pushes no longer automatically
run a second complete suite alongside a PR. Before opening a PR, dispatch the
existing workflow explicitly against the feature branch when hosted evidence
is needed. A manual run cannot publish, even when its selected ref is `main`.
No path filters can leave required PR checks pending.

Chromium runs in three separate Ubuntu 24.04 jobs. `scripts/ci-shards.mjs`
assigns every `tests/*.spec.ts` file to exactly one shard so the slow files are
not all on the first runner. `playwright.ci.config.ts` keeps **one worker and
zero retries per machine**. The tests themselves and their assertions do not
change. Ubuntu jobs install one pinned static FFmpeg and
ffprobe build for fixtures, preparation, and command verification, and reject
it when the SHA-256 does not match. The pinned build is hosted on the
ci-ffmpeg-n8.1.3 release. zsh still comes from apt with recommended
packages omitted. The installed Chrome channel supplies the native codecs
absent from an earlier bundled Linux Chromium experiment; its install does not
pull the apt font and xvfb bundle. This uses more runner
capacity to reduce elapsed time; faster results must be measured on hosted
runners, not inferred from division alone.

Each shard uploads its JSON execution report and failure diagnostics. The
protected **Chromium and ownership** aggregation job runs even when a dependency
fails, requires successful ownership/infrastructure and all Chromium jobs,
then compares the three reports against the complete current test inventory.
Missing tests, duplicates, missing reports, retries, runner errors, flaky results,
and skips fail the gate. The timestamp-collision case is an ordinary passing
test, so a skip there is rejected like any other skip.
A new spec file has to be added to exactly one Chromium shard; the
infrastructure test rejects a missing or repeated file.

The separate ownership job generates actual media fixtures before the harness,
so its fixture-backed parsing checks cannot silently disappear in a fresh
checkout. It also runs the fast infrastructure tests, including negative report
and publication-gate scenarios. Two local ownership checks inspect neighboring
WarpCap sources unavailable in GitHub's checkout; hosted totals therefore
remain two lower than local totals.

WebKit runs the same focused profile on three macOS 15 shards: external commands,
preparation/reload, source-format replacement, preview pitch and eight Opus
scheduling cases. `scripts/ci-shards.mjs` assigns each `playwright.webkit.config.ts`
file to one shard, and that config's project `testMatch` / `grep` filters still
apply on every shard. The protected **WebKit preparation workflow** job is the
aggregate. It runs on macOS 15, even when a shard fails, requires all three
shard jobs, and checks their JSON reports against a macOS inventory with the
same gate as Chromium. The inventory has to be listed on macOS because a few
picture tests are registered only there.
Publish still waits on that aggregate, so a shard failure cannot publish.
The profile does not certify installed Safari or native 7.1 FLAC
support. The two broader WebKit surround capability failures remain documented
separately, with their assertions retained. One in-suite WebKit expectation
(`preparation-followup.spec.ts`, corrupt frames) is an expected failure with a
fixed reason; the gate accepts that identity only, requires the failure, and
does not count it as a pass. Scheduling tests do not render PCM.

Actions are pinned to exact commits. Repository access defaults to read-only;
checkout credentials are not persisted. Only the deployment job requests Pages
and identity-token write permissions. Browser failure diagnostics and results
are retained for 14 days. Npm dependencies are locked; no FFmpeg engine is
shipped, downloaded or run by the browser.

## Public artifact and deployment gate

`scripts/stage-pages.mjs` packages only the service worker's runtime assets,
`sw.js`, the landing logo and the Signalsmith notice. It rejects untracked,
non-regular or unexpected public files and refuses to overwrite an existing
stage directory. The staging step pins runtime files under `releases/<commit>/`.
JavaScript and vendored engine files retain their source bytes. The public HTML
adds a relative base URL, script integrity checks, a first-load retry notice and
a small document-owned bundle of the three lazy audio entry points. The analysis
worker's embedded copy imports the exact analysis source through a data URL;
canonical worker/worklet files remain unchanged. This keeps managed frames and
open pages independent of later deployments for those lazy scripts.

The staged service worker contains the exact bundle's integrity manifest. It
bypasses the HTTP cache when installing and activates only after every entry
passes. Scope-specific caches keep referenced releases; unidentified legacy
clients conservatively preserve prior app caches. An older controller cannot
retire a newer installation. Navigations revalidate online and use the installed
complete document offline, including query settings. Updates never reload an
open comparison. Browser storage restrictions and eviction remain limitations.

`version.json` is a plain empty placeholder in the checkout and is stamped with
the exact workflow SHA in the artifact. The pinned manifest preserves the app's
root installation identity. A separate SHA-256 manifest describes every public
file. Root HTML, worker and version data are expected transformations; compare
JavaScript and vendored files with source, and validate all artifact hashes.
Local source serving still needs no build step. The staged release guarantees
apply to the Pages artifact, not arbitrary manually assembled source copies.

Docs, tests, tools, local evidence, dependencies and retired FFmpeg files are
not in that artifact. `output/` and `blob-report/` are ignored by Git; `output/`
is also excluded from legacy Pages. Compact durable verification summaries
remain in `docs/`; raw copies, reports and traces remain local or in CI artifacts.

The same workflow stages the public artifact on PR/manual runs, allowing the
actual packaging path to be tested without deployment. `Publish verified main`
requires both protected checks and successful staging. It runs only after
success on a **push to `refs/heads/main`**. Failed, skipped or cancelled checks
cannot qualify; PRs and manual dispatch cannot publish. That push has to be a
real `push` event. A merge performed by an integration that does not emit one
leaves the commit on `main` unpublished: `workflow_dispatch` still runs the
tests, and `Publish verified main` stays skipped because it requires
`github.event_name == 'push'`. A cancelled main run cannot start a later
deployment job. A deployment already underway cannot be recalled by cancelling
an Actions run; verify the served SHA after publication.

## Release review and verification

A feature branch or pull request cannot publish. After approval of the exact
candidate and explicit authorization to merge and publish:

1. Read back protections, the approved PR head and both required checks. Keep
   strict freshness, the PR rule, administrator enforcement, conversation
   resolution and force-push/deletion restrictions.
2. Confirm Pages remains configured for **GitHub Actions**. Do not re-enable the
   old branch/root publishing path or bypass the normal merge gate.
3. Merge normally. The main-push workflow checks and packages that exact commit;
   a failed check must retain the existing published site.
4. Verify the complete public manifest, generated release identity and successful
   exact-main jobs. Smoke-test the live app and its installed offline copy. For
   loader changes, also verify an upgrade from a warmed previous installation.
5. Check excluded tooling/evidence paths still return 404. Preserve failed runs
   and limitations in the release record.

Feature-branch tests establish packaging and behavior locally and in hosted
browsers. Actual Pages publication remains a separate verification step after
release authorization. Historical FFmpeg distributions require separate work.

## Local checks and reproduction

Install native FFmpeg, run `npm ci`, and install the relevant Playwright browser.
Use:

```sh
npm run test:infra
npm run test:ownership
WARPDIFF_BROWSER_CHANNEL=chrome npm run test:ci
npm run test:webkit
```

Missing media fixtures are generated by global setup; `npm run test:fixtures`
generates them explicitly. CI requires its own localhost:8080 server. Locally,
verify that any reused server serves this checkout. Run the complete behavioral
suite and ownership checks before pushing, as required by `AGENTS.md`; focused
checks are appropriate during individual edits.

To run one hosted-equivalent portion locally:

```sh
npm run test:ci -- $(node scripts/ci-shards.mjs chromium 1)
npm run test:webkit -- $(node scripts/ci-shards.mjs webkit 1)
```

Use `2` and `3` for the other shards. Separate hosted runners provide the
speedup; concurrent media suites on one machine are not the benchmark.

`npm run test:mutations` is the manual Opus mutation runner in
`tools/investigations/opus-timing/`. It needs an existing localhost:8080 server
and installed Chrome, and writes ignored evidence under `output/`. Pass a fresh
output directory with `npm run test:mutations -- /path/to/evidence`. Keep exact
mutation target strings synchronized with `js/opus-sync.js`; missing or
ambiguous targets fail loudly. These negative probes are required when changing
that scheduling contract or its tests, not on every unrelated edit.

References: [Playwright sharding](https://playwright.dev/docs/test-sharding),
[Playwright CI](https://playwright.dev/docs/ci),
[custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
and the [original protection activation](release-gate-activation-2026-10-14/README.md).
