import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Node ownership/logic harnesses run separately with test:ownership.
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup.ts',
  timeout: 60_000,  // Increased for slower load/animation timing in current build
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 0 : 1,
  globalTimeout: process.env.CI ? 30 * 60_000 : undefined,
  reporter: process.env.CI ? [['line'], ['html', {open:'never'}]] : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium',
        ...(process.env.WARPDIFF_BROWSER_CHANNEL ? {channel:process.env.WARPDIFF_BROWSER_CHANNEL} : {}),
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
          // Escape hatch for environments with a system-provided Chromium
          // (e.g. sandboxed CI images that block playwright install).
          ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        }
    } },
  ],
  webServer: {
    command: 'npx serve -l 8080 --no-clipboard .',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
});
