#!/usr/bin/env node
/*
 * WarpDiff ownership + logic harness — dependency-free, no browser, no toolchain.
 * Run:  node tests/ownership.test.mjs   (or: npm run test:ownership)
 *
 * Modeled on WarpCap's tests/logic.test.mjs. Two kinds of check:
 *
 *   1. SINGLE-OWNER GUARDS — freeze the competing-owner fixes from the 2026-06-27
 *      multi-owner audit (findings A–E). Each asserts that a stateful concern has
 *      exactly ONE owner and that the guard wiring is present, so a future edit
 *      can't silently reintroduce a duplicate handler / parallel loop / stale write.
 *
 *   2. FUNCTIONAL UNIT TESTS — pull a pure function straight out of the shipped
 *      source via extractFn() and exercise it. Tracks the shipped code (no copy).
 *
 * Sources are read CONCATENATED (index.html + every js/*.js) so the harness keeps
 * resolving a function wherever it lives after a future extraction into js/.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// ── source load (concatenated, extraction-proof) ──────────────────────────────
const ROOT = new URL('../', import.meta.url);
const HTML = readFileSync(new URL('index.html', ROOT), 'utf8');
const JS_FILES = readdirSync(new URL('js/', ROOT)).filter(f => f.endsWith('.js'));
const SRC = [HTML, ...JS_FILES.map(f => readFileSync(new URL('js/' + f, ROOT), 'utf8'))].join('\n\n');

// ── tiny assert framework ─────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// ── helpers ───────────────────────────────────────────────────────────────────
const countOf = (s, sub) => s.split(sub).length - 1;

// Pull a `function NAME(...) { ... }` body out of SRC by brace-balancing. Matches
// `async function` too (the regex anchors on `function`, the leading `async` is
// just omitted from the returned text — fine for substring checks).
function extractFn(name, src = SRC) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  const open = src.indexOf('{', m.index);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(m.index, k + 1); }
  }
  throw new Error('unbalanced braces in: ' + name);
}

// ══════════════════════════════════════════════════════════════════════════════
// 0. Inline <script> syntax parse (ci-check style) — a syntax error here would
//    silently break the whole app at runtime; fail fast instead.
// ══════════════════════════════════════════════════════════════════════════════
{
  const blocks = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  let parsed = 0;
  for (const [i, b] of blocks.entries()) {
    try { new Function(b[1]); parsed++; }
    catch (e) { check(`inline <script> block #${i + 1} parses (${e.message})`, false); }
  }
  check(`inline <script>: ${parsed}/${blocks.length} blocks parse`, parsed === blocks.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// 0b. BUILD / VERSION HYGIENE — footguns CLAUDE.md calls out; cheap to gate.
// ══════════════════════════════════════════════════════════════════════════════
{
  const SW = readFileSync(new URL('sw.js', ROOT), 'utf8');
  const appVer = (HTML.match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const cacheVer = (SW.match(/const CACHE_NAME = 'warpdiff-v([^']+)'/) || [])[1];
  check(`version-sync: APP_VERSION (${appVer}) === sw.js CACHE_NAME (${cacheVer})`,
        appVer && cacheVer && appVer === cacheVer);

  // README's "Current version:" line must track APP_VERSION — it lives outside
  // the app so nothing else catches it, and it silently rotted 9 versions behind
  // before this guard existed. Part of the release checklist in CLAUDE.md.
  const README = readFileSync(new URL('README.md', ROOT), 'utf8');
  const readmeVer = (README.match(/\*\*Current version:\*\*\s*([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1];
  check(`version-sync: README Current version (${readmeVer}) === APP_VERSION (${appVer})`,
        readmeVer && appVer && readmeVer === appVer);

  // Every js/*.js the page loads must be in the SW precache, or offline PWA breaks.
  const loaded = [...HTML.matchAll(/<script src="(js\/[^"]+\.js)"/g)].map(m => m[1]);
  const missing = loaded.filter(src => !SW.includes(`'${src}'`));
  check(`sw-assets: all ${loaded.length} <script src=js/*> are in sw.js ASSETS` +
        (missing.length ? ` (missing: ${missing.join(', ')})` : ''),
        missing.length === 0);

  // version.json: the deployed-commit-hash mechanism. The file must carry
  // Jekyll front matter and the build_revision Liquid tag (GitHub Pages
  // substitutes the served SHA at deploy time — the only way to identify the
  // served build with no local build step), the app must fetch it, and it must
  // be SW-precached so the hash shows offline too. NOTE: a .nojekyll file
  // appearing in the repo root would silently kill the substitution.
  const VJ = readFileSync(new URL('version.json', ROOT), 'utf8');
  check('version-hash: version.json has Jekyll front matter + build_revision tag',
        VJ.startsWith('---') && VJ.includes('{{ site.github.build_revision }}'));
  check('version-hash: index.html fetches version.json and appends the short SHA',
        HTML.includes("fetch('version.json')") && HTML.includes('j.sha.slice(0, 7)'));
  check('version-hash: version.json is in sw.js ASSETS',
        SW.includes("'version.json'"));
  check('version-hash: no .nojekyll (it would disable the Pages-side substitution)',
        !existsSync(new URL('.nojekyll', ROOT)));

  // _config.yml must keep .md files out of the Pages build: themed .md pages
  // pull {% seo %} → jekyll-github-metadata → a GitHub API call at build time,
  // which fails the WHOLE deploy whenever api.github.com hiccups (observed
  // 2026-07-16: two deploys died on 503s rendering CLAUDE.md).
  const CFG = readFileSync(new URL('_config.yml', ROOT), 'utf8');
  check('pages-build: _config.yml excludes *.md (deploys must not depend on the GitHub API)',
        CFG.includes('exclude:') && CFG.includes('"*.md"'));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. SINGLE-OWNER GUARDS (multi-owner audit 2026-06-27, findings A–E)
// ══════════════════════════════════════════════════════════════════════════════

// (A) RVFC loop chain: _startLoopRvfc is the sole owner, and the per-video
//     _loopRvfcActive flag prevents a pause→play cycle from stacking parallel
//     seek-back chains (the loop-wrap stutter/audio-glitch bug).
{
  check(`one-owner[rvfc]: _startLoopRvfc defined once (got ${countOf(SRC, 'function _startLoopRvfc(')})`,
        countOf(SRC, 'function _startLoopRvfc(') === 1);
  const b = extractFn('_startLoopRvfc');
  check('one-owner[rvfc]: idempotency guard present (if video._loopRvfcActive return)',
        b.includes('if (video._loopRvfcActive) return;'));
  check('one-owner[rvfc]: claims ownership (video._loopRvfcActive = true)',
        b.includes('video._loopRvfcActive = true;'));
  check('one-owner[rvfc]: releases ownership on terminate (video._loopRvfcActive = false)',
        b.includes('video._loopRvfcActive = false;'));
  check(`one-owner[rvfc]: _loopRvfcActive used ONLY inside _startLoopRvfc (got ${countOf(SRC, '_loopRvfcActive')})`,
        countOf(SRC, '_loopRvfcActive') === 3);
  check(`one-owner[rvfc]: exactly one chain per video — 3 onFrame registrations in the body (got ${countOf(b, 'requestVideoFrameCallback(onFrame)')})`,
        countOf(b, 'requestVideoFrameCallback(onFrame)') === 3);
}

// (B) Video handler binding: setupVideoHandlers binds the play/pause/ended/seeked
//     listeners once, guarded by video._handlersBound — so the post-transcode
//     video.load() (which re-fires loadedmetadata) can't attach a second set.
{
  check(`one-owner[handlers]: setupVideoHandlers defined once (got ${countOf(SRC, 'function setupVideoHandlers(')})`,
        countOf(SRC, 'function setupVideoHandlers(') === 1);
  const b = extractFn('setupVideoHandlers');
  check('one-owner[handlers]: idempotency guard present (if video._handlersBound return)',
        b.includes('if (video._handlersBound) return;'));
  check('one-owner[handlers]: claims binding (video._handlersBound = true)',
        b.includes('video._handlersBound = true;'));
  check(`one-owner[handlers]: _handlersBound used ONLY in setupVideoHandlers (got ${countOf(SRC, 'video._handlersBound')})`,
        countOf(SRC, 'video._handlersBound') === 2);
  check('one-owner[handlers]: guard runs BEFORE any listener is attached',
        b.indexOf('_handlersBound') < b.indexOf("addEventListener('play'"));
}

// (C) Video-audio decode completion is generation-guarded: a reload/clear during
//     the async decode chain must not let a stale completion overwrite the new
//     slot's viz/metrics or mute the new video.
{
  check(`one-owner[decode-gen]: _finalizeAudioViz defined once (got ${countOf(SRC, 'function _finalizeAudioViz(')})`,
        countOf(SRC, 'function _finalizeAudioViz(') === 1);
  const fin = extractFn('_finalizeAudioViz');
  check('one-owner[decode-gen]: _finalizeAudioViz bails on stale generation',
        fin.includes('_videoAudioDecodeGen[slot] !== gen'));
  const viz = extractFn('decodeAndComputeAudioViz');
  check('one-owner[decode-gen]: decodeAndComputeAudioViz bumps _videoAudioDecodeGen at entry',
        viz.includes('_videoAudioDecodeGen[slot] = (_videoAudioDecodeGen[slot] || 0) + 1'));
}

// (E) The two audio decoders own SEPARATE generation counters. For audio-only
//     slots BOTH decoders run (SlotViz at load + Viz lazily via the W-panel); a
//     shared counter let one bump invalidate the other's in-flight completion
//     (the sr/channels-vanish regression). They must not cross-reference.
{
  const fin = extractFn('_finalizeAudioViz');
  const slot = extractFn('decodeAndComputeAudioSlotViz');
  check('one-owner[gen-split]: _finalizeAudioViz uses ONLY the video counter (no _audioDecodeGen)',
        !fin.includes('_audioDecodeGen'));
  check('one-owner[gen-split]: decodeAndComputeAudioSlotViz uses ONLY the audio-only counter',
        slot.includes('_audioDecodeGen[slot]') && !slot.includes('_videoAudioDecodeGen'));
  check('one-owner[gen-split]: both counters reset on clearAllMedia',
        SRC.includes('_audioDecodeGen = {}') && SRC.includes('_videoAudioDecodeGen = {}'));
}

// (D) Opus-sync (re)start has a single owner. Both transports (playAllMedia and
//     restartAllVideos) route through _startOpusSyncForPlayingSlots instead of
//     each running their own loop — restartAllVideos previously omitted it,
//     orphaning Opus audio on the R key.
{
  check(`one-owner[opus-start]: _startOpusSyncForPlayingSlots defined once (got ${countOf(SRC, 'function _startOpusSyncForPlayingSlots(')})`,
        countOf(SRC, 'function _startOpusSyncForPlayingSlots(') === 1);
  check(`one-owner[opus-start]: exactly 2 call sites + 1 def = 3 references (got ${countOf(SRC, '_startOpusSyncForPlayingSlots(')})`,
        countOf(SRC, '_startOpusSyncForPlayingSlots(') === 3);
  const owner = extractFn('_startOpusSyncForPlayingSlots');
  check('one-owner[opus-start]: the owner is the one that calls _startOpusSyncAudio',
        owner.includes('_startOpusSyncAudio('));
  for (const fn of ['playAllMedia', 'restartAllVideos']) {
    const b = extractFn(fn);
    check(`one-owner[opus-start]: ${fn} delegates to the owner (no inline _startOpusSyncAudio)`,
          b.includes('_startOpusSyncForPlayingSlots(') && !b.includes('_startOpusSyncAudio('));
  }
}

// (F) Decode pipeline ownership: each decode function has exactly one definition,
//     _onAllDecodeFailed is the sole decode-failure → transcode router, and the
//     pipeline lives in js/audio-decode.js (index.html keeps only pointers + call
//     sites). Locks in the step-3 extraction.
{
  for (const fn of ['decodeAndComputeAudioViz', 'decodeAndComputeAudioSlotViz',
                    '_decodeAudioWebCodecs', '_decodeWithAudioDecoder',
                    '_finalizeAudioViz', '_onAllDecodeFailed']) {
    check(`one-owner[decode]: ${fn} defined once (got ${countOf(SRC, 'function ' + fn + '(')})`,
          countOf(SRC, 'function ' + fn + '(') === 1);
  }
  const adjs = JS_FILES.includes('audio-decode.js')
    ? readFileSync(new URL('js/audio-decode.js', ROOT), 'utf8') : '';
  check('one-owner[decode]: pipeline lives in js/audio-decode.js',
        adjs.includes('function decodeAndComputeAudioViz(') &&
        adjs.includes('function decodeAndComputeAudioSlotViz(') &&
        adjs.includes('function _onAllDecodeFailed('));
  check('one-owner[decode]: index.html no longer defines the decoders (pointer only)',
        !HTML.includes('async function decodeAndComputeAudioViz(') &&
        HTML.includes('decodeAndComputeAudioViz → js/audio-decode.js'));
}

// (G) Transport ownership: the playback-control cluster has one definition each
//     and lives in js/transport.js (index.html keeps only pointers + call sites).
//     This is where the A/B/D guard targets now live — those guards (above) still
//     resolve them via concatenated SRC. Locks in the step-4 extraction.
{
  for (const fn of ['playAllMedia', 'pauseAllMedia', 'restartAllVideos', 'stepFrame',
                    'syncVideos', 'syncMedia', 'setupVideoHandlers', 'setupAudioHandlers',
                    '_setupFpsDetection', '_startLoopRvfc', '_startOpusSyncForPlayingSlots']) {
    check(`one-owner[transport]: ${fn} defined once (got ${countOf(SRC, 'function ' + fn + '(')})`,
          countOf(SRC, 'function ' + fn + '(') === 1);
  }
  const tjs = JS_FILES.includes('transport.js')
    ? readFileSync(new URL('js/transport.js', ROOT), 'utf8') : '';
  check('one-owner[transport]: cluster lives in js/transport.js',
        tjs.includes('function setupVideoHandlers(') && tjs.includes('function playAllMedia(') &&
        tjs.includes('function _startLoopRvfc('));
  check('one-owner[transport]: index.html no longer defines them (pointer only)',
        !HTML.includes('function setupVideoHandlers(') && HTML.includes('setupVideoHandlers → js/transport.js'));
}

// (H) Multi-video sync-lock owners (2026-07 synced-looping work):
//     _applyNativeLoopPolicy is the SOLE writer of the managed .loop flag —
//     playAllMedia previously wrote m.loop itself, and a second writer brings
//     back the independent-native-wrap desync (each video restarting at 0 on
//     its own clock). _getLoopBounds is the single source of truth for the
//     loop region; _driftLockTick is the only follower-rate writer and must
//     stand down during scrub/bulk-sync/frame-kick windows. The RVFC chain
//     must run in BOTH view modes (no isGridMode bail).
{
  for (const fn of ['_getLoopBounds', '_applyNativeLoopPolicy', '_driftLockTick']) {
    check(`one-owner[sync-lock]: ${fn} defined once (got ${countOf(SRC, 'function ' + fn + '(')})`,
          countOf(SRC, 'function ' + fn + '(') === 1);
  }
  check('one-owner[sync-lock]: _applyNativeLoopPolicy is the sole managed .loop writer',
        countOf(SRC, '.loop = native') === 1);
  for (const fn of ['playAllMedia', 'setupVideoHandlers']) {
    const b = extractFn(fn);
    check(`one-owner[sync-lock]: ${fn} routes .loop through the policy owner`,
          b.includes('_applyNativeLoopPolicy(') && !b.includes('.loop = '));
  }
  const rvfc = extractFn('_startLoopRvfc');
  check('one-owner[sync-lock]: RVFC loop chain runs in Grid mode too (no isGridMode bail)',
        !rvfc.includes('isGridMode'));
  check('one-owner[sync-lock]: RVFC chain resolves the region via _getLoopBounds',
        rvfc.includes('_getLoopBounds()'));
  const drift = extractFn('_driftLockTick');
  check('one-owner[sync-lock]: drift lock stands down during scrub / bulk-sync',
        drift.includes('isDragging') && drift.includes('_bulkSyncActive'));
  check('one-owner[sync-lock]: drift lock never touches the primary (clock master)',
        drift.includes('if (v === primary) continue;'));
  check('one-owner[sync-lock]: diff composite gates on matched frames',
        extractFn('drawDiffComposite').includes('_diffFramesMismatched('));
  // Wrap-at-natural-end storm guards: reaching the end fires 'pause' then
  // 'ended'; without these, the pause cascades to the other videos and the
  // ended-wrap's play() calls re-sync against mid-wrap clocks — a feedback
  // storm of stale forward-seeks (seen live: videos ping-ponging 0 ↔ ~3s).
  const svh = extractFn('setupVideoHandlers');
  check('one-owner[sync-lock]: end-of-media pause does not cascade under a managed loop',
        svh.includes('if (video.ended && _getLoopBounds() !== null) return;'));
  check('one-owner[sync-lock]: ended-wrap is bulk-synced like the other transports',
        /addEventListener\('ended'[\s\S]*?_bulkSyncActive = true;[\s\S]*?addEventListener\('seeked'/.test(svh));
  check('one-owner[sync-lock]: drift lock waits for in-flight seeks (v.seeking)',
        drift.includes('if (v.seeking) continue;'));
}

// (I) Scrub-session lifecycle (2026-07 three-video scrub fix; suspend/resume
//     refinement after the "choppy with continued use" report):
//     _releaseScrubSessions is the SOLE owner of the full "close every retained
//     scrub session" sweep (clearAllMedia routes through it). playAllMedia must
//     route through _suspendScrubSessions instead — suspend closes ONLY the
//     VideoDecoder (idle scrub decoders starve 2–3 playing <video>s → chunky
//     frames) while keeping file bytes + demux + frame cache; the earlier
//     full-close-on-play forced every post-play scrub to refetch and re-demux
//     the whole file with a cold cache (GC churn = choppy after continued use,
//     and reverse scrubs re-decoded everything). The skip-the-<video>-seek
//     decision must gate on _scrubOverlayEffective (real paint progress), not
//     mere liveness — a silently stalled overlay that still counted as "live"
//     froze one slot in a 3-up Grid scrub.
{
  check(`one-owner[scrub-session]: _releaseScrubSessions defined once (got ${countOf(SRC, 'function _releaseScrubSessions(')})`,
        countOf(SRC, 'function _releaseScrubSessions(') === 1);
  check(`one-owner[scrub-session]: _suspendScrubSessions defined once (got ${countOf(SRC, 'function _suspendScrubSessions(')})`,
        countOf(SRC, 'function _suspendScrubSessions(') === 1);
  check('one-owner[scrub-session]: the release-all sweep lives only in _releaseScrubSessions',
        countOf(SRC, 'for (const k in _scrubVideoSessions)') === 1);
  check('one-owner[scrub-session]: clearAllMedia routes through the owner (no inline sweep)',
        extractFn('clearAllMedia').includes('_releaseScrubSessions()'));
  check('one-owner[scrub-session]: playAllMedia SUSPENDS scrub decoders (never full-closes — that refetches the file per scrub)',
        extractFn('playAllMedia').includes('_suspendScrubSessions()') &&
        !extractFn('playAllMedia').includes('_releaseScrubSessions'));
  const sv = readFileSync(new URL('js/scrub-video.js', ROOT), 'utf8');
  check('scrub[suspend]: suspend() closes the decoder but keeps the frame cache and bytes',
        /suspend\(\)\s*\{/.test(sv) && (() => {
          const body = sv.slice(sv.indexOf('suspend() {'), sv.indexOf('close() {'));
          return body.includes('decoder.close()') && !body.includes('cache.clear()');
        })());
  check('scrub[suspend]: request() lazily recreates the decoder on resume',
        countOf(sv, 'new VideoDecoder({ output: _onDecoderOutput, error: _onDecoderError })') === 2);
  check('scrub[cache]: cacheStore distance-gates frames that would be evicted immediately',
        sv.includes('maxCacheFrames * frameDur'));
  check(`one-owner[scrub-session]: _scrubOverlayEffective defined once (got ${countOf(SRC, 'function _scrubOverlayEffective(')})`,
        countOf(SRC, 'function _scrubOverlayEffective(') === 1);
  // The skip-<video>-seek sites must trust paint progress, not liveness. The old
  // _scrubOverlayVideoIsLive is gone; its return-true-when-merely-live behavior
  // is exactly the freeze bug.
  check('one-owner[scrub-session]: skip-seek gates on paint progress, not the retired liveness check',
        !SRC.includes('_scrubOverlayVideoIsLive'));
  const eff = extractFn('_scrubOverlayEffective');
  check('one-owner[scrub-session]: effectiveness check hides the canvas when stalled (so the <video> shows through)',
        eff.includes('.style.visibility') && eff.includes('framesPainted'));
}

// (J) Scrub click-vs-drag + asset-switch repaint (2026-07 UX fixes):
//     A discrete seek (a click, or the drag's initial position before the
//     pointer moves) must paint ONLY the target frame — the scrub session's
//     progressive fast-forward through the GOP is what read as "frames speeding
//     past in an instant" on a click. The overlay request threads a `direct`
//     flag driven by _scrubDragMoved. Separately, flipping the active clip in
//     Stack mode while paused must force the newly-shown <video> to re-present
//     its own frame, or the display:none→visible unhide flashes a stale
//     (backward) frame.
{
  const sv = JS_FILES.includes('scrub-video.js')
    ? readFileSync(new URL('js/scrub-video.js', ROOT), 'utf8') : '';
  check('scrub[direct]: session.request accepts a direct (discrete-seek) flag',
        /request\(t,\s*direct\)/.test(sv));
  check('scrub[direct]: a direct forward seek paints target-only (no GOP fast-forward)',
        sv.includes('(direct || pts < lastPaintedPts) ? pts - frameDur : lastPaintedPts'));
  check('scrub[direct]: _scrubOverlayRequestAll forwards direct-ness to the session',
        extractFn('_scrubOverlayRequestAll').includes('s.request(t, direct)'));
  check('scrub[direct]: scrub handlers request direct until the pointer actually drags',
        countOf(SRC, '_scrubOverlayRequestAll(t, !_scrubDragMoved)') === 2);
  check(`switch[repaint]: _repaintActiveVideoOnSwitch defined once (got ${countOf(SRC, 'function _repaintActiveVideoOnSwitch(')})`,
        countOf(SRC, 'function _repaintActiveVideoOnSwitch(') === 1);
  check('switch[repaint]: switchToAsset repaints the newly-shown clip (Stack-only guarded at the call site)',
        extractFn('switchToAsset').includes('_repaintActiveVideoOnSwitch('));
  const rep = extractFn('_repaintActiveVideoOnSwitch');
  check('switch[repaint]: repaint only runs while paused (no seek mid-playback)',
        rep.includes('!v.paused'));
  check('switch[repaint]: repaint nudges within the SAME frame (differs from current time, no image change)',
        rep.includes('Math.abs(t - v.currentTime) > 1e-4'));
}

// (K) Pause-time frame snap (2026-07): pauseAllMedia is the SOLE owner of the
//     post-pause snap; it quantizes a video to ITS OWN frame grid at the
//     reference clip's paused time (not the reference's frame NUMBER — clips can
//     differ in fps). It only touches a follower that's MORE than half a frame
//     off the reference (an unconverged pause). A follower already within the
//     drift lock's tolerance is LEFT where it froze: seeking it would make the
//     just-paused, on-screen clip visibly hop a frame to catch up while the
//     reference (never seeked) stays solid — the asymmetric Grid-pause stutter
//     (v3.12.4). The earlier `|currentTime - midpoint| > 1e-4` guard re-seeked
//     every clip on every pause (v3.12.3 fixed the reference; v3.12.4 the follower).
{
  check(`one-owner[pause-snap]: _snapAllVideosToFrame defined once (got ${countOf(SRC, 'function _snapAllVideosToFrame(')})`,
        countOf(SRC, 'function _snapAllVideosToFrame(') === 1);
  check('one-owner[pause-snap]: pauseAllMedia is the sole caller (only after every video is paused)',
        countOf(SRC, '_snapAllVideosToFrame()') === 2); // definition line + the one call site
  const pam = extractFn('pauseAllMedia');
  check('one-owner[pause-snap]: pauseAllMedia snaps AFTER pausing every video (not before)',
        pam.indexOf('.forEach(m => m.pause())') < pam.indexOf('_snapAllVideosToFrame()'));
  const snap = extractFn('_snapAllVideosToFrame');
  check('pause-snap: audio mode is a no-op (video-only concern)',
        /\{\s*if \(hasAudios\) return;/.test(snap));
  check('pause-snap: quantizes each follower to its OWN fps, not the reference frame number',
        snap.includes('videoFrameRates[v.src]') && snap.includes('refTime'));
  check('pause-snap: leaves within-half-a-frame followers untouched (no catch-up hop)',
        snap.includes('Math.abs(v.currentTime - refTime) <= 0.5 / fps'));
  check('pause-snap: stands down during a drag (scrub-start pause must not fire competing seeks)',
        snap.includes('if (isDragging) return;'));
  // Both PAUSED alignment paths resolve the reference through one owner, and
  // both quantize followers onto their own grid at the reference's TIME.
  // stepFrame used to advance each video by one of its OWN frames from its OWN
  // clock: a 24/30 pair then diverged by the frame-duration difference on every
  // step (8.3 ms — ~5 frames after 24 taps, measured) with nothing to correct it,
  // and its per-clip `% totalFrames` wrap sent clips of different lengths to
  // unrelated content at the loop point.
  check(`one-owner[sync-ref]: _syncReferenceVideo defined once (got ${countOf(SRC, 'function _syncReferenceVideo(')})`,
        countOf(SRC, 'function _syncReferenceVideo(') === 1);
  check('one-owner[sync-ref]: pause snap resolves the reference through the owner',
        snap.includes('_syncReferenceVideo(videos)'));
  const step = extractFn('stepFrame');
  check('one-owner[sync-ref]: frame stepping resolves the reference through the owner',
        step.includes('_syncReferenceVideo(videos)'));
  check('step-sync: stepping is reference-driven, not per-clip-clock',
        step.includes('refTime') && step.includes('videoFrameRates[v.src]') &&
        !/const currentFrame = Math\.floor\(v\.currentTime/.test(step));
  check('step-sync: no per-clip duration wrap (different-length clips must not wrap to their own ends)',
        !/Math\.floor\(v\.duration \* fps/.test(step));
}

// (L) Lost-mouseup recovery (2026-07 "choppy after continued use" report): a drag
//     whose mouseup never arrives (release outside the window, Alt-Tab mid-drag, OS
//     notification) left isDragging stuck true — playAllMedia stopped suspending
//     scrub decoders (chunky playback) and the drift lock stood down permanently.
//     endScrubDrag is the SOLE drag finalizer, reachable from mouseup AND three
//     recovery paths: mousemove with no button held, window blur, and a mousedown
//     arriving mid-"drag". (Scrub no longer touches .muted as of v3.12.2, so the
//     old muted-snapshot / double-audio failure mode is gone — see the scrub-start
//     note in index.html.)
{
  check(`one-owner[drag-end]: endScrubDrag defined once (got ${countOf(SRC, 'function endScrubDrag(')})`,
        countOf(SRC, 'function endScrubDrag(') === 1);
  check('one-owner[drag-end]: mouseup routes through the finalizer',
        SRC.includes("document.addEventListener('mouseup', endScrubDrag)"));
  check('recovery[drag-end]: mousemove with no button held finalizes (ghost-drag guard)',
        SRC.includes('if (e.buttons === 0) { endScrubDrag(null); return; }'));
  check('recovery[drag-end]: window blur finalizes the drag',
        /window\.addEventListener\('blur', \(\) => endScrubDrag\(null\)\)/.test(SRC));
  check('recovery[drag-end]: both mousedown paths finalize a stuck drag first (got ' +
        countOf(SRC, 'if (isDragging) endScrubDrag(null);') + ', want 2)',
        countOf(SRC, 'if (isDragging) endScrubDrag(null);') === 2);
  // Scrub must NOT touch .muted anymore (the decode-warm hack was retired). Freeze
  // that so the .muted overload — and the mute/scrub collision it caused — can't
  // silently return.
  check('recovery[drag-end]: scrub no longer snapshots/writes .muted (overload retired)',
        !SRC.includes('_scrubMutedStates') && !/_scrubAllVideos\.forEach\(v => \{ v\.muted = false/.test(SRC));
  const esd = extractFn('endScrubDrag');
  check('recovery[drag-end]: finalizer tears down the scrub overlays',
        esd.includes('_scrubOverlayEnd()'));
}

// (M) Seamless mid-playback Stack switch (v3.11.9): a display:none <video>
//     stops being PRESENTED — unhiding it flashes the stale frame from when it
//     was last visible (backward jump on near-identical clips) and stalls while
//     decode catches up. The outgoing layer must keep covering (.switch-out)
//     until the incoming video presents a frame matching its current clock,
//     with a stale-frame filter on the RVFC and a hard fallback bounding the
//     two-video compositor overlap (black-A-slot hazard).
{
  check(`one-owner[switch-swap]: _beginSeamlessSwitch defined once (got ${countOf(SRC, 'function _beginSeamlessSwitch(')})`,
        countOf(SRC, 'function _beginSeamlessSwitch(') === 1);
  check('switch-swap: switchToAsset routes mid-playback Stack switches through the swap',
        extractFn('switchToAsset').includes('_beginSeamlessSwitch(prevActiveLayer, playable)'));
  const swp = extractFn('_beginSeamlessSwitch');
  check('switch-swap: RVFC filters the stale frame Chrome presents on unhide',
        swp.includes('md.mediaTime - newVideo.currentTime'));
  check('switch-swap: hard fallback bounds the compositor overlap',
        swp.includes('setTimeout(done, 300)'));
  check('switch-swap: CSS keeps the outgoing wrapper visible above the incoming',
        HTML.includes('.asset-layer.switch-out:not(.active) .video-wrapper'));
}

// (N) Persistent global mute (v3.12.0): the global mute is sticky across file
//     loads AND sessions (localStorage via _prefs). toggleMute is the SOLE writer
//     of isMuted (besides the persisted init) and the SOLE persister; clearAllMedia
//     must NOT reset isMuted (the old reset is exactly the "audio resets on every
//     upload" complaint). _applyMuteState is the sole applier. The button reflects
//     mute in FORM (amber chip + "Muted" label) by swapping ONLY #muteBtnIcon —
//     writing muteBtn.innerHTML would destroy the .vi-label/.vi-icon structure.
//     The first-play nudge fires once per session and lives at the document top
//     level so its z-index clears the transport bar (#videoControls).
{
  // Core single-owner: isMuted has exactly 2 writers (the persisted init + the
  // toggle), and toggleMute both persists and delegates — the persistence IS the
  // feature, so a second unpersisted writer would silently reintroduce the reset.
  check(`one-owner[mute]: isMuted has exactly 2 writers — persisted init + toggle (got ${countOf(SRC, 'isMuted = ')})`,
        countOf(SRC, 'isMuted = ') === 2);
  const tgl = extractFn('toggleMute');
  check('one-owner[mute]: toggleMute persists the preference then applies it',
        tgl.includes("_prefs.save('muted', isMuted)") && tgl.includes('_applyMuteState()'));

  // BUG-FREEZER: clearAllMedia used to reset isMuted — exactly the "audio resets
  // on every upload" complaint this release fixes. Global mute must stay sticky.
  check('one-owner[mute]: clearAllMedia does NOT reset isMuted (global mute is sticky)',
        !extractFn('clearAllMedia').includes('isMuted ='));

  // BUG-FREEZER: the icon swap must target #muteBtnIcon; writing muteBtn's own
  // innerHTML (the old clearAllMedia line) destroys the .vi-icon/.vi-label spans.
  check('one-owner[mute]: the icon swap targets #muteBtnIcon, never muteBtn.innerHTML',
        countOf(SRC, 'muteBtn.innerHTML') === 0 &&
        extractFn('_updateMuteButtonUI').includes("getElementById('muteBtnIcon')"));

  // Core nudge behavior + trigger wiring: fires once per session, only while muted
  // with audible media, and playAllMedia is the surface that triggers it.
  check('mute-nudge: fires once per session, only while muted, only with audible media',
        extractFn('_maybeMutedNudge').includes('if (_mutedNudgeShown || !isMuted) return;') &&
        extractFn('_maybeMutedNudge').includes('if (!(hasVideos || hasAudios)) return;'));
  check('mute-nudge: playAllMedia surfaces the nudge on first play',
        extractFn('playAllMedia').includes('_maybeMutedNudge()'));

  // BUG-FREEZER: the nudge must sit at the document top level (after #videoControls
  // in source order) so its z-index clears the transport bar — nested in the media
  // stage it sat in a lower stacking context and the Enable button was unclickable.
  check('mute-nudge: #muteNudge lives at top level, after the transport bar (stacking-context fix)',
        HTML.indexOf('id="muteNudge"') > HTML.indexOf('id="videoControls"'));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. FUNCTIONAL UNIT TESTS (pure helpers, via extractFn) — proves the mechanism;
//    the MP4 demuxer test lands with its extraction (step 2).
// ══════════════════════════════════════════════════════════════════════════════

// _getLoopBounds — the loop-region resolver. Globals are injected so the
// extracted shipped function runs pure: custom points win, audio mode and
// single-video are native (null); multi-video resolves to [0, shortest] in Sync
// mode and [0, longest] in Full mode; not-ready metadata (NaN) defers to native.
{
  const boundsWith = (inP, outP, hasAud, durations, mode = 'sync') => new Function(
    '_loopInPoint', '_loopOutPoint', 'hasAudios', 'getAllVideos', '_getEffectiveDuration', '_loopRangeMode',
    extractFn('_getLoopBounds') + '\nreturn _getLoopBounds();'
  )(inP, outP, hasAud, () => durations.map(d => ({ d })), v => v.d, mode);
  check('loop-bounds: custom in/out points win', (() => {
    const b = boundsWith(0.5, 2.0, false, [3, 4]);
    return b && b.inP === 0.5 && b.outP === 2.0;
  })());
  check('loop-bounds: audio mode → null (native loop)', boundsWith(null, null, true, [3, 4]) === null);
  check('loop-bounds: single video → null (native loop)', boundsWith(null, null, false, [3]) === null);
  check('loop-bounds: 2 videos, Sync → [0, shortest]', (() => {
    const b = boundsWith(null, null, false, [4, 3], 'sync');
    return b && b.inP === 0 && b.outP === 3;
  })());
  check('loop-bounds: 2 videos, Full → [0, longest]', (() => {
    const b = boundsWith(null, null, false, [4, 3], 'full');
    return b && b.inP === 0 && b.outP === 4;
  })());
  check('loop-bounds: metadata not ready (NaN) → null', boundsWith(null, null, false, [3, NaN]) === null);
}

// _driftLockTick — follower convergence policy, run against fake video objects.
// BOTH modes rate-nudge below _DRIFT_HARD_SEEK (Grid gently at ±2%; Stack's
// hidden+muted follower strongly at ±10% — a mid-playback seek stalls a playing
// element for its seek latency, landing it behind by more than half a frame
// again → a perpetual seek loop, ~26 seeks/s measured, that kept the hidden
// follower 1–2 frames behind so every asset switch dragged the cluster
// backward). Hard-seeks (past _DRIFT_HARD_SEEK) lead the target by the
// measured landing error for the same reason.
{
  // Pull the shipped threshold consts along with the function so the test
  // tracks their real values.
  // NB: _RATE_TRIM_IS_SMOOTH is deliberately NOT pulled from source (it reads
  // HTMLMediaElement); the tests supply it via ctx so both engines can run.
  const driftConsts = ['_DRIFT_HARD_SEEK', '_DRIFT_RELEASE', '_DRIFT_NUDGE', '_DRIFT_NUDGE_HIDDEN',
                       '_DRIFT_NUDGE_MAX', '_DRIFT_CONVERGE_TAU',
                       '_WK_SEEK_STABLE_TICKS', '_WK_SEEK_COOLDOWN_MS']
    .map(n => (SRC.match(new RegExp('const ' + n + ' = [^;]+;')) || [''])[0]).join('\n');
  const runTick = (primary, followers, grid, rateTrimSmooth = true) => {
    const ctx = {
      hasAudios: false, isDragging: false, _bulkSyncActive: false,
      isGridMode: grid, videoFrameRates: { p: 24, hi: 60, lo: 24 },
      PLAYBACK_RATES: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2], playbackRateIndex: 3,
      _RATE_TRIM_IS_SMOOTH: rateTrimSmooth,
      performance: { now: () => 1e6 },
      getAllVideos: () => [primary, ...followers],
    };
    new Function(...Object.keys(ctx), 'primary',
      driftConsts + '\n' + extractFn('_driftLockTick') + '\n_driftLockTick(primary);'
    )(...Object.values(ctx), primary);
  };
  const vid = t => ({ currentTime: t, playbackRate: 1, paused: false, ended: false, readyState: 4, src: 'p' });
  {
    const p = vid(1.0), f = vid(1.05); // 50ms ahead, stack mode — below _DRIFT_HARD_SEEK
    runTick(p, [f], false);
    check('drift-lock[stack]: sub-threshold drift NUDGES strongly (no seek — seeks land behind and loop)',
          f.currentTime === 1.05 && f._driftNudge === -1 &&
          Math.abs(f.playbackRate - 0.90) < 1e-9);
  }
  {
    const p = vid(1.0), f = vid(1.3); // past _DRIFT_HARD_SEEK, stack mode
    runTick(p, [f], false);
    check('drift-lock[stack]: big drift hard-seeks (lead starts at 0)', f.currentTime === 1.0 && f._seekIssued === true);
    // Landing: the seek stalled the follower while the primary advanced 41ms —
    // the follower lands 41ms BEHIND. The tick folds that error into the lead
    // (0.8 gain → 32.8ms) and the residual converges via nudge (41ms is far
    // below the seek threshold — no blind re-seek loop).
    f.seeking = false; f.currentTime = 1.0; p.currentTime = 1.041;
    runTick(p, [f], false);
    check('drift-lock[lead]: landing error folds into the lead; residual nudges, no re-seek',
          Math.abs(f._seekLead - 0.0328) < 1e-9 && f._seekIssued === false &&
          f.currentTime === 1.0 && f._driftNudge === 1);
    // A later hard-seek aims AHEAD of the primary by the learned lead.
    f.seeking = false; f.currentTime = 2.0; p.currentTime = 2.35; f._driftNudge = 0;
    runTick(p, [f], false);
    check('drift-lock[lead]: subsequent hard-seek leads the primary clock',
          Math.abs(f.currentTime - (2.35 + 0.0328)) < 1e-9);
  }
  {
    const p = vid(1.0), f = vid(1.05); // 50ms ahead, grid mode
    runTick(p, [f], true);
    check('drift-lock[grid]: visible follower nudges (slows) instead of seeking',
          f.currentTime === 1.05 && f._driftNudge === -1 && f.playbackRate < 1);
    f.playbackRate = 1; // J/K overwrote the nudge mid-episode
    runTick(p, [f], true);
    check('drift-lock[grid]: nudge re-asserted after a rate overwrite', f.playbackRate < 1);
    f.currentTime = 1.001; // converged
    runTick(p, [f], true);
    check('drift-lock[grid]: nudge released on convergence', f._driftNudge === 0 && f.playbackRate === 1);
  }
  {
    const p = vid(1.0), f = vid(1.3); // past the hard-seek threshold, grid mode
    runTick(p, [f], true);
    check('drift-lock[grid]: big drift hard-seeks even when visible', f.currentTime === 1.0);
  }
  // WebKit (rateTrimSmooth=false): trimming a VISIBLE follower is an UNSTABLE
  // loop there — Safari presents a trimmed follower unevenly, each stutter
  // loses real time, and the loss keeps the trim engaged (measured: shipping
  // trims peaked at 122-142ms drift with 10-15 bad frame-steps per ~90; no
  // correction settles at ~50ms with 1 bad step). Visible followers are left
  // alone; the pause snap aligns at pause.
  {
    const p = vid(1.0), f = vid(1.05);
    runTick(p, [f], true, false);
    check('drift-lock[webkit]: visible follower is NOT trimmed (trims feed the drift)',
          f.playbackRate === 1 && !f._driftNudge && f.currentTime === 1.05);
  }
  {
    // Stack's follower is display:none — trims are invisible and stay enabled.
    const p = vid(1.0), f = vid(1.05);
    runTick(p, [f], false, false);
    check('drift-lock[webkit]: HIDDEN follower still trims',
          Math.abs(f.playbackRate - 0.90) < 1e-9 && f._driftNudge === -1);
  }
  {
    // Past _DRIFT_HARD_SEEK the seek is STABILITY-GATED on WebKit: a start-up
    // stall can push drift past the threshold, and an immediate seek on a
    // slow-seeking engine lands behind and re-fires (storm). It must wait
    // _WK_SEEK_STABLE_TICKS consecutive ticks, then fire once.
    const p = vid(1.0), f = vid(1.3);
    for (let i = 0; i < 7; i++) runTick(p, [f], true, false);
    check('drift-lock[webkit]: hard-seek waits for a settled offset (no immediate fire)',
          f.currentTime === 1.3);
    runTick(p, [f], true, false); // 8th consecutive off tick
    check('drift-lock[webkit]: settled offset seeks once, with the lead',
          f.currentTime === 1.0 && f._seekIssued === true);
  }
  {
    // An in-flight nudge episode (started under a trim-capable state) releases
    // back to base instead of stranding the follower off-rate.
    const p = vid(1.0), f = vid(1.05);
    runTick(p, [f], true, true);
    runTick(p, [f], true, false);
    check('drift-lock[webkit]: in-flight nudge releases back to base rate',
          f.playbackRate === 1 && f._driftNudge === 0);
  }

  {
    const p = vid(1.0), f = vid(1.05);
    const ctxRun = () => runTick(p, [f], false);
    p.paused = true; ctxRun();
    check('drift-lock: paused primary → no-op', f.currentTime === 1.05);
  }
  {
    // C1 (2026-07 concurrency audit): a follower promoted to primary mid-nudge
    // must not strand the whole cluster at ±2% — the primary is forced back onto
    // the user-selected base rate and its nudge flag cleared each tick.
    const p = vid(1.0), f = vid(1.0);
    p.playbackRate = 1.02; p._driftNudge = -1;  // stranded from a prior nudge
    runTick(p, [f], true);
    check('drift-lock[C1]: primary normalized to base rate + nudge cleared (no global tempo skew)',
          Math.abs(p.playbackRate - 1) < 1e-9 && !p._driftNudge);
  }
  {
    // C2 (2026-07 audit): engage threshold is per-follower at the COARSER grid.
    // 60fps primary + 24fps follower, drift 15ms: > half a 60fps frame (8.3ms)
    // but < half a 24fps frame (20.8ms). The follower is on its own grid — in
    // GRID mode (visible follower, half-frame band) it must NOT be corrected
    // (using the primary's fps would thrash every tick).
    const p = { currentTime: 1.0, playbackRate: 1, paused: false, ended: false, readyState: 4, src: 'hi' };
    const f = { currentTime: 1.015, playbackRate: 1, paused: false, ended: false, readyState: 4, src: 'lo' };
    runTick(p, [f], true);
    check('drift-lock[C2]: coarse GRID follower within its own half-frame is left alone (no thrash)',
          f.currentTime === 1.015 && !f._driftNudge);
    // Stack tightens the band to 8ms (hidden+muted → nudges are free, and the
    // follower is what the user switches TO): the same 15ms drift now engages a
    // NUDGE — never a seek (the seek loop is the v3.11.8 bug).
    runTick(p, [f], false);
    check('drift-lock[C2]: same drift in STACK engages a nudge (tight 8ms band), not a seek',
          f.currentTime === 1.015 && f._driftNudge === -1 && f.playbackRate < 1);
  }
}

// Demuxer hardening (2026-07 security audit): a count/size read from file bytes
// must be clamped to the buffer before it drives a loop or allocation, or a tiny
// crafted file OOMs/hangs the tab on load.
{
  // WebM helpers are extractable pure functions → executable tests.
  const { readEl, readUint } = new Function(
    extractFn('readVint') + '\n' + extractFn('readElementId') + '\n' +
    extractFn('readUint') + '\n' + extractFn('readEl') +
    '\nreturn { readEl, readUint };'
  )();
  // readUint caps width at 8 (EBML ints are ≤8 bytes). Without the cap, a bogus
  // size walks into undefined reads → NaN.
  check('demux[webm]: readUint caps width at 8 bytes',
        Number.isFinite(readUint(new Uint8Array(8), 0, 1000)) &&
        readUint(new Uint8Array([0,0,0,0,0,0,0,1, 9,9]), 0, 1000) === 1);
  // readEl clamps a declared VINT size to the remaining buffer. Element =
  // id(0x80) + 8-byte size VINT declaring ~2^56 + 3 data bytes → dataSize clamps
  // to 3, not 2^56.
  const buf = new Uint8Array([0x80, 0x01,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 1,2,3]);
  const el = readEl(buf, 0);
  check('demux[webm]: readEl clamps declared element size to remaining bytes',
        el && el.dataOffset === 9 && el.dataSize === buf.length - el.dataOffset);

  // MP4 stsz clamps live in closures (parseStsz / walk) — assert the guard is in
  // the shipped demuxers so a revert fails here.
  const audioDemux = extractFn('_demuxMP4Audio');
  const videoDemux = extractFn('_demuxMP4Video');
  check('demux[mp4]: audio stsz default-size branch clamps count to data.length',
        audioDemux.includes('Math.min(count, data.length)'));
  check('demux[mp4]: video stsz clamps count (uniform → data.length)',
        videoDemux.includes('Math.min(n, data.length)') && videoDemux.includes('const cnt'));

  // R1 (2026-07 resource audit): scrub session init is generation-guarded so a
  // stale in-flight session is closed rather than published for the next file.
  const getSession = extractFn('_scrubOverlayGetSession');
  check('scrub[session]: in-flight init generation-guarded (no stale publish/leak)',
        getSession.includes('gen !== _scrubSessionGen') && getSession.includes('session.close()'));
}

// Audit sweep (2026-07 medium/low findings). These fixes are async/DOM-coupled,
// so they're locked in as source-guards rather than executed.
{
  // S4: video sample-table loops (stsc/stco/stts/ctts) clamp their entry count
  // to the box bytes, like the audio demuxer — defense in depth vs OOB reads.
  const videoDemux = extractFn('_demuxMP4Video');
  check('sweep[S4]: video stsc/stco/stts/ctts clamp entry count to box bytes',
        videoDemux.includes('(e - (s + 8)) / 12') && videoDemux.includes('(e - (s + 8)) / entry') &&
        countOf(videoDemux, '(e - (s + 8)) / 8') === 2);

  // C4: reactive-scrub 'seeked' handler only acts for the active scrubbed video.
  const svh = extractFn('setupVideoHandlers');
  check('sweep[C4]: reactive-scrub seeked handler gates on the active video',
        svh.includes("_asLayer && _asLayer.querySelector('video')") &&
        svh.indexOf('_asLayer') < svh.indexOf('_scrubSeekPending = false'));

  // fps estimation must be robust to junk RVFC deltas. Safari emits them during
  // ordinary playback: measured on a 24 fps clip, a clean run of 41.67 ms
  // polluted by 2.17 / 4.65 / 0 / -666 / 743 ms values. The old estimator took
  // Math.min as its base, so the 2.17 ms outlier set the dropped-frame threshold
  // (3.26 ms), every real interval was discarded as a "drop", and the clip was
  // detected as 60 fps — feeding the wrong grid to the pause snap and stepFrame.
  // Replays the real deltas through the SHIPPED estimator body.
  {
    const body = extractFn('_setupFpsDetection');
    const from = body.indexOf('const sorted = intervals.slice()');
    const to = body.indexOf('console.log(`[fps]');
    // Fail with a readable message instead of a ReferenceError from slicing a
    // body that no longer contains the estimator (e.g. reverted to Math.min).
    check('fps-detect: estimator is median-based (robust to junk RVFC deltas)', from >= 0 && to > from);
    const est = (from >= 0 && to > from)
      ? new Function('intervals', '_FPS_STANDARD_RATES', `${body.slice(from, to)}\nreturn snapped;`)
      : () => NaN;
    const RATES = [23.976, 24, 25, 29.97, 30, 48, 59.94, 60];
    const ms = a => a.map(x => x / 1000);
    const safariJunk = ms([17.75, 23.92, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67,
                           41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 743.18, 2.17,
                           4.65, 41.67, 41.67, 41.67, 41.67]);
    check(`fps-detect: Safari's polluted 24 fps deltas → 24 (got ${est(safariJunk, RATES)})`,
          est(safariJunk, RATES) === 24);
    check('fps-detect: clean 24 fps → 24', est(ms(Array(23).fill(41.67)), RATES) === 24);
    check('fps-detect: clean 23.976 stays distinct from 24',
          est(ms(Array(23).fill(41.7083)), RATES) === 23.976);
    check('fps-detect: clean 30 fps → 29.97/30', [29.97, 30].includes(est(ms(Array(23).fill(33.3667)), RATES)));
    check('fps-detect: 60 fps → 59.94/60', [59.94, 60].includes(est(ms(Array(23).fill(16.6833)), RATES)));
    check('fps-detect: dropped frames (2x gaps) do not halve the estimate',
          est(ms([41.67, 41.67, 83.34, 41.67, 41.67, 83.34, 41.67, 41.67, 41.67, 83.34,
                  41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67, 41.67]), RATES) === 24);
  }

  // C5: passive fps detection uses a single-chain guard.
  const fps = extractFn('_setupFpsDetection');
  check('sweep[C5]: fps detection guarded against concurrent chains (detecting flag)',
        fps.includes('let detecting = false') && fps.includes('detected || detecting'));

  // C6: the RVFC exact-time loop wrap suppresses handlers under _bulkSyncActive.
  const wrap = extractFn('_loopWrapToInPoint');
  check('sweep[C6]: loop-wrap seeks under _bulkSyncActive suppression',
        wrap.includes('_bulkSyncActive = true') &&
        wrap.includes('setTimeout(() => { _bulkSyncActive = false; }'));

  // C7: pauseAllMedia releases the bulk-sync guard asynchronously (like the others).
  const pause = extractFn('pauseAllMedia');
  check('sweep[C7]: pauseAllMedia releases _bulkSyncActive on a timeout, not synchronously',
        pause.includes('setTimeout(() => { _bulkSyncActive = false; }') &&
        !/_bulkSyncActive = false;(?!\s*\}, 50)/.test(pause.replace(/setTimeout\(\(\) => \{ _bulkSyncActive = false; \}, 50\);/, '')));

  // R2: scrub cache reserves budget synchronously before the async bitmap create.
  const cacheStore = extractFn('cacheStore');
  check('sweep[R2]: scrub cache reserves cacheBytes before createImageBitmap, refunds on bail',
        cacheStore.indexOf('cacheBytes += cacheFrameBytes') < cacheStore.indexOf('createImageBitmap(clone') &&
        countOf(cacheStore, 'cacheBytes -= cacheFrameBytes') === 2);

  // R3: AudioDecoder is closed on the synchronous configure-throw path.
  const dwad = extractFn('_decodeWithAudioDecoder');
  check('sweep[R3]: AudioDecoder closed on configure() throw',
        dwad.includes('sole decode exit that skipped close') || dwad.includes('try { decoder.close(); } catch (_) {}'));

  // R4: magnifier clone src cleared before removal on a mid-session src swap.
  check('sweep[R4]: magnifier clone src cleared before remove on src swap',
        HTML.includes("clone.pause(); clone.src = ''; clone.remove();"));

  // R5: the native-res diff compositing canvas is released on clearAllMedia.
  const clearAll = extractFn('clearAllMedia');
  check('sweep[R5]: _diffOffscreen released in clearAllMedia',
        clearAll.includes('_diffOffscreen = null'));
}

// Multi-clip loop overhaul (2026-07): shared in/out points + Full-length mode.
{
  // Shared loops: the per-slot loop store is gone entirely — one in/out region
  // applies to every clip and persists across asset switches.
  check('loop-range: per-slot loop store removed (loops are shared)',
        !SRC.includes('_loopPointsPerSlot'));
  // Full mode: the 'ended' handler holds a clip on its last frame and wraps only
  // once EVERY clip has ended — event-driven, no racy per-frame currentTime math.
  const svh = extractFn('setupVideoHandlers');
  check('loop-range: Full-mode ended-wrap gates on all clips ended',
        svh.includes("_loopRangeMode === 'full'") && svh.includes('every(v => v.ended)'));
  // The wrap must resume frozen (ended) clips — seek AND play.
  check('loop-range: _loopWrapToInPoint resumes frozen clips (play)',
        extractFn('_loopWrapToInPoint').includes('m.play()'));
  // Clips of different lengths DEFAULT to Full (see everything) rather than
  // silently looping the shortest; the notifier flips the mode + draws attention.
  const notify = extractFn('_notifyDurationMismatch');
  check('loop-range: differing-length clips default to Full mode',
        notify.includes("_loopRangeMode = 'full'"));
  // Excluded-tail cue is drawn on the progress bar (updateLoopMarkerUI).
  check('loop-range: excluded-tail band rendered for the multi-clip loop',
        extractFn('updateLoopMarkerUI').includes('loopTailBand'));
}

// formatFileSize
{
  const { formatFileSize } = new Function(extractFn('formatFileSize') + '\nreturn { formatFileSize };')();
  check('formatFileSize: bytes',  formatFileSize(512) === '512 B');
  check('formatFileSize: KB',     formatFileSize(1536) === '1.5 KB');
  check('formatFileSize: KB exact', formatFileSize(1024) === '1.0 KB');
  check('formatFileSize: MB',     formatFileSize(1572864) === '1.5 MB');
}

// _formatTcForCopy (pass fmt explicitly so it never touches _prefs → pure)
{
  const { _formatTcForCopy } = new Function(extractFn('_formatTcForCopy') + '\nreturn { _formatTcForCopy };')();
  check('tc[hms]: zero',        _formatTcForCopy(0, 30, 'hms') === '00:00.000');
  check('tc[hms]: m:ss.mmm',    _formatTcForCopy(65.5, 30, 'hms') === '01:05.500');
  check('tc[hms]: rolls hours', _formatTcForCopy(3661.25, 30, 'hms') === '01:01:01.250');
  check('tc[f]: frame number',  _formatTcForCopy(2, 24, 'f') === 'F49');
  check('tc[sf]: total:frame',  _formatTcForCopy(1, 25, 'sf') === '1:00');
  check('tc: frame fmt with no fps falls back to time', _formatTcForCopy(5, null, 'hmsf') === '00:05.000');
}

// MP4 demuxer — run the real extracted function against a real fixture MP4.
// Fixtures are gitignored + generated on first `npm test`; skip (loudly) if absent.
{
  const fixture = new URL('fixtures/landscape_a.mp4', import.meta.url);
  if (!existsSync(fixture)) {
    console.log('  ⊘ demux[mp4]: skipped — run `npm test` once to generate tests/fixtures/*.mp4');
  } else {
    const { _demuxMP4Audio } = new Function(extractFn('_demuxMP4Audio') + '\nreturn { _demuxMP4Audio };')();
    const bytes = new Uint8Array(readFileSync(fixture));
    const r = _demuxMP4Audio(bytes);
    check('demux[mp4]: returns an extraction object', r && typeof r === 'object');
    check('demux[mp4]: extracted audio packets', r && Array.isArray(r.chunks) && r.chunks.length > 0);
    check('demux[mp4]: positive sample rate', r && r.sampleRate > 0);
    check('demux[mp4]: at least one channel', r && r.channels >= 1);
    check('demux[mp4]: codec fourcc string', r && typeof r.codec === 'string' && r.codec.length > 0);
    check('demux[mp4]: chunks carry {timestamp, data}', r && r.chunks[0] &&
          typeof r.chunks[0].timestamp === 'number' && r.chunks[0].data && r.chunks[0].data.length > 0);
  }
}

// MP4 VIDEO demuxer (WebCodecs scrub path) — same fixture, video track.
// landscape_a.mp4 is 3 s of 24 fps H.264 with default (sparse) GOP: one keyframe.
{
  const fixture = new URL('fixtures/landscape_a.mp4', import.meta.url);
  if (!existsSync(fixture)) {
    console.log('  ⊘ demux[mp4video]: skipped — run `npm test` once to generate tests/fixtures/*.mp4');
  } else {
    const { _demuxMP4Video } = new Function(extractFn('_demuxMP4Video') + '\nreturn { _demuxMP4Video };')();
    const bytes = new Uint8Array(readFileSync(fixture));
    const r = _demuxMP4Video(bytes);
    check('demux[mp4video]: returns a track object', r && typeof r === 'object');
    check('demux[mp4video]: avc1 codec string', r && /^avc1\.[0-9a-f]{6}$/.test(r.codec));
    check('demux[mp4video]: avcC description present', r && r.description && r.description.length > 6);
    check('demux[mp4video]: coded dims match fixture', r && r.codedWidth === 960 && r.codedHeight === 540);
    check('demux[mp4video]: ~72 samples for 3s @ 24fps', r && r.samples.length >= 70 && r.samples.length <= 74);
    check('demux[mp4video]: first sample is a keyframe', r && r.samples[0].key === true);
    check('demux[mp4video]: pts monotonic over presentation order', r && (() => {
      const pts = r.samples.map(s => s.pts).sort((a, b) => a - b);
      for (let i = 1; i < pts.length; i++) if (pts[i] <= pts[i - 1] - 1e-9) return false;
      return true;
    })());
    check('demux[mp4video]: sample byte ranges are in-bounds', r && r.samples.every(s =>
      s.offset > 0 && s.size > 0 && s.offset + s.size <= bytes.length));
    check('demux[mp4video]: last pts ≈ 3s', r && Math.abs(r.samples[r.samples.length - 1].pts - 3) < 0.25);
    // elst shift: x264 B-frame files carry a 2-frame edit-list lead; the <video>
    // element applies it, so demuxed presentation pts must start at 0 to match
    // (a raw min pts of ~0.083s means the overlay paints the wrong frame).
    check('demux[mp4video]: elst applied — presentation starts at 0', r &&
          Math.min(...r.samples.map(s => s.pts)) < 1e-9);
    check('demux[mp4video]: SDR fixture has no colr (or non-HDR transfer)',
          r && (!r.colr || (r.colr.transfer !== 16 && r.colr.transfer !== 18)));
  }
}

// HDR detection — the scrub decoder must refuse PQ/HLG content (Chrome
// tone-maps HDR <video> for display; canvas drawImage doesn't, so the overlay
// would paint drastically darker). pq_hdr.mp4 carries a BT.2020/PQ colr box.
{
  const fixture = new URL('fixtures/pq_hdr.mp4', import.meta.url);
  if (!existsSync(fixture)) {
    console.log('  ⊘ demux[hdr]: skipped — run `npm test` once to generate tests/fixtures/*.mp4');
  } else {
    const { _demuxMP4Video } = new Function(extractFn('_demuxMP4Video') + '\nreturn { _demuxMP4Video };')();
    const r = _demuxMP4Video(new Uint8Array(readFileSync(fixture)));
    check('demux[hdr]: colr box parsed', r && r.colr && typeof r.colr.transfer === 'number');
    check('demux[hdr]: PQ transfer (16) detected', r && r.colr && r.colr.transfer === 16);
    check('demux[hdr]: BT.2020 primaries (9) detected', r && r.colr && r.colr.primaries === 9);
    // The refusal itself lives in _createScrubVideoSession — assert the guard
    // exists in shipped source so a refactor can't silently drop it.
    const src = extractFn('_createScrubVideoSession');
    check('scrub[hdr]: session factory refuses PQ/HLG transfers',
          src.includes('transfer === 16') && src.includes('transfer === 18'));
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
