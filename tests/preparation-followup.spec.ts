import {test, expect} from '@playwright/test';
import path from 'node:path';

test.use({serviceWorkers:'block'});
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
  await page.goto('/');
});

test('prepared picture validation decodes a frame without play()', async ({page}) => {
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  const played = await page.evaluate(async () => {
    let calls = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { calls++; return play.call(this); };
    const bytes = await (await fetch('tests/fixtures/landscape_a.mp4')).arrayBuffer();
    const file = new File([bytes], 'landscape_a.mp4', {type:'video/mp4'});
    await (window as any).eval('_validateLocalPreparedFile')(file, new AbortController().signal);
    return calls;
  });
  expect(played).toBe(0);
});

test('a playable file is accepted when the hidden probe cannot be sampled', async ({page}) => {
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  const played = await page.evaluate(async () => {
    let calls = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { calls++; return play.call(this); };
    (window as any)._hostVideoFrameAvailable = () => false;
    const bytes = await (await fetch('tests/fixtures/landscape_a.mp4')).arrayBuffer();
    const file = new File([bytes], 'landscape_a.mp4', {type:'video/mp4'});
    await (window as any).eval('_validateLocalPreparedFile')(file, new AbortController().signal);
    return calls;
  });
  expect(played).toBe(0);
});

test('a valid container with corrupt frames is rejected when the browser reports it', async ({page, browserName}) => {
  test.fail(browserName === 'webkit', 'WebKit accepts damaged samples once canplay fires. The companion ffmpeg -xerror full decode is the real guard.');
  const message = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch('tests/fixtures/landscape_a.mp4')).arrayBuffer());
    const view = new DataView(bytes.buffer);
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (type === 'mdat' && size > header + 64) {
        const start = offset + header + 32;
        const end = Math.min(offset + size, start + 8192);
        for (let index = start; index < end; index++) bytes[index] ^= 0xff;
        break;
      }
      if (!size || size < header) break;
      offset += size;
    }
    const file = new File([bytes], 'corrupt-frames.mp4', {type:'video/mp4'});
    try {
      await (window as any).eval('_validateLocalPreparedFile')(file, new AbortController().signal);
      return 'accepted';
    } catch (error) { return (error as Error).message; }
  });
  expect(message).toMatch(/could not|did not become playable/i);
});

test('an undecodable prepared file is still rejected', async ({page}) => {
  const message = await page.evaluate(async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3, 4])], 'bad.mp4', {type:'video/mp4'});
    try {
      await (window as any).eval('_validateLocalPreparedFile')(file, new AbortController().signal);
      return '';
    } catch (error) { return (error as Error).message; }
  });
  expect(message).toMatch(/could not/i);
});

test('.ts is MPEG-TS only when the browser has not already typed it', async ({page}) => {
  const types = await page.evaluate(() => {
    const normalize = (window as any).eval('_normalizePreparationInput');
    const out = (name: string, type: string) => normalize(new File(['x'], name, {type})).type;
    return {
      empty: out('clip.ts', ''),
      octet: out('clip.ts', 'application/octet-stream'),
      text: out('notes.ts', 'text/plain'),
      typescript: out('app.ts', 'application/typescript'),
      video: out('clip.ts', 'video/mp2t'),
      mts: out('clip.mts', ''),
      m2ts: out('clip.m2ts', 'application/octet-stream'),
    };
  });
  expect(types).toEqual({
    empty:'video/mp2t', octet:'video/mp2t', text:'text/plain', typescript:'application/typescript',
    video:'video/mp2t', mts:'video/mp2t', m2ts:'video/mp2t',
  });
});

test('a new comparison releases recovery files that can no longer be restored', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(fixture('red.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  const released = await page.evaluate(async () => {
    const file = new File([new Uint8Array(32)], 'previous.mp4', {type:'video/mp4'});
    const files = [file];
    const preparedFiles = new Set([file]);
    const w = window as any;
    w.__recoveryProbe = {files, preparedFiles, announced:true, notices:[]};
    w.eval('_localPreparationRecovery = window.__recoveryProbe; _localPreparationRecovery.token = _loadingProgressToken');
    w.__testAPI.beginLoadingProgress([{slot:'editA', name:'next.png'}]);
    await new Promise(resolve => setTimeout(resolve, 0));
    return {held:w.eval('_localPreparationRecovery'), length:files.length, setSize:preparedFiles.size};
  });
  expect(released.held).toBeNull();
  expect(released.length).toBe(0);
  expect(released.setSize).toBe(0);
});

test('only an unprepared issue says Preparation needed', async ({page}) => {
  await page.evaluate(() => {
    const w = window as any;
    const review = new File(['x'], 'review.mp4', {type:'video/mp4'});
    const source = new File(['y'], 'source.mkv', {type:'video/x-matroska'});
    w.__batch = {epoch:0, token:w.eval('_loadingProgressToken'), issues:new Set(['editA']), files:[
      {slot:'editA', file:review, prepared:true}, {slot:'editB', file:source, prepared:false}]};
    w.eval('_localPreparationBatch = window.__batch; _localPreparationMessage = ""; _renderLocalPreparation()');
  });
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation');
  await expect(page.locator('#localPreparationStatus')).toContainText('review copy');
  await expect(page.locator('#localPreparationRun')).toBeDisabled();
  await page.evaluate(() => {
    (window as any).__batch.issues.add('editB');
    (window as any).eval('_localPreparationMessage = ""; _renderLocalPreparation()');
  });
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed');
  await expect(page.locator('#localPreparationRun')).toBeDisabled();
});

test('the activation notice names an assumed color family', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(fixture('red.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await page.evaluate(() => {
    const w = window as any;
    w.__recoveryProbe = {files:[new File(['a'], 'a.mp4', {type:'video/mp4'})], preparedFiles:new Set(), announced:false,
      notices:['No color tags; assumed BT.709']};
    w.eval('_localPreparationRecovery = window.__recoveryProbe; _localPreparationRecovery.token = _loadingProgressToken; _localPreparationActivated()');
  });
  await expect(page.locator('.load-toast')).toContainText('No color tags; assumed BT.709');
});
