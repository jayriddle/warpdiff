# *Warp*Diff

A browser-based tool for reviewing and comparing 1–3 images, videos, or audio files. No setup, no install — runs in your browser. Installable as a PWA for offline use.

**[Open WarpDiff →](https://jayriddle.github.io/warpdiff/)**

**Current version:** 3.12.39

---

## Why

Comparing two versions of an image, video, or audio file shouldn't require flipping between tabs, exporting screenshots, or piecing together a custom diff in Photoshop. Existing tools either don't handle all three media types, can't align frames precisely, or don't surface the technical signals — color, audio levels, frame timing — that determine whether a change is actually correct.

WarpDiff is an opinionated answer to that problem: load 1–3 assets of one media type—image, video, or audio—align them precisely, and have the scopes and metrics you actually need (waveform, vectorscope, histogram, EBU R128, LUFS) one keystroke away.

It started as a personal tool for my own review workflow. Other reviewers asked to use it. Many releases later, here we are.

---

## Features

**View modes**
- **Stack** — flip between assets with arrow keys, same position/zoom
- **Grid** — side-by-side (2 files) or all three in a row/column (3 files), auto-picks layout; `3` toggles inline / offset
- Press either `S` or `G` repeatedly to toggle back and forth between Stack and Grid
- Mixed orientations use equal-area layout so each asset has the same visual weight
- `\` toggles Stack between **Fit** (each asset fills the viewport independently) and **Balance** (equal rendered area across assets)

**Zoom loupe** (`Z`)
- Pixel-level inspection without changing your view
- `+`/`-` magnification (2×–32×), `[`/`]` resize
- `Shift+Z` linked zoom — hover one asset, see the same spot magnified on all others

**Video & audio playback**
- Sync-locked playback across all assets — with 2+ videos, **Sync** wraps at the shortest clip for frame comparison while **Full** reviews every clip to its end; clips stay aligned in Stack and Grid (on Safari, alignment is applied at pause rather than continuously — WebKit presents rate-corrected video unevenly)
- Frame-step with `,` and `.`
- `J`/`K` slower/faster (0.25×–2×)
- Per-source audio switching (S or GT / A / B) with individual mute
- Scrub preview follows the displayed frame, preserves stereo placement, and uses the same master volume as normal playback
- Master mute (`M`) that persists across loads and sessions — reviewing muted stays muted, with an amber **Muted** label and a first-play reminder
- `I`/`O` loop in/out points, Shift+drag on timeline

**Audio file comparison**
- Load 1–3 audio files (MP3, WAV, FLAC, etc.) for side-by-side waveform + spectrogram
- Info bars show sample rate, channels, bit depth/codec, file size, and EBU R128 metrics (integrated LUFS, LRA, true peak)
- `E` cycles waveform / waveform + LUFS envelope / LUFS envelope only

**Frame gallery** (`Shift+G`)
- Capture the current frame from any slot and pin it to a scrollable gallery strip
- `{`/`}` step through captured frames — all videos seek to that timecode
- Gallery clears when new media is loaded

**Analysis**
- `Q` image wipe — first asset left and second asset right, matching Grid order; click the plate to snap the cutoff, or directly select Ref–A, Ref–B, or A–B in the centered header control. The loupe and rotation follow the side under the cursor, while the scopes panel provides its own source selector
- `D` difference mode — pixel difference between two assets in Stack mode; arrow keys or `Shift+D` cycle pairs (Ref–A, Ref–B, A–B). During playback the composite only updates when both videos are on the same frame, so a transient offset can't render as false motion ghosting
- `V` video scopes — histogram (RGB / RGB+luma / CDF), waveform (luma / RGB parade / overlay), and vectorscope; click each scope to cycle modes. The scopes panel always identifies its current source
- `W` audio waveform with dB color coding + spectrogram (Inferno palette by default); the shared **Fit / Ref** control switches between per-asset detail and a fixed dBFS reference scale, while encoded leading/trailing audio gaps remain aligned to the video timeline
- Scrub audio preserves intentional soundtrack offsets and leading silence from the video container
- If a video container does not expose an audio start timestamp, WarpDiff keeps playback unchanged and shows a persistent warning identifying the affected slot so you can verify A/V sync
- `Shift+W` toggle linear/log frequency, `P` cycle spectrogram palettes

**Keyboard-first**
- Every action has a hotkey — press `?` for help, `H` for all hotkeys
- Reassign any hotkey from the hotkeys panel (click a key to rebind)
- Zoom, pan, and navigate without touching the mouse
- Preferences (loupe, volume, Fit / Ref audio scaling, spectrogram settings, custom hotkeys) persist across sessions

**Installable**
- Install as a standalone app from Chrome, Edge, or Safari
- Offline-capable via service worker with network-first caching

## Usage

1. Open the [live app](https://jayriddle.github.io/warpdiff/) — or install it as a PWA
2. Press **L** (or click **Load**, or drag and drop) and select 1–3 image, video, or audio files
3. Use **Stack / Grid** buttons to switch views
4. Press **H** to see all keyboard shortcuts

Files auto-sort oldest → newest by timestamp. See [MANUAL.md](MANUAL.md) for full documentation.

---

## For Engineers

### Architecture

- **Mostly one file, no build step** — `index.html` holds all the HTML/CSS and the bulk of the JS, with cohesive subsystems extracted into classic `<script>` files under `js/`, including audio analysis, scopes, hotkeys, media demuxing/decoding, frame-accurate scrubbing, timecode, image wipe, transport, and the landing animation. These are *not* ES modules — they share one global scope with the inline script, which is the only viable split given the no-build constraint. No framework, no runtime dependencies.
- **PWA** — `manifest.json` + `sw.js` provide install + offline support. `CACHE_NAME` is kept in sync with `APP_VERSION` on every release (enforced by the ownership test harness, which also checks every `js/*.js` is in the service-worker precache).
- **Memory-aware rendering** — scopes and audio viz use cached typed-array buffers and `putImageData` to keep the hot path off the GC; the spectrogram bakes a 256-entry color LUT and scales contrast per clip.
- **Two test layers** — a Playwright suite (real headless Chromium) covering transport, difference and wipe modes, pan/zoom, hotkey reassignment, layouts, and audio visualization; plus a dependency-free Node harness (`npm run test:ownership`) that asserts single-owner invariants, documentation/build/version hygiene, and pure-function logic without a browser.

### Design principles

- **No build, no runtime dependencies.** Vanilla HTML / CSS / JS in the app itself. Playwright is the only npm dependency, and only for tests.
- **Memory-aware by default.** Typed arrays for bulk data, cached buffers reused across frames, blob URLs over base64, audio downsampled for scrub but kept full-quality where sync matters.
- **Frame-accurate where it matters.** Midpoint seeking `(frame + 0.5) / fps` to avoid IEEE 754 boundary issues; epsilon-based timecode display; `requestVideoFrameCallback` for loop-point detection.
- **Color-correct by default.** Magnifier uses cloned `<video>` elements to stay on the hardware compositor path, because `drawImage(video, canvas)` produces incorrect colors on macOS P3 displays.

### Going deeper

- **[CLAUDE.md](CLAUDE.md)** — project conventions, architecture patterns, naming, and the specific technical decisions worth knowing about (frame stepping math, Stack zoom modes, equal-area grid layout, scope rendering strategy).
- **[memory.md](memory.md)** — memory-management patterns: buffer caching, audio downsampling, AudioContext lifecycle, stale-decode guards, magnifier clone handling, and GC pressure avoidance.

These are the right starting points if you want to understand how the project is structured.

### Running tests

```bash
npm install
npx playwright test          # behavioral suite (headless Chromium)
npm run test:ownership       # structural + pure-logic guards (no browser)
```

---

## Status

Actively maintained. Releases follow semantic-ish versioning with a "What's New" entry on each release. See commit history for the detailed changelog.

## Bugs & Feature Requests

Found a bug or have an idea? [Open an issue](https://github.com/jayriddle/warpdiff/issues/new/choose) — include the version and build hash shown in the top-left corner of the app (e.g. `v3.11.7 · 9873bee`) when reporting bugs; the hash identifies the exact deployed build.

## License

Not currently licensed for redistribution or derivative use. Reach out if you're interested in using or building on this.

## Contact

Jay Riddle — [GitHub](https://github.com/jayriddle)
