import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawn} from 'node:child_process';

async function launchCompanion(delayed=false):Promise<any> {
  const child=spawn(process.execPath,[path.join(__dirname,'helpers/local-companion-launch.mjs'),...(delayed?['--delayed']:[])],{stdio:['ignore','pipe','pipe','ipc']});
  let diagnostics='',started=false,retired=false;
  child.stderr.on('data',data=>{diagnostics+=data.toString();});
  const closed=new Promise(resolve=>child.once('close',resolve));
  const origin=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Local prototype did not start: '+diagnostics));},20000);
    child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Local prototype exited: '+diagnostics));});
    child.on('message',(message:any)=>{if(message.started)started=true;if(message.retired)retired=true;if(message.origin){clearTimeout(timer);resolve(message.origin);}});
  });
  return {origin,state:()=>({started,retired}),async close(){
    const kill=setTimeout(()=>child.kill('SIGKILL'),10000);child.send('close');await closed;clearTimeout(kill);
  }};
}

test.use({serviceWorkers:'block'});
let app:any,directory:string;
const fixture=(name:string)=>path.join(__dirname,'fixtures',name);
const own=(name:string)=>path.join(directory,name);
test.beforeAll(async()=>{
  app=await launchCompanion();directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-companion-browser-'));
  const run=(args:string[])=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n',...args],{timeout:30000,stdio:'pipe'});
  run(['-i',fixture('landscape_a.mp4'),'-t','0.5','-c:v','copy','-c:a','dca','-strict','-2',own('dts_video.mp4')]);
  run(['-i',fixture('landscape_a.mp4'),'-t','0.5','-vf','scale=160:90','-c:v','ffv1','-c:a','flac',own('ffv1_video.mkv')]);
  run(['-i',fixture('stereo.wav'),'-t','0.5','-c:a','dca','-strict','-2',own('audio.dts')]);
});
test.afterAll(async()=>{await app?.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{const w=window as any;w.prototypeErrors=[];addEventListener('error',e=>w.prototypeErrors.push(e.message));addEventListener('unhandledrejection',e=>w.prototypeErrors.push(String(e.reason)));});
  await page.goto(app.origin);
});
test.afterEach(async({page})=>{await page.locator('#cancel').evaluate((button:HTMLButtonElement)=>button.click());expect(await page.evaluate(()=>(window as any).prototypeErrors)).toEqual([]);});
async function ready(page:any){await expect(page.locator('#cover')).toBeHidden({timeout:45000});}
const core=(page:any)=>page.locator('iframe').contentFrame();
const reports=(page:any)=>core(page).locator('body').evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports());

test('ordinary files open directly with one picker and no preparation or package UI',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/api/prepare'))requests.push(r.url());});
  const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open files…',exact:true}).click();await(await picker).setFiles(fixture('green.png'));
  await ready(page);expect((await reports(page)).editA.capabilities.picture.state).toBe('available');
  expect(requests).toEqual([]);await expect(page.locator('#prepareAgain')).toBeHidden();
  await expect(core(page).locator('#preparedPackageBtn')).not.toBeVisible();await expect(core(page).locator('#preparedImportDialog')).not.toBeVisible();
});

test('a supported video retains direct loading and decoded analysis',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/api/prepare'))requests.push(r.url());});
  await page.locator('#files').setInputFiles(fixture('landscape_a.mp4'));await ready(page);
  expect((await reports(page)).editA.capabilities.decodedAnalysis.state).toBe('available');expect(requests).toEqual([]);
});

for(const filename of ['dts_video.mp4','ffv1_video.mkv','audio.dts'])test(`${filename} prepares only on click and opens the returned file automatically`,async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/api/prepare'))requests.push(r.url());});
  await page.locator('#files').setInputFiles(own(filename));await expect(page.locator('#prepare')).toBeVisible({timeout:45000});
  expect(requests).toEqual([]);await expect(page.locator('#copyNote')).toBeVisible();
  await page.getByRole('button',{name:'Prepare and open',exact:true}).click();await ready(page);
  expect(requests).toHaveLength(1);const report=(await reports(page)).editA;
  expect(report.capabilities.decodedAnalysis.state).toBe('available');if(filename!=='audio.dts')expect(report.capabilities.picture.state).toBe('available');
  expect(report.admission.preparedProfile).toBe('not-validated');
  await expect(core(page).locator('#preparedImportDialog')).not.toBeVisible();await expect(core(page).locator('#ffmpegPanel')).not.toBeVisible();
  await expect(page.locator('#message')).toHaveText('Opened the prepared review copy. Originals are unchanged.');
});

test('preparing one member preserves the other comparison files and their host order',async({page})=>{
  await page.locator('#files').setInputFiles([fixture('red.png'),own('dts_video.mp4')]);
  await expect(page.locator('#prepare')).toBeVisible({timeout:45000});await page.locator('#prepare').click();await ready(page);
  const names=await core(page).locator('body').evaluate(()=>(window as any).eval('Object.values(mediaData).filter(Boolean).map(v=>v.name)'));
  expect(names).toEqual(['red.png','dts_video_review.mp4']);
  const result=await reports(page);expect(result.editA.capabilities.picture.state).toBe('available');expect(result.editB.capabilities.decodedAnalysis.state).toBe('available');
});

test('clear during preparation retires the external job and cannot reopen its late result',async({page})=>{
  const delayed=await launchCompanion(true);
  try {
    await page.goto(delayed.origin);await page.locator('#files').setInputFiles(own('dts_video.mp4'));await expect(page.locator('#prepare')).toBeVisible({timeout:45000});await page.locator('#prepare').click();
    await expect.poll(()=>delayed.state().started).toBe(true);
    await expect(page.locator('#prepareAgain')).toBeHidden();await expect(page.locator('#anyway')).toBeHidden();
    await page.locator('#cancel').click();
    await page.locator('#files').setInputFiles(fixture('blue.png'));await ready(page);
    await expect.poll(()=>delayed.state().retired).toBe(true);
    expect((await reports(page)).editA.capabilities.picture.state).toBe('available');
    await expect(page.locator('#message')).toHaveText('Opened your files.');
  } finally {await delayed.close();}
});

test('drop in the comparison routes through the host and keeps one loading owner',async({page})=>{
  await page.locator('#files').setInputFiles(fixture('green.png'));await ready(page);
  const bytes=[...fs.readFileSync(fixture('blue.png'))];
  // Dispatch from the stable parent: replacing the comparison deliberately
  // detaches the old frame during this event, including its execution context.
  await page.evaluate((bytes:number[])=>{const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([new Uint8Array(bytes)],'blue.png',{type:'image/png'}));
    document.querySelector('iframe')!.contentDocument!.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));},bytes);
  await expect.poll(()=>core(page).locator('body').evaluate(()=>(window as any).eval('mediaData.editA?.name'))).toBe('blue.png');await ready(page);
});

test('narrow opening and preparation controls remain inside the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:650});await page.locator('#files').setInputFiles(own('dts_video.mp4'));await expect(page.locator('#prepare')).toBeVisible({timeout:45000});
  await page.locator('#prepare').scrollIntoViewIfNeeded();const box=(await page.locator('#prepare').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(650);
  await page.locator('#prepare').focus();await page.keyboard.press('Enter');await ready(page);
});

test('unreadable media reports a preparation failure and the next ordinary file still opens',async({page})=>{
  await page.locator('#files').setInputFiles({name:'unreadable.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('not a video')});
  await expect(page.locator('#prepare')).toBeVisible({timeout:45000});
  await expect(page.locator('#anyway')).toBeHidden();
  await page.locator('#prepareAgain').click();await expect(page.locator('#anyway')).toBeHidden();
  await page.locator('#prepare').click();await expect(page.locator('#title')).toHaveText('Preparation did not finish',{timeout:20000});
  await expect(page.locator('#message')).toContainText('Your originals are unchanged.');await expect(page.locator('#prepare')).toBeEnabled();
  await page.locator('#files').setInputFiles(fixture('green.png'));await ready(page);
  expect((await reports(page)).editA.capabilities.picture.state).toBe('available');
});

test('preparation cover prevents keyboard interaction with the concealed comparison',async({page})=>{
  await page.locator('#files').setInputFiles(own('dts_video.mp4'));await expect(page.locator('#prepare')).toBeVisible({timeout:45000});
  expect(await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>frame.inert)).toBe(true);
  await page.locator('#prepare').focus();for(let i=0;i<6;i++){
    await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe('IFRAME');
  }
  await page.locator('#anyway').click();await ready(page);
  expect(await page.locator('iframe').evaluate((frame:HTMLIFrameElement)=>frame.inert)).toBe(false);
});
