import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturesDir = path.join(__dirname, 'fixtures');
const sentinel = path.join(fixturesDir, 'landscape_a.mp4');
const generator = path.join(fixturesDir, 'generate.sh');

export default async function globalSetup() {
  if (fs.existsSync(sentinel)) return;

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
