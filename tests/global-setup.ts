import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturesDir = path.join(__dirname, 'fixtures');
// Both sentinels must exist — the webm pair was added later (2026-07), so an
// existing checkout can have the mp4s but not the webms; regenerate then too.
const sentinels = [
  path.join(fixturesDir, 'landscape_a.mp4'),
  path.join(fixturesDir, 'vorbis_a.webm'),
  // vorbis_long.webm (4 s) was added later for the open-codec sync-lock tests;
  // a checkout with the earlier webms but not this one must still regenerate.
  path.join(fixturesDir, 'vorbis_long.webm'),
  // vorbis_30.webm (30 fps) was added for the mixed-frame-rate stepping test.
  path.join(fixturesDir, 'vorbis_30.webm'),
  // MP4 with a leading empty audio edit for decoded-audio timeline mapping.
  path.join(fixturesDir, 'audio_offset.mp4'),
  // MP4 whose stereo soundtrack is pure side information (L = -R).
  path.join(fixturesDir, 'side_lr.mp4'),
  // Browser-incompatible AC-3 soundtrack: exercises the real ffmpeg.wasm fallback.
  path.join(fixturesDir, 'ac3_video.mp4'),
];
const generator = path.join(fixturesDir, 'generate.sh');

export default async function globalSetup() {
  if (sentinels.every(s => fs.existsSync(s))) return;

  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error(
      'Test fixtures are missing and ffmpeg is not on PATH.\n' +
      'Install ffmpeg (macOS: `brew install ffmpeg`, Ubuntu: `apt-get install ffmpeg`),\n' +
      `then re-run the tests. The fixture generator is ${generator}.`
    );
  }

  console.log('[global-setup] Generating test fixtures via generate.sh…');
  execFileSync('bash', [generator], { stdio: 'inherit' });
}
