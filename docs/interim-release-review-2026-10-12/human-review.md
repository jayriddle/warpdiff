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
