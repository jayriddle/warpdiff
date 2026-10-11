# Command-quoting review — October 11, 2026

This reviews the initial implementation at `f7ee15e7b1d516fc7be40534a9d9277c2848b501` on local branch `codex/safe-ffmpeg-command`. Jay requested review and fixes before host-load handling, with no merge or publication. Master and remote master were verified at `75eb81f701de89628d432148c46dac87b18f0d98`; the feature branch has no remote head. App/cache version remains 3.19.0.

## Findings and decisions

The POSIX quoting itself held up: input and output paths use single quotes with escaped apostrophes, and `./` prevents FFmpeg interpreting a basename as an option or protocol. The panel renders metadata through `textContent` and copies the complete registered command. Duplicate registration and automatic-transcode capability guards are retained.

Two adjacent inherited defects were confirmed and corrected:

1. **Output naming:** the fallback `.mp4` extension was subtracted even when the input had no extension. `review` became `re_aac.mp4`; short names could lose their entire basename. A single leading-dot name such as `.review` was mistaken for an extension, producing an unsupported output suffix. `_ffmpegFilenameParts` now removes only an actual suffix after the basename; extensionless, trailing-dot and hidden extensionless names keep their full name and gain `_aac.mp4`. Both copied commands and browser conversion use this pure helper, avoiding divergent naming rules.
2. **Copy errors:** refused clipboard writes rejected without handling; missing clipboard access silently did nothing. Copy now catches synchronous and asynchronous failures and reports them without claiming success. A later permission result cannot update a retired command/button after media clear or a panel refresh. Successful copy remains available after an error.

The new naming helper is the only change to the browser transcode owner. Its argument-array execution, codec options, stream mapping, edit-list handling, queue and generation cleanup are retained. The [owner comparison](transcode-owner-comparison.json) restores the old naming lines and verifies the remainder is byte-identical. The old initial-implementation identity receipt remains historical evidence; the whole owner now has a different hash because naming was corrected.

README, FEATURES, MANUAL and the in-app Manual describe the corrected filename behavior; the detailed workflow also explains copy-error feedback. No runtime dependency, external script, binary, service-worker change or version bump was introduced. Host-load handling, measurement accuracy and FFmpeg provenance/licensing remain later phases.

## Verification, including failures

The expanded cases first ran against the initial feature commit. They reproduced the truncated extensionless output and missing error feedback: **2 failed, 2 passed**, without retries. The [failure log](before.txt) retains exact assertions. Shell substitutions remain harmless `printf` probes.

Coverage now includes:

- **25 independently specified filename pairs × sh/bash/zsh = 75 complete argument checks** per browser run on this Mac. All command options, both literal paths and duplicate-registration behavior are checked. Other systems run the additional shells when those executables exist.
- Actual panel rendering and Copy clicks; clipboard success, refusal, missing API, synchronous failure, retry, and late resolve/reject after clear. Clipboard destinations are disposable stubs, leaving Jay's clipboard untouched.
- **Eight actual terminal FFmpeg conversions** in a temporary directory: apostrophe, substitution text, newline, leading hyphen, protocol-like prefix, ordinary/short extensionless names and a hidden extensionless name. FFprobe checks exact output names, H.264 video and stereo AAC at 48 kHz. Temporary media is removed in `finally`.
- Real browser/WASM conversion of an AC-3 fixture named `.review`, reloading `.review_aac.mp4` and obtaining a nonempty decoded soundtrack. Source metadata verifies stereo AAC at 48 kHz; decoded PCM is not used to infer the source rate, since browsers can resample it to the audio-device rate.

An initial focused run passed all nine tests. After strengthening the new error tests to check visible feedback, the [first full run](full-first.txt) reported **398 passed, 5 failed, 1 existing skip**. Three failures were test setup: the panel had been opened programmatically on the landing screen, whose comparison toast is hidden. These tests now load a real image and wait for the review to activate before exercising Copy, retaining the visibility assertion and retry check.

The other two failures were existing rotation-repaint and embedded-transport checks. They both passed in the subsequent targeted run, together with all nine command checks: **11 passed, 0 failed, no retries** ([targeted log](targeted.txt)). To distinguish an older failure from these changes, a temporary harness served the unmodified `f7ee15e` document while running the existing tests against unchanged dependencies. Across three repetitions, rotation failed twice and passed once; embedded transport passed all three: **4 passed, 2 failed** ([baseline log](baseline.txt)). The rotation issue therefore predates this review. The first embedded-transport failure was not reproduced by that baseline probe. Its cause remains unestablished; a passing rerun does not prove the test is stable. No playback code or existing playback test was changed for this phase.

The first WebKit run reported **8 passed, 1 failed** ([log](webkit-before.txt)): the new browser conversion test assumed AC-3 always triggered fallback. This environment instead retained Dolby Digital source metadata and displayed the decoded waveform and metrics ([observations](webkit-before-observations.md)). The test now explicitly registers conversion when the original file is still loaded, without replacing any automatic registration already in flight. This checks browser output naming independently of codec support. Production fallback behavior is unchanged; the existing automatic Chromium/WASM fallback test also passed in the full suite. The subsequent run removed the failed snapshot before it could be copied; its complete failure log and the transcribed observations are preserved.

Final results:

| Check | Measured result |
| --- | --- |
| Full Chromium regression suite | **403 passed, 1 existing fixture-timestamp skip, 0 failed, no retries; 2.7 minutes** ([log](full-final.txt)) |
| Final focused Chromium checks | **9 passed, 0 failed, no retries; 4.5 seconds** ([log](focused-final.txt)) |
| Final focused WebKit checks | **9 passed, 0 failed, no retries; 6.4 seconds** ([log](webkit-final.txt)) |
| Ownership / pure logic | **528 passed, 0 failed** ([log](ownership.txt)) |
| TypeScript syntax and final whitespace checks | Passed |

The full Chromium run verified the final production code. The later cross-browser fixture correction changed only the new test setup; all nine affected tests were then rerun in both engines. The older failures above remain part of the result, even though the final full run passed.

Logs remove only terminal color/control sequences and trailing whitespace/empty lines; assertions, failures and counts remain. Verification uses macOS, Node 26.4.0, Playwright 1.58.2 and FFmpeg/FFprobe 8.1.2. System FFmpeg and the bundled browser FFmpeg are distinct engines.

## Reproduction and limits

From the repository root with the existing development dependencies and system FFmpeg/FFprobe installed:

```sh
node node_modules/playwright/cli.js test tests/ffmpeg-command.spec.ts --workers=1 --retries=0 --reporter=line
npm run test:ownership
node node_modules/playwright/cli.js test --workers=4 --retries=0 --reporter=line
git diff --check
```

The [WebKit configuration](webkit.config.ts), [baseline configuration](baseline.config.ts) and [baseline probe](baseline-probe.spec.ts) preserve the exact temporary setup used here. They reference this workspace and are evidence/reproduction aids, not new default release gates. The WebKit run used `--config /tmp/warpdiff-command-review-webkit.config.ts` with the focused test command. The baseline run placed the probe in `/tmp/warpdiff-command-review-baseline-tests/`, used its recorded configuration, and selected `surface refresh preserves rotation|desktop embedded transport keeps` with `--grep`, `--repeat-each=3`, `--workers=1` and `--retries=0`.

Commands target macOS/Linux POSIX shells. Native Windows shells, invalid POSIX filename components (NUL/path separators), native Safari/Terminal permission dialogs, and manual OS clipboard/paste behavior were not verified. Playwright WebKit is browser-engine coverage, not an actual Safari certification. These tests do not establish audio-measurement accuracy or FFmpeg distribution permissions. The older intermittent playback checks need follow-up when strengthening release checks.

No merge, push, publication or Pages configuration change was performed. Host-load implementation has not started. Unrelated existing evidence and prototypes are excluded from the review commit.
