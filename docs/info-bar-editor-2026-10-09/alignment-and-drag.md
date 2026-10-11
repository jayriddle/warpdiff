# Left/Right sections and drag handles — October 9, 2026

Historical continuation record. See the subsequent [October 10 review and merge](../info-bar-review-2026-10-10/README.md) for the touch-scroll, WebKit-focus and sticky-heading corrections, final verification and source status.

Continuation of the local, unpublished 3.19.0 info bar editor. Jay requested Left and Right sections so Zoom can remain at the far right, then requested drag and drop in place of up/down arrow buttons. This work also resolves the confirmed portrait Grid clipping issue in the earlier [readiness review](review.md).

## Delivered behavior

- **Left aligned** and **Right aligned** are separate editor groups. They appear side by side when space permits, and stack in narrow windows. Select an element and change **Section**, or drag its **⠿ handle** between groups. Order within each section is independent.
- Visible arrow buttons are removed. Mouse dragging has a before/after insertion marker; empty sections accept drops. Touch/pen handles use pointer capture and the same drop policy. Focused handles use Up/Down to reorder and Left/Right to change section. Tab remains inside the modal; Escape closes it and restores focus.
- Presets assign Zoom to Right. Keep Zoom last in that section to anchor it at the far edge. Minimal video/audio still shows only duration unless other fields are enabled. Color, size, bold and visibility stay with each field when it moves; spacers can be added, reordered and moved in either section.
- Right-edge fields receive room before the left prefix. Spacers collapse independently in each section and compress before selected fields enter **More**. More sits before the right group, so it does not displace Zoom from the edge. Compact Grid bars use **⋯** with a descriptive accessible label. When a selected right field cannot fit, it remains available in More and returns to its saved position when space grows.
- Portrait Grid cells reserve enough width for slot identity and overflow access. The caption may extend beyond a tiny picture, within its own cell, while remaining above it. Four portrait videos at 320×736, 320×400 and 736×400 retain identity, Zoom and reachable overflow in every bar. Three narrow Inline columns also remain within the viewport; an oversized right group can join overflow there.
- Earlier custom profiles without section data retain their old order on the left. Earlier named presets acquire right-hand Zoom and retain their preset labels when otherwise unchanged. Image/video/audio profiles still save independently, use the original storage envelope, and apply to Stack and Grid. Default/reset preserves the original display. Managed reviews and image wipe retain their existing chrome.

## Implementation and rationale

`js/info-bar.js` validates each element's alignment as Left or Right. `_commitInfoBarProfile` remains the only persistent writer; source metadata, audio analysis, playback and transport ownership are unchanged. Section assignment is presentation data, never arbitrary CSS.

`_infoEditorFinishDrag` owns completion/cancellation for both native mouse dragging and captured touch/pen gestures. Pointer cancel retires only a captured gesture that matches its pointer ID: native mouse dragging itself cancels its original pointer stream, and native dragend owns that cleanup. Cancel, close, visibility loss, a profile change, and another tab's update retire pending gestures before they can save. No recurring animation was added for drag feedback.

`_infoBarFit` fits the right suffix, then the left prefix, retaining requested spacer widths in preferences. Metadata can still arrive after customization without re-enabling hidden fields or changing styles. Rendered bars and overflow use safe text, and existing source metadata fields remain read-only.

`_infoBarGridMinWidth` supplies a measured slot-label/control minimum and a bounded preference for a small right-hand field. Three-column minimums are constrained by the viewport. The existing `measureSlots` / `positionLabelsToMedia` owner incorporates those minimums into cell sizing and confines captions to their final cells. Caption height changes request that same coalesced geometry path. Default profiles have a zero custom minimum, preserving their existing geometry.

README, FEATURES, MANUAL, in-app Manual, Getting Started, the consolidated unpublished release notes, and AGENTS architecture notes were updated. App/cache/README remain 3.19.0; no commit, push, deployment, dependency or usage-collection change was made.

## Verification

| Check | Measured result | Evidence |
| --- | --- | --- |
| Focused browser checks | 21 passed, 0 failed, no retries | [Focused log](drag-focused-fourth.txt), [tests](../../tests/info-bar.spec.ts) |
| Ownership and pure logic | 527 passed, 0 failed | [Final log](alignment-ownership-final.txt) |
| Expanded visual/geometry probe | 11 cases passed; no runtime errors | [Measurements](alignment-ui.json), [log](alignment-ui-final.txt), [probe](verify-alignment.mjs) |
| Idle presentation | 0–1 refreshes over 40 display frames after setup; no continuing refresh chain | [Measurements](alignment-ui.json) |
| Full Chromium regressions | 393 passed, 1 existing skipped test, 0 failures, no retries; 2.6 minutes | [Full log](alignment-full-suite.txt) |
| Syntax and whitespace | `node --check js/info-bar.js` and `git diff --check` passed | Rechecked at completion |

The focused coverage includes mouse reordering with styling retained, spacer moves, cross-section and empty-section drops, keyboard moves without app shortcuts, touch movement through Chromium's input protocol, canceled touch gestures, profile migration, persistence, cross-tab updates, overflow focus/cleanup, managed-host and wipe behavior, narrow Stack headers, every four-video portrait bar, and three-item Inline/Offset portrait bars. The full regression run additionally exercises the existing geometry, media, audio, transport, scopes, appearance and usage surfaces.

The final full run includes all 21 editor cases, including the last assertions that a blocked keyboard move preserves Default and switching media profiles cancels a captured touch gesture without saving. Those assertions were added after the last separate focused run. The sole skipped test is the existing timestamp-collision case requiring special near-identical modification-time fixtures; no new skip was introduced.

[Desktop editor](alignment-editor-desktop.png) · [Narrow touch editor](alignment-editor-touch-narrow.png) · [Four portrait videos in a short window](alignment-portrait-four-short.png). The portrait screenshots use repeated fixtures, so the existing identical-file/timestamp notices are visible; the measured control bounds and actual More clicks are the verification evidence.

## Failed checks and corrections retained

1. The existing 14 editor cases passed after the initial section implementation. Adding four section/portrait cases produced **16 passes and 2 failures** in [the second alignment run](alignment-focused-second.txt). A legacy audio-format selector overrode compact padding, leaving insufficient room for Zoom in two portrait bars. The compact rule now has the needed specificity. The expanded section list also made an automated drag scroll its source out of the recorded position, dragging Resolution instead of Duration. Side-by-side groups reduced that unnecessary scrolling; all 18 cases passed in [the next run](alignment-focused-third.txt).
2. Removing arrow buttons exposed modal Tab wrap behavior and a resize test that held a detached Zoom node, producing **16 passes and 2 failures** in [the first drag run](drag-focused-first.txt). Modal boundary focus is now wrapped explicitly. The geometry assertion reads the current strip and its current Zoom node together rather than using a stale element.
3. Combining native mouse drag with touch cancellation initially produced **16 passes and 4 native-drag failures** in [the second drag run](drag-focused-second.txt). Native drag emits pointercancel, which had incorrectly retired it. Cancellation is now fenced to the owned pointer gesture, with a structural guard freezing this regression. All 20 interaction cases then passed in [the third drag run](drag-focused-third.txt).
4. The first wider geometry probe passed nine cases but exposed three-item portrait Inline columns extending **2.5px beyond each side** of a 320px window. Its [failed measurements](alignment-ui-first.json) and [log](alignment-ui-first.txt) are retained. The viewport bound now limits preferred caption width, preserving control access while allowing selected fields to overflow. All eleven cases passed in the final probe, and a new browser regression covers video/image Inline and Offset layouts at 320×400.

## Remaining limits and reproduction

This is implementation plus self-review, not an independent review or publication. Native Safari, Firefox and hardware touch/pen were not verified. Touch checks used real browser pointer events driven by Chromium's emulated touch input. The earlier request for a focused independent review/native Safari smoke check remains a sensible release step; the confirmed clipping finding itself has been corrected and regression-tested.

From the repository root, serve the static app on port 8080. Run `npx playwright test tests/info-bar.spec.ts --retries=0`, `npm run test:ownership`, and `npx playwright test --workers=4 --retries=0`. For the additional layout/idle measurements and screenshots, run `node docs/info-bar-editor-2026-10-09/verify-alignment.mjs`. The original implementation and failed review artifacts are retained rather than overwritten.
