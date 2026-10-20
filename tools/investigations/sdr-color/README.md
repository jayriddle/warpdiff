# SDR color investigation and regression probes

Run from the repository root with existing Node dependencies, Chrome, Playwright WebKit and user-installed FFmpeg/ffprobe:

```sh
npm run test:color
# Optional new evidence directory; refuses an existing directory:
npm run test:color -- output/my-new-sdr-check
```

Nothing is installed or downloaded. Browsers run sequentially with zero retries. The harness starts and closes its own loopback static server and browser contexts; it does not use an existing preview/helper. Synthetic media and all artifacts live under the selected output directory. Existing `tests/fixtures` bytes and modification times are audited before/after, never regenerated. All tooling is outside the Pages allowlist.

Exit codes:

- **0:** the implemented assertions and surface checks have no findings in this environment. This is not professional color certification.
- **1:** completed measurements found picture/preparation problems. Read `verification.json` and screenshots; do not report this as a green color suite.
- **2:** fixture validation, a probe precondition, preservation or harness execution failed. It cannot support a color conclusion.

This is an opt-in investigation, not a replacement for the protected release checks. The initial released baseline reported findings; the follow-up corrections are recorded separately. Focused ongoing regressions now run in `tests/color-rendering.spec.ts` in the Chrome inventory and the WebKit profile. `verification.json` records the commit, branch, exact source hashes, tool/browser versions, device conditions, failures and summary. Runtime and native processor hashes are compared with the pinned released baseline `3270b02`. Changes are reported through `productionChanged` and exact hashes, so the same checks can exercise future fixes without pretending that they are unchanged released code.

## References and interpretation

Fixtures contain 32 aligned flat patches at 640×360, encoded losslessly to 8-bit 4:2:0 H.264. The input planes are authored directly; decoded plane hashes must match those bytes. Tagged variants explicitly declare matrix, range, primaries and transfer **on frames**, and the generated declarations are checked with ffprobe. Output flags alone were insufficient in the installed FFmpeg; that initial generation error is retained in the investigation record.

The matrix-601 fixture deliberately keeps BT.709 primaries/transfer while changing the matrix. It isolates matrix handling; it is not a claim to represent every aspect of standard-definition Rec.601. The full-range control uses the same numeric input planes with a different declared range. A separate image contains an explicit PNG sRGB chunk. Its identical twin has another filename so a temporary app warning cannot cover screenshot sample locations.

FFmpeg RGB references explicitly select the input matrix and range and sample patch interiors at native resolution. **These references test coded RGB/matrix interpretation; they do not by themselves establish a display's luminance transfer or appearance.** A separate transfer-tagged fixture uses sRGB so the code-value comparison has a shared explicit target. Untagged fixtures are observations of browser inference, not a recommended guessed color policy. The red HD fixture reproduces the release discrepancy with only the interpretation labels varied.

The HTML canvas specification permits color conversions when drawing/readback crosses color spaces. Canvas and screenshot observations are therefore kept distinct:

- https://html.spec.whatwg.org/multipage/canvas.html#color-spaces
- https://www.ffmpeg.org/ffmpeg-filters.html#scale
- https://www.ffmpeg.org/ffmpeg-filters.html#colorspace
- https://www.w3.org/TR/css-color-4/

## Assertions and limits

- Native preparation: copied H.264 elementary bytes, first decoded picture planes and ffprobe color fields must match exactly. This includes the color signaling present in the extracted stream. The FFV1→H.264 example checks declared color fields and allows at most three RGB codes at flat patch interiors. It is not a spatial-detail, resizing, motion or general lossy-codec quality test.
- Normal browser loading: explicit sRGB canvas readback must be identical between a plain video element outside the app, the app and copied prepared output. Scope **input sampling** must agree too; the meanings/calibration of the rendered scopes are not certified.
- Images: the explicit sRGB PNG must retain exact RGB values in Stack and Grid.
- Compositor captures: app native video and the plain player must agree within two codes at patch centers. Pictures are static throughout the clip, so these probes do not establish frame synchronization. Pointer placement and distinct fixture filenames prevent tooltip/warning occlusion.
- Difference: the actual composite is compared with absolute differences of independently sampled source RGB, not with another execution of the app's difference implementation. A fresh direct-video blend and a canvas-staging control help localize any error.
- Loupe: both the decoded video clone and an unobstructed interior screenshot sample are compared with the normal video.
- Scrubbing: use the real pointer gesture. Compare decoder pixels and displayed overlay against native video. The retired tone table is temporarily installed **only in the diagnostic page** as a negative control, then removed. It must introduce a detectable compositor shift. Native scrub fallback is recorded explicitly.
- Negative controls: a copied file with deliberately altered color signaling must fail preservation. Wrong matrix/range references must remain distinguishable. The explicit sRGB-transfer code-value comparison allows two codes for 8-bit conversion/rounding; the 24-code release discrepancy cannot pass it.

The tolerated one-/two-/three-code differences are limited to the checks above; they are not blanket acceptance limits for untagged media, HDR, perceptual Delta E or professional review. Browser-dependent BT.709 transfer observations remain separate from preservation assertions. A zero app-versus-browser difference does not prove the browser's interpretation is a reference display rendering.

The automated diagnostic does not drive native Safari. A separate native Safari 27.0.1 run and headed Chrome default/sRGB/P3-profile checks are recorded in the [follow-up evidence](../../../docs/sdr-color-fixes-2026-10-19/README.md). Forced browser profiles model compositor configurations; they do not change or calibrate the physical display. Not covered: Firefox, Windows/Linux/iOS measurements, physical display/colorimeter measurements, ICC-profiled wide-gamut images, HDR/tone mapping, 10/12-bit pipelines, chroma-edge reconstruction, complete media integrity or professional measurement conformance. The browser compositor is not a colorimeter or a capture of physical monitor output.

See the dated project record in `docs/sdr-color-verification-2026-10-19/README.md` for measured results, retained failures and recommended follow-up slices.

The `browserChecks` API also accepts `headless:false` and Chrome-only `colorProfile` values (`native`, `srgb`, `display-p3-d65`) for isolated visible-browser probes. `native` removes Playwright’s default `--force-color-profile=srgb` flag so the browser chooses its automatic display profile. A null profile keeps Playwright’s forced-sRGB default. These launch flags apply only to the temporary test process; no persistent browser or display settings are changed.

Browser regression fixtures retain lossless High 4:4:4 references for Chrome's software compositor checks. WebKit native-video checks select ordinary AVC High with the same authored patch layout and color declarations; the hosted WebKit player did not present the High 4:4:4 inputs. Profile assertions remain explicit, and no color assertion or capability skip is relaxed. CLI diagnostics continue to use the original lossless defaults.
