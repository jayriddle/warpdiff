# Application license metadata correction — October 11, 2026

This records the initial metadata-only verification snapshot. Later FFmpeg
candidate work also changes runtime files and prepares version 3.19.1. The
[FFmpeg work record](../ffmpeg-distribution-2026-10-11/README.md) and its review
checkpoint describe that later work; the measurements below retain their
original scope.

Jay stated that the ISC declaration was never intended and authorized the recommended correction with “Make the changes you recommended.” This change records the intended current policy for WarpDiff's original application code. It does not offer a permissive reuse license or dedicate that code to the public domain.

## Discussion and recorded assessment

Jay's stated intent concerns reuse of WarpDiff's original core code. He did not choose MIT, the Unlicense, a public-domain dedication, or any other permissive reuse policy in this discussion. He stated: “There was never supposed to be an ISC declaration. I don't recall approving it.” He then authorized replacing the contradictory application metadata with `UNLICENSED`, adding the npm publication guard, and keeping the README consistent with his existing restrictions.

**Codex's assessment:** I believe the ISC declaration was a generated default introduced during the AI-assisted Playwright setup, without Jay's acknowledgment and consent to licensing WarpDiff under ISC. This belief is based on Jay's stated intent, npm's documented default, the declaration's introduction in a testing commit, the absence of any licensing discussion in the PR, and the absence of licensing-related instructions in the available prompt history. The instructions to commit and merge the test/layout work do not demonstrate that Jay knowingly approved an ISC reuse license.

This is an evidence-based assessment, not a verified reconstruction of the original assistant's commands or a legal determination about the effect of the declaration. The full February assistant/tool transcripts are missing. The available records establish when and where ISC appeared but cannot establish what the assistant disclosed before the general commit/merge approvals.

We also discussed separating a reusable comparison core from optional media-preparation providers, with the same core serving standalone and managed use. That architectural direction does not require a permissive reuse license, a public-domain dedication, or a fork. Moving FFmpeg outside the core would not remove the preparation provider's own licensing obligations. This architectural discussion has not authorized or implemented a new core, fork, provider or repository.

## Starting state and trace

The starting checkout is local branch `codex/safe-ffmpeg-command` at `e1ceab171cef487cad9fd50fa1f278c0ad2fe2b2`, with no tracked changes. Earlier command-quoting work remains local on this branch. Existing unrelated untracked investigation records and output are outside this change.

The preceding read-only investigation established:

- Commit [e954df3](https://github.com/jayriddle/warpdiff/commit/e954df32172dc622b555478d3fcc40abbddb7648), “Add Playwright E2E test suite (30 tests),” created `package.json` and `package-lock.json` with ISC application metadata on February 22, 2026, at 5:14:39 PM Pacific. The commit uses Jay's Git author identity and credits Claude Opus 4.6 as co-author; that identity alone does not establish an explicit license choice.
- [PR #32](https://github.com/jayriddle/warpdiff/pull/32) merged it into the then-default `master` branch at 5:18:57 PM Pacific that day. Its description covers layout positioning, tests and ignored files, with no licensing discussion. GitHub returns no reviews, issue comments or inline review comments for that PR.
- Available local prompt history records a request to write a test at 3:38 PM Pacific and later instructions to commit, push, create the PR and merge. A search of the 2,044 available WarpDiff prompts, spanning February 22 through March 18, found no licensing-related instruction. The full February assistant/tool transcripts are unavailable, so the exact package-generation command and information shown before approval cannot be established.
- ISC is npm's documented initialization default. That makes generated metadata the likely explanation, not a confirmed reconstruction of the original command. See [npm init](https://docs.npmjs.com/cli/v11/commands/npm-init/#init-license).
- Commit [fe6c469](https://github.com/jayriddle/warpdiff/commit/fe6c46942e2d6338d17f6b136b86709f443ece01) added the README's restriction on redistribution and derivative use on May 5, 2026. The unchanged ISC declaration conflicted with that policy; the [August 9 architecture review](../architecture-review-2026-08-09.md) had already identified the contradiction.

## Changes and rationale

1. [package.json](../../package.json) now declares `"license": "UNLICENSED"`, reflecting the intended absence of a reuse license for the original application code. Added `"private": true` to have npm refuse package publication. This setting does not change GitHub visibility or GitHub Pages hosting.
2. [package-lock.json](../../package-lock.json) updates only the root application entry's license. Dependency versions, integrity values, resolutions and third-party license fields are preserved.
3. [README.md](../../README.md) retains the existing redistribution/derivative-use restriction, specifies that it concerns WarpDiff's original application code, and explains that `UNLICENSED` is not a public-domain dedication. Third-party components retain their respective licenses and notices.

The [npm package metadata documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license) documents `UNLICENSED` and the publication guard. `UNLICENSED` and the public-domain Unlicense are different policies. No new license text, dependency upgrade, runtime change, app/cache version bump or Git history rewrite is included.

## Verification

| Check | Measured result |
| --- | --- |
| Application metadata and exact change scope | **8 checks passed, 0 failed** in the corrected [verification receipt](verification.json). npm reads `UNLICENSED` and boolean `private: true`. |
| Lockfile dependency preservation | **All 90 dependency records unchanged**, including versions, resolutions, integrity and license values. The six third-party dependency records declaring ISC remain intact. Only the root application license changed. |
| Existing ownership / pure-logic harness | **528 passed, 0 failed**, including real MP4 fixture parsing; [complete output](ownership.txt). |
| Runtime, vendored files, tests and deployment configuration | No tracked changes relative to the starting commit. App/cache version remains 3.19.0. |
| Whitespace | `git diff --check` passed. |

The first metadata verifier assumed `npm pkg get license private` returned JSON. On npm 12.0.2 it returned text, causing a JSON parse error before the receipt was written. Adding explicit `--json` corrected the verifier; all eight checks then passed. The [first-attempt record](verification-first.txt) preserves the failure and its resolution. No repository correction was needed in response to that tooling failure.

Verification used Node 26.4.0 and npm 12.0.2. Reproduce the primary reads and existing checks from the repository root:

```sh
npm pkg get license private --json
npm run test:ownership
git diff --check
git diff -- package.json package-lock.json README.md
```

The receipt compares parsed package files against the starting commit and confirms that only the approved metadata fields changed, every dependency entry is preserved, and the README differs only in its policy paragraph. No dependency installation or publication attempt was made. Browser tests were not rerun because this change affects neither runtime files nor dependencies; this is not a new browser certification or release gate.

## Limits and release status

This is a current metadata and documentation correction. It does not establish the legal effect of previous public ISC declarations or revoke any rights that may previously have been granted. Exact FFmpeg build provenance, notices and redistribution obligations remain a separate unresolved phase. Third-party files and license declarations are unchanged.

Changes were local and uncommitted at this initial verification checkpoint.
The correction was subsequently reviewed for a separate local commit on
`codex/ffmpeg-distribution`; the FFmpeg review record tracks the later checkpoint.
No merge, push, publication, repository visibility change or Pages configuration
change is authorized by this task.
