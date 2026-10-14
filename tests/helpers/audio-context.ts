import type {Page} from '@playwright/test';

// Exercise both common device rates without depending on the runner's hardware.
export async function useAudioContextRate(page:Page,sampleRate:number) {
  await page.addInitScript(sampleRate=>{
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      constructor(options?:AudioContextOptions) { super({...options,sampleRate}); }
    };
  },sampleRate);
}
