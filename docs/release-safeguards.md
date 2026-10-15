# Testing and publication safeguards

The protected GitHub checks remain **Chromium and ownership** and
**WebKit preparation workflow**. Main protections were activated October 14,
2026; their API readbacks are retained in the activation and publication
records. This infrastructure revision is proposed on a feature branch. It
must not be merged, activate Pages settings, or publish without Jay's review.

## Check triggers and coverage

`WarpDiff checks` runs on pull requests targeting `main`, pushes to `main`,
and explicit manual dispatch. Feature-branch pushes no longer automatically
run a second complete suite alongside a PR. Before opening a PR, dispatch the
existing workflow explicitly against the feature branch when hosted evidence
is needed. A manual run cannot publish, even when its selected ref is `main`.
No path filters can leave required PR checks pending.

Chromium runs in three separate Ubuntu 24.04 jobs. `playwright.ci.config.ts`
enables test-level sharding, including the large legacy spec, with **one
worker and zero retries per machine**. The tests themselves and their
assertions do not change. Native FFmpeg and zsh support fixtures and command
verification; the installed Chrome channel supplies the native codecs absent
from an earlier bundled Linux Chromium experiment. This uses more runner
capacity to reduce elapsed time; faster results must be measured on hosted
runners, not inferred from division alone.

Each shard uploads its JSON execution report and failure diagnostics. The
protected **Chromium and ownership** aggregation job runs even when a dependency
fails, requires successful ownership/infrastructure and all Chromium jobs,
then compares the three reports against the complete current test inventory.
Missing tests, duplicates, missing reports, retries, runner errors, flaky results,
and additional skips fail the gate. The single existing timestamp-collision
skip is accepted only by its exact test identity and documented reason.

The separate ownership job generates actual media fixtures before the harness,
so its fixture-backed parsing checks cannot silently disappear in a fresh
checkout. It also runs the fast infrastructure tests, including negative report
and publication-gate scenarios. Two local ownership checks inspect neighboring
WarpCap sources unavailable in GitHub's checkout; hosted totals therefore
remain two lower than local totals.

The macOS 15 WebKit job retains the complete focused profile: external commands,
preparation/reload, source-format replacement, preview pitch and eight Opus
scheduling cases. It does not certify installed Safari or native 7.1 FLAC
support. The two broader WebKit surround capability failures remain documented
separately, with their assertions retained. Scheduling tests do not render PCM.

Actions are pinned to exact commits. Repository access defaults to read-only;
checkout credentials are not persisted. Only the deployment job requests Pages
and identity-token write permissions. Browser failure diagnostics and results
are retained for 14 days. Npm dependencies are locked; no FFmpeg engine is
shipped, downloaded or run by the browser.

## Public artifact and deployment gate

`scripts/stage-pages.mjs` packages only the service worker's runtime assets,
`sw.js`, the landing logo and the Signalsmith notice. It rejects untracked,
non-regular or unexpected public files and refuses to overwrite an existing
stage directory. Everything is copied byte-for-byte except `version.json`,
which becomes JSON identifying the exact checked-out workflow commit. The
source file retains its Jekyll template for compatibility with the existing
legacy publishing mode. No Jekyll compilation or runtime build step is needed
for the proposed artifact. A SHA-256 manifest is retained separately.

Docs, tests, tools, local evidence, dependencies and retired FFmpeg files are
not in that artifact. `output/` and `blob-report/` are ignored by Git; `output/`
is also excluded from legacy Pages. Compact durable verification summaries
remain in `docs/`; raw copies, reports and traces remain local or in CI artifacts.

The same workflow stages the public artifact on PR/manual runs, allowing the
actual packaging path to be tested without deployment. `Publish verified main`
requires both protected checks and successful staging. It runs only after
success on a **push to `refs/heads/main`**. Failed, skipped or cancelled checks
cannot qualify; PRs and manual dispatch cannot publish. A cancelled main run
cannot start a later deployment job. A deployment already underway cannot be
recalled by cancelling an Actions run; verify the served SHA after publication.

## Activation after review

**The feature-branch work does not change live Pages settings.** The current
legacy `main` / root publishing mode still deploys independently of post-merge
checks. Adding this workflow alone does not intercept that legacy path.

After Jay approves the exact candidate and explicitly authorizes activation,
merge and publication:

1. Re-read main protection, the approved PR head and required checks. Preserve
   the two existing app-scoped required check names, freshness, PR rule,
   administrator enforcement, conversation resolution and force-push/deletion
   restrictions.
2. Before merging, switch the repository's Pages publishing source from
   **Deploy from a branch** to **GitHub Actions**. This disables the independent
   legacy publication path while leaving the last successful site available.
   Do not merge first and leave a window in which legacy Pages can publish
   before the checks finish.
3. Merge the approved PR normally. Its main-push workflow runs the complete
   checks and publishes only on success. If checks fail, retain the existing
   published site, fix on a feature branch and repeat review.
4. Confirm the Pages artifact's commit, successful exact-main checks, live
   `version.json`, source hashes, service worker installation and a short
   browser smoke check. Expand live testing when the runtime change warrants it.
5. The old registered preview workflow can be disabled separately after review;
   no workflow registration or repository setting is changed by this branch.

The deployment itself cannot be end-to-end verified while publication is on
hold. Local policy tests and a hosted manual run can prove gating, packaging
and test execution; actual Pages activation and publication remain release
verification steps. Historical FFmpeg distributions require separate work.

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

To run one hosted-equivalent portion locally, append `-- --shard=1/3` to
`npm run test:ci` (then 2/3 and 3/3 as needed). Separate hosted runners provide
the speedup; concurrent media suites on one machine are not the benchmark.

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
