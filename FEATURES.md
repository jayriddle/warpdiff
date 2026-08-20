# WarpDiff

Visual & audio comparison for creative review. Compare images, videos, or audio files. No setup, no install — runs in your browser.

## Load and compare instantly

Load 1–3 images, videos, or audio files of one media type by dragging and dropping, pressing `L`, or clicking Load. Files auto-sort by save time into Ref, A, and B (the reference is labeled GT for audio). A landing drop zone with hints appears when no files are loaded.

## View modes

- **Stack** — flip between assets with arrow keys, same position and zoom
- **Grid** — side-by-side (2 files) or all three in a row/column (3 files), auto-picks the best layout; `3` toggles inline / offset
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

- Hide or restore Grid slots by clicking their Ref/A/B pills, or use `Shift+1`, `Shift+2`, and `Shift+3`; remaining assets expand into the available space.
- Rotate the active image or video 90° with `Alt+←` / `Alt+→`. Rotation persists across sessions and is respected by layouts, loupe, and wipe.
- Press `B` for black-and-white review, or `N` to hide video and focus on decoded audio views.
- Press `T` to cycle the displayed timecode, `C` to copy the current time or marked range, and `Shift+C` to choose the copy format and separator.
- Grid info bars and the Stack header strip keep the active comparison identifiable with contextual Ref/GT/A/B labels plus FPS, duration, resolution, aspect ratio, zoom, and available LUFS/LRA/true-peak metrics.

## Frame gallery

Press `Shift+G` to grab the current frame from the active slot and pin it to a gallery strip above the transport controls. Use `{` / `}` (Shift+[ / Shift+]) to step through captured frames — all videos seek to that timecode. Click any thumbnail to seek, × to remove it. Gallery clears when new media is loaded.

## Synchronized video playback

All videos play in sync with shared transport controls. Scrub audio follows the frame actually presented, preserves stereo channels and phase, uses the normal playback volume, and smooths grain transitions to avoid level dropouts. Playback timecode and audio cursors glide from presented-frame timing without changing the raw clock used for loops and sync. Repeated `,`/`.` presses frame-step reliably, and restart acts on every clip. Per-source audio switching lets you listen to any asset's audio track independently.

With two or more videos loaded, playback is **sync-locked**: a continuous drift lock holds every video on the active one's clock—within half a frame—in both Stack and Grid. **Sync** range wraps at the shortest clip for frame-for-frame comparison; **Full** range wraps after the longest clip and holds shorter clips on their last frame. Clips come up a frame or two apart when playback starts (a decoder start race); on Chrome the lock closes that within about a third of a second, so pausing shortly after pressing play still lands both clips on the same frame. On Safari the clips are instead left to run free during playback (rate corrections make WebKit present video unevenly) and are aligned exactly when you pause, which is when frame accuracy matters.

- `J`/`K` cycle playback speed slower/faster (0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×)
- `I`/`O` set loop in/out points; Shift+drag on the progress bar to select a loop region. Loop points are **shared across all clips** (one region applies to every clip and stays put when you switch the active clip)
- Loop markers shown as orange triangles on the progress bar
- **Persistent mute** (`M` or the speaker icon): the master mute is sticky — if you review with audio muted, it stays muted when you load a new comparison and the next time you open WarpDiff. The muted button shows an amber **Muted** label, and the first time you press play while muted a brief reminder offers a one-click **Enable**. (Per-source GT/A/B mutes still reset per comparison.)
- **Loop range for different-length clips** (`Shift+L`, or the `Loop:` button on the transport bar): **Full** plays each clip to its full length — shorter clips hold on their last frame during the tail, and all restart together; **Sync** wraps at the shortest clip so every frame has a counterpart to compare frame-for-frame. Clips of **different lengths default to Full** (so nothing is hidden); equal-length clips use Sync. When they differ, WarpDiff flags it and highlights the Loop control

## Difference mode

Press `D` in Stack mode to overlay a pixel-difference composite of two assets. Identical pixels appear black; differences glow in proportion to the delta. Arrow keys or `Shift+D` cycle through available pairs (Ref–A, Ref–B, A–B with 3 files). Works with images and video — updates live during playback and on frame step. Press `D` again to turn it off.

## Image wipe

Press `Q` in Stack mode to compare two images through a draggable hard cutoff. The pair follows Grid order: its first asset is left of the cutoff and its second asset is right. Click anywhere inside the comparison plate to snap the cutoff there; pointer movement beyond the click threshold remains a normal pan gesture, and clicks outside the plate are ignored. A subtle guide line marks the idle boundary, then disappears while the pointer is held down for an unobstructed comparison. The centered header control directly selects `Ref–A`, `Ref–B`, or `A–B`; `Shift+Q` and the left/right arrows cycle those pairs in the same order.

The wipe header stays dedicated to the comparison pair. The scopes panel provides its own source selector and labels the asset being analyzed. The zoom loupe and `Alt+←` / `Alt+→` rotation are spatial: they follow whichever side is under the cursor, and rotation names the affected asset in its confirmation toast. Each side is rendered as a complete presentation plate, including a neutral matte around mismatched aspect ratios, so one asset cannot bleed through the other asset's letterboxed region. The reveal image is clipped as a real DOM layer, so zoom, pan, rotation, and resize stay aligned without rasterizing the source. Wipe and Difference modes are mutually exclusive. Video wipe remains disabled while its hardware-compositor behavior is validated.

## Video scopes

Press `V` to toggle the video scopes panel. Its source is always identified above the scopes; during a wipe, choose either complete asset with the source buttons in the panel. Three scopes are displayed side by side — click the histogram or waveform to cycle through modes:

- **Histogram** — RGB → RGB + luma → CDF (cumulative distribution)
- **Waveform** — luma → RGB parade → RGB overlay
- **Vectorscope** — plots color information (Cb vs Cr) with skin tone line and color target markers

Scopes update in real time during playback and on frame step. Works on both video frames and still images.

## Audio visualization

Press `W` to toggle waveform and spectrogram views. The shared **Fit / Ref** control applies to both displays and persists across sessions. **Fit** normalizes each asset's waveform to its own peak and scales its spectrogram to its strongest energy, making quiet detail easy to inspect. **Ref** shows true waveform amplitude against 0 dBFS and maps every spectrogram to the same fixed −70 to 0 dBFS range for direct level comparison. Encoded leading and trailing audio gaps stay blank on the video timeline; decoded audio is never stretched to fill them. Waveform uses dB color coding in Ref — green for normal levels, yellow for caution (>-6dB), red for hot/clipping (>-1dB). Spectrogram supports linear/log frequency scale (`Shift+W`) and multiple color palettes (`P`).

Scrub previews retain the soundtrack's placement on the video timeline, including intentional leading silence. Native playback remains browser-managed; Chromium's Web Audio replacement for affected Opus files uses the same offset-aware mapping.

If a video container does not expose an audio start timestamp, WarpDiff shows a persistent warning naming the affected slot. Decoded-audio views and tools keep their fallback timeline, native playback is not shifted, and the warning asks you to verify A/V sync. A confirmed start at 0 does not warn.

## Audio file comparison

Load 1–3 audio files (MP3, WAV, FLAC, AAC, OGG, etc.) to compare them as stacked slots in Grid mode. Each slot shows a waveform (top) and spectrogram (bottom) with frequency labels. Info bars display sample rate, channels, bit depth (or codec name for lossy formats), file size, and EBU R128 metrics (integrated LUFS, LRA, true peak). Press `E` to cycle between waveform, waveform + LUFS envelope, and LUFS envelope only.

Spectrogram scale and palette controls (`Shift+W`, `P`) apply to all audio slots.

## Keyboard-driven workflow

Every action has a hotkey. Press `?` for help, `H` for the full hotkey list, `Esc` to dismiss. Hotkeys are fully customizable — click any key in the hotkeys panel to rebind it. Custom bindings persist across sessions.

## Installable

WarpDiff is a Progressive Web App. Install it from Chrome, Edge, or Safari for a standalone window experience. Offline-capable via service worker with network-first caching — works without an internet connection after first load.

## Works instantly

No install required, no account, no upload. Open in any browser, load your files. Everything stays local on your machine.
