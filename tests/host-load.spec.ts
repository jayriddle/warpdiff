import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const image64 = readFileSync(path.join(__dirname, 'fixtures/green.png')).toString('base64');

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.hostReplies = [];
    w.hostErrors = [];
    addEventListener('message', event => {
      if (/^WARPDIFF_LOAD_(READY|FAILED)$/.test(event.data?.type)) w.hostReplies.push(event.data);
    });
    addEventListener('error', event => w.hostErrors.push(event.message));
    addEventListener('unhandledrejection', event => w.hostErrors.push(String(event.reason)));
  });
  await page.goto('/');
});

test.afterEach(async ({page}) => {
  expect(await page.evaluate(() => (window as any).hostErrors)).toEqual([]);
});

for (const [name, files] of [
  ['malformed base64', [{name:'bad.png', contentType:'image/png', base64:'%%%'}]],
  ['numeric allocation size', [{name:'bad.png', contentType:'image/png', buffer:2 ** 30}]],
  ['arbitrary buffer object', [{name:'bad.png', contentType:'image/png', buffer:{length:2 ** 30}}]],
  ['invalid byte array', [{name:'bad.png', contentType:'image/png', buffer:[0, -1, 256]}]],
  ['empty buffer', [{name:'bad.png', contentType:'image/png', buffer:[]}]],
  ['null file', [null]],
  ['non-array files', {name:'bad.png'}],
  ['invalid metadata', [{name:42, contentType:'image/png', buffer:[1]}]],
  ['too many files', Array.from({length:5}, () => ({name:'bad.png', contentType:'image/png', buffer:[1]}))],
] as const) {
  test(`host load reports and cleans up ${name}`, async ({page}) => {
    await page.evaluate(files => {
      (window as any).pullFromIHWA();
      window.postMessage({type:'WARPDIFF_LOAD', requestId:'bad', taskId:'task-bad', files}, location.origin);
    }, files);
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'bad', taskId:'task-bad', error:expect.any(String)}),
    ]);
    await expect(page.locator('#ihwaPullBtn')).toBeEnabled();
    await expect(page.locator('#landingCta')).not.toHaveClass(/loading/);
    await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
    await expect(page.locator('.asset-layer img, .asset-layer video')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).eval('_ihwaPullTimer'))).toBeNull();
    // A failed request must not prevent a subsequent legitimate load.
    await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD', requestId:'recovered',
      files:[{name:'recovered.png', contentType:'image/png', base64}]}, location.origin), image64);
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toHaveLength(2);
    expect(await page.evaluate(() => (window as any).hostReplies[1])).toMatchObject({type:'WARPDIFF_LOAD_READY', requestId:'recovered'});
  });
}

for (const format of ['base64', 'ArrayBuffer', 'typed view', 'DataView', 'byte array']) {
  test(`host load accepts ${format} without changing the supplied bytes`, async ({page}) => {
    await page.evaluate(({base64, format}) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const padded = new Uint8Array(bytes.length + 8);
      padded.set(bytes, 4);
      const payload = format === 'base64' ? {base64} : {buffer:
        format === 'ArrayBuffer' ? bytes.buffer : format === 'typed view' ? padded.subarray(4, -4) :
        format === 'DataView' ? new DataView(padded.buffer, 4, bytes.length) : Array.from(bytes)};
      window.postMessage({type:'WARPDIFF_LOAD', requestId:'valid', taskId:'task-valid',
        files:[{name:'valid.png', contentType:'image/png', ...payload}]}, location.origin);
    }, {base64:image64, format});
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'valid', taskId:'task-valid'}),
    ]);
    await expect(page.locator('.asset-layer img')).toHaveCount(1);
    const loaded = await page.locator('.asset-layer img').evaluate(async (image:HTMLImageElement) => {
      const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
      return {base64:btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')), width:image.naturalWidth};
    });
    expect(loaded.base64).toBe(image64);
    expect(loaded.width).toBeGreaterThan(0);
  });
}

test('superseded supplied-file failure cannot reset or notify the newer request', async ({page}) => {
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    let held = false;
    window.fetch = (input, init) => {
      if (String(input).startsWith('data:') && !held) {
        held = true;
        return new Promise((_resolve, reject) => { w.rejectOldFile = () => reject(new Error('late old failure')); });
      }
      return original(input, init);
    };
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'old', files:[{name:'old.png', contentType:'image/png', base64}]}, location.origin);
  }, image64);
  await page.waitForFunction(() => !!(window as any).rejectOldFile);
  await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD', requestId:'new',
    files:[{name:'new.png', contentType:'image/png', base64}]}, location.origin), image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'new'}),
  ]);
  await page.evaluate(async () => {
    (window as any).rejectOldFile();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
});

test('manual replacement retires a pending host failure without clearing the new files', async ({page}) => {
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).startsWith('data:')
      ? new Promise((_resolve, reject) => { w.rejectOldFile = () => reject(new Error('late failure after manual load')); })
      : original(input, init);
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'retired',
      files:[{name:'retired.png', contentType:'image/png', base64}]}, location.origin);
  }, image64);
  await page.waitForFunction(() => !!(window as any).rejectOldFile);
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/green.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await page.evaluate(async () => {
    (window as any).rejectOldFile();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toEqual([]);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
});

test('same-origin parent receives the correlated terminal failure for malformed media', async ({page}) => {
  await page.route('**/invalid-media-host.html', route => route.fulfill({contentType:'text/html', body:
    `<!doctype html><iframe src="/"></iframe><script>
      document.querySelector('iframe').addEventListener('load', event => event.target.contentWindow.postMessage({
        type:'WARPDIFF_LOAD', requestId:'parent-bad', taskId:'parent-task',
        files:[{name:'bad.png', contentType:'image/png', buffer:1024}]
      }, location.origin));
    <\/script>`}));
  await page.goto('/invalid-media-host.html');
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'parent-bad', taskId:'parent-task'}),
  ]);
  await expect(page.locator('iframe').contentFrame().locator('#ihwaPullBtn')).toBeEnabled();
});

test('one failed file aborts its sibling and clears the preceding comparison', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/green.png'));
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).startsWith('data:')) {
        w.siblingSignal = init?.signal;
        return new Promise(resolve => { w.releaseSibling = () => resolve(new Response(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))); });
      }
      return original(input, init);
    };
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'batch', files:[
      {name:'bad.png', contentType:'image/png', buffer:1024},
      {name:'slow.png', contentType:'image/png', base64},
    ]}, location.origin);
  }, image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'batch'}),
  ]);
  expect(await page.evaluate(() => (window as any).siblingSignal.aborted)).toBe(true);
  await page.evaluate(async () => {
    (window as any).releaseSibling();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  await expect(page.locator('.asset-layer img')).toHaveCount(0);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('same-window signed URL failure still requests and accepts extension fallback', async ({page}) => {
  await page.route('**/unavailable-host-media.png', route => route.abort('failed'));
  await page.evaluate(base64 => {
    addEventListener('message', event => {
      if (event.data?.type === 'WARPDIFF_PULL_FALLBACK') window.postMessage({
        type:'WARPDIFF_LOAD', requestId:'fallback', files:[{name:'fallback.png', contentType:'image/png', base64}],
      }, location.origin);
    });
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'signed', signedItems:[
      {signedUrl:'/unavailable-host-media.png', name:'signed.png', contentType:'image/png'},
    ]}, location.origin);
  }, image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'fallback'}),
  ]);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
});
