import {test, expect, Page} from '@playwright/test';
import path from 'node:path';

declare const _prefs: {load(key:string,fallback:unknown):unknown; readRaw(key:string):string|null};

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({page}) => {
  const messages:string[] = []; errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
});
test.afterEach(async ({page}, info) => {
  const observed = errors.get(page) || [];
  if (observed.length) await info.attach('page-errors', {body:JSON.stringify(observed),contentType:'application/json'});
  // A failing intended assertion remains the primary error in negative controls.
  if (info.status === info.expectedStatus) expect(observed, 'Settings failures must stay contained').toEqual([]);
});

async function seed(page:Page, values:Record<string,string> = {}, fault = '') {
  await page.addInitScript(({values, fault}) => {
    localStorage.setItem('lastSeenVersion','999.0.0');
    for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value);
    const storage=localStorage, original=Storage.prototype.getItem;
    (window as any).__readStored = (key:string) => original.call(storage,key);
    if (fault === 'getter') Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError');}});
    if (fault === 'read') Storage.prototype.getItem = function(){throw new DOMException('Denied','SecurityError');};
    if (fault === 'write') Storage.prototype.setItem = function(){throw new DOMException('Full','QuotaExceededError');};
    if (fault === 'remove') Storage.prototype.removeItem = function(){throw new DOMException('Denied','SecurityError');};
  }, {values,fault});
}
async function started(page:Page, query = '/') {
  await page.goto(query);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__testAPI),
    {message:'Stored settings must not prevent app startup'}).toBe('object');
}
async function images(page:Page, count=2) {
  await page.locator('#multiFileInput').setInputFiles(['red.png','green.png','blue.png'].slice(0,count).map(name=>path.join(__dirname,'fixtures',name)));
  await expect(page.locator('#comparisonView'), 'Settings failures must not prevent comparison loading').toHaveClass(/active/);
  await expect(page.locator('.asset-layer img')).toHaveCount(count);
  await expect.poll(() => page.locator('.asset-layer img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  if (count === 3) await expect(page.locator('body')).toHaveClass(/(?:offset|inline-cols|inline-rows)/);
}

for (const raw of ['{broken','null','[]','"text"','42','true','{"mute":null,"shortcuts":7,"help":{},"loadFiles":[]}']) {
  test(`invalid hotkeys recover without discarding valid preferences: ${raw}`, async ({page}) => {
    await seed(page,{customHotkeys:raw,pref_volume:'35',pref_muted:'true'});
    await started(page);
    expect(await page.evaluate(()=>(window as any).__testAPI._customKeys)).toEqual({});
    await expect(page.locator('#volumeSlider')).toHaveValue('35');
    await images(page);
    await page.keyboard.press('h'); await expect(page.locator('#shortcutsPanel')).toHaveClass(/open/);
    await expect(page.locator('[data-action-id="mute"]')).toHaveText('M');
    expect(await page.evaluate(()=>(window as any).__readStored('pref_muted'))).toBe('true');
  });
}

test('mixed shortcut entries retain valid mappings and ignore unsafe shapes', async ({page}) => {
  await seed(page,{customHotkeys:'{"mute":"y","shortcuts":null,"loadFiles":[],"help":{},"constructor":"x","__proto__":"z"}'});
  await started(page);
  expect(await page.evaluate(()=>(window as any).__testAPI._customKeys)).toEqual({mute:'y'});
  await images(page);
  const before=await page.locator('#muteBtn').innerHTML();await page.keyboard.press('y');
  expect(await page.locator('#muteBtn').innerHTML()).not.toBe(before);
  await page.keyboard.press('h');await expect(page.locator('[data-action-id="mute"]')).toHaveText('Y');
});

for (const raw of ['"{broken"','null','{}','"null"','"[]"','"true"']) {
  test(`invalid rotation preference cannot abort startup: ${raw}`, async ({page}) => {
    await seed(page,{pref_slotRotation:raw});await started(page);await images(page);
    expect(await page.evaluate(()=>(window as any).__testAPI.slotRotations)).toEqual({original:0,editA:0,editB:0,editC:0});
  });
}

test('mixed saved colors and rotations preserve their valid fields', async ({page}) => {
  await seed(page,{slotColors:'{"original":"#112233","editA":42,"editB":"#AABBCC","editC":null}',
    pref_slotRotation:JSON.stringify(JSON.stringify({original:90,editA:'180',editB:270,editC:45}))});
  await started(page);
  expect(await page.evaluate(()=>(window as any).__testAPI.slotRotations)).toEqual({original:90,editA:0,editB:270,editC:0});
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--slot-original-bg').trim())).toBe('#112233');
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--slot-editB-bg').trim())).toBe('#aabbcc');
});

test('wrong preference types and numeric bounds recover to usable defaults', async ({page}) => {
  await seed(page,{pref_volume:'{}',pref_muted:'"false"',pref_magnifierSize:'1e15',pref_magnifierZoom:'-1',
    pref_timecopyFmt:'[]',pref_timecopySep:'null',pref_audioVizVisible:'"yes"',pref_paletteIndex:'999',pref_appearance:'{}'});
  await started(page);await images(page);
  await expect(page.locator('#volumeSlider')).toHaveValue('100');
  expect(await page.evaluate(()=>(window as any).__testAPI.audioVizVisible)).toBe(false);
  expect(await page.evaluate(()=>(window as any).__testAPI.timecopyFmt)).toBe('hms');
  await expect(page.locator('body')).toHaveAttribute('data-appearance','original');
  await page.keyboard.press('z');
  expect(await page.locator('#pixelMagnifier').evaluate(el=>el.style.width)).toBe('200px');
});

for (const fault of ['getter','read','write','remove']) {
  test(`storage ${fault} failures leave loading and settings controls usable`, async ({page}) => {
    await seed(page,{pref_audioVizVisible:'{broken'},fault);await started(page);await images(page,3);
    if (!await page.evaluate(()=>(window as any).__testAPI.isGridMode)) await page.keyboard.press('g');
    const before=await page.evaluate(()=>(window as any).__testAPI.gridInlineMode);
    await page.keyboard.press('3');
    expect(await page.evaluate(()=>(window as any).__testAPI.gridInlineMode), 'A failed save must not interrupt the Grid change').toBe(!before);
    const format=await page.evaluate(()=>(window as any).__testAPI.timecopyFmt);
    await page.keyboard.press('t');
    expect(await page.evaluate(()=>(window as any).__testAPI.timecopyFmt), 'The current visit must retain its format choice').not.toBe(format);
    await page.keyboard.press('h');await expect(page.locator('#shortcutsPanel')).toHaveClass(/open/);
    await page.locator('[data-action-id="mute"]').click();await page.keyboard.press('u');
    await expect(page.locator('[data-action-id="mute"]')).toHaveText('U');
    if (fault==='getter'||fault==='write') expect(await page.evaluate(()=>_prefs.readRaw('customHotkeys'))).toContain('"mute":"u"');
  });
}

test('failed saves preserve current volume and notify once without changing durable settings', async ({page}) => {
  await seed(page,{pref_volume:'35'});await started(page);await images(page);
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await page.locator('#volumeSlider').evaluate((input:HTMLInputElement)=>{input.value='61';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(await page.evaluate(()=>_prefs.load('volume',100))).toBe(61);
  expect(await page.evaluate(()=>(window as any).__readStored('pref_volume'))).toBe('35');
  await expect(page.locator('#toast')).toContainText('could not save');
  await page.keyboard.press('t');
  expect(await page.evaluate(()=>_prefs.load('timecopyFmt','hms'))).toBe('hmsf');
});

test('valid preferences and custom keys survive an actual reload unchanged', async ({page}) => {
  await page.goto('/');
  const saved={lastSeenVersion:'999.0.0',customHotkeys:'{"mute":"y"}',pref_volume:'42',pref_muted:'true',
    pref_appearance:'"glacier"',pref_timecopyFmt:'"sf"',pref_slotRotation:JSON.stringify(JSON.stringify({original:0,editA:90,editB:180,editC:270}))};
  await page.evaluate(values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);},saved);
  await page.reload();
  await expect(page.locator('#volumeSlider')).toHaveValue('42');await expect(page.locator('body')).toHaveAttribute('data-appearance','glacier');
  expect(await page.evaluate(()=>(window as any).__testAPI._customKeys)).toEqual({mute:'y'});
  expect(await page.evaluate(()=>(window as any).__testAPI.timecopyFmt)).toBe('sf');
  const restored=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.keys(saved));
  expect(restored).toEqual(saved);
});

for (const fault of ['getter','read']) {
  test(`unreadable saved Yes stays off after a manual comparison (${fault})`, async ({page}) => {
    const requests:string[]=[];
    await page.route('**/__goatcounter_test__/count**',route=>{requests.push(route.request().url());return route.fulfill({status:204});});
    await seed(page,{pref_usageConsentTest:JSON.stringify({choice:'yes',version:4,decidedAt:new Date().toISOString()})},fault);
    await started(page,'/?usageTest=1');await images(page);
    await expect(page.locator('#usageTestStats')).toContainText('0 visit');
    await expect(page.locator('#usageStatus')).toContainText('Sharing is off');
    await page.waitForTimeout(250);
    expect(requests, 'A storage fallback must never authorize usage sharing').toEqual([]);
  });
}
