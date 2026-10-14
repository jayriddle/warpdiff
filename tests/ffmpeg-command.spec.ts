import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

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
    '-ar', '48000', '-b:a', '192k', '-af', 'apad', '-shortest', '-movflags', '+faststart', './' + output];
}

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
  await page.goto('/');

});

test('copied FFmpeg commands preserve adversarial filenames through a POSIX shell', async ({ page }) => {
  test.skip(process.platform === 'win32', 'Copied commands target macOS/Linux POSIX shells.');
  const commands = await page.evaluate(items => {
    const w = window as any;
    return items.map(item => {
      w.eval('_ffmpegCommands = {}');
      w._registerFfmpegCommand('original', item.input, 'ec-3');
      const info = w.eval('_ffmpegCommands.original');
      // A second registration must not replace the command again.
      w._registerFfmpegCommand('original', 'replacement.mp4', 'ac-3');
      return { cmd: info.cmd, filename: w.eval('_ffmpegCommands.original.filename') };
    });
  }, cases);
  for (let i = 0; i < cases.length; i++) {
    expect(commands[i].filename).toBe(cases[i].input);
    if (/[\x00-\x1f\x7f-\x9f]/.test(cases[i].input)) {
      expect(commands[i].cmd).toBeNull();
      continue;
    }
    for (const shell of shells) {
      await test.step(`${shell.name}: ${cases[i].label}`, async () => {
        expect(shellArguments(commands[i].cmd, shell)).toEqual(expectedArguments(cases[i].input, cases[i].output));
      });
    }
  }
});

test('FFmpeg panel copies the displayed macOS/Linux command verbatim', async ({ page }) => {
  const filename = 'Jay\'s "clip"-$(printf EXPANDED)-review.mp4';
  await page.evaluate(name => {
    const w = window as any;
    w.copiedCommands = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text: string) => { w.copiedCommands.push(text); } } });
    w._registerFfmpegCommand('original', name, 'ec-3');
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
});

for (const control of [0, 3, 9, 10, 13, 21, 27, 127, 155]) {
  test(`terminal control U+${control.toString(16).padStart(4, '0')} cannot enter a copied command`, async ({ page }) => {
    await page.evaluate(code => {
      const w = window as any;
      w.copiedCommands = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async (text: string) => { w.copiedCommands.push(text); } } });
      w._registerFfmpegCommand('original', 'clip' + String.fromCharCode(code) + 'probe.mp4', 'ec-3');
    }, control);
    const button = page.locator('#ffmpegPanel .fp-copy-btn');
    await expect(button).toBeDisabled();
    await expect(page.locator('#ffmpegPanel .fp-cmd')).toContainText('Rename this file');
    expect(await page.evaluate(() => (window as any).eval('_ffmpegCommands.original.cmd'))).toBeNull();
    // Also fence direct calls, rather than relying solely on disabled markup.
    await page.evaluate(() => (window as any)._copyFfmpegCmd(document.querySelector('#ffmpegPanel .fp-copy-btn'), 'original'));
    expect(await page.evaluate(() => (window as any).copiedCommands)).toEqual([]);
  });
}

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

test('real terminal FFmpeg converts literal filenames including a leading hyphen', async ({ page }) => {
  test.skip(process.platform === 'win32', 'Copied commands target macOS/Linux POSIX shells.');
  const selected = cases.filter(item => ['leading hyphen', 'apostrophe', 'command substitution',
    'uppercase MP4', 'MOV video', 'M4V video',
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
        expect(probe.error, 'ffprobe must complete before checking its output').toBeUndefined();
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

for (const audioStart of [0, 0.5]) {
  test(`a short soundtrack starting at ${audioStart}s retains every copied video packet`, async ({ page }) => {
    test.skip(process.platform === 'win32', 'Copied commands target POSIX terminals.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-short-soundtrack-'));
    const filename = 'short-soundtrack.mp4';
    const input = path.join(directory, filename);
    const output = path.join(directory, 'short-soundtrack_aac.mp4');
    const run = (executable: string, args: string[]) => {
      const result = spawnSync(executable, args, { cwd: directory, timeout: 20_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr.toString()).toBe(0);
      return result.stdout;
    };
    const packets = (file: string): string[] => JSON.parse(run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_data_hash', 'sha256',
      '-show_entries', 'packet=data_hash', '-of', 'json', file]).toString()).packets
      .map((packet: {data_hash: string}) => packet.data_hash);
    const digest = () => createHash('sha256').update(fs.readFileSync(input)).digest('hex');
    try {
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=s=128x72:r=24:d=2', '-itsoffset', String(audioStart), '-f', 'lavfi', '-i',
        'sine=frequency=1000:sample_rate=48000:duration=0.7', '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-movflags', '+faststart', input]);
      const originalHash = digest();
      const originalPackets = packets(input);
      expect(originalPackets).toHaveLength(48);
      await page.evaluate(name => (window as any)._registerFfmpegCommand('original', name, 'ac-3'), filename);
      const command = await page.evaluate(() => (window as any).eval('_ffmpegCommands.original.cmd'));
      run('/bin/sh', ['-c', command]);
      const outputPackets = packets(output);
      const streams = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]).toString()).streams;
      const video = streams.find((stream: any) => stream.codec_type === 'video');
      const audio = streams.find((stream: any) => stream.codec_type === 'audio');
      await test.info().attach('short-soundtrack-result', { contentType: 'application/json', body: JSON.stringify({
        audioStart, command, originalPackets: originalPackets.length, copiedPackets: outputPackets.length,
        videoDuration: video.duration, originalUnchanged: digest() === originalHash,
      }) });
      expect(digest()).toBe(originalHash);
      expect(outputPackets).toEqual(originalPackets);
      expect(Number(video.duration)).toBeCloseTo(2, 2);
      expect(audio).toMatchObject({codec_name: 'aac', channels: 2, sample_rate: '48000'});
      // The padded tail is silent, while the retained soundtrack remains audible.
      const pcm = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', output,
        '-vn', '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1']);
      let peak = 0, tailPeak = 0;
      for (let byte = 0; byte + 4 <= pcm.length; byte += 4) {
        const sample = Math.abs(pcm.readFloatLE(byte));
        peak = Math.max(peak, sample);
        if (byte / (4 * 2 * 48000) > 1.1) tailPeak = Math.max(tailPeak, sample);
      }
      expect(pcm.length / (4 * 2 * 48000)).toBeGreaterThan(1.9 - audioStart);
      expect(peak).toBeGreaterThan(0.01);
      expect(tailPeak).toBeLessThan(0.001);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
