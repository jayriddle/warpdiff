import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { pageFiles } from '../../../scripts/stage-pages.mjs';
import { difference } from './native.mjs';
import { readSamples, screenshotSamples } from './sampling.mjs';
import { surfaceChecks } from './surfaces.mjs';
async function appLoad(page, file) {
  await page.locator('#multiFileInput').setInputFiles(file);
  await page.locator('#comparisonView.active').waitFor();
  if (await page.locator('#localPreparationDialog[open]').count()) await page.locator('#localPreparationClose').click();
  await page.waitForFunction(() => {
    const e = document.querySelector('#layerEditA video,#layerEditA img');
    return e && (e.tagName === 'IMG' ? e.complete && e.naturalWidth > 0 : e.readyState >= 2) && getComputedStyle(document.getElementById('layerEditA')).opacity === '1';
  }, {}, {
    timeout: 20000
  });
}
export async function browserChecks(fixtures, native, directory, record, {
  engines = ['chrome', 'webkit'],
  root = process.cwd(),
  strict = true,
  headless = true,
  colorProfile = null
} = {}) {
  const allowed = new Set(pageFiles(root)),
    server = http.createServer((req, res) => {
      const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
      res.setHeader('Cache-Control', 'no-store');
      if (name === 'bare') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><body style="margin:0;background:black"><input type=file><video muted playsinline style="display:block;width:640px;height:360px"></video><script>document.querySelector("input").onchange=e=>{const v=document.querySelector("video");if(v.src)URL.revokeObjectURL(v.src);v.src=URL.createObjectURL(e.target.files[0]);v.play().catch(()=>{});};</script>');
        return;
      }
      if (!allowed.has(name)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png',
        '.txt': 'text/plain'
      }[path.extname(name)] || 'application/octet-stream');
      res.end(fs.readFileSync(path.join(root, name)));
    });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  record.browsers = [];
  try {
    for (const engineName of engines) {
      const engine = engineName === 'chrome' ? chromium : webkit,
        browser = await engine.launch(engineName === 'chrome' ? {
          channel: process.env.WARPDIFF_BROWSER_CHANNEL || 'chrome',
          headless,
          ...(colorProfile === 'native' ? {ignoreDefaultArgs:['--force-color-profile=srgb']} : {}),
          args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required',
            ...(colorProfile && colorProfile !== 'native' ? ['--force-color-profile=' + colorProfile] : [])]
        } : {
          headless
        });
      const row = {
        engine: engineName,
        headless,
        colorProfile,
        version: browser.version(),
        errors: [],
        cases: [],
        red: []
      };
      record.browsers.push(row);
      try {
        const context = await browser.newContext({
          viewport: {
            width: 1280,
            height: 850
          },
          deviceScaleFactor: 1,
          serviceWorkers: 'block'
        });
        await context.addInitScript(() => {
          localStorage.setItem('lastSeenVersion', '999.0.0');
          window.__sdrUnhandled = [];
          addEventListener('unhandledrejection', e => window.__sdrUnhandled.push(String(e.reason)));
        });
        const bare = await context.newPage(),
          page = await context.newPage();
        for (const p of [bare, page]) p.on('pageerror', e => row.errors.push(e.message));
        await bare.goto(origin + '/bare');
        await page.goto(origin);
        row.environment = await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          p3: matchMedia('(color-gamut: p3)').matches,
          version: APP_VERSION
        }));
        for (const fixture of fixtures.cases) {
          const result = {
            name: fixture.name
          };
          row.cases.push(result);
          await bare.locator('input').setInputFiles(fixture.file);
          await bare.waitForFunction(() => document.querySelector('video').readyState >= 2);
          const v = bare.locator('video');
          result.bare = await v.evaluate(readSamples, {});
          result.referenceError = {
            bt601: difference(result.bare.samples, fixture.references.bt601),
            bt709: difference(result.bare.samples, fixture.references.bt709)
          };
          result.bareScreenshot = await screenshotSamples(v, path.join(directory, engineName + '-' + fixture.name + '-bare.png'));
          await appLoad(page, fixture.file);
          result.app = await page.locator('#layerEditA video').evaluate(readSamples, {});
          result.appVsBare = difference(result.app.samples, result.bare.samples);
          await page.mouse.move(2, 840);
          result.appScreenshot = await screenshotSamples(page.locator('#layerEditA video'), path.join(directory, engineName + '-' + fixture.name + '-app.png'));
          result.screenshotAppVsBare = difference(result.appScreenshot, result.bareScreenshot);
          if (strict) {
            assert.equal(result.appVsBare, 0, fixture.name + ' app altered decoded pixels');
            assert(result.screenshotAppVsBare <= 2, fixture.name + ' native compositor differs in app');
          }
          result.scopeSamples = await page.evaluate(() => {
            const d = sampleVideoFrame(document.querySelector('#layerEditA video'));
            return Array.from({
              length: 32
            }, (_, i) => {
              const at = (Math.floor((Math.floor(i / 8) + .5) * d.height / 4) * d.width + Math.floor((i % 8 + .5) * d.width / 8)) * 4;
              return {
                name: 'patch-' + i,
                rgb: [...d.data.slice(at, at + 3)]
              };
            });
          });
          result.scopeVsBare = difference(result.scopeSamples, result.bare.samples);
          if (strict) assert.equal(result.scopeVsBare, 0, 'scope sampling changed RGB');
          const prepared = native.find(n => n.name === fixture.name && n.passed);
          if (prepared) {
            await appLoad(page, prepared.output);
            result.prepared = await page.locator('#layerEditA video').evaluate(readSamples, {});
            result.preparedVsOriginal = difference(result.prepared.samples, result.app.samples);
            if (strict) assert.equal(result.preparedVsOriginal, 0, 'copied prepared picture differs');
          }
        }
        // Reproduce the release's ambiguous red with only VUI/colr tags changed.
        for (const fixture of fixtures.redVariants) {
          await bare.locator('input').setInputFiles(fixture.file);
          await bare.waitForFunction(() => document.querySelector('video').readyState >= 2);
          const original = await bare.locator('video').evaluate(readSamples, {
            columns: 1,
            rows: 1
          });
          const prepared = native.find(n => n.name === fixture.name && n.passed);
          assert(prepared);
          await appLoad(page, prepared.output);
          const actual = await page.locator('#layerEditA video').evaluate(readSamples, {
            columns: 1,
            rows: 1
          });
          row.red.push({
            name: fixture.name,
            original: original.samples[0].rgb,
            prepared: actual.samples[0].rgb
          });
          if (strict) assert.deepEqual(actual.samples, original.samples);
        }
        await appLoad(page, fixtures.image);
        row.image = await page.locator('#layerEditA img').evaluate(readSamples, {});
        row.image.maxRGBError = difference(row.image.samples, fixtures.imageSamples);
        if (strict) assert.equal(row.image.maxRGBError, 0, 'sRGB PNG values changed');
        // Both slots are the same known image; exercise normal Grid and Stack controls.
        await page.locator('#multiFileInput').setInputFiles([fixtures.image, fixtures.imageTwin]);
        await page.locator('#comparisonView.active').waitFor();
        await page.locator('#gridIconBtn').click();
        await page.waitForFunction(() => isGridMode);
        row.grid = await page.locator('#layerEditA img').evaluate(readSamples, {});
        await page.locator('#stackIconBtn').click();
        await page.waitForFunction(() => !isGridMode);
        row.stack = await page.locator('#layerEditA img').evaluate(readSamples, {});
        if (strict) {
          assert.equal(difference(row.grid.samples, fixtures.imageSamples), 0);
          assert.equal(difference(row.stack.samples, fixtures.imageSamples), 0);
        }
        await surfaceChecks(page, fixtures, directory, row);
        row.unhandled = await page.evaluate(() => window.__sdrUnhandled);
        if (strict) {
          assert.deepEqual(row.errors, []);
          assert.deepEqual(row.unhandled, []);
        }
        await page.evaluate(() => clearAllMedia());
        row.preservationChecksPassed = true;
      } catch (error) {
        row.failure = error.stack;
        throw error;
      } finally {
        fs.writeFileSync(path.join(directory, 'browser-results.json'), JSON.stringify(record.browsers, null, 2));
        await browser.close();
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}
