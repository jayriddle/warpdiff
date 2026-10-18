# Ordinary loading and advanced prepared import

Candidate 3.19.8 on `codex/prepared-import-usability`, based on released 3.19.7 / `72dcec3c2554aeca731cb0a89b8b676973cdee14`. Implementation, tests, adversarial review and a PR are authorized. **Merge and publication are on hold.**

The previous primary-header Package button opened four unexplained file selectors. The user could not tell whether those files were prerequisites for using WarpDiff. This correction makes normal file loading the starting point and describes the optional external-tool handoff where it belongs.

## Behavior and ownership

- The header has a visible **Load** label. First-visit Help starts with ordinary images/video/audio and a **Load files** action.
- **Help → Advanced → Import externally prepared media** replaces the header Package entry. Advanced starts collapsed. The modal names `review.mp4` and `warpdiff-package.json`, explains their origin, and expands optional setup steps. The ordinary copied-command audio workflow explicitly needs no package/details file.
- **Load ordinary files** appears before selectors and opens the existing chooser synchronously in the user's gesture. It cancels/invalidates package work, closes Help through its existing owner, and preserves the current comparison until ordinary loading begins. Managed reviews reject this action.
- Opening focuses the heading without scrolling past the explanation. Help remains below the native modal so Cancel/Escape returns focus to the visible opener. The existing input-cancel, delayed-close, pending-read reservation, generation fences, drop containment and normal-loader ownership remain.
- The unsupported-audio panel presents four steps: install FFmpeg separately, open a terminal in the source folder, run the copied command, and reload the output (or return it to the host). Command generation and conversion semantics are unchanged.
- Help width is bounded by the viewport. Documentation, in-app Manual, Getting Started and the two-bullet What's New notice agree. The previous announcement is archived.

No new preparation provider, transport, conversion engine, upload, host protocol or strict admission policy is added. Package inspection still establishes a candidate, not complete decoding, source derivation, exact timing/channel fidelity or measurement conformance.

## Verification record

Full local evidence: `output/prepared-import-usability-2026-10-17-DURVsJ/` (ignored; not deployed). The work record preserves actions, decisions, failures and limitations. Browser runs use one worker and zero retries, an owned range-capable source server, and existing fixtures. User localhost:8080 is untouched.

Initial exploratory run: **149 passed, one failed** in 2.4 minutes. The new outside-modal keyboard test assumed plain Tab includes buttons in WebKit. Its macOS-style policy uses Option/Alt+Tab. The corrected exact-focus test passed **2/2**. The exploratory run also overlapped completion of the heading-focus/manual correction, so it is not final target evidence. A fresh stable functional-source run follows.

Desktop welcome/import, 390×650 import and external-audio steps were visually inspected. At 390×650, the dialog opens at scrollTop 0 with the heading focused and the ordinary-loading exit inside its visible bounds. First structural checks: ownership **1353 passed**, infrastructure **26 passed**.

Fresh local verification: **150 focused passes** (75 per engine; 1.3 minutes) plus **32 startup/release-note passes** (16 per engine; 13.5 seconds). Complete/disjoint inventories were verified with zero retries, skips, flaky results or runner errors. Ownership **1353 passed**, infrastructure **26 passed**. The legacy startup copy changes only its fixture directory and replaces the fixture-writing beforeAll with read-only sentinels; scenario assertions are unchanged. The independent review and correction are recorded below. Required hosted results will be attached to the PR and full local work record after the final branch push, avoiding an extra documentation-only CI cycle. No merge or publication is authorized.

## Limits

Playwright WebKit is not physical Safari. Touch is emulated. Real chooser activation is tested; OS Cancel is represented by its DOM cancellation event. No new physical listening, codec/timing/measurement conformance or OS PWA migration claims are made. Existing historical Grid, 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate.

## Adversarial review and keyboard correction

Independent review of `a70f6ce44432fbf719e772ec75a7725850007c2f` found one new P2: the collapsed setup guide's link retained nonempty client rectangles, so the explicit Tab cycle attempted to focus it and stalled on the summary. The reviewer's focused suite passed **128/128**; a separate **18-Tab-per-engine** probe exposed the coverage gap in both Chrome and WebKit. Evidence: `output/prepared-import-independent-2026-10-17/REVIEW.md` and `focus-probe.json`. No other material finding was established.

The new exact traversal regression was first run against the unfixed production source. It failed at the intended manifest-focus assertion and also reached the outer 60-second timeout; both errors remain in `negative-report.json` / `negative.log`. The correction excludes descendants of closed details except their summary. The existing focus owner recomputes the cycle on each Tab; no additional keyboard owner is added. Tests cover every control forwards and backwards, with guidance closed/open and after closing it again.

After correction: **154 focused passes** (77 per engine; 1.4 minutes), **32 startup/release-note passes**, and ownership **1353 passed**. Inventories are complete and unique, zero retries, skips, flaky results or runner errors. The focused independent follow-up of `0441f24090e75d6b19118947aff804ea94188318` resolved the P2 and found no additional material issue within scope. Four real-keyboard engine × viewport scenarios (1280×720 and 320×480) passed **224 exact focus assertions**, including repeated closed cycles, expanded/reverse traversal, collapse/re-entry, enabled Check, Cancel and reopen/Escape restoration. Zero page errors; existing comparison and all 37 fixture hashes/mtimes retained. Follow-up evidence: `output/prepared-import-independent-followup-2026-10-17/REVIEW.md`. Merge and publication remain on hold.

## Staged package and review hold

The exact corrected commit `0441f24` was staged into **82 public files**. Source, commit and HTTP bytes matched for the four relevant runtime surfaces. Fresh serial Chrome and WebKit contexts passed staged startup, Help → Advanced entry, checked-source binding without clearing, file-input cancellation and normal handoff/decoded analysis. Chrome also passed offline reload, package inspection and normal loading. No page errors. These are staged-package checks, not publication. Full results: `output/prepared-import-usability-2026-10-17-DURVsJ/package-smoke.json`.

The final verification-record commit changes documentation only; production and tests remain those independently reviewed at `0441f24`. Required hosted results and exact candidate-artifact checks are recorded in the PR description and full local work record after the push, so recording them does not trigger a redundant full CI cycle. **Do not merge or publish before review.** Main/live remain released 3.19.7 / `72dcec3` at this checkpoint.
