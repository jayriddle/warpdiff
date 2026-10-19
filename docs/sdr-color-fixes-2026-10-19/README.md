# SDR color corrections — 2026-10-19

**Follow-up qualification:** the subsequent [reported-file investigation](../scrub-handoff-2026-10-19/README.md) reproduced a 12-code shift on ordinary High-profile/NV12 output. These earlier lossless fixtures exercised I420 output and did not justify removing compensation from every decoder path. Retained results below describe their tested paths; they do not close the user's later report.

Candidate version: **3.19.9**, on `codex/sdr-color-verification`.
Released comparison point: `3270b02fabf862c1aa8d4eed50343d33956b6227` (3.19.8).
Initial investigation: `3f5c68683475195a06efb35cf3a7df7e730d4f3c`.
The user authorized correcting the findings and completing local verification. Merge and publication remain on hold. No dependency installation, persistent browser/display configuration change or remote publication is part of this work.

## Changes and rationale

1. **Retired the empirical macOS scrub tone table.** The initial diagnostic measured an 11/255 compositor shift from the filter. Visible Chrome runs reproduced the shift under Playwright’s default (forced sRGB), explicit sRGB and forced Display P3 D65 profiles. Removing the filter preserved native presentation in those configurations. The existing color-managed sRGB/P3 canvas selection remains. The old curve now exists only in test tooling as a deliberate negative control, outside the public package.
2. **Corrected WebKit video Difference.** Direct native-video difference blending overwrote rather than subtracted pixels in the tested WebKit build. `_diffCompositeSource` snapshots WebKit video through one reusable canvas before compositing. Images and Chrome retain their existing path. Existing pair selection, dimensions and playback-clock mismatch gate remain. Leaving Difference zeroes the staging buffer; clear also drops its reference. This adds one native-resolution RGBA backing store while active (about 32 MiB at 4K), plus native browser overhead; no total-browser-memory guarantee is implied.
3. **Accepted compatible full-range AVC in the connected local tool.** `yuvj420p` explicitly marked `pc` is a compatible 8-bit 4:2:0 input/output. It is copied within the existing dimension bounds. Known source range, matrix, primaries and transfer labels must survive copying. Unknown labels are not invented. No engine, executable or preparation helper is added to Pages. The separate 64 MiB package recipe is unchanged.
4. **Contained an additional untagged scrub mismatch.** Expanding real scrub gestures from one tagged fixture to all five SDR fixtures exposed a 39-code raw difference for the untagged SD-size fixture. The native and WebCodecs frames reported different color interpretations. A trial decoder color override matched readback but still shifted the displayed image by 63 codes, so that approach was discarded. The controller now observes a current native `VideoFrame` color space and closes the temporary frame immediately. Untagged decoder output must agree before painting; unavailable observations or disagreement retain native seeking. Declared container color is not overridden. Existing HDR native fallback remains. Late color rejection now closes the session and releases its encoded-input reservation immediately; a generation/identity fence prevents an old callback from replacing a newer owner. This preserves the browser's native behavior; it does not establish that untagged source interpretation is correct.

The last behavior uses observed metadata rather than a dimension-based matrix guess. The [WebCodecs specification](https://www.w3.org/TR/webcodecs/#videocolorspace) permits unknown color members and implementation-specific fallback behavior. Our measured native/decoder disagreement is recorded separately from any claim about source intent.

## Verification methods

- Synthetic local files only; no user media, remote uploads, downloaded fixtures or new dependencies.
- 32 flat luma/chroma patches, tagged BT.709, isolated BT.601 matrix, full range, explicit sRGB transfer and untagged variants; explicit sRGB PNG/twin; red-tag controls and one lossy encode example. See the [diagnostic instructions](../../tools/investigations/sdr-color/README.md).
- Native copy checks compare extracted H.264 bytes, decoded picture planes and declared color metadata. A real full-range AVC/AC-3 regression also checks every copied picture packet and timestamp and converts audio to stereo AAC. Deliberately falsified output matrix metadata must reject.
- Browser comparisons keep raw sRGB readback and compositor screenshots separate. Difference is checked against absolute differences of independently sampled source RGB values. Identical inputs must produce black. Tests check reuse, exit and clear of the temporary canvas.
- Real pointer gestures exercise SDR scrubbing across all five fixture interpretations. Tagged controls must paint through WebCodecs in Chrome. An untagged mismatch must use native fallback. The retired filter must still create a detectable shift when deliberately installed in a diagnostic page.
- Node fault/resource checks verify that mismatched untagged output closes before painting, failed native observations reject before decoder allocation, and temporary native frames close even when metadata access throws.
- New `tests/color-rendering.spec.ts` is part of the complete Chrome inventory and the focused WebKit profile. One browser worker and zero retries are used. Full suites run in an isolated checkout with copied fixtures and the existing dependency runtime, preventing legacy hooks from rewriting working-tree fixtures.

## Measured results

Final machine-readable counts, source hashes, report inventory validation and preservation results are in [verification.json](verification.json). Raw evidence is retained locally under:

`output/sdr-color-fixes-2026-10-19-CcMJge/`

Final complete checks:

| Check | Result |
|---|---|
| Complete Chrome inventory | 638 passed, one existing approved skip |
| Complete WebKit profile | 235 passed, no skips |
| Color cases within those final inventories | Six Chrome + six WebKit passed |
| Ownership | 1,368 passed |
| External preparation | 34 passed |
| Release infrastructure | 26 passed |
| Existing Opus mutation verification | Eight baseline cases passed; four mutants failed at their intended assertions |
| Color/resource guard mutation probes | Baseline passed; all four deliberate mutants detected at intended checks |
| Final SDR diagnostic | Nine native cases, ten browser fixture cases and six red controls passed; zero findings |

All completed browser runs used one worker and zero retries. The complete/disjoint inventory gates passed for both final browser reports, with no runner errors or unapproved skips. All public runtime files and relevant test sources were compared byte-for-byte between the final tested isolated checkout and this candidate. The local ownership total includes two optional checks against neighboring WarpCap sources; those sources are absent from a fresh hosted checkout. No hosted run is claimed here.

Additional measurements:

- Native preparation: **34 passed**, no failures/skips; includes two full-range matrix variants with AC-3 and negative output-label checks.
- Focused color browser regressions: **12 passed** (six Chrome, six WebKit), zero retries.
- Ownership: **1,368 passed**, zero failures.
- Release infrastructure: **26 passed**, zero failures.
- Actual Safari **27.0.1**, P3-capable display, device pixel ratio 2: app-versus-bare video readback error **0** for both tagged sources; video Difference error **1/255**; full-range original/prepared readback error **0**; staging buffer retirement on exit and clear passed; no collected page errors. This native run preceded the quiet version bump (its report says 3.19.8) and the subsequent Chrome untagged-fallback correction. It verifies the unchanged Difference/full-range paths, not that later Chrome-specific correction.

Visible Chrome pre-correction runs (155.0.8059.82) measured the historical filter at **11 codes** in each of Playwright-default (forced sRGB), explicit sRGB and P3 profiles; removing it measured **0** screenshot difference in each. These were headed browser processes. Forced profiles affect only temporary test processes; no physical display profile was changed. Final corrected measurements (all headed Chrome, native video vs actual scrub overlay):

| Profile | P3 capability reported | Raw readback error | Compositor error | Reapplied legacy-filter error |
|---|---|---:|---:|---:|
| Automatic display profile | Yes | 2 | 1 | 11 |
| Explicit sRGB | No | 0 | 0 | 11 |
| Explicit Display P3 D65 | Yes | 2 | 0 | 11 |

Values are maximum 8-bit code differences at fixture patch centers. Difference error was zero in all three Chrome profile runs. Full results and source hashes are in verification.json. The final automatic/native-profile run explicitly removes Playwright’s built-in `--force-color-profile=srgb` flag; the initial default run had not removed it and is not an automatic-profile measurement.

## Retained failures and resolutions

The original investigation remains a findings record; it was not rewritten as green. The intermediate `first-two-fixes` diagnostic passed all nine native cases and corrected WebKit Difference but still found the 11-code scrub filter defect.

The first native Safari probe failed its setup: it attempted Difference while Grid was active. Its failed JSON is retained. Explicitly switching to Stack corrected the probe, and native Safari then passed. No Safari security or automation setting was changed; the authored local page ran its own checks after a user-gesture button click through native UI automation. Only our temporary Safari tab was closed.

The first expanded browser run recorded **10 passes and two failures**: the real Chrome untagged mismatch and a WebKit test setup omission (Reset's confirmation was dismissed). The test now explicitly accepts its own Reset confirmation and waits for clear. A trial native-color override then recorded **11 passes and one failure**, detecting the 63-code compositor mismatch despite passing raw readback. The override was removed; agreement/native fallback replaced it. The completed fallback run passed all 12 cases. Controlled mutations also verified the intended failures for allowing a native/decoder mismatch, allowing an unobserved interpretation, omitting the retirement notification and retaining the temporary native frame.

The first broad Chrome run was intentionally stopped after a decoder-specific audio test used an untagged SD fixture and correctly received native color fallback. It recorded 280 passed, one failed, one interrupted and 357 not run; it was not green. Decoder-specific Continuous/cadence tests now create isolated, explicitly tagged SDR copies. Their helper asserts unchanged decoded picture planes and unchanged audio packet hashes/timestamps; original fixtures remain untouched. Both affected tests passed their focused rerun. A subsequent broad attempt was stopped with 366 passed, one interrupted and 272 not run after final source review identified retention of encoded-input reservations on late color rejection. The correction releases that reservation immediately and fences late callbacks; Node and browser regressions cover it. Neither interrupted attempt is a complete passing suite. These strengthen the intended decoder-path setup; they do not alter the separate untagged-fallback assertions.

An orchestration restart used the wrong working directory and failed to copy the correction; its unintended test attempt was stopped and is not counted as completed verification. A separate immediate launch correctly rejected an occupied owned port. Logs are retained. Subsequent runs used corrected absolute/configured locations and separate reports/output directories. An early ownership run exposed the newly required layer lookup missing from its controlled harness; adding that test fixture dependency restored the complete harness. None of these setup failures is a passing product check.

## Remaining limits

These checks establish the stated SDR preservation and regression properties, not professional color certification. Physical monitor measurements, calibrated luminance/white point, perceptual Delta E, ICC-tagged wide-gamut images, HDR/tone mapping, 10/12-bit paths, chroma-edge quality, all codecs, Windows/Linux/iOS measurements and every Safari version remain outside this verification. Forced P3 is a browser-compositor configuration, not a physical P3 monitor calibration.

Difference compares browser-decoded RGB values with canvas rounding. It is not a linear-light difference, HDR mastering comparison or proof of identical encoded samples. Native and decoder agreement does not certify untagged color intent. Static fixture frames do not establish moving-frame synchronization, full-file integrity or complete midstream color-change handling. Scopes' sampled input is checked; scope calibration is not certified. Prepared stereo AAC is a listening compatibility copy, not original-source audio analysis or channel-fidelity certification.

Historical Grid (`topGap = -899`), 44.1 kHz amplitude and broader WebKit 7.1 observations remain separate; these changes do not establish their causes or repair them.

The final preservation audit found no unexpected changes among 1,144 pre-existing hashed tracked/non-ignored files. All 37 existing fixture files retained their bytes, sizes and modification times. Five new intended project files contain the focused browser test, test-only tagged-fixture helper, retired-filter negative control and these two compact verification records. The isolated checkout and raw logs remain ignored and unpublished. Read-only GitHub/API observation confirmed that main and the live `version.json` remained at the released baseline.

A physical display conformance pass still needs a reference display/target specification and measurement instrument. No guessed software compensation substitutes for that work. Hosted checks, independent review, merge and publication have not been performed for this correction.
