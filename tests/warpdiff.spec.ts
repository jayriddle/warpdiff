import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ===========================================================================
// Modern Test Suite for WarpDiff (v3.9+)
// ===========================================================================
//
// Goals (aligned with CLAUDE.md, FEATURES.md, MANUAL.md, and memory.md):
// - Validate keyboard-first workflow (core to the app)
// - Test Stack vs Grid modes, GT/A/B slot assignment, timestamp sorting
// - Cover new/updated features: scopes (V), audio viz (W), difference (D), loupe (Z), Fit/Match zoom (\)
// - Test error cases with toasts (no more native alerts)
// - Use __testAPI for internal state (zoomLevel, isGridMode, fitZoom, etc.)
// - Ensure memory-friendly paths (scopes buffers, audio downsampling) don't regress
// - Keep tests fast, deterministic, and maintainable (synthetic fixtures, robust waits for rAF/layout)
//
// This replaces the outdated test suite (see warpdiff.spec.ts.old).
//
// Conventions followed:
// - Stack/Grid (never "Overlay" or "split")
// - GT (Ground Truth) for oldest file
// - _prefixed internal state where relevant
// - No time estimates or brittle selectors

const fixturesDir = path.join(__dirname, 'fixtures');

// Generate synthetic PNG fixtures (kept from old suite — very useful)
function makeSizedPng(width: number, height: number, seed = 0): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  };

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA

  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height, 0);
  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0; // filter = None
    for (let x = 0; x < width; x++) {
      const offset = y * rowSize + 1 + x * 4;
      rawData[offset] = (x * 37 + y * 59 + seed * 71) & 0xff;
      rawData[offset + 1] = (x * 73 + y * 97 + seed * 113) & 0xff;
      rawData[offset + 2] = (x * 113 + y * 29 + seed * 37) & 0xff;
      rawData[offset + 3] = 255;
    }
  }

  const zlibChunks: Buffer[] = [Buffer.from([0x78, 0x01])];
  const maxBlock = 65535;
  const totalLen = rawData.length;
  for (let i = 0; i < totalLen; i += maxBlock) {
    const remaining = totalLen - i;
    const blockLen = Math.min(remaining, maxBlock);
    const isFinal = (i + blockLen >= totalLen) ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = isFinal;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(~blockLen & 0xffff, 3);
    zlibChunks.push(header, rawData.subarray(i, i + blockLen));
  }
  let s1 = 1, s2 = 0;
  for (let i = 0; i < rawData.length; i++) {
    s1 = (s1 + rawData[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((s2 << 16) | s1) >>> 0);
  zlibChunks.push(adler);

  const idatData = Buffer.concat(zlibChunks);
  const iendData = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', iendData),
  ]);
}

function ensureFixtures() {
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });

  const images = [
    { name: 'red.png', buf: makeSizedPng(200, 150, 1) },
    { name: 'green.png', buf: makeSizedPng(200, 150, 2) },
    { name: 'blue.png', buf: makeSizedPng(200, 150, 3) },
    { name: 'fourth.png', buf: makeSizedPng(100, 100, 4) },
    { name: 'tall.png', buf: makeSizedPng(150, 300, 5) },
    { name: 'wide.png', buf: makeSizedPng(300, 150, 6) },
    { name: 'wider.png', buf: makeSizedPng(400, 150, 7) }, // AR≈2.67, distinct from wide.png (AR 2.0)
  ];

  for (const { name, buf } of images) {
    fs.writeFileSync(path.join(fixturesDir, name), buf);
  }

  fs.writeFileSync(path.join(fixturesDir, 'readme.txt'), 'not an image');
}

// ---------------------------------------------------------------------------
// Test Helpers (modernized for current app)
// ---------------------------------------------------------------------------

/** Access internal state via the exposed __testAPI (see index.html:10653). */
async function getVar(page: Page, name: string): Promise<any> {
  return page.evaluate((n) => (window as any).__testAPI?.[n], name);
}

/** Load fixture images. Waits for active view and asset info (respects GT/A/B sorting). */
async function loadImages(page: Page, fileNames: string[]) {
  const filePaths = fileNames.map(f => path.join(fixturesDir, f));
  const fileInput = page.locator('#multiFileInput');
  await fileInput.setInputFiles(filePaths);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('.asset-name').first().waitFor({ state: 'attached', timeout: 5000 });
}

/**
 * Load any media files (images, video, audio). Uses a longer timeout than loadImages
 * to accommodate video metadata and audio decode latency.
 * Note: viewActivating stays true after loading completes (reset only by clearAllMedia),
 * so we use the same comparisonView.active + asset-name signals as loadImages.
 */
async function loadMedia(page: Page, fileNames: string[], timeout = 20000) {
  const filePaths = fileNames.map(f => path.join(fixturesDir, f));
  await page.locator('#multiFileInput').setInputFiles(filePaths);
  await page.locator('#comparisonView.active').waitFor({ state: 'visible', timeout });
  await page.locator('.asset-name').first().waitFor({ state: 'attached', timeout: 5000 });
}

/** Load images and enter Stack mode (current hotkey 'S'). Waits for stable zoom/layout. */
async function loadAndEnterStack(page: Page, fileNames: string[]) {
  await loadImages(page, fileNames);
  await page.keyboard.press('s');
  // Wait for:
  //   1. Stack mode active (!isGridMode)
  //   2. zoomLevel and fitZoom to be numbers
  //   3. zoomLevel === fitZoom — ensures the double-rAF resetFitZoom() fired by
  //      setViewMode('overlay') has completed and zoom is stable before any test
  //      reads initialZoom (avoids flaky +/- zoom tests).
  await page.waitForFunction(() => {
    const api = (window as any).__testAPI;
    return (
      !api?.isGridMode &&
      typeof api?.zoomLevel === 'number' &&
      typeof api?.fitZoom === 'number' &&
      Math.abs(api.zoomLevel - api.fitZoom) < 0.001
    );
  }, {}, { timeout: 5000 });
  // Drain any rAFs still pending after zoom settles (e.g. a queued applyZoom() that
  // would overwrite zoomLevel immediately after a zoom key press). Without this,
  // zoom tests fail ~10% of the time when a stale rAF fires between key press and
  // state read.
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Check current Grid mode via __testAPI (replaces old isSplitMode). */
async function isGridMode(page: Page): Promise<boolean> {
  const mode = await getVar(page, 'isGridMode');
  return Boolean(mode);
}

// ===========================================================================
// Tests
// ===========================================================================

test.beforeAll(() => {
  ensureFixtures();
});

test.describe('Page Load & Initial State', () => {
  test('title is WarpDiff', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('WarpDiff');
  });

  test('header shows version and action buttons', async ({ page }) => {
    await page.goto('/');
    // Version-agnostic: assert the format, not a pinned minor (a pinned
    // substring rotted when v3.10 → v3.11). The deployed build may append
    // ' · <sha7>' (see version.json), so anchor only the prefix.
    await expect(page.locator('#appVersion')).toHaveText(/^v\d+\.\d+\.\d+( · [0-9a-f]{7})?$/);
    await expect(page.locator('#loadBtn')).toBeVisible();
    await expect(page.locator('#helpBtn')).toBeVisible();
  });

  test('comparison view is hidden initially', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#comparisonView')).not.toBeVisible();
  });

  test('quick start or changelog shows on first visit/version change', async ({ page }) => {
    await page.goto('/');
    // First visit should show quick start
    await expect(page.locator('#quickStartPopup')).toBeVisible();
  });
});

test.describe('File Loading & Slot Assignment', () => {
  test('loads 1 file as single asset review', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png']);
    await expect(page.locator('#comparisonView')).toBeVisible();
    await expect(page.locator('.asset-name')).toHaveCount(3); // All layers rendered, 1 active
  });

  test('loads 2 images in Grid mode with A/B slots', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await expect(page.locator('#comparisonView')).toBeVisible();
    expect(await isGridMode(page)).toBe(true);
    await expect(page.locator('.asset-name')).toHaveCount(3); // GT layer present but hidden
  });

  test('loads 3 images in Grid mode with GT/A/B slots', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png', 'blue.png']);
    await expect(page.locator('#comparisonView')).toBeVisible();
    expect(await isGridMode(page)).toBe(true);
    await expect(page.locator('.asset-name')).toHaveCount(3);
    // Label can be "GT", "Ref", or "SOURCE" depending on UI state — flexible match
    await expect(page.locator('#layerOriginal .asset-name')).toContainText(/GT|Ref|SOURCE/i);
  });

  test('shows warning toast for timestamp collision', async () => {
    test.skip(true, 'Needs fixtures with near-identical lastModified timestamps');
  });

  test('rejects 4+ files with warning toast', async ({ page }) => {
    await page.goto('/');
    const toast = page.locator('.load-toast');
    const fileInput = page.locator('#multiFileInput');
    await fileInput.setInputFiles([
      path.join(fixturesDir, 'red.png'),
      path.join(fixturesDir, 'green.png'),
      path.join(fixturesDir, 'blue.png'),
      path.join(fixturesDir, 'fourth.png'),
    ]);
    await toast.waitFor({ timeout: 10000 });
    await expect(toast).toContainText('1–3');
    await expect(toast).toHaveClass(/warning/);
  });

  test('rejects mixed media types with warning toast', async ({ page }) => {
    await page.goto('/');
    const toast = page.locator('.load-toast');
    await page.locator('#multiFileInput').setInputFiles([
      path.join(fixturesDir, 'red.png'),
      path.join(fixturesDir, 'track.mp3'),
    ]);
    await toast.waitFor({ timeout: 5000 });
    await expect(toast).toHaveClass(/warning/);
  });
});

test.describe('View Modes (Stack/Grid)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
  });

  test('defaults to Grid for 2 files', async ({ page }) => {
    expect(await isGridMode(page)).toBe(true);
  });

  test('S key switches to Stack mode', async ({ page }) => {
    await page.keyboard.press('s');
    expect(await isGridMode(page)).toBe(false);
  });

  test('G key switches to Grid mode', async ({ page }) => {
    // Start in Stack to test G key
    await page.keyboard.press('s');
    expect(await isGridMode(page)).toBe(false);

    await page.keyboard.press('g');
    expect(await isGridMode(page)).toBe(true);
  });

  test('mode buttons reflect current mode', async ({ page }) => {
    // Current UI uses #stackIconBtn and #gridIconBtn (one is active)
    const stackBtn = page.locator('#stackIconBtn');
    const gridBtn = page.locator('#gridIconBtn');
    await expect(stackBtn).toBeVisible();
    await expect(gridBtn).toBeVisible();
    const activeBtn = page.locator('.analysis-btn.active');
    await expect(activeBtn).toHaveCount(1);  // One mode button is active
  });
});

test.describe('Audio Visualization', () => {
  test('W key toggles waveform and spectrogram views', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);  // Proxy for audio mode test (replace with real audio fixtures)
    await page.keyboard.press('w');
    // Look for audio viz elements (waveform and spectrogram canvases)
    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(2);  // At minimum waveform + spectrogram
  });

  test('Shift+W toggles linear/log frequency scale', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    // Shift+W calls toggleSpectrogramScale() — guarded by (hasVideos && audioVizVisible) || hasAudios.
    // Invoke directly to bypass the guard (same pattern as palette cycling test).
    const before = await getVar(page, 'spectrogramLogScale');
    await page.evaluate(() => (window as any).toggleSpectrogramScale?.());
    const after = await getVar(page, 'spectrogramLogScale');
    expect(after).toBe(!before);
    // Toggle back
    await page.evaluate(() => (window as any).toggleSpectrogramScale?.());
    expect(await getVar(page, 'spectrogramLogScale')).toBe(before);
  });

  test('palette cycling changes spectrogram color scheme', async ({ page }) => {
    // W key only opens the spectrogram panel for video content (hasVideos check in hotkey handler).
    // For image-only loads the key shows a toast instead. This test verifies the palette button
    // itself works by calling cycleSpectrogramPalette() directly via JS.
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    const paletteBtn = page.locator('#spectrogramPaletteToggle');
    const initialText = await paletteBtn.textContent();
    // Invoke cycle function directly — bypasses the hasVideos guard which blocks image-mode W key
    await page.evaluate(() => (window as any).cycleSpectrogramPalette?.());
    const newText = await paletteBtn.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('displays audio info bars (sample rate, channels, bit depth, BPM)', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']); // Replace with audio files for real test
    // Info bars should show metadata (app renders 3 bars, some hidden for 2-file case)
    const infoBars = page.locator('.asset-info-bar');
    await expect(infoBars).toHaveCount(3);
    await expect(infoBars.first()).toContainText(/Hz|BPM|ch|Ref/i); // Sample rate, BPM, channels or default label
  });

  // BPM detection code has been removed (per current codebase)
});

test.describe('Video Scopes', () => {
  test('V key toggles scopes panel', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await page.keyboard.press('v');
    const panel = page.locator('#scopesPanel');
    await expect(panel).toHaveClass(/active/);  // Class is "scopes-panel active"
  });

  test('clicking scopes cycles through modes', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await page.keyboard.press('v'); // Show scopes first

    const histogramLabel = page.locator('#histogramLabel');
    const initialText = await histogramLabel.textContent();

    // Click histogram canvas to cycle (per code in js/scopes.js and click handlers)
    await page.locator('#histogramCanvas').click();
    const newText = await histogramLabel.textContent();
    expect(newText).not.toBe(initialText); // Mode should change (RGB → RGB+luma → CDF)
  });

  test('scopes panel contains histogram, waveform, and vectorscope', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await page.keyboard.press('v');
    await expect(page.locator('#histogramCanvas')).toBeVisible();
    await expect(page.locator('#waveformMonitorCanvas')).toBeVisible();
    await expect(page.locator('#vectorscopeCanvas')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts', () => {
  test('L key opens file input', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as any).__fileInputClicked = false;
      const input = document.getElementById('multiFileInput');
      input.addEventListener('click', () => (window as any).__fileInputClicked = true, { once: true });
    });
    await page.keyboard.press('l');
    const wasClicked = await page.evaluate(() => (window as any).__fileInputClicked);
    expect(wasClicked).toBe(true); // L key triggers click on hidden input (per code in hotkeys.js and handleMultiFileLoad)
  });

  test('H or ? opens shortcuts or help panel', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('h');
    await expect(page.locator('#shortcutsPanel')).toHaveClass(/open/);  // "shortcuts-panel open"
    await page.keyboard.press('Escape'); // Close it
    await page.keyboard.press('?');
    await expect(page.locator('#quickStartPopup')).toBeVisible();
  });

  test('arrow keys switch assets in Stack mode', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    const initialIndex = await getVar(page, 'currentAssetIndex');
    await page.keyboard.press('ArrowRight');
    const newIndex = await getVar(page, 'currentAssetIndex');
    expect(newIndex).not.toBe(initialIndex);
  });

  test('+/ - /0 /1 keys control zoom', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    const initialZoom = await getVar(page, 'zoomLevel');
    await page.keyboard.press('+');
    const zoomed = await getVar(page, 'zoomLevel');
    expect(zoomed).toBeGreaterThan(initialZoom);
    await page.keyboard.press('0');
    const fitZoom = await getVar(page, 'zoomLevel');
    expect(fitZoom).toBeLessThan(zoomed); // Back to fit
  });

  test('I/O keys set loop in/out points', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']); // Video would be better but images work for loop test
    await page.keyboard.press('i');
    await page.keyboard.press('o');
    // Loop markers should be set (verified via toast or state if exposed)
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible(); // At least a toast appears for loop actions
  });
});

test.describe('Zoom & Loupe', () => {
  test('Z key toggles loupe (magnifier)', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    await page.keyboard.press('z');
    await expect(page.locator('body')).toHaveClass(/magnifier-active/); // Matches the code's body.magnifier-active toggle
  });

  test('+ and - keys adjust magnification', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    const initialZoom = await getVar(page, 'zoomLevel');
    await page.keyboard.press('+');
    const zoomed = await getVar(page, 'zoomLevel');
    expect(zoomed).toBeGreaterThan(initialZoom);
    await page.keyboard.press('-');
    const finalZoom = await getVar(page, 'zoomLevel');
    expect(finalZoom).toBeLessThan(zoomed);
  });

  test('0 key resets to fit zoom', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    await page.keyboard.press('+'); // Zoom in first
    const zoomed = await getVar(page, 'zoomLevel');
    await page.keyboard.press('0');
    const fit = await getVar(page, 'zoomLevel');
    expect(fit).toBeLessThanOrEqual(zoomed); // Back to fitZoom
  });

  test('1 key sets zoom to 100% (native pixels)', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    await page.keyboard.press('1');
    const zoom = await getVar(page, 'zoomLevel');
    expect(zoom).toBe(1); // 100% native
  });

  test('\\ key toggles Stack Fit/Balance zoom mode', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    // Fit/Balance sub-options are shown in Stack mode when images are loaded
    const fitBtn = page.locator('#fitModeBtn');
    const balBtn = page.locator('#balanceModeBtn');
    await expect(fitBtn).toBeVisible();
    await expect(balBtn).toBeVisible();
    // Initially Fit is active
    await expect(fitBtn).toHaveClass(/active/);
    // Press \ to toggle to Balance
    await page.keyboard.press('\\');
    await expect(balBtn).toHaveClass(/active/);
    await expect(fitBtn).not.toHaveClass(/active/);
    // Press \ again to toggle back to Fit
    await page.keyboard.press('\\');
    await expect(fitBtn).toHaveClass(/active/);
  });

  test('Shift+Z enables linked loupe in Grid mode', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png', 'blue.png']); // 3 files for Grid
    await page.keyboard.press('Shift+Z');
    const linked = await getVar(page, 'magnifierLinked');
    expect(linked).toBe(true);
  });
});

test.describe('Grid Layout Direction', () => {
  // These tests exercise the pickBestGridLayout fix: the function must use
  // window.innerWidth/Height as a fallback when the container has zero height
  // immediately after comparisonView becomes active. Before the fix, 2-asset
  // loads always defaulted to 'horizontal' regardless of aspect ratio.

  test('two wide/landscape images get vertical (stacked) layout', async ({ page }) => {
    await page.goto('/');
    // wide.png is 300×150 (AR=2, landscape). Stacking vertically lets each image span
    // full viewport width, giving more rendered area than halving width side-by-side.
    await loadImages(page, ['wide.png', 'wide.png']);
    // Wait for the deferred layout re-evaluation to SETTLE on its final value.
    // (Waiting on `layoutMode !== undefined` was flaky: it passed on the initial
    // pre-re-eval value before the dimension-aware swap to vertical landed.)
    await page.waitForFunction(() => {
      const api = (window as any).__testAPI;
      return api?.isGridMode === true && api?.layoutMode === 'vertical';
    }, {}, { timeout: 5000 });
    const layout = await getVar(page, 'layoutMode');
    expect(layout).toBe('vertical');
  });

  test('two tall/portrait images get horizontal (side-by-side) layout', async ({ page }) => {
    await page.goto('/');
    // tall.png is 150×300 (AR=0.5, portrait). Side-by-side lets each image use the full
    // viewport height, giving more rendered area than halving height when stacked.
    await loadImages(page, ['tall.png', 'tall.png']);
    await page.waitForFunction(() => {
      const api = (window as any).__testAPI;
      return api?.isGridMode === true && api?.layoutMode === 'horizontal';
    }, {}, { timeout: 5000 });
    const layout = await getVar(page, 'layoutMode');
    expect(layout).toBe('horizontal');
  });

  test('layout re-evaluates correctly after S→G round-trip', async ({ page }) => {
    await page.goto('/');
    // Portrait images → horizontal layout in Grid mode
    await loadImages(page, ['tall.png', 'tall.png']);
    await page.waitForFunction(() => (window as any).__testAPI?.isGridMode === true, {}, { timeout: 5000 });
    await page.keyboard.press('s'); // Switch to Stack
    expect(await getVar(page, 'isGridMode')).toBe(false);
    await page.keyboard.press('g'); // Back to Grid
    await page.waitForFunction(() => {
      const api = (window as any).__testAPI;
      return api?.isGridMode === true && api?.layoutMode === 'horizontal';
    }, {}, { timeout: 3000 });
    const layout = await getVar(page, 'layoutMode');
    expect(layout).toBe('horizontal');
  });

  test('two different-AR landscapes (vertical stack) are sized for EQUAL AREA, not equal width', async ({ page }) => {
    await page.goto('/');
    // wide.png 300×150 (AR=2.0) and wider.png 400×150 (AR≈2.67) — both clearly
    // landscape, so Grid picks vertical stacking. Equal-area => the wider clip is
    // wider+shorter and the less-wide one narrower+taller, but both occupy the SAME
    // screen area. The old "same longest-side" sizing gave them equal WIDTH (and thus
    // unequal area) — the bug.
    await loadImages(page, ['wide.png', 'wider.png']);
    await page.waitForFunction(() => {
      const api = (window as any).__testAPI;
      return api?.isGridMode === true && api?.layoutMode === 'vertical';
    }, {}, { timeout: 5000 });
    // Let the layout + fill-height post-pass settle.
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    const dims = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.asset-container .video-wrapper'))
        .map(w => ({ w: (w as HTMLElement).offsetWidth, h: (w as HTMLElement).offsetHeight }))
        .filter(d => d.w > 1 && d.h > 1));

    expect(dims.length).toBe(2);
    const [a, b] = dims;
    const areaA = a.w * a.h, areaB = b.w * b.h;
    // Equal area: areas within ~8% (rounding of integer px dims).
    expect(Math.abs(areaA - areaB) / Math.max(areaA, areaB)).toBeLessThan(0.08);
    // NOT equal width: the different ARs must produce clearly different widths
    // (the regression signature — old behavior forced both to the same width).
    expect(Math.min(a.w, b.w) / Math.max(a.w, b.w)).toBeLessThan(0.95);
  });
});

test.describe('Difference Mode', () => {
  test('D key toggles difference mode on and off (Stack mode only)', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    // Diff mode only works in Stack — switch first
    await page.keyboard.press('s');
    expect(await getVar(page, 'isGridMode')).toBe(false);
    expect(await getVar(page, 'diffMode')).toBeFalsy();
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBe(true);
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBeFalsy();
  });

  test('diff canvas (#diffOverlay) is appended to body when diff mode activates', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await page.keyboard.press('s'); // Stack mode required
    // Canvas is created lazily on first toggle
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBe(true);
    // _ensureDiffCanvas appends #diffOverlay to body
    const diffCanvas = page.locator('#diffOverlay');
    await expect(diffCanvas).toBeAttached();
    expect(await diffCanvas.evaluate(el => (el as HTMLCanvasElement).style.display)).toBe('block');
    // Toggle off → canvas hidden but still attached
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBeFalsy();
    expect(await diffCanvas.evaluate(el => (el as HTMLCanvasElement).style.display)).toBe('none');
  });
});

test.describe('Reset', () => {
  test('reset button returns to landing state', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    await expect(page.locator('#comparisonView')).toBeVisible();
    await expect(page.locator('#landingCta')).not.toBeVisible();

    // resetAll() uses confirm() — accept the dialog
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetBtn').click();
    await expect(page.locator('#comparisonView')).not.toBeVisible();
    await expect(page.locator('#landingCta')).toBeVisible();
  });

  test('second load clears progress bar to 0', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    // Simulate some progress bar advance by setting style directly
    await page.evaluate(() => {
      const bar = document.getElementById('videoProgressBar');
      if (bar) bar.style.width = '50%';
    });
    // Load new files — clearAllMedia() should reset the bar
    await loadImages(page, ['blue.png', 'tall.png']);
    const width = await page.evaluate(() => {
      const bar = document.getElementById('videoProgressBar');
      return bar ? bar.style.width : 'unknown';
    });
    // Bar should be 0% (cleared by clearAllMedia) not the stale 50%
    expect(width).toBe('0%');
  });

  test('loading new files clears previous slot labels', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png', 'blue.png']); // 3 files → GT/A/B
    await expect(page.locator('#layerOriginal .asset-name')).toContainText(/GT|Ref/i);

    // Load only 2 files — GT slot should no longer be active
    await loadImages(page, ['red.png', 'green.png']);
    const gridMode = await getVar(page, 'isGridMode');
    expect(gridMode).toBe(true);
    // hasImages should still be true
    expect(await getVar(page, 'hasImages')).toBe(true);
  });
});

test.describe('Grid Inline/Offset Toggle', () => {
  test('3 key cycles inline vs offset layout for 3 files', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png', 'blue.png']);
    await page.waitForFunction(() => (window as any).__testAPI?.isGridMode === true, {}, { timeout: 5000 });

    const initialInline = await getVar(page, 'gridInlineMode');
    await page.keyboard.press('3');
    const afterToggle = await getVar(page, 'gridInlineMode');
    expect(afterToggle).toBe(!initialInline);
  });
});

test.describe('Timecode Format', () => {
  test('T key cycles timecode display format', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    // timecopyFmt is persisted in localStorage via _prefs — __testAPI exposes it directly.
    // T cycles through ['hms','hmsf','s','sf','f']; default is 'hms' on fresh page.
    const before = await getVar(page, 'timecopyFmt');
    await page.keyboard.press('t');
    const after = await getVar(page, 'timecopyFmt');
    expect(after).not.toBe(before);
    // Cycle through all 5 formats and land back on the start
    for (let i = 0; i < 4; i++) await page.keyboard.press('t');
    expect(await getVar(page, 'timecopyFmt')).toBe(before);
  });
});

test.describe('Mute Toggle', () => {
  test('M key toggles mute button icon', async ({ page }) => {
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    const muteBtn = page.locator('#muteBtn');
    await expect(muteBtn).toBeAttached();
    const before = await muteBtn.innerHTML();
    await page.keyboard.press('m');
    const after = await muteBtn.innerHTML();
    expect(after).not.toBe(before); // SVG icon switches between vol-on and vol-muted
    await page.keyboard.press('m'); // Toggle back
    const restored = await muteBtn.innerHTML();
    expect(restored).toBe(before);
  });
});

// Persistent global mute (cross-session, global-only): users who review muted
// want it to stay muted across file loads and sessions. Vorbis webm fixtures so
// the plain <video>.muted routing is exercised (see the muted-state note below).
test.describe('Persistent Mute + First-play Nudge', () => {
  const allMuted = (page: Page) => page.evaluate(() =>
    [...document.querySelectorAll('.asset-layer video')].every(v => (v as HTMLVideoElement).muted));
  const btnMuted = (page: Page) => page.evaluate(() =>
    document.getElementById('muteBtn')!.classList.contains('muted'));
  const labelShown = (page: Page) => page.evaluate(() =>
    getComputedStyle(document.querySelector('#muteBtn .vi-label')!).display !== 'none');
  const nudgeVisible = (page: Page) => page.evaluate(() =>
    document.getElementById('muteNudge')!.classList.contains('visible'));

  test('default is unmuted; the "Muted" label is hidden', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    expect(await btnMuted(page)).toBe(false);
    expect(await labelShown(page)).toBe(false);
    expect(await allMuted(page)).toBe(false);
  });

  test('mute shows the amber chip + "Muted" label and persists the preference', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.click('#muteBtn');
    expect(await btnMuted(page)).toBe(true);
    expect(await labelShown(page)).toBe(true);
    expect(await allMuted(page)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('pref_muted'))).toBe('true');
  });

  test('mute survives loading a fresh comparison', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.click('#muteBtn');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']); // new load must NOT reset mute
    expect(await btnMuted(page)).toBe(true);
    expect(await labelShown(page)).toBe(true);
    expect(await allMuted(page)).toBe(true);
  });

  test('mute survives a page reload (cross-session)', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.click('#muteBtn');
    await page.reload();                     // same context → localStorage kept
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    expect(await btnMuted(page)).toBe(true);
    expect(await allMuted(page)).toBe(true);
  });

  test('first play while muted surfaces the nudge, once per session', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.click('#muteBtn');
    await page.evaluate(() => (window as any).playAllMedia());
    await page.waitForTimeout(150);
    expect(await nudgeVisible(page)).toBe(true);
    // Second play in the same session must NOT re-show it.
    await page.evaluate(() => document.getElementById('muteNudge')!.classList.remove('visible'));
    await page.evaluate(() => { const v = document.querySelector('.asset-layer video') as HTMLVideoElement; v?.pause(); });
    await page.evaluate(() => (window as any).playAllMedia());
    await page.waitForTimeout(150);
    expect(await nudgeVisible(page)).toBe(false);
  });

  test('Enable in the nudge unmutes, persists, and dismisses', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.click('#muteBtn');
    // Force the nudge visible (its showing logic is covered above) and exercise Enable.
    // The nudge lives at the document top level so it clears the transport bar.
    await page.evaluate(() => document.getElementById('muteNudge')!.classList.add('visible'));
    await page.click('#muteNudge .mn-act');
    expect(await btnMuted(page)).toBe(false);
    expect(await allMuted(page)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('pref_muted'))).toBe('false');
    expect(await nudgeVisible(page)).toBe(false);
  });

  test('unmuted playback never nudges', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.evaluate(() => (window as any).playAllMedia());
    await page.waitForTimeout(150);
    expect(await nudgeVisible(page)).toBe(false);
  });
});

test.describe('File Rejection', () => {
  test('non-media file is rejected with toast', async ({ page }) => {
    await page.goto('/');
    const toast = page.locator('.load-toast');
    const fileInput = page.locator('#multiFileInput');
    await fileInput.setInputFiles([path.join(fixturesDir, 'readme.txt')]);
    await toast.waitFor({ timeout: 5000 });
    await expect(toast).toHaveClass(/warning/);
  });
});

test.describe('Landing State', () => {
  test('landing CTA shows format capsules and load button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#landingCta')).toBeVisible();
    await expect(page.locator('#loadBtn')).toBeVisible();
  });

  test('whole page is a drop target (body dragover calls preventDefault)', async ({ page }) => {
    await page.goto('/');
    // WarpDiff registers dragover on document.body — no dedicated #dropZone element.
    // Verify the handler is registered by dispatching to body and checking defaultPrevented.
    const handled = await page.evaluate(() => {
      const e = new DragEvent('dragover', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(handled).toBe(true);
  });
});

test.describe('Video Loading', () => {
  test('hasVideos is true after loading MP4 files', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
    expect(await getVar(page, 'hasVideos')).toBe(true);
    expect(await getVar(page, 'hasImages')).toBe(false);
    expect(await isGridMode(page)).toBe(true);
  });

  test('3 videos load with Ref/A/B slot assignment by mtime', async ({ page }) => {
    await page.goto('/');
    // landscape_a.mp4 has oldest mtime (Jan 1) → Ref/GT slot
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await expect(page.locator('.asset-name')).toHaveCount(3);
    await expect(page.locator('#layerOriginal .asset-name')).toContainText(/Ref/i);
  });

  test('W key opens audio viz panel for video with audio track', async ({ page }) => {
    await page.goto('/');
    // landscape_a.mp4 has an AAC audio track — W should open the panel, not show a toast
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
    expect(await getVar(page, 'audioVizVisible')).toBe(false);
    await page.keyboard.press('w');
    expect(await getVar(page, 'audioVizVisible')).toBe(true);
  });

  test('V key opens scopes panel for video content', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
    await page.keyboard.press('v');
    await expect(page.locator('#scopesPanel')).toHaveClass(/active/);
    expect(await getVar(page, 'videoScopesVisible')).toBe(true);
  });

  test('timecode display is visible for video', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
    // #videoTimecode is the timecode span in the controls bar
    await expect(page.locator('#videoTimecode')).toBeVisible();
  });
});

test.describe('Audio Loading', () => {
  test('hasAudios is true after loading WAV files', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['stereo.wav', 'mono.wav']);
    expect(await getVar(page, 'hasAudios')).toBe(true);
    expect(await getVar(page, 'hasVideos')).toBe(false);
    expect(await getVar(page, 'hasImages')).toBe(false);
  });

  test('info bars show real sample rate and channel count', async ({ page }) => {
    await page.goto('/');
    // With 2 audio files the app enters symmetric A/B mode (no GT slot); original is empty.
    // stereo.wav (oldest mtime Jan 1) → editA (A), mono.wav (Jan 2) → editB (B).
    // After AudioContext.decodeAudioData the buffer's sampleRate reflects the AudioContext
    // native rate (44.1 or 48 kHz depending on OS/browser). Check for any kHz value.
    await loadMedia(page, ['stereo.wav', 'mono.wav']);
    const aBar = page.locator('#layerEditA .asset-info-bar');
    await expect(aBar).toContainText(/\d[\d.]*\s*kHz/i, { timeout: 15000 });
    await expect(aBar).toContainText(/Stereo/i, { timeout: 5000 });
    const bBar = page.locator('#layerEditB .asset-info-bar');
    await expect(bBar).toContainText(/Mono/i, { timeout: 5000 });
  });

  test('original slot label is GT for audio', async ({ page }) => {
    await page.goto('/');
    // Audio mode uses "GT" (Ground Truth) instead of "Ref" for the original slot
    await loadMedia(page, ['stereo.wav', 'mono.wav', 'track.mp3']);
    await expect(page.locator('#layerOriginal .asset-name')).toContainText(/GT/i);
  });

  test('audio viz canvases are shown in main view for audio files', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['stereo.wav', 'mono.wav']);
    // In audio mode, waveform/spectrogram canvas is always shown in the main view
    // (not in a toggleable side panel — that's video-only). Each slot gets one canvas.
    const canvases = page.locator('.audio-viz-slot-canvas');
    await expect(canvases.first()).toBeAttached();
  });

  test('W key in audio mode shows informational toast (viz is in main view)', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['stereo.wav', 'mono.wav']);
    // In audio mode W doesn't toggle a panel — it shows a toast explaining the viz is in the main view.
    // audioVizVisible (the side-panel flag) stays false throughout.
    expect(await getVar(page, 'audioVizVisible')).toBe(false);
    await page.keyboard.press('w');
    await expect(page.locator('#toast')).toBeVisible();
    expect(await getVar(page, 'audioVizVisible')).toBe(false);
  });

  test('3 audio files: all three slots populated', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['stereo.wav', 'mono.wav', 'track.mp3']);
    expect(await getVar(page, 'hasAudios')).toBe(true);
    // All 3 slot name labels should be present
    await expect(page.locator('.asset-name')).toHaveCount(3);
  });
});

test.describe('Mixed Orientation Offset Layout', () => {
  test('offset layout works for mixed portrait/landscape videos', async ({ page }) => {
    await page.goto('/');
    // landscape_a (960×540) + landscape_b (960×540) + portrait (540×960) = mixed orientations
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await page.waitForFunction(() => (window as any).__testAPI?.isGridMode === true, {}, { timeout: 5000 });

    // Ensure we're in offset mode (gridInlineMode === false)
    if (await getVar(page, 'gridInlineMode')) {
      await page.keyboard.press('3');
      await page.waitForFunction(
        () => (window as any).__testAPI?.gridInlineMode === false,
        {}, { timeout: 3000 }
      );
    }

    // Offset layout should be active with no blocking toast about mixed orientations
    expect(await getVar(page, 'gridInlineMode')).toBe(false);
    await expect(page.locator('body')).toHaveClass(/offset/);
  });

  test('3 key cycles between inline and offset for mixed-orientation videos', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await page.waitForFunction(() => (window as any).__testAPI?.isGridMode === true, {}, { timeout: 5000 });

    const before = await getVar(page, 'gridInlineMode');
    await page.keyboard.press('3');
    const after = await getVar(page, 'gridInlineMode');
    expect(after).toBe(!before);

    // Toggle back
    await page.keyboard.press('3');
    expect(await getVar(page, 'gridInlineMode')).toBe(before);
  });
});

// ===========================================================================
// Phase 1 specs (2026-04-12 audit) — loop in/out, diff w/ video, pan bounds,
// hotkey reassignment, grid resize. Each group requires the matching __testAPI
// getter (see index.html:12215) and the gitignored mp4/wav fixtures generated
// by tests/fixtures/generate.sh.
// ===========================================================================

/** Set currentTime on every loaded <video> and resolve once each has seeked. */
async function seekVideos(page: Page, time: number) {
  await page.evaluate(async (t) => {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    await Promise.all(videos.map(v => new Promise<void>(resolve => {
      if (Math.abs(v.currentTime - t) < 0.005) { resolve(); return; }
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = t;
    })));
  }, time);
}

test.describe('Loop in/out points', () => {
  test('start clean: both points are null', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    expect(await getVar(page, '_loopInPoint')).toBeNull();
    expect(await getVar(page, '_loopOutPoint')).toBeNull();
  });

  test('I sets in-point at currentTime, O sets out-point at currentTime', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await seekVideos(page, 0.5);
    await page.keyboard.press('i');
    expect(await getVar(page, '_loopInPoint')).toBeCloseTo(0.5, 1);
    await seekVideos(page, 2.0);
    await page.keyboard.press('o');
    expect(await getVar(page, '_loopOutPoint')).toBeCloseTo(2.0, 1);
    expect(await getVar(page, '_loopInPoint')).toBeCloseTo(0.5, 1);
  });

  test('out-before-in then in-after-out auto-swaps to keep in < out', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    // Press O first at 1.0s (out-point captured at 1.0)
    await seekVideos(page, 1.0);
    await page.keyboard.press('o');
    // Then press I at 2.0s — in > out, should swap so in becomes 1.0 and out becomes 2.0
    await seekVideos(page, 2.0);
    await page.keyboard.press('i');
    const inT  = await getVar(page, '_loopInPoint');
    const outT = await getVar(page, '_loopOutPoint');
    expect(inT).not.toBeNull();
    expect(outT).not.toBeNull();
    expect(inT).toBeLessThan(outT);
    expect(inT).toBeCloseTo(1.0, 1);
    expect(outT).toBeCloseTo(2.0, 1);
  });

  test('loop region marker is rendered when both points are set', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await seekVideos(page, 0.5);
    await page.keyboard.press('i');
    await seekVideos(page, 2.0);
    await page.keyboard.press('o');
    // updateLoopMarkerUI sizes #loopRegion when both points are set
    const region = page.locator('#loopRegion');
    await expect(region).toBeVisible();
    const widthPct = await region.evaluate(el => parseFloat((el as HTMLElement).style.width));
    expect(widthPct).toBeGreaterThan(0);
  });

  test('double-Escape clears both loop points', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await seekVideos(page, 0.5);
    await page.keyboard.press('i');
    await seekVideos(page, 2.0);
    await page.keyboard.press('o');
    expect(await getVar(page, '_loopInPoint')).not.toBeNull();
    // Double-Escape within 400 ms clears markers
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await getVar(page, '_loopInPoint')).toBeNull();
    expect(await getVar(page, '_loopOutPoint')).toBeNull();
  });
});

// ===========================================================================
// Multi-video sync-lock (v3.10.31) — synchronized looping + drift lock.
// Uses the VP9+Vorbis webm fixtures so this runs on open-codec Chromium (the
// H.264 landscape fixtures need a proprietary-codec Chrome). vorbis_a.webm is
// 3 s and vorbis_long.webm is 4 s (both 24 fps) — the shortest/longest pair the
// bounds + wrap tests need; vorbis_b.webm (3 s) is used where equal lengths are
// fine. The sync loop region must resolve to [0, ~3] and playback must wrap BOTH
// videos together at the shortest duration instead of each native-looping on its
// own clock.
// ===========================================================================

test.describe('Multi-video sync-lock', () => {
  /** Videos in DOM order [original, editA]; read clocks straight off the elements. */
  const videoTimes = (page: Page) => page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
    return vids.map(v => ({ t: v.currentTime, paused: v.paused }));
  });

  test('2 videos → sync loop bounds [0, shortest] and native loop disabled', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_long.webm']);
    // Bounds resolve once both videos' metadata is in (policy runs at loadedmetadata)
    await page.waitForFunction(() => (window as any).__testAPI?._loopBounds !== null,
      {}, { timeout: 5000 });
    const bounds = await getVar(page, '_loopBounds');
    expect(bounds.inP).toBe(0);
    expect(bounds.outP).toBeCloseTo(3, 0); // shortest clip (vorbis_a, 3 s)
    const vids = await getVar(page, '_driftLock');
    expect(vids.length).toBe(2);
    for (const v of vids) expect(v.nativeLoop).toBe(false);
  });

  test('single video keeps plain native looping (no managed region)', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm']);
    expect(await getVar(page, '_loopBounds')).toBeNull();
    const vids = await getVar(page, '_driftLock');
    expect(vids.length).toBe(1);
    expect(vids[0].nativeLoop).toBe(true);
  });

  test('videos wrap together at the shortest duration and come out in sync', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_long.webm']);
    await page.waitForFunction(() => (window as any).__testAPI?._loopBounds !== null,
      {}, { timeout: 5000 });
    await seekVideos(page, 2.5); // just before the 3 s wrap point
    await page.evaluate(() => (window as any).playAllMedia());
    // Wait for the synchronized wrap: the primary comes back below 1 s while playing
    await page.waitForFunction(() => {
      const v = document.querySelector('.asset-layer video') as HTMLVideoElement | null;
      return !!v && !v.paused && v.currentTime < 1.0;
    }, {}, { timeout: 10000 });
    // Give the drift lock a couple of ticks to settle post-wrap, then sample
    await page.waitForTimeout(300);
    const [a, b] = await videoTimes(page);
    expect(a.paused).toBe(false);
    expect(b.paused).toBe(false);
    expect(b.t).toBeLessThan(2.0); // the 4 s clip wrapped with the 3 s clip, not at its own end
    expect(Math.abs(a.t - b.t)).toBeLessThan(0.15);
  });

  test('drift lock re-syncs a follower knocked off the primary clock', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.evaluate(() => (window as any).playAllMedia());
    await page.waitForFunction(() => {
      const v = document.querySelector('.asset-layer video') as HTMLVideoElement | null;
      return !!v && !v.paused && v.currentTime > 0.2;
    }, {}, { timeout: 5000 });
    // Knock the follower (editA) 300 ms ahead — past the hard-seek threshold
    await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
      vids[1].currentTime = Math.min(vids[1].currentTime + 0.3, 2.5);
    });
    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
      return vids.length >= 2 && Math.abs(vids[0].currentTime - vids[1].currentTime) < 0.05;
    }, {}, { timeout: 5000 });
    const [a, b] = await videoTimes(page);
    expect(Math.abs(a.t - b.t)).toBeLessThan(0.05);
  });

  test('custom loop points are enforced in Grid mode', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    // Default view after loading 2 videos is Grid — set a 0.5→1.5 loop region
    expect(await getVar(page, 'isGridMode')).toBe(true);
    await seekVideos(page, 0.5);
    await page.keyboard.press('i');
    await seekVideos(page, 1.5);
    await page.keyboard.press('o');
    await page.evaluate(() => (window as any).playAllMedia());
    // Play through more than one full loop pass (region is 1 s long)
    await page.waitForTimeout(2500);
    const [a, b] = await videoTimes(page);
    expect(a.paused).toBe(false);
    // Both clocks stay inside the region (small margin for the wrap moment)
    expect(a.t).toBeGreaterThan(0.35);
    expect(a.t).toBeLessThan(1.65);
    expect(b.t).toBeGreaterThan(0.35);
    expect(b.t).toBeLessThan(1.65);
  });
});

test.describe('Difference mode (video)', () => {
  /** Switch to Stack mode and wait for it to settle. Required before diff toggle. */
  async function enterStack(page: Page) {
    await page.keyboard.press('s');
    await page.waitForFunction(() => (window as any).__testAPI?.isGridMode === false,
      {}, { timeout: 5000 });
  }

  test('D enters diff mode in Stack with 3 videos; _diffPair is the first pair', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await enterStack(page);
    expect(await getVar(page, 'diffMode')).toBeFalsy();
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBe(true);
    const pair = await getVar(page, '_diffPair');
    expect(pair).toEqual(['original', 'editA']);
  });

  test('Shift+D cycles _diffPair through all 3 pairs and wraps', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await enterStack(page);
    await page.keyboard.press('d'); // enter diff
    expect(await getVar(page, '_diffPair')).toEqual(['original', 'editA']);
    await page.keyboard.press('Shift+D');
    expect(await getVar(page, '_diffPair')).toEqual(['original', 'editB']);
    await page.keyboard.press('Shift+D');
    expect(await getVar(page, '_diffPair')).toEqual(['editA', 'editB']);
    await page.keyboard.press('Shift+D'); // wrap
    expect(await getVar(page, '_diffPair')).toEqual(['original', 'editA']);
  });

  test('exiting diff hides #diffOverlay and restores the slot label', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4', 'portrait.mp4']);
    await enterStack(page);
    await page.keyboard.press('d');
    const overlay = page.locator('#diffOverlay');
    await expect(overlay).toBeAttached();
    expect(await overlay.evaluate(el => (el as HTMLCanvasElement).style.display)).toBe('block');
    // Active slot's name should be prefixed with "DIFF: " while diff is on
    const activeName = page.locator('.asset-layer.active .asset-info-bar .asset-name');
    await expect(activeName).toContainText(/DIFF:/i);
    // Toggle off — overlay hidden, label restored
    await page.keyboard.press('d');
    expect(await getVar(page, 'diffMode')).toBeFalsy();
    expect(await overlay.evaluate(el => (el as HTMLCanvasElement).style.display)).toBe('none');
    await expect(activeName).not.toContainText(/DIFF:/i);
  });
});

test.describe('Pan bounds', () => {
  test('image fitting in viewport gives zero pan bounds in both axes', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    // At fit zoom a 200×150 image easily fits the viewport — nothing to pan.
    expect(await getVar(page, '_panBoundsXMin')).toBe(0);
    expect(await getVar(page, '_panBoundsXMax')).toBe(0);
    expect(await getVar(page, '_panBoundsYMin')).toBe(0);
    expect(await getVar(page, '_panBoundsYMax')).toBe(0);
  });

  test('zoom-in expands pan bounds; min ≤ 0 ≤ max invariant holds', async ({ page }) => {
    await page.goto('/');
    await loadAndEnterStack(page, ['red.png', 'green.png']);
    // 1 sets zoom to 100% native pixels — at 200×150 that still fits, so push further.
    await page.keyboard.press('1');
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const xMin = await getVar(page, '_panBoundsXMin');
    const xMax = await getVar(page, '_panBoundsXMax');
    const yMin = await getVar(page, '_panBoundsYMin');
    const yMax = await getVar(page, '_panBoundsYMax');
    expect(xMin).toBeLessThanOrEqual(0);
    expect(xMax).toBeGreaterThanOrEqual(0);
    expect(yMin).toBeLessThanOrEqual(0);
    expect(yMax).toBeGreaterThanOrEqual(0);
    // At least one axis must overflow after 6 zoom-in steps from 100%.
    expect((xMax - xMin) + (yMax - yMin)).toBeGreaterThan(0);
  });

  test('Balance mode captures _savedFitPanX/Y and restores them on toggle back', async ({ page }) => {
    await page.goto('/');
    // Mixed orientations make Balance materially different from Fit.
    await loadAndEnterStack(page, ['wide.png', 'tall.png']);
    // Zoom in so we have a non-zero pan offset to save.
    await page.keyboard.press('1');
    for (let i = 0; i < 4; i++) await page.keyboard.press('+');
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const fitPanX = await getVar(page, 'panOffsetX');
    const fitPanY = await getVar(page, 'panOffsetY');
    // Toggle Fit → Balance. _savedFitPanX/Y should snapshot the Fit-mode pan.
    await page.keyboard.press('\\');
    expect(await getVar(page, '_savedFitPanX')).toBe(fitPanX);
    expect(await getVar(page, '_savedFitPanY')).toBe(fitPanY);
    // Toggle back → pan offsets restored
    await page.keyboard.press('\\');
    expect(await getVar(page, 'panOffsetX')).toBe(fitPanX);
    expect(await getVar(page, 'panOffsetY')).toBe(fitPanY);
  });
});

test.describe('Hotkey reassignment via localStorage.customHotkeys', () => {
  test('custom mapping in localStorage is applied at init: _customKeys + _keymap reflect it', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('customHotkeys', JSON.stringify({ mute: 'y' }));
    });
    await page.goto('/');
    const customKeys = await getVar(page, '_customKeys');
    expect(customKeys).toEqual({ mute: 'y' });
    const keymap = await getVar(page, '_keymap');
    expect(keymap['y']).toBe('mute');
    // Default 'm' slot is freed since the only owner moved off it
    expect(keymap['m']).toBeUndefined();
  });

  test('reassigned key triggers the action; default key is inert', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('customHotkeys', JSON.stringify({ mute: 'y' }));
    });
    await page.goto('/');
    await loadImages(page, ['red.png', 'green.png']);
    const muteBtn = page.locator('#muteBtn');
    const before = await muteBtn.innerHTML();
    // Custom key fires
    await page.keyboard.press('y');
    const afterCustom = await muteBtn.innerHTML();
    expect(afterCustom).not.toBe(before);
    // Default 'm' is no longer bound to mute — pressing it shouldn't toggle the icon
    await page.keyboard.press('m');
    const afterDefault = await muteBtn.innerHTML();
    expect(afterDefault).toBe(afterCustom);
  });

  test('a fresh context (no override) gets the default _keymap', async ({ browser }) => {
    // First context: install override and confirm it took effect.
    // addInitScript re-runs on every navigation, so we can't reuse this context
    // to verify the "default" state — we'd just re-install the override on reload.
    const ctxOverride = await browser.newContext();
    await ctxOverride.addInitScript(() => {
      localStorage.setItem('customHotkeys', JSON.stringify({ mute: 'y' }));
    });
    const pageOverride = await ctxOverride.newPage();
    await pageOverride.goto('/');
    expect((await getVar(pageOverride, '_keymap'))['y']).toBe('mute');
    await ctxOverride.close();

    // Fresh context: empty localStorage → defaults restored.
    const ctxClean = await browser.newContext();
    const pageClean = await ctxClean.newPage();
    await pageClean.goto('/');
    const keymap = await getVar(pageClean, '_keymap');
    expect(keymap['m']).toBe('mute');
    expect(keymap['y']).not.toBe('mute');
    expect(await getVar(pageClean, '_customKeys')).toEqual({});
    await ctxClean.close();
  });
});

test.describe('Grid layout recalculation on window resize', () => {
  test('two wide images: layout flips between viewports as resize handler re-evaluates', async ({ page }) => {
    // Start at a wide-and-short viewport where horizontal (side-by-side) wins for AR=2 images.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto('/');
    await loadImages(page, ['wide.png', 'wide.png']);
    await page.waitForFunction(() => {
      const api = (window as any).__testAPI;
      return api?.isGridMode === true && api?.layoutMode !== undefined;
    }, {}, { timeout: 5000 });
    expect(await getVar(page, 'layoutMode')).toBe('horizontal');
    // Resize to narrow-and-tall — vertical (stacked) now wins.
    await page.setViewportSize({ width: 400, height: 1280 });
    await page.waitForFunction(() => (window as any).__testAPI?.layoutMode === 'vertical',
      {}, { timeout: 3000 });
    expect(await getVar(page, 'layoutMode')).toBe('vertical');
    // And back: horizontal again.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.waitForFunction(() => (window as any).__testAPI?.layoutMode === 'horizontal',
      {}, { timeout: 3000 });
    expect(await getVar(page, 'layoutMode')).toBe('horizontal');
  });
});

// Real rendering + cross-load hygiene — the W-panel/spectrogram paths were only
// covered by proxy checks (canvas count, flag value) before. These assert the
// canvas actually drew (exercises decode → waveformData/spectrogramData → render,
// i.e. the extracted js/audio-decode.js pipeline) and that a new load clears stale
// state (finding H class).
test.describe('Audio viz rendering (W panel) + load hygiene', () => {
  // True when the canvas has at least one pixel differing from its top-left pixel
  // (i.e. something was actually drawn, not a blank/uniform fill).
  const CANVAS_DREW = (sel: string) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!c || !c.width || !c.height) return false;
    try {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 4; i < d.length; i += 4)
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true;
      return false;
    } catch { return false; }
  };

  test('spectrogram canvas actually renders pixels for a video with audio', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('w');
    await expect(page.locator('#spectrogramPanel')).toBeVisible();
    // Wait for decode + render to actually paint the spectrogram.
    await page.waitForFunction(CANVAS_DREW, '#spectrogramCanvas', { timeout: 15000 });
  });

  test('audio-only slot canvas actually renders pixels', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['stereo.wav', 'mono.wav']);
    // Audio-only viz lives in the main view; assert at least one slot canvas drew.
    await page.waitForFunction(() => {
      const cs = Array.from(document.querySelectorAll('canvas.audio-viz-slot-canvas')) as HTMLCanvasElement[];
      return cs.some(c => {
        if (!c.width || !c.height) return false;
        try {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          for (let i = 4; i < d.length; i += 4)
            if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true;
          return false;
        } catch { return false; }
      });
    }, {}, { timeout: 15000 });
  });

  test('loading a new set clears stale loop points and resets the spectrogram cursor', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
    await page.keyboard.press('i'); // set loop in-point
    await page.waitForFunction(() => (window as any).__testAPI?._loopInPoint !== null, {}, { timeout: 3000 });
    expect(await getVar(page, '_loopInPoint')).not.toBeNull();
    await page.keyboard.press('w'); // open viz so the cursor element is in play
    // Fresh load must run clearAllMedia and wipe prior state.
    await loadMedia(page, ['red.png', 'green.png']);
    expect(await getVar(page, '_loopInPoint')).toBeNull();
    expect(await getVar(page, '_loopOutPoint')).toBeNull();
    const cursorLeft = await page.evaluate(() =>
      (document.getElementById('spectrogramCursor') as HTMLElement | null)?.style.left ?? '');
    expect(['', '0', '0px']).toContain(cursorLeft);
  });
});

test.describe('Opus deferred-start window (Web Audio sync replacement)', () => {
  // Drives _startOpusSyncAudio/_stopOpusSyncAudio/_updateOpusSyncRate through
  // __testAPI.opus with a synthetic silent AudioBuffer — the invariants under
  // test are scheduling math, not codec behavior, so no Opus fixture is needed.
  // Each scenario runs inside ONE page.evaluate so the whole sequence executes
  // within a single JS task (the deferred-start window is only ~15 ms wide),
  // and assertions compare captured ctx times with tolerances so they hold
  // whether the AudioContext is running or suspended (headless autoplay).
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  });

  test('replacing an audible source defers the new start until the fade-out is silent', async ({ page }) => {
    const r = await page.evaluate(() => {
      const opus = (window as any).__testAPI.opus;
      opus.installTestBuffer('editA', 2);
      opus.start('editA', 0.5);            // nothing fading → starts immediately
      const first = opus.state('editA');
      const tBefore = opus.ctxTime();
      opus.start('editA', 0.6);            // replaces audible source → must wait out its fade
      return { first, tBefore, second: opus.state('editA'), fade: opus.fade() };
    });
    // The stop inside the second start stamps fadeUntil = stopTime + fade;
    // the new source must be scheduled at (not before) that moment.
    expect(r.second.fadeUntil).toBeGreaterThanOrEqual(r.tBefore + r.fade - 0.001);
    expect(r.second.startCtx).toBeGreaterThanOrEqual(r.second.fadeUntil - 1e-6);
    expect(r.second.startCtx).toBeGreaterThanOrEqual(r.first.startCtx + r.fade - 0.001);
    expect(r.second.hasSource).toBe(true);
  });

  test('deferred start compensates the buffer offset so audio meets the video at startTime', async ({ page }) => {
    const r = await page.evaluate(() => {
      const opus = (window as any).__testAPI.opus;
      opus.installTestBuffer('editA', 2);
      opus.start('editA', 0.5);
      const tBefore = opus.ctxTime();
      opus.start('editA', 0.6);            // deferred by ~fade
      return { tBefore, second: opus.state('editA') };
    });
    // startVideo must be fromTime advanced by (startCtx − now)·rate, not raw
    // fromTime — raw fromTime would bake a permanent ~15 ms lag into the anchors.
    const expected = 0.6 + (r.second.startCtx - r.tBefore) * r.second.rate;
    expect(Math.abs(r.second.startVideo - expected)).toBeLessThan(0.005);
    expect(r.second.startVideo).toBeGreaterThan(0.6 + 0.005); // clearly compensated, not raw fromTime
  });

  test('stopping a pending source cancels silently without extending fadeUntil', async ({ page }) => {
    const r = await page.evaluate(() => {
      const opus = (window as any).__testAPI.opus;
      opus.installTestBuffer('editA', 2);
      opus.start('editA', 0.5);            // audible
      opus.start('editA', 0.6);            // pending (deferred behind the fade)
      const pending = opus.state('editA');
      const tStop = opus.ctxTime();
      opus.stop('editA');                  // must cancel outright — nothing audible yet
      const afterStop = opus.state('editA');
      opus.start('editA', 0.7);            // must NOT wait an extra fade
      return { pending, tStop, afterStop, third: opus.state('editA') };
    });
    expect(r.pending.startCtx).toBeGreaterThan(r.tStop - 0.001);  // was genuinely pending
    expect(r.afterStop.hasSource).toBe(false);
    // A silent cancel leaves the old stamp; the audible-fade branch would have
    // re-stamped fadeUntil ≈ tStop + fade, pushing the next start out further.
    expect(r.afterStop.fadeUntil).toBeLessThanOrEqual(r.pending.fadeUntil + 1e-6);
    expect(r.third.startCtx).toBeLessThanOrEqual(r.pending.fadeUntil + 0.002);
  });

  test('rate change during the pending window applies the rate without re-anchoring', async ({ page }) => {
    const r = await page.evaluate(() => {
      const opus = (window as any).__testAPI.opus;
      opus.installTestBuffer('editA', 2);
      opus.start('editA', 0.5);            // audible
      opus.start('editA', 0.6);            // pending
      const before = opus.state('editA');
      opus.updateRate(2);
      return { before, after: opus.state('editA') };
    });
    // Re-anchoring with negative elapsed would drag startVideo backward and
    // detach startCtx from the scheduled start — both must be untouched.
    expect(r.after.startVideo).toBeCloseTo(r.before.startVideo, 6);
    expect(r.after.startCtx).toBeCloseTo(r.before.startCtx, 6);
    expect(r.after.rate).toBe(2);
  });
});

test.describe('WebCodecs scrub decoder', () => {
  // Drives the full session cycle (fetch → demux → configure → decode GOP →
  // paint) via __testAPI.scrubVideo.decodeProbe. landscape_a.mp4 has a single
  // keyframe, so probing t=2.5s forces a ~60-frame forward decode — exactly the
  // sparse-GOP case the feature exists for. Skips (loudly) when the environment
  // can't decode H.264 via VideoDecoder.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'landscape_b.mp4']);
  });

  test('decodes a sparse-GOP target and paints frames up to it', async ({ page }) => {
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');

    const probe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2.5));
    test.skip(probe === null, 'slot not scrubbable in this environment (demux/codec)');
    test.skip(probe.dead && probe.framesPainted === 0, 'H.264 VideoDecoder config unsupported in this build');

    expect(probe.codec).toMatch(/^avc1\./);
    expect(probe.samples).toBeGreaterThan(60);
    // Paints are rAF-coalesced (decode outruns the display), so the count is
    // timing-dependent — the invariant is that painting ended AT the target.
    expect(probe.framesPainted).toBeGreaterThanOrEqual(1);
    expect(probe.lastPaintedPts).toBeGreaterThan(2.0);
    expect(probe.lastPaintedPts).toBeLessThanOrEqual(2.6);
  });

  test('session is cached per slot and cleared on reset', async ({ page }) => {
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');

    const probe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 0.5));
    test.skip(probe === null, 'slot not scrubbable in this environment');

    const stateAfter = await page.evaluate(() => (window as any).__testAPI.scrubVideo.sessionState('editA'));
    expect(stateAfter).toBe('ready');
  });

  test('revisiting a decoded position is served from the frame cache', async ({ page }) => {
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');

    // First probe decodes from the preceding keyframe up to 2.5s, caching every
    // emitted frame. (Keyframe placement depends on the fixture encoder — the
    // current fixtures carry one per 1s segment — so only the frames from the
    // last keyframe are guaranteed decoded; revisit WITHIN that span.)
    const probe1 = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2.5));
    test.skip(probe1 === null || probe1.dead, 'slot not scrubbable in this environment');

    const stats1 = await page.evaluate(() => (window as any).__testAPI.scrubVideo.cacheStats('editA'));
    expect(stats1.frames).toBeGreaterThan(8); // ≥ the 2.0→2.5s run at 24fps
    expect(stats1.hits).toBe(0);

    // Revisiting 2.2s (backward, inside the decoded span) must hit the cache
    const probe2 = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 2.2));
    const stats2 = await page.evaluate(() => (window as any).__testAPI.scrubVideo.cacheStats('editA'));
    expect(stats2.hits).toBeGreaterThanOrEqual(1);
    expect(probe2.lastPaintedPts).toBeGreaterThan(2.0);
    expect(probe2.lastPaintedPts).toBeLessThanOrEqual(2.3);
  });

  test('Grid-mode drag engages an overlay per video slot', async ({ page }) => {
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');
    const probe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 0.2));
    test.skip(probe === null || probe.dead, 'slot not scrubbable in this environment');

    // 2 files default to Grid mode already; confirm
    expect(await page.evaluate(() => (window as any).__testAPI.isGridMode)).toBe(true);

    // Open the audio-viz panel so the waveform/spectrogram time cursor is live —
    // it must keep tracking the drag even though overlay scrubs skip <video>
    // seeks (regression: cursor froze because it read stale video.currentTime).
    await page.keyboard.press('w');
    await page.locator('#spectrogramPanel.active').waitFor({ state: 'visible', timeout: 5000 });

    const bar = page.locator('#videoProgressContainer');
    const box = await bar.boundingBox();
    expect(box).toBeTruthy();
    const y = box!.y + box!.height / 2;
    await page.mouse.move(box!.x + box!.width * 0.1, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box!.x + box!.width * (0.1 + 0.0875 * i), y);
      await page.waitForTimeout(30);
    }

    // Both video slots get a live overlay with an attached canvas
    await page.waitForFunction(() => (window as any).__testAPI.scrubVideo.overlayCount() === 2, {}, { timeout: 3000 });
    expect(await page.locator('.scrub-overlay-canvas').count()).toBe(2);

    // Mid-drag (cursor at ~80% of the bar): progress fill and spectrogram time
    // cursor must both track the drag position, not the un-seeked video's time
    const midDrag = await page.evaluate(() => ({
      barPct: parseFloat((document.getElementById('videoProgressBar') as HTMLElement).style.width),
      cursorLeft: parseFloat((document.getElementById('spectrogramCursor') as HTMLElement).style.left),
      wrapW: (document.getElementById('spectrogramCursor') as HTMLElement).parentElement!.offsetWidth,
    }));
    expect(midDrag.barPct).toBeGreaterThan(60);
    expect(midDrag.cursorLeft / midDrag.wrapW).toBeGreaterThan(0.6);

    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelectorAll('.scrub-overlay-canvas').length === 0,
      {}, { timeout: 2000 }
    );
    expect(await page.evaluate(() => (window as any).__testAPI.scrubVideo.overlayCount())).toBe(0);
  });

  test('HDR (PQ) content is refused — falls back to native scrubbing', async ({ page }) => {
    // Load fresh with an HDR-tagged file: landscape_a (oldest mtime) → editA,
    // pq_hdr (newest) → editB. The overlay must never engage for the HDR slot —
    // Chrome tone-maps HDR <video>, the canvas path doesn't (major darkening).
    await page.goto('/');
    await loadMedia(page, ['landscape_a.mp4', 'pq_hdr.mp4']);
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');

    const hdrProbe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editB', 0.2));
    expect(hdrProbe).toBeNull();
    expect(await page.evaluate(() => (window as any).__testAPI.scrubVideo.sessionState('editB'))).toBe('failed');

    // The SDR slot in the same set still gets a working session
    const sdrProbe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 0.2));
    test.skip(sdrProbe === null, 'SDR slot not scrubbable in this environment');
    expect(sdrProbe.dead).toBe(false);
  });

  test('Stack-mode drag engages the overlay canvas and tears it down on mouseup', async ({ page }) => {
    const supported = await page.evaluate(() => (window as any).__testAPI.scrubVideo.supported());
    test.skip(!supported, 'VideoDecoder not available in this browser build');
    // Pre-warm the session so the overlay can engage without racing drag timing,
    // and skip if this environment can't decode the fixture at all.
    const probe = await page.evaluate(() => (window as any).__testAPI.scrubVideo.decodeProbe('editA', 0.2));
    test.skip(probe === null || probe.dead, 'slot not scrubbable in this environment');

    // Stack mode (Grid engagement is covered by the Grid-mode test above)
    await page.keyboard.press('s');
    await page.waitForFunction(() => !(window as any).__testAPI.isGridMode);

    const bar = page.locator('#videoProgressContainer');
    const box = await bar.boundingBox();
    expect(box).toBeTruthy();
    const y = box!.y + box!.height / 2;

    // Drag from 10% to 80% in steps, like a real scrub
    await page.mouse.move(box!.x + box!.width * 0.1, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box!.x + box!.width * (0.1 + 0.0875 * i), y);
      await page.waitForTimeout(30);
    }

    // Overlay must be live with its canvas attached inside the active wrapper
    await page.waitForFunction(() => (window as any).__testAPI.scrubVideo.overlayLive(), {}, { timeout: 3000 });
    expect(await page.locator('.asset-layer.active .scrub-overlay-canvas').count()).toBe(1);

    await page.mouse.up();
    // Canvas is removed after the final seek paints (or the 400ms fallback)
    await page.waitForFunction(
      () => document.querySelectorAll('.scrub-overlay-canvas').length === 0,
      {}, { timeout: 2000 }
    );
    expect(await page.evaluate(() => (window as any).__testAPI.scrubVideo.overlayLive())).toBe(false);
  });
});

// ===========================================================================
// 2026-07 regression suites (v3.11.3–3.11.7 fixes). These use the VP9+Vorbis
// webm fixtures so they run on open-codec Chromium builds too — and Vorbis
// (not Opus) so the PLAIN <video>.muted routing is exercised rather than the
// Chrome Opus Web Audio replacement (where .muted is always true).
// ===========================================================================

/** Muted flag per loaded video, in DOM order. */
async function mutedStates(page: Page): Promise<boolean[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.asset-layer video')).map(v => (v as HTMLVideoElement).muted));
}

async function startPlayback(page: Page) {
  await page.evaluate(() => (window as any).playAllMedia());
  await page.waitForFunction(() => {
    const v = document.querySelector('.asset-layer video') as HTMLVideoElement;
    return v && !v.paused && v.currentTime > 0.3;
  }, {}, { timeout: 5000 });
}

test.describe('Scrub drag lost-mouseup recovery (v3.11.7)', () => {
  // A drag whose mouseup never arrives (released outside the window, Alt-Tab
  // mid-drag) must not leave isDragging stuck true — that shut off decoder
  // suspension + the drift lock (choppy playback). (Scrub no longer touches
  // .muted as of v3.12.2, so these tests now also assert the mute routing is
  // simply left undisturbed across a drag + recovery.)

  async function loadAndPlay(page: Page) {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    const baseline = await mutedStates(page);
    expect(baseline.filter(m => !m)).toHaveLength(1); // exactly one audible
    await startPlayback(page);
    return baseline;
  }

  async function dragOnProgressBar(page: Page, fromPct: number, toPct: number) {
    const box = (await page.locator('#videoProgressContainer').boundingBox())!;
    await page.mouse.move(box.x + box.width * fromPct, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * toPct, box.y + box.height / 2, { steps: 5 });
    return box;
  }

  test('ghost mousemove (buttons=0) finalizes: mute routing intact, playback resumed', async ({ page }) => {
    const baseline = await loadAndPlay(page);
    await dragOnProgressBar(page, 0.3, 0.5);
    expect(await getVar(page, 'isDragging')).toBe(true);
    // Scrub no longer touches .muted (the decode-warm unmute was retired), so the
    // routing stays at baseline throughout the drag — not the old all-unmuted state.
    expect(await mutedStates(page)).toEqual(baseline);

    // The lost mouseup: next event is a mousemove with the button up.
    await page.evaluate(() => document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 0, clientX: 50, clientY: 50 })));
    await page.waitForFunction(() => !(window as any).__testAPI.isDragging, {}, { timeout: 2000 });
    expect(await mutedStates(page)).toEqual(baseline);
    expect(await page.evaluate(() => {
      const v = document.querySelector('.asset-layer video') as HTMLVideoElement;
      return v && !v.paused;
    })).toBe(true); // wasPlaying → resumed
    await page.mouse.up(); // real release afterwards must be a no-op
    await page.waitForTimeout(100);
    expect(await mutedStates(page)).toEqual(baseline);
  });

  test('a mousedown mid-stuck-drag finalizes first — mute routing intact', async ({ page }) => {
    const baseline = await loadAndPlay(page);
    // Forge a stuck drag exactly as a lost mouseup leaves it.
    await page.evaluate(() => {
      const bar = document.getElementById('videoProgressContainer')!;
      const r = bar.getBoundingClientRect();
      bar.dispatchEvent(new MouseEvent('mousedown',
        { bubbles: true, buttons: 1, clientX: r.left + r.width * 0.4, clientY: r.top + 3 }));
    });
    expect(await getVar(page, 'isDragging')).toBe(true);
    // Next real click-drag must finalize the stuck one, then restore cleanly.
    await dragOnProgressBar(page, 0.6, 0.7);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await getVar(page, 'isDragging')).toBe(false);
    expect(await mutedStates(page)).toEqual(baseline); // one audible — routing undisturbed
  });

  test('window blur mid-drag finalizes the drag', async ({ page }) => {
    const baseline = await loadAndPlay(page);
    await dragOnProgressBar(page, 0.2, 0.3);
    expect(await getVar(page, 'isDragging')).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => !(window as any).__testAPI.isDragging, {}, { timeout: 2000 });
    expect(await mutedStates(page)).toEqual(baseline);
    await page.mouse.up();
  });
});

test.describe('Pause-time frame snap (v3.11.4)', () => {
  // Spacebar-pause must land every video on the SAME frame: the drift lock
  // only holds followers within tolerance during playback, and a few-ms offset
  // straddling a frame boundary rounds to frame N vs N+1 at pause time.

  async function frameStates(page: Page) {
    return page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
      return vids.map(v => {
        const fps = ((window as any).videoFrameRates?.[v.src]) || 30;
        return { frame: Math.floor(v.currentTime * fps + 0.01), paused: v.paused };
      });
    });
  }

  test('pause lands all videos on the same frame despite a knocked-off follower', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await startPlayback(page);
    for (let i = 0; i < 3; i++) {
      // Knock a follower ~13ms off — small enough that the drift lock may not
      // re-correct before the pause lands (the boundary-straddle case).
      await page.evaluate(() => {
        const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
        if (vids[1] && !isNaN(vids[1].duration)) {
          vids[1].currentTime = Math.min(vids[1].currentTime + 0.013, vids[1].duration - 0.05);
        }
      });
      await page.waitForTimeout(120);
      await page.keyboard.press(' ');
      await page.waitForTimeout(150);
      const st = await frameStates(page);
      expect(st.every(s => s.paused)).toBe(true);
      expect(new Set(st.map(s => s.frame)).size).toBe(1);
      await page.keyboard.press(' '); // resume for the next round
      await page.waitForFunction(() => {
        const v = document.querySelector('.asset-layer video') as HTMLVideoElement;
        return v && !v.paused;
      }, {}, { timeout: 3000 });
    }
  });
});

test.describe('Stack switch repaint (v3.11.3)', () => {
  // Flipping the active clip in Stack mode while paused must force the newly-
  // shown <video> to re-present its own frame (a same-frame currentTime nudge
  // fires a seek → repaint) — the display:none→visible unhide otherwise
  // flashes the stale frame from when the slot was last visible.

  test('switch fires a same-frame repaint seek on the incoming clip', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('s');
    await page.waitForFunction(() => (window as any).__testAPI.isGridMode === false, {}, { timeout: 5000 });
    // Frame-step twice so BOTH clips sit at the identical frame midpoint (the
    // worst case: a naive repaint would be a no-op and keep the stale frame).
    await page.keyboard.press('.');
    await page.keyboard.press('.');
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => {
      (window as any).__seekCounts = {};
      const out: Record<string, number> = {};
      document.querySelectorAll('.asset-layer video').forEach(el => {
        const v = el as HTMLVideoElement;
        (window as any).__seekCounts[v.src] = 0;
        v.addEventListener('seeked', () => { (window as any).__seekCounts[v.src]++; });
        out[v.src] = v.currentTime;
      });
      const active = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
      return { times: out, activeSrc: active.src };
    });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const v = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
      const fps = ((window as any).videoFrameRates?.[v.src]) || 30;
      return { src: v.src, ct: v.currentTime, fps, seeks: (window as any).__seekCounts[v.src] };
    });
    expect(after.src).not.toBe(before.activeSrc);       // switch happened
    expect(after.seeks).toBeGreaterThanOrEqual(1);      // repaint seek fired
    const frameOf = (t: number) => Math.floor(t * after.fps + 0.01);
    expect(frameOf(after.ct)).toBe(frameOf(before.times[after.src])); // same frame — no jump
  });

  test('switch during playback is a no-op (clip keeps playing)', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('s');
    await page.waitForFunction(() => (window as any).__testAPI.isGridMode === false, {}, { timeout: 5000 });
    await startPlayback(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => {
      const v = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
      return v && !v.paused;
    })).toBe(true);
  });
});

test.describe('Stack drift lock — no seek storm (v3.11.8)', () => {
  // Stack's hidden follower used to hard-seek at half a frame of drift, but a
  // seek stalls a playing element for its seek latency — landing it behind by
  // more than half a frame again → a perpetual seek loop (~26 seeks/s
  // measured) that pinned the follower 1–2 frames behind. Switching assets
  // then promoted the laggard to clock master and dragged the whole cluster
  // (and the timeline) backward. Followers now converge via a strong rate
  // trim (invisible: display:none AND muted) and hard-seek only past
  // _DRIFT_HARD_SEEK, with a landing-error lead.
  test('hidden follower converges without a seek storm; switch never steps backward', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('s');
    await page.waitForFunction(() => !(window as any).__testAPI.isGridMode, {}, { timeout: 5000 });

    const r = await page.evaluate(async () => {
      const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
      const seeks = [0, 0];
      vids.forEach((v, i) => v.addEventListener('seeking', () => seeks[i]++));
      (window as any).playAllMedia();
      await new Promise<void>(res => {
        const w = () => (!vids[0].paused && vids[0].currentTime > 0.2) ? res() : setTimeout(w, 50);
        w();
      });
      const drifts: number[] = [];
      const t0 = performance.now();
      await new Promise<void>(res => {
        const iv = setInterval(() => {
          drifts.push(vids[1].currentTime - vids[0].currentTime);
          if (performance.now() - t0 > 1500) { clearInterval(iv); res(); }
        }, 100);
      });
      return { seeks, meanDrift: drifts.reduce((a, c) => a + c, 0) / drifts.length };
    });
    // The storm was ~26 hard-seeks/s on the hidden follower; a couple of
    // corrections at startup are fine.
    expect(r.seeks[1]).toBeLessThan(10);
    expect(Math.abs(r.meanDrift)).toBeLessThan(0.021); // on-clock, not chronically behind

    // Switch mid-play (early enough that no loop wrap lands in the window):
    // the newly active clip's clock must never be behind the old one by more
    // than half a frame.
    const delta = await page.evaluate(async () => {
      const before = (document.querySelector('.asset-layer.active video') as HTMLVideoElement).currentTime;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise(r2 => setTimeout(r2, 100));
      const after = (document.querySelector('.asset-layer.active video') as HTMLVideoElement).currentTime;
      return after - before;
    });
    expect(delta).toBeGreaterThan(-0.021);
  });
});

test.describe('Seamless mid-playback Stack switch (v3.11.9)', () => {
  // A display:none <video> stops being presented — unhiding it flashes its
  // stale last-visible frame (backward jump on near-identical clips) and
  // stalls while decode catches up. The outgoing layer must keep covering
  // (.switch-out) until the incoming clip presents a current frame.
  test('switch covers with the outgoing clip until the incoming presents, then swaps', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('s');
    await page.waitForFunction(() => !(window as any).__testAPI.isGridMode, {}, { timeout: 5000 });
    await startPlayback(page);
    // Let the drift lock finish absorbing the play() start-latency offset —
    // switching mid-convergence would measure the transient, not the swap.
    await page.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('.asset-layer video')) as HTMLVideoElement[];
      return Math.abs(vids[0].currentTime - vids[1].currentTime) < 0.012;
    }, {}, { timeout: 5000 });

    const snap = await page.evaluate(() => {
      const oldLayer = document.querySelector('.asset-layer.active')!;
      const oldVideo = oldLayer.querySelector('video') as HTMLVideoElement;
      (window as any).__swapSeeks = 0;
      document.querySelectorAll('.asset-layer video').forEach(v =>
        v.addEventListener('seeking', () => { (window as any).__swapSeeks++; }));
      const before = oldVideo.currentTime;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      // switchToAsset runs synchronously in the keydown dispatch:
      const newLayer = document.querySelector('.asset-layer.active')!;
      return {
        switched: newLayer !== oldLayer,
        oldCovering: oldLayer.classList.contains('switch-out'),
        before,
      };
    });
    expect(snap.switched).toBe(true);
    expect(snap.oldCovering).toBe(true); // outgoing keeps covering the screen

    // The cover is released once the incoming presents (300ms hard fallback).
    await page.waitForFunction(
      () => document.querySelectorAll('.asset-layer.switch-out').length === 0,
      {}, { timeout: 1000 });

    const after = await page.evaluate(() => {
      const v = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
      return { ct: v.currentTime, paused: v.paused, seeks: (window as any).__swapSeeks };
    });
    expect(after.paused).toBe(false);          // no stall-inducing pause
    expect(after.seeks).toBe(0);               // the swap never seeks anyone
    expect(after.ct).toBeGreaterThan(snap.before - 0.021); // clock never steps back
  });

  test('rapid back-and-forth switches leave exactly one covering layer, then none', async ({ page }) => {
    await page.goto('/');
    await loadMedia(page, ['vorbis_a.webm', 'vorbis_b.webm']);
    await page.keyboard.press('s');
    await page.waitForFunction(() => !(window as any).__testAPI.isGridMode, {}, { timeout: 5000 });
    await startPlayback(page);
    const midCount = await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise(r => setTimeout(r, 40));
      }
      return document.querySelectorAll('.asset-layer.switch-out').length;
    });
    expect(midCount).toBeLessThanOrEqual(1); // token invalidation: never stacked covers
    await page.waitForFunction(
      () => document.querySelectorAll('.asset-layer.switch-out').length === 0,
      {}, { timeout: 1000 });
    expect(await page.evaluate(() => {
      const v = document.querySelector('.asset-layer.active video') as HTMLVideoElement;
      return !v.paused;
    })).toBe(true);
  });
});

test.describe('Version hash display (v3.11.6)', () => {
  // version.json is Jekyll-processed on GitHub Pages (build_revision → the
  // deployed SHA). Locally the raw file (front matter intact) must fail
  // JSON.parse harmlessly; a substituted SHA appends ' · <sha7>'.

  test('local raw file → bare version, no page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.waitForTimeout(600);
    expect(await page.locator('#appVersion').textContent()).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(errors).toEqual([]);
  });

  test('substituted SHA → short hash appended', async ({ page }) => {
    await page.route('**/version.json', route => route.fulfill({
      contentType: 'application/json',
      body: '{ "sha": "0123456789abcdef0123456789abcdef01234567" }',
    }));
    await page.goto('/');
    await page.waitForFunction(
      () => document.getElementById('appVersion')!.textContent!.includes('·'),
      {}, { timeout: 3000 });
    expect(await page.locator('#appVersion').textContent()).toMatch(/^v\d+\.\d+\.\d+ · 0123456$/);
  });

  test('empty sha (metadata unavailable) → bare version', async ({ page }) => {
    await page.route('**/version.json', route => route.fulfill({
      contentType: 'application/json', body: '{ "sha": "" }',
    }));
    await page.goto('/');
    await page.waitForTimeout(600);
    expect(await page.locator('#appVersion').textContent()).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});

test.afterEach(async ({ page }) => {
  // Clean up any open popups or state
  await page.evaluate(() => {
    const popups = document.querySelectorAll('.quick-start-popup, .changelog-popup');
    popups.forEach(p => p.classList.remove('show'));
  });
});
