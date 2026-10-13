import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// This profile checks external preparation/reload and filename handling.
// The broader native 7.1 FLAC capability failures remain documented separately.
export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  projects: [
    {name:'webkit-workflow', testMatch:['ffmpeg-command.spec.ts', 'external-preparation.spec.ts'],
      use:{browserName:'webkit'}},
    {name:'webkit-reload', testMatch:'audio-format.spec.ts', grep:/source format changes only/,
      use:{browserName:'webkit'}},
  ],
});
