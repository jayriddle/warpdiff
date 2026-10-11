import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const cases: { label: string; input: string; output: string }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/ffmpeg-command-filenames.json'), 'utf8'));

const shells = [
  { name: 'sh', executable: '/bin/sh', options: ['-c'] },
  { name: 'bash', executable: '/bin/bash', options: ['--noprofile', '--norc', '-c'] },
  { name: 'zsh', executable: '/bin/zsh', options: ['-f', '-c'] },
].filter(shell => fs.existsSync(shell.executable));

// FFmpeg receives the complete argv after a real shell parses the shipped
// command. The stub prints NUL-delimited arguments; it never opens media files.
function shellArguments(command: string, shell: typeof shells[number]): string[] {
  const result = spawnSync(shell.executable, [...shell.options,
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
    w.realTranscodeSlot = w._transcodeSlot;
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
    expect(commands[i].filename).toBe(cases[i].input);
    for (const shell of shells) {
      await test.step(`${shell.name}: ${cases[i].label}`, async () => {
        expect(shellArguments(commands[i].cmd, shell)).toEqual(expectedArguments(cases[i].input, cases[i].output));
      });
    }
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

for (const failure of ['refused', 'missing', 'synchronous'] as const) {
  test(`FFmpeg panel reports ${failure} clipboard access without claiming success`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/red.png'));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    await page.evaluate(mode => {
      const w = window as any;
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: mode === 'missing' ? undefined : { writeText: () => {
          const error = new DOMException('Clipboard denied', 'NotAllowedError');
          if (mode === 'synchronous') throw error;
          return Promise.reject(error);
        } } });
      w._registerFfmpegCommand('original', 'review.mp4', 'ec-3');
      w.toggleFfmpegPanel();
    }, failure);
    const button = page.locator('#ffmpegPanel .fp-copy-btn');
    await button.click();
    await expect(page.locator('#toast')).toContainText('Could not copy');
    await expect(page.locator('#toast')).toBeVisible();
    await expect(button).toHaveText('Copy');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => {} } }));
    await button.click();
    await expect(button).toHaveText('Copied!');
    expect(errors).toEqual([]);
  });
}

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a late clipboard ${outcome} after clear leaves the retired command silent`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
      const w = window as any;
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: () => new Promise<void>((resolve, reject) => {
          w.finishCopy = resolve;
          w.failCopy = () => reject(new DOMException('Clipboard denied', 'NotAllowedError'));
        }) } });
      w._registerFfmpegCommand('original', 'review.mp4', 'ec-3');
      w.toggleFfmpegPanel();
      w.retiredCopyButton = document.querySelector('#ffmpegPanel .fp-copy-btn');
    });
    await page.locator('#ffmpegPanel .fp-copy-btn').click();
    const state = await page.evaluate(async result => {
      const w = window as any;
      w.clearAllMedia();
      const toast = document.getElementById('toast')!;
      const before = { text: toast.textContent, className: toast.className };
      if (result === 'resolve') w.finishCopy();
      else w.failCopy();
      await new Promise(resolve => setTimeout(resolve, 0));
      return { before, after: { text: toast.textContent, className: toast.className },
        retiredText: w.retiredCopyButton.textContent, copied: w.retiredCopyButton.classList.contains('copied') };
    }, outcome);
    expect(state.after).toEqual(state.before);
    expect(state.retiredText).toBe('Copy');
    expect(state.copied).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('real browser FFmpeg retains a hidden extensionless basename when reloading AAC', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    const w = window as any;
    w._transcodeSlot = w.realTranscodeSlot;
  });
  await page.locator('#multiFileInput').setInputFiles({ name: '.review', mimeType: 'video/mp4',
    buffer: fs.readFileSync(path.join(__dirname, 'fixtures/ac3_video.mp4')) });
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  // Some browser/OS combinations decode AC-3 natively. Invoke the conversion
  // owner explicitly so this naming test does not depend on codec support.
  // An automatic conversion already in flight keeps its existing registration.
  await page.evaluate(() => {
    const w = window as any;
    if (w.eval('mediaData.editA.name') === '.review') w._registerFfmpegCommand('editA', '.review', 'ac-3');
  });
  await expect.poll(() => page.evaluate(() => (window as any).eval('mediaData.editA && mediaData.editA.name')),
    { timeout: 150_000 }).toBe('.review_aac.mp4');
  await expect.poll(() => page.evaluate(() => (window as any).eval('!!_videoAudioBuffers.editA')),
    { timeout: 30_000 }).toBe(true);
  const decoded = await page.evaluate(() => {
    const buffer = (window as any).eval('_videoAudioBuffers.editA');
    let peak = 0;
    for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
    return { duration: buffer.duration, peak, channels: buffer.numberOfChannels,
      format: (window as any).eval('mediaData.editA.audioFormat') };
  });
  expect(decoded.duration).toBeGreaterThan(0.8);
  expect(decoded.peak).toBeGreaterThan(0.01);
  expect(decoded.channels).toBe(2);
  expect(decoded.format.fields).toMatchObject({ audioCodec: 'AAC', channels: 'Stereo', sampleRate: '48 kHz' });
  expect(errors).toEqual([]);
});

test('real terminal FFmpeg converts literal filenames including a leading hyphen', async ({ page }) => {
  test.skip(process.platform === 'win32', 'Copied commands target macOS/Linux POSIX shells.');
  const selected = cases.filter(item => ['leading hyphen', 'apostrophe', 'command substitution', 'newline',
    'protocol-like prefix', 'no extension', 'short name without extension', 'hidden name without extension'].includes(item.label));
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
