import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Independent pages, one worker per machine. Test-level sharding also divides
// the large legacy spec without moving its scenarios or changing assertions.
export default defineConfig({
  ...base,
  fullyParallel: true,
  workers: 1,
  retries: 0,
});
