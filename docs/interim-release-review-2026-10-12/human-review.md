# Small interim release: human workflow review

Candidate: **3.19.1**, `codex/interim-release-review`, local only.
The broader 3.19.5 prepared-media/channel-policy work is not in this candidate.

Use Chrome and the installed Safari app at `http://localhost:8080/` once the
automated gate finishes. A separately installed FFmpeg is required for the
external command. Test media is synthetic; use a known real soundtrack for the
listening judgment. Keep the original files.
Reload the page and check that the header shows **v3.19.1** before reviewing;
an already-open document can still contain code from the broader local branch.

1. Load an MP4/MOV with supported picture and unsupported audio. The neutral
   fixture `tests/fixtures/ac3_video.mp4` can exercise the mechanical workflow.
   **Prepare audio externally** should open. The source name/format should
   describe the original; conversion should require your external action.
2. Copy the command and run it in a macOS/Linux terminal from the source file's
   folder. Verify the `_aac` file is created. With a real input, listen for
   intelligible dialogue, expected stereo placement, obvious clipping/gaps,
   and retained picture length. This is a compatibility copy, not original
   multichannel analysis or a claim of lossless conversion.
3. Use **Load prepared files**, **L**, or drop to load the prepared output with
   the other comparison files. This starts a new comparison. The source label
   should now report AAC stereo at 48 kHz; stale preparation entries should
   disappear.
4. Play, pause, scrub forward/backward, hold still, release and start again.
   Check that ordinary volume/mute and source selection behave as expected.
5. Close/reopen the preparation panel, use Escape, and clear/reload. Check
   keyboard focus and that retired commands do not reappear.
6. If a managed host is available, load through it and confirm preparation
   guidance sends the prepared file back through the host's reload workflow.
   The panel should not offer a local picker for a managed review.

Record browser/version, representative input format, output/headphones,
observations and any failure with its approximate point in the workflow.
Human observations are **pending**. Passing headless checks is not a substitute
for this installed-Safari/listening review.

## Listening observation — October 13, 2026

Jay reports occasionally hearing a lower tone while scrubbing in Safari.
Jay also reports that Chrome seems to work correctly. This is the user's
workflow/listening assessment, not an independent certification of every
Chrome feature or confirmation of the Safari issue's cause.
Jay identifies the input as `ac3_video_aac.mp4` and
believes it happened in both scrub directions. Jay subsequently confirms it
did **not** happen at normal 1× speed. The exact other rate(s), output device
and active Continuous/fallback path are not yet established. The Chrome
comparison has not been confirmed at matching non-1× rates, so the report
does not yet establish a Safari-specific cause.
Safari listening acceptance remains open.

The [focused pitch investigation](../safari-scrub-pitch-2026-10-13/README.md)
measured a confirmed preview inconsistency with the exact prepared AAC file.
At 0.5×, the shipped snippet function produces approximately 220 Hz from the
440 Hz source; Continuous preview stays near 440 Hz in both directions. Normal
warmed-up gestures begin with one snippet before Continuous starts roughly
100 ms later. Chromium and WebKit both exhibit this mechanism; it is a strong
explanation for the reported occasional sound, not proof of the installed
Safari acoustic cause. At 1×, both paths retain the original pitch.

The recommendation is to keep brief previews at original pitch as well.
The passing release RMS/cadence checks do not rule out pitch or spectral
artifacts. No application or pinned audio-component changes were made in
response to this report during the initial investigation.

## Local pitch fix — October 13, 2026

Jay authorized the next local fix with “Keep going.” Brief previews now use
original pitch independent of selected normal playback speed. The [fix and
verification record](../safari-scrub-pitch-2026-10-13/fix.md) contains the passing
25-check Chromium, 31-check WebKit and 525-check ownership runs, the expected
pre-fix regression failure and resolved test-driver failure, and measurements
from the exact prepared AAC file. No push, merge or publication occurred.

Safari listening acceptance remains open. Refresh the local page, load the
prepared AAC file, press J twice for 0.5×, and scrub both directions with several
starts/stops. Check whether the intermittent lower starting tone is gone.
Press K twice to return to 1× and repeat. The unpublished candidate remains
v3.19.1; an older open page must reload to use the changed adapter.

## Safari result and hosted-check authorization — October 13, 2026

Jay reports: **“The lower tone is gone in Safari.”** This closes the reported
pitch concern based on the user's listening check after the local fix. It is
not an independent acoustic capture or certification of every Safari feature;
the browser build, output device and exact retest rates were not supplied.

Jay explicitly approved pushing the interim feature branch and running hosted
tests, while retaining the instruction **“don’t merge or publish yet.”**
The authorized branch is `codex/interim-release-review`; broader foundations
and the replacement FFmpeg-distribution experiment remain outside its ancestry.
See the [hosted-check record](../hosted-interim-checks-2026-10-13/README.md) for
the pushed revision, Actions results and remaining release decisions.
