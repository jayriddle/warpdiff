# Archived in-app release notes

Preserved on 2026-09-30 when the What’s New popup was condensed. These historical development notes include unpublished intermediate revisions and superseded behavior; they are not a description of the current release. Current behavior is documented in README, FEATURES and MANUAL.

## v3.18.12 (release candidate)

- Adds opt-in coarse window-size groups once per ready comparison, with consent scope 4 and matching disclosure/integrity updates. Exact dimensions and resize history remain excluded.
- Finalizes the verified provider settings, Jay Riddle’s privacy contact and configured 365-day retention.
- Consolidated public What’s New: scrubbing consistency, four appearances and optional usage sharing.
- Final adversarial follow-up: confirmed Reset now cancels the comparison's pending usage requests; the planning catalog correctly includes single-item reviews. Collection categories and consent scope are unchanged.
- Safari follow-ups serialize native scrub seeks, refresh video surfaces without removing rotation, retain ordinary mono/stereo native playback, and resume the separate scrub-audio engine after suspension or interruption. Detailed measurements and remaining native limitations are recorded under `docs/appearance-usage-2026-09-29/`.
- Further Safari output investigation distinguished rendered preview PCM from audible output: a fresh direct Web Audio context stayed silent, while a native media stream output was audible. Safari Continuous and snippet preview now share that comparison-scoped output with bounded idle/release/clear cleanup. See `safari-output-investigation-2026-10-01.md` for listening confirmation and verification limits.

## v3.18.11

- **Grid keeps videos in order.** Hiding #1 from a four-item comparison now leaves #2, #3, #4 in order. Inline and Offset both preserve the remaining assets' order and labels.

## v3.18.10

- Usage sharing now handles failed saves and rapid changes between tabs more carefully, with a clear warning if a choice cannot be remembered.

- Saved consent starts reporting only after you load files here. Host-loaded viewers stay excluded, and incomplete analytics updates keep reporting off.

- Restoring the audio panel after hiding video no longer counts as a new tool choice.

- Hosted reporting is held off while account collection, retention and privacy details are verified. Local testing remains available.

## v3.18.9

- Usage sharing appears before appearances, with a shorter invitation and expandable provider details.

- Loading files without answering keeps sharing off and quietly retires the invitation. You can change sharing anytime in Appearance and privacy.

## v3.18.8

- Optional usage sharing now covers single-item reviews, comparison tools and scrub frequency, plus basic failure and compatibility-fallback counts. No media, filenames or raw errors are sent.

- Expanded sharing details use consent scope 2. Previous Yes requires review; a remembered No stays off.

## v3.18.7

- **Optional usage sharing is configured.** On the official WarpDiff site, a current opt-in sends visit and comparison counts to WarpDiff’s GoatCounter account. No stays off; local test counts stay on this computer.

## v3.18.6

- **Consent stays tied to what you accepted.** Routine updates keep your choice. Changed sharing scopes require a new Yes before reporting, while No stays off.

## v3.18.5

- **A living Nebula.** Faint spiral arms and slowly orbiting stars surround a soft galaxy hub, with subtle twinkling. Reduced motion keeps the galaxy still.

## v3.18.4

- **A calmer, wider Starfield.** Stars travel more slowly across a wider landing background.

## v3.18.3

- **Consistent Solar motion.** All orbital bodies now travel in the same direction, with different speeds between the two planes.

## v3.18.2

- **A wider Starfield.** The Ad Astra animation now fills the broad landing atmosphere, with softly faded edges and controls kept in front.

## v3.18.1

- **Fixed Solar orbits.** The orbital planes stay still while the bodies move along them.

- **Starfield is an appearance.** Choose Starfield in Appearance and privacy for the original Ad Astra animation. The hidden X toggle is removed, and a previously enabled starfield is migrated into the appearance selection.

## v3.18.0

- **Choose your atmosphere.** Open Appearance and privacy in the header for Original, Starfield, Solar, Nebula or Glacier. Your choice stays in this browser; media and scope colors stay unchanged.

- **Usage sharing is optional.** The opt-in GoatCounter integration is available for local testing; production reporting is not connected. All appearances are available either way.

## v3.17.8

- **More consistent backward scrub volume.** Recovers larger drops in dialogue level while retaining stereo balance and peak protection.

## v3.17.7

- **More consistent scrub volume.** Speech stays closer to its playback level as you drag, with bounded compensation that preserves stereo balance and backs off around strong peaks. Original audio analysis remains intact.

## v3.17.6

- **Resume playback easily after changing the listening mix.** Choosing a Listen preset or adjusting a level with the mouse returns focus to Play/Pause, so Space works immediately. Escape closes the panel and returns to playback; keyboard slider arrows still adjust levels.

## v3.17.5

- **Fresh audio graphs when loading videos.** The previous waveform and spectrogram clear immediately while the new video's analysis prepares, including when the panel was closed.

## v3.17.4

- **Reliable restart after scrubbing.** Pressing `R` now keeps videos looping with your selected playback scope and loop range.

## v3.17.3

- **Release memory between comparisons.** Clearing or replacing videos now fully releases old scrub-audio resources and the previous video, preventing memory from accumulating across loads.

## v3.17.2

- **Smoother playback while files prepare.** Audio analysis now runs in the background, keeping the picture and controls responsive while preserving waveform, spectrogram, and loudness detail.

## v3.17.1

- **See a video's audio format.** Info bars now identify the source codec, channel layout/count, and sample rate when available. Hover for full details, including files with multiple audio tracks.

## v3.17.0

- **Focus on dialogue.** The Listen control offers Dialogue Focus and Center Only for verified surround soundtracks, with center boost and background reduction during playback and scrubbing. Original audio analysis stays intact; Full Mix is always available.

- **Multichannel Opus.** Surround Opus files now retain all decoded channels, including the center.

## v3.16.1

- **Smoother scrubbing.** Drag forward or backward with continuous, pitch-preserving audio. Click for a short preview; holding still fades the sound out. Short previews are used automatically when Continuous is unavailable.

- **Clearer audio previews.** Full-rate audio preserves stereo detail and keeps surround dialogue audible. Original waveform, spectrogram and loudness analysis retain their quality.

- **Smoother playback and switching.** Timeline and waveform playheads move evenly with one video or a synced comparison. Short audio fades reduce clicks when you change active videos.

- **Instant restarts and loops.** Press `R` or reach the loop end to jump directly to the beginning or your loop in-point. Timeline and waveform playheads snap to the new position.

## v3.14.5

- Managed reviews use the original view controls and inspection icons directly in the toolbar.

## v3.14.4

- Managed comparisons retain the original Grid and Stack icons, with explanations in tooltips and accessible labels.

## v3.14.3

- Managed review hosts can request focused inspection controls and supply authoritative media labels.

## v3.14.2

- **Playback controls stay reachable in smaller desktop panes.** The transport wraps when space is limited, keeping seeking, volume and audio-source controls visible.

## v3.14.1

- **Timeline and waveform playheads now move smoothly during synced video playback.** The visual clock no longer pauses or nudges backward between presented frames; the progress fill uses a compositor transform, and a short linear bridge hides occasional busy main-thread frames without changing loop or sync timing.

- **Three-image Grid views no longer show an empty C info bar.** Both Inline and Offset layouts now keep the unused fourth slot hidden.

- **The Playback: Sync / Solo control is visible again.** Sync has a clear neutral treatment in the transport bar, while Solo uses a blue active state.

- **Playback behavior is grouped.** Playback: Sync/Solo now sits directly beside Range: Sync/Full, before the timecode, so the two related selectors read as one control group.

## v3.14.0

- **Tile Check finds image seams before they reach a surface.** Press `Y` to inspect any loaded image as a repeated 3×3 tile or move all four edges to the center with Offset. Separate Left↔Right, Top↔Bottom, corner, and overall ratings compare boundary color, alpha, and texture direction with the image's normal detail.

- **Heatmap shows where to look.** Toggle it to mark suspicious seam segments, then switch among as many as four loaded images from the source controls or arrow keys. The visual preview remains available because technical continuity cannot guarantee that a recognizable motif will not repeat.

## v3.13.0

- **Four-item comparison is here.** Load four files with type-aware labels: Image-1…Image-4, Video-1…Video-4, or Audio-1…Audio-4. Visual media opens in a balanced 2×2 Inline grid, while audio keeps four vertically aligned timelines.

- **Four-item layouts adapt as you review.** Hide slot 4 with `Shift+4` or any label pill to expand the remaining three assets; restoring all four returns to 2×2. Difference and image wipe offer all six pairs.

- **Any video can now run by itself.** Press `Shift+S` or use the playback-scope button to switch between Sync and Solo. Selecting another video hands off at the same absolute time; shorter clips hold at their final frame, custom loops clamp safely to the Solo target, and returning to Sync preserves Full-range time or restarts at the shared in-point.

## v3.12.41

- **Slow video preparation now stays visibly active and specific.** The loading screen lists each assigned slot and filename, checks off ready files, identifies which video is still decoding its first frame, explains why WarpDiff waits to reveal the comparison together, and offers Cancel.

## v3.12.40

- **A replaced comparison now fully cancels an in-progress scrub.** Releasing the old pointer after new media loads can no longer seek or start playback in the new comparison.

## v3.12.39

- **One-key Stack / Grid switching is restored.** Press either `S` or `G` repeatedly to move back and forth between the two views without changing keys.

## v3.12.38

- **The wipe header is focused on the comparison again.** Its centered control now shows only the active pair; scopes choose and clearly label their source inside the scopes panel.

- **Wipe tools now follow where you are working.** The zoom loupe and rotation act on the visible side under the cursor, and their labels or confirmation messages identify the affected asset.

## v3.12.37

- **Wipe analysis now follows an explicit Left/Right target.** Scopes identify and analyze that selected asset, rotation applies to it without leaving wipe, and the zoom loupe samples and labels whichever visible side is under the cursor—even with mismatched aspect ratios.

- **Wipe controls are more resilient and accessible.** The centered control moves below crowded narrow headers, pair selection preserves keyboard focus, clicking the divider focuses its slider, only left/right arrows cycle pairs, and small click jitter no longer pans the plate.

- **Stack and Grid shortcuts are now direct.** S always selects Stack and G always selects Grid instead of toggling when the requested mode is already active.

## v3.12.36

- **Image comparisons now support a live wipe in Stack.** Pair order matches Grid order (first asset left, second right), clicking the plate snaps the cutoff, and the centered header control directly selects Ref–A, Ref–B, or A–B. The idle guide disappears while dragging, neutral presentation mattes prevent aspect-ratio bleed-through, and zoom, pan, rotation, resize, and pair cycling remain aligned. Video wipe stays gated while compositor behavior is validated.

- **A/B assets now have a clear visual separation in Grid.** Side-by-side images and videos use a small horizontal gap, while stacked comparisons keep a matching vertical gap without disturbing fit or centering.

## v3.12.35

- **Multi-video scrubbing now sends one shared target per display frame.** High-rate pointer input no longer makes every visible decoder repeatedly chase intermediate positions that could never be displayed.

- **Selected scrub audio now follows a steady clock.** Only the chosen track is previewed, with overlapping grains of consistent audible length at every playback speed, so decoder and pointer-event bursts do not create avoidable gaps.

## v3.12.34

- **Scrubbing past the timeline end now stays stopped.** End detection follows the pointer target—even when corrected audio duration differs from the container—and stale scrub callbacks can no longer restart playback.

## v3.12.33

- **Pause now works throughout the full tail of unequal-length comparisons.** After a shorter video ends, Space correctly stops any longer video that is still playing.

## v3.12.32

- **Selected audio now stays smooth while scrubbing multiple videos in Grid.** The preview follows the steady shared scrub timeline instead of inheriting gaps from competing video decoders.

## v3.12.31

- **Reset now clears the Stack header completely.** After removing the last asset, its filename, resolution, timing, metrics, and zoom no longer remain in the header.

## v3.12.30

- **Leaving a stacked difference comparison now restores every Grid label.** Switching to Grid no longer leaves the active asset labeled “Diff: A–B” after the difference overlay closes.

## v3.12.29

- **Videos now flag unknown audio timing metadata.** If a container does not expose where its audio starts, a persistent warning identifies the affected slot and asks you to verify A/V sync. A confirmed start at 0 remains silent.

## v3.12.28

- **Audio visualizations now preserve the source timeline.** Waveforms, spectrograms, and LUFS envelopes leave real leading and trailing gaps blank instead of stretching decoded audio to fill the video.

## v3.12.27

- **Clearing or replacing media can no longer revive an older audio analysis.** Decode generations remain unique across reloads, so late async completions cannot overwrite the current comparison.

- **Hosts that omit FFmpeg now report unsupported audio honestly.** Embed owners declare the capability explicitly, so other iframe hosts retain transcoding while constrained hosts explain that external conversion and reload are required.

## v3.12.26

- **Embedded host loads are now correlated and cancelable.** Newer requests supersede stale fetches, readiness is acknowledged only after media activation, and exact-origin parents are supported without a vendor-only patch.

- **Embedding no longer installs WarpDiff's service worker.** Standalone caching is restricted to WarpDiff's own versioned runtime assets, and malformed preferences recover one key at a time.

## v3.12.25

- **Long spectrogram analysis is now genuinely bounded.** Hour-scale and high-sample-rate media adapt their timeline sampling to a fixed frame budget instead of growing into gigabyte-sized FFT buffers.

- **Ref spectrogram levels are calibrated to dBFS.** Hann-window gain is compensated, and audio-only video cursors now follow the same presented-frame clock as the progress bar and timecode.

## v3.12.24

- **Fit / Ref now lives with the audio visualization it changes.** Video places the Scale control beside the waveform; audio-only review uses one shared toolbar above the canvases. Higher-contrast buttons and clear pressed states remain legible in the dark theme.

## v3.12.23

- **Scrub sound now follows the frame actually shown and matches normal playback volume.** This tightens picture/sound correspondence without sacrificing stereo spatial cues.

- **Playback indicators move more evenly and remain truthful.** The progress bar, timecode, and audio cursor follow presented-frame timing, while canceled or rejected play requests can no longer restart unexpectedly or leave the control showing Pause.

## v3.12.22

- **Waveforms and spectrograms now share a persistent Fit / Ref level control.** Fit reveals the detail in each asset; Ref preserves true waveform amplitude and uses a common −70 to 0 dBFS spectrogram scale for honest level comparisons.

## v3.12.21

- **Long videos no longer freeze the interface while loading.** Clips of two minutes or more use a bounded full-timeline spectrogram analysis instead of generating hundreds of thousands of oversized FFT frames.

## v3.12.20

- **50 fps videos now report and step at their actual frame rate.** Detection also remains accurate when the browser combines multiple presented frames into one callback.

## v3.12.19

- **Removed pronounced clicks introduced by the previous scrub-smoothing change.** Grain transitions now derive their current envelope level directly instead of relying on browser gain-automation hold behaviour.

## v3.12.18

- **Scrub audio no longer pulses or drops in level on centered material.** Successive snippets are phase-aligned within a tightly bounded window before crossfading, and gain transitions now hold their true instantaneous level.

## v3.12.17

- **Scrubbing now preserves stereo phase and channel placement.** Side-only material such as `L = −R` no longer disappears from the scrub preview.

## v3.12.16

- **Repeated frame stepping no longer misses a tap.** While a previous seek is still settling, `,` and `.` now advance from the last requested frame instead of asking for the same settled frame again.

## v3.12.15

- **Scrub audio now respects a video's intentional audio start offset.** Files whose soundtrack begins after the first frame retain that leading silence instead of previewing the audio early; Chromium's Opus correction follows the same timeline mapping.

## v3.12.14

- **The waveform panel no longer overlaps the videos.** With two clips in Grid view, opening the panel or loading clips while it was already open could leave the bottom of the videos tucked under the waveform. The video area now resizes reliably whenever the panel does.

## v3.12.13

- **Firefox is no longer treated as Safari.** The Safari-specific playback and switching behaviour added in 3.12.12 was keyed off a browser feature Firefox also has, so Firefox was quietly getting workarounds that were never tested there. Firefox now uses the standard path again.

- **Zoom loupe fixed in Stack mode on Safari.** It could sample the hidden clip instead of the one you're looking at.

- **Frame stepping is safe before clips finish loading**, and stays correct on clips whose metadata overstates their length.

- **Pause alignment matches the sync tolerance on mixed-frame-rate pairs** — it was nudging clips that were already close enough.

- **Better scrubbing on clips with very few keyframes** (long recordings with no scene cuts), which were sized against the wrong frame budget.

## v3.12.12

- **Playback sync overhaul.** Two clips now lock into sync as soon as playback starts, pauses land cleanly on the same frame, and frame stepping (`,` / `.`) stays aligned even when clips have different frame rates.

- **Smoother backward scrubbing**, especially on clips with sparse keyframes.

- **Clicking a video always selects it** — fixed for mixed portrait/landscape layouts.

- **More reliable frame-rate detection**, including when reviewing in short bursts.

- **Safari fixes:** the unselected clip plays smoothly, and A/B switching in Stack mode is instant. (Brief hitches at play start and at unmuted loop restarts are Safari's own — muting avoids the loop ones.)

## v3.12.4

- **Grid pause no longer makes the other clip stutter.** Following up on v3.12.3: when you paused, the selected clip held still but the other one would visibly hop a frame or two to catch up (and the roles swapped if you selected the other clip). The pause-align step was seeking the non-selected clip onto the selected clip's exact frame. It now leaves a clip that's already within the normal sync tolerance right where it froze — both clips stop cleanly, no hop.

## v3.12.3

- **Fixed the frame jump when pausing two videos in Grid.** Tapping Space to pause could make one or both clips jump ahead and then hop back a frame or two. The pause-time frame-align step was re-seeking every clip on every pause — even when they were already on the same frame — and that needless seek is what flashed the picture. It now only nudges a clip that's genuinely on the wrong frame, so pausing lands cleanly.

## v3.12.2

- **Internal cleanup — scrubbing no longer juggles the mute state.** WarpDiff used to briefly unmute every clip while you scrubbed (an old workaround for a Chrome bug that skipped frame decoding on muted, paused video). That bug is long fixed, and the workaround was the source of the v3.12.1 mute glitch, so it's been removed entirely. No change you'll see or hear — scrubbing and audio behave exactly as before, with one less thing to go wrong.

## v3.12.1

- **Fixed a muted-audio glitch when scrubbing right after loading.** If you began dragging the scrubber the instant a new comparison finished loading, the non-active clips could briefly re-mute mid-scrub (a side effect of the new persistent-mute applying itself on load). Scrubbing now keeps full ownership of audio while you drag.

## v3.12.0

- **Mute now sticks.** If you review with audio muted, WarpDiff remembers it — the mute state now persists across new file loads and across sessions, so you no longer have to re-mute every time you drop in a new comparison. When you press the mute button it also shows an amber *Muted* label so the state is unmistakable at a glance, and the first time you hit play while muted a brief reminder offers a one-click *Enable* in case you didn't mean to.

## v3.11.9

- **Truly seamless clip switching.** Switching between clips mid-playback could still flash a moment of older video and hesitate — the just-revealed clip briefly showed the frame from when it was last on screen while its decoder caught up. The outgoing clip now keeps playing on screen until the incoming one has a current frame ready, then they swap — no backward flash, no hesitation, even on nearly identical clips. The hidden clip is also held more tightly to the clock (within ~8&thinsp;ms), so the swap lands sub-frame.

## v3.11.8

- **Switching clips during playback no longer jumps backward.** In Stack mode, the hidden clip was being constantly re-seeked to stay in sync — each seek stalled it briefly, leaving it always a frame or two behind, so switching to it dragged everything backward and stuttered. The hidden clip now stays locked via an imperceptible playback-rate trim instead (it's hidden and muted, so nothing is visible or audible), and switching mid-playback is seamless in both directions.

## v3.11.7

- **Fixed choppy playback and doubled audio after interrupted scrubs.** Releasing the mouse outside the window (or switching apps) mid-scrub could silently leave WarpDiff thinking a drag was still in progress — playback sync and decoder management shut off (progressively choppier video) and every clip could end up unmuted at once (two audio tracks playing together). Interrupted drags are now detected and cleaned up automatically.

## v3.11.6

- **Version now shows the deployed build hash.** The version in the top-left corner (e.g. <code>v3.11.6 · a2e5aa7</code>) now includes the short commit hash of the build being served, so you can tell at a glance whether you're on the latest deploy — handy when a stale PWA cache or a pending Pages deploy is serving an older build.

## v3.11.5

- **Smoother playback and faster reverse scrubbing in long sessions.** The smooth-scrub engine now goes dormant during playback instead of being torn down — no more re-reading the whole file on every scrub after play, which caused playback to get progressively choppier with continued use. Its frame cache also survives play/pause cycles and skips redundant work, so scrubbing backward is much lighter.

## v3.11.4

- **Pause always lands on the same frame.** Stopping synced playback (spacebar) now snaps every video to the exact same frame, closing a rare edge case where two clips could land a frame apart even though they were tightly synced during playback.

## v3.11.3

- **Cleaner clip switching and clicking.** Flipping between two clips (arrow keys) no longer flashes the frame backward at the switch — the newly-shown clip repaints its exact frame immediately. And clicking a spot on the timeline while paused now jumps straight to that frame instead of briefly fast-forwarding through the frames in between.

## v3.11.2

- **Fixed scrubbing with three videos.** When scrubbing three videos side-by-side, one slot could freeze while the other two moved. WarpDiff now detects when a slot's smooth-scrub preview isn't keeping up and falls back to seeking that video directly, so all three track together. Playback after scrubbing is smoother too — the scrub decoders are now released when you press play, freeing them up for the videos.

## v3.11.1

- **Different-length clips now default to Full.** Load clips of different lengths and WarpDiff plays each in full by default (instead of quietly looping only the shortest) — with a clearer heads-up and the highlighted **Loop** button pulsing so it's obvious how to switch. Press **Shift+L** for frame-locked comparison (Sync). In Sync mode, any part of a clip past the loop is now shown hatched on the progress bar.

## v3.11.0

- **Compare clips of different lengths.** New **Loop: Full** mode (Shift+L, or the Loop button on the transport bar) plays every clip to its full length — a shorter clip holds on its last frame while the longest plays out, then all restart together. The default **Loop: Sync** still frame-locks to the shortest clip for A/B comparison. And when you load clips of different lengths, WarpDiff now tells you.

- **Loop points are shared across clips.** Setting an in/out loop region now applies to every clip and stays put when you switch the active clip (previously each clip kept its own separate region).

## v3.10.33

- **Stability & robustness sweep.** A batch of smaller reliability fixes: additional bounds checks in the media parsers, tighter scrub-preview memory use, more resilient A/V sync during clip switches and loop wraps, and cleanup of leftover video resources. No changes to how you use the app.

## v3.10.32

- **Robustness & security hardening.** Malformed or malicious media files can no longer hang or crash the tab on load — the MP4/WebM parsers now clamp sample counts and element sizes to the actual file bytes instead of trusting declared values. Also fixed a scrubbing bug where loading new files mid-scrub could leak memory or briefly show the previous file's frames, and a rare case where switching the active clip mid-playback could leave everything running ~2% fast or slow.

## v3.10.31

- **Videos now loop and play in sync lock.** With two or more videos loaded, playback loops all of them together over the shortest clip's duration (previously each video restarted on its own clock and drifted apart every loop), and a continuous drift lock holds every video on the active one's clock — within half a frame — in both Stack and Grid mode. Frame-accurate loop enforcement now also runs in Grid mode.

- **Difference mode never blends mismatched frames.** While playing, the difference composite only updates when both videos are on the same frame — a transient one-frame offset now briefly holds the last matched diff instead of flashing false motion ghosting.

## v3.10.30

- **Bug fix: HDR videos (PQ/HLG) darkened dramatically while scrubbing on Chrome.** HDR content now falls back to native scrubbing — Chrome tone-maps HDR video for display in a way the smooth-scrub overlay can't reproduce.

## v3.10.29

- **Internal.** Code organization: the Opus audio-sync engine and timecode formatters moved into their own modules. No user-facing changes.

## v3.10.28

- **Smooth scrubbing, phase 2.** Revisited positions now paint instantly from a decoded-frame cache (back-and-forth A/B scrubbing, backward jumps), and the smooth-scrub overlay works in Grid mode (all slots paint during a drag) and on waveform/spectrogram panel drags. Scrub frames are also color-matched to Chrome's video rendering on macOS (previously the image dimmed slightly while scrubbing), and frame timing now honors MP4 edit lists so the scrubbed frame matches the player exactly.

## v3.10.27

- **Smooth timeline scrubbing on Chrome (experimental).** Stack-mode drags now decode frames directly via WebCodecs and paint them live, so videos with sparse keyframes (AI-generated clips, web downloads) scrub with Safari-like responsiveness. Falls back to the previous behavior in Grid mode and for non-MP4/unsupported codecs.

## v3.10.26

- **Bug fix: a transcode error message ("Source file unavailable") vanished after 1 ms instead of displaying for 4 seconds.**

## v3.10.25

- **Internal hardening.** Regression tests now lock in the recent Opus audio-sync timing fixes; no user-facing changes.

## v3.10.24

- **Tighter A/V sync at loop wraps (Opus videos).** Audio restarts now compensate for their brief anti-click gap instead of playing ~15 ms behind the video afterward, the gap only lasts as long as the previous fade actually needs, and quick pause→play no longer risks a momentary crossfade artifact.

## v3.10.23

- **Bug fixes: audio glitches when pausing, muting, or changing speed right at a loop wrap (Opus videos).** A restart's brief crossfade-avoidance gap could let a click through if playback was stopped in that instant, undo a mute, or skew A/V sync after a speed change.

## v3.10.22

- **Audio panel robustness.** Hardened the waveform/spectrogram panel layout so the two displays can't mis-size or overlap if a redraw races the panel layout on load, and sanitized saved panel dimensions against bad values.

## v3.10.21

- **Spectrogram coloring overhaul.** Now uses a true Inferno colormap and auto-scales contrast to each clip (a 70&nbsp;dB window below the loudest point) instead of a fixed scale — quiet clips are far more legible.

## v3.10.20

- **Spectrogram now defaults to the Inferno palette.** Cycle palettes from the W panel's palette toggle; your choice is remembered.

- **Refined the active-audio info-bar accent** — the colored top line is now thinner (1px) and sits inside the rounded corners.

## v3.10.19

- **Bug fix: Grid mode sizes stacked clips by equal area.** Two landscape clips with different aspect ratios stacked vertically now get the same on-screen area (the wider one rendered wider-and-shorter) instead of being forced to the same width. Also fixes an intermittent case where two landscapes didn't stack vertically.

## v3.10.18

- **Bug fix: eliminated duplicate playback handlers.** Loop enforcement now runs a single frame-callback chain per video instead of accumulating one per pause/play cycle, and transcoded files (Dolby/DTS) no longer attach a second set of play/pause/seek handlers — removing loop-wrap stutter and double audio triggers.

- **Bug fix: audio reliability when switching clips quickly.** A slow audio decode from a previous clip can no longer overwrite the newly loaded one, and the Restart (R) key now keeps Opus audio in sync instead of dropping or desyncing it.

## v3.10.17

- **Bug fix: loop playback no longer audibly overshoots the out-point.** The wrap is now scheduled for the exact out-point time when the last in-region frame presents, instead of waiting for a frame past the boundary (up to a full frame of audio late).

## v3.10.16

- **Bug fix: residual audio crackling at loop wrap points (Chrome and Safari).**

## v3.10.15

- **Bug fix: audio crackling at loop wrap points (Opus videos).**

## v3.10.14

- **Bug fixes related to looping and audio decoding (Dolby/DTS-HD MA).**

## v3.10.13

- **Bug fixes related to looping.**

## v3.10.12

- **Frame gallery (`Shift+G`)** — grab the current frame from the active slot and pin it to a gallery strip above the transport controls. Use `{` / `}` (Shift+[ / Shift+]) to step through captured frames — all videos seek to that timecode. Click a thumbnail to seek; × to remove it. Gallery clears automatically when new media is loaded.

## v3.10.11

- **EBU R128 audio metrics** — Integrated LUFS, LRA, and True Peak are now displayed in the info bar for every asset that carries audio — video and audio-only alike.

- **LUFS envelope (`E`)** — press E while the waveform panel is open to cycle through Waveform only / Waveform + LUFS / LUFS only. Short-term loudness is drawn as a stepped chart on a fixed −36 to 0 LUFS scale, with reference lines at −14 (streaming), −16 (podcast), and −23 (broadcast).

- **Info bar redesign** — fields reordered for clarity (Label · Resolution · AR · FPS · Duration · LUFS · LRA · TP · Zoom), Zoom right-aligned, stopwatch icon on duration, and a *--fps* placeholder while frame rate is being detected.

## v3.10.6

- **Image rotation (⌥← / ⌥→ on Mac, Alt+← / Alt+→ on Windows)** — rotate any asset 90° CW or CCW. Works in both Stack and Grid; the zoom loupe follows the rotation.

- **Resizable audio panel** — drag the top edge of the waveform / spectrogram panel to make it taller or shorter.

- **Frame step wraps** — stepping past the last frame with `,` / `.` now wraps around to the beginning.

- **Bug fixes and visual polish**

## v3.10.2

- **Hidden slot restore in Grid mode** — ghost pills now appear in the header when a slot is hidden, so you can click to bring it back. Previously the pill was missing and there was no way to restore without reloading.

## v3.10

- **Hide slots in Grid mode** — click any slot label to hide that slot and give more space to the others. A ghost pill appears in the header to restore it. `⇧1` / `⇧2` / `⇧3` toggles slots from the keyboard.

- **Info bar redesign** — slot colors dim when inactive and light up for the active asset, making it immediately clear which slot has focus.

- **Darker UI** — reduced background brightness throughout for better contrast against media content.

## v3.9.1

- **Timecode** — click the timecode display or press `⇧C` to choose a format (SMPTE, frames, seconds, F+N), `C` to copy.

- **Asset metadata redesign** — Simplified naming. Ref/A/B slots now feature colored badges (green / amber / magenta) for faster recognition.

- **Bug fixes** — layout, magnifier, and transcoding audio.

## v3.8.6

- **Automatic audio transcoding** — files with unsupported audio codecs (EAC-3, AC-3, etc.) are automatically transcoded to AAC in-browser using ffmpeg.wasm.

## v3.8.2

- **Video duration & frame rate in Stack header** — the center info strip now shows duration and fps for video assets, alongside zoom, resolution, and aspect ratio

- **Equal visual weight in Grid view** — both assets now render at equal screen area regardless of resolution, so a higher-resolution image no longer appears larger than a lower-resolution one at the same effective scale

## v3.8

- **Fit / Balance zoom (\)** — new Stack mode toggle in the header. *Fit* scales each asset to fill the viewport independently. *Balance* scales all assets to the same rendered screen area — consistent visual weight regardless of resolution or orientation, without overflow.

- **Stack mode header info strip** — slot name, zoom %, resolution, aspect ratio, and filename are now displayed in the center of the header while in Stack mode, replacing the traveling info bar that moved with the image.

- **Mini-map navigator** — a floating thumbnail in the lower-right corner appears when an asset overflows the viewport in Stack mode. Shows asset outlines and a white viewport indicator; click or drag to pan.

## v3.7.7

- **No-video mode (N)** — hides video picture and shows per-slot waveform + spectrogram for audio-focused review; supports scrub, time cursor, and loop regions

- **Black & white toggle (B)** — desaturates all video and image assets for luminance-focused review

## v3.7.6

- Improved scrubbing — smoother frame updates and audio preview while dragging
