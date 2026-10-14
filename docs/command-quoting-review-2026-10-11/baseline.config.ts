import config from '/Users/jay/Documents/warpdiff/playwright.config';
export default { ...config, testDir: '/tmp/warpdiff-command-review-baseline-tests', globalSetup: '/Users/jay/Documents/warpdiff/tests/global-setup.ts', outputDir: '/tmp/warpdiff-command-review-baseline-results' };
