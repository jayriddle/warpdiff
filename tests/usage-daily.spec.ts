import { test, expect, Page, BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Disposable contexts, fixed Date only (real timers), loopback collector.
// Deny all external traffic: no synthetic event can reach the live account.
test.use({ serviceWorkers: 'block' });
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const version = html.match(/const APP_VERSION = '([^']+)'/)![1];
const scope = Number(fs.readFileSync(path.join(root, 'js/usage.js'), 'utf8')
  .match(/const _USAGE_CONSENT_VERSION = (\d+);/)![1]);
const image = fs.readFileSync(path.join(root, 'WarpDiff_Logo_v1.png'));
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const day1 = '2026-10-02T23:59:00.000Z', day2 = '2026-10-03T00:01:00.000Z';
const marker = 'pref_usageActiveDayTest';
const lockName = 'warpdiff-usageActiveDayTest';

async function fixture(context: BrowserContext) {
  const requests: Record<string, string>[] = [];
  const external: string[] = [];
  await context.addInitScript(version => localStorage.setItem('lastSeenVersion', version), version);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.endsWith('/__goatcounter_test__/count')) {
      requests.push(Object.fromEntries(url.searchParams));
      return route.fulfill({ contentType: 'image/gif', body: gif });
    }
    return route.continue();
  });
  return { requests, external, daily: () => requests.filter(r => r.p === 'daily-active') };
}
async function open(page: Page) {
  await page.clock.setFixedTime(day1);
  await page.goto('/?usageTest=1&private-query=secret#private-fragment');
}
async function choice(page: Page, value: 'yes' | 'no') {
  await page.locator('#appearanceButton').click();
  await page.locator(`#appearancePanel [data-usage-choice="${value}"]`).click();
  await page.keyboard.press('Escape');
}
async function load(page: Page, count = 2) {
  await page.locator('#multiFileInput').setInputFiles(Array.from({ length: count }, (_, i) => ({
    name: `private-source-${i}.png`, mimeType: 'image/png', buffer: image
  })));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  // Programmatic file input leaves focus on the privacy button; the app rightly
  // reserves keys there. Put subsequent keyboard actions back on the review.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}
const comparisons = (requests: Record<string, string>[]) => requests.filter(r => /\/comparison-image-/.test(r.p));

test('ten ready comparisons produce one daily count; an open tab renews on next-day use', async ({ page, context }) => {
  const { requests, daily, external } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  expect(daily()).toHaveLength(0); // Consent alone is not comparison activity.
  for (let i = 0; i < 10; i++) {
    await load(page, i % 2 ? 4 : 3);
    await expect.poll(() => comparisons(requests).length).toBe(i + 1);
  }
  await expect.poll(() => daily().length).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), marker)).toBe('"2026-10-02"');
  await page.clock.setFixedTime(day2);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(120);
  expect(daily()).toHaveLength(1); // Date/visibility/idle do not send a heartbeat.
  await page.locator('#gridIconBtn').click();
  await expect.poll(() => daily().length).toBe(2);
  await page.keyboard.press('s');
  await page.locator('#gridIconBtn').click();
  expect(daily()).toHaveLength(2);
  expect(comparisons(requests)).toHaveLength(10);
  expect(requests.filter(r => r.p === '/')).toHaveLength(1);
  for (const request of daily()) {
    expect(Object.keys(request).sort()).toEqual(['e', 'ns', 'p', 'r', 'rnd', 't']);
    expect(request).toMatchObject({ p: 'daily-active', e: 'true', ns: 'true', r: '', t: 'WarpDiff daily active browsers (UTC)' });
    expect(JSON.stringify(request)).not.toMatch(/2026-|private|secret|image|video|\.png|scope|userId/);
  }
  expect(external).toEqual([]);
});

test('same-day reloads and simultaneous ready tabs share an atomic daily claim', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  const other = await context.newPage();
  await open(other);
  await Promise.all([load(page), load(other)]);
  await expect.poll(() => daily().length).toBe(1);
  await page.reload();
  await load(page);
  expect(daily()).toHaveLength(1);
  await Promise.all([page.clock.setFixedTime(day2), other.clock.setFixedTime(day2)]);
  await Promise.all([page.keyboard.press('s'), other.keyboard.press('s')]);
  await expect.poll(() => daily().length).toBe(2);
  await choice(page, 'no');
  await choice(page, 'yes');
  await load(page);
  expect(daily()).toHaveLength(2); // No → Yes does not reset the counted date.
  await other.close();
});

test('a known hotkey or wheel can renew an existing review; synthetic input cannot', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  await load(page);
  await expect.poll(() => daily().length).toBe(1);
  await page.clock.setFixedTime(day2);
  await page.locator('#comparisonView').dispatchEvent('pointerdown');
  await page.keyboard.press('Shift');
  await page.keyboard.press('F8'); // Unassigned, not a WarpDiff action.
  expect(daily()).toHaveLength(1);
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'typing-fixture';
    document.body.append(input); input.focus();
  });
  await page.keyboard.press('s');
  expect(daily()).toHaveLength(1);
  await page.evaluate(() => document.getElementById('typing-fixture')!.remove());
  await page.keyboard.press('s');
  await expect.poll(() => daily().length).toBe(2);
  await page.clock.setFixedTime('2026-10-04T00:01:00.000Z');
  await page.locator('#comparisonView').hover();
  await page.mouse.wheel(0, 20);
  await expect.poll(() => daily().length).toBe(3);
});

test('normal playback and scrubbing can renew an existing video review without another comparison', async ({ page, context }) => {
  const { requests, daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  await page.locator('#multiFileInput').setInputFiles(path.join(root, 'tests/fixtures/landscape_a.mp4'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect.poll(() => daily().length).toBe(1);
  await page.clock.setFixedTime(day2);
  await page.locator('#playPauseBtn').click();
  await expect.poll(() => daily().length).toBe(2);
  await page.locator('#playPauseBtn').click();
  await page.clock.setFixedTime('2026-10-04T00:01:00.000Z');
  const box = (await page.locator('#videoProgressContainer').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => daily().length).toBe(3);
  expect(requests.filter(r => /\/comparison-video-1$/.test(r.p))).toHaveLength(1);
});

test('wipe pointer and local keyboard controls renew activity even when they stop event bubbling', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  await load(page);
  await expect.poll(() => daily().length).toBe(1);
  await page.locator('#stackIconBtn').click();
  await page.locator('#wipeToggleBtn').click();
  await expect(page.locator('#wipeDivider')).toBeVisible();
  await page.clock.setFixedTime(day2);
  const box = (await page.locator('#wipeDivider').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2);
  await page.mouse.up();
  await expect.poll(() => daily().length).toBe(2);
  await page.clock.setFixedTime('2026-10-04T00:01:00.000Z');
  await page.locator('#wipeDivider').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => daily().length).toBe(3);
});

test('unanswered, No and outdated consent cannot create or replay a daily marker', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await load(page);
  await choice(page, 'yes');
  await page.keyboard.press('s');
  expect(daily()).toHaveLength(0);
  expect(await page.evaluate(key => localStorage.getItem(key), marker)).toBeNull();
  await choice(page, 'no');
  await load(page);
  expect(daily()).toHaveLength(0);
  await page.evaluate(version => localStorage.setItem('pref_usageConsentTest', JSON.stringify({
    choice: 'yes', version: version - 1, decidedAt: new Date().toISOString()
  })), scope);
  await page.reload();
  await load(page);
  expect(daily()).toHaveLength(0);
  await choice(page, 'yes');
  expect(daily()).toHaveLength(0);
  await load(page);
  await expect.poll(() => daily().length).toBe(1);
});

for (const failure of ['read', 'write', 'locks-missing', 'locks-reject']) test(`daily counting fails closed on ${failure}`, async ({ page, context }) => {
  const { daily, requests } = await fixture(context);
  await page.addInitScript(({ marker, failure }) => {
    if (failure === 'locks-missing') Object.defineProperty(navigator, 'locks', { value: undefined });
    if (failure === 'locks-reject') navigator.locks.request = (() => Promise.reject(new Error('blocked'))) as any;
    const method = failure === 'read' ? 'getItem' : 'setItem';
    if (failure === 'read' || failure === 'write') {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key: string, ...args: any[]) {
        if (key === marker) throw new DOMException('Blocked', 'SecurityError');
        return original.apply(this, [key, ...args] as any);
      } as any;
    }
  }, { marker, failure });
  await open(page);
  await choice(page, 'yes');
  await load(page);
  await expect.poll(() => comparisons(requests).length).toBe(1);
  await page.keyboard.press('s');
  await page.waitForTimeout(120);
  expect(daily()).toHaveLength(0);
});

test('a busy cross-tab lock skips the old activity; release does not replay it', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  await page.evaluate(lockName => {
    navigator.locks.request(lockName, () => new Promise<void>(resolve => {
      (window as any).releaseActivityLock = resolve;
    }));
  }, lockName);
  await page.waitForFunction(() => !!(window as any).releaseActivityLock);
  await load(page);
  await page.waitForTimeout(120);
  expect(daily()).toHaveLength(0);
  await page.evaluate(() => (window as any).releaseActivityLock());
  await page.waitForTimeout(120);
  expect(daily()).toHaveLength(0);
  await page.keyboard.press('s');
  await expect.poll(() => daily().length).toBe(1);
});

for (const boundary of ['withdrawal', 'clear', 'replacement', 'offline', 'host', 'pagehide', 'hidden', 'midnight', 'undelivered-No']) test(`delayed daily claim cannot cross ${boundary}`, async ({ page, context }) => {
  const { daily } = await fixture(context);
  await page.addInitScript(lockName => {
    const original = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = ((name: string, options: any, callback: any) => {
      if (name !== lockName) return original(name, options, callback);
      return original(name, options, async lock => {
        await new Promise<void>(resolve => { (window as any).releaseDailyClaim = resolve; });
        return callback(lock);
      });
    }) as any;
  }, lockName);
  await open(page);
  await choice(page, 'yes');
  await load(page);
  await page.waitForFunction(() => !!(window as any).releaseDailyClaim);
  if (boundary === 'withdrawal') { await choice(page, 'no'); await choice(page, 'yes'); }
  if (boundary === 'clear') await page.evaluate('clearAllMedia()');
  if (boundary === 'replacement') await load(page, 4);
  if (boundary === 'offline') { await context.setOffline(true); await context.setOffline(false); }
  if (boundary === 'host') await page.evaluate('_usage.hostLaunch()');
  if (boundary === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  if (boundary === 'hidden') await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden' }));
  if (boundary === 'midnight') await page.clock.setFixedTime(day2);
  if (boundary === 'undelivered-No') await page.evaluate(() => localStorage.setItem('pref_usageConsentTest', JSON.stringify({choice: 'no'})));
  await page.evaluate(() => (window as any).releaseDailyClaim());
  await page.waitForTimeout(150);
  expect(daily()).toHaveLength(0);
  expect(await page.evaluate(key => localStorage.getItem(key), marker)).toBeNull();
});

test('collector failure is not retried on reload and clock rollback does not double count', async ({ page, context }) => {
  const { daily } = await fixture(context);
  await open(page);
  await choice(page, 'yes');
  let attempts = 0;
  await context.route('**/__goatcounter_test__/count?*', route => {
    if (new URL(route.request().url()).searchParams.get('p') === 'daily-active') attempts++;
    return route.abort();
  });
  await load(page);
  await expect.poll(() => attempts).toBe(1);
  await page.reload();
  await load(page);
  await page.keyboard.press('s');
  expect(attempts).toBe(1);
  await page.clock.setFixedTime(day2);
  await page.keyboard.press('s');
  await expect.poll(() => attempts).toBe(2);
  await page.clock.setFixedTime(day1);
  await page.keyboard.press('s');
  expect(attempts).toBe(2);
  expect(daily()).toHaveLength(0); // Interception above never forwards a count.
});
