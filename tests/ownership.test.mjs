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

// ══════════════════════════════════════════════════════════════════════════════
// 2. FUNCTIONAL UNIT TESTS (pure helpers, via extractFn) — proves the mechanism;
//    the MP4 demuxer test lands with its extraction (step 2).
// ══════════════════════════════════════════════════════════════════════════════

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

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
