// Explicit hosted file partitions. Playwright's count-based --shard keeps whole
// files together and was leaving the slow files on one runner. Durations are
// from the 2026-10-24 hosted run (Chromium job 120772204456 and neighbors,
// WebKit job 120772204394). New tests/*.spec.ts files and new WebKit testMatch
// files must be added to exactly one shard; tests/release-infrastructure.test.mjs
// rejects a missing or repeated file. Project grep/testMatch filters still apply
// because each shard runs through the existing Playwright config.

export const chromiumShards = [
  // ~418s
  ['warpdiff.spec.ts', 'color-rendering.spec.ts', 'slow-playback.spec.ts', 'continuous-scrub.spec.ts',
    'mp4-audio.spec.ts', 'external-preparation.spec.ts', 'ffmpeg-command.spec.ts', 'audio-viz-reset.spec.ts',
    'audio-analysis.spec.ts', 'dialog-keyboard.spec.ts', 'scrub-input.spec.ts', 'media-input.spec.ts'],
  // ~418s
  ['dialogue-listening.spec.ts', 'host-load.spec.ts', 'prepared-import.spec.ts', 'normal-preparation.spec.ts',
    'restart-playback.spec.ts', 'audio-selection.spec.ts', 'preferences.spec.ts', 'scrub-pitch.spec.ts',
    'usage-production.spec.ts', 'scrub-cadence.spec.ts', 'full-rate-scrub.spec.ts', 'preparation-followup.spec.ts',
    'memory-lifecycle.spec.ts', 'usage-update.spec.ts'],
  // ~418s. scrub-color-handoff.spec.ts defines its test only on macOS, so Linux
  // Chromium runs the file and produces no cases.
  ['appearance-usage.spec.ts', 'info-bar.spec.ts', 'safari-preview-output.spec.ts', 'app-updates.spec.ts',
    'usage-daily.spec.ts', 'local-companion.spec.ts', 'audio-format.spec.ts', 'grid-order.spec.ts',
    'media-admission.spec.ts', 'multichannel.spec.ts', 'prepared-media.spec.ts', 'playhead-clock.spec.ts',
    'native-video-output.spec.ts', 'scrub-color-handoff.spec.ts', 'frame-rate-step.spec.ts', 'audit-quick-fixes.spec.ts'],
];

export const webkitShards = [
  // ~388s
  ['host-load.spec.ts', 'audio-selection.spec.ts', 'media-admission.spec.ts', 'ffmpeg-command.spec.ts',
    'preparation-followup.spec.ts', 'native-video-output.spec.ts'],
  // ~396s
  ['color-rendering.spec.ts', 'mp4-audio.spec.ts', 'preferences.spec.ts', 'external-preparation.spec.ts',
    'dialog-keyboard.spec.ts', 'prepared-media.spec.ts', 'audio-format.spec.ts', 'media-input.spec.ts'],
  // ~390s
  ['normal-preparation.spec.ts', 'prepared-import.spec.ts', 'app-updates.spec.ts', 'warpdiff.spec.ts',
    'scrub-pitch.spec.ts', 'scrub-input.spec.ts', 'info-bar.spec.ts', 'frame-rate-step.spec.ts', 'audit-quick-fixes.spec.ts'],
];

const partitions = {chromium: chromiumShards, webkit: webkitShards};

if (process.argv[1] && process.argv[1].endsWith('ci-shards.mjs')) {
  const [kind, shardArg] = process.argv.slice(2);
  const shards = partitions[kind];
  const shard = Number(shardArg);
  if (!shards || !Number.isInteger(shard) || shard < 1 || shard > shards.length) {
    console.error('Usage: node scripts/ci-shards.mjs <chromium|webkit> <shard>');
    process.exit(1);
  }
  process.stdout.write(shards[shard - 1].map(file => 'tests/' + file).join(' '));
}
