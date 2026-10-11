import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const cases: { label: string; input: string; output: string }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/ffmpeg-command-filenames.json'), 'utf8'));

// FFmpeg receives the complete argv after a real POSIX shell parses the shipped
// command. The stub prints NUL-delimited arguments; it never opens media files.
function shellArguments(command: string): string[] {
  const result = spawnSync('/bin/sh', ['-c',
    "ffmpeg() { printf '%s\\0' \"$@\"; }\n" + command], { timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr.toString()).toBe(0);
  const fields = result.stdout.toString('utf8').split('\0');
  expect(fields.pop()).toBe('');
  return fields;
}

function expectedArguments(input: string, output: string): string[] {
  return ['-ignore_editlist', '0', '-fflags', '+bitexact', '-i', './' + input,
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2',
    '-ar', '48000', '-b:a', '192k', '-shortest', '-movflags', '+faststart', './' + output];
}

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
  await page.goto('/');
  // Only the unrelated automatic transcode is stubbed. Registration, command
  // generation, panel rendering and clipboard handling use the shipped code.
  await page.evaluate(() => {
    const w = window as any;
    w.transcodeCalls = [];
    w._transcodeSlot = (slot: string) => w.transcodeCalls.push(slot);
  });
});

test('copied FFmpeg commands preserve adversarial filenames through a POSIX shell', async ({ page }) => {
  test.skip(process.platform === 'win32', 'Copied commands target macOS/Linux POSIX shells.');
  const commands = await page.evaluate(items => {
    const w = window as any;
    return items.map(item => {
      w.eval('_ffmpegCommands = {}');
      w._registerFfmpegCommand('original', item.input, 'ec-3');
      const info = w.eval('_ffmpegCommands.original');
      // A second registration must not replace the command or auto-start again.
      w._registerFfmpegCommand('original', 'replacement.mp4', 'ac-3');
      return { cmd: info.cmd, filename: w.eval('_ffmpegCommands.original.filename') };
    });
  }, cases);
  for (let i = 0; i < cases.length; i++) {
    await test.step(cases[i].label, async () => {
      expect(commands[i].filename).toBe(cases[i].input);
      expect(shellArguments(commands[i].cmd)).toEqual(expectedArguments(cases[i].input, cases[i].output));
    });
  }
  expect(await page.evaluate(() => (window as any).transcodeCalls)).toEqual(cases.map(() => 'original'));
});

test('FFmpeg panel copies the displayed macOS/Linux command verbatim', async ({ page }) => {
  const filename = 'Jay\'s "clip"-$(printf EXPANDED)\nreview.mp4';
  await page.evaluate(name => {
    const w = window as any;
    w.copiedCommands = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text: string) => { w.copiedCommands.push(text); } } });
    w._registerFfmpegCommand('original', name, 'ec-3');
    w.toggleFfmpegPanel();
  }, filename);
  const panel = page.locator('#ffmpegPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.fp-entry-codec')).toContainText(filename.replace(/\s+/g, ' '));
  await expect(panel.locator('.fp-note')).toContainText('macOS or Linux');
  await expect(panel.locator('.fp-note')).toContainText('folder containing the original file');
  const displayed = await panel.locator('.fp-cmd').textContent();
  const registered = await page.evaluate(() => (window as any).eval('_ffmpegCommands.original.cmd'));
  expect(displayed).toBe(registered);
  await panel.locator('.fp-copy-btn').click();
  await expect(panel.locator('.fp-copy-btn')).toHaveText('Copied!');
  expect(await page.evaluate(() => (window as any).copiedCommands)).toEqual([registered]);
  expect(await page.evaluate(() => (window as any).transcodeCalls)).toEqual(['original']);
});

test('real terminal FFmpeg converts literal filenames including a leading hyphen', async ({ page }) => {
  test.skip(process.platform === 'win32', 'Copied commands target macOS/Linux POSIX shells.');
  const selected = cases.filter(item => ['leading hyphen', 'apostrophe', 'command substitution', 'newline'].includes(item.label));
  const commands = await page.evaluate(items => {
    const w = window as any;
    return items.map(item => {
      w.eval('_ffmpegCommands = {}');
      w._registerFfmpegCommand('original', item.input, 'ac-3');
      return w.eval('_ffmpegCommands.original.cmd');
    });
  }, selected);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-command-'));
  try {
    for (let i = 0; i < selected.length; i++) {
      await test.step(selected[i].label, async () => {
        fs.copyFileSync(path.join(__dirname, 'fixtures/ac3_video.mp4'), path.join(directory, selected[i].input));
        const run = spawnSync('/bin/sh', ['-c', commands[i]], { cwd: directory, encoding: 'utf8', timeout: 20_000 });
        expect(run.error).toBeUndefined();
        expect(run.status, run.stderr).toBe(0);
        expect(fs.existsSync(path.join(directory, selected[i].output))).toBe(true);
        const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
          'stream=codec_type,codec_name,channels,sample_rate:format=duration', '-of', 'json', './' + selected[i].output],
          { cwd: directory, encoding: 'utf8', timeout: 5000 });
        expect(probe.status, probe.stderr).toBe(0);
        const info = JSON.parse(probe.stdout);
        expect(info.streams.find((stream: any) => stream.codec_type === 'audio')).toMatchObject(
          { codec_name: 'aac', channels: 2, sample_rate: '48000' });
        expect(info.streams.find((stream: any) => stream.codec_type === 'video').codec_name).toBe('h264');
        expect(Number(info.format.duration)).toBeGreaterThan(0.8);
      });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
