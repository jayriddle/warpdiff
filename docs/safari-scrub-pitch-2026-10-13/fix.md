# Brief-preview pitch fix and verification

October 13, 2026. Local branch: `codex/interim-release-review`.
Base: `8823702`; unpublished interim candidate remains **3.19.1**.
Jay authorized the proposed local fix and testing with “Keep going.” No push,
merge, publication, protection activation or pinned-component update occurred.

## Change and rationale

The [initial investigation](README.md) found an inconsistency: an initial
90 ms preview applied normal transport speed directly to its samples, then
Continuous entered with retained pitch. At 0.25× and 0.5× a 440 Hz tone could
therefore begin around 110 or 220 Hz before returning to 440 Hz.

`playScrubSnippet` now uses a 1× source rate for click, warm-up and fallback
previews. That same rate governs the existing phase alignment, source span and
gain envelope. The preview remains 90 ms, with a shorter remaining source tail
near its end. The 50 ms cadence, fades, selected soundtrack, stereo/surround
routing, volume, mute, idle cutoff and cleanup owners are unchanged.

This deliberately revises the old adapter policy of matching transport speed.
No time-stretching processor or new audio engine is needed for a brief preview
to retain pitch. Normal playback speed still changes through J/K; live tests
verify both the selected rate and the native video's playback-rate property.

The README, feature inventory, Markdown and in-app manuals, Getting Started,
shared-component contract and repository guidance now describe the same preview
policy. The unpublished release remains consolidated as 3.19.1 with its existing
FFmpeg-removal announcement. Refresh an older open local page before listening.

Three behavioral tests in `tests/scrub-pitch.spec.ts` cover rendered stereo
pitch/level at all seven selectable rates, entry into Continuous, and automatic
snippet fallback in both drag directions at 0.5×, 1× and 2×. Forced fallback is
confined to a test page. The focused WebKit CI profile now includes these tests;
the GitHub check names and protection proposal stay unchanged. `_config.yml`
also excludes the diagnostic `tools/` directory from a future Pages build.

## Verification

| Check | Result |
|---|---|
| New regression before the fix | Expected failure: 0.25× left-channel tone measured **109.994 Hz**, expected 440 Hz. [Log](regression-before.txt). |
| Final focused Chromium run | **25 passed, 0 failed**, approximately **1.2 minutes**, one worker and zero retries. Covers pitch, Continuous, fallback cadence, full-rate/filtered preview, volume/mute, surround listening, idle, source changes and clear/reload. [Log](focused-final.txt). |
| Expanded focused WebKit profile | **31 passed, 0 failed, 0 skipped, 0 flaky**, **24.1 seconds**, one worker and zero retries. External command/preparation/reload plus the three new pitch checks. [Log](webkit.txt), [regression measurements](webkit-regression.json). |
| Ownership and pure logic | **525 passed, 0 failed**. [Log](ownership.txt). |
| Exact prepared AAC file | **32 non-silent offline renders** plus **12 live path-selection gestures** across Chromium and WebKit, no page/engine errors. Brief previews now measure **439.935–440.149 Hz** at all six real-file rates tested. Continuous retains approximately 440 Hz in both directions. [Measurements](fix-results.json). |
| Pinned/source preservation | Vendor check passes. Both pinned DSP files, their lock, audio routing, monitoring, Opus sync, audio metrics and transport are byte-identical to the base. The exact input file's SHA-256 is unchanged. Hashes are in [fix-results.json](fix-results.json). |
| Static checks | `node --check js/scrub-audio.js`, `git diff --check`, and Ruby YAML validation of the Pages tooling exclusion pass. |

The new spectral regression renders the shipped snippet function through an
isolated OfflineAudioContext; only the context/output destination are
substituted. Two independent 440/660 Hz channel tones test stereo preservation.
At every selectable rate (0.25/0.5/0.75/1/1.25/1.5/2×), measured pitch stays
within 0.5 Hz of its source, RMS stays within the original 50% volume band,
audio after the 90 ms envelope is silent, and input samples remain unchanged.
Live tests use real J/K keys and trusted mouse down/up, with held movement
through actual handlers inside the existing 130 ms activity window. Both
normal entry and a real failed worklet load retain snippet audition at 1× while
normal transport stays at the selected speed. Clear removes the WebKit sink.

The actual AAC-file probes retain the initial investigation's distinction
between selected transport speed and motion-derived Continuous tempo. They
test six snippet rates and five processor tempos in both directions. The new
synthetic regression additionally tests the selectable 1.25× rate. Raw probe
window frequencies and event timelines are in local
`output/safari-scrub-pitch-fix-2026-10-13/`; compact results are retained here.
The saved console logs remove terminal escape sequences and trailing spaces;
their numerical results and failure messages are retained. Raw console logs
remain at `/tmp/warpdiff-pitch-*-20261013.log`.

## Failed checks and resolution

The expected negative regression failed on the old 110 Hz output. Its failure
report also contained a 60-second timeout and an incomplete trace. The pitch
assertion and its returned numerical result establish the regression; the
incomplete trace is not used as acoustic evidence. Neither the configured
timeout nor retry policy was increased to obtain the passing result.

The first post-fix focused run passed 23 checks but failed the two new live
checks because the test's browser predicate referenced a Node-side `fallback`
variable that Playwright does not serialize. Both failures were
`ReferenceError: fallback is not defined`, before gesture assertions.
The [first-run log](focused-first.txt) retains these failures and associated
timeout reports. The runner was interrupted while it was finishing failure
cleanup. The correction passes the requested readiness field explicitly as
the predicate argument. The final 25-check run then passed without retries;
no additional application change, relaxed assertion or skipped test was needed.

## Remaining review and next action

These results establish the corrected brief-preview pitch behavior and exercise
the existing output/lifetime controls. They do not certify sound through the
installed Safari app or remove every Continuous stretching artifact. The
broader WebKit native 7.1 FLAC limitations remain outside this focused profile.

The complete Chromium release gate recorded on October 12 predates this source
change; it is not a complete-suite pass for the new revision. The affected
Chromium suites and expanded WebKit profile have been rerun as listed above.
The whole Chromium suite must pass for the eventual release revision, locally
or through the proposed hosted gate, before a merge/publication decision.

Jay's next check:

1. Refresh Safari at `http://localhost:8080/`, then load `ac3_video_aac.mp4`.
   Loading resets playback speed to 1×. The local header remains v3.19.1.
2. Press **J twice** for 0.5×. Scrub forward/backward with several separate
   starts and stops. Check whether the occasional lower starting tone is gone.
3. Press **K twice** to return to 1×; repeat. Optionally press **K three more
   times** for 2× and confirm previews still retain their pitch.
4. If available, repeat with known speech to assess remaining stretch texture.

After that listening check, request Jay's approval to push only the interim
feature branch for exact-revision hosted checks. Merge and publication remain
separate held decisions. No FFmpeg engine or broader foundations work was added.
