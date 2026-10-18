import {test, expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '3.17.2'));
  await page.goto('/');
});

for (const [file, expected] of [
  ['dialogue_51.mp4', 'FLAC · 5.1 · 48 kHz'],
  ['dialogue_71.mp4', 'FLAC · 7.1 · 48 kHz'],
  ['dialogue_51_aac.mp4', 'AAC · 5.1 · 48 kHz'],
  ['dialogue_71_opus.mp4', 'Opus · 7.1 · 48 kHz'],
  ['landscape_a.mp4', 'AAC · Stereo · 44.1 kHz'],
  ['vorbis_a.webm', 'Vorbis · Stereo · 44.1 kHz'],
]) {
  test(`source audio format: ${file} in Stack and Grid`, async ({page}) => {
    await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', file));
    const field = page.locator('#layerEditA .asset-audio-format');
    await expect(field).toHaveText(expected);
    await expect(page.locator('#stackInfoStrip .sih-audio-format')).toHaveText(expected);
    await expect(field).toHaveAttribute('title', 'Source audio: ' + expected);
    // Some engines can read source metadata but cannot decode that soundtrack.
    // Dismiss preparation guidance before inspecting the comparison controls.
    if (await page.locator('#localPreparationDialog').isVisible()) await page.locator('#localPreparationClose').click();
    if (await page.locator('#ffmpegPanel').isVisible()) await page.locator('#ffmpegPanelClose').click();
    if (file === 'dialogue_71.mp4') {
      await page.waitForFunction(() => (window as any).eval('_videoAudioBuffers.editA?.numberOfChannels === 3'));
      if (await page.locator('#localPreparationDialog').isVisible()) await page.locator('#localPreparationClose').click();
      if (await page.locator('#ffmpegPanel').isVisible()) await page.locator('#ffmpegPanelClose').click();
      await page.locator('#audioListeningLabel').click();
      await page.getByRole('button', {name:'Center Only', exact:true}).click();
      await expect(field).toHaveText(expected);
      await page.keyboard.press('Escape');
    }
    // Leave the listening control's local keyboard scope before using G.
    await page.locator('#stackInfoStrip .sih-audio-format').click();
    await page.keyboard.press('g');
    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    expect(box?.width).toBeGreaterThan(35);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  });
}

test('source format clears on reload and ignores a stale decode completion', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', 'dialogue_71.mp4'));
  await expect(page.locator('#layerEditA .asset-audio-format')).toContainText('FLAC');
  const oldGen = await page.evaluate(() => (window as any).eval('_videoAudioDecodeGen.editA'));
  await page.evaluate(() => (window as any).eval('clearAllMedia()'));
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', 'landscape_a.mp4'));
  await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('AAC · Stereo · 44.1 kHz');
  await page.evaluate(gen => (window as any).eval(`_setVideoAudioFormat('editA', [{codec:'fLaC',channels:8,sampleRate:96000,channelLayout:'7.1'}], ${gen})`), oldGen);
  await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('AAC · Stereo · 44.1 kHz');
  await page.evaluate(() => (window as any).eval('clearAllMedia()'));
  await expect(page.locator('#stackInfoStrip .sih-audio-format')).toBeEmpty();
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', 'red.png'));
  await expect(page.locator('#layerEditA .asset-audio-format')).toBeEmpty();
});

test('source format changes only when the externally prepared AC-3 copy is loaded', async ({page}) => {
  test.skip(process.platform === 'win32', 'Copied commands target POSIX terminals.');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', 'ac3_video.mp4'));
  await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('Dolby Digital');
  await page.evaluate(() => (window as any)._registerFfmpegCommand('editA', 'ac3_video.mp4', 'ac-3'));
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await page.locator('#localPreparationDialog summary').click();
  await page.locator('#localPreparationManual').click();
  const command = await page.evaluate(() => (window as any).eval('_ffmpegCommands.editA.cmd'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-reload-'));
  try {
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'ac3_video.mp4'), path.join(directory, 'ac3_video.mp4'));
    execFileSync('/bin/sh', ['-c', command], {cwd:directory, timeout:20000, stdio:'pipe'});
    await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('Dolby Digital');
    expect(await page.evaluate(() => (window as any).eval('mediaData.editA.name'))).toBe('ac3_video.mp4');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('l');
    await (await chooser).setFiles(path.join(directory, 'ac3_video_aac.mp4'));
    await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('AAC · Stereo · 48 kHz');
    await expect(page.locator('#ffmpegPanel')).toBeHidden();
    await expect(page.locator('#externalAudioBtn')).toBeHidden();
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});

test('source labels remain hoverable beside metrics in a narrow two-video Grid', async ({page}) => {
  await page.setViewportSize({width:1024, height:768});
  await page.locator('#multiFileInput').setInputFiles(['dialogue_51.mp4','dialogue_71.mp4'].map(file => path.join(__dirname,'fixtures',file)));
  await page.waitForFunction(() => (window as any).eval("assetOrder.filter(s=>mediaData[s]).every(s=>!!_videoAudioBuffers[s] && parseFloat(getComputedStyle(getLayer(s)).opacity)>.99)"));
  await expect.poll(async () => page.locator('.asset-audio-format').evaluateAll(nodes => {
    const visible = nodes.filter(node => node.textContent?.includes('FLAC'));
    return visible.length === 2 && visible.every(node => {
      const field = node.getBoundingClientRect(), bar = node.parentElement!.getBoundingClientRect();
      const zoom = node.parentElement!.querySelector('.asset-zoom')!.getBoundingClientRect();
      return field.width >= 50 && field.left >= bar.left && zoom.right <= bar.right;
    });
  })).toBe(true);
});
