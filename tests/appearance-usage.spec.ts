import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

test.use({ serviceWorkers: 'block' });

const image = fs.readFileSync(path.join(__dirname, '..', 'WarpDiff_Logo_v1.png'));
const appVersion = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/const APP_VERSION = '([^']+)'/)![1];
const files = (count = 2) => Array.from({ length: count }, (_, i) => ({ name: `private-client-${i}.png`, mimeType: 'image/png', buffer: image }));
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

async function start(page: Page, query = '?usageTest=1') {
  await page.addInitScript(version => localStorage.setItem('lastSeenVersion', version), appVersion);
  const requests: { params: Record<string, string>, rawPath: string, headers: Record<string, string> }[] = [];
  await page.route('**/__goatcounter_test__/count?*', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    const rawPath = params.p;
    params.p = params.p.replace(/^v[0-9.]+\//, '');
    requests.push({ params, rawPath, headers: route.request().headers() });
    await route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
  });
  await page.goto('/' + query);
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'original');
  return requests;
}

for (const [width, height, band] of [
  [759, 599, 'narrow-short'], [759, 600, 'narrow-tall'],
  [760, 599, 'medium-short'], [1199, 600, 'medium-tall'],
  [1200, 599, 'wide-short'], [1200, 600, 'wide-tall'],
  [960, 900, 'medium-tall']
] as const) test(`working space samples ${width}x${height} as ${band} once per ready review`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const requests = await start(page);
  await consent(page, 'yes');
  await load(page);
  const spaces = () => requests.filter(r => r.params.p.startsWith('workspace-'));
  await expect.poll(() => spaces().length).toBe(1);
  expect(spaces()[0].params.p).toBe(`workspace-${band}-image-2`);
  expect(spaces()[0].params.ns).toBe('true');
  expect(Object.keys(spaces()[0].params).sort()).toEqual(['e','ns','p','r','rnd','t']);
  expect(JSON.stringify(spaces()[0].params)).not.toMatch(/width|height|screen|\d+x\d+|private-client/);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate('checkAllLoaded(); _usage.comparisonReady(_usage.epoch, ["image", "image"]); _usage.feature("grid");');
  expect(spaces()).toHaveLength(1); // Resize, feature use and duplicate readiness never resample.
  await load(page);
  await expect.poll(() => spaces().length).toBe(2);
  expect(spaces()[1].params.p).toBe('workspace-wide-tall-image-2');
});

test('scope-3 Yes cannot collect working space; renewal does not replay its review', async ({ page }) => {
  const requests = await start(page);
  await page.evaluate(() => localStorage.setItem('pref_usageConsentTest', JSON.stringify({
    choice: 'yes', version: 3, decidedAt: new Date().toISOString()
  })));
  await page.reload();
  await expect(page.locator('#usageConsentReview')).toBeVisible();
  await load(page);
  expect(requests).toHaveLength(0);
  await consent(page, 'yes');
  expect(requests.filter(r => r.params.p.startsWith('workspace-'))).toHaveLength(0);
  await load(page);
  await expect.poll(() => requests.filter(r => r.params.p.startsWith('workspace-')).length).toBe(1);
  await consent(page, 'no');
  await load(page);
  expect(requests.filter(r => r.params.p.startsWith('workspace-'))).toHaveLength(1);
});

test('privacy remains reachable after loading media in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const requests = await start(page);
  await consent(page, 'yes');
  await load(page);
  const button = page.locator('#appearanceButton');
  const bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await button.click();
  await page.locator('#appearancePanel [data-usage-choice="no"]').click();
  await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
  await page.keyboard.press('Escape');
  const before = requests.length;
  await load(page);
  expect(requests).toHaveLength(before);
});
async function settings(page: Page) {
  if (await page.locator('#appearancePanel').isHidden()) await page.locator('#appearanceButton').click();
}
async function consent(page: Page, value: 'yes' | 'no') {
  await settings(page);
  await page.locator(`#appearancePanel [data-usage-choice="${value}"]`).click();
  await page.keyboard.press('Escape');
}
async function load(page: Page, count = 2) {
  await page.locator('#multiFileInput').setInputFiles(files(count));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => (window as any).__testAPI.isGridMode)).toBe(count > 1);
}
const comparisons = (requests: { params: Record<string, string> }[]) => requests.filter(r => /^comparison-(image|video|audio|mixed)-[1234]$/.test(r.params.p));

test('themes persist independently of consent and never change media rendering', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'no');
  for (const name of ['starfield', 'solar', 'nebula', 'glacier']) {
    await settings(page);
    await page.locator(`[data-appearance-choice="${name}"]`).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-appearance', name);
  }
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'glacier');
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await load(page);
  await expect(page.locator('.landing-atmosphere')).toBeHidden();
  const before = await page.locator('#layerEditA img').evaluate(el => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity }));
  await settings(page);
  await page.locator('[data-appearance-choice="nebula"]').click();
  const after = await page.locator('#layerEditA img').evaluate(el => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity }));
  expect(after).toEqual(before);
  expect(requests).toHaveLength(0);
});

test('no request before consent, No persists, later Yes counts only new comparisons', async ({ page }) => {
  const requests = await start(page);
  await load(page);
  expect(requests).toHaveLength(0);
  await consent(page, 'no');
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await load(page);
  expect(requests).toHaveLength(0);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].params.p).toBe('/');
  expect(comparisons(requests)).toHaveLength(0);
  await load(page, 3);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  expect(comparisons(requests)[0].params.p).toBe('comparison-image-3');
  await consent(page, 'no');
  await load(page, 4);
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
  expect(comparisons(requests)).toHaveLength(1);
});

test('new loads count once each; duplicate readiness and layout changes do not', async ({ page }) => {
  const requests = await start(page, '?usageTest=1&private-url=secret#secret-fragment');
  await consent(page, 'yes');
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  await page.evaluate('checkAllLoaded(); _usage.comparisonReady(_usage.epoch, ["image", "image"]);');
  await page.keyboard.press('s');
  await page.keyboard.press('g');
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(2);
  expect(requests.filter(r => r.params.p === 'comparison-active')).toHaveLength(2);
  expect(requests.filter(r => r.params.p === '/')).toHaveLength(1);
  for (const request of requests) {
    expect(Object.keys(request.params).sort()).toEqual((request.params.ns ? ['e','ns','p','r','rnd','t'] : ['e','p','r','rnd','t']).sort());
    expect(request.headers.referer).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
    expect(JSON.stringify(request.params)).not.toMatch(/private|secret|\.png|localhost/);
  }
});

test('single files count as reviews; failed sets and stale readiness do not', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await load(page, 1);
  await page.evaluate(`const staleUsageEpoch = _usage.epoch; clearAllMedia();
    _usage.comparisonReady(staleUsageEpoch, ['image','image']);
    _usage.comparisonReady(_usage.epoch, ['video','failed']);`);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  expect(comparisons(requests)[0].params.p).toBe('comparison-image-1');
  await load(page, 4);
  await expect.poll(() => comparisons(requests).length).toBe(2);
  expect(comparisons(requests)[1].params.p).toBe('comparison-image-4');
});

test('audio and video readiness produce type-specific comparison counts', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  for (const [type, names] of [['video', ['landscape_a.mp4', 'landscape_b.mp4']], ['audio', ['tone.wav', 'tone.wav']]] as const) {
    // Duplicate source bytes are fine; the count describes loaded sets, not unique media.
    const available = type === 'audio' ? fs.readdirSync(path.join(__dirname,'fixtures')).find(n => n.endsWith('.wav'))! : '';
    await page.locator('#multiFileInput').setInputFiles(type === 'audio' ? [fixture(available), fixture(available)] : names.map(fixture));
    await expect.poll(() => comparisons(requests).some(r => r.params.p === `comparison-${type}-2`), { timeout: 30000 }).toBe(true);
  }
});

test('offline comparisons are dropped and not replayed on reconnect', async ({ page, context }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  await context.setOffline(true);
  await load(page);
  await context.setOffline(false);
  await page.evaluate('_usage.comparisonReady(_usage.epoch, ["image", "image"]);');
  expect(comparisons(requests)).toHaveLength(0);
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
});

test('blocked collector never blocks review or clearing', async ({ page }) => {
  const requests = await start(page);
  await page.route('**/__goatcounter_test__/count?*', route => route.abort('blockedbyclient'));
  await consent(page, 'yes');
  await load(page);
  await settings(page);
  await expect(page.locator('#usageTestStats')).toHaveText(/[1-9]\d* failed requests/);
  await page.keyboard.press('Escape');
  await page.evaluate('clearAllMedia()');
  await expect(page.locator('#landingCta')).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('revoking in another tab stops reporting; clearing preferences withdraws consent', async ({ page, context }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  const other = await context.newPage();
  await other.goto('/?usageTest=1');
  await consent(other, 'no');
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
  await page.keyboard.press('Escape');
  await load(page);
  expect(comparisons(requests)).toHaveLength(0);
  await consent(other, 'yes');
  await other.evaluate(() => localStorage.removeItem('pref_usageConsentTest'));
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('Nothing is reported');
});

test('local test consent does not enable production or ordinary localhost reporting', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  await page.goto('/');
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('unavailable');
  await expect(page.locator('#appearancePanel [data-usage-choice="yes"]')).toBeDisabled();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await page.keyboard.press('Escape');
  await load(page);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('pref_usageConsent'))).toBeNull();
});

test('embedded local tests do not collect usage even with a saved Yes', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  await page.route('**/embedding-test', route => route.fulfill({ contentType:'text/html', body:'<iframe src="/?usageTest=1"></iframe>' }));
  await page.goto('/embedding-test');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('body')).toHaveAttribute('data-appearance', 'original');
  await frame.locator('#multiFileInput').setInputFiles(files());
  await expect(frame.locator('#comparisonView')).toHaveClass(/active/);
  expect(requests).toHaveLength(1);
});

test('reduced motion is static; panel works at narrow widths and with keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, '');
  await page.setViewportSize({ width: 390, height: 844 });
  await settings(page);
  await page.locator('[data-appearance-choice="solar"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'solar');
  expect(await page.locator('.solar-body').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  const box = await page.locator('#appearancePanel').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appearanceButton')).toBeFocused();
  await expect(page.locator('#appearancePanel')).toBeHidden();
});

test('turning sharing off cancels an in-flight request without retrying', async ({ page }) => {
  await start(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let sent = 0;
  await page.route('**/__goatcounter_test__/count?*', async route => {
    sent++;
    await held;
    await route.fulfill({ status: 200, body: '' }).catch(() => {});
  });
  const failed: string[] = [];
  page.on('requestfailed', request => { if (request.url().includes('__goatcounter_test__')) failed.push(request.failure()?.errorText || ''); });
  try {
    await consent(page, 'yes');
    await expect.poll(() => sent).toBe(1);
    await consent(page, 'no');
    await expect.poll(() => failed.length).toBe(1);
    expect(failed[0]).toContain('ABORTED');
    await load(page);
    expect(sent).toBe(1);
  } finally { release(); }
});

test('host negotiation aborts an in-flight standalone request and permanently retires reporting', async ({ page }) => {
  await start(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let sent = 0;
  await page.route('**/__goatcounter_test__/count?*', async route => {
    sent++; await held;
    await route.fulfill({ status: 200, body: '' }).catch(() => {});
  });
  const failed: string[] = [];
  page.on('requestfailed', request => { if (request.url().includes('__goatcounter_test__')) failed.push(request.failure()?.errorText || ''); });
  try {
    await consent(page, 'yes');
    await expect.poll(() => sent).toBe(1);
    await page.evaluate(base64 => window.postMessage({ type: 'WARPDIFF_LOAD', requestId: 'managed',
      capabilities: { managedReview: true }, slotLabels: [null, 'Candidate'],
      files: [{ name: 'host.png', contentType: 'image/png', base64 }] }, location.origin), image.toString('base64'));
    await expect.poll(() => page.evaluate('_hostLoadRequest?.status')).toBe('ready');
    await expect.poll(() => failed.length).toBe(1);
    expect(failed[0]).toContain('ABORTED');
    await page.evaluate('_usage.enterStandalone(); _usage.beginLoad("image", 1)');
    expect(sent).toBe(1);
  } finally { release(); }
});

test('corrupt consent fails closed and invalid appearance falls back to Original', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pref_usageConsentTest', '{broken');
    localStorage.setItem('pref_appearance', '"unknown"');
  });
  const requests = await start(page);
  await expect(page.locator('#usageInvitation')).toBeVisible();
  await load(page);
  expect(requests).toHaveLength(0);
});

test('Starfield is selected visibly, stops when hidden or reduced, and resumes', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__starfieldMessages = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: any, transfer?: any) {
        if (['start','stop'].includes(message.type)) (window as any).__starfieldMessages.push(message.type);
        super.postMessage(message, transfer);
      }
    };
  });
  await start(page, '');
  const last = () => page.evaluate(() => (window as any).__starfieldMessages.at(-1));
  await expect.poll(last).toBe('stop');
  await settings(page);
  await page.locator('[data-appearance-choice="starfield"]').click();
  await expect.poll(last).toBe('start');
  await page.locator('[data-appearance-choice="solar"]').click();
  await expect.poll(last).toBe('stop');
  await page.locator('[data-appearance-choice="starfield"]').click();
  await expect.poll(last).toBe('start');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(last).toBe('stop');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(last).toBe('start');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable:true, value:true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(last).toBe('stop');
  await page.evaluate(() => { delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(last).toBe('start');
  await page.keyboard.press('Escape');
  await load(page);
  await expect.poll(last).toBe('stop');
});

test('Solar planes stay fixed while bodies follow their ellipses at desktop and mobile sizes', async ({ page }) => {
  await start(page, '');
  await settings(page);
  await page.locator('[data-appearance-choice="solar"]').click();
  await page.keyboard.press('Escape');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator('.solar-orbit').evaluateAll(planes => planes.every(el => {
      const rx = el.clientWidth / 2, ry = el.clientHeight / 2;
      return (el as HTMLElement).style.getPropertyValue('--solar-path').includes('M ' + (rx * 2) + ' ' + ry);
    }))).toBe(true);
    await page.locator('.solar-body').evaluateAll(async bodies => {
      await Promise.all(bodies.map(async body => { const animation = body.getAnimations()[0]; animation.pause(); await animation.ready; }));
    });
    const frames = [];
    for (const fraction of [0, .2, .45, .7]) {
      frames.push(await page.evaluate(fraction => {
        return [...document.querySelectorAll('.solar-orbit')].map(orbit => {
          const plane = orbit as HTMLElement;
          const bodies = [...plane.querySelectorAll('.solar-body')].map(body => {
            const animation = body.getAnimations()[0];
            animation.pause();
            animation.currentTime = fraction * Number(animation.effect!.getTiming().duration);
            const r = body.getBoundingClientRect(), p = plane.getBoundingClientRect();
            const dx = r.x + r.width / 2 - (p.x + p.width / 2);
            const dy = r.y + r.height / 2 - (p.y + p.height / 2);
            const angle = -18 * Math.PI / 180;
            const x = dx * Math.cos(angle) + dy * Math.sin(angle);
            const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
            return { x: r.x, y: r.y, ellipse: (x / (plane.clientWidth / 2)) ** 2 + (y / (plane.clientHeight / 2)) ** 2 };
          });
          return { transform: getComputedStyle(plane).transform, bounds: plane.getBoundingClientRect().toJSON(), bodies };
        });
      }, fraction));
    }
    for (const frame of frames) for (let i = 0; i < frame.length; i++) {
      expect(frame[i].transform).toBe(frames[0][i].transform);
      expect(frame[i].bounds).toEqual(frames[0][i].bounds);
      for (const body of frame[i].bodies) expect(body.ellipse).toBeCloseTo(1, 1);
    }
    expect(Math.abs(frames[1][0].bodies[0].x - frames[0][0].bodies[0].x)).toBeGreaterThan(10);
  }
});

test('legacy starfield migrates once and X no longer changes the appearance', async ({ page }) => {
  await start(page, '');
  await page.evaluate(() => localStorage.setItem('starfieldOn', '1'));
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'starfield');
  expect(await page.evaluate(() => localStorage.getItem('starfieldOn'))).toBeNull();
  await page.keyboard.press('x');
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'starfield');
  await settings(page);
  await page.locator('[data-appearance-choice="original"]').click();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-appearance', 'original');
  await page.keyboard.press('x');
  await expect(page.locator('#dropzoneStarfield')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('starfieldOn'))).toBeNull();
});

test('Nebula moves only while visible and keeps a still galaxy with reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    (window as any).__nebulaFrames = 0;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if ((this.canvas as HTMLCanvasElement).id === 'nebulaGalaxy') (window as any).__nebulaFrames++;
      return clear.apply(this, args);
    };
  });
  await start(page, '');
  await settings(page);
  await page.locator('[data-appearance-choice="nebula"]').click();
  await page.keyboard.press('Escape');
  const canvas = page.locator('#nebulaGalaxy');
  const frames = () => page.evaluate(() => (window as any).__nebulaFrames);
  const snapshot = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(150);
  const first = await snapshot();
  const initialFrames = await frames();
  await page.waitForTimeout(300);
  expect(await frames()).toBeGreaterThan(initialFrames);
  expect(await snapshot()).not.toBe(first);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  const still = await snapshot(), stopped = await frames();
  await page.waitForTimeout(300);
  expect(await frames()).toBe(stopped);
  expect(await snapshot()).toBe(still);
  expect(await canvas.evaluate(el => {
    const c = el as HTMLCanvasElement;
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
  })).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(150);
  expect(await frames()).toBeGreaterThan(stopped);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenFrames = await frames();
  await page.waitForTimeout(300);
  expect(await frames()).toBe(hiddenFrames);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  expect(await frames()).toBeGreaterThan(hiddenFrames);
  await settings(page);
  await page.locator('[data-appearance-choice="solar"]').click();
  await page.keyboard.press('Escape');
  const otherFrames = await frames();
  await page.waitForTimeout(300);
  expect(await frames()).toBe(otherFrames);
  await settings(page);
  await page.locator('[data-appearance-choice="nebula"]').click();
  await page.keyboard.press('Escape');
  await load(page);
  const reviewFrames = await frames();
  await page.waitForTimeout(300);
  expect(await frames()).toBe(reviewFrames);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate('clearAllMedia()');
  await page.waitForTimeout(150);
  await expect(canvas).toBeVisible();
  expect(await frames()).toBeGreaterThan(reviewFrames);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const consentVersion = Number(fs.readFileSync(path.join(__dirname, '..', 'js', 'usage.js'), 'utf8')
  .match(/const _USAGE_CONSENT_VERSION = (\d+);/)![1]);

test('consent records the accepted scope and time locally, and survives ordinary reloads', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pref_usageConsentTest')!));
  expect(saved).toEqual({ choice: 'yes', version: consentVersion, decidedAt: expect.any(String) });
  expect(Number.isFinite(Date.parse(saved.decidedAt))).toBe(true);
  await expect.poll(() => requests.length).toBe(1);
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  expect(requests).toHaveLength(1); // Saved Yes does not guess launch identity.
  await load(page);
  await expect.poll(() => requests.filter(r => r.params.p === '/').length).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pref_usageConsentTest')!))).toEqual(saved);
  expect(requests.every(r => !JSON.stringify(r.params).match(/decidedAt|version|consent/))).toBe(true);
});

test('legacy, mismatched and incomplete Yes records cannot authorize reporting or replay', async ({ page }) => {
  const requests = await start(page);
  const date = new Date().toISOString();
  for (const saved of ['yes',
    { choice: 'yes', version: consentVersion - 1, decidedAt: date },
    { choice: 'yes', version: consentVersion + 1, decidedAt: date },
    { choice: 'yes', version: String(consentVersion), decidedAt: date },
    { choice: 'yes', version: consentVersion },
    { choice: 'yes', version: consentVersion, decidedAt: 'invalid' }]) {
    await page.evaluate(saved => {
      localStorage.removeItem('pref_usageInvitationDismissedTest'); // independent record scenario
      localStorage.setItem('pref_usageConsentTest', JSON.stringify(saved));
    }, saved);
    await page.reload();
    await expect(page.locator('#usageInvitationTitle')).toHaveText('Review usage sharing');
    await expect(page.locator('#usageConsentReview')).toBeVisible();
    await load(page);
    expect(requests).toHaveLength(0);
  }
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  expect(comparisons(requests)).toHaveLength(0);
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
});

test('No remains off without renewed prompting across legacy and changed scopes', async ({ page }) => {
  const requests = await start(page);
  for (const saved of ['no', { choice: 'no', version: consentVersion - 1 },
    { choice: 'no', version: consentVersion + 1 }]) {
    await page.evaluate(saved => localStorage.setItem('pref_usageConsentTest', JSON.stringify(saved)), saved);
    await page.reload();
    await expect(page.locator('#usageInvitation')).toBeHidden();
    await settings(page);
    await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
    await page.keyboard.press('Escape');
    await load(page);
    expect(requests).toHaveLength(0);
  }
});

test('a mismatched consent scope from another tab pauses an already open reporting tab', async ({ page, context }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(version => localStorage.setItem('pref_usageConsentTest', JSON.stringify({
    choice: 'yes', version, decidedAt: new Date().toISOString()
  })), consentVersion + 1);
  await expect(page.locator('#usageInvitationTitle')).toHaveText('Review usage sharing');
  await load(page);
  expect(requests).toHaveLength(1);
});

test.describe('consent scope changes between actual script revisions', () => {
  test.use({ serviceWorkers: 'block' });
  test('scope upgrades and downgrades fail closed; fresh consent resumes at the new scope', async ({ page }) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'usage.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    let servedVersion = consentVersion;
    const adapter = () => source.replace(/const _USAGE_CONSENT_VERSION = \d+;/, `const _USAGE_CONSENT_VERSION = ${servedVersion};`)
      .replaceAll(`scope-${consentVersion}`, `scope-${servedVersion}`);
    await page.route('**/js/usage.js', route => route.fulfill({ contentType: 'application/javascript',
      body: adapter() }));
    await page.route(/\/?\?usageTest=1$/, route => route.fulfill({ contentType: 'text/html', body: html
      .replaceAll(`scope-${consentVersion}`, `scope-${servedVersion}`)
      .replace(/integrity="sha256-[^"]+"/, `integrity="sha256-${createHash('sha256').update(adapter()).digest('base64')}"`) }));
    const requests = await start(page);
    await consent(page, 'yes');
    await expect.poll(() => requests.length).toBe(1);
    servedVersion++;
    await page.reload();
    await expect(page.locator('#usageConsentReview')).toBeVisible();
    await load(page);
    expect(requests).toHaveLength(1);
    await consent(page, 'yes');
    await expect.poll(() => requests.length).toBe(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pref_usageConsentTest')!).version)).toBe(servedVersion);
    servedVersion--;
    await page.reload();
    await expect(page.locator('#usageConsentReview')).toBeVisible();
    await load(page);
    expect(requests).toHaveLength(2);
    await consent(page, 'no');
    servedVersion++;
    await page.reload();
    await expect(page.locator('#usageInvitation')).toBeHidden();
    await load(page);
    expect(requests).toHaveLength(2);
  });
});

test('feature adoption counts deliberate actions once per ready review, not restored layout', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  const featureLabels = () => requests.map(r => r.params.p).filter(p => p.startsWith('feature-'));
  expect(featureLabels()).toEqual([]);
  await page.locator('#stackIconBtn').click(); // Stack; also moves focus out of privacy controls
  await page.keyboard.press('q'); // valid image wipe
  await page.keyboard.press('q');
  await page.keyboard.press('q');
  await page.keyboard.press('d'); // Difference replaces wipe
  await page.keyboard.press('z');
  await page.locator('#scopesToggleBtn').click();
  await page.locator('#gridIconBtn').click();
  await page.evaluate('toggleTileCheck()');
  await expect.poll(featureLabels).toEqual(expect.arrayContaining([
    'feature-stack-image-2', 'feature-grid-image-2', 'feature-wipe-image-2',
    'feature-difference-image-2', 'feature-loupe-image-2', 'feature-scopes-image-2', 'feature-tile-check-image-2'
  ]));
  expect(new Set(featureLabels()).size).toBe(featureLabels().length);
  const before = featureLabels().length;
  await consent(page, 'no');
  await consent(page, 'yes');
  await page.evaluate('toggleMagnifier(); toggleMagnifier(); toggleVideoScopes(); toggleVideoScopes();');
  expect(featureLabels()).toHaveLength(before); // old review cannot resume reporting
  await load(page);
  await page.locator('#stackIconBtn').click();
  await expect.poll(() => featureLabels().filter(p => p === 'feature-stack-image-2').length).toBe(2);
});

test('scrub counts completed drags, surfaces and threshold crossings, excluding click, loop and cancellation', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  const wav = fs.readdirSync(path.join(__dirname, 'fixtures')).find(n => n.endsWith('.wav'))!;
  await page.locator('#multiFileInput').setInputFiles(fixture(wav));
  await expect.poll(() => comparisons(requests).length).toBe(1);
  await page.waitForFunction(() => (window as any).eval('Object.keys(_audioSlotVizData).length > 0'));
  const canvas = page.locator('.audio-viz-slot-canvas').first();
  const drag = async (fraction: number, end: 'up' | 'blur' = 'up') => {
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width * .25, y = box.y + box.height * fraction;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .65, y, { steps: 5 });
    if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
  };
  const scrubs = () => requests.map(r => r.params.p).filter(p => p.startsWith('scrub-'));
  await canvas.click({ position: { x: 70, y: 40 } });
  await page.keyboard.down('Shift'); await drag(.2); await page.keyboard.up('Shift');
  await drag(.2, 'blur');
  expect(scrubs()).toEqual([]);
  await page.evaluate('clearLoopMarkers()');
  await drag(.2);
  await expect.poll(scrubs).toEqual(expect.arrayContaining(['scrub-waveform-audio-1', 'scrub-threshold-1-audio-1']));
  await drag(.7);
  for (let i = 2; i < 21; i++) await drag(.2);
  await expect.poll(scrubs).toEqual(expect.arrayContaining([
    'scrub-spectrogram-audio-1', 'scrub-threshold-2-audio-1', 'scrub-threshold-6-audio-1', 'scrub-threshold-21-audio-1'
  ]));
  expect(scrubs()).toHaveLength(6);
  expect(requests.some(r => r.params.p === 'feature-audio-viz-audio-1')).toBe(false); // graphs are automatic
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 20);
  await page.evaluate('clearAllMedia()'); await page.mouse.up();
  expect(scrubs()).toHaveLength(6);
});

test('video timeline scrubbing and opening combined audio graphs have distinct counts', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_a.mp4'));
  await expect.poll(() => comparisons(requests).length).toBe(1);
  await page.evaluate('pauseAllMedia()');
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('#waveformToggleBtn').click();
  await expect.poll(() => requests.map(r => r.params.p)).toEqual(expect.arrayContaining([
    'scrub-timeline-video-1', 'scrub-threshold-1-video-1', 'feature-audio-viz-video-1'
  ]));
});

test('broken media counts one failed load without recording the filename or a ready review', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await page.locator('#multiFileInput').setInputFiles([1,2].map(i => ({ name: `secret-customer-${i}.png`, mimeType: 'image/png', buffer: Buffer.from('invalid') })));
  await expect.poll(() => requests.filter(r => r.params.p === 'load-failed-image-2').length).toBe(1);
  expect(requests.filter(r => r.params.p === 'load-attempt-image-2')).toHaveLength(1);
  expect(comparisons(requests)).toHaveLength(0);
  expect(JSON.stringify(requests.map(r => r.params))).not.toMatch(/secret|customer|invalid|\.png/);
  await page.evaluate('clearAllMedia()');
  expect(requests.filter(r => r.params.p === 'load-failed-image-2')).toHaveLength(1);
});

test('blocked analysis worker counts a successful fallback; terminal analysis failure is separate', async ({ page, context }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await context.route('**/js/audio-analysis-worker.js', route => route.abort());
  const wav = fs.readdirSync(path.join(__dirname, 'fixtures')).find(n => n.endsWith('.wav'))!;
  await page.locator('#multiFileInput').setInputFiles([fixture(wav), fixture(wav)]);
  await expect.poll(() => requests.filter(r => r.params.p === 'analysis-fallback-audio-2').length).toBe(1);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  expect(requests.filter(r => r.params.p === 'analysis-attempt-audio-2')).toHaveLength(1);
  expect(requests.some(r => r.params.p === 'analysis-failed-audio-2')).toBe(false);
  await page.evaluate(`computeWaveformData = () => { throw new Error('secret filename /private/client.wav'); };`);
  await page.locator('#multiFileInput').setInputFiles(fixture(wav));
  await expect.poll(() => requests.filter(r => r.params.p === 'analysis-failed-audio-1').length).toBe(1);
  expect(requests.some(r => r.params.p === 'analysis-fallback-audio-1')).toBe(false);
  expect(JSON.stringify(requests.map(r => r.params))).not.toMatch(/secret|filename|private|client|\.wav/);
});

test('pending diagnostic tickets cannot cross clear, consent withdrawal or offline boundaries', async ({ page, context }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await load(page);
  await page.evaluate(`window.pendingUsageTest = _usage.startOperation('analysis');`);
  await load(page);
  await page.evaluate(`_usage.outcome(window.pendingUsageTest, 'analysis-failed');
    window.pendingUsageTest = _usage.startOperation('preview');`);
  await consent(page, 'no'); await consent(page, 'yes');
  await page.evaluate(`_usage.outcome(window.pendingUsageTest, 'preview-unavailable');`);
  await load(page);
  await page.evaluate(`window.pendingUsageTest = _usage.startOperation('continuous');`);
  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await context.setOffline(false);
  await page.evaluate(`_usage.outcome(window.pendingUsageTest, 'continuous-fallback');`);
  expect(requests.some(r => /analysis-failed|preview-unavailable|continuous-fallback/.test(r.params.p))).toBe(false);
});

test('preview preparation reports reduced quality and unavailability as separate fixed outcomes', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  await page.evaluate(`_scrubPreviewPlan = () => ({ sampleRate:8000, bytes:96000, limited:true });`);
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_a.mp4'));
  await expect.poll(() => requests.some(r => r.params.p === 'preview-reduced-video-1'), {timeout:15000}).toBe(true);
  expect(requests.filter(r => r.params.p === 'preview-attempt-video-1')).toHaveLength(1);
  expect(requests.some(r => r.params.p === 'preview-unavailable-video-1')).toBe(false);
  await page.evaluate(`_prepareVideoScrubBuffer = async () => { throw new Error('private-project.mp4'); };`);
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_b.mp4'));
  await expect.poll(() => requests.some(r => r.params.p === 'preview-unavailable-video-1'), {timeout:15000}).toBe(true);
  expect(JSON.stringify(requests.map(r => r.params))).not.toMatch(/private-project|\.mp4/);
});

test('unavailable Continuous processor uses short previews and reports one fallback per load', async ({ page }) => {
  const requests = await start(page);
  await consent(page, 'yes');
  // Chromium's AudioWorklet module loader bypasses Playwright routing. Reject
  // module preparation at its API boundary while retaining the actual engine.
  await page.evaluate(() => {
    const worklet = (window as any).getAudioContext().audioWorklet;
    Object.getPrototypeOf(worklet).addModule = async () => { throw new Error('processor unavailable'); };
  });
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_a.mp4'));
  await expect.poll(() => requests.some(r => r.params.p === 'continuous-fallback-video-1'), {timeout:15000}).toBe(true);
  await page.evaluate('_prepareContinuousScrub(); _prepareContinuousScrub();');
  expect(requests.filter(r => r.params.p === 'continuous-attempt-video-1')).toHaveLength(1);
  expect(requests.filter(r => r.params.p === 'continuous-fallback-video-1')).toHaveLength(1);
  expect(requests.some(r => r.params.p === 'preview-unavailable-video-1')).toBe(false);
});

test('readiness waits for every slot and cannot revive an incomplete pre-consent load', async ({ page }) => {
  const requests = await start(page);
  await page.evaluate(`_usage.beginLoad('image', 2); _usage.slotState('editA', 'ready');
    _usage.comparisonReady(_usage.epoch, ['image','image']);`);
  await consent(page, 'yes');
  await page.evaluate(`_usage.slotState('editB', 'ready');`);
  expect(comparisons(requests)).toHaveLength(0);
  await page.evaluate(`_usage.resetComparison(); _usage.beginLoad('image', 2);
    _usage.slotState('editA', 'ready'); _usage.comparisonReady(_usage.epoch, ['image','image']);`);
  expect(comparisons(requests)).toHaveLength(0);
  await page.evaluate(`_usage.slotState('editB', 'ready'); _usage.slotState('editB', 'ready');`);
  await expect.poll(() => comparisons(requests).length).toBe(1);
});

test('sharing appears first and the provider is accessible through expandable details', async ({ page }) => {
  const requests = await start(page);
  await expect(page.locator('#usageInvitation')).not.toContainText('GoatCounter');
  await settings(page);
  await expect(page.locator('#usageDisclosure')).not.toHaveAttribute('open');
  await expect(page.getByRole('link', {name:'GoatCounter privacy'})).toBeHidden();
  const positions = await page.evaluate(() => ({
    sharing:document.querySelector('.usage-section')!.getBoundingClientRect().top,
    appearances:document.querySelector('.appearance-section')!.getBoundingClientRect().top
  }));
  expect(positions.sharing).toBeLessThan(positions.appearances);
  await page.locator('#usageDisclosure summary').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('link', {name:'GoatCounter privacy'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#usageDetails').click();
  await expect(page.locator('#usageDisclosure summary')).toBeFocused();
  await expect(page.getByRole('link', {name:'GoatCounter privacy'})).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('continuing without answering quietly retires the invitation without recording consent or reporting', async ({ page }) => {
  const requests = await start(page);
  await expect(page.locator('#usageInvitation')).toBeVisible();
  await load(page);
  await page.evaluate('clearAllMedia()');
  await expect(page.locator('#usageInvitation')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('pref_usageInvitationDismissedTest'))).toBe('true');
  expect(await page.evaluate(() => localStorage.getItem('pref_usageConsentTest'))).toBeNull();
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await settings(page);
  await expect(page.locator('#usageStatus')).toHaveText('Sharing is off. You can enable it here anytime.');
  await expect(page.locator('#appearancePanel [data-usage-choice][aria-pressed="true"]')).toHaveCount(0);
  await page.locator('[data-appearance-choice="solar"]').click();
  await page.keyboard.press('Escape');
  await load(page);
  expect(requests).toHaveLength(0);
  await consent(page, 'yes');
  await expect.poll(() => requests.length).toBe(1);
  expect(comparisons(requests)).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('pref_usageInvitationDismissedTest'))).toBe('false');
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
});

test('quiet dismissal follows other tabs; clearing its local preference permits an invitation again', async ({ page, context }) => {
  const requests = await start(page);
  const other = await context.newPage();
  await other.goto('/?usageTest=1');
  await expect(other.locator('#usageInvitation')).toBeVisible();
  await load(page);
  await expect(other.locator('#usageInvitation')).toBeHidden();
  expect(await other.evaluate(() => localStorage.getItem('pref_usageConsentTest'))).toBeNull();
  await other.evaluate(() => localStorage.removeItem('pref_usageInvitationDismissedTest'));
  await page.evaluate('clearAllMedia()');
  await expect(page.locator('#usageInvitation')).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('ignored scope review stays off across reloads without silently updating the old Yes', async ({ page }) => {
  await page.addInitScript(version => {
    if (!localStorage.getItem('pref_usageConsentTest')) localStorage.setItem('pref_usageConsentTest', JSON.stringify({
      choice:'yes', version:version - 1, decidedAt:'2026-09-29T20:00:00.000Z'
    }));
  }, consentVersion);
  const requests = await start(page);
  const old = await page.evaluate(() => localStorage.getItem('pref_usageConsentTest'));
  await expect(page.locator('#usageInvitationTitle')).toHaveText('Review usage sharing');
  await load(page);
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('Nothing is reported until you agree');
  expect(await page.evaluate(() => localStorage.getItem('pref_usageConsentTest'))).toBe(old);
  expect(requests).toHaveLength(0);
});

test('dismissal write failure still suppresses this page and never enables sharing', async ({ page }) => {
  const requests = await start(page);
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'pref_usageInvitationDismissedTest') throw new DOMException('Blocked', 'SecurityError');
      return write.call(this, key, value);
    };
  });
  await load(page);
  await page.evaluate('clearAllMedia()');
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await settings(page);
  await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
  expect(requests).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeVisible();
});
