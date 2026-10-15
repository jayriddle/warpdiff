# Testing and release infrastructure — October 15, 2026

Authorized scope: implement, test and document on a feature branch; no merge,
Pages activation or publication before review. Baseline is released main
`67a3c843025d2022d4aae8bec9a598d15a9e15b0`; branch is
`codex/testing-release-infrastructure`.

## Changes and rationale

- Limit automatic hosted runs to PRs targeting main and pushes to main. Retain
  explicit manual dispatch for pre-PR branch verification. Include the event
  type in concurrency groups so a manual check cannot cancel a main-push release.
- Divide Chromium at test granularity across three independent Ubuntu jobs,
  each with one worker and zero retries. Keep all browser test sources and
  assertions intact. The large legacy spec need not be physically split to
  distribute it; unchanged helpers and synchronous scenarios remain available
  in each isolated checkout.
- Preserve both existing protected check names. The Chromium aggregation check
  requires successful ownership/infrastructure and all three Chromium jobs,
  then verifies complete, disjoint execution against the current inventory.
  Missing/duplicate cases, missing reports, runner errors, unexpected skips,
  flaky results and retries fail. The existing timestamp-collision skip is
  allowlisted by exact identity and reason.
- Generate media fixtures in the separate ownership job before executing the
  harness, preserving its fixture-backed checks in a fresh checkout.
- Add fast behavioral tests for gate failures and packaging boundaries. YAML
  2.9.1 is a pinned development-only parser for those tests; application reuse
  metadata remains UNLICENSED. Third-party dependency metadata is unchanged
  in meaning and does not set the application's license.
- Stage the website from an explicit restricted runtime inventory, including
  the logo and third-party notice. Preserve runtime bytes and stamp version.json
  with the checked-out SHA. Reject untracked assets, symlinks, unexpected paths
  and existing staging directories. Store a separate SHA-256 manifest.
- Prepare a deployment job that depends on both protected checks and successful
  staging, and permits publication only on successful main-push runs. PR and
  manual runs exercise packaging but cannot publish.
- Ignore generated output and exclude it from legacy Pages too. Relocate the
  Opus mutation runner into tools/investigations and expose test:mutations;
  retain manual invocation, exact-target fail-closed behavior and reproduction
  instructions. Keep compact verification records in docs.

## Activation boundary

Live Pages configuration and main protections are unchanged by this work.
Legacy Pages still publishes main independently until its source is changed.
The new gate must be activated by switching Pages to GitHub Actions **before
an approved merge**, preventing an intervening legacy deployment. See the
[activation sequence](../release-safeguards.md#activation-after-review).
No repository-setting change, main push, PR merge or publication is authorized
by this feature-branch task. Actual deployment remains untested until approval;
policy checks and manual hosted verification do not constitute publication.

## Verification record

The complete test inventory is unchanged: 436 Chromium cases, distributed
146 / 149 / 141 with no duplicates or omissions. The focused WebKit profile
remains 50 cases. A retained previous real 435-pass/one-existing-skip report
also passes the new inventory validator.

Local verification completed with zero browser retries:

| Check | Result |
|---|---|
| Complete Chromium, new CI configuration | 435 passed, one existing skip; 447.0 seconds |
| Focused WebKit | 50 passed; 45.0 seconds |
| Ownership | 525 passed, zero failures |
| Infrastructure behavioral tests | 18 passed, zero failures |
| Relocated mutation runner | Baseline eight passed; all four mutants rejected at intended assertions |
| actionlint 1.7.12 | No findings; downloaded tool checksum verified |
| Inventory and scope audit | All 436 cases preserved; production assets and existing test sources unchanged |

A feature-branch manual hosted run will measure the actual three-job speedup.
It cannot deploy. Hosted evidence will be appended after that run.
Raw evidence is retained locally in
`output/testing-release-infrastructure-2026-10-15-Pgwyn8/`, outside Git and
outside the public artifact. It includes the pre-edit preservation snapshot,
complete and shard inventories, raw browser reports, negative checks,
workflow validation, remote settings readbacks and dependency-audit comparison.

## Retained failures and limitations

The first hosted candidate used the Pages uploader version shown in GitHub's
workflow guide. It packaged and uploaded the correct artifact, but its internal
uploader emitted a Node 20 deprecation warning. The current stable Pages upload
action v5.0.0 and deployment action v5.0.1 use the Node 24 generation. Their exact
commits were verified against official action metadata and pinned in the next
candidate. The warning-bearing candidate remains retained; the revised workflow
receives its own hosted verification. No deploy action is executed while
publication is held.

One added negative packaging fixture initially omitted other required tracked
assets. Staging correctly refused those assets before reaching the intended
symlink rejection. The fixture was completed; the resulting test reaches and
asserts the intended rejection. The first failure log is retained separately.
No production change was required.

Npm installation/audit reports six advisories in the existing development
server dependency graph (one moderate, five high). A separate released-baseline
lockfile audit reports the exact same advisory records. YAML introduces no new
advisory. No automatic dependency upgrade or audit fix was applied.

The historical four-image Grid measurement failure at 905dfae remains
unexplained; this change does not repair it. Tests remain scheduling/API policy
checks where documented, not proof of rendered audio or physical Safari output.
Hosted speed depends on runner capacity and shard balance; report measurements
rather than assuming a threefold improvement. Three Chromium machines increase
runner usage. Browser installation and fixture generation remain small relative
to the previous 15-minute complete Chromium run.

Reproduction: npm run test:infra; npm run test:ownership;
WARPDIFF_BROWSER_CHANNEL=chrome npm run test:ci; npm run test:webkit.
For retained JSON use Playwright's JSON reporter and a fresh ignored output
path. The mutation runner additionally requires an existing localhost:8080
server and installed Chrome.
