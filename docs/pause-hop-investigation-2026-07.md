# Grid-mode pause "follower hop" — RESOLVED (2026-07-18, v3.12.5)

**Status: closed.** Root cause found, fixed, and measured on real macOS Chrome.
Kept as a record because two earlier releases fixed the wrong thing, and because
the measurement setup is what finally separated cause from symptom.

## Symptom (user's words)

> "I ran two videos in grid mode and on (almost?) every pause the A video is
> solid and the B video does a stutter of a frame or two to catch up."
>
> "A was the selected video. If I select B, the roles are reversed and B stops
> while A does the stepping to get to the right frame."

## Root cause

**Two `<video>`s told to play together come up 1–2 frames apart, every time.**
It's a decoder start race, not drift: on real hardware the offset builds to
35–50 ms within the first ~200 ms of playback and then just sits there. The sign
is stable within a play session and flips between sessions (whichever element
wins the race leads).

Grid's drift lock corrected that with a flat ±2 % rate trim, which needs **~1.5 s**
to walk 45 ms out (measured: converged at 1494 ms and 1643 ms). A review pause
typically lands **~0.7 s** in — while the pair is still 30–40 ms apart, i.e. more
than the half-frame tolerance. So `_snapAllVideosToFrame` correctly seeked the
follower onto the reference's frame, and **that seek is the hop.** The reference
is never seeked, which is exactly why the hop was asymmetric and tracked the
selection.

So the pause snap was never the bug — it was doing its job on a genuinely
desynced pair. **The pair should not have been desynced 0.7 s into playback.**

## The fix (v3.12.5)

1. **Proportional Grid trim** (`js/transport.js`, `_driftLockTick`):
   `trim = clamp(mag / _DRIFT_CONVERGE_TAU, _DRIFT_NUDGE, _DRIFT_NUDGE_MAX)`
   — tau 0.4 s, floor ±2 %, cap ±12 %. A full-frame gap now closes in ~0.3 s
   instead of ~1.5 s; small steady-state errors still get the old gentle ±2 %.
   Stack is unchanged (flat ±10 %, hidden + muted).
2. **fps detection accumulates across play sessions** (`_setupFpsDetection`):
   it needed `_FPS_SAMPLE_COUNT` frames (~1.3 s at 24 fps) *in one continuous
   play* and reset on every `'play'`, so short-tap reviewing never completed a
   pass and the clip stayed pinned to the **30 fps default**. On a 24 fps clip
   that fed the wrong grid to the snap's `(frame + 0.5) / fps` quantization
   (defeating the midpoint-seek protection) and the wrong half-frame band to the
   drift lock. Samples now carry across sessions; `'play'`/`'seeking'` drop the
   run anchor (`lastTs`) so a boundary never contributes a bogus interval.

### Measured result (real Chrome, 1080p H.264, 700 ms pause cadence)

| | before | after |
|---|---|---|
| pauses that seeked a follower | 6/10 | **0/10** |
| mean \|drift\| at pause | 0.63 frames | **0.28 frames** |
| max \|drift\| at pause | 1.22 frames | 0.45 frames |
| time to converge <½ frame | ~1500 ms | **~520 ms** |

No frame-pacing cost: with a 12 % trim active, the follower's presented-frame
cadence is indistinguishable from the untouched primary's (clean run: both a flat
41.67 ms at 24 fps; loaded runs drop frames equally on both).

## Why the first two attempts missed it

Both went after the snap, which is downstream of the actual problem:

- **v3.11.4** added `_snapAllVideosToFrame` with a `|currentTime − midpoint| > 1e-4`
  guard → re-seeked *every* clip on *every* pause.
- **v3.12.3** switched to a frame-NUMBER compare → stopped seeking the reference,
  still seeked a follower on an adjacent frame.
- **v3.12.4** switched to a clock-tolerance compare (`≤ 0.5/fps` → skip) → correct,
  and verified working, but the follower was genuinely **>½ frame off**, so the
  skip never fired. User reported no change, which was accurate.

## Measurement gotchas (this is what cost the time)

The earlier round of instrumentation produced confidently wrong conclusions.
Three traps, all of which the harness now avoids:

1. **Don't bracket `pauseAllMedia` to detect a snap seek.** Sampling
   `currentTime` before it reads a *still-running* clock, so ordinary playback
   advance during the `pause()` calls looks like a seek. This reported "SEEKED on
   10/10 pauses" on a build where the snap seeked **nothing**. Hook
   `_snapAllVideosToFrame` itself — every element is already paused inside it, so
   any delta there is a real seek.
2. **Don't read `videoFrameRates` once at load.** Detection resolves only after a
   playback pass, so an early read is still the 30 default and every frame number
   derived from it is wrong by 25 % on a 24 fps clip. Read it live at the point of
   use.
3. **The repo H.264 fixtures cannot reproduce this.** `landscape_a/b` are
   960×540 at ~12 kbps (44 KB for 3 s) — far too trivial to decode to produce a
   decode-start race. They measure a clean 0.14-frame drift and 0/10 seeks on a
   *broken* build. Reproduce with realistic media (1080p, tens of Mbps, long GOP);
   generate a pair with `ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24 ... -b:v 20M -g 48`.
   Also note the 3 s/4 s fixture pair defaults `_loopRangeMode` to `'full'`, whose
   tail (short clip frozen on its last frame) reads as 8–24 frames of fake drift —
   the harness now seeks to 0 before each cycle to stay clear of it.

Headless Chromium remains unrepresentative (software decode has multi-frame
display lag that swamps the real timing). Use `channel: 'chrome'`, headed.

## Follow-up: frame stepping and the fps matrix (same release)

Prompted by the observation that real material runs 24 / 25 / 29.97 / 30 fps and
5–50 s, and that stepping with `,` / `.` has to hold sync too. It doesn't go
through any of the machinery above — **the drift lock only runs while playing and
the pause snap only runs from `pauseAllMedia`** — so stepping was on its own.

`stepFrame` advanced each video by one of *its own* frames from *its own* clock.
Measured on a 24/30 pair: **8.3 ms of divergence per step, 204 ms (~5 frames)
after 24 taps**, never corrected. Its per-clip `% totalFrames` wrap was the same
bug at the loop point — clips of different lengths wrapped at their own ends onto
unrelated content (measured 2.9 s apart). Now reference-driven, sharing the
`_syncReferenceVideo` owner with the pause snap.

Full matrix after the fix (`tests/investigate-step-sync.mjs`, real Chrome, 1080p):

| pair | max step drift (24 fwd + 24 back) | long-run drift |
|---|---|---|
| matched 24/24, 25/25, 29.97/29.97, 30/30 | 0.00 ms | 3.5–19.2 ms |
| MIXED 24/30 | 12.50 ms | 17.5 ms |
| MIXED 25/30 | 16.67 ms | 5.0 ms |
| MIXED 29.97/30 | 1.82 ms | 9.9 ms |
| MIXED 24/29.97 | 14.45 ms | 11.0 ms |
| long 50 s 24/24 and 24/30 | 0.00 / 12.50 ms | 3.3 / 8.5 ms |

All within half a frame; round trips return to the exact starting frame on all
ten pairs. Long (50 s) playback shows **no accumulation** — drift stays where the
lock holds it, so duration is not a factor.

Two measurement notes for anyone re-running this:

- **Compare round trips by frame NUMBER, not time.** Stepping deliberately lands
  on the frame midpoint, so returning to the same frame from an arbitrary start
  time legitimately moves `currentTime` by up to half a frame. Assigning the same
  `currentTime` to two clips also does not put them on corresponding frames when
  the rates differ (t=1.0 starts frame 30 at 30 fps but sits inside frame 29 at
  29.97) — take the baseline *through* the alignment path, or you will chase a
  phantom one-frame error.
- **Wait for fps detection to actually resolve** (it logs `[fps] <slot>: …`).
  Until it does, every clip is on the 30 fps default, a mixed-fps pair is treated
  as matched, and the bug cannot appear — a test that skips this silently passes.
  Under two 1080p decoders in a headed browser this took several seconds.

**Known remaining weakness:** fps detection is passive, so a clip is on the wrong
grid until enough frames have been *presented*. For MP4 the container already has
the answer — `_demuxMP4Video` (`js/mp4-demux.js`) parses `stts`, which gives exact
frame durations at load with no playback. Seeding `videoFrameRates` from there
(falling back to the RVFC observation for WebM and for files that aren't demuxed)
would remove the warm-up window entirely. Not done here — it touches the scrub
demuxer's lifecycle — but it is the right fix if this bites again.

## Follow-up: transport controls, scrubbing, switching, 4K (same release)

`tests/investigate-transport-sync.mjs`. All measured in real Chrome at both
1920×1080 and 3840×2160 (up-res review compares at those sizes). **No fixes
needed — all of this already held.** Recorded so the next change here has a
baseline.

- **Playback rate (J/K, 0.25×–2×).** All five rates end a pause within half a
  frame, at both resolutions. Worth knowing *why*, because the naive reading of
  the trim looks alarming: the trim is a fraction of the base rate, so its
  convergence time is `TAU/base` — 0.4 s at 1× but **1.6 s at 0.25×**. That is
  real, and harmless, because the startup offset scales with rate too (measured
  peak |drift| 2.5 / 3.7 / 13.3 / 23.7 / 23.3 ms at 0.25 / 0.5 / 1 / 1.5 / 2×).
  At slow rates there is barely an offset to close; at fast rates convergence is
  proportionally quicker. **Don't "fix" the slow-rate convergence time in
  isolation** — the two effects cancel, and a rate-independent trim would make
  the fast rates overshoot.
- **Scrubbing forward and backward.** Exact: 0.00 ms drift and identical frame
  numbers on every drag (20→75 %, 75→15 %, 15→90 %, 90→5 %), at both
  resolutions. This holds because the scrub seeks every follower to the same raw
  target time (`pct * seekDur`) with no per-clip frame quantization, so there is
  nothing for the clips to disagree about — worth remembering before adding
  quantization to that path. Scrubbing *while playing* pauses on mousedown,
  resumes on mouseup, and settles to ~2–6 ms.
- **Mid-playback asset switching** (the Stack seamless-switch path, historically
  the source of the "switch drags the cluster backward" bug): drift stays
  0.05–3.8 ms across six back-and-forth switches, and the clock advances
  monotonically — no backward jump.
- **Zoomed switching**, the real up-res workflow (zoom into a detail, then A/B):
  holds at 2.5× on 4K (≈6× fit, ~2.5:1 native pixels) — drift 0.55–1.29 ms across
  six switches while playing.
- **4K is not worse than 1080p** on this hardware; decode is GPU-accelerated, so
  resolution is not the variable that stresses sync. *Bitrate and decode cost*
  are — the 122 Mbps clip used early in this investigation dropped ~40 % of
  frames on both clips, while 4K at 48 Mbps played clean.

## The harness

`tests/investigate-pause-hop.mjs` — drives real Chrome, loads two clips, and per
play/pause cycle reports the drift-vs-time curve from play start (with the
follower's `playbackRate`, so you can watch the trim engage and decay), the
convergence time, each clip's frame at pause and whether the snap seeked it, and
each clip's presented frame for ~250 ms after pause.

```bash
node tests/investigate-pause-hop.mjs                          # repo fixtures (too easy — see trap 3)
node tests/investigate-pause-hop.mjs /path/a.mp4 /path/b.mp4  # realistic media
DWELL=2500 node tests/investigate-pause-hop.mjs ...           # long dwell: watch full convergence
```

`tests/investigate-step-sync.mjs` covers the paused path: frame stepping and
long-run drift over a fps matrix (matched and mixed 24 / 25 / 29.97 / 30, 10 s and
50 s). Point it at a directory of fixtures named `f24_a.mp4`, `f30_b.mp4`,
`f2997_a.mp4`, `f24_50s_a.mp4`, … (see `PAIRS` in the file):

```bash
node tests/investigate-step-sync.mjs /path/to/fixture/dir
```

## If something like this resurfaces

Check convergence **during playback** before touching the pause path. If the
drift curve plateaus above half a frame for longer than a typical pause, the lock
is too slow — that's the bug, and the snap seek is just where it becomes visible.
Ownership guards **H** (sync-lock / drift lock) and **K** (pause snap) freeze the
current behavior; the `_driftLockTick` unit tests pull the `_DRIFT_*` constants by
name, so a new constant must be added to that list in `tests/ownership.test.mjs`.
