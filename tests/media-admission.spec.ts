import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareMp4AudioFiles} from './helpers/mp4-audio-files.mjs';

test.use({serviceWorkers:'block'});
let directory:string, files:ReturnType<typeof prepareMp4AudioFiles>, silent:string, wave:string, clocked:string, missingClock:string;
test.beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-admission-'));
  files = prepareMp4AudioFiles(directory, path.join(__dirname, '..'));
  silent = path.join(directory, 'no-audio.mp4');
  execFileSync('ffmpeg', ['-v','error','-i',files.single,'-an','-c:v','copy',silent]);
  wave = path.join(directory, 'audio.wav');
  execFileSync('ffmpeg', ['-v','error','-i',files.single,'-vn','-c:a','pcm_s16le',wave]);
  clocked=path.join(directory,'clocked.mp4');missingClock=path.join(directory,'missing-clock.mp4');
  execFileSync('ffmpeg',['-v','error','-i',path.join(__dirname,'fixtures/audio_offset.mp4'),'-map','0','-c','copy','-movie_timescale','48000',clocked]);
  const bytes=fs.readFileSync(clocked);
  // Rename the structurally located header; sizes and absolute media offsets stay intact.
  for(let at=0;at<bytes.length;at+=bytes.readUInt32BE(at)) {
    if(bytes.toString('ascii',at+4,at+8)!=='moov')continue;
    const end=at+bytes.readUInt32BE(at);
    for(let p=at+8;p<end;p+=bytes.readUInt32BE(p))if(bytes.toString('ascii',p+4,p+8)==='mvhd'){bytes.write('free',p+4,'ascii');break;}
    break;
  }
  fs.writeFileSync(missingClock,bytes);
});
test.afterAll(() => { if (directory) fs.rmSync(directory, {recursive:true, force:true}); });
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('lastSeenVersion','999.0.0');
    const w=window as any; w.admissionErrors=[]; w.admissionReplies=[];
    addEventListener('error',e=>w.admissionErrors.push(e.message));
    addEventListener('unhandledrejection',e=>w.admissionErrors.push(String(e.reason)));
    addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.admissionReplies.push(e.data);});
  });
  await page.goto('/');
});
const reports = (page:any) => page.evaluate(() => (window as any).__testAPI.mediaInputReports);
async function host(page:any, file:string, id='current', extra={}) {
  await page.evaluate(({base64,name,id,extra}:any) => window.postMessage({type:'WARPDIFF_LOAD', requestId:id,
    files:[{name,contentType:'video/mp4',base64}],...extra}, location.origin),
    {base64:fs.readFileSync(file).toString('base64'),name:path.basename(file),id,extra});
}
async function ready(page:any, id='current') {
  // Observe the app's bounded 10-second first-frame decision before asserting
  // success. A FAILED terminal reply fails immediately, rather than being retried.
  const replies=()=>page.evaluate((id:string)=>(window as any).admissionReplies.filter((reply:any)=>reply.requestId===id),id);
  await expect.poll(async()=>(await replies()).length,{timeout:15000}).toBeGreaterThan(0);
  expect(await replies()).toEqual([expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:id})]);
}

test('decoded image report is immutable and its dialog preserves focus and literal filenames', async ({page}) => {
  await expect(page.locator('#mediaStatusBtn')).toBeHidden();
  await page.locator('#multiFileInput').setInputFiles({name:'<img src=x onerror=alert(1)>.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(__dirname,'fixtures/green.png'))});
  await expect.poll(async () => (await reports(page)).editA?.capabilities.picture.state).toBe('available');
  const report=(await reports(page)).editA;
  expect(report.admission.state).toBe('admitted'); expect(report.capabilities.frameAccess.state).toBe('available');
  expect(report.capabilities.audioDecode.state).toBe('not-applicable');
  expect(await page.evaluate(() => Object.isFrozen((window as any).__testAPI.mediaInputReports.editA.capabilities.picture))).toBe(true);
  const hostView=await page.evaluate(() => ({version:(window as any).WarpDiffHostAPI.capabilities.mediaInputReportVersion,
    report:(window as any).WarpDiffHostAPI.readMediaInputReports().editA,
    frozen:Object.isFrozen((window as any).WarpDiffHostAPI.readMediaInputReports())}));
  expect(hostView).toEqual({version:1,report,frozen:true});
  const button=page.locator('#mediaStatusBtn'),dialog=page.locator('#mediaStatusDialog');
  await button.click(); await expect(dialog).toBeVisible();
  const box=(await dialog.boundingBox())!,viewport=page.viewportSize()!;
  expect(Math.abs(box.x-(viewport.width-box.width)/2)).toBeLessThan(1);
  expect(Math.abs(box.y-(viewport.height-box.height)/2)).toBeLessThan(1);
  await expect(dialog.locator('h3')).toContainText('<img src=x onerror=alert(1)>.png');
  await expect(dialog.locator('img')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(button).toBeFocused();
  expect(await page.evaluate(() => (window as any).admissionErrors)).toEqual([]);
});

test('single-track video separates observed tools from unverified timing and original fidelity', async ({page}) => {
  await host(page,files.single); await ready(page);
  await expect.poll(async () => (await reports(page)).editA?.capabilities.decodedAnalysis.state).toBe('available');
  await expect.poll(async () => (await reports(page)).editA?.capabilities.scrubAudio.state).toBe('available');
  const report=(await reports(page)).editA;
  expect(report).toMatchObject({container:'mp4',audioTrackCount:1,admission:{state:'admitted',preparedProfile:'not-validated'}});
  expect(report.capabilities.picture.state).toBe('available'); expect(report.capabilities.nativePlayback.state).toBe('available');
  expect(report.timing.duration.state).toBe('known'); expect(report.timing.audioStart.state).toBe('known');
  expect(report.timing.frameRate.state).toBe('unknown'); expect(report.timing.synchronization.state).toBe('unknown');
  expect(report.capabilities.originalSourceAnalysis.state).toBe('unknown');
  const before=await page.locator('#layerEditA video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime}));
  await page.locator('#mediaStatusBtn').click(); await page.locator('#mediaStatusRefresh').click();
  expect(await page.locator('#layerEditA video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime}))).toEqual(before);
  await expect(page.locator('[data-host-video-probe]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).admissionErrors)).toEqual([]);
});

test('multi-track picture admission never authorizes decoded audio tools', async ({page}) => {
  await host(page,files.paddedMulti); await ready(page);
  await expect.poll(async () => (await reports(page)).editA?.audioTrackCount).toBe(2);
  const report=(await reports(page)).editA;
  expect(report.admission.state).toBe('admitted'); expect(report.capabilities.picture.state).toBe('available');
  for (const key of ['audioDecode','decodedAnalysis','scrubAudio']) expect(report.capabilities[key].state).toBe('unavailable');
  expect(report.issues[0].code).toBe('audio-track-selection-required');
  await page.locator('#mediaStatusBtn').click();
  await expect(page.locator('#mediaStatusContent')).toContainText('Multiple MP4 audio tracks');
});

test('verified silent video has no audio requirement rather than a codec failure', async ({page}) => {
  await host(page,silent); await ready(page);
  await expect.poll(async () => (await reports(page)).editA?.audioTrackCount).toBe(0);
  const report=(await reports(page)).editA;
  expect(report.capabilities.picture.state).toBe('available');
  expect(report.capabilities.audioDecode.state).toBe('not-applicable'); expect(report.capabilities.scrubAudio.state).toBe('not-applicable');
  expect(report.issues).toEqual([]);
});

test('audio-only analysis does not turn an unknown start into verified zero', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(wave);
  await expect.poll(async () => (await reports(page)).editA?.capabilities.decodedAnalysis.state).toBe('available');
  const report=(await reports(page)).editA;
  expect(report.kind).toBe('audio'); expect(report.capabilities.picture.state).toBe('not-applicable');
  expect(report.timing.audioStart).toMatchObject({state:'unknown',seconds:null});
  expect(report.capabilities.originalSourceAnalysis.state).toBe('unknown');
});

test('missing MP4 movie clock cannot certify legacy fallback timing',async({page,browserName})=>{
  await page.locator('#multiFileInput').setInputFiles(clocked);
  await expect.poll(async()=>(await reports(page)).editA?.timing.audioStart.state).toBe('known');
  const correct=(await reports(page)).editA.timing.audioStart.seconds;
  expect(correct).toBeGreaterThan(0);expect(correct).toBeLessThan(.2);
  await page.locator('#multiFileInput').setInputFiles(missingClock);
  await expect.poll(async()=>(await reports(page)).editA?.admission.state).toBe('failed');
  if(browserName==='chromium') {
    await expect.poll(async()=>(await reports(page)).editA?.capabilities.decodedAnalysis.state).toBe('available');
    expect((await reports(page)).editA.container).toBe('mp4');
    // Legacy transport arithmetic is retained; only the report's confidence changes.
    expect(await page.evaluate(()=>(window as any).__testAPI._audioTimelineStartKnown.editA)).toBe(true);
  }
  expect((await reports(page)).editA.timing.audioStart).toMatchObject({state:'unknown',seconds:null});
  expect(await page.evaluate(()=>(window as any).admissionErrors)).toEqual([]);
});

test('manual decoder failure cannot inherit a previous image success', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/green.png'));
  await expect.poll(async () => (await reports(page)).editA?.capabilities.picture.state).toBe('available');
  await page.locator('#multiFileInput').setInputFiles({name:'corrupt.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a movie')});
  await expect.poll(async () => (await reports(page)).editA?.admission.state).toBe('failed');
  expect((await reports(page)).editA.capabilities.picture.state).toBe('unavailable');
  await expect(page.locator('#localPreparationDialog')).not.toBeVisible();
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed');
  await page.locator('#mediaStatusBtn').click(); await expect(page.locator('#mediaStatusContent')).toContainText('could not be decoded');
});

test('clear retires reports and rejects a retired observation token', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/green.png'));
  await expect.poll(async () => (await reports(page)).editA?.capabilities.picture.state).toBe('available');
  await page.evaluate(() => { (window as any).oldAdmissionToken=(window as any).eval('_loadingProgressToken'); });
  await page.locator('#mediaStatusBtn').click();
  await page.evaluate(() => (window as any).clearAllMedia());
  expect(await reports(page)).toEqual({}); await expect(page.locator('#mediaStatusDialog')).not.toBeVisible();
  await expect(page.locator('#mediaStatusBtn')).toBeHidden(); await expect(page.locator('#loadBtn')).toBeFocused();
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/red.png'));
  await expect.poll(async () => (await reports(page)).editA?.capabilities.picture.state).toBe('available');
  const accepted=await page.evaluate(() => (window as any)._mediaInputObserve('editA',(window as any).oldAdmissionToken,{mediaFailed:true}));
  expect(accepted).toBe(false); expect((await reports(page)).editA.admission.state).toBe('admitted');
});

test('provider claims and native metadata cannot bypass first-frame verification', async ({page}) => {
  await host(page,files.single,'control'); await ready(page,'control');
  await page.evaluate(() => { (window as any)._hostVideoFrameAvailable=()=>false; });
  await page.clock.install();
  await host(page,files.single,'unverified',{mediaInputReport:{pictureDecoded:true,ready:true,validated:true}});
  await expect.poll(() => page.locator('#layerEditA video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  const report=(await reports(page)).editA;
  expect(report.admission.state).toBe('pending'); expect(report.capabilities.picture.state).toBe('unknown');
  expect(report.capabilities.nativePlayback.state).toBe('unknown');
  await page.clock.fastForward(11000);
  await expect.poll(() => page.evaluate(() => (window as any).admissionReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'control'}),
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'unverified'})]);
  expect(await reports(page)).toEqual({});
});

test('status fits a narrow viewport and refresh performs at most two pixel draws per input', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/green.png'));
  await expect.poll(async () => (await reports(page)).editA?.capabilities.picture.state).toBe('available');
  await page.evaluate(() => { const draw=CanvasRenderingContext2D.prototype.drawImage; (window as any).statusDraws=0;
    CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){if(this.canvas.width===1&&this.canvas.height===1)(window as any).statusDraws++;return (draw as any).apply(this,args);}; });
  await page.locator('#mediaStatusBtn').click();
  const dialog=page.locator('#mediaStatusDialog'),box=(await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(390); expect(box.y+box.height).toBeLessThanOrEqual(844);
  expect(Math.abs(box.x-(390-box.width)/2)).toBeLessThan(1);
  expect(Math.abs(box.y-(844-box.height)/2)).toBeLessThan(1);
  expect(await page.evaluate(() => (window as any).statusDraws)).toBeLessThanOrEqual(2);
  await page.locator('#mediaStatusRefresh').click();
  expect(await page.evaluate(() => (window as any).statusDraws)).toBeLessThanOrEqual(4);
  await dialog.evaluate((element:HTMLDialogElement)=>{element.scrollTop=element.scrollHeight;});
  await expect(dialog.locator('dd').last()).toBeInViewport();
});

test('status owns keyboard input and Escape closes it while loop markers remain active', async ({page}) => {
  await host(page,files.single); await ready(page);
  await page.evaluate(() => (window as any).setLoopPoint('in'));
  const before=await page.evaluate(() => ({grid:(window as any).__testAPI.isGridMode,loop:(window as any).__testAPI._loopInPoint}));
  await page.locator('#mediaStatusBtn').click();
  await page.keyboard.press('g');
  expect(await page.evaluate(() => (window as any).__testAPI.isGridMode)).toBe(before.grid);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mediaStatusDialog')).not.toBeVisible();
  await expect(page.locator('#mediaStatusBtn')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__testAPI._loopInPoint)).toBe(before.loop);
});
