import config from '/Users/jay/Documents/warpdiff/playwright.config';
export default { ...config, testDir: '/Users/jay/Documents/warpdiff/tests', globalSetup: '/Users/jay/Documents/warpdiff/tests/global-setup.ts', outputDir: '/tmp/warpdiff-command-review-webkit-results', projects: [{ name: 'webkit', use: { browserName: 'webkit' } }] };
