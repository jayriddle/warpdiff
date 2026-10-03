# Grid order after hiding a video

## Outcome

Local **3.18.11** preserves the original visible order when hiding any member of
a four-item comparison. Hiding Video-1 leaves **Video-2, Video-3, Video-4** in
both Inline axes. Offset assigns those same three videos to its left, upper-right
and lower-right positions. Restoring the hidden slot returns the four-item 2×2
layout with the original labels intact.

The fix is in the working tree. Existing appearance/usage changes were already
present in several of these files; their content is preserved. No commit, push
or deployment was performed for this task.

## Reproduction and cause

Jay reported that hiding #1 from four videos displayed the remaining videos as
4, 2, 3. Three browser regressions reproduced that exact order before the fix:
Inline columns, Inline rows and Offset. The tests inspect rendered cell positions,
not just the underlying slot list, which was already in the correct order.

The old three-item CSS fixed `original`, `editA` and `editB` to specific grid
cells. `editC` had no fixed position. Hiding an earlier slot freed its cell, so
browser auto-placement put `editC` there ahead of the other visible videos.
Offset's geometry calculations independently assumed those same three fixed
slot identities, so correcting Inline alone would leave Offset inconsistent.

## Change and ownership

- Inline uses ordinary DOM order, which matches the existing `assetOrder` registry
  and naturally skips `display:none` slots. Removed the fixed three-slot CSS rules.
- `positionLabelsToMedia` assigns Offset cell positions from `getVisibleSlots()`
  before measurement. Its existing size/position calculations use the same first,
  second and third visible slots. There is no new slot-order state or DOM reordering.
- The same layout owner clears explicit grid coordinates outside Offset, including
  returning to a four-cell grid. It retains existing equal-area sizing.
- The app version, service-worker cache, README, FEATURES, MANUAL, in-app Manual,
  Getting Started and What's New are aligned with the corrected behavior.
- Added `tests/grid-order.spec.ts`: real file loading, label/ghost-pill clicks,
  keyboard toggles, rendered ordering and Offset geometry assertions.

The incremental [change patch](change.patch) is relative to the starting 3.18.10
working tree, which already included uncommitted work beyond Git HEAD `761d694`.
It captures only this task's edits and its new regression file. The final source
and evidence checksums are in [verification.json](verification.json).

## Verification

- **4 new browser tests passed, without retries:** hiding each of the four videos
  in Inline columns and rows, restoration, Stack/Grid round trips, resizing across
  both axes, collapsing to one video, and restoration in a different order. Offset
  is checked with matching and mixed aspect ratios; rendered areas remain within 3%.
- **25 existing browser checks passed**, covering image/video/audio loading,
  Stack/Grid, layout direction, gutters, equal-area geometry, four-input behavior,
  mixed-orientation Offset and resize. **One existing test is explicitly skipped**
  because its timestamp-collision fixtures are not implemented.
- **444 ownership/logic checks passed.** The app/cache/README version alignment
  and script syntax remain valid. The final whitespace check passed.
- Captured and inspected the actual before/after page at 1920×1080. The old page
  was supplied to an isolated browser through a request override; the user's
  running app and files were not reverted. Positions confirm **4,2,3 → 2,3,4**.
- The first post-fix Offset test read geometry immediately after the mode class
  changed, before the queued layout pass. It failed on that intermediate geometry.
  The test now waits for the actual Offset arrangement. Initial screenshots also
  caught the loading fade; final captures and new tests wait for visible layers.
  Those timing corrections did not change product behavior.

Retained runs: [original failures](before.txt), [initial post-fix run](after-first.txt),
[final new tests](after-final.txt), [existing regressions](layout-regressions.txt),
[ownership checks](ownership.txt), and [rendered positions](visual-order.json).
Terminal color escapes and trailing spaces were removed from saved logs only.

All checks used isolated, physically muted headless Chromium. No user browser was
controlled. This is focused layout verification; the complete app suite and other
browser engines were not run for this change. No audio processing was changed.

## Visual evidence

The four test uploads deliberately reuse one synthetic red clip; their labels
identify the positions. They share timestamps, so the unrelated timestamp warning
visible in the screenshots is expected.

Before — hiding Video-1 leaves Video-4, Video-2, Video-3:

![Before: 4, 2, 3](before.png)

After — hiding Video-1 leaves Video-2, Video-3, Video-4:

![After: 2, 3, 4](after.png)

## Repeat the checks

From the WarpDiff project root:

```sh
npx playwright test tests/grid-order.spec.ts --workers=1 --retries=0
npx playwright test tests/warpdiff.spec.ts --grep 'File Loading & Slot Assignment|View Modes|Grid Layout Direction|Grid Inline/Offset Toggle|Mixed Orientation Offset Layout|Grid layout recalculation|4 videos populate|4 audio files' --workers=1 --retries=0
node tests/ownership.test.mjs
```

For manual confirmation, reload local WarpDiff, verify **3.18.11**, load four
videos, and click Video-1's label. The remaining labels should read 2, 3, 4.
Restore Video-1 with its dimmed header pill and confirm the 2×2 layout returns.
