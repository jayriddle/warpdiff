import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

test.use({serviceWorkers:'block'});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
});

test('unsupported audio retains its source, opens external preparation and never loads an engine', async ({page, request}) => {
  const engineRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', req => { if (/\/ffmpeg\//.test(req.url())) engineRequests.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#externalAudioBtn')).toBeHidden();
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/ac3_video.mp4'));
  // Exercise the undecodable-track owner even on systems with native AC-3.
  await page.evaluate(() => {
    const w = window as any;
    w.eval("_byteScannedCodec.editA = 'ac-3'");
    w._onAllDecodeFailed('editA', true, w.eval('_videoAudioDecodeGen.editA'));
    w._webcodecsFinished('editA', w.eval('_videoAudioDecodeGen.editA'));
  });
  const panel = page.getByRole('dialog', {name:'Prepare audio externally'});
  await expect(panel).toBeVisible();
  await expect(panel.locator('.fp-note')).toContainText('folder containing the original file');
  await expect(panel.locator('.fp-note')).toContainText('stereo AAC');
  await expect(panel.locator('.fp-note')).toContainText('Load (L)');
  await expect(panel.locator('.fp-note')).toContainText('starts a new comparison');
  await expect(page.locator('#toast')).toHaveText('Audio needs external preparation');
  await expect(page.locator('#audioNoDataMsg')).toHaveText('Audio needs external preparation');
  await expect(panel.locator('.fp-download')).toHaveAttribute('href', 'https://ffmpeg.org/download.html');
  expect(await page.evaluate(() => (window as any).eval('mediaData.editA.name'))).toBe('ac3_video.mp4');
  await expect(panel.getByRole('button', {name:'Close audio preparation'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.locator('#externalAudioBtn').click();
  await expect(panel).toBeVisible();
  await page.locator('#ffmpegBackdrop').click({position:{x:4, y:4}});
  await expect(panel).toBeHidden();
  await expect(page.locator('#externalAudioBtn')).toBeFocused();
  await page.locator('#externalAudioBtn').click();
  await page.evaluate(() => (window as any).clearAllMedia());
  await expect(panel).toBeHidden();
  await expect(page.locator('#externalAudioBtn')).toBeHidden();
  await expect(panel.locator('.fp-entry')).toHaveCount(0);
  expect(engineRequests).toEqual([]);
  expect(errors).toEqual([]);
  for (const asset of ['ffmpeg.min.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']) {
    expect(fs.existsSync(path.join(__dirname, '..', 'ffmpeg', asset))).toBe(false);
    expect((await request.get('/ffmpeg/' + asset)).status()).toBe(404);
  }
});

for (const legacyFlag of [false, true, null]) {
  test(`managed host uses external preparation with legacy converter flag ${legacyFlag}`, async ({page}) => {
    const engineRequests: string[] = [];
    page.on('request', req => { if (/\/ffmpeg\//.test(req.url())) engineRequests.push(req.url()); });
    await page.route('**/external-host.html', route => route.fulfill({
      contentType:'text/html', body:'<!doctype html><iframe src="/"></iframe>',
    }));
    await page.goto('/external-host.html');
    const frame = page.locator('iframe').contentFrame();
    await frame.locator('.header').waitFor();
    await page.locator('iframe').evaluate((element:HTMLIFrameElement, flag) => {
      element.contentWindow!.postMessage({type:'WARPDIFF_LOAD', requestId:'external', taskId:'external',
        capabilities:{managedReview:true, ...(flag === null ? {} : {ffmpegTranscode:flag})},
        error:'controlled host capability probe'}, location.origin);
    }, legacyFlag);
    await expect.poll(() => frame.locator('body').evaluate(() => (window as any)._managedReviewActive())).toBe(true);
    await frame.locator('body').evaluate(() => (window as any)._registerFfmpegCommand('original', 'host.mp4', 'ec-3'));
    await expect(frame.locator('#ffmpegPanel .fp-note')).toContainText('review host');
    await expect(frame.locator('#ffmpegPanel .fp-note')).not.toContainText('Load (L)');
    await expect(frame.locator('#ffmpegPanel .fp-load-btn')).toHaveCount(0);
    await frame.locator('#ffmpegPanelClose').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(frame.locator('#ffmpegPanel .fp-download')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(frame.locator('#ffmpegPanelClose')).toBeFocused();
    expect(await frame.locator('body').evaluate(() => (window as any).eval('_hostCapabilities.ffmpegTranscode'))).toBe(false);
    expect(engineRequests).toEqual([]);
  });
}

test('multiple preparation entries retain slot order, literal text and keyboard focus', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => (window as any)._registerFfmpegCommand('editB', '<img src=x onerror=alert(1)>.mp4', 'ec-3'));
  await page.locator('.fp-copy-btn').focus();
  await page.evaluate(() => {
    (window as any)._registerFfmpegCommand('original', 'ref.mp4', 'dtsc');
    (window as any)._registerFfmpegCommand('editA', 'a.mp4', 'ac-3');
  });
  expect(await page.locator('.fp-entry').evaluateAll(entries => entries.map(entry => (entry as HTMLElement).dataset.fpSlot)))
    .toEqual(['original', 'editA', 'editB']);
  await expect(page.locator('[data-fp-slot="editB"] .fp-copy-btn')).toBeFocused();
  await expect(page.locator('#ffmpegPanel img')).toHaveCount(0);
  await expect(page.locator('[data-fp-slot="editB"] .fp-entry-codec')).toContainText('<img src=x onerror=alert(1)>.mp4');
});

for (const filename of ['review.mp4', 'clip\u001b.mp4', 'review.webm']) {
  test(`preparation keyboard focus stays in the panel until it closes: ${JSON.stringify(filename)}`, async ({page}) => {
    await page.goto('/');
    await page.evaluate(name => (window as any)._registerFfmpegCommand('editA', name, 'ac-3'), filename);
    const panel = page.getByRole('dialog', {name:'Prepare audio externally'});
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    const close = panel.getByRole('button', {name:'Close audio preparation'});
    const load = panel.getByRole('button', {name:'Load prepared files', exact:true});
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(load).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
}

for (const control of ['.fp-download', '.fp-load-btn']) {
  test(`adding another preparation entry retains focus on ${control}`, async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => (window as any)._registerFfmpegCommand('editA', 'review.mp4', 'ac-3'));
    await page.locator('#ffmpegPanel ' + control).focus();
    await page.evaluate(() => (window as any)._registerFfmpegCommand('editB', 'other.mp4', 'ec-3'));
    await expect(page.locator('#ffmpegPanel ' + control)).toBeFocused();
  });
}

test('a narrow preparation panel reveals focused controls after wrapping, refresh and reopen', async ({page}) => {
  await page.setViewportSize({width:390, height:480});
  await page.goto('/');
  await page.evaluate(() => {
    (window as any)._registerFfmpegCommand('original', 'reference.mp4', 'ac-3');
    (window as any)._registerFfmpegCommand('editA', 'review.mp4', 'ac-3');
  });
  const panel = page.locator('#ffmpegPanel');
  const close = page.locator('#ffmpegPanelClose');
  const load = panel.getByRole('button', {name:'Load prepared files', exact:true});
  const insidePanel = async (selector:string) => expect.poll(() => panel.evaluate((panel, selector) => {
    const bounds = panel.getBoundingClientRect();
    const control = panel.querySelector(selector)!.getBoundingClientRect();
    return control.top >= bounds.top && control.bottom <= bounds.bottom;
  }, selector)).toBe(true);
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(load).toBeFocused();
  await insidePanel('.fp-load-btn');
  await page.evaluate(() => (window as any)._registerFfmpegCommand('editB', 'other.mp4', 'ec-3'));
  await expect(load).toBeFocused();
  await insidePanel('.fp-load-btn');
  await page.keyboard.press('Escape');
  await page.locator('#externalAudioBtn').click();
  await expect(close).toBeFocused();
  await insidePanel('#ffmpegPanelClose');
});

for (const filename of ['review.webm', 'review.mkv', 'review.avi', 'review.wav']) {
  test(`${filename} preparation does not offer an unusable MP4-specific command`, async ({page}) => {
    await page.goto('/');
    await page.evaluate(name => (window as any)._registerFfmpegCommand('editA', name, 'unknown'), filename);
    const panel = page.getByRole('dialog', {name:'Prepare audio externally'});
    await expect(panel.locator('.fp-copy-btn')).toBeDisabled();
    await expect(panel.locator('.fp-cmd')).toContainText('MP4/MOV');
    expect(await page.evaluate(() => (window as any).eval('_ffmpegCommands.editA.cmd'))).toBeNull();
    await page.evaluate(() => (window as any)._copyFfmpegCmd(document.querySelector('.fp-copy-btn'), 'editA'));
    await expect(panel.locator('.fp-copy-btn')).toHaveText('Copy');
  });
}

test('native codec limits retain original surround metadata and give a preparation route', async ({page}) => {
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/dialogue_71.mp4'));
  await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('FLAC · 7.1 · 48 kHz');
  await expect.poll(() => page.evaluate(() => (window as any).eval('!!_videoAudioBuffers.editA || !!_ffmpegCommands.editA'))).toBe(true);
  const state = await page.evaluate(() => (window as any).eval('({name:mediaData.editA.name, decoded:!!_videoAudioBuffers.editA, preparation:!!_ffmpegCommands.editA})'));
  expect(state.name).toBe('dialogue_71.mp4');
  if (state.preparation) {
    await expect(page.locator('#externalAudioBtn')).toBeVisible();
    await expect(page.locator('#ffmpegPanel .fp-note')).toContainText('keep the original');
  } else {
    expect(state.decoded).toBe(true);
    await expect(page.locator('#externalAudioBtn')).toBeHidden();
  }
  await expect(page.locator('#layerEditA .asset-audio-format')).toHaveText('FLAC · 7.1 · 48 kHz');
  await test.info().attach('native-surround-or-preparation', {body:JSON.stringify(state), contentType:'application/json'});
});

test('external conversion and ordinary reload preserve an extensionless name and produce audible AAC', async ({page}) => {
  test.skip(process.platform === 'win32', 'Copied commands target POSIX terminals.');
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/ac3_video.mp4'));
  await page.goto('/');
  await page.locator('#multiFileInput').setInputFiles({name:'.review', mimeType:'video/mp4', buffer:source});
  await page.evaluate(() => (window as any)._registerFfmpegCommand('editA', '.review', 'ac-3'));
  const command = await page.evaluate(() => (window as any).eval('_ffmpegCommands.editA.cmd'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-external-reload-'));
  try {
    fs.writeFileSync(path.join(directory, '.review'), source);
    execFileSync('/bin/sh', ['-c', command], {cwd:directory, timeout:20000, stdio:'pipe'});
    expect(await page.evaluate(() => (window as any).eval('mediaData.editA.name'))).toBe('.review');
    // The existing loader owns source retirement and the fresh comparison.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name:'Load prepared files', exact:true}).click();
    await (await chooser).setFiles(path.join(directory, '.review_aac.mp4'));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => (window as any).eval('!!_videoAudioBuffers.editA'))).toBe(true);
    const result = await page.evaluate(() => {
      const w = window as any;
      const buffer = w.eval('_videoAudioBuffers.editA');
      let peak = 0;
      for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
      return {name:w.eval('mediaData.editA.name'), duration:buffer.duration, channels:buffer.numberOfChannels,
        peak, commands:w.eval('Object.keys(_ffmpegCommands)')};
    });
    expect(result.name).toBe('.review_aac.mp4');
    expect(result.duration).toBeGreaterThan(0.8);
    expect(result.channels).toBe(2);
    expect(result.peak).toBeGreaterThan(0.01);
    expect(result.commands).toEqual([]);
    await expect(page.locator('#ffmpegPanel')).toBeHidden();
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});

test('service worker installs without FFmpeg and retires only owned legacy caches', async () => {
  const listeners: Record<string, (event:any) => void> = {};
  const deleted: string[] = [];
  let installed: string[] = [];
  let claimed = false;
  let currentCache = '';
  const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const context = vm.createContext({URL, Set, Promise,
    self:{registration:{scope:'https://example.test/warpdiff/'},
      addEventListener:(type:string, fn:(event:any) => void) => {listeners[type] = fn;},
      skipWaiting:() => {}, clients:{claim:() => {claimed = true;}}},
    caches:{open:async () => ({addAll:async (assets:string[]) => {installed = assets;}}),
      keys:async () => ['warpdiff-v0.0.0', 'warpdiff-v0.0.1', currentCache, 'warpdiff-ffmpeg', 'host-cache', 'host-ffmpeg'],
      delete:async (name:string) => {deleted.push(name); return true;}}});
  vm.runInContext(source, context);
  currentCache = vm.runInContext('CACHE_NAME', context);
  expect(currentCache).toMatch(/^warpdiff-v\d+\.\d+\.\d+$/);
  let pending!: Promise<void>;
  const event = {waitUntil:(promise:Promise<void>) => {pending = promise;}};
  listeners.install(event);
  await pending;
  expect(installed.length).toBeGreaterThan(20);
  expect(installed.some(asset => asset.includes('ffmpeg'))).toBe(false);
  listeners.activate(event);
  await pending;
  expect(deleted).toEqual(['warpdiff-v0.0.0', 'warpdiff-v0.0.1', 'warpdiff-ffmpeg']);
  expect(claimed).toBe(true);
  for (const url of ['https://example.test/warpdiff/ffmpeg/ffmpeg-core.wasm', 'https://example.test/host-file.mp4']) {
    let intercepted = false;
    listeners.fetch({request:{method:'GET', url}, respondWith:() => {intercepted = true;}});
    expect(intercepted).toBe(false);
  }
});
