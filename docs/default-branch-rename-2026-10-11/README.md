# Default branch rename — October 11, 2026

Jay authorized renaming the default branch from `master` to `main`. The migration is complete on GitHub and in this checkout. GitHub Pages now reads `main` at the repository root. Both the old default branch before the rename and the new default branch after it point to `75eb81f701de89628d432148c46dac87b18f0d98`. No application commit was merged or pushed during this task, and the command-quoting work remains separate on the local `codex/safe-ffmpeg-command` branch.

## Starting state and scope

The [starting receipt](before.json) records GitHub's default branch, its SHA and protection state, Pages settings and latest build, registered workflows, open pull requests, local branch tracking, worktrees and pre-existing untracked file paths. The account had repository administration permission. The default branch was unprotected, no open pull requests required retargeting, and Pages had successfully built the same `75eb81f` commit. The feature branch was at `62667591d1f609274ff9a00f17e0010434d309ae`, with no tracked changes.

The authorized change covers the branch name, local tracking, Pages references and active documentation. It does not include merging or publishing command-quoting changes, deleting other branches, introducing CI or branch protection, changing app versions, or revising historical investigation records.

## Actions and decisions

1. Used GitHub's branch-rename API, rather than creating a new remote branch and deleting the old one manually. The [rename response](rename-response.json) returned `main` at the original commit. GitHub's documented operation also handles branch-related repository metadata: [branch rename API](https://docs.github.com/en/rest/branches/branches#rename-a-branch), [rename behavior and local checkout guidance](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/renaming-a-branch).
2. Renamed the local `master` branch to `main`, fetched the new remote reference, set `main` to track `origin/main`, and refreshed `origin/HEAD`. The active feature checkout was not switched. The two other registered worktrees were detached and needed no branch rename. After a fresh remote listing confirmed `master` was absent, removed only its stale local remote-tracking reference; unrelated branches were not pruned.
3. Verified that GitHub automatically changed Pages' source to `main` and `/`. No separate Pages source update or forced rebuild was necessary. The `github-pages` environment already allowed `main` when inspected, but also retained a rule allowing `master`. Removed that retired-name rule after confirming `main` was allowed. The [policy before cleanup](pages-policies-before-cleanup.json) and [policy after cleanup](pages-policies-after.json) retain the exact results. This is deployment-reference maintenance, not a new protection policy.
4. Searched tracked files for branch references, including explicit Git references, raw GitHub URLs, workflow filters and plain `master` mentions outside historical records. The one active branch instruction was the release checklist in [CLAUDE.md](../../CLAUDE.md), now changed to `main` locally. Other current-code occurrences refer to audio volume or clock ownership and remain accurate. The registered preview workflow has no file in the current checkout; its existing registration was left for the planned tooling cleanup. No tracked workflow branch filter needed updating.
5. Saved this record and the local documentation correction on the existing feature branch. These documentation changes remain local for review. Remote `main` intentionally retains the original release commit, including its older documentation; the local release-checklist correction can accompany a later approved documentation or feature update.

## Verification and meaningful observations

GitHub's rename API documents asynchronous completion. Immediately after its successful response, the first repository/Pages reads still said `master`, and a Git remote read briefly advertised both names. Independent local tracking work proceeded, then fresh reads converged to `main` without another rename or manual default-branch update. The final remote listing contains only `refs/heads/main` for these names. This transient state was not treated as a failed migration.

| Check | Measured result | Evidence |
| --- | --- | --- |
| GitHub default branch | `main`, same full SHA as before | [Final receipt](after.json) |
| Remote advertised default | `HEAD` resolves to `refs/heads/main`; retired remote branch absent | Final receipt |
| Local default branch | `main` at `75eb81f`, tracking `origin/main`; `origin/HEAD` points to `origin/main` | Final receipt |
| Pages source and status | `main`, root `/`, status `built`; latest successful build remains at `75eb81f` | Final receipt |
| Deployment environment | Permits `main`; retired `master` rule removed | Policy receipts above |
| Live runtime identity | 29 of 29 untransformed runtime text files returned HTTP 200 and matched SHA-256 hashes computed from the unchanged release commit | [Live source verification](live-source-verification.json) |
| Live revision and app version | `version.json` returned HTTP 200 with `sha: 75eb81f…`; exact matching `index.html` source defines `APP_VERSION` as `3.19.0` | Live source verification |
| Feature work | Feature implementation/review commit remained `6266759` throughout the migration; no merge or push | Final receipt |
| Existing unrelated files | Pre-existing untracked paths unchanged | Starting and final receipts |
| Documentation diff | One active branch-name replacement; whitespace check passed | Local commit diff |

The first live verifier incorrectly expected `version.json` to contain `commit` and `version` properties. It reported a failed check even though all 29 runtime hashes passed and the endpoint correctly returned its existing `sha` property. The [first receipt](live-source-verification-first.json) preserves those successful file checks and the actual response. The corrected verifier checks `sha` against the release commit and obtains `APP_VERSION` from the hash-matched source. That corrected check passed. This was a verification-script assumption, not an application failure.

No new Pages run appeared in the checks. The most recent completed successful run remains the historical [deployment of `75eb81f`](https://github.com/jayriddle/warpdiff/actions/runs/38112409880), whose recorded branch name remains `master`. Historical run labels are not evidence that the current source setting is wrong. No build was forced solely to rename the branch. Runtime assets and their published hashes are unchanged, so no version/cache bump or application test rerun was required; no Git push was performed.

## Remaining limits and other checkouts

The source identity check confirms the public files at [the unchanged live address](https://jayriddle.github.io/warpdiff/). It is not a new hosted interaction, installed-PWA upgrade, or native Safari test. The next approved push to `main` should use the normal publication verification procedure. Branch protection and CI remain separate, unresolved review items.

This task updated this repository's shared Git metadata and its registered worktrees. Other independent clones, forks, external automation and externally held raw-file links were not inventoried. Existing normal GitHub branch links have GitHub's documented redirects; raw URLs and old Git tracking need explicit updates. In another clone that still has a local `master` branch, the standard migration is:

```sh
git branch -m master main
git fetch origin
git branch --set-upstream-to=origin/main main
git remote set-head origin -a
```

Older project records deliberately retain the names and commits that were true when those actions occurred.
