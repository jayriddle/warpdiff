# Mobile adaptation — strategic assessment (2026-07)

**Status:** assessment / not yet scheduled. No implementation has started. This documents
*what adapting WarpDiff to mobile would take*, the blockers, and a recommended direction, so a
future effort can start from a shared map instead of re-deriving it.

**Framing chosen for this pass:** **tablets first** (iPad / Android tablets — roomy touch screens,
closest to the current layout, materially higher hardware-decoder ceilings than phones);
video handled via a **WebCodecs → canvas compositor**; optimized for **quick review / viewing**
(load, compare, scrub, loop, diff) rather than full desktop analysis parity. Phones and full
analysis parity are explicitly out of scope for *this* assessment (harder constraints; revisit
once the tablet path is proven).

## Where WarpDiff already meets mobile halfway

- **The media stage is resolution-independent and portrait/tablet-viable already.** Stack mode's
  `applyZoom()` fits each asset to the live viewport; Grid mode uses proportional CSS grids plus an
  **area-maximizing axis chooser** (`pickBestGridLayout`) that already prefers vertical stacking on
  tall/narrow screens. The layout *math* does not assume landscape.
- **It's an installable PWA today**: `<meta viewport>` present, `manifest.json` (standalone,
  192/512 icons), `apple-touch-icon`, registered service worker.
- **WebCodecs paths are already defensively coded** — `js/scrub-video.js` feature-gates
  `VideoDecoder`, calls `isConfigSupported()`, refuses HDR, and Safari falls back to native
  `<video>` seeking. This is the foundation the canvas compositor would build on.

## Blockers, ranked

1. **Simultaneous video decode — the core structural blocker.** The whole premise is 2–3 live
   `<video>` elements playing at once (`getAllVideos` / `playAllMedia` in `js/transport.js`), the
   diff composite reads two playing videos per frame (`drawImage(mediaA)` + `drawImage(mediaB,
   'difference')`), the magnifier spawns *clone* `<video>` elements that also play, and Grid scrub
   spins up a `VideoDecoder` per visible slot. There is **no decoder-count detection or cap
   anywhere**. iOS/iPadOS Safari caps concurrent hardware decode pipelines; tablet-first raises the
   ceiling but does not remove it. This is why the canvas-compositor strategy is the right
   *structural* answer, not a nice-to-have.
2. **Input model is ~entirely keyboard + mouse.** Only 3 touch listeners exist (the minimap); zero
   `pointer*`, zero pinch/wheel/gesture handling. Scrub, pan, loop-marker drag, and Shift+drag
   region-select are all `mouse*`-only (`index.html` ~7591–7860; pan ~8620–8710). Roughly half the
   core actions (frame-step, zoom, loop points, diff, speed, magnifier) are **keyboard-only with no
   on-screen control**, and several use symbol keys (`,` `.` `+` `[` `]` `\`) soft keyboards can't
   produce.
3. **Hover-driven magnifier.** The loupe is literally "wherever the pointer hovers" (global
   `mousemove` → `updateMagnifier`, `index.html` ~3740–3838). Touch has no persistent hover.
4. **No responsive chrome.** **Zero `@media` queries.** Every panel/popup/toolbar is fixed-pixel
   desktop (272–600px widths; 160/219/500px panel heights), hit targets are mouse-sized (8px scrub
   bar, 9–11px type), toasts use `nowrap`. The chrome — not the media canvas — is what breaks.
5. **Autoplay / AudioContext gesture unlock is absent.** Mobile rejects programmatic `play()` and
   suspends `AudioContext` until a user gesture; the code has no first-tap resume/retry and swallows
   `play()` rejections silently — playback and Web-Audio scrub/Opus sync would fail quietly.
6. **Memory & capability budgeting sized for desktop.** The scrub decoded-frame cache is **96 MB per
   slot** (`js/scrub-video.js`; up to ~288 MB across a 3-up Grid), the diff canvas is allocated at
   native resolution (~33 MB at 4K), and there are **no** `deviceMemory` / `hardwareConcurrency` /
   `pointer:coarse` checks. ffmpeg.wasm (~24 MB, single-threaded) loads with no capability gate.

## Recommended direction — six workstreams

Roughly in dependency order. Effort/risk noted; this is a map, not a task list.

1. **Responsive chrome layer** *(low risk, high payoff)* — breakpoints/container queries, 44px touch
   targets, safe-area insets (`viewport-fit=cover`), fluid popups, and collapse the desktop side
   panels (scopes / audio-viz / shortcuts) into bottom sheets or tabs. The media canvas already
   adapts, so this is mostly CSS + panel restructuring.
2. **Pointer-events input layer** *(medium; the backbone)* — migrate the `mouse*`
   scrub/pan/loop-drag/region-select block to **Pointer Events** so mouse, touch, and pen share one
   path, then add touch affordances: drag-scrub on an enlarged bar, drag-to-pan, **pinch-to-zoom**
   (new), double-tap-to-fit. Everything downstream depends on this.
3. **On-screen controls for keyboard-only actions** *(low–medium)* — surface frame-step `‹ ›`, zoom
   `+ / − / fit`, loop in/out, diff toggle, and speed as buttons. The existing toolbar already
   covers ~half; extend it rather than inventing a new system.
4. **Video via the canvas compositor** *(high; the crux)* — decode each stream with `VideoDecoder`
   and present through canvas from a **managed decoder pool**, so live decode pipelines are bounded
   rather than equal to the number of `<video>` elements. This **reuses `js/scrub-video.js`'s demux +
   decoder-session + paint + cache-budget machinery** (already built, HDR-guarded) and is the same
   engine previously discussed for frame-lock — mobile makes it load-bearing rather than optional. It
   also incidentally fixes the `<video>`-vs-canvas color-treatment issue. **Graceful fallback**: where
   WebCodecs/canvas isn't viable, degrade to 1 live `<video>` + synced paused-frame/frame-step A/B.
5. **Memory & capability budgeting** *(medium)* — gate on `deviceMemory` / `hardwareConcurrency`,
   scale the scrub cache and diff-canvas resolution down on constrained devices, prefer 2-up over
   3-up on small screens, lazy/skip ffmpeg.wasm on low-memory tablets, switch input mode via
   `matchMedia('(pointer:coarse)')`.
6. **Autoplay / audio gesture unlock** *(small but essential)* — first-gesture `AudioContext.resume`
   plus gesture-gated `play()` retry.

**Magnifier:** for a viewing-focused tablet MVP, either replace hover with **long-press-drag**
(touch-and-hold to summon, drag to move) or defer it — it's an analysis feature, lower priority for
"quick review."

**Suggested MVP boundary (tablet, viewing):** workstreams 1–3 + 6 make it genuinely usable
(responsive, touch, on-screen transport, audio playback) with video on the fallback path; workstream
4 (compositor) is the follow-on that restores true simultaneous A/B video; workstream 5 runs
alongside. Defer full scopes/EBU parity, hotkey-reassignment UI, and ffmpeg transcode.

## Open questions to resolve before committing to implementation

- **The real iPad decoder ceiling** — Safari doesn't document it; needs on-device measurement. Drives
  how aggressive workstream 4 must be and whether the fallback is ever needed on tablets.
- **WebCodecs coverage** across the iPadOS Safari versions we intend to support.
- **Does the viewing use case need the magnifier at all** on tablet, or can it be deferred entirely?
- **3-up on tablet portrait** — worth supporting, or cap mobile at 2-up?

## Validation experiments (do these before writing an implementation plan)

Cheap to build, decisive for scoping:

1. **Decoder-ceiling probe** — a throwaway page that incrementally creates N playing `<video>` and N
   `VideoDecoder` instances on the target tablets until decode fails, to find the real simultaneous
   limit (informs workstream 4 vs. the fallback).
2. **WebCodecs support matrix** — check `VideoDecoder` / `isConfigSupported` for H.264/HEVC on the
   target OS versions.
3. **Memory headroom** — load a representative 3-up 1080p session and watch for tab reloads / jank to
   size the cache and diff-canvas caps in workstream 5.
4. **Touch layout smoke test** — drop the current build on a tablet, confirm the media canvas adapts
   as predicted, and catalog exactly which controls are unreachable without a keyboard.

Once these four are answered, this assessment can be turned into a concrete, staged implementation
plan.

## Key files referenced

- `index.html` — the `mouse*` scrub/loop/region block (~7591–7860), pan handlers (~8620–8710),
  magnifier (~3740–3838), `applyZoom` / grid chooser (`pickBestGridLayout`), toolbar (~2627–2837),
  and the all-in-one `<style>` block (no `@media`).
- `js/scrub-video.js` — the WebCodecs demux/decode/paint/cache engine the canvas compositor
  (workstream 4) would extend from a request-driven scrubber into a playback surface.
- `js/transport.js` — `getAllVideos` / `playAllMedia`, the multi-video sync/loop cluster.
- `manifest.json` / `sw.js` — PWA surface (add maskable icon, consider orientation, safe-area).
- `memory.md` — existing buffer-budget patterns to tighten for constrained devices.
