import { defineConfig } from '@playwright/test';
import path from 'path';

// Additional release review; the standard suite remains Chromium-only.
export default defineConfig({
  testDir: path.resolve(__dirname, '../../tests'),
  testMatch: 'info-bar.spec.ts',
  globalSetup: path.resolve(__dirname, '../../tests/global-setup.ts'),
  outputDir: path.resolve(__dirname, 'browser-test-artifacts'),
  timeout: 60_000,
  retries: 0,
  workers: 2,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx serve -l 8080 --no-clipboard .',
    port: 8080,
    reuseExistingServer: true,
  },
});
