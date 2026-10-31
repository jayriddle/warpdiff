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

test('text fields, sliders, menus, and buttons keep their own keys', async ({ page }) => {
  await loadFiles(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  const index = () => page.evaluate(() => (window as any).__testAPI.currentAssetIndex);
  const format = () => page.evaluate(() => localStorage.getItem('pref_timecopyFmt'));
  expect(await index()).toBe(1);

  await page.keyboard.press('Shift+C');
  const separator = page.locator('.tc-sep-input');
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press('Control+A');
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
  await expect.poll(() => page.evaluate(() => (window as any).eval('!!waveformData.editA'))).toBe(true);
  await expect(alert).toBeHidden();
  await page.keyboard.press('w');
  await expect(page.locator('#spectrogramPanel')).toHaveClass(/active/);
  await expect(page.locator('#layerEditA video')).toHaveJSProperty('error', null);
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
