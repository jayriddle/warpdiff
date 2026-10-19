# *Warp*Diff

A browser-based tool for reviewing and comparing 1–4 images, videos, or audio files. No setup, no install — runs in your browser. Installable as a PWA for offline use.

**[Open WarpDiff →](https://jayriddle.github.io/warpdiff/)**

**Current version:** 3.19.9

---

WarpDiff can run in tablet browsers, but some features depend on keyboard shortcuts, hover, or precise dragging. Touch support is currently limited; a keyboard and mouse or trackpad are recommended for more complete control. The header wraps in very narrow windows to keep Appearance and privacy reachable during review.

## Open files with optional local preparation

Use **Load** or drag and drop normally. If a video or audio file cannot be used fully, WarpDiff offers **Prepare and open**. Connect the separately running local tool once for this visit, approve its connection window, and keep that window open. Only your explicit preparation action sends selected files to that tool on your computer; nothing is uploaded to a remote preparation service. The returned copies load automatically alongside the other comparison files. No package manifest, copied per-file command or second picker is needed.

Originals stay untouched. Compatible AVC picture is copied; other picture may become H.264 at up to 1080p. Video soundtracks become stereo AAC; audio-only copies retain channel count/sample rate in PCM WAV. Analysis describes the loaded review copy, not original-source fidelity or measurement conformance. The local tool uses separately installed FFmpeg/ffprobe; WarpDiff bundles no converter. **Preparation → Other ways to prepare** retains the safe copied-command fallback. Managed review hosts retain control of their media.

[Local tool setup and limits](tools/media-prepare/companion/README.md). This candidate workflow is awaiting review and is not published yet.

## Customize the info bar

Open **Customize info bar** (the sliders icon in the header) to choose visible information, arrange elements in **Left aligned** and **Right aligned** sections with drag handles, and adjust their color, text size and bold styling. Presets keep Zoom at the far right; drag any field or spacer within or between sections to suit your layout. Mouse, touch and keyboard movement are supported. Start with **Default**, **Minimal**, **Visual Focus**, **Audio Essentials**, or **All Available**. Audio information can be hidden together or selected field by field. Add adjustable **spacers** to group related fields.

Image, video and audio profiles are saved separately in this browser and apply to both Stack and Grid. Narrow bars compress spacers and keep right-edge fields first, then put remaining selected fields in **More** (shown as **⋯** in compact Grid bars). Customized Stack information moves to its own header row when space is tight. Reset profile restores the original display. See the [workflow](MANUAL.md#info-bar) and [review and verification record](docs/info-bar-review-2026-10-10/README.md).

## Appearance and optional usage sharing

Choose **Original, Starfield, Solar, Nebula, or Glacier** from **Appearance and privacy** in the header. Starfield spreads a slower Ad Astra animation across a wide landing background, selected here instead of with the hidden X toggle. Solar bodies move in the same direction at different speeds along fixed orbital planes. Nebula adds slowly orbiting stars, faint spiral arms and a soft galaxy hub. The choice stays in this browser; landing decorations never change media, scopes, or slot colors. All appearances are available without sharing usage.

The panel puts usage sharing first and appearances below it. Provider details are expandable. Loading files without answering keeps sharing off and quietly retires the invitation; the choice remains in settings.

GoatCounter reporting is **strictly opt-in**. Account collection settings have been verified. The adapter sends engaged visits, daily activity, ready reviews of 1–4 items, comparison-tool use, scrub-frequency bands, one broad window-size group per ready review and fixed failure/fallback categories to WarpDiff’s GoatCounter account. Review and tool events include app release, media type and item count; files, filenames, contents and raw errors are never sent. GoatCounter receives IP addresses and browser headers, and retains browser/OS and country counts in a private dashboard configured for automatic deletion after 365 days. GoatCounter’s built-in region, referrer, screen-size, language and individual-pageview collection are disabled. Exact dimensions, monitor resolution and resize history are not sent. Operator: Jay Riddle; privacy contact: [warpdiff@gmail.com](mailto:warpdiff@gmail.com). The local test continues to send only to its loopback recorder. Consent is tied to the accepted sharing scope, independently of app updates; changed scopes require a new Yes. A remembered No stays off across scope changes and sends no analytics requests. Saved consent starts counting only after an accepted manual file load; an explicit Yes can also start the visit. Host-loaded viewers stay excluded. A failed withdrawal save attempts to remove the old permission and explains any remaining storage limitation. Mixed disclosure/collector updates keep reporting disabled while the app remains usable. See the [implementation, local preview, and verification record](docs/appearance-usage-2026-09-29/README.md).

Daily activity counts use of ready comparisons at most once per browser per UTC day. We remember only the last reporting date locally to avoid duplicates across tabs and reloads; no date or user ID is sent. Idle tabs don’t count. These figures estimate active browsers, not people.

## Why

Comparing two versions of an image, video, or audio file shouldn't require flipping between tabs, exporting screenshots, or piecing together a custom diff in Photoshop. Existing tools either don't handle all three media types, can't align frames precisely, or don't surface the technical signals — color, audio levels, frame timing — that determine whether a change is actually correct.

WarpDiff is an opinionated answer to that problem: load 1–4 assets of one media type—image, video, or audio—align them precisely, and have the scopes and metrics you actually need (waveform, vectorscope, histogram, EBU R128, LUFS) one keystroke away.

Single-video and synced playback keep the timeline and waveform playheads moving evenly at the screen's refresh rate while loop and synchronization logic stays frame-accurate. The playheads stop with playback and jump directly on seeks. Changing the active video preserves forward playhead motion. Restart (`R`) and automatic loops snap directly to the loop in-point or beginning. Audio-source changes use a brief fade and keep playback timing steady to prevent switching clicks. Surround playback and scrubbing preserve center dialogue and left/right surrounds in a stereo listening mix, while analysis uses the original decoded channels.

See the [playhead implementation and before/after measurements](docs/playhead-motion-2026-09-15/README.md).

After scrubbing, Play and Restart (`R`) restore the selected playback scope and loop range. Restart also suspends the idle scrub decoder while retaining cached frames for the next drag. See the [restart verification record](docs/restart-playback-2026-09-15.md).

Chrome scrubbing preserves useful decoding on direction changes and retains more full-resolution preview frames for software-decoded High 4:4:4 H.264. Very long keyframe gaps can still delay an uncached seek. See the [scrubbing investigation](docs/playback-lag-investigation-2026-10-05.md).

Videos above 256 MiB, or unable to fit the shared 512 MiB encoded-input budget, use native video scrubbing. Playback and audio preview remain available. Video sample tables above one million entries also use native seeking. See the [input hardening record](docs/media-input-hardening-2026-10-15/README.md) for the limits and verification.

Waveform, spectrogram, and loudness analysis run in the background while files prepare, keeping playback and controls responsive with the same original-audio calculations. See the [playback investigation and verification record](docs/video-stutter-2026-09-15.md).

Replacing a video immediately clears its old waveform and spectrogram, including when the panel is closed. The graphs remain blank until the new analysis is ready. See the [verification record](docs/audio-viz-reset-2026-09-16.md).

Clearing or replacing a comparison releases its scrub-audio resources and previous video. A repaired shutdown race prevents audio memory accumulating across loads. See the [memory investigation](docs/memory-leak-2026-09-15.md).

**Dialogue listening:** open **Listen: Full Mix** beside volume to choose **Dialogue Focus** or **Center Only** for verified surround layouts. Center level and other-channel reduction apply to playback and scrubbing, while original analysis stays intact. Choosing a preset or finishing a mouse adjustment returns focus to Play/Pause so Space resumes playback immediately; Escape also returns to playback. Return to Full Mix to check voices outside the center. Each new comparison starts in Full Mix. Multichannel Opus decoding also preserves all source channels. See the [investigation and verification record](docs/dialogue-listening-2026-09-15/README.md).

**Continuous scrubbing** preserves pitch while following drag speed and direction. Video previews now use full-rate mono/stereo listening audio, prepared directly from the original decode. Original waveform, spectrogram, and loudness analysis stay intact. Clicks give short previews; unavailable or oversized Continuous streams fall back automatically with an explanation. Brief previews also retain original pitch at every selected playback speed. Holding still fades the audio out. See the [implementation and verification record](docs/full-rate-scrub-2026-09-15.md).

Scrub volume now follows the selected source mix more closely, with bounded compensation for level lost during stretching. Quiet/loud differences and stereo balance are retained; strong peaks limit the added boost. See the [volume measurements and limits](docs/scrub-volume-2026-09-22.md).

It started as a personal tool for my own review workflow. Other reviewers asked to use it. Many releases later, here we are.

---

## Features

**View modes**
- **Stack** — flip between assets with arrow keys, same position/zoom
- **Grid** — two files auto-arrange side-by-side or vertically; three use Inline or Offset; four use a balanced 2×2 Inline grid. Hiding slots preserves the remaining assets' order and labels.
- Press either `S` or `G` repeatedly to toggle back and forth between Stack and Grid
- Mixed orientations use equal-area layout so each asset has the same visual weight
- `\` toggles Stack between **Fit** (each asset fills the viewport independently) and **Balance** (equal rendered area across assets)

**Prepared packages**

Ordinary files use **Load** or drag and drop; no package is needed. For files from the optional external tool, open **Help → Advanced → Import externally prepared media**, select `warpdiff-package.json` and the prepared MP4, and optionally select the original to check its byte binding. Add up to three companion images or videos. The dialog explains setup under **How to get prepared files** and offers **Load ordinary files** to return to normal loading. **Check prepared files** verifies the selected bytes and bounded container requirements without replacing the current comparison; **Load comparison** then starts a new comparison through the normal decoder checks. The original is used only for matching and is not added automatically. Loading uses the usual timestamp ordering. Inspection failure or cancellation preserves the current comparison. Nothing is uploaded or converted in the browser. The summary distinguishes inspected stereo format from declared transformations and unverified timing, source fidelity and measurement conformance. See the [optional external tool](tools/media-prepare/README.md).

**Loading feedback**
- **Media status** shows observed picture, pixel access, native playback, decoded-audio analysis and scrub-audio availability for each loaded input. It distinguishes reported timing from unverified frame-rate, synchronization and original-source fidelity claims. Refresh checks current frames without starting playback or preparation. [Scope and verification](docs/media-admission-report-2026-10-17/README.md)
- Each assigned slot and filename reports **Opening**, **Reading metadata**, **Decoding first frame**, or **Ready** while a comparison is prepared
- Ready files are checked off while WarpDiff identifies the slower file, explains that every asset will appear together, and offers **Cancel** for manual loads

**Zoom loupe** (`Z`)
- Pixel-level inspection without changing your view
- `+`/`-` magnification (2×–32×), `[`/`]` resize
- `Shift+Z` linked zoom — hover one asset, see the same spot magnified on all others

**Video & audio playback**
- Unsupported video audio uses a safe external FFmpeg command and numbered reload guidance; no package or JSON details file is needed. WarpDiff does not bundle or run FFmpeg. The supplied command targets MP4/MOV video (including `.m4v`); other formats require a suitable external command. Install FFmpeg separately, make a stereo AAC compatibility copy, then load the output with your other comparison files. Short soundtracks are padded to retain the complete picture. Commands preserve literal filenames; control characters require renaming. See the [manual](MANUAL.md#loading-files) for installation, copying and reload instructions.
- Ordinary mono/stereo video retains the browser’s combined native A/V output, avoiding the extra speaker latency of Web Audio routing. Surround mixes, Opus replacement and the slow-playback experiment retain their required processing paths. Safari drag seeks wait for decoded frames, tab return refreshes video surfaces, and an interrupted drag ends paused. Safari scrub preview uses native sound output to avoid silent previews and wakes its separate processing engine on each new gesture.
- Video info bars show the source audio format, channel layout/count, and sample rate when available (for example, **FLAC · 7.1 · 48 kHz**); hover for details about multiple audio tracks. [Implementation and verification](docs/audio-format-2026-09-15.md)
- Recognized MP4 inputs need one readable audio track for waveform, spectrogram, loudness and scrub audio. Multiple or unverifiable tracks keep native playback with a preparation notice; export the desired track and reload. WarpDiff does not guess which track the browser plays. [Scope and verification](docs/mp4-audio-hardening-2026-10-16/README.md)
- Sync-locked playback across all assets — with 2+ videos, **Sync** wraps at the shortest clip for frame comparison while **Full** reviews every clip to its end; clips stay aligned in Stack and Grid (on Safari, alignment is applied at pause rather than continuously — WebKit presents rate-corrected video unevenly)
- Adjacent **Playback: Sync/Solo** and **Range: Sync/Full** selectors keep the two playback policies together before the timecode
- **Solo playback** (`Shift+S`, or the playback-scope button) runs only the selected video; selecting another video hands off at the same absolute time. A shorter target holds paused on its final frame rather than wrapping, while returning to Full Sync preserves the longer timeline and range-limited Sync restarts at its shared in-point
- Frame-step with `,` and `.`
- `J`/`K` slower/faster (0.25×–2×)
- Per-source audio switching with individual mute
- Scrub preview follows the displayed frame, preserves stereo placement, and uses the same master volume as normal playback
- Master mute (`M`) that persists across loads and sessions — reviewing muted stays muted, with an amber **Muted** label and a first-play reminder
- `I`/`O` loop in/out points, Shift+drag on timeline

**Audio file comparison**
- Load 1–4 audio files (MP3, WAV, FLAC, etc.) for aligned waveform + spectrogram comparison
- Info bars show sample rate, channels, bit depth/codec, file size, and EBU R128 metrics (integrated LUFS, LRA, true peak)
- `E` cycles waveform / waveform + LUFS envelope / LUFS envelope only

**Frame gallery** (`Shift+G`)
- Capture the current frame from any slot and pin it to a scrollable gallery strip
- `{`/`}` step through captured frames — all videos seek to that timecode
- Gallery clears when new media is loaded

**Analysis**
- `Y` seamless Tile Check — inspect any loaded image in a repeated 3×3 or centered-seam Offset preview. Independent Left↔Right, Top↔Bottom, and corner ratings compare boundary color/gradient continuity with the image's normal texture; an optional heatmap pinpoints suspicious seam segments
- `Q` image wipe — first asset left and second asset right, matching Grid order; click the plate to snap the cutoff or select any loaded pair in the centered header control. The loupe and rotation follow the side under the cursor, while the scopes panel provides its own source selector
- `D` difference mode — pixel difference between any loaded pair in Stack mode; arrow keys or `Shift+D` cycle pairs. During playback the composite only updates when both videos are on the same frame, so a transient offset can't render as false motion ghosting
- `V` video scopes — histogram (RGB / RGB+luma / CDF), waveform (luma / RGB parade / overlay), and vectorscope; click each scope to cycle modes. The scopes panel always identifies its current source
- `W` audio waveform with dB color coding + spectrogram (Inferno palette by default); the shared **Fit / Ref** control switches between per-asset detail and a fixed dBFS reference scale, while encoded leading/trailing audio gaps remain aligned to the video timeline
- Scrub audio preserves intentional soundtrack offsets and leading silence from the video container
- If a video container does not expose an audio start timestamp, WarpDiff keeps playback unchanged and shows a persistent warning identifying the affected slot so you can verify A/V sync
- `Shift+W` toggle linear/log frequency, `P` cycle spectrogram palettes

**Keyboard-first**
- Every action has a hotkey — press `?` for help, `H` for all hotkeys
- Reassign any hotkey from the hotkeys panel (click a key to rebind)
- Zoom, pan, and navigate without touching the mouse
- Preferences (loupe, volume, Fit / Ref audio scaling, spectrogram settings, custom hotkeys) persist when browser storage is available. Damaged settings recover individually. If saving fails, ordinary settings still work for the current visit and a notice explains they could not be saved.

**Installable**
- Install as a standalone app from Chrome, Edge, or Safari
- Offline-capable via service worker with network-first caching

## Usage

1. Open the [live app](https://jayriddle.github.io/warpdiff/) — or install it as a PWA
2. Press **L** (or click **Load**, or drag and drop) and select 1–4 image, video, or audio files
3. Use **Stack / Grid** buttons to switch views
4. Press **H** to see all keyboard shortcuts

Manually loaded files auto-sort oldest → newest by timestamp; host loads retain the supplied order. Four-item reviews use media-aware labels—**Image-1…Image-4**, **Video-1…Video-4**, or **Audio-1…Audio-4**—and visual media opens in a 2×2 Inline grid. See [MANUAL.md](MANUAL.md) for full documentation.

---

## For Engineers

### Architecture

- **Mostly one file, no build step** — `index.html` holds all the HTML/CSS and the bulk of the JS, with cohesive subsystems extracted into classic `<script>` files under `js/`, including audio analysis, scopes, hotkeys, media demuxing/decoding, frame-accurate scrubbing, timecode, image wipe, transport, the info bar editor, and the landing animation. These are *not* ES modules — they share one global scope with the inline script, which is the only viable split given the no-build constraint. No framework, no runtime dependencies.
- **PWA** — `manifest.json` + `sw.js` provide install + offline support. Published pages pin runtime files to their commit-specific directory. Offline installation checks the entire bundle before activation; an open comparison keeps its original files through an update. `CACHE_NAME` and `APP_VERSION` remain synchronized.
- **Memory-aware rendering** — scopes and audio viz use cached typed-array buffers and `putImageData` to keep the hot path off the GC; the spectrogram bakes a 256-entry color LUT and scales contrast per clip.
- **Two test layers** — a Playwright suite (real headless Chromium) covering transport, difference and wipe modes, pan/zoom, hotkey reassignment, layouts, and audio visualization; plus a dependency-free Node harness (`npm run test:ownership`) that asserts single-owner invariants, documentation/build/version hygiene, and pure-function logic without a browser.

The reusable scrub controller and processor are pinned from WarpCap; both WarpDiff and WarpSonic use the same implementation. See [the shared scrub contract](docs/shared-scrub-audio.md) for integration, source ownership, and update checks.

### Design principles

- **No build, no runtime dependencies.** Vanilla HTML / CSS / JS in the app itself. Playwright and the other npm tools are development dependencies only.
- **Memory-aware by default.** Typed arrays for bulk data, cached buffers reused across frames, blob URLs over base64, audio downsampled for scrub but kept full-quality where sync matters.
- **Frame-accurate where it matters.** Midpoint seeking `(frame + 0.5) / fps` to avoid IEEE 754 boundary issues; epsilon-based timecode display; `requestVideoFrameCallback` for loop-point detection.
- **Native video color handling.** The video magnifier retains the native player. Scrub preview distinguishes software and NV12 output: only the measured macOS NV12/BT.709 path receives compositor compensation. Untagged files, HDR and unverified NV12 color combinations and wide-gamut NV12 output keep native seeking, which can be less responsive with sparse keyframes. Safari video Difference snapshots before RGB subtraction. The preparation tool also copies compatible full-range AVC without changing its declared color interpretation. End-to-end color accuracy is not certified; see the [reported-file follow-up](docs/scrub-handoff-2026-10-19/README.md), [earlier verification](docs/sdr-color-fixes-2026-10-19/README.md) and [initial investigation](docs/sdr-color-verification-2026-10-19/README.md).

### Going deeper

- **[Optional local preparation tool](tools/media-prepare/README.md)** — separately invokes your installed FFmpeg/ffprobe to create an AVC/stereo-AAC review copy plus a byte-bound manifest. The offline file adapter checks selected bytes and container tables before normal loading. Initial limits are 64 MiB per file; full timing/fidelity conformance remains unverified. No converter or helper is deployed with the browser app.

- **[Media input contracts and preparation adapters](docs/media-input-architecture.md)** — migration slices, versioned policy/provider interfaces and current limits. Direct loading and manual external preparation remain available; no processor is bundled.

- **[CLAUDE.md](CLAUDE.md)** — project conventions, architecture patterns, naming, and the specific technical decisions worth knowing about (frame stepping math, Stack zoom modes, equal-area grid layout, scope rendering strategy).
- **[memory.md](memory.md)** — memory-management patterns: buffer caching, audio downsampling, AudioContext lifecycle, stale-decode guards, magnifier clone handling, and GC pressure avoidance.

These are the right starting points if you want to understand how the project is structured.

### Local playback experiment

The opt-in [Signalsmith slow-playback prototype](docs/slow-playback-prototype-2026-09-22.md) is available locally at `http://localhost:8080/?slowAudio=signalsmith`. It uses the processor preferred in listening sample E. It is not enabled in the released app; the record describes scope, limits, and verification. Its small pinned MIT-licensed WASM processor is loaded only when the experiment needs it.

### Running tests

```bash
npm install
npx playwright test          # behavioral suite (headless Chromium)
npm run test:ownership       # structural + pure-logic guards (no browser)
```

The optional `npm run test:color` diagnostic generates isolated SDR references and
checks preparation, browser rendering and inspection surfaces in Chrome/WebKit.
Focused RGB-preservation regressions also run in the Chrome/WebKit release
checks. Neither suite certifies physical display accuracy or color conformance. See [commands and limits](tools/investigations/sdr-color/README.md).

Pull requests and pushes to `main` run the complete Chromium suite across three
isolated jobs, ownership/infrastructure checks, and the focused WebKit profile.
Feature branches use explicit manual dispatch before a PR, avoiding duplicate
push/PR runs. Native FFmpeg generates fixtures; it is not shipped with the app.
The Pages workflow stages only public assets and waits for successful checks before
publishing a `main` push. Staging adds commit-specific runtime URLs and integrity
checks; local development still serves the source directly with no build step.
See [release safeguards](docs/release-safeguards.md) for commands and coverage limits.


---

## Status

Actively maintained. Each release has a brief "What's New" summary. See the [archived release notes](docs/release-notes-archive.md) and commit history for details.

## Bugs & Feature Requests

Found a bug or have an idea? [Open an issue](https://github.com/jayriddle/warpdiff/issues/new/choose) — include the version and build hash shown in the top-left corner of the app (e.g. `v3.11.7 · 9873bee`) when reporting bugs; the hash identifies the exact deployed build.

## License

WarpDiff's original application code is not currently licensed for redistribution or derivative use. Reach out if you're interested in using or building on this.

The application's `UNLICENSED` package metadata reflects this policy; it is not a public-domain dedication. Third-party components retain their respective licenses and notices.

This release does not distribute an FFmpeg browser engine or wrapper. External FFmpeg installations retain their own terms. Removing the current bundle does not remove older bundles from repository history or earlier deployments; historical remediation is tracked separately.

## Contact

Jay Riddle — [GitHub](https://github.com/jayriddle)


### Managed review hosts

Hosts may request `capabilities.managedReview` for assigned comparisons. This hides standalone branding, file management and native help, retains the original Grid/Stack icons with explanatory tooltips and accessible labels, and keeps view controls, inspection icons and media details in their native toolbar positions. WarpDiff retains playback and inspection ownership; the host owns tasks and supplies display labels through `slotLabels`, including audio-source selectors. Without that capability, standalone behavior remains available.

Host loads retain the supplied file order so display labels stay with their media. Empty files, invalid converted types and initial media decoding failures report one correlated failure, clear the partial comparison, and restore the Pull control. READY waits for every image to decode, every video to supply a usable decoded frame, and audio-only files to become playable with decoded waveforms. Initial video verification has a 10-second limit and fails the batch if no frame becomes available. When necessary, a temporary muted decoder verifies the video without starting or seeking the comparison. This checks initial usability, not whole-file integrity. Superseded requests cannot reset a newer comparison. Hosts can supply base64, ArrayBuffers, byte views or byte arrays for 1–4 files.
