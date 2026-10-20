# SDR color verification — October 19, 2026

## Scope and authorization

Jay approved the proposed first slice: investigate the recorded red discrepancy and build automated SDR reference/regression checks. Work is on `codex/sdr-color-verification`, starting from released main `3270b02fabf862c1aa8d4eed50343d33956b6227` (3.19.8). Application and native preparation production code are unchanged. Merge and publication remain on hold. No PR or hosted workflow was requested for this investigation slice.

Reusable tooling is in `tools/investigations/sdr-color/`; `npm run test:color` is the entry point. It creates fresh isolated references and exercises existing preparation functions plus normal browser/UI paths. It records findings and exits nonzero instead of calling the current app color-conformant. It does not replace the required release gates.

Durable local evidence: `/Users/jay/Documents/warpdiff/output/sdr-color-2026-10-19-1EB9ut/`. Raw media, complete reports and screenshots remain ignored/unpublished. Compact measured results are retained beside this record once verification finishes.

## Release discrepancy localized

The earlier release probe compared approximately `[254,0,0]` from FFmpeg with `[255,24,0]` / `[255,25,0]` from Chrome/WebKit. The input lacks declared matrix/primaries/transfer. Reproduction with a new HD red/DTS fixture established:

| Interpretation | FFmpeg explicit matrix | Chrome original/prepared | WebKit original/prepared |
|---|---|---|---|
| Untagged HD red | 601: `[254,0,0]`; 709: approximately `[254,24,0]` | `[255,24,0]`, unchanged | `[255,25,0]`, unchanged |
| Explicit 601 matrix | `[254,0,0]` | `[254,0,0]`, unchanged | `[254,0,0]`, unchanged |
| Explicit 709 matrix | approximately `[254,24,0]` | `[255,24,0]`, unchanged | `[255,25,0]`, unchanged |

The tag controls keep decoded YUV picture samples constant. Native preparation also preserves the compressed picture and color signaling for successful copy cases. The original red difference is explained by differing interpretation of untagged video, not a demonstrated alteration by preparation or the normal WarpDiff player. This does not establish a universal inference rule for all untagged files: the SD lossless-pattern fixture exposes other engine differences. Do not automatically label arbitrary inputs 709 based on this one HD reproduction.

## Findings needing follow-up

1. **Chrome/macOS scrub correction:** on the tested headless sRGB environment, raw WebCodecs pixels match the normal video, but the active historical correction filter shifts displayed patches by up to 11/255. Temporarily removing that filter in the test page reduces the compositor difference to zero. This is a real result for the recorded configuration, not proof that every physical P3 display should lose the correction. Revalidate target-specific gating/calibration before changing production rendering.
2. **WebKit video Difference:** the app's composite does not match independent RGB subtraction (maximum code error 255 in these controls). A fresh direct-video canvas blend has the same problem; staging the source pictures through canvases yields the expected subtraction. The original app behavior remains unchanged. Physical Safari was not executed, so the finding is pinned to Playwright WebKit and its recorded version.
3. **Full-range native preparation:** browsers load the tagged full-range H.264 control correctly, but preparation rejects its output at the compatibility-format check. FFprobe reports full-range 4:2:0 as `yuvj420p`; the current copy/output guards require `yuv420p`. This is a compatibility rejection, not accepted output with proven wrong colors. It needs a bounded format/range handling test and correction in a preparation slice.

These are findings from existing released behavior, not regressions introduced by this tools-only branch. The new diagnostic is expected to return findings until the corresponding behavior is corrected or the scope is explicitly narrowed with a documented decision. No tolerance was widened to accept these findings.

## What passed and what that means

Normal app versus bare-player decoded pixels and compositor samples agree for the tested tagged/untagged fixtures. Successful native copy cases preserve compressed picture bytes, decoded picture bytes and declared color fields. Scope sampling, image Stack/Grid and the video loupe agree with their source controls. Wrong matrix/range and altered-metadata controls demonstrate that the assertions discriminate between interpretations.

Chrome and WebKit show different BT.709 midtone treatment even outside WarpDiff: for example, a limited-range Y=128 neutral patch read approximately 130 in Chrome and 141 in WebKit. An explicitly sRGB-transfer-tagged control agrees with the coded reference within one code in both. The raw matrix reference does not settle which end-to-end display rendering is appropriate for a viewing environment. Neither browser is treated as the sole color authority.

## Retained failed checks and corrections

- Initial tagged-fixture generation used output flags without frame-level setparams. FFprobe showed missing primaries/transfer; this was a harness construction failure. Frame labels were explicitly authored and assertions now reject incomplete generated references. Initial fixtures and native results remain retained.
- The full-range rejection is retained as a finding, not turned into a green expected-color result.
- The WebKit Difference assertion initially stopped the extended surface probe. A drawable-picture precondition and fresh direct/staged blend controls confirmed the same error; it is retained as a finding while allowing the other measurements to complete.
- An early extended screenshot comparison was contaminated by an identical-file banner and a hover tooltip. It read 57/47-code differences with/without the filter. Screenshots revealed the occlusion; distinct filenames and an unobstructed pointer position restored the causal result of 11/0. These artifacts remain retained and are not color evidence.
- An attempted standalone FFmpeg 709→sRGB transfer reference differed from WebKit in shadows by up to roughly 17 codes. It is retained as exploratory evidence, not adopted as a validated browser or display oracle. No gamma curve was fitted to make browser values pass.

## Proposed next slices

First, a focused WebKit Difference workaround with the independent subtraction/staging controls, normal playback/frame-pair gating tests and actual Safari verification where available. Second, explicit full-range 8-bit H.264 handling in the local preparation tool, requiring picture and color signaling preservation. Third, revisit scrub correction with separate sRGB and physical P3 captures; do not replace it with another guessed universal curve. These can remain separate reviewable changes.

Color reporting in the broader input contract should eventually distinguish declared interpretation, inferred/unknown interpretation, transformations and verified capabilities. Ordinary direct loading should remain available. Physical display calibration is a separate task requiring suitable hardware and viewing conditions.

## Final measured verification

Four complete executions during diagnostic finalization finished with **exit 1 / `status: findings`**, each reproducing the three findings. These were explicit harness development/verification executions, not automatic test retries. This is not a green suite. The final execution used the committed tooling file contents; `verification.json` pins their hashes. Both runs used one browser at a time and zero retries. The final working-tree execution still had released main as HEAD; the source hashes identify the new tooling, rather than claiming those tests ran at a later commit.

| Check group | Measured result |
|---|---|
| Native preparation cases | 8 passed, 1 rejected: full-range H.264 |
| Copied picture cases within those passes | 7; compressed video, decoded first picture and color fields identical |
| Lossy FFV1→H.264 flat-patch example | 1 passed; measured patch-interior RGB error 0 |
| Original/prepared red controls | 6 browser observations; unchanged through preparation |
| Browser fixture cases | 10 across Chrome/WebKit; app-versus-bare decoded/compositor error 0 |
| Scope input sampling | Error 0 against the corresponding bare-player readback |
| Explicit sRGB PNG / image Stack and Grid | Exact RGB values retained |
| Explicit sRGB-transfer video reference | Chrome error 0, WebKit maximum 1 code |
| Video loupe | Clone and sampled compositor error 0 in both engines |
| Video Difference | Chrome error 0; WebKit error 255, direct control 255, staged control 0 |
| Scrub path | Chrome raw error 0, filtered compositor 11, unfiltered causal control 0; WebKit native fallback error 0 |
| Wrong labels/matrix/range controls | All rejected/discriminated as intended |
| Browser page errors / unhandled rejections | 0 in both engines |
| Existing ownership harness | 1,360 passed, 0 failed (includes two neighboring WarpCap checks) |
| Existing infrastructure suite | 26 passed, 0 failed |
| Preservation | 1,135 existing entries audited; only intended README/package changes; all 37 existing fixture files unchanged, including hashes/sizes/mtimes |

Environment: Node 26.4.0, Playwright 1.58.2, FFmpeg/ffprobe 8.1.2, Chrome 155.0.8059.82, Playwright WebKit 26.0. Chrome reported P3 false; WebKit reported P3 true. Both were automated headless contexts on macOS. A media-query report is not physical-display calibration.

Raw final execution: `output/sdr-color-2026-10-19-1EB9ut/completed-diagnostic/verification.json`, its `browser-results.json` and PNGs. Earlier complete executions are in `final-diagnostic/`, `confirmed-diagnostic/` and `review-diagnostic/`; exploratory scripts and failed intermediate captures remain alongside them. Local ownership and infrastructure logs are retained in the evidence directory. No full legacy Playwright suite or hosted workflow was run because no production code or required CI gate changed; the new diagnostic directly exercises the relevant surfaces.

`README.md` now describes native video color handling without claiming unverified end-to-end color correctness and links this investigation. The live app, version, native processor, runtime assets, pinned vendors, lockfiles and release settings are unchanged. All owned diagnostic servers/browsers were closed. No merge, publication, PR creation or push occurred.
