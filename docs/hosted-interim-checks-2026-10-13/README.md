# Interim feature-branch push and hosted checks — October 13, 2026

Jay confirms the lower tone is gone in installed Safari after the brief-preview
fix. He authorizes pushing `codex/interim-release-review` and running the
proposed hosted checks. **Merge, publication and protection activation remain
held.** This record does not declare complete Safari or multichannel acceptance.

## Scope and remote preflight

- Remote default branch: `main`, at
  `75eb81f701de89628d432148c46dac87b18f0d98`, freshly read before this push.
- GitHub Pages uses the legacy branch build from `main` at `/`. The feature
  branch has no deployment workflow. Pushing it is scoped to test execution.
- The feature branch did not exist remotely at preflight. The push will create
  only `refs/heads/codex/interim-release-review`, without force or tags.
- The existing preview-deployment workflow remains registered but its file is
  absent from this feature branch. No workflow registration is removed here.
- The branch contains safe command quoting, the unintended ISC metadata
  correction, browser FFmpeg removal, release checks, the short-soundtrack
  picture-retention fix and the brief-preview pitch fix. The LGPL replacement
  experiment and broader reliability/prepared-media branch are not ancestors.
- `main` is currently unprotected; the documented protection payload remains a
  proposal. No repository setting will be changed by this task.
- Prior local checks: affected Chromium suites 25/0; expanded WebKit profile
  31/0; ownership 525/0. The earlier full Chromium pass predates the pitch fix,
  so the hosted full-suite result must be read for the exact pushed revision.

## Hosted run

Pending the feature-branch push. The workflow is `WarpDiff checks`, triggered
by the push. It has two jobs:

- **Chromium and ownership** — Ubuntu 24.04, Node 24, native FFmpeg/zsh,
  Chrome media codecs, fixture generation, ownership and complete Chromium.
- **WebKit preparation workflow** — macOS 15, Node 24, native FFmpeg,
  command/preparation/reload and brief-preview pitch checks.

Both browser gates use one worker and zero retries. The workflow has a read-only
token, exact action pins and no merge/deployment step. Hosted failures will be
recorded and addressed on this feature branch before considering a release.

## Remaining decisions

Read both job conclusions and the tested SHA. Resolve any hosted failures and
retain the evidence. Then review the result with Jay. Main protection,
pull-request/merge approval, publication and served-site verification remain
separate actions. Historical FFmpeg distribution remediation and broader
host-load/audio-measurement changes remain separate work.
