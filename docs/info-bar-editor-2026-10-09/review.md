# Release-readiness review — October 9, 2026

The assessment below is historical. The subsequent [October 10 review and merge record](../info-bar-review-2026-10-10/README.md) contains the final review, corrections and source status.

Requested after the local editor implementation: “Is this solid enough to add, or do we need a review?” This was a focused self-review of the code and additional Chromium layout probes, not an independent review or publication. Production code was not changed during this review.

**Subsequent status:** the [Left/Right and drag continuation](alignment-and-drag.md) corrects the clipping finding below and adds coverage for every four-portrait bar and narrow three-item Inline/Offset layouts. This document retains the original review and failed measurements; it is not the current implementation status. Native Safari/Firefox and independent review remain unverified.

## Assessment

The feature has substantial implementation and regression coverage, but it is **not yet ready to publish**. A reproducible narrow Grid defect needs correction; native Safari and Firefox remain unverified. A focused independent review is appropriate before release, given the shared presentation/geometry hooks and persistent preferences.

## Confirmed finding

**P2: selected-field overflow becomes clipped in narrow portrait Grid bars.** With All Available enabled and four copies of `tests/fixtures/portrait.mp4`, a 320×736 viewport gives each rendered info bar 115px of width. Slot identity, padding/gaps and the fixed 48px More button need more than that width. The fit routine hides metadata but cannot shrink these fixed controls. `overflow: hidden` then clips part of More. At 320×400 and 736×400, the picture-aligned bars are narrow enough to hide More completely.

The relevant code is the fixed `.info-more` width in `index.html` and `_infoBarFit` in `js/info-bar.js`, which assumes that reserving More leaves a usable bar. The earlier responsive fix covers the Stack strip, not narrow Grid cells. Existing narrow-overflow coverage checks the first bar of a mixed-orientation set; it did not verify every bar of an all-portrait set.

The correction should keep both slot identity/hide controls and selected metadata reachable when the picture-aligned bar cannot accommodate them. Its regression checks should cover every Grid bar, all-portrait media, and both narrow and short viewports, including any bar-height change caused by a compact layout. Merely hiding additional metadata cannot solve the minimum-control-width problem.

[Reproduction and measurements](review-portrait-grid.json) · [Read-only probe](review-portrait-grid.mjs) · [320×736 screenshot](review-portrait-320x736.png) · [320×400 screenshot](review-portrait-320x400.png)

## Other reviewed areas

No additional blocker was identified in this focused pass through profile validation/persistence, safe field rendering, independent source-audio values/tooltips, late metadata handling, clear cleanup, and the managed/wipe exceptions. This is a bounded assessment, not proof that no other defect exists. The earlier 386 passing regression tests, 14 editor tests and 520 ownership/logic checks still describe their covered cases; this additional layout probe exposed an uncovered case.

Before publishing, resolve the confirmed clipping issue, review the resulting responsive/geometry behavior, and perform a native Safari smoke check for modal focus, overflow and layout with real media. The initial implementation only verified Chromium and emulated touch.
