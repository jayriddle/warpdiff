import path from 'node:path';
import assert from 'node:assert/strict';
import { readSamples, screenshotSamples as shot } from './sampling.mjs';
import { ffmpeg } from './fixtures.mjs';
import { difference } from './native.mjs';
import { installLegacyFilter } from './legacy-filter.mjs';
async function picture(page, files) {
  await page.locator('#multiFileInput').setInputFiles(files);
  await page.locator('#comparisonView.active').waitFor();
  await page.waitForFunction(() => {
    const es = [...document.querySelectorAll('.asset-layer video,.asset-layer img')];
    return es.length && es.every(e => e.tagName === 'VIDEO' ? e.readyState >= 2 : e.complete && e.naturalWidth > 0) && getComputedStyle(document.querySelector('.asset-layer.active')).opacity === '1';
  });
}
export async function surfaceChecks(page, fixtures, directory, row) {
  const tag = fixtures.cases.find(c => c.name === 'matrix709-limited'),
    other = fixtures.cases.find(c => c.name === 'matrix601-limited');
  row.surfaces = {};
  await picture(page, [tag.file, other.file]);
  await page.locator('#gridIconBtn').click();
  await page.waitForFunction(() => isGridMode);
  const grid = await page.locator('#layerEditA video').evaluate(readSamples, {});
  row.surfaces.videoGridError = difference(grid.samples, row.cases[0].bare.samples);
  assert.equal(row.surfaces.videoGridError, 0);
  await page.locator('#stackIconBtn').click();
  await page.waitForFunction(() => !isGridMode);
  await page.waitForFunction(() => [...document.querySelectorAll('.asset-layer video')].every(v => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, v.videoWidth * 7.5 / 8, v.videoHeight * 1.5 / 4, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[0] > 200;
  }));
  const expected = await page.evaluate(() => {
    const videos = [...document.querySelectorAll('.asset-layer video')],
      samples = videos.map(v => {
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d', {
          colorSpace: 'srgb'
        });
        ctx.drawImage(v, 0, 0);
        return Array.from({
          length: 32
        }, (_, i) => {
          const p = ctx.getImageData((i % 8 + .5) * c.width / 8, (Math.floor(i / 8) + .5) * c.height / 4, 1, 1).data;
          return [...p].slice(0, 3);
        });
      });
    return samples[0].map((rgb, i) => ({
      name: 'patch-' + i,
      rgb: rgb.map((n, k) => Math.abs(n - samples[1][i][k]))
    }));
  });
  await page.keyboard.press('d');
  await page.waitForFunction(() => _diffMode && _diffOffscreen?.width > 0);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const actual = await page.evaluate(() => Array.from({
    length: 32
  }, (_, i) => {
    const p = _diffOffscreen.getContext('2d').getImageData((i % 8 + .5) * _diffOffscreen.width / 8, (Math.floor(i / 8) + .5) * _diffOffscreen.height / 4, 1, 1).data;
    return {
      name: 'patch-' + i,
      rgb: [...p].slice(0, 3)
    };
  }));
  row.surfaces.videoDifferenceExpected = expected;
  row.surfaces.videoDifferenceActual = actual;
  row.surfaces.videoDifferenceError = difference(actual, expected);
  await page.locator('#diffOverlay').screenshot({
    path: path.join(directory, row.engine + '-difference.png')
  });
  assert(Math.max(...expected.flatMap(p => p.rgb)) > 20, 'Wrong-matrix negative control did not create a visible difference');
  row.surfaces.blendControl = await page.evaluate(() => {
    const vs = [...document.querySelectorAll('.asset-layer video')];
    const sample = c => Array.from({
      length: 32
    }, (_, i) => {
      const p = c.getContext('2d').getImageData((i % 8 + .5) * c.width / 8, (Math.floor(i / 8) + .5) * c.height / 4, 1, 1).data;
      return {
        name: 'patch-' + i,
        rgb: [...p].slice(0, 3)
      };
    });
    const result = {};
    for (const staging of [false, true]) {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext('2d');
      for (const [i, v] of vs.entries()) {
        ctx.globalCompositeOperation = i ? 'difference' : 'source-over';
        if (staging) {
          const frame = document.createElement('canvas');
          frame.width = 640;
          frame.height = 360;
          frame.getContext('2d').drawImage(v, 0, 0, 640, 360);
          ctx.drawImage(frame, 0, 0);
        } else ctx.drawImage(v, 0, 0, 640, 360);
      }
      result[staging ? 'staged' : 'direct'] = sample(c);
    }
    return result;
  });
  await page.keyboard.press('d');
  await picture(page, tag.file);
  await page.mouse.move(2, 840);
  const native = await page.locator('#layerEditA video').evaluate(readSamples, {}),
    nativeShot = await shot(page.locator('#layerEditA video'), path.join(directory, row.engine + '-native-before-scrub.png'));
  // The actual loupe uses a video clone. Its label/crosshair are outside the sampled patch.
  const videoBox = await page.locator('#layerEditA video').boundingBox();
  await page.keyboard.press('z');
  await page.mouse.move(videoBox.x + videoBox.width * 1.5 / 8, videoBox.y + videoBox.height * 1.5 / 4);
  await page.locator('#pixelMagnifier.active video').waitFor();
  await page.waitForFunction(() => document.querySelector('#pixelMagnifier video')?.readyState >= 2);
  const clone = await page.locator('#pixelMagnifier video').evaluate(readSamples, {});
  row.surfaces.loupeCloneError = difference(clone.samples, native.samples);
  assert.equal(row.surfaces.loupeCloneError, 0);
  const lp = path.join(directory, row.engine + '-loupe.png');
  await page.locator('#pixelMagnifier').screenshot({
    path: lp
  });
  const bytes = ffmpeg(['-i', lp, '-vf', 'scale=200:200:flags=neighbor', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  row.surfaces.loupeScreenRGB = [...bytes.subarray((125 * 200 + 125) * 3, (125 * 200 + 125) * 3 + 3)];
  row.surfaces.loupeExpectedRGB = nativeShot[9].rgb;
  row.surfaces.loupeScreenError = Math.max(...row.surfaces.loupeScreenRGB.map((n, i) => Math.abs(n - nativeShot[9].rgb[i])));
  assert(row.surfaces.loupeScreenError <= 2, 'Loupe compositor differs from native video');
  await page.keyboard.press('z');
  const bar = await page.locator('#videoProgressContainer').boundingBox();
  await page.mouse.move(bar.x + bar.width * .3, bar.y + bar.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(bar.x + bar.width * .4, bar.y + bar.height / 2);
    const use = await page.evaluate(() => _scrubUseDecoder());
    if (use) {
      await page.waitForFunction(() => !!_scrubOverlayLive.editA && _scrubOverlayLive.editA.framesPainted > 0);
      const canvas = page.locator('.scrub-overlay-canvas');
      const raw = await canvas.evaluate(readSamples, {});
      const filtered = await shot(canvas, path.join(directory, row.engine + '-scrub-filtered.png'));
      row.surfaces.scrub = {
        path: 'webcodecs',
        rawError: difference(raw.samples, native.samples),
        screenError: difference(filtered, nativeShot),
        frameColorSpace: await page.evaluate(() => _scrubVideoSessions.editA.frameColorSpace),
        filter: await canvas.evaluate(c => c.style.filter)
      };
      assert(row.surfaces.scrub.rawError <= 2, 'WebCodecs raw output differs from native pixels');
      await page.evaluate(installLegacyFilter);
      const filter = await canvas.evaluate(c => c.style.filter);
      try {
        await canvas.evaluate(c => c.style.filter = 'url(#legacy-color-negative-control)');
        const unfiltered = await shot(canvas, path.join(directory, row.engine + '-scrub-legacy-negative-control.png'));
        row.surfaces.scrub.legacyFilterError = difference(unfiltered, nativeShot);
        assert(row.surfaces.scrub.legacyFilterError > 2, 'Legacy filter negative control did not create a detectable shift');
      } finally {
        await canvas.evaluate((c, filter) => c.style.filter = filter, filter);
      }
    } else {
      row.surfaces.scrub = {
        path: 'native',
        videoAfterSeek: await page.locator('#layerEditA video').evaluate(readSamples, {})
      };
      row.surfaces.scrub.rawError = difference(row.surfaces.scrub.videoAfterSeek.samples, native.samples);
      assert.equal(row.surfaces.scrub.rawError, 0);
    }
  } finally {
    await page.mouse.up();
  }
}
