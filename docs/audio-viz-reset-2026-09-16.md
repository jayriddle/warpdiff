# Clear audio graphs when replacing a video

Date: 2026-09-16. WarpDiff 3.17.5. Baseline: `ade27e2` (3.17.4).

## Report and cause

When a new video appeared, the previous video's waveform and spectrogram remained underneath it until the new analysis finished.

`clearAllMedia()` discarded the waveform and spectrogram data, but their two canvas elements remain in the page across comparisons. A canvas retains its drawn pixels independently of the arrays used to draw it. Hiding the panel also retains those pixels. Restoring the saved panel visibility therefore revealed the old graphs while the new background analysis was pending.

The ordinary draw helpers intentionally skip canvases whose containers have no layout size. Calling those helpers during reset would not reliably clear a closed or hidden panel.

## Fix

The existing media-reset owner now sets both persistent canvas bitmap dimensions to zero immediately after clearing their analysis data. This clears the old pixels without requiring the panel to be visible. The normal drawing functions restore the correct dimensions when the new analysis is ready.

The saved panel visibility, sizing preferences, audio analysis, and listening processing are unchanged. Loading still allows the picture to appear before analysis completes; the graph area remains blank during that interval.

Updated surfaces: README, FEATURES, MANUAL, in-app Manual, What's New, and the aligned application/service-worker version.

## Verification

[`tests/audio-viz-reset.spec.ts`](../tests/audio-viz-reset.spec.ts) loads real generated video fixtures and delays the real analysis function behind a controllable gate. It measures actual canvas pixels, excluding transparency and the plain spectrogram background.

1. **Panel open:** finish the first clip's graphs, replace the clip, and verify both bitmaps are empty immediately after reset and while the new analysis is held. Release analysis and confirm both graphs render with the new clip's duration.
2. **Panel closed:** finish the first graphs, close the panel, replace the clip, and verify the hidden bitmaps have also cleared. Reopen before releasing analysis and confirm no old graphs return. Saved visibility remains correct across replacement.
3. **Rapid replacement:** hold two successive analyses, finish the newest first, then allow the superseded one to finish. The current waveform/spectrogram objects and drawn pixel counts must remain unchanged.

Against 3.17.4, all three tests failed on retained pixels immediately after reset: **91,026 waveform pixels and 128,838 spectrogram pixels** from the previous comparison remained. After the fix, both counts are zero during the waiting period and the focused tests pass.

| Check | Result |
| --- | --- |
| New regressions before the fix | 3 failed as expected |
| Initial focused run after the fix | 3 passed, no retries |
| Structural and pure-logic checks | 428 passed |
| Full browser suite, including the strengthened late-completion check | 251 passed, 1 existing skipped test, no retries (2.3 minutes) |

The skipped timestamp-collision warning test requires fixtures with near-identical modification times. No new tests are skipped.

Repeatable commands:

```sh
npx playwright test tests/audio-viz-reset.spec.ts --retries=0 --workers=1
npm run test:ownership
npx playwright test --retries=0 --workers=2
```

Tests use isolated, muted headless browser sessions. The user's active comparison was not reloaded or operated.

## Limits

This addresses stale graph display during replacement. It does not change the time needed to decode or analyze a clip, or alter inspection quality. Existing decode-generation checks continue to prevent superseded analysis results from publishing into a new comparison.
