import type {Page} from '@playwright/test';

// Select the graph fallback through the detached capability probe. Loaded
// elements retain their real volume implementation so PCM/envelope assertions
// still measure the production graph and master-volume behavior.
export async function forceGraphVideoOutput(page:Page) {
  await page.addInitScript(()=>{
    const volume=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume')!;
    Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,
      get(){return !this.isConnected && !this.getAttribute('src') ? 1 : volume.get!.call(this);},
      set(value){volume.set!.call(this,value);}});
  });
}
