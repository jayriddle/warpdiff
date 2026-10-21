import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Checks external preparation/reload, filenames, brief-preview pitch and Opus scheduling.
// The broader native 7.1 FLAC capability failures remain documented separately.
export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  projects: [
    {name:'webkit-dialog-keyboard',testMatch:'dialog-keyboard.spec.ts',use:{browserName:'webkit'}},
    {name:'webkit-native-video-output',testMatch:'native-video-output.spec.ts',use:{browserName:'webkit'}},
    {name:'webkit-color-rendering', testMatch:'color-rendering.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-normal-preparation', testMatch:'normal-preparation.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-prepared-import', testMatch:'prepared-import.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-preparation-followup', testMatch:'preparation-followup.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-prepared-media', testMatch:'prepared-media.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-media-admission', testMatch:'media-admission.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-media-input', testMatch:'media-input.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-mp4-audio', testMatch:'mp4-audio.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-updates', testMatch:'app-updates.spec.ts', grepInvert:/predecessor negative control/, use:{browserName:'webkit'}},
    {name:'webkit-preferences', testMatch:'preferences.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-host-load', testMatch:'host-load.spec.ts', use:{browserName:'webkit'}},
    {name:'webkit-info-focus', testMatch:'info-bar.spec.ts', grep:/queued fits preserve focus/, use:{browserName:'webkit'}},
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
