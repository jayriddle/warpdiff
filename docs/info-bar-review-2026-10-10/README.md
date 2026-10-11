# Info bar review and merge — October 10, 2026

Jay requested review, correction of any issues, then committing and merging the info bar editor to `master`. This record continues the [implementation](../info-bar-editor-2026-10-09/README.md) and [Left/Right and drag verification](../info-bar-editor-2026-10-09/alignment-and-drag.md), retaining their earlier failures and fixes as historical evidence.

## Scope and starting state

The editor changes were local, uncommitted changes on `codex/shared-scrub`, based on `f531050b776b38df41f8c2a508452a38cb818747`. Fresh remote checks found `origin/master` at the same revision. The review includes the new presentation owner, the inline CSS/HTML/geometry integration, container-derived audio field strings, managed-host cleanup, service-worker caching, tests, and affected user documentation. Existing unrelated local evidence and the older prototype under `output/` are outside this commit.

GitHub reports an unprotected `master` branch and legacy Pages publication from `master` at the repository root. Updating that branch can start the normal Pages publication. A source merge is not, by itself, evidence that the public app has finished updating.

## Review assessment

Source review checked bounded preferences and migration, read-only source metadata, field and spacer ordering, mouse/touch/keyboard cancellation and focus, late metadata publication, overflow visibility and positioning, Grid cell geometry, and lifecycle cleanup. No competing playback or analysis owner is introduced. No confirmed blocking product defect remains after the corrections below. This is a source/self-review with automated engine verification; no separate independent reviewer was used.

The full Chromium suite, Node ownership/pure-logic harness and additional Playwright WebKit editor checks passed against the corrected final source. All browser checks used disposable test profiles. The two CDP-driven touch cases ran in Chromium and were explicitly excluded from the WebKit command because CDP is Chromium-specific. Native Safari and hardware touch/pen are distinct from these automated engine checks. Firefox's startup limitation is retained below.

## Confirmed findings and corrections

**Touch/pen edge scrolling stopped between pointer events.** At 320×736 the two editor sections stack, leaving the right section below the visible list. A held drag at the dialog's bottom edge advanced from scroll position 376 to 392, then stayed there for the regression's five-second observation. It could not reach the offscreen destination without repeated finger movement. The [new failing regression](touch-scroll-before.txt) preserves the measured result.

The captured gesture now owns one coalesced animation-frame chain while the pointer is near an edge and scrolling can advance. It recalculates the visible drop target as rows scroll. Moving away from the edge or reaching the limit stops the chain; `_infoEditorFinishDrag` cancels it on every existing completion/cancellation path. Native mouse drag cancellation remains fenced to the owned pointer ID. No idle or media animation is added. The regression now transfers Resolution to the offscreen Right section and proves cancellation leaves saved preferences and scroll position unchanged over 20 further display frames. The two [touch checks passed after the fix](touch-scroll-after.txt); an ownership guard protects frame retirement.

**WebKit Tab could leave the modal.** The previous handler intercepted only the first/last boundary controls, assuming the browser would use the same tab order for the intermediate controls. WebKit's native traversal did not satisfy that assumption and reached the page. The editor now advances through its visible enabled controls explicitly in either direction, including buttons. The existing keyboard regression additionally traverses 45 times backward and verifies both wrap boundaries.

**WebKit could restore focus to the page instead of the editor trigger.** The editor saved `document.activeElement` when opened. A mouse click need not focus a macOS WebKit button, so the stored target could remain the page. The return target now explicitly identifies Customize info bar. Closing via Escape, the close button, or the existing lifecycle path still uses the same close owner. These two defects produced [three reproduced failures](webkit-focus-before.txt) across the keyboard, preview More and handle tests. All [three passed after correction](webkit-focus-after.txt).

The initial combined browser run recorded 17 WebKit passes and the three focus failures, then was stopped while Firefox's first browser launch remained unresponsive: one interrupted Firefox case and 19 Firefox cases not run ([initial log](cross-browser-first.txt)). None of those Firefox cases is reported as a pass or a skipped regression. A separate 15-second [Firefox launch probe](firefox-launch.txt) timed out before loading the app; it reported a sandbox-extension permission error and a failed SWGL framebuffer mapping. The exact underlying host/runtime cause was not established, and Firefox remains unverified.

**The close button scrolled out of sight in the long narrow editor.** Visual inspection of the 320×736 dialog showed its heading above the viewport after selecting a lower row. The heading is now sticky within the existing scrolling dialog. The long-touch regression verifies that Close remains in the viewport and returns focus to Customize. This is a CSS change; it adds no layout owner. The updated [narrow screenshot](alignment-editor-touch-narrow.png) retains a reachable Close button.

## Test race and correction

The WebKit run after the focus fixes passed 19 cases and failed the late-loudness warning assertion ([log](webkit-after-focus.txt)). The test manually injected −8 LUFS while the fixture's original background analysis was still running. Its later result replaced that synthetic value; the failure snapshot showed −21.9 LUFS, for which the app correctly omitted the above −9 warning. The test now waits for the real fixture metrics before injecting the controlled late result. Visibility/style retention assertions and the warning threshold remain unchanged. All 20 WebKit cases passed after this synchronization correction ([intermediate result](webkit-before-sticky-heading.txt)) and again after the sticky-heading change in the final run.

## Verification environment correction

The system Node 26.4.0 installer downloaded Firefox but stalled while unpacking it for about six minutes. Its [initial output](browser-install.txt) is retained; only the owned installer and download child were stopped. Running the same pinned Playwright installer with the bundled Node 24.19.0 completed Firefox and WebKit installation ([successful output](browser-install-bundled-node.txt)). No project dependency or lockfile changed. This is an environment workaround; the precise cause of the initial stall has not been established.

The system `python3` shim also required an Xcode license when used for a text replacement. Node performed that replacement instead. No Xcode license or system setting was changed.

Captured text logs were normalized for repository readability by removing ANSI formatting and trailing whitespace/empty lines. The staged whitespace check initially found one blank final line in the Firefox diagnostic; normalization corrected it. Assertions, values, counts, failures and command output remain intact.

## Final measured verification

| Check | Result | Evidence |
| --- | --- | --- |
| Full Chromium suite | 394 passed, 1 existing fixture-timestamp skip, 0 failures, no retries; 2.6 minutes | [Final log](full-suite-final.txt) |
| Editor coverage within that suite | All 22 cases passed, including the two touch cases and forward/backward keyboard traversal | [Tests](../../tests/info-bar.spec.ts), full log above |
| Additional WebKit editor suite | 20 passed, 0 failures, no retries; 49.5 seconds; two Chromium-only touch cases excluded | [Final log](webkit-final.txt), [config](playwright.review.config.ts) |
| Ownership/pure logic | 528 passed, 0 failures | [Final log](ownership-final.txt) |
| Final layout/visual probe | All 11 cases passed; 0 page errors | [Measurements](alignment-ui.json), [log](layout-final.txt), [probe](verify-layout.mjs) |
| Idle refresh | 0 refreshes in all 11 cases over 40 display frames after setup | Measurements above |
| JavaScript/whitespace | `node --check js/info-bar.js` and `git diff --check` passed | Rechecked before staging |
| Source identity | SHA-256 snapshot of 30 runtime text files | [Source hashes](runtime-sha256.json) |

The final full run followed both the test synchronization fix and the sticky-heading change. The earlier full run also passed 394 cases but preceded that last CSS correction; its [log is retained](full-suite-before-sticky-heading.txt). The initial untouched feature passed all 21 earlier editor cases ([initial check](chromium-initial.txt)), demonstrating why the newly added touch/engine probes were needed to expose the review findings.

The layout cases cover four portrait videos in narrow/short/tablet windows, three portrait Inline/Offset videos, two portrait videos, four/three tall images, four audio files, and desktop/narrow touch editors. [Desktop editor](alignment-editor-desktop.png) and [short portrait Grid](alignment-portrait-four-short.png) screenshots supplement actual bounds and More-button interaction checks. Repeated fixtures produce the existing duplicate-file notices; those notices are expected in these screenshots.

Reproduce from the repository root with its static server on port 8080: `npx playwright test --workers=4 --retries=0`, `npm run test:ownership`, and `node docs/info-bar-review-2026-10-10/verify-layout.mjs`. The additional engine command was `/Users/jay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/playwright/cli.js test --config docs/info-bar-review-2026-10-10/playwright.review.config.ts --project=webkit --grep-invert touch`.

## Commit and merge

Review and required local checks are complete. A fresh fetch still identifies `origin/master` and `origin/codex/shared-scrub` at the audited base `f531050`. The local `master` is an older ancestor and can be advanced without discarding history. The next steps are an explicit scoped feature commit, fast-forwarding local `master`, and a normal atomic push of both branches. Final source/remote receipts will be added after these operations succeed. No force push is needed. Unrelated untracked evidence and the older interactive prototype remain local.

Remaining verification limits are Firefox startup, native Safari, hardware touch/pen, an installed-client upgrade, and real audible output. The source metadata/analysis/transport separation and automated media regressions passed; this review does not claim to replace those distinct native or hearing checks.
