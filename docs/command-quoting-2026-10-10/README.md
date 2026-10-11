# Phase 1: copied FFmpeg command quoting — October 10, 2026

This records the initial implementation at `f7ee15e`. The [October 11 follow-up review](../command-quoting-review-2026-10-11/README.md) records additional filename and copy-error fixes, expanded verification and remaining limitations.

Status: local feature branch `codex/safe-ffmpeg-command`, based on master `75eb81f701de89628d432148c46dac87b18f0d98`. This work is for Jay's review; it is not merged, pushed or published. The app/cache version stays at 3.19.0 until a release is agreed.

## Agreed scope and approach

Jay approved a phased hardening plan and asked to start with command quoting on a feature branch, test it and document the results, then hold merging/publication for review. The agreed defaults are copied POSIX commands for macOS/Linux first, no guessed surround loudness in the later measurement phase, and preservation of the intended application licensing while resolving third-party FFmpeg distribution terms separately.

This phase changes only copied terminal commands and their instructions. Host-load handling, audio measurement algorithms, FFmpeg binaries/licensing, release settings, dependency updates, memory budgets and module architecture remain later phases. No runtime dependency or new script file is introduced.

## Confirmed defect and correction

The original command inserted input/output filenames into double quotes. Double quotes allow shell substitutions. The new browser-to-shell regression failed against the original source: the literal filename `clip-$(printf EXPANDED).mp4` became `clip-EXPANDED.mp4` in both path arguments. The probe used a harmless `printf` substitution and an FFmpeg shell stub; it did not execute arbitrary external commands. The [before-fix failure](before.txt) is retained.

`_quotePosixShellArg` now quotes one literal argument with POSIX single quotes, closing and reopening quoted spans around escaped apostrophes. `_registerFfmpegCommand` applies it to both paths. Each path starts with `./`, so leading hyphens cannot become output options and protocol-like filenames remain local paths. The user must run the command from the folder containing the original file; the browser receives a basename rather than its original filesystem path.

The existing command options, output naming and automatic browser-transcode entry point are retained. The browser uses its existing argument array and temporary filesystem filenames; it never evaluates the copied command. A [source identity check](browser-transcode-identity.json) records whether the browser transcode owner is byte-identical to the baseline.

The panel note, Copy button tooltip/accessibility label, in-app Manual, README, FEATURES and MANUAL now specify macOS/Linux terminal usage and the working-directory requirement. Filename metadata continues to render through `textContent`; clipboard handling copies the complete registered command rather than its visually shortened display.

## Verification and meaningful failures

The three new tests in [ffmpeg-command.spec.ts](../../tests/ffmpeg-command.spec.ts) exercise the shipped browser registration and UI. Only the unrelated automatic browser transcode is stubbed in these focused tests.

- A real `/bin/sh` parses generated commands. An FFmpeg function prints its complete NUL-delimited argument list. All 20 filename cases must preserve exact input/output values and every existing transcode option. Cases include spaces, apostrophes, double quotes, variables, substitutions, backticks, quote-escape attempts, backslashes, newline/carriage return, leading hyphens, Unicode, globs, operators, a leading tilde, a protocol-like prefix and multiple periods. The [case table](../../tests/fixtures/ffmpeg-command-filenames.json) contains independently specified output names. Duplicate registration must retain command identity and start only once.
- A browser check verifies platform/folder instructions, full literal filename display, equality of registered/displayed/copied commands, and the real Copy button's completion state. Its clipboard destination is a disposable test stub, leaving Jay's clipboard unchanged.
- Four generated commands run actual system FFmpeg against copies of the AC-3 video fixture in a temporary directory, with leading-hyphen, apostrophe, substitution-text and newline filenames. FFprobe must find the exact expected output filenames, H.264 video, stereo AAC at 48 kHz and a nonempty duration. Temporary files are removed in `finally`.

The first after-fix focused run passed the shell and actual-transcode tests but its Copy click was intercepted by the app's first-visit welcome backdrop. The [setup failure](setup-failure.txt) is retained. The test now sets `lastSeenVersion` in its disposable browser profile before navigation, following the existing editor-test convention; production welcome behavior is unchanged.

Final focused run: **3 tests passed, 0 failed, 0 retries; 1.7 seconds**, covering all 20 shell cases and four actual terminal transcodes ([log](focused-final.txt)). Ownership/pure logic: **528 passed, 0 failed** ([log](ownership.txt)).

Full Chromium suite: **397 passed, 1 existing fixture-timestamp skip, 0 failures, 0 retries; 2.6 minutes**, 398 total ([log](full-suite.txt)). This includes the three new command checks and the existing real browser/WASM AC-3 fallback regression. JavaScript/TypeScript syntax and final staged whitespace checks passed. The browser transcode owner is byte-identical to master (`71ed4d9d7345b2ec897906e42ae3b4c50535be634a78c54dcb17f22e419da299`).

Test logs are normalized only by removing terminal control/color sequences and trailing whitespace/empty lines. Failed assertions, values and final counts are preserved. The final run used no retries; Node 26's Playwright loader deprecation and color-environment warnings did not fail checks.

## Reproduction

Run from the repository root, with the project's existing development dependencies installed:

```sh
node node_modules/playwright/cli.js test tests/ffmpeg-command.spec.ts --workers=1 --retries=0 --reporter=line
npm run test:ownership
node node_modules/playwright/cli.js test --workers=4 --retries=0 --reporter=line
git diff --check
```

The focused shell tests require `/bin/sh`, system FFmpeg and FFprobe. Fresh-checkout media fixture generation also requires FFmpeg. Verification here uses macOS, Node 26.4.0, Playwright 1.58.2, Chromium, and system FFmpeg/FFprobe 8.1.2. The system FFmpeg is distinct from the unchanged browser/WASM bundle.

## Limits and review hold

Copied commands target macOS/Linux POSIX shells. Native Windows Command Prompt and PowerShell quoting are outside this phase. NUL bytes and path separators are not valid POSIX filename components and are not part of the filename test set. This phase does not validate malicious host payloads or establish FFmpeg distribution permissions. Shell checks inspect complete arguments, and terminal transcodes verify output codecs; they do not establish professional audio measurement accuracy.

Master remains at the baseline revision. No remote push, merge, Pages settings change, deployment or release is authorized by this implementation step. Unrelated pre-existing untracked evidence and prototypes are excluded from this work.
