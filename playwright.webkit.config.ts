import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Checks external preparation/reload, filenames, brief-preview pitch and Opus scheduling.
// The broader native 7.1 FLAC capability failures remain documented separately.
export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  projects: [
    {name:'webkit-host-load', testMatch:'host-load.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-scrub-input', testMatch:'scrub-input.spec.ts', grep:/native seek|clearing pending|overlong response/, use:{browserName:'webkit'}},
    {name:'webkit-workflow', testMatch:['ffmpeg-command.spec.ts', 'external-preparation.spec.ts'],
      use:{browserName:'webkit'}},
    {name:'webkit-reload', testMatch:'audio-format.spec.ts', grep:/source format changes only/,
      use:{browserName:'webkit'}},
    {name:'webkit-scrub-pitch', testMatch:'scrub-pitch.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-opus-timing', testMatch:'warpdiff.spec.ts', grep:/Opus deferred-start window/,
      use:{browserName:'webkit'}},
  ],
});
