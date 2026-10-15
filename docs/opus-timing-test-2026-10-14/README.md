# Deterministic Opus scheduling tests — October 14, 2026

Work is isolated on **`codex/deterministic-opus-timing`**, based on released main
`f5d620837b628ca20e1ae93aa1c4ec69eb7550a2`. Jay requested the deterministic test fix,
verification and documentation, with merge and publication held for review.

The change affects the browser tests and their WebKit profile. Application
scripts, markup, media processing, app version and service worker are unchanged.

## Why the test failed

The first post-release [main check run](https://github.com/jayriddle/warpdiff/actions/runs/38652121337)
failed the pending-source test's setup assertion. The source was scheduled at
0.015 seconds, but the audio clock was already 0.020317460317460317 seconds when
the test tried to stop a supposedly pending source. The trace showed the app
correctly using its already-started fade path. A successful job rerun did not
remove this test race.

Running a sequence in one JavaScript task does not stop the independent audio
clock. Short real-time timing windows therefore made these scheduling-policy
checks dependent on the runner's scheduling and audio device.

## Change and scope

The existing six scenarios call the actual app scheduling functions through
`__testAPI.opus`. A test-scoped wrapper now supplies real OfflineAudioContext
nodes and an explicitly controlled `currentTime`, beginning at one second.
Only `clock.advance()` changes the app-observed clock. The offline graph never
renders, and its resume method does not start processing.

Each scenario is synchronous. The wrapper restores the original audio-context
getter in `finally`, including on exceptions, and stops the test source before
restoration. Native playback is paused before installing the helper. This
keeps other asynchronous app callbacks outside the temporary context.

The pending-source cases explicitly advance five milliseconds within the
15-millisecond fade window. This matters: with a completely frozen clock, an
incorrect audible fade could stamp the same deadline as before and pass the old
assertion. With the controlled nonzero advance, that mutation extends the
deadline from 1.015 to 1.020 seconds and fails.

Two additional cases stop **at** and **after** the scheduled start. They cover
the complementary audible-fade behavior seen in the original failed run.
Offset compensation, leading timeline silence, rate changes and preservation
of pending anchors remain covered; several comparisons now use precise
controlled-time expectations instead of broad timing tolerances.

The leading-silence rate-change case uses a paused, explicit video position.
Rescheduling depends on how far that video remains from its first audio
sample, not how much the audio clock advanced while the video was paused.

`playwright.webkit.config.ts` adds these eight cases to the existing focused
WebKit gate. The profile now contains 50 checks. The complete Chromium suite
contains 436 cases, including its existing timestamp-collision skip.

These are scheduling and graph-API checks, not rendered-audio, codec or
listening checks. Other existing browser and scrub-pitch tests retain those
responsibilities. No production timing policy or listening behavior changed.

## Verification record

| Check | Result |
|---|---|
| Initial controlled-clock prototype | 7 passed, no retries |
| First 25-repeat run with tighter assertions | 175 passed, 25 failed; all failures were the incorrect new leading-silence expectation described below |
| Corrected eight-case group, repeated 25 times | **200 passed**, zero failures or retries, 1.8 minutes |
| Regression probes | Baseline 8 passed; all four deliberate regressions failed their intended assertions |
| Ownership | 525 passed, zero failed |
| Complete Chromium suite | **435 passed**, one existing skip, zero failures or retries, 7.5 minutes |
| Focused WebKit profile | **50 passed**, zero failures or retries, 45.6 seconds |

The first repetition run consistently received a remaining delay of 0.083
seconds while my new assertion expected 0.078. That assertion subtracted the
10 ms controlled audio-clock advance even though the paused video's position
had not advanced. The assertion was corrected to use `(firstAudioTime -
video.currentTime) / newRate`, with an explicit video position of zero. The
failed run is retained; it was an error in the new test expectation, not a
production failure or a remaining intermittent timing failure.

### Regression probes

[mutation-check.mjs](mutation-check.mjs) copies the actual test file into local
output folders and supplies modified `js/opus-sync.js` responses only inside
isolated browser contexts. It never edits the app source on disk. Each probe
runs with one worker and zero retries, checks the structured Playwright report,
and requires an assertion failure rather than a launch or setup error.

| Deliberate regression | Detecting scenario |
|---|---|
| Remove the pending-cancel branch | Pending stop changes the old fade deadline |
| Change the future-start comparison from `>` to `>=` | Stop at the start boundary no longer follows the expected schedule/fade |
| Remove offset compensation | Deferred buffer offset no longer advances with the scheduled delay |
| Re-anchor during a pending rate change | Scheduled timeline anchors move backward |

The expected negative results are preserved as verification successes in the
probe summary, with each underlying test failure retained. The app source hash
remains unchanged before and after these probes.

## Reproduction and retained evidence

From the repository root, with the existing Node/Playwright dependencies and
fixture tools installed:

```sh
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test tests/warpdiff.spec.ts \
  --project=chromium --grep 'Opus deferred-start window' \
  --workers=1 --retries=0 --repeat-each=25
npm run test:ownership
WARPDIFF_BROWSER_CHANNEL=chrome npx playwright test \
  --project=chromium --workers=1 --retries=0
npm run test:webkit
```

Run `node docs/opus-timing-test-2026-10-14/mutation-check.mjs` with the existing
localhost:8080 test server available to repeat the four negative probes. They
need the installed Chrome channel and produce temporary copied specs, reports
and logs under `output/opus-timing-test-2026-10-14/mutations/`.

The committed [verification summary](verification.json) records the counts,
deliberate negative results, initial failed expectation, and matching app/source
hashes. Raw local logs are retained in `output/opus-timing-test-2026-10-14/`, including
`focused-first.txt`, `focused-stress.txt` (the failed expectation),
`focused-stress-final.txt`, `mutations.txt`, and `ownership.txt`. The durable
summary alongside this document records final counts and source hashes.
Large generated reports, copied specs and traces are kept out of the commit.

Hosted results are linked in the final completion record and feature-branch
check history. No merge,
release tag or Pages publication is authorized by this test-only work.
