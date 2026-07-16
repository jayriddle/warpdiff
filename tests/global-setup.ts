import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturesDir = path.join(__dirname, 'fixtures');
// Both sentinels must exist — the webm pair was added later (2026-07), so an
// existing checkout can have the mp4s but not the webms; regenerate then too.
const sentinels = [
  path.join(fixturesDir, 'landscape_a.mp4'),
  path.join(fixturesDir, 'vorbis_a.webm'),
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
