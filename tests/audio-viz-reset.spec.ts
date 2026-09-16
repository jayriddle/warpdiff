import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const app = window as any;
    app.__vizPixelCounts = () => ['panelWaveformCanvas', 'spectrogramCanvas'].map(id => {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      if (!canvas.width || !canvas.height) return 0;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let signal = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        // Ignore transparency and the spectrogram's plain #111 background.
        if (pixels[i + 3] && (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2] || pixels[i] > 17)) signal++;
      }
      return signal;
    });
  });
});

async function loadFile(page: Page, file: string) {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures', file));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
}

async function renderedAnalysis(page: Page) {
  await page.waitForFunction(() => (window as any).eval('!!_videoAudioBuffers.editA'));
  await expect.poll(() => page.evaluate(() => (window as any).__vizPixelCounts().every((count: number) => count > 100))).toBe(true);
}

async function delayNextAnalysis(page: Page) {
  await page.evaluate(() => {
    const app = window as any;
    const compute = app._computeAudioAnalysis;
    app.__analysisReleases = [];
    app.__analysisFinished = [];
    app._computeAudioAnalysis = async (...args: any[]) => {
      const index = app.__analysisReleases.length;
      await new Promise(resolve => app.__analysisReleases.push(resolve));
      const result = await compute(...args);
      app.__analysisFinished[index] = true;
      return result;
    };
    // Record the actual bitmap immediately after the real replacement reset,
    // before a later layout or draw can accidentally conceal a missing clear.
    const clear = app.clearAllMedia;
    app.clearAllMedia = (...args: any[]) => {
      clear(...args);
      app.__pixelsAfterClear = app.__vizPixelCounts();
    };
  });
}

for (const closed of [false, true]) {
  test(`replacement clears old audio pixels with the panel ${closed ? 'closed' : 'open'}`, async ({ page }) => {
    await loadFile(page, 'landscape_a.mp4');
    await page.keyboard.press('w');
    await renderedAnalysis(page);
    if (closed) {
      await page.keyboard.press('w');
      await expect(page.locator('#spectrogramPanel')).not.toHaveClass(/active/);
      await page.waitForTimeout(350); // finish the panel's 300 ms collapse
    }
    await delayNextAnalysis(page);
    await loadFile(page, 'landscape_b.mp4');
    expect(await page.evaluate(() => (window as any).__pixelsAfterClear)).toEqual([0, 0]);
    expect(await page.evaluate(() => (window as any).__testAPI.audioVizVisible)).toBe(!closed);
    if (closed) await page.keyboard.press('w');
    await expect(page.locator('#spectrogramPanel')).toHaveClass(/active/);
    await page.waitForFunction(() => (window as any).__analysisReleases.length === 1);
    await page.waitForTimeout(400); // restored panel and deferred draws have settled
    expect(await page.evaluate(() => (window as any).__vizPixelCounts())).toEqual([0, 0]);
    expect(await page.evaluate(() => (window as any).eval('!!waveformData.editA || !!spectrogramData.editA'))).toBe(false);
    await page.evaluate(() => (window as any).__analysisReleases[0]());
    await renderedAnalysis(page);
    const duration = await page.evaluate(() => (window as any).eval('waveformData.editA.duration'));
    expect(duration).toBeGreaterThan(3.9); // B is 4 seconds; the old A was 3 seconds.
    expect(duration).toBeLessThan(4.2);
  });
}

test('a superseded analysis cannot repaint the new comparison', async ({ page }) => {
  await loadFile(page, 'landscape_a.mp4');
  await page.keyboard.press('w');
  await renderedAnalysis(page);
  await delayNextAnalysis(page);
  await loadFile(page, 'landscape_b.mp4');
  await page.waitForFunction(() => (window as any).__analysisReleases.length === 1);
  await loadFile(page, 'landscape_a.mp4');
  await page.waitForFunction(() => (window as any).__analysisReleases.length === 2);
  expect(await page.evaluate(() => (window as any).__pixelsAfterClear)).toEqual([0, 0]);
  await page.evaluate(() => (window as any).__analysisReleases[1]());
  await renderedAnalysis(page);
  const current = await page.evaluate(() => (window as any).eval(`(() => {
    window.__currentAnalysis = {waveform:waveformData.editA, spectrogram:spectrogramData.editA};
    return {duration:waveformData.editA.duration, pixels:window.__vizPixelCounts()};
  })()`));
  await page.evaluate(() => (window as any).__analysisReleases[0]());
  await page.waitForFunction(() => (window as any).__analysisFinished[0] === true);
  expect(await page.evaluate(() => (window as any).eval(`({
    waveform:waveformData.editA === window.__currentAnalysis.waveform,
    spectrogram:spectrogramData.editA === window.__currentAnalysis.spectrogram,
    pixels:window.__vizPixelCounts()
  })`))).toEqual({waveform:true, spectrogram:true, pixels:current.pixels});
  expect(current.duration).toBeLessThan(3.2);
});
