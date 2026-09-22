# Listen control: return to playback

## Report and reproduction

Jay reported that selecting a multichannel Listen preset left keyboard focus in the control and made playback difficult to resume.

The original panel stopped every bubbling keydown, intentionally protecting keyboard slider edits from global video shortcuts. However, a preset button remained focused after a click. Space activated that same button again rather than reaching playback. Escape returned focus to the disclosure, which also owned Space. This was a focus handoff defect, not an audio-engine problem.

A real-browser regression test reproduced it before any production edit: load the generated 7.1 FLAC fixture, open Listen, select Dialogue Focus, press Space, and inspect the video. Playback remained paused; the expected transition to playing failed. No synthetic focus/key events or timing-state mocks were used.

## Change

`js/audio-monitor.js` owns the control's focus transitions through `_returnAudioListeningToPlayback`:

- Selecting Full Mix, Dialogue Focus, or Center Only returns focus to the existing Play/Pause button. This works for mouse, Enter, and Space activation. Selection alone does not start or stop playback.
- The panel stays open, retaining direct access to the level sliders and other presets.
- Finishing a pointer adjustment to a level slider returns focus to Play/Pause. Keyboard arrows continue editing the focused slider; they do not seek or switch videos.
- Escape closes the panel and focuses Play/Pause. Clicking the disclosure with a pointer also returns focus to playback after toggling the panel; keyboard disclosure navigation remains native.
- Clicking outside closes the panel and releases any focus still inside it. A click on a non-focusable picture can therefore return to playback shortcuts, while normal focusable targets retain their browser behavior.

The existing Play/Pause control and keyboard dispatcher still own playback. Listening state, channel matrices, decoded PCM, analysis, and the slow-playback experiment were not changed. Programmatic listening updates do not move focus.

The manual, feature inventory, README, in-app manual, and What's New describe the handoff. Local version is 3.17.6; the service-worker cache and README version match. No push or deployment is included.

## Verification

- **Historical regression:** the new preset-to-Space playback check failed against the pre-fix implementation, with the video still paused.
- **Initial focused check:** three UI/lifecycle tests passed, covering presets, pointer sliders, keyboard arrows, Escape, unsupported layouts, and reset.
- Expanded checks also exercise Enter and Space preset activation without accidental playback, picture-click dismissal, all existing native/Continuous/replacement channel-listening tests, and the Signalsmith prototype's playback/memory tests.
- The first expanded run passed 20 of 21 tests. The preset test intermittently failed when rapidly toggling several play/pause cycles using only the immediate `paused` flag. An isolated event trace confirmed correct focus and key delivery for Enter and Space; an unchanged focused rerun passed. The test now waits for the playhead to advance and for pause-time seeking to settle before the next cycle, verifying actual playback rather than only an early flag change. No transport implementation was changed to mask that test interaction.
- **Ownership/pure logic:** 430 passed; version alignment, script/offline inventory, pinned shared components, and existing single-owner guards remain intact.
- **Final focused repetition:** both new interaction tests passed three consecutive runs each (6/6, retries disabled), with the strengthened playhead-advance check. The other 20 cases in the expanded run passed, including every existing listening case and all six slow-playback tests. A complete application-wide browser run was not repeated for this focus-only change.

The first combined source/document patch did not match the exact feature-document line and was rejected atomically. No partial production edit resulted; the corrected patch used the actual text. The pre-fix failing assertion and this correction are recorded rather than reporting only the passing runs.

Browser: isolated muted headless Chrome 153 on macOS, using generated fixtures. The user's browser and media files were not changed. This verifies actual focus and video play/pause transitions; it is not a new listening-quality evaluation.

Commands:

```sh
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test tests/dialogue-listening.spec.ts --grep 'Listen preset choices' --workers=1 --retries=0
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test tests/dialogue-listening.spec.ts tests/slow-playback.spec.ts --workers=2 --retries=0
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test tests/dialogue-listening.spec.ts --grep 'Listen ' --repeat-each=3 --workers=1 --retries=0
npm run test:ownership
git diff --check
```
