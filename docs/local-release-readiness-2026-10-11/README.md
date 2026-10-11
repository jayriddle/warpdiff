# Local work and release readiness — October 11, 2026

This is the inventory snapshot preceding the FFmpeg distribution investigation.
The [later FFmpeg work and review](../ffmpeg-distribution-2026-10-11/README.md)
supersede its current-candidate assessment. The original branch heads, pending
state and measurements below are retained as historical evidence.

Jay asked what locally committed work is safe to push to `main`, alongside a request to preserve the license discussion and Codex's assessment. This record is an assessment, not authorization to merge, push or publish. The [license discussion and assessment](../license-metadata-2026-10-11/README.md) now explicitly distinguish Jay's stated lack of approval, Codex's belief that ISC was a generated default introduced without his acknowledgment and consent, and the limits of the available evidence.

## Verified repository state

Remote references were refreshed with `git fetch --no-tags origin`. GitHub's current `main` and local `main` both remain at `75eb81f701de89628d432148c46dac87b18f0d98`. The active local branch is `codex/safe-ffmpeg-command` at `e1ceab171cef487cad9fd50fa1f278c0ad2fe2b2`; it is three commits ahead of `origin/main`. Its committed diff contains 37 files: the focused command change and tests, corresponding user documentation, verification records, and the branch-rename documentation correction. It contains no FFmpeg binary change, extracted JavaScript change, dependency change, service-worker change or workflow change.

GitHub Pages remains configured as a legacy branch deployment from `main` at `/`, with status `built`. A push to `main` would start publication; there is no separate staging-only meaning to that push under the current settings. This assessment made no deployment-setting change.

The [inventory receipt](inventory.json) retains the exact branch heads, current candidate commits, all eight local-only branch commits, the three stashes, patch-equivalence results, pending files and fresh GitHub main/Pages readings. The committed `HEAD` still contains ISC: the corrected `UNLICENSED` declarations currently exist only in the working tree. Pushing the existing committed head would leave the correction and this discussion record behind.

## Current release candidates

| Work | State | Assessment |
| --- | --- | --- |
| `f7ee15e` — Quote copied FFmpeg commands as literal POSIX paths | Locally committed | Ready from a code-review perspective when included with its follow-up below. The later commit fixes inherited output-naming and clipboard defects discovered during review; do not release only the initial implementation. |
| `6266759` — Preserve FFmpeg basenames and handle command copy failures | Locally committed | Recommended with `f7ee15e` as one focused fix. Preserves literal paths, corrects extensionless/hidden basenames, and reports clipboard failures without allowing retired operations to update a new view. |
| `e1ceab1` — Record default branch migration from master to main | Locally committed | Ready as documentation and evidence. The rename is already complete remotely; this commit preserves the record and corrects the active release instruction to say `main`. |
| Application license correction and discussion record | Modified/untracked, not committed | Recommended to include after local review/commit. Declares `UNLICENSED`, prevents npm publication and clarifies README scope while retaining every third-party dependency record. It does not settle the historical legal effect of ISC or FFmpeg redistribution. |

The final command code and its added tests were inspected against `origin/main` again for this assessment. The existing evidence establishes **403 Chromium tests passed, one existing fixture-timestamp skip, zero failures and no retries**. The nine affected command tests also passed in Chromium and Playwright WebKit, without retries. The latest ownership run after the metadata correction returned **528 passed, zero failed**. The metadata verifier passed eight checks and preserved all 90 dependency records. See the [command review](../command-quoting-review-2026-10-11/README.md) and [metadata verification](../license-metadata-2026-10-11/verification.json).

These are existing measured runs, not new browser results from this assessment. The earlier command-review record retains intermittent rotation/embedded-transport failures and their investigation; the final green run does not establish that all timing checks are stable. Actual Safari and native Windows terminal behavior were not certified. No new tests were added or rerun solely for this documentation assessment.

## Other local history

The refreshed `git log --all --not --remotes` inventory also contains older branch work and stash objects. These are not additional approved release candidates:

| Local work | Evidence and disposition |
| --- | --- |
| `codex/host-command-catalog-backport`: `e1dee82`, `a0ffc6e` | `git cherry -v origin/main` marks `e1dee82` as patch-equivalent to work already in main. The later lifecycle commit is not patch-equivalent, but main already contains its ready-request/correlation guards and ownership checks. Do not merge or cherry-pick the old branch wholesale; establish any genuinely missing behavior against current code in a separate review. |
| `claude/elastic-albattani-f3663f`: `12ae7cb` | An older scrub-proxy postmortem commit. Main already has the same named postmortem document with different contents. Review any desired historical detail separately rather than applying the old addition over the existing record. |
| `feature/loudness-metrics`: `4caf685`, `a2fb6b3` | Historical audio-metrics and layout work from April. These tips have not been reviewed or tested against the current release in this task and are not recommended for inclusion. They are not the planned measurement-accuracy fixes. |
| Three local stashes | Historical FFmpeg assist, content alignment and audio work. Stashes are working-state snapshots, not reviewed release commits; leave them out. |

No branch or stash was deleted, reset, merged or published. Existing unrelated untracked evidence and prototypes remain outside the candidate changes.

## Release conditions and recommendation

The three current branch commits are suitable as a focused engineering change, together with the current license correction after it is committed. Before a runtime release, prepare the app/service-worker version and corresponding release documentation, then run the required ownership and browser checks on that final candidate. No version bump was performed during this assessment; the app/cache version still reads 3.19.0. CI/release protection, host-load handling, audio measurement accuracy, memory/cache improvements and the core/provider architecture are not implemented by these commits.

**FFmpeg distribution is still unresolved.** The current bundle remains present and byte-unchanged. A read-only scan of the WASM again found embedded `--enable-gpl`, `--enable-nonfree` and `--enable-libfdk-aac` strings; these observations require establishing the exact build and source provenance rather than assuming that the application metadata correction resolves them. No license or notice files are present in `ffmpeg/`. The reviewed code is technically ready for release preparation, but this assessment is not distribution clearance for that bundle.

My recommendation is to retain the current focused candidate, include the application metadata correction, and resolve the FFmpeg distribution question before another full application publication. Documentation/metadata changes are low risk to app behavior, but pushing even those to main would rebuild the existing site and is not a way to avoid the same bundle question. Older branches and stashes should stay outside this release.

The new records and pending changes remain local. No new commit, merge, push or publication was performed for this request.
