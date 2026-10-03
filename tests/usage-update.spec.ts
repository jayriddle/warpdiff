import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';

// Real service worker + local HTTP server, not Playwright route interception.
// The unreachable proxy rejects external destinations; Chromium bypasses it for
// loopback. No production collector is reachable or selected by this fixture.
test.use({ serviceWorkers: 'allow', launchOptions: { args: [
  '--proxy-server=http://127.0.0.1:9', '--disable-quic', '--mute-audio'
] } });

const root = path.join(__dirname, '..');
const currentHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const currentUsage = fs.readFileSync(path.join(root, 'js/usage.js'), 'utf8');
const contract = currentHtml.match(/const _USAGE_DOCUMENT_CONTRACT = '([^']+)'/)![1];
const version = currentHtml.match(/const APP_VERSION = '([^']+)'/)![1];
const image = fs.readFileSync(path.join(root, 'WarpDiff_Logo_v1.png'));
const integrity = (source: string) => 'sha256-' + createHash('sha256').update(source).digest('base64');

test('installed client fails closed on partial upgrades, downgrades, and disclosure mismatch', async ({ page }) => {
  let revision = 'previous', failUsage = false, mismatch = false;
  const requests: string[] = [], errors: string[] = [];
  const adapter = (rev: string) => rev === 'previous' ? currentUsage.replaceAll(contract, contract + '-previous') : currentUsage;
  const documentBody = () => {
    const html = revision === 'previous' ? currentHtml.replaceAll(contract, contract + '-previous') : currentHtml;
    return html.replace(/integrity="sha256-[^"]+"/, `integrity="${integrity(adapter(revision))}"`)
      .replace(mismatch ? `const _USAGE_DOCUMENT_CONTRACT = '${contract}'` : 'NEVER_MATCH', "const _USAGE_DOCUMENT_CONTRACT = 'incompatible-disclosure'");
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/__goatcounter_test__/count') {
      requests.push(url.searchParams.get('p')!);
      res.writeHead(200, { 'Content-Type': 'image/gif' });
      return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }
    if (url.pathname === '/js/usage.js' && failUsage) { req.socket.destroy(); return; }
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    const body = file === path.join(root, 'index.html') ? documentBody()
      : file === path.join(root, 'js/usage.js') ? adapter(revision) : fs.readFileSync(file);
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(version => localStorage.setItem('lastSeenVersion', version), version);
  const load = async () => {
    await page.locator('#multiFileInput').setInputFiles({ name: 'private.png', mimeType: 'image/png', buffer: image });
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  };
  const blocked = async () => {
    await page.reload();
    await page.locator('#appearanceButton').click();
    await expect(page.locator('#usageStatus')).toContainText('update is incomplete');
    await expect(page.locator('#appearancePanel [data-usage-choice="yes"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    const before = requests.length;
    await load();
    await page.waitForTimeout(100);
    expect(requests).toHaveLength(before);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  };
  try {
    await page.goto(origin + '/?usageTest=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.locator('#usageInvitation [data-usage-choice="yes"]').click();
    await expect.poll(() => requests.length).toBe(1);
    // Confirm the predecessor's exact adapter bytes are in the actual cache.
    await expect.poll(() => page.evaluate(async () => {
      const response = await caches.match(new URL('js/usage.js', location.href).href);
      return response && (await response.text()).includes('-previous');
    })).toBe(true);

    revision = 'current'; failUsage = true;
    await blocked(); // Fresh HTML / cached predecessor adapter: browser SRI gate.

    failUsage = false;
    await page.reload();
    await load();
    await expect.poll(() => requests.filter(p => p.endsWith('/comparison-image-1')).length).toBe(1);
    await expect.poll(() => page.evaluate(async () => {
      const response = await caches.match(new URL('js/usage.js', location.href).href);
      return response && !(await response.text()).includes('-previous');
    })).toBe(true);

    revision = 'previous'; failUsage = true;
    await blocked(); // Downgraded HTML / cached newer adapter: browser SRI gate.

    revision = 'current'; failUsage = false; mismatch = true;
    await blocked(); // Integrity succeeds, but disclosure contract is incompatible.

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map(request => request.url));
      }
      return urls.filter(url => url.includes('/count'));
    });
    expect(cached).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
