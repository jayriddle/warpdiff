import {defineConfig} from '@playwright/test';

// Opt-in repository prototype. Each worker starts its own loopback companion;
// never takes over the user's port 8080 or regenerates shared fixtures.
export default defineConfig({
  testDir:'./tests',testMatch:'local-companion.spec.ts',
  workers:1,retries:0,timeout:90000,globalTimeout:10*60*1000,
  forbidOnly:!!process.env.CI,
  reporter:'list',
  use:{headless:true,viewport:{width:1280,height:800},screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{browserName:'chromium',
      ...(process.env.WARPDIFF_BROWSER_CHANNEL?{channel:process.env.WARPDIFF_BROWSER_CHANNEL}:{}),
      launchOptions:{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}}},
    {name:'webkit',use:{browserName:'webkit'}},
  ],
});
