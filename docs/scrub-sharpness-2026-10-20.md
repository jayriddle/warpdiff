# Scrub sharpness: verification of 3.19.10

Recorded 2026-10-20. Runtime baseline: published `95661e2538ccbe8b049e0250e6d5f7f2a9919fb9`, version 3.19.10. Working branch: `codex/scrub-sharpness`. This record supersedes the pending current-version check in the earlier [follow-up note](review-followup-2026-10-19/README.md).

## User report and scope

Jay reported that a **1956×432 H.264 video in Chrome on 3.19.9** became significantly softer during scrubbing and sharpened when the scrub ended. During investigation Jay confirmed: **“I don't see the lowered resolution with 3.19.10.”** Jay then chose **verify and document the current behavior**, rather than continue changing other affected cache paths.

No runtime correction was made. No new app version, cache identity, public asset, preparation policy or audio behavior was introduced. Exploratory test changes were removed from the product test suite and retained only with ignored investigation evidence. The pre-existing follow-up notes, including the deferred FFmpeg-version proposal, were preserved unchanged. Nothing was merged or published by this investigation.

## What the source establishes

The bitmap-cache sizing formula is unchanged between 3.19.9 (`9fd0698`) and 3.19.10 (`95661e2`). When that path is used, a 1956×432 frame is cached at **1280×283** and drawn back into the source-sized canvas on a cache hit. Fresh decoder output can paint at full source size. This is a remaining quality limitation, not a general sharpness repair included in 3.19.10.

Version 3.19.10 adds conservative native-seeking fallbacks for additional macOS output/color combinations and display-gamut changes. Avoiding the reduced bitmap path could explain why a particular file now looks sharper, but the exact user file and its output metadata were not available. Neither the responsible path nor the cause of the user's version-to-version change was established.

## Measured current behavior

Two generated **1956×432, 24 fps H.264** clips contain alternating one-pixel light/dark stripes: ordinary High-profile AVC and lossless High 4:4:4-profile AVC with 4:2:0 samples. They are synthetic controls, not Jay's file. Both have no container `colr` box despite bitstream color declarations, as independently checked through the shipped demuxer. Both therefore use the existing macOS untagged-container native fallback before decoder configuration. That fallback already existed in 3.19.9, so these tests do not prove that a new 3.19.10 fallback repaired the original report.

Local tools: Chrome **155.0.8059.85**, Playwright **1.58.2**, Node **26.4.0** and FFmpeg/ffprobe **8.1.2**, on macOS. No tools were installed or upgraded.

Actual Chrome pointer-down and held backward-drag checks on the unchanged 3.19.10 runtime preserved intrinsic row contrast exactly. A subsequent check also captured the visible native picture before and during scrubbing, after waiting for the layer's opacity transition to finish. The displayed video measured 2200×486 pixels in that test viewport.

| Fixture | Intrinsic contrast, before → during | Displayed contrast, before → during |
|---|---|---|
| Ordinary AVC | 252 → 252 | 126.0819 → 126.0819 |
| Lossless-profile AVC | 251 → 251 | 124.8610 → 124.8610 |

Contrast here is the mean absolute difference between neighboring red-channel samples across a center row, excluding the edge pixels. Mean pixel levels were also unchanged. Visible-picture tests require nonblank detail before accepting any comparison; equality between blank captures cannot pass.

- Final visible-picture verification: **2 passed**, zero skips/failures/flaky results/report-level errors; one worker, zero retries.
- Retained intrinsic-only current verification: **2 passed**, also one worker and zero retries. These are separate runs of the same two fixture cases, not four distinct coverage cases.
- Restored product ownership harness: **1,725 passed** locally, including two neighboring WarpCap checks absent from hosted checkout.
- All **37 existing fixture files** retain their exact bytes, sizes and nanosecond modification times. All tracked runtime files match the released baseline; the pre-existing follow-up note retains its original hash.

## Failed and inconclusive investigation attempts

1. An initial browser probe assumed that the decoder cache must become active. It timed out at that precondition, then recorded a secondary mouse-release error during teardown. This was not a demonstrated sharpness failure.
2. A two-profile fixture initially combined ordinary High profile with lossless quantization, which FFmpeg rejects. The fixture was corrected to High 4:4:4 profile; that setup failure is retained.
3. A corrected diagnostic still required its software-profile control to use the decoder cache. It instead used native fallback and failed that expectation. Subsequent explicit container inspection established the absent `colr` box. This is not claimed as successful decoder-cache coverage.
4. Exploratory pure sizing checks failed five proposed full-resolution/area-accounting assertions against the current width cap. They demonstrate the existing cap and a proposed policy difference, not the user's actual browser failure. No such cache change was applied or committed to the product tests.
5. An extra screenshot extension initially did not wait for the selected layer's opacity transition. Both captures were blank, and its visible-detail preconditions correctly failed. Adding an explicit wait for the existing layer-opacity owner before playback/capture produced the final two passing visual checks; no contrast threshold was lowered. The earlier blank captures remain retained as invalid visual evidence.

## Independent adversarial review and limits

An independent agent compared the two pinned scrub implementations and ran source/pure-Node probes. The reviewer supports documenting current behavior without a runtime change, and cautions against calling the reduced cache fixed or attributing the exact user's improvement to a particular fallback. That reviewer did not independently run browser or FFmpeg workloads. Its readable record and source probes remain under `output/scrub-sharpness-adversarial-20261020-qBQ5K8/`.

The original user clip was not independently reproduced or verified. No complete browser suite, hosted workflow, physical display assessment or professional color/sync conformance test was run for this documentation-only outcome. The native controls do not validate the remaining downsampled decoder-cache path. A future cache-quality change needs its own real cache-hit visual regression, memory accounting and backward-scrub performance measurements: storing this particular frame at full size would cost about **2.33×** its current estimated RGBA cache bytes, even if the absolute cache ceiling were retained.

Author evidence, exact probe configurations, generated fixtures, screenshots, measurements, failed reports and preservation audit: `output/scrub-sharpness-20261020-lYiClS/`. Start with `visible-measurements.json`, `visible-browser.json`, `synthetic-container-metadata.json`, `preservation-final.json` and `WORK-LOG.md`. Reusable probe sources are retained there under `verification-tests/`; they are not part of the product's regression inventory.
