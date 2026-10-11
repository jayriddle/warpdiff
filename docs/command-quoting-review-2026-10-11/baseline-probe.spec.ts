const { test } = require('/Users/jay/Documents/warpdiff/node_modules/@playwright/test');
const { execFileSync } = require('node:child_process');
const baseline = execFileSync('git', ['show', 'f7ee15e7b1d516fc7be40534a9d9277c2848b501:index.html'], { cwd: '/Users/jay/Documents/warpdiff', encoding: 'utf8' });
test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/', route => route.fulfill({body: baseline, contentType: 'text/html'}));
});
require('/Users/jay/Documents/warpdiff/tests/warpdiff.spec.ts');
