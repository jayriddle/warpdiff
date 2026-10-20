# Odd-dimension preparation correction — 2026-10-20

PR #56's independent adversarial review at `b68b2234a7fd3298ec9ff9f9c72681df97799924` found an introduced preparation regression: the new explicit SDR colorspace filter requested 4:2:0 output before the existing resize could normalize odd dimensions. A declared-SDR 161×91 FFV1/4:4:4 input failed, while the released processor and an even-sized candidate control succeeded.

The correction runs the existing bounded, aspect-preserving scale with `force_divisible_by=2` before explicit SDR color conversion. Input range/matrix/primaries/transfer still come from the verified source metadata, conversion still dithers to limited-range BT.709, and all four output tags are still written and verified. Compatible picture copying, HDR/unknown-color refusal, external execution and cancellation boundaries are unchanged. The optional gamma-alias observation is deliberately outside this correction.

The first hosted run of this correction (`39445714518`, commit `c2d1339`) was **not green**: FFmpeg 6 preparation passed 45 cases and failed the three full-range odd-geometry black-level checks. Limited-range cases and both even controls passed. The resize now explicitly sets `in_range` and `out_range` to the verified source range, preserving those sample levels before the later colorspace filter converts them once. No pixel tolerance or assertion was relaxed. The corrected complete local FFmpeg 8 suite again passed all 48 cases; hosted FFmpeg 6 verification remains required on the new commit. The failed job log is retained under `output/pr56-release-20261020-eFYDvj/`.

## Regression evidence

Eight real native cases cover odd width and height (161×91), odd width only (161×90), odd height only (162×91), and the even control (162×90), each in limited and full range. Inputs use FFV1/4:4:4, which preserves odd dimensions, and explicit frame color properties. Each case verifies input dimensions/format/tags, prepared H.264/4:2:0, even dimensions within rounding tolerance, six frames and 0.25-second duration, limited BT.709 tags, and decoded black/white levels within two luma codes of 16/235.

- Before the processor correction: **six odd-geometry cases failed, two even controls passed**. The failures occurred in preparation, after input assertions passed.
- After the correction: **all eight passed**, along with the existing full-range 10-bit black/white conversion control (**nine focused passes**).
- Complete `npm run test:preparation`: **48 passed**, zero failures/skips/cancellations. This retains HDR/unknown-color refusal, native cancellation, soundtrack duration, packet preservation and package checks.
- `npm run test:ownership`: **1,725 passed** locally; two checks inspect neighboring WarpCap sources and are absent from hosted checkout.

Commands used one serialized native workload; no test retries were added. Local tools: Node 26.4.0 and FFmpeg/ffprobe 8.1.2. This is not an independent FFmpeg 6 execution, a full browser-suite rerun or physical color certification. Browser runtime/public assets are unchanged, so candidate 3.19.10 and its cache/asset identities remain unchanged.

Raw red/green logs, preservation checks and the final work receipt are retained in `output/odd-dimension-fix-20261020-lcPjYk/`. The prior adversarial report remains intact in `output/pr56-adversarial-review-20261020-450ysubg/REVIEW.md`. Hosted results, if subsequently run, belong to their exact new commit and must not be attributed to the prior `b68b223` checks. Merge and publication remain on hold.
