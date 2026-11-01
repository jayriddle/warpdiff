import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
});

async function loadFiles(page: Page, names: string[]) {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(names.map(name => path.join(__dirname, 'fixtures', name)));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
}

async function preparationEligibility(page: Page) {
  return page.evaluate(() => {
    const batch = (window as any).eval('_localPreparationBatch');
    const listed = batch ? batch.files.filter((item: { slot: string }) => batch.issues.has(item.slot)).map((item: { file: File }) => item.file.name) : [];
    const eligible = batch ? batch.files.filter((item: { slot: string, prepared: boolean }) => batch.issues.has(item.slot) && !item.prepared).map((item: { file: File }) => item.file.name) : [];
    return { listed, eligible };
  });
}

test('text fields, sliders, menus, and buttons keep their own keys', async ({ page }) => {
  await loadFiles(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  const index = () => page.evaluate(() => (window as any).__testAPI.currentAssetIndex);
  const format = () => page.evaluate(() => localStorage.getItem('pref_timecopyFmt'));
  expect(await index()).toBe(1);

  await page.keyboard.press('Shift+C');
  const separator = page.locator('.tc-sep-input');
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('t');
  await expect(separator).toHaveValue('t');
  expect(await format()).toBeNull();
  await expect(page.locator('#toast')).not.toHaveText(/Timecode:/);

  const volume = page.getByRole('slider', { name: 'Volume' });
  await expect(volume).toBeVisible();
  await volume.focus();
  await volume.evaluate((input: HTMLInputElement) => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('ArrowRight');
  await expect(volume).toHaveValue('51');
  expect(await index()).toBe(1);

  const chip = page.locator('.tc-chip', { hasText: /^to$/ });
  await chip.focus();
  await page.keyboard.press('Space');
  await expect(separator).toHaveValue(' to ');
  await expect(page.locator('#layerEditA video')).toHaveJSProperty('paused', true);
  await page.keyboard.press('Shift+C');
  await expect(page.locator('#timecopyPanel')).not.toHaveClass(/open/);

  await page.locator('#infoEditorButton').click();
  const preset = page.locator('#infoEditorPreset');
  await expect(preset).toBeVisible();
  await preset.focus();
  await page.keyboard.press('t');
  await expect(preset).toHaveValue('default');
  expect(await format()).toBeNull();
  await page.keyboard.press('ArrowDown');
  expect(await index()).toBe(1);
  await page.keyboard.press('Escape');

  await page.locator('#playPauseBtn').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#layerEditA video')).toHaveJSProperty('paused', false);
});

test('a rejected audio file read shows a retryable notice and leaves playback usable', async ({ page }) => {
  const rejections: string[] = [];
  page.on('pageerror', error => rejections.push(error.message));
  await page.addInitScript(() => {
    const pageWindow = window as any;
    pageWindow.__unhandledRejections = [];
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      pageWindow.__unhandledRejections.push(String(reason && (reason.name || reason.message) || reason));
    });
    pageWindow.__originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return Promise.reject(new DOMException('The file could not be read.', 'NotReadableError'));
    };
  });
  await loadFiles(page, ['landscape_a.mp4']);
  await page.waitForTimeout(1200);
  const alert = page.locator('#audioTrackAlert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Could not read the audio file. Playback continues. Open the waveform again to try again.');
  const stuck = await page.evaluate(() => {
    const app = window as any;
    const video = document.querySelector('#layerEditA video') as HTMLVideoElement;
    return {
      started: app.eval('_audioVizDecodeStarted'),
      retry: app.eval('_audioReadRetry.editA === true'),
      wave: app.eval('!!waveformData.editA'),
      muted: video.muted,
      error: video.error && video.error.message,
      ready: video.readyState,
      rejections: app.__unhandledRejections,
    };
  });
  expect(stuck).toMatchObject({ started: true, retry: true, wave: false, muted: false, error: null });
  expect(stuck.ready).toBeGreaterThanOrEqual(1);
  expect(stuck.rejections).toEqual([]);
  expect(rejections).toEqual([]);

  await page.evaluate(() => {
    File.prototype.arrayBuffer = (window as any).__originalArrayBuffer;
    (window as any)._ensureAudioVizDecoded();
  });
  await page.keyboard.press('w');
  await expect(page.locator('#spectrogramPanel')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => (window as any).eval('!!waveformData.editA'))).toBe(true);
  await expect(alert).toBeHidden();
  await expect(page.locator('#layerEditA video')).toHaveJSProperty('error', null);
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation');
  await page.locator('#preparationBtn').click();
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await expect(page.locator('#localPreparationFiles li')).toHaveCount(0);
  await expect(page.locator('#localPreparationRun')).toBeDisabled();
  expect(await preparationEligibility(page)).toEqual({ listed: [], eligible: [] });
});

test('an unrelated preparation issue survives an audio-read retry', async ({ page }) => {
  await page.addInitScript(() => {
    const pageWindow = window as any;
    pageWindow.__originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name === 'landscape_a.mp4') {
        return Promise.reject(new DOMException('The file could not be read.', 'NotReadableError'));
      }
      return pageWindow.__originalArrayBuffer.call(this);
    };
  });
  await loadFiles(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  await expect(page.locator('#audioTrackAlert')).toContainText('Could not read the audio file');
  await page.evaluate(() => {
    const app = window as any;
    const batch = app.eval('_localPreparationBatch');
    const other = batch.files.find((item: { file: File }) => item.file.name === 'landscape_b.mp4');
    app._localPreparationIssue(other.slot, app.eval('_loadingProgressToken'));
  });
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed');
  await page.evaluate(() => {
    File.prototype.arrayBuffer = (window as any).__originalArrayBuffer;
  });
  await page.keyboard.press('w');
  await expect.poll(() => page.evaluate(() => {
    const batch = (window as any).eval('_localPreparationBatch');
    const slot = batch.files.find((item: { file: File }) => item.file.name === 'landscape_a.mp4').slot;
    return !!(window as any).eval('waveformData')[slot];
  })).toBe(true);
  await expect(page.locator('#audioTrackAlert')).toBeHidden();
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed');
  await page.locator('#preparationBtn').click();
  await expect(page.locator('#localPreparationFiles li')).toHaveText(['landscape_b.mp4']);
  await expect(page.locator('#localPreparationRun')).toBeDisabled();
  const eligibility = await preparationEligibility(page);
  expect(eligibility.listed).toEqual(['landscape_b.mp4']);
  expect(eligibility.eligible).toEqual(['landscape_b.mp4']);
  expect(eligibility.eligible).not.toContain('landscape_a.mp4');
});

test('loaded comparison images use the file name as their accessible name', async ({ page }) => {
  await loadFiles(page, ['green.png']);
  const image = page.locator('#layerEditA img');
  await expect(image).toHaveAttribute('alt', 'green.png');
  await expect(page.getByRole('img', { name: 'green.png' })).toBeVisible();
});

test('no-audio notice stays visible and a failed timecode copy says it failed', async ({ page }) => {
  await loadFiles(page, ['landscape_a.mp4']);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); (window as any)._markSlotNoAudio('editA'); });
  await page.waitForTimeout(250);
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/visible/);
  await expect(toast).toContainText('no audio track');

  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    if (clipboard) clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    const command = document.execCommand.bind(document);
    document.execCommand = ((name: string, ...args: [boolean?, string?]) => name === 'copy' ? false : command(name, ...args)) as typeof document.execCommand;
  });
  await page.keyboard.press('c');
  await expect(toast).toHaveText('Could not copy timecode');
  await expect(toast).not.toHaveText(/Copied/);

  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    if (clipboard) clipboard.writeText = () => Promise.resolve();
  });
  await page.keyboard.press('c');
  await expect(toast).toHaveText(/Copied:/);
});
