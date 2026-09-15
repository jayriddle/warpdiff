# WarpDiff

Visual & audio comparison for creative review. Compare images, videos, or audio files. No setup, no install — runs in your browser.

## Load and compare instantly

Load 1–4 images, videos, or audio files of one media type by dragging and dropping, pressing `L`, or clicking Load. Files auto-sort by save time. One- to three-item comparisons use Ref/GT/A/B naming as appropriate; four-item comparisons use media-aware Image-1…Image-4, Video-1…Video-4, or Audio-1…Audio-4 labels. A landing drop zone with hints appears when no files are loaded.

While a comparison is preparing, the loading screen lists every assigned slot and filename with live milestones: **Opening**, **Reading metadata**, **Decoding first frame**, and **Ready**. Completed files are checked off while slower files retain an animated status. If one video is ready first, WarpDiff identifies the remaining video and explains that it is waiting so the complete comparison appears together. Longer waits add a large-file reminder, and manual loads can be canceled.

## View modes

- **Stack** — flip between assets with arrow keys, same position and zoom
- **Grid** — two files auto-arrange side-by-side or vertically; three use Inline or Offset; four use a 2×2 Inline grid
- Press either `S` or `G` repeatedly to toggle back and forth between Stack and Grid.
- Mixed orientations use an equal-area layout so each asset has the same visual weight.
- Responsive grid layout auto-picks horizontal or vertical based on viewport dimensions and asset aspect ratios, re-evaluated on resize.

## Stack zoom modes

Press `\` (backslash) to toggle between **Fit** and **Balance** zoom in Stack mode. The active option is shown in the header.

- **Fit** (default) — each asset independently fills the viewport. Best for inspecting each file at the largest size available, especially when formats, crops, or aspect ratios differ.
- **Balance** — all assets are scaled to the same rendered screen area. This gives portrait, square, and landscape assets equal visual weight without forcing them to share a pixel scale or overflow the viewport.

Balance is especially useful when aspect ratios differ and Fit makes one asset occupy much more screen area than another. Use Fit when maximum per-asset size matters more than equal visual weight.

## Zoom loupe

Press `Z` for a circular zoom loupe that follows your cursor, showing magnified native pixels without changing the overall zoom level.

- `+`/`-` adjust magnification (2×–32×)
- `[`/`]` resize the loupe (100–400px)
- `Shift+Z` enables linked zoom — hover one asset, see the same spot magnified on all others (Grid modes)

## Review controls and metadata

- Hide or restore Grid slots by clicking their label pills, or use `Shift+1` through `Shift+4`; remaining assets expand into the appropriate one-, two-, or three-item layout, and restoring all four returns to 2×2.
- Rotate the active image or video 90° with `Alt+←` / `Alt+→`. Rotation persists across sessions and is respected by layouts, loupe, and wipe.
- Press `B` for black-and-white review, or `N` to hide video and focus on decoded audio views.
- Press `T` to cycle the displayed timecode, `C` to copy the current time or marked range, and `Shift+C` to choose the copy format and separator.
- Grid info bars and the Stack header strip keep the active comparison identifiable with contextual Ref/GT/A/B or media-aware numbered labels plus FPS, duration, resolution, aspect ratio, zoom, and available LUFS/LRA/true-peak metrics.
- Videos also show source audio format, verified layout or channel count, and sample rate from MP4/WebM metadata, for example **FLAC · 7.1 · 48 kHz**. Hover for full details if space is limited. Multiple audio tracks are counted and listed without claiming which one the browser plays. Unknown metadata and containers with no audio are identified explicitly. These fields describe the loaded file, independently of stereo listening output or dialogue presets.

## Frame gallery

Press `Shift+G` to grab the current frame from the active slot and pin it to a gallery strip above the transport controls. Use `{` / `}` (Shift+[ / Shift+]) to step through captured frames — all videos seek to that timecode. Click any thumbnail to seek, × to remove it. Gallery clears when new media is loaded.

## Sync and Solo video playback

Playback controls wrap when a desktop window or embedded pane has limited width, keeping seeking, volume and audio-source selection reachable.

Videos default to **Sync**, where every clip shares the transport controls. Press `Shift+S` or click **Playback: Sync** to enter **Solo** and run only the selected video. The adjacent **Playback: Sync/Solo** and **Range: Sync/Full** selectors are grouped before the timecode. Space, restart, frame stepping, speed changes, scrubbing, custom loop points, progress, and audio all follow that one slot. Selecting another video hands playback off at the same absolute time and preserves whether it was playing when that time exists. If a shorter target has already ended, it holds paused on its final frame instead of wrapping; the longer absolute time is retained for switching back or rejoining Full Sync. Returning to a range-limited Sync position outside its shared range restarts at the shared in-point. Custom loop markers remain shared, but their effective out-point is clamped to the Solo target; if the in-point starts after that target ends, playback holds at the final frame and explains why. The multi-clip Range control is hidden in Solo because it does not apply to a single participant.

With one visible video, scrub audio follows the frame actually presented; multi-video Grid follows the shared scrub target. Preview preserves stereo channels and phase, uses the normal playback volume, and smooths grain transitions. Slow pointer motion keeps preview active within the same video frame; holding still or dragging beyond a timeline edge fades it out. During single-video and synced playback, timeline and audio cursors advance evenly at the screen's refresh rate, stop with playback, and jump directly on seeks. Loop and sync timing remain unchanged. Switching active videos preserves forward playhead motion across small sync offsets and stale frames from hidden videos; deliberate seeks, paused inspection, and loop wraps still move directly to their target. Repeated `,`/`.` presses frame-step reliably, and restart acts on every participating clip, snapping the playheads immediately to the loop in-point or beginning. Per-source audio switching lets you listen to any asset's audio track independently; in Solo it also selects the solo video. During playback, native and Opus replacement audio use a 15 ms gain fade when switching sources, including rapid changes. Inactive native soundtracks keep running silently so source switches do not reset their decoder or playback clock. Automatic loops snap the playheads directly to the start without a backward animation.

With two or more videos loaded, playback is **sync-locked**: a continuous drift lock holds every video on the active one's clock—within half a frame—in both Stack and Grid. **Sync** range wraps at the shortest clip for frame-for-frame comparison; **Full** range wraps after the longest clip and holds shorter clips on their last frame. Clips come up a frame or two apart when playback starts (a decoder start race); on Chrome the lock closes that within about a third of a second, so pausing shortly after pressing play still lands both clips on the same frame. On Safari the clips are instead left to run free during playback (rate corrections make WebKit present video unevenly) and are aligned exactly when you pause, which is when frame accuracy matters.

- `J`/`K` cycle playback speed slower/faster (0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×)
- `Shift+S` toggles Playback: Sync / Solo for video comparisons
- `I`/`O` set loop in/out points; Shift+drag on the progress bar to select a loop region. Loop points are **shared across all clips** (one region applies to every clip and stays put when you switch the active clip)
- Loop markers shown as orange triangles on the progress bar
- **Persistent mute** (`M` or the speaker icon): the master mute is sticky — if you review with audio muted, it stays muted when you load a new comparison and the next time you open WarpDiff. The muted button shows an amber **Muted** label, and the first time you press play while muted a brief reminder offers a one-click **Enable**. (Per-source mutes still reset per comparison.)
- **Playback range for different-length clips** (`Shift+L`, or the `Range:` button grouped beside Playback on the transport bar): **Full** plays each clip to its full length — shorter clips hold on their last frame during the tail, and all restart together; **Sync** wraps at the shortest clip so every frame has a counterpart to compare frame-for-frame. Clips of **different lengths default to Full** (so nothing is hidden); equal-length clips use Sync. When they differ, WarpDiff flags it and highlights the Range control

## Seamless Tile Check

Press `Y` with images loaded to open Tile Check. Choose any of the 1–4 images, then review it as a repeated **3×3** surface or use **Offset** to move all four source edges into a cross at the center. Arrow keys step between image sources while the mode is open.

WarpDiff reports **Left ↔ Right**, **Top ↔ Bottom**, **Corners**, and an overall result as Seamless, Review, or Visible seam. The analysis compares color/alpha jumps and texture-direction changes at the wrap boundary against ordinary transitions inside the image, so naturally noisy textures are not penalized merely for having high contrast. **Heatmap** marks the most suspicious portions of each join.

Tile Check measures technical edge continuity, not whether a recognizable object, shadow, or lighting pattern repeats too obviously. The repeated preview remains the final visual check. Analysis uses a bounded working copy for responsiveness while the preview uses the original image; nothing is uploaded. Preview and Heatmap choices persist across sessions.

## Difference mode

Press `D` in Stack mode to overlay a pixel-difference composite of two assets. Identical pixels appear black; differences glow in proportion to the delta. Arrow keys or `Shift+D` cycle through every available pair—three pairs with three inputs or six media-numbered pairs with four. Works with images and video — updates live during playback and on frame step. Press `D` again to turn it off.

## Image wipe

Press `Q` in Stack mode to compare two images through a draggable hard cutoff. The pair follows Grid order: its first asset is left of the cutoff and its second asset is right. Click anywhere inside the comparison plate to snap the cutoff there; pointer movement beyond the click threshold remains a normal pan gesture, and clicks outside the plate are ignored. A subtle guide line marks the idle boundary, then disappears while the pointer is held down for an unobstructed comparison. The centered header control directly selects `Ref–A`, `Ref–B`, or `A–B`; `Shift+Q` and the left/right arrows cycle those pairs in the same order.

The wipe header stays dedicated to the comparison pair. The scopes panel provides its own source selector and labels the asset being analyzed. The zoom loupe and `Alt+←` / `Alt+→` rotation are spatial: they follow whichever side is under the cursor, and rotation names the affected asset in its confirmation toast. Each side is rendered as a complete presentation plate, including a neutral matte around mismatched aspect ratios, so one asset cannot bleed through the other asset's letterboxed region. The reveal image is clipped as a real DOM layer, so zoom, pan, rotation, and resize stay aligned without rasterizing the source. Wipe and Difference modes are mutually exclusive. Video wipe remains disabled while its hardware-compositor behavior is validated.

## Video scopes

Press `V` to toggle the video scopes panel. Its source is always identified above the scopes; during a wipe, choose either complete asset with the source buttons in the panel. Three scopes are displayed side by side — click the histogram or waveform to cycle through modes:

- **Histogram** — RGB → RGB + luma → CDF (cumulative distribution)
- **Waveform** — luma → RGB parade → RGB overlay
- **Vectorscope** — plots color information (Cb vs Cr) with skin tone line and color target markers

Scopes update in real time during playback and on frame step. Works on both video frames and still images.

## Scrub audio

Continuous is standard for video and audio-only timelines. It preserves pitch while following drag speed and direction, including backward audio on backward drags. Clicks audition short previews; holding still fades audio out. The separate mode button is gone, and old mode preferences no longer affect scrubbing.

Video listening copies use the audio device’s sample rate directly from the original decode. Mono/stereo placement and phase are preserved; surround dialogue is folded into a separate stereo listening mix. Original waveform, spectrogram, and loudness inputs remain intact in both visualization views. A single video follows its displayed picture; multi-video Grid retains the shared pointer clock. Volume, mute, and actual audio-start offsets still apply.

Each video preview and the selected Continuous stream have a 64 MiB PCM limit. Oversized video previews use a filtered lower-rate copy for short audition, with a notice; if no useful preview fits, playback and analysis remain available with an explanation. Unavailable worklets also fall back to short previews. Continuous can soften sharp sounds; use normal playback for final defect inspection.

## Audio visualization

Press `W` to toggle waveform and spectrogram views. The shared **Fit / Ref** control applies to both displays and persists across sessions. **Fit** normalizes each asset's waveform to its own peak and scales its spectrogram to its strongest energy, making quiet detail easy to inspect. **Ref** shows true waveform amplitude against 0 dBFS and maps every spectrogram to the same fixed −70 to 0 dBFS range for direct level comparison. Encoded leading and trailing audio gaps stay blank on the video timeline; decoded audio is never stretched to fill them. Waveform uses dB color coding in Ref — green for normal levels, yellow for caution (>-6dB), red for hot/clipping (>-1dB). Spectrogram supports linear/log frequency scale (`Shift+W`) and multiple color palettes (`P`).

Waveform, spectrogram, and loudness calculations run in a background worker for video and audio-only review, preserving the existing original-channel analysis while playback and controls continue. Preparation is serialized; clearing or replacing media discards obsolete results. Browsers that block workers retain the foreground compatibility path.

Scrub previews retain the soundtrack's placement on the video timeline, including intentional leading silence. Native playback remains browser-managed; Chromium's Web Audio replacement for affected Opus files uses the same offset-aware mapping.

If a video container does not expose an audio start timestamp, WarpDiff shows a persistent warning naming the affected slot. Decoded-audio views and tools keep their fallback timeline, native playback is not shifted, and the warning asks you to verify A/V sync. A confirmed start at 0 does not warn.

5.1 and 7.1 playback and scrub preview use a stereo listening mix. Center dialogue reaches both ears, surrounds retain left/right placement, and LFE is omitted from the mix. This includes eight-channel FLAC video; analysis keeps the original decoded channels and audio start timing.

**Dialogue listening:** the **Listen: Full Mix** control beside volume offers **Full Mix**, **Dialogue Focus** and **Center Only** when a discrete center is verified from codec/container metadata. Dialogue Focus starts with center unchanged and other channels reduced by 9 dB. Center level is adjustable from 0 to +12 dB; other channels range from unchanged to muted. Changes apply to native playback, replacement audio, Continuous, and short previews. Original analysis and source timing remain unchanged. Source peak bounds reserve headroom for boosted mixes; this is not automatic loudness normalization. Full Mix restores the standard mix and new comparisons reset to it. Stereo/custom or unknown layouts keep Full Mix available with an explanation. MP4 Opus decoder headers are converted to OpusHead so multistream 5.1/7.1 retains every decoded channel. Center Only can omit voices placed elsewhere.

Verified surround video previews retain full stereo plus a separate mono center within the existing 64 MiB preview budget; the selected Continuous stream accounts for all three PCM channels within its own 64 MiB budget. This costs 50% more preview PCM than stereo and can trigger the filtered short-preview fallback sooner on long surround clips. It does not reduce original analysis quality.

## Audio file comparison

Load 1–4 audio files (MP3, WAV, FLAC, AAC, OGG, etc.) to compare them as aligned vertical slots in Grid mode. Four-input labels are Audio-1 through Audio-4. Each slot shows a waveform (top) and spectrogram (bottom) with frequency labels. Info bars display sample rate, channels, bit depth (or codec name for lossy formats), file size, and EBU R128 metrics (integrated LUFS, LRA, true peak). Press `E` to cycle between waveform, waveform + LUFS envelope, and LUFS envelope only.

Spectrogram scale and palette controls (`Shift+W`, `P`) apply to all audio slots.

## Keyboard-driven workflow

Every action has a hotkey. Press `?` for help, `H` for the full hotkey list, `Esc` to dismiss. Hotkeys are fully customizable — click any key in the hotkeys panel to rebind it. Custom bindings persist across sessions.

## Installable

WarpDiff is a Progressive Web App. Install it from Chrome, Edge, or Safari for a standalone window experience. Offline-capable via service worker with network-first caching — works without an internet connection after first load.

## Works instantly

No install required, no account, no upload. Open in any browser, load your files. Everything stays local on your machine.


### Managed review hosts

Hosts may request `capabilities.managedReview` for assigned comparisons. This hides standalone branding, file management and native help, retains the original Grid/Stack icons with explanatory tooltips and accessible labels, and keeps view controls, inspection icons and media details in their native toolbar positions. WarpDiff retains playback and inspection ownership; the host owns tasks and supplies display labels through `slotLabels`, including audio-source selectors. Without that capability, standalone behavior remains available.
