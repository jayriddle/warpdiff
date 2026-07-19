# Investigation handoff: Grid-mode pause "follower hop" (2026-07)

**Status:** open. Reproduced by the user on macOS Chrome; NOT reproducible in the
headless Linux CI Chromium (software decode has multi-frame display lag that
swamps the real timing). Pick this up in a **local Claude Code session on the
Mac** so you can drive real Chrome.

## Symptom (user's words)

> "I ran two videos in grid mode and on (almost?) every pause the A video is
> solid and the B video does a stutter of a frame or two to catch up."
>
> "A was the selected video. If I select B, the roles are reversed and B stops
> while A does the stepping to get to the right frame."

So: on spacebar-pause in Grid with 2 videos, the **non-selected** clip visibly
hops a frame or two to catch up while the **selected** clip freezes cleanly. The
roles track the selection. v3.12.4 (see below) did **not** change what the user
sees.

## The relevant code

- `js/transport.js` → `_snapAllVideosToFrame()` — the pause-time frame snap, sole
  caller `pauseAllMedia()`. This is the prime suspect: it seeks the follower.
- `js/transport.js` → `_driftLockTick(primary)` — holds followers on the
  reference's clock during playback via ±2% (`_DRIFT_NUDGE`) rate nudges in Grid,
  engaging at half a frame. Constants: `_DRIFT_HARD_SEEK`, `_DRIFT_RELEASE`,
  `_DRIFT_NUDGE`, `_DRIFT_NUDGE_HIDDEN`.
- The "reference" = the selected/active slot's video (`primaryVideoRef`). It is
  never snapped (it's on its own frame by definition), which is why the selected
  clip is always the solid one.

## What's already been tried (the evolution)

- **v3.11.4** added `_snapAllVideosToFrame`: on pause, seek every video to the
  reference's frame midpoint so a paused A/B pair is frame-exact. Guard was
  `|currentTime − midpoint| > 1e-4` → this re-seeked *every* clip on *every*
  pause (currentTime is ~never exactly at a midpoint).
- **v3.12.3** changed the guard to a frame-NUMBER compare
  (`floor(currentTime*fps+0.01) === refFrame` → skip). This stopped the
  *reference* from jumping (fixed the earlier "both clips jump ahead then back"
  report) but still seeked a *follower* sitting on an adjacent frame number.
- **v3.12.4** changed the guard to a clock-tolerance compare
  (`|currentTime − refTime| <= 0.5/fps` → skip). Intent: leave a follower that's
  within the drift lock's half-frame tolerance where it froze; only snap a
  follower genuinely >½ frame off. **User reports this looks identical to
  v3.12.3** — the hop is still there.

## Why v3.12.4 may not have helped — the two live hypotheses

**H1 — the follower is genuinely >½ frame off at pause on real hardware.**
Then v3.12.4's tolerance skip doesn't fire, the snap still seeks it, and it hops.
In headless *steady-state* the drift lock held the follower within ~0.06 frame,
but headless ≠ hardware. If the follower persistently sits at/over the half-frame
engage threshold on the Mac (the ±2% Grid nudge is weak and may only hold it near
the band edge), the snap keeps correcting it. **Fix direction:** tighten the Grid
drift lock (smaller engage band and/or stronger nudge) so the follower tracks the
reference tightly → same frame at pause → snap skips it. Mirror the Stack path,
which already tightens to 8 ms (`Math.min(halfFrame, 0.008)` in `_driftLockTick`).

**H2 — the hop is the decoder catching up on pause, not the snap seek at all.**
If the follower's *displayed* frame lags its `currentTime` (decode pipeline
depth), pausing may finalize/advance the presented frame independent of any seek.
Then removing the snap seek (H1's fix) won't help. **Fix direction:** different —
e.g. force a symmetric re-present of both clips on pause, or accept it.

The instrumentation below **distinguishes H1 from H2 directly.**

## What the hardware data showed (2026-07-19) — H1 confirmed, with a twist

The user ran the console instrumentation on real macOS Chrome (H.264 clips). Per
pause, the **clock drift between the two clips was 1–2 frames** (measured:
+2.27, +1.05, +1.61, +0.80, +1.16, +0.17, −0.70, −0.63, −2.18, −1.18, −0.65
frames), and the follower was **SEEKED** on almost every pause. So **H1**: the
follower really is >½ frame off at pause — the snap is correctly aligning a
genuinely-desynced pair, and that seek is the hop. (v3.12.4's ≤½-frame skip never
fires because the drift is 2–4× that.)

The twist — **the drift is a per-play-session startup offset, not steady drift.**
The sign was consistent *within* a play session and flipped *between* sessions
(B ahead by 1–2 frames in the first run, behind by 1–2 in the next). Frame numbers
show the user pausing every ~15–18 frames (~0.7 s of playback per tap). So: each
time playback starts the two `<video>`s come up **1–2 frames apart** (decoder
spin-up / `play()` start race), and the Grid drift lock's **±2 % nudge is far too
weak to close that** before a normal pause — ±2 % takes ~4 s to walk out a 2-frame
(83 ms) offset. Quick pauses (the common case in review) always catch them still
1–2 frames apart → follower seek → hop.

**This is bigger than the pause snap.** It means A/B playback itself is 1–2 frames
misaligned on this hardware for the first several seconds of every play — the
sync-lock feature isn't holding. The pause hop is just the visible symptom.

## Fix direction (revised)

Target the **convergence speed**, not the snap. The snap is doing its job. Make
the Grid drift lock actually pull a startup offset closed fast enough that a
sub-second pause lands aligned. Candidates (need on-Mac iteration — the harness is
the loop):

1. **Stronger Grid nudge.** Non-active Grid slots are muted, so a bigger rate trim
   is inaudible and, for <1 s of startup motion, barely visible. Try Grid at the
   Stack strength (`_DRIFT_NUDGE_HIDDEN`, ±10 %) instead of `_DRIFT_NUDGE` (±2 %) —
   ±10 % closes a 2-frame offset in ~0.8 s. Watch for a visible speed wobble on
   the on-screen follower; back off if perceptible.
2. **Prime the alignment at play start.** In `playAllMedia`, after starting, seek
   the followers onto the reference once the clocks are readable (a single
   converge-seek) so they don't spend seconds walking a startup offset closed.
   Risk: a visible correction right at play start (but motion masks it, and it's
   once per play, not the recurring pause hop).
3. **Faster engage / lower `_DRIFT_HARD_SEEK` for Grid** — risky (the 40 ms
   hidden-seek dead-end + seek-storm history in the `_driftLockTick` comments);
   read those before touching it.

Measure each candidate with the harness: the drift at pause should collapse toward
0, and `SEEKED` should stop appearing. Verify the on-screen follower shows no
speed wobble during the first second of playback. Then re-check the sync-lock
Playwright suite and ownership guard H/K.

## The decisive experiment

Run `tests/investigate-pause-hop.mjs` in **real macOS Chrome** (it launches
`channel: 'chrome'`, headed). It loads the actual app with two clips, plays,
pauses repeatedly (with A selected, then B selected), and logs per pause:

- each clip's frame before the snap, and whether the snap **SEEKED** it (→ which
  frame),
- the clock drift between the clips in frames,
- each clip's **presented** frame for ~150 ms after pause (via
  `requestVideoFrameCallback`) — i.e. whether the displayed frame *catches up*.

Read the output:

- **Follower shows `SEEKED`** → **H1**. The follower was >½ frame off. Tighten the
  Grid drift lock (and/or widen nothing — the snap is correctly firing; the real
  bug is the follower drifting that far). Re-measure drift; if it's persistently
  ~½ frame, the ±2% nudge is too weak / engages too late.
- **Follower says `(kept)` but its presented frame still advances after pause** →
  **H2**. The hop is decode-pipeline catch-up, unrelated to the snap. The snap
  fix line is a dead end; pursue symmetric re-present or accept.
- **Follower `(kept)` and presented frame is stable** → the fix already works on
  hardware and something else is going on (stale service-worker cache? confirm the
  live `js/transport.js` actually contains the v3.12.4 tolerance guard —
  `grep "0.5 / fps" js/transport.js`; hard-reload to bust the PWA cache).

## How to run it

```bash
# In the repo on the Mac, on branch claude/synced-video-looping-gtn4qg (v3.12.4+):
npm install                       # Playwright (only if not already installed)
node tests/investigate-pause-hop.mjs                 # uses the repo H.264 fixtures
# or point it at two of your OWN videos (most representative):
node tests/investigate-pause-hop.mjs /path/to/a.mp4 /path/to/b.mp4
```

It needs the repo's `tests/fixtures/landscape_a.mp4` / `landscape_b.mp4` (auto-
generated by `tests/fixtures/generate.sh` if `ffmpeg` is on PATH) unless you pass
your own file paths. Real Chrome decodes H.264, so the fixtures are fine.

## Notes / gotchas

- The PWA service worker caches `js/transport.js` separately from `index.html`.
  The version badge reads `APP_VERSION` from `index.html`, so it can show a new
  version while an *older* `transport.js` is still served from cache. Always
  hard-reload (Cmd+Shift+R) and, if in doubt, confirm the served file:
  `curl -s http://localhost:8080/js/transport.js | grep '0.5 / fps'`.
- Don't trust headless timing for this bug — it has software-decode display lag of
  several frames. Only real Chrome (hardware decode) is representative.
- Ownership guard **K** (`tests/ownership.test.mjs`) freezes the current snap
  behavior; update it if the fix changes the guard.
