import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Independent pages, one worker per machine, zero retries. Hosted Chromium
// selects files from scripts/ci-shards.mjs instead of count-based --shard.
export default defineConfig({
  ...base,
  fullyParallel: true,
  workers: 1,
  retries: 0,
});
