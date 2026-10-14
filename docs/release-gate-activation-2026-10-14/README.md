# Interim release safeguards activation — October 14, 2026

Jay explicitly approves activating main protections, pushing the final
verification notes, opening the pull request and running final hosted checks.
Merge and publication remain held. Pages still deploys automatically from
main `/`; no main commit, merge or deployment is part of this task.

## Activated protections

Main started unprotected at `75eb81f701de89628d432148c46dac87b18f0d98`, with no
repository rulesets ([branch snapshot](main-before.json), [rulesets](rulesets-before.json)).
The two previously successful checks were confirmed to come from GitHub Actions
app **15368** before applying the approved settings.

The active rules require:

- `Chromium and ownership` and `WebKit preparation workflow`, both from that app.
- An up-to-date branch, pull requests and resolved review conversations.
- Enforcement for administrators, with force pushes and branch deletion blocked.
- Zero additional reviewer approvals for this solo-maintainer repository.

The [effective request](main-protection-request.json), [API application response](
main-protection-applied.json) and [fresh read-back](main-protection-readback.json)
record these settings. Each required field was compared against the approved
values; all matched. Main's commit stayed unchanged.

The first API request failed with **HTTP 422**, because the proposed payload
included both the old `contexts` array and the app-scoped `checks` array. The
[error](main-protection-first-error.json) and [unprotected read-back](
main-protection-first-readback.json) are retained. The retry uses only `checks`
with the same names, app ID and strict setting; no approved policy was weakened.
The earlier proposal file is corrected too. The [official REST documentation](
https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection)
describes the app-scoped check fields and zero-reviewer setting. The successful
API response and read-back establish acceptance of the effective request.

## Pull request and enforcement observation

The previously local result-note commit `b42910e` was pushed to the existing
`codex/interim-release-review` branch. Its seven changed files are the completed
review/hosted-result records; application and workflow code are unchanged from
the tested `86dcd26` revision.

[Pull request #44](https://github.com/jayriddle/warpdiff/pull/44) targets main.
It is open, is not a draft, and has no auto-merge request. Its initial head was
`b42910ec404fddba73b6e09151d2b67f59d890bc`. With the new required checks pending,
GitHub reported **`mergeStateStatus: BLOCKED`**, which verifies blocking on an
ordinary PR rather than a draft restriction ([snapshot](pr-initial.json)).
This is a read-only enforcement observation; no merge attempt was made.
The configured required-check policy also requires passing results. A separate
intentionally failing source/PR was not needed for the pending-check observation.

This activation record and the request-format correction are included in the
final feature revision. The pull request's checks and description provide the
current final revision and hosted results. The [prior reviewed runtime record](
../feature-branch-review-2026-10-14/README.md) preserves the 433 Chromium / 42
WebKit / 523 hosted ownership pass before this documentation-only preparation.
Results and any failed checks from the final gate are retained separately;
old passes do not substitute for checks on the final PR revision.

The desktop CI-diagnostics tool requested a connected GitHub account and could
not read this PR. Workflow execution and final verification use GitHub's own
API/reports through the already authorized repository account. No additional
connector setup is required for this release task.

## Release decision still held

After both required checks pass on the final revision, the PR remains open for
Jay's release decision. Main protection activation does not authorize merging
or publication. Broader host-load handling, measurement accuracy, prepared-media
modules and historical FFmpeg distributions remain separate work. Core package
metadata remains UNLICENSED/private; no new reuse license is granted.
