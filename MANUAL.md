# WarpDiff User Manual

WarpDiff is a browser-based comparison tool for reviewing 1–4 images, videos, or audio files in Stack or Grid mode. Installable as a PWA for offline use.

---

## Loading Files

**Three ways to load files:**
- Press **L**
- Click the **Load** button in the header
- Drag and drop files onto the window (or the landing drop zone)

**File requirements:**
- 1, 2, 3, or 4 files (images, videos, or audio files)
- All files in one comparison must be the same media type; mixed image/video/audio selections are rejected
- 2 files → assigned to **A** and **B**
- 3 files → assigned to **Ref**, **A**, and **B** by default; the reference is labeled **GT** for audio, and connected review tasks may supply more specific labels such as Source or Response
- 4 files → assigned in oldest-to-newest order and labeled by type: **Image-1…Image-4**, **Video-1…Video-4**, or **Audio-1…Audio-4**
- Files are automatically sorted oldest → newest by last-modified timestamp

**Loading progress:** While WarpDiff prepares a comparison, it lists every assigned slot and filename with live states for opening the file, reading metadata, decoding the first visible frame, and readiness. Completed files are checked off while slower files continue to animate. When one video finishes first, the message identifies which file is still being prepared and explains that WarpDiff is waiting to reveal the complete comparison together. A longer wait adds a reminder about large or complex files. Click **Cancel** to stop a manual load and return to the landing screen.

**Timestamp warning:** If two or more files have timestamps within 2 seconds of each other, a toast warns that the sort order may be unreliable — check that the right file landed in the right slot.

**Duplicate detection:** If two slots contain the same file (matched by name, size, and timestamp), a warning banner appears at the top of the screen.

**Audio timing warning:** If a video's container does not expose an audio start timestamp, a persistent amber alert names the affected slot and asks you to verify A/V sync. WarpDiff does not shift native playback; the warning applies to decoded-audio views and tools using a fallback timeline. Videos whose containers explicitly report a start at 0 do not trigger it.

**Reset:** Click the **Reset** button (visible after loading) to clear all files and start over.

---

## View Modes

### Stack
The default mode. One asset is visible at a time, layered on top of the others. Use the arrow keys or the asset buttons in the header to switch between assets.

### Grid (2 files)
Both assets are displayed side-by-side or top-to-bottom with a small gap between them. WarpDiff chooses the orientation that gives the assets the most useful rendered area and re-evaluates it when the window changes size.

The layout auto-picks horizontal (left/right) or vertical (top/bottom) based on viewport dimensions and aspect ratios, re-evaluated on resize.

### Grid (3 files)
All three assets are displayed in a grid. Press **3** to toggle between Inline (columns or rows, auto-picked by aspect ratio) and Offset (Ref on the left, A/B paired on the right — often more space-efficient).

### Grid (4 files)
All four assets use **Inline** in a balanced 2×2 grid. Offset is hidden because it is specific to the three-item Ref/A/B arrangement. Hiding one slot switches to the normal three-item layout; restoring it returns to 2×2.

---

## Hiding Slots (Grid Mode)

In Grid mode, you can hide any slot to give more screen space to the remaining assets.

**To hide a slot:** click its colored label pill in the info bar. The slot disappears and the remaining assets expand to fill the space.

**To restore a hidden slot:** click its ghost pill in the header. Hidden slots appear as dimmed, colored labels next to the mode icons — click one to bring that slot back.

You can't hide the last visible slot.

| Shortcut | Action |
|----------|--------|
| **Shift+1** | Toggle Ref / slot 1 visibility |
| **Shift+2** | Toggle A / slot 2 visibility |
| **Shift+3** | Toggle B / slot 3 visibility |
| **Shift+4** | Toggle slot 4 visibility |

These shortcuts are no-ops in Stack mode or when a slot isn't loaded.

---

## Switching Modes

| Action | Result |
|--------|--------|
| Click **STACK** / **GRID** in header | Switch to that mode |
| Press **S** | Toggle between Stack and Grid |
| Press **G** | Toggle between Stack and Grid |

---

## Zoom & Pan

Zoom and pan are available in **Stack mode only**.

| Shortcut | Action |
|----------|--------|
| **+** | Zoom in |
| **−** | Zoom out |
| **0** | Zoom to fit |
| **1** | Zoom to 100% (actual pixels) |
| **\\** | Toggle Fit / Balance zoom mode |
| **Click and drag** | Pan (when zoomed in) |

Zoom range: 5% – 3200%. Each step multiplies/divides by √2 (~1.41×).

In **Grid mode**, pressing **1** toggles between fit-to-panel and 100% native pixels. Assets zoom to their actual pixel size, even if that means overflowing the panel.

A zoom indicator appears in the info bar showing the current scale as a percentage (e.g. `150%`).

### Fit vs. Balance zoom

A pill indicator in the header shows the current Stack zoom mode. Press **\\** or click the pill to toggle.

- **Fit** (default) — each asset independently fills the viewport at whatever scale best uses the available space. A portrait image and a landscape image each fill the screen on their own terms. Best for comparing files with different formats, crops, or aspect ratios.

- **Balance** — all assets are scaled to the same rendered screen area. Portrait, square, and landscape assets receive equal visual weight without being forced to the same pixel scale, and the fit calculation prevents overflow at the default zoom.

Balance is most useful when different aspect ratios make one asset dominate the screen in Fit. Use Fit when seeing each asset at its own largest possible size is more important. Switching back to Fit restores the zoom and pan position you had before entering Balance.

---

## Zoom Loupe

Press **Z** to toggle a circular zoom loupe that follows your cursor, showing magnified native pixels without changing the overall zoom level. Works in all view modes.

| Shortcut | Action |
|----------|--------|
| **Z** | Toggle zoom loupe |
| **+** / **−** | Adjust magnification (2×–32×, when loupe is active) |
| **[** / **]** | Resize loupe (100–400px) |
| **Shift+Z** | Toggle linked zoom |

**Linked zoom:** In Grid modes, enabling linked zoom (**Shift+Z**) shows corresponding loupes on all other visible assets at the same relative position — hover over one asset to compare the exact same spot across all versions.

The loupe hides during panning and updates live during video playback and frame stepping. Loupe size and magnification level persist across sessions.

---

## Video Playback

Video controls appear at the bottom of the screen when videos are loaded. Playback defaults to **Sync**, where all videos play, pause, and seek together. Press **Shift+S** or click **Playback: Sync** to switch to **Solo**, where the transport controls affect only the selected video.

| Control | Description |
|---------|-------------|
| **Progress bar** | Click to seek; drag to scrub |
| **Timecode** (left) | Current position — displays SS:FF or M:SS:FF based on detected frame rate |
| **Duration** (right of bar) | Total length |
| **Speaker icon** | Mute/unmute the active audio source. When muted it shows an amber **Muted** label, and the muted state is remembered across new file loads and future sessions |
| **Volume slider** | Adjust volume |
| **S or GT / A / B buttons** | Select which asset's audio to hear (the reference button is S for image/video review and GT for audio-only review) |

**Keyboard shortcuts:**

| Shortcut | Action |
|----------|--------|
| **Space** | Play / Pause |
| **Shift+S** | Toggle Playback: Sync / Solo |
| **,** | Step back one frame |
| **.** | Step forward one frame |
| **R** | Restart from beginning |
| **J** | Slower (cycle: 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×) |
| **K** | Faster (cycle in reverse) |
| **I** | Set loop in-point at current time (shared across all clips) |
| **O** | Set loop out-point at current time (shared across all clips) |
| **Shift+L** | Playback range: Sync (shortest) ↔ Full (longest) |
| **M** | Mute / Unmute (persists across loads and sessions) |

**Playback scope:** The adjacent **Playback: Sync / Solo** and **Range: Sync / Full** controls define how clips participate and how much of them plays. In Solo, Space, restart, frame stepping, speed changes, scrubbing, custom loop points, progress, and audio all follow the selected video. Choose another video with the asset controls or audio-source buttons to hand playback off at the same absolute time. If that time is beyond a shorter target, WarpDiff holds it paused on its final frame instead of wrapping and retains the longer time for switching back or rejoining Full Sync. Returning to range-limited Sync from outside the shared range restarts at its shared in-point. Custom loop markers remain shared; their effective out-point is clamped to the Solo video, and a loop whose in-point is beyond its end holds there with an explanation. The multi-clip **Range: Sync / Full** control is hidden while Solo is active.

**Audio source selector:** Only one audio track plays at a time. Click a labeled source button to switch sources. Each button has its own mute icon for independent muting. In Sync, muting the active source automatically selects the next unmuted source. In Solo, the source identifies the solo video and remains selected if muted.

**Persistent mute:** The master mute (the speaker icon / **M**) is sticky — once you mute, WarpDiff stays muted when you load a new comparison and the next time you open it. The muted button shows an amber **Muted** label so the state is always clear, and the first time you press play while muted a brief reminder offers a one-click **Enable**. (Per-source mutes still reset with each new comparison.)

**Loop points:** Press **I** to set a loop in-point and **O** to set a loop out-point. You can also **Shift+drag** on the progress bar to select a loop region. Loop markers appear as orange triangles on the progress bar. Playback loops between these points. Loop points are **shared across all clips** — one region applies to every clip and stays put when you switch the active clip. Double-tap **Esc** to clear both markers.

**Sync-locked looping:** With two or more videos loaded, playback loops all of them together, and a continuous drift lock keeps every video on the active one's clock (within half a frame) in both Stack and Grid mode — so A/B comparison stays frame-aligned across loop passes. Clips start a frame or two apart (a decoder start race); on Chrome the lock closes that within about a third of a second of pressing play. On Safari the clips are instead left to run free during playback (rate corrections make WebKit present video unevenly) and are aligned exactly when you pause, which is when frame accuracy matters. Custom loop points take precedence when set.

**Playback range for clips of different lengths** (**Shift+L**, or the **Range:** button on the transport bar): **Full** wraps at the longest clip so you can review each in full — a shorter clip holds on its last frame while the longest plays out its tail, then all restart together. **Sync** wraps at the shortest clip so every frame has a counterpart to compare frame-for-frame. When you load clips of **different lengths they default to Full** (so nothing is hidden) and the Range button is highlighted; press **Shift+L** to switch to Sync for tight frame comparison. Equal-length clips use Sync. In Sync mode, any part of a clip that runs past the loop is shown hatched on the progress bar.

---

## Audio Visualization

Press **W** to toggle the waveform and spectrogram panel below the video controls.
If a video's audio track begins late or ends early, the waveform, spectrogram, and LUFS envelope preserve those presentation gaps as blank timeline intervals.
For clips of two minutes or longer, WarpDiff uses a bounded full-timeline spectrogram with lower fine-frequency resolution. Analysis adapts its hop to cap each channel at 8,192 FFT frames, so hour-scale and high-sample-rate media cannot create ever-growing spectrogram buffers; playback, waveform, loudness metrics, and scrub audio remain full-duration.

The shared **Fit / Ref** control changes the level scale for both displays and remembers your choice:
- **Fit** normalizes each asset's waveform to its own peak and scales its spectrogram to its strongest energy. Use it to reveal quiet detail.
- **Ref** preserves true waveform amplitude against 0 dBFS and gives every spectrogram the same calibrated −70 to 0 dBFS color scale. Use it for honest level comparisons between assets.

In **Ref**, the waveform uses dB color coding:
- **Green** — normal levels (below -6dB)
- **Yellow** — caution (-6dB to -1dB)
- **Red** — hot/clipping (above -1dB)

Mono tracks display a single waveform with a MONO indicator. Stereo tracks show L and R channels.

Press **E** to cycle through waveform display modes: Waveform only → Waveform + LUFS envelope → LUFS envelope only. The LUFS envelope shows short-term loudness as a stepped chart on a fixed −36 to 0 LUFS scale, with reference lines at −14 (streaming), −16 (podcast), and −23 (broadcast).

**Spectrogram** shows frequency content over time:
- **Shift+W** toggles between linear and log frequency scale
- **P** cycles through color palettes (Viridis, Magma, Inferno, Plasma)

Click and drag on the waveform or spectrogram to scrub playback. Shift+drag to set a loop region.

During video scrubbing, WarpDiff previews only the currently selected soundtrack and follows the same master volume as normal playback. With one visible video, audio is anchored to the frame WarpDiff actually displays. In multi-video Grid, it follows the shared scrub target on a steady clock so competing decoder callbacks cannot chop the audio. During normal playback, the progress bar and waveform/spectrogram cursor use compositor-smoothed motion between presented frames; loop and synchronization decisions still use the video's unmodified media clock.

If a video's soundtrack intentionally begins after the first frame, scrub preview remains silent until that start point rather than playing the first audio sample early.

Video scrub preview preserves the soundtrack's channels and phase. Stereo side information—including opposite-polarity `L = −R` material—remains audible instead of being folded to mono and cancelled.

Successive 90 ms scrub grains are scheduled on a steady 50 ms clock and phase-aligned within a bounded ±8 ms neighbourhood before they overlap. Their audible duration remains constant at every playback speed. This prevents event bursts and speed changes from opening gaps, while keeping steady centered tones—and similar voiced material—from thinning or dropping out.

---

## Audio File Comparison

Load 1–4 audio files (MP3, WAV, FLAC, AAC, OGG, etc.) to compare them as stacked slots in Grid mode. Four-input comparisons use Audio-1 through Audio-4 labels. Each audio slot displays a waveform (top 40%) and spectrogram (bottom 60%) with frequency labels.

**Info bar** shows audio metadata: sample rate (e.g. `48 kHz`), channels (`Mono` / `Stereo`), bit depth (e.g. `24-bit` for lossless, or codec name like `MP3` for lossy), file size, and duration.

**Spectrogram controls** work in audio mode:
- **Shift+W** toggles linear / log frequency scale
- **P** cycles color palettes

Audio files use the same synced playback controls as video: Space to play/pause, the progress bar to seek, and the labeled source buttons to select which track to hear.

---

## Frame Gallery

Press **Shift+G** to capture the current frame from the active video or image slot and pin it to a gallery strip above the transport controls.

| Shortcut | Action |
|----------|--------|
| **Shift+G** | Grab current frame to gallery |
| **{** (Shift+[) | Step to previous captured frame |
| **}** (Shift+]) | Step to next captured frame |

Each thumbnail shows the slot label and timecode. Click a thumbnail to seek all videos to that frame's timecode — the active frame is highlighted with a blue border and the strip scrolls to keep it visible. Click **×** on a thumbnail to remove it, or **Clear all** in the gallery header to remove all frames. The gallery closes and clears automatically when new media is loaded.

---

## Video Scopes

Press **V** to toggle the video scopes panel above the video controls. Three scopes are displayed side by side — click the histogram or waveform canvas to cycle through modes:

- **Histogram** — RGB → RGB + luma → CDF (cumulative distribution function)
- **Waveform** — luma → RGB parade → RGB overlay
- **Vectorscope** — plots color information (Cb vs Cr) on a circular graph with skin tone line and R/Y/G/C/B/M color target markers

Scopes update in real time during playback and on frame step. Works on both video frames and still images.

---

## Image Wipe

Press **Q** in Stack mode to compare two images with a draggable hard cutoff. Pair order matches Grid order: the first asset is on the left and the second is on the right. Click inside the comparison plate to snap the cutoff there; a drag remains a normal pan gesture, and clicks outside the plate are ignored. A subtle guide line marks the boundary while idle and disappears while the pointer is held down. With three images, the centered header control directly selects **Ref–A**, **Ref–B**, or **A–B**. For mismatched aspect ratios, each asset includes a neutral matte so either side can fully replace the other without the underlying image bleeding through. Drag the cutoff left or right, or click the divider to focus it and use the arrow keys for precise adjustment. Hold **Shift** while pressing an arrow key for larger steps.

The wipe header shows only what is being compared. When video scopes are open, the scopes panel provides its own source selector and clearly labels the complete asset being analyzed. The zoom loupe and `Alt+←` / `Alt+→` rotation follow the visible side under the cursor; the loupe label and rotation toast identify the affected asset. If the pointer is outside the comparison plate, rotation asks you to point to a side first. On narrow windows, the wipe control moves just below the header so it cannot cover the Help or view-mode buttons.

| Shortcut | Action |
|----------|--------|
| **Q** | Toggle image wipe on/off |
| **Shift+Q** or **← →** | Cycle Ref–A, Ref–B, and A–B |
| **Header pair control** | Select any comparison directly |
| **Scopes source buttons** | Select which complete asset feeds the scopes |

Wipe follows Stack zoom, pan, rotation, and resize. Up/down arrows do not change the comparison pair unless the focused divider is using them for position adjustment. Difference mode and wipe are mutually exclusive. Video wipe is not available yet.

---

## Seamless Tile Check

Press **Y** with one or more images loaded to open Tile Check. Select any loaded image from the source buttons, or use the left/right arrow keys while the mode is open.

- **3×3** repeats the complete image nine times so seams and obvious repetition can be judged in context.
- **Offset** wraps the image by half its width and height, moving its four original edges to a cross in the center.
- **Heatmap** overlays green, amber, and red seam segments to identify where continuity is strongest or weakest.

Tile Check scores **Left ↔ Right**, **Top ↔ Bottom**, and the four-way **Corners** separately, then uses the weakest result as the overall rating. It compares color, transparency, and texture-direction changes at each wrap boundary with ordinary transitions inside the same image. Results are labeled **Seamless**, **Review**, or **Visible seam**; the numeric score is supporting information rather than a guarantee.

The detector measures technical edge continuity. An image can pass while still revealing an obvious repeated object, shadow, or lighting pattern, so always inspect the repeated preview. Analysis uses the original source pixels—not black-and-white display filtering, zoom, or rotation—and files remain local. The preview type and Heatmap choice persist across sessions. Tile Check, Image Wipe, and Difference are mutually exclusive.

---

## Difference Mode

Press **D** in Stack mode to overlay a pixel-difference composite of the current asset and another. Identical pixels appear black; differences glow in proportion to the delta — the brighter the pixel, the larger the difference.

| Shortcut | Action |
|----------|--------|
| **D** | Toggle difference mode on/off |
| **Shift+D** or **← →** | Cycle through diff pairs (Ref–A, Ref–B, A–B) |

With 2 files loaded there is one pair (A–B). With 3 files there are three pairs. With 4 files there are six media-numbered pairs, such as Image-1–Image-2 or Video-1–Video-2. Use **Shift+D** or the arrow keys to cycle through them; a toast shows the active pair label each time you switch.

Difference mode uses the canvas `difference` composite operation for hardware-accelerated rendering — no manual per-pixel loops. It updates live during video playback and on frame step, and follows zoom and pan. During playback the composite only updates when both videos are on the same frame — a transient one-frame offset briefly holds the last matched diff instead of flashing false motion ghosting. The overlay is automatically removed when you switch to Grid mode or press **D** again.

---

## Mixed Orientation Layout

When loading assets with different orientations (e.g. landscape and portrait videos together), Inline Grid uses an **equal-area algorithm** so each asset has roughly the same visual weight regardless of aspect ratio. Four assets use a 2×2 Inline grid. Offset remains available for exactly three visible assets; press **3** to switch between the two layouts.

---

## Keyboard Shortcuts Reference

All hotkeys are customizable — press **H** to open the shortcuts panel, then click any key to rebind it. Custom bindings persist across sessions.

### Files
| Key | Action |
|-----|--------|
| **L** | Load files |

### View Mode
| Key | Action |
|-----|--------|
| **S** | Toggle Stack / Grid |
| **G** | Toggle Stack / Grid |
| **3** | Toggle Grid layout (Inline ↔ Offset) |
| **Shift+1 / 2 / 3** | Toggle slot visibility (Grid mode) |
| **F** | Fullscreen |
| **Alt+← / Alt+→** | Rotate the active asset 90° counterclockwise / clockwise |

### Zoom & Pan
| Key | Action |
|-----|--------|
| **0** | Zoom to fit |
| **1** | Zoom to 100% / fit to panel |
| **\\** | Toggle Stack Fit / Balance zoom |
| **+** / **−** | Zoom in/out (or loupe magnification) |
| **Z** | Toggle zoom loupe |
| **Shift+Z** | Toggle linked zoom (Grid) |
| **[** / **]** | Resize zoom loupe |

### Transport
| Key | Action |
|-----|--------|
| **← → ↑ ↓** | Switch asset (Stack mode) |
| **Space** | Play / Pause |
| **Shift+S** | Toggle Playback: Sync / Solo |
| **,** / **.** | Frame step back / forward (repeated presses advance one frame each) |
| **R** | Restart |
| **J** / **K** | Slower / Faster |
| **I** / **O** | Loop in / out |
| **Shift+L** | Toggle playback range: Sync / Full |
| **M** | Mute |

### Analysis
| Key | Action |
|-----|--------|
| **Y** | Toggle seamless Tile Check |
| **V** | Toggle video scopes |
| **W** | Toggle waveform / spectrogram |
| **E** | Cycle waveform / LUFS envelope display |
| **Shift+W** | Toggle linear / log frequency |
| **P** | Cycle spectrogram color palette |
| **D** | Toggle difference mode (Stack) |
| **Shift+D** | Cycle diff pair |
| **Q** | Toggle image wipe (Stack) |
| **Shift+Q** | Cycle wipe pair |
| **B** | Toggle black & white |
| **N** | Toggle no-video mode (audio focus) |
| **Shift+G** | Grab frame to gallery |
| **{** / **}** | Gallery: previous / next frame |

### Timecode
| Key | Action |
|-----|--------|
| **T** | Cycle timecode format |
| **C** | Copy timecode |
| **Shift+C** | Open timecode format chooser |

### Panels
| Key | Action |
|-----|--------|
| **?** | Help (Getting Started) |
| **H** | Shortcuts panel |
| **Esc** | Dismiss loupe / close panel |

---

## Preferences

The following settings are saved to your browser and persist across sessions and page reloads:

- Zoom loupe size and magnification level
- Linked zoom on/off
- Volume level
- Master mute
- Stack Fit / Balance mode and per-slot rotation
- Audio visualization visibility, height, split, and Fit / Ref level scaling
- Spectrogram scale (linear/log) and color palette
- Tile Check preview type and heatmap visibility
- Timecode display and copy format
- Custom hotkey bindings

---

## Info Bar

Each asset displays an info bar (Grid mode) or a header strip (Stack mode) showing:
- **Slot label** — colored pill (green = GT/Ref, amber = A, magenta = B); hidden when only one file is loaded
- **FPS** — frame rate, shown dimmed until detected; snaps to nearest standard rate (23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60)
- **Duration** — video/audio length with a stopwatch icon; `—` for images
- **Resolution** and **aspect ratio** — for images and video (e.g. `1920×1080`, `16:9`)
- **EBU R128 metrics** — for any asset with audio: **LUFS** (integrated loudness, green), **LRA** (loudness range in LU, blue), **TP** (true peak in dBTP, purple)
- **Zoom** — current scale percentage, right-aligned
- For audio files: sample rate, channels, bit depth/codec, file size

Field order and color hierarchy are consistent between Grid info bars and the Stack header strip.

Video timecode displays as SS:FF or M:SS:FF. Audio timecode displays as S.cc or M:SS.cc (centiseconds). Press **T** to cycle timecode formats; press **C** to copy; **Shift+C** to open the format chooser.

---

## PWA & Offline

WarpDiff is a Progressive Web App — install it from Chrome, Edge, or Safari for a standalone window experience. After the first load, it works offline via a service worker with network-first caching.

---

## Welcome & Changelog

On your first visit, a **Getting Started** popup appears with an overview of the main features. On subsequent visits after an update, a **What's New** popup shows what changed in the latest version. Both dismiss automatically when you load files, or you can close them with the ✕ button, Escape key, or clicking the backdrop.

Press **?** or click the **Help** button in the header to reopen the Getting Started popup at any time.

---

## Limitations

- **1 to 4 files only** — loading 5+ files is not supported
- **Images, videos, and audio only** — other file types are ignored
- **One media type per comparison** — images, videos, and audio cannot be mixed in the same load
- **Pan available in Stack mode only**
- **Audio:** one track at a time; others are automatically muted
