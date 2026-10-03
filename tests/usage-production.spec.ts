import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Exercise the actual production host branch using local files. Every request is
// intercepted: these tests must never add synthetic events to the live account.
test.use({ serviceWorkers: 'block' });
const root = path.join(__dirname, '..');
const usageSource = fs.readFileSync(path.join(root, 'js/usage.js'), 'utf8');
const scope = Number(usageSource.match(/const _USAGE_CONSENT_VERSION = (\d+);/)![1]);
const appVersion = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/const APP_VERSION = '([^']+)'/)![1];
const collector = 'https://warpdiff.goatcounter.com/count';
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const image = fs.readFileSync(path.join(root, 'WarpDiff_Logo_v1.png'));
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function fixture(page: Page, options: { host?: string; human?: boolean; saved?: unknown; testSaved?: unknown; verified?: boolean } = {}) {
  const host = options.host || 'jayriddle.github.io';
  const origin = `https://${host}`;
  const counted: { params: Record<string, string>; rawPath: string; headers: Record<string, string> }[] = [];
  const blocked: string[] = [];
  // Normal fixtures use the shipped verified configuration. The emergency hold
  // is exercised separately. Every destination remains locally intercepted.
  const adapter = options.verified === false ? usageSource.replace(
    'const _USAGE_ACCOUNT_VERIFIED = true;', 'const _USAGE_ACCOUNT_VERIFIED = false;') : usageSource;
  await page.addInitScript(({ human, saved, testSaved, appVersion }) => {
    localStorage.setItem('lastSeenVersion', appVersion);
    if (human) Object.defineProperty(navigator, 'webdriver', { get: () => false });
    if (saved !== undefined) localStorage.setItem('pref_usageConsent', JSON.stringify(saved));
    if (testSaved !== undefined) localStorage.setItem('pref_usageConsentTest', JSON.stringify(testSaved));
  }, { human: options.human !== false, saved: options.saved, testSaved: options.testSaved, appVersion });
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin + url.pathname === collector) {
      const params = Object.fromEntries(url.searchParams);
      const rawPath = params.p;
      params.p = params.p.replace(/^v[0-9.]+\//, '');
      counted.push({ params, rawPath, headers: await route.request().allHeaders() });
      return route.fulfill({ contentType: 'image/gif', body: gif });
    }
    if (url.origin === origin && url.pathname.startsWith('/warpdiff/')) {
      const relative = decodeURIComponent(url.pathname.slice('/warpdiff/'.length)) || 'index.html';
      const file = path.resolve(root, relative);
      if (file.startsWith(path.resolve(root) + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        let body: Buffer | string = fs.readFileSync(file);
        if (relative === 'js/usage.js') body = adapter;
        if (relative === 'index.html') body = body.toString().replace(/integrity="sha256-[^"]+"/,
          `integrity="sha256-${createHash('sha256').update(adapter).digest('base64')}"`);
        return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body });
      }
    }
    blocked.push(url.href);
    return route.abort();
  });
  return { origin, counted, blocked };
}
async function choice(page: Page, value: 'yes' | 'no') {
  await page.locator('#appearanceButton').click();
  await page.locator(`#appearancePanel [data-usage-choice="${value}"]`).click();
  await page.keyboard.press('Escape');
}
async function loadPair(page: Page) {
  await page.locator('#multiFileInput').setInputFiles([1, 2].map(n => ({
    name: `private-source-${n}.png`, mimeType: 'image/png', buffer: image
  })));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
}

test('official site sends only after current consent, remembers No, and excludes local-test preferences', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pref_usageInvitationDismissedTest', 'true'));
  const { origin, counted, blocked } = await fixture(page, { testSaved: { choice: 'yes', version: scope, decidedAt: new Date().toISOString() } });
  await page.context().addCookies([{ name: 'collector-test-cookie', value: 'must-not-send', domain: 'warpdiff.goatcounter.com', path: '/', secure: true }]);
  await page.goto(origin + '/warpdiff/?usageTest=1&private-url=secret#secret-fragment');
  await expect(page.locator('#usageInvitation')).toBeVisible();
  await expect(page.locator('#usageInvitationTest')).toBeHidden();
  await loadPair(page);
  expect(counted).toHaveLength(0);
  await choice(page, 'no');
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await loadPair(page);
  expect(counted).toHaveLength(0);
  await choice(page, 'yes');
  await expect.poll(() => counted.length).toBe(1);
  await loadPair(page);
  await expect.poll(() => counted.length).toBe(6);
  expect(counted.map(r => r.params.p).sort()).toEqual(['/', 'comparison-active', 'comparison-image-2', 'daily-active', 'load-attempt-image-2', 'workspace-wide-tall-image-2']);
  expect(counted.find(r => r.params.p === 'comparison-image-2')!.params.ns).toBe('true');
  for (const event of counted) {
    expect(event.rawPath).toBe(event.params.e === 'true' && event.params.p !== 'daily-active' ? `v${appVersion}/` + event.params.p : event.params.p);
    expect(event.headers.cookie).toBeUndefined();
    expect(event.headers.referer).toBeUndefined();
    expect(Object.keys(event.params).sort()).toEqual((event.params.ns ? ['e','ns','p','r','rnd','t'] : ['e','p','r','rnd','t']).sort());
    expect(JSON.stringify(event.params)).not.toMatch(/private|secret|\.png|consent|decidedAt/);
  }
  await choice(page, 'no');
  await loadPair(page);
  expect(counted).toHaveLength(6);
  expect(blocked).toEqual([]);
});

// Adversarial regressions: only disposable contexts and intercepted collectors.
async function savedYes(page: Page) {
  await page.evaluate(version => localStorage.setItem('pref_usageConsent', JSON.stringify({
    choice: 'yes', version, decidedAt: new Date().toISOString()
  })), scope);
  await page.reload();
}

test('confirmed Reset aborts pending counts; canceling Reset preserves them and a new review can report', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page, {
    saved: { choice: 'yes', version: scope, decidedAt: new Date().toISOString() }
  });
  const heldPaths: string[] = [];
  let releaseReplies!: () => void;
  const replies = new Promise<void>(resolve => { releaseReplies = resolve; });
  const pattern = collector + '?*';
  await page.route(pattern, async route => {
    heldPaths.push(new URL(route.request().url()).searchParams.get('p')!);
    await replies;
    // Reset can close these routed requests before the held reply is released.
    await route.fulfill({ contentType: 'image/gif', body: gif }).catch(() => {});
  });
  await page.addInitScript(collector => {
    const records: { path: string; aborted: boolean; settled: boolean }[] = [];
    (window as any).resetFetchAudit = records;
    const fetch = window.fetch;
    window.fetch = function(input, options) {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(collector + '?')) return fetch.call(this, input, options);
      const record = { path: new URL(url).searchParams.get('p')!, aborted: false, settled: false };
      records.push(record);
      options!.signal!.addEventListener('abort', () => { record.aborted = true; }, { once: true });
      const response = fetch.call(this, input, options);
      response.then(() => { record.settled = true; }, () => { record.settled = true; });
      return response;
    };
  }, collector);
  const audit = () => page.evaluate(() => (window as any).resetFetchAudit as {
    path: string; aborted: boolean; settled: boolean
  }[]);
  try {
    await page.goto(origin + '/warpdiff/');
    await loadPair(page);
    await expect.poll(() => heldPaths.length).toBe(6);
    expect(heldPaths.map(p => p.replace(/^v[0-9.]+\//, '')).sort()).toEqual([
      '/', 'comparison-active', 'comparison-image-2', 'daily-active', 'load-attempt-image-2', 'workspace-wide-tall-image-2'
    ]);
    expect((await audit()).every(r => !r.aborted && !r.settled)).toBe(true);

    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#resetBtn').click();
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    expect((await audit()).every(r => !r.aborted && !r.settled)).toBe(true);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetBtn').click();
    await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
    // Check immediately after the real Reset action, not after the sender's
    // three-second timeout, which would conceal missing Clear cancellation.
    const retired = await audit();
    expect(retired).toHaveLength(6);
    expect(retired.every(r => r.aborted)).toBe(true);
    await expect.poll(async () => (await audit()).every(r => r.settled)).toBe(true);
    expect(heldPaths).toHaveLength(6);

    releaseReplies();
    await page.unroute(pattern);
    await loadPair(page);
    await expect.poll(() => counted.length).toBe(4); // The document's visit never replays.
    expect(counted.map(r => r.params.p).sort()).toEqual([
      'comparison-active', 'comparison-image-2', 'load-attempt-image-2', 'workspace-wide-tall-image-2'
    ]);
    expect(blocked).toEqual([]);
  } finally {
    releaseReplies();
  }
});

for (const cleanupFails of [false, true]) test(`failed withdrawal stays off and explains persistence (cleanup fails: ${cleanupFails})`, async ({ page }) => {
  const { origin, counted } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await savedYes(page);
  await loadPair(page);
  await expect.poll(() => counted.some(r => r.params.p === 'comparison-image-2')).toBe(true);
  await page.evaluate(cleanupFails => {
    const save = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(k, v) {
      if (k === 'pref_usageConsent') throw new DOMException('injected', 'QuotaExceededError');
      return save.call(this, k, v);
    };
    Storage.prototype.removeItem = function(k) {
      if (cleanupFails && k === 'pref_usageConsent') throw new DOMException('injected', 'SecurityError');
      return remove.call(this, k);
    };
  }, cleanupFails);
  await choice(page, 'no');
  await page.locator('#appearanceButton').click();
  await expect(page.locator('#usageStatus')).toContainText(cleanupFails ? 'could not remove the previous permission' : 'old permission was removed');
  await page.keyboard.press('Escape');
  const before = counted.length;
  // An unrelated preference notification must not restore the readable old Yes.
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {key: 'pref_usageInvitationDismissed'})));
  await loadPair(page);
  expect(counted).toHaveLength(before);
  if (!cleanupFails) {
    expect(await page.evaluate(() => localStorage.getItem('pref_usageConsent'))).toBeNull();
    await page.reload();
    await loadPair(page);
    expect(counted).toHaveLength(before);
  } else {
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('pref_usageConsent')))! ).choice).toBe('yes');
    // With both durable operations rejected, the warning is the guarantee:
    // current-page refusal survives, but reload can still read the old Yes.
    const reviews = counted.filter(r => r.params.p === 'comparison-image-2').length;
    await page.reload();
    expect(counted).toHaveLength(before); // Launch still awaits manual ownership.
    await loadPair(page);
    await expect.poll(() => counted.filter(r => r.params.p === 'comparison-image-2').length).toBe(reviews + 1);
  }
});

for (const writer of ['related window', 'iframe']) test(`queued No then Yes permanently retires the review (${writer})`, async ({ page }) => {
  const { origin, counted } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await savedYes(page);
  await loadPair(page);
  await expect.poll(() => counted.some(r => r.params.p === 'comparison-image-2')).toBe(true);
  await page.evaluate('window.oldTicket = _usage.startOperation("analysis")');
  await expect.poll(() => counted.some(r => r.params.p === 'analysis-attempt-image-2')).toBe(true);
  await page.evaluate(() => {
    (window as any).consentEvents = 0;
    window.addEventListener('storage', e => { if (e.key === 'pref_usageConsent') (window as any).consentEvents++; });
  });
  if (writer === 'related window') {
    const popup = page.waitForEvent('popup');
    await page.evaluate(() => { window.open(location.href); });
    const other = await popup;
    await other.waitForLoadState();
    await other.evaluate(() => {
      (document.querySelector('#appearancePanel [data-usage-choice="no"]') as HTMLButtonElement).click();
      (document.querySelector('#appearancePanel [data-usage-choice="yes"]') as HTMLButtonElement).click();
    });
  } else {
    await page.evaluate(version => {
      const iframe = document.createElement('iframe'); document.body.appendChild(iframe);
      for (const choice of ['no', 'yes']) iframe.contentWindow!.localStorage.setItem('pref_usageConsent', JSON.stringify({choice, version, decidedAt: new Date().toISOString()}));
    }, scope);
  }
  await expect.poll(() => page.evaluate(() => (window as any).consentEvents)).toBe(2);
  await page.evaluate('toggleMagnifier(); _usage.outcome(window.oldTicket, "analysis-failed")');
  await page.waitForTimeout(100); // Negative assertion after collector dispatch has drained.
  expect(counted.filter(r => /feature-loupe|analysis-failed/.test(r.params.p))).toHaveLength(0);
  const before = counted.filter(r => r.params.p === 'comparison-image-2').length;
  await loadPair(page);
  await expect.poll(() => counted.filter(r => r.params.p === 'comparison-image-2').length).toBe(before + 1);
});

test('saved standalone consent cannot report before a top-level managed handshake', async ({ page }) => {
  const { origin, counted } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await savedYes(page);
  await page.evaluate(base64 => window.postMessage({ type: 'WARPDIFF_LOAD', requestId: 'managed-test',
    capabilities: { managedReview: true, ffmpegTranscode: false }, slotLabels: [null, 'Candidate'],
    files: [{ name: 'private.png', contentType: 'image/png', base64 }] }, location.origin), image.toString('base64'));
  await expect.poll(() => page.evaluate('_hostLoadRequest?.status')).toBe('ready');
  expect(await page.evaluate('_managedReviewActive()')).toBe(true);
  expect(counted).toHaveLength(0);
});

test('N restores saved W state without recording an explicit W opening', async ({ page }) => {
  const { origin, counted } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await page.evaluate(() => localStorage.setItem('pref_audioVizVisible', 'true'));
  await savedYes(page);
  await page.locator('#multiFileInput').setInputFiles(path.join(root, 'tests/fixtures/landscape_a.mp4'));
  await expect.poll(() => counted.some(r => r.params.p === 'comparison-video-1')).toBe(true);
  expect(await page.evaluate('audioVizVisible')).toBe(true);
  await page.keyboard.press('n'); await page.keyboard.press('n');
  expect(await page.evaluate('audioVizVisible')).toBe(true);
  await page.waitForTimeout(100);
  expect(counted.filter(r => r.params.p === 'feature-audio-viz-video-1')).toHaveLength(0);
  await page.keyboard.press('w'); await page.keyboard.press('w');
  await expect.poll(() => counted.filter(r => r.params.p === 'feature-audio-viz-video-1').length).toBe(1);
});

test('current production Yes resumes but outdated Yes waits for renewed consent', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await choice(page, 'yes');
  await expect.poll(() => counted.length).toBe(1);
  await page.reload();
  await expect(page.locator('#usageInvitation')).toBeHidden();
  expect(counted).toHaveLength(1);
  await loadPair(page);
  await expect.poll(() => counted.length).toBe(7);
  await page.evaluate(version => localStorage.setItem('pref_usageConsent', JSON.stringify({
    choice: 'yes', version, decidedAt: new Date().toISOString()
  })), scope + 1);
  await page.reload();
  await expect(page.locator('#usageConsentReview')).toBeVisible();
  await loadPair(page);
  expect(counted).toHaveLength(7);
  expect(blocked).toEqual([]);
});

test('copied site cannot report or accept a destination from the URL', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page, { host: 'copy.example.test', saved: { choice: 'yes', version: scope, decidedAt: new Date().toISOString() } });
  await page.goto(origin + '/warpdiff/?usageTest=1&endpoint=' + encodeURIComponent(collector));
  await expect(page.locator('#usageInvitation')).toBeHidden();
  await page.locator('#appearanceButton').click();
  await expect(page.locator('#appearancePanel [data-usage-choice="yes"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await loadPair(page);
  expect(counted).toHaveLength(0);
  expect(blocked).toEqual([]);
});

test('production automation cannot report even after consent', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page, { human: false });
  await page.goto(origin + '/warpdiff/');
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  await choice(page, 'yes');
  await loadPair(page);
  expect(counted).toHaveLength(0);
  expect(blocked).toEqual([]);
});

test('verified provider details are visible before consent', async ({ page }) => {
  expect(usageSource).toContain('const _USAGE_ACCOUNT_VERIFIED = true;');
  expect(scope).toBe(4);
  const { origin, counted, blocked } = await fixture(page);
  await page.goto(origin + '/warpdiff/');
  await page.locator('#appearanceButton').click();
  await page.locator('#usageDisclosure summary').click();
  const details = page.locator('#usageDisclosure');
  await expect(details).toContainText('operated by Jay Riddle');
  await expect(details).toContainText('browser, operating-system and country-level counts');
  await expect(details).toContainText('GoatCounter’s built-in region, referrer, screen-size, language and individual-pageview collection are disabled');
  await expect(details).toContainText('automatic deletion after 365 days');
  await expect(details.getByRole('link', { name: 'warpdiff@gmail.com' })).toHaveAttribute('href', 'mailto:warpdiff@gmail.com');
  expect(counted).toHaveLength(0);
  expect(blocked).toEqual([]);
});

test('scope-2 Yes requires review and cannot replay the prior load under scope 4', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page, {
    saved: { choice: 'yes', version: 2, decidedAt: new Date().toISOString() }
  });
  await page.goto(origin + '/warpdiff/');
  await expect(page.locator('#usageInvitationTitle')).toHaveText('Review usage sharing');
  await loadPair(page);
  expect(counted).toHaveLength(0);
  await choice(page, 'yes');
  await expect.poll(() => counted.length).toBe(1);
  expect(counted[0].params.p).toBe('/');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pref_usageConsent')!).version)).toBe(4);
  await loadPair(page);
  await expect.poll(() => counted.length).toBe(6);
  expect(blocked).toEqual([]);
});

test('an account-verification hold disables production even with saved consent', async ({ page }) => {
  const { origin, counted, blocked } = await fixture(page, { verified: false,
    saved: { choice: 'yes', version: scope, decidedAt: new Date().toISOString() } });
  await page.goto(origin + '/warpdiff/');
  await page.locator('#appearanceButton').click();
  await expect(page.locator('#usageStatus')).toContainText('unavailable');
  await expect(page.locator('#appearancePanel [data-usage-choice="yes"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await loadPair(page);
  expect(counted).toHaveLength(0);
  expect(blocked).toEqual([]);
});
