import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

test.use({serviceWorkers:'block'});
let directory:string,prepared:any,media:Buffer,manifest:any;
const fixture=(name:string)=>path.join(__dirname,'fixtures',name);
test.beforeAll(()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-import-'));
  prepared=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../tools/media-prepare/prepare.mjs'),'--input',fixture('ac3_video.mp4'),'--output',path.join(directory,'package')],{encoding:'utf8',timeout:30000}));
  media=fs.readFileSync(prepared.rendition);manifest=JSON.parse(fs.readFileSync(prepared.manifest,'utf8'));
});
test.afterAll(()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lastSeenVersion','999.0.0');const w=window as any;w.importErrors=[];w.importReplies=[];
    addEventListener('error',e=>w.importErrors.push(e.message));addEventListener('unhandledrejection',e=>w.importErrors.push(String(e.reason)));
    addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.importReplies.push(e.data);});});
  await page.goto('/');await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));
  await expect.poll(()=>page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA?.capabilities.picture.state)).toBe('available');
  await page.getByRole('button',{name:'Load prepared package',exact:true}).click();
});
test.afterEach(async({page})=>{const errors=await page.evaluate(async()=>{const w=window as any;w._resetPreparedImport();if(w.releaseImportRead)await w.releaseImportRead();return w.importErrors;});expect(errors).toEqual([]);});
const current=(page:any)=>page.evaluate(()=>Object.values((window as any).eval('mediaData')).filter(Boolean).map((v:any)=>v.name).sort());
async function select(page:any,original=false){await page.locator('#preparedImportManifest').setInputFiles(prepared.manifest);await page.locator('#preparedImportMedia').setInputFiles(prepared.rendition);if(original)await page.locator('#preparedImportSource').setInputFiles(fixture('ac3_video.mp4'));}
async function check(page:any){await page.locator('#preparedImportCheck').click();await expect(page.locator('#preparedImportLoad')).toBeEnabled({timeout:15000});}
async function delayed(page:any){await select(page);await page.evaluate(()=>{const w=window as any,read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){if(this.name==='review.mp4'){w.importReadStarted=true;return new Promise(resolve=>{w.releaseImportRead=async()=>{w.releaseImportRead=null;File.prototype.arrayBuffer=read;resolve(await read.call(this));};});}return read.call(this);};});await page.locator('#preparedImportCheck').click();await expect.poll(()=>page.evaluate(()=>(window as any).importReadStarted)).toBe(true);}

 test('selection and checking preserve the current comparison until explicit load',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.evaluate(()=>{const w=window as any;w.importReads=0;const read=File.prototype.arrayBuffer,text=File.prototype.text;File.prototype.arrayBuffer=function(){w.importReads++;return read.call(this);};File.prototype.text=function(){w.importReads++;return text.call(this);};});
  await select(page);expect(await page.evaluate(()=>(window as any).importReads)).toBe(0);await expect(page.locator('#preparedImportLoad')).toBeDisabled();
  await check(page);expect(await current(page)).toEqual(['green.png']);await expect(page.locator('#preparedImportSummary')).toContainText('original-file binding was not checked');
  await expect(page.locator('#preparedImportSummary')).toContainText('stereo AAC-LC, 48 kHz');await expect(page.locator('#preparedImportSummary')).toContainText('not independently verified');
  expect(await page.evaluate(()=>(window as any).importReplies)).toEqual([]);expect(requests).toEqual([]);
  await page.locator('#preparedImportLoad').click();await expect(page.locator('#preparedImportDialog')).not.toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA?.capabilities.decodedAnalysis.state),{timeout:15000}).toBe('available');
  expect(await current(page)).toEqual(['review.mp4']);expect(await page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA.admission.preparedProfile)).toBe('not-validated');
  expect(await page.evaluate(()=>(window as any).importReplies)).toEqual([]);
 });
 test('optional original is matched but only the rendition and companion media load',async({page})=>{
  await select(page,true);await page.locator('#preparedImportOthers').setInputFiles([fixture('red.png'),fixture('blue.png')]);await check(page);
  await expect(page.locator('#preparedImportSummary')).toContainText('ac3_video.mp4 — selected bytes match');await expect(page.locator('#preparedImportSummary')).toContainText('red.png, blue.png');
  await page.locator('#preparedImportLoad').click();await expect.poll(()=>current(page)).toEqual(['blue.png','red.png','review.mp4']);
  // The initially hidden video has no observed frame yet. Select and play it
  // before asking Media status to verify its pixels.
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');
  await expect.poll(()=>page.locator('#layerEditB video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15000}).toBeGreaterThan(.01);await page.keyboard.press('Space');
  await page.locator('#mediaStatusBtn').click();await page.locator('#mediaStatusRefresh').click();
  await expect.poll(()=>page.evaluate(()=>Object.values((window as any).WarpDiffHostAPI.readMediaInputReports()).every((r:any)=>r.capabilities.picture.state==='available')),{timeout:15000}).toBe(true);
 });
 for(const target of ['source','rendition'])test(`changed ${target} bytes reject without clearing the current comparison`,async({page})=>{
  await select(page,true);const source=target==='source'?fs.readFileSync(fixture('ac3_video.mp4')):media,bytes=Buffer.from(source);bytes[bytes.length-1]^=1;
  await page.locator(target==='source'?'#preparedImportSource':'#preparedImportMedia').setInputFiles({name:target==='source'?'ac3_video.mp4':'review.mp4',mimeType:'video/mp4',buffer:bytes});
  await page.locator('#preparedImportCheck').click();await expect(page.locator('#preparedImportStatus')).toContainText('SHA-256');await expect(page.locator('#preparedImportLoad')).toBeDisabled();expect(await current(page)).toEqual(['green.png']);
 });
 test('malformed manifest and mismatched file identity cannot enable loading',async({page})=>{
  await select(page);await page.locator('#preparedImportManifest').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.locator('#preparedImportCheck').click();
  await expect(page.locator('#preparedImportStatus')).toContainText('Package check failed');expect(await current(page)).toEqual(['green.png']);
  await page.locator('#preparedImportManifest').setInputFiles(prepared.manifest);await page.locator('#preparedImportMedia').setInputFiles({name:'wrong.mp4',mimeType:'video/mp4',buffer:media});await page.locator('#preparedImportCheck').click();
  await expect(page.locator('#preparedImportStatus')).toContainText('does not match');await expect(page.locator('#preparedImportLoad')).toBeDisabled();expect(await current(page)).toEqual(['green.png']);
 });
 test('changed selection invalidates a checked candidate immediately',async({page})=>{
  await select(page);await check(page);await page.locator('#preparedImportSource').setInputFiles(fixture('landscape_a.mp4'));await expect(page.locator('#preparedImportLoad')).toBeDisabled();await expect(page.locator('#preparedImportSummary')).toBeEmpty();expect(await current(page)).toEqual(['green.png']);
 });
 test('cancellation keeps the comparison and reservation until a pending read retires',async({page})=>{
  await delayed(page);await page.keyboard.press('Escape');await expect(page.locator('#preparedImportDialog')).not.toBeVisible();expect(await current(page)).toEqual(['green.png']);await expect(page.locator('#preparedPackageBtn')).toBeFocused();
  await page.locator('#preparedPackageBtn').click();await select(page);await expect(page.locator('#preparedImportCheck')).toBeDisabled();await page.evaluate(async()=>{await (window as any).releaseImportRead();});await expect(page.locator('#preparedImportCheck')).toBeEnabled();await expect(page.locator('#preparedImportLoad')).toBeDisabled();expect(await current(page)).toEqual(['green.png']);await check(page);
 });
 test('ordinary replacement cancels an inspection and rejects its late completion',async({page})=>{
  await delayed(page);await page.locator('#multiFileInput').setInputFiles(fixture('red.png'));await expect(page.locator('#preparedImportDialog')).not.toBeVisible();await page.evaluate(async()=>{await (window as any).releaseImportRead();});await expect.poll(()=>current(page)).toEqual(['red.png']);await expect(page.locator('#preparedImportLoad')).toBeDisabled();
 });
 test('clear retires selected Files and a checked result',async({page})=>{
  await select(page,true);await check(page);await page.evaluate(()=>(window as any).clearAllMedia());await expect(page.locator('#preparedImportDialog')).not.toBeVisible();
  for(const id of['Manifest','Media','Source','Others'])expect(await page.locator('#preparedImport'+id).evaluate((input:HTMLInputElement)=>input.files!.length)).toBe(0);
  await page.locator('#preparedPackageBtn').click();await expect(page.locator('#preparedImportLoad')).toBeDisabled();await expect(page.locator('#preparedImportCheck')).toBeDisabled();expect(await current(page)).toEqual([]);
 });
 test('managed host supersession cancels checking and cannot be replaced by the importer',async({page})=>{
  await delayed(page);await page.evaluate(bytes=>window.postMessage({type:'WARPDIFF_LOAD',requestId:'managed-import',capabilities:{managedReview:true},slotLabels:['','Host reference'],files:[{name:'host.png',contentType:'image/png',buffer:new Uint8Array(bytes).buffer}]},location.origin),[...fs.readFileSync(fixture('red.png'))]);
  await expect.poll(()=>page.evaluate(()=>(window as any).importReplies)).toEqual([expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'managed-import'})]);await expect(page.locator('#preparedPackageBtn')).not.toBeVisible();await expect(page.locator('#preparedImportDialog')).not.toBeVisible();
  await page.evaluate(async()=>{await (window as any).releaseImportRead();(window as any)._setPreparedImportOpen(true);(window as any)._loadPreparedImport();});await expect(page.locator('#preparedImportDialog')).not.toBeVisible();expect(await current(page)).toEqual(['host.png']);
 });
 for(const value of['audio','empty','too-many'])test(`invalid ${value} companion selection rejects before package reads`,async({page})=>{
  await select(page);await page.evaluate(()=>{(window as any).importReads=0;const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){(window as any).importReads++;return read.call(this);};});
  await page.locator('#preparedImportOthers').setInputFiles(value==='too-many'?[fixture('green.png'),fixture('red.png'),fixture('blue.png'),fixture('green.png')]:{name:value==='audio'?'audio.wav':'empty.mp4',mimeType:value==='audio'?'audio/wav':'video/mp4',buffer:Buffer.from(value==='empty'?'':'audio')});
  await page.locator('#preparedImportCheck').click();await expect(page.locator('#preparedImportStatus')).toContainText('at most three nonempty images or videos');expect(await page.evaluate(()=>(window as any).importReads)).toBe(0);await expect(page.locator('#preparedImportLoad')).toBeDisabled();expect(await current(page)).toEqual(['green.png']);
 });
 test('verified MP4 bytes load despite an unhelpful OS MIME label',async({page})=>{
  await select(page);await page.locator('#preparedImportMedia').setInputFiles({name:'review.mp4',mimeType:'application/octet-stream',buffer:media});await check(page);await page.locator('#preparedImportLoad').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA?.capabilities.decodedAnalysis.state),{timeout:15000}).toBe('available');expect(await current(page)).toEqual(['review.mp4']);
 });
 test('literal filenames render as text and unknown producer claims cannot certify media',async({page})=>{
  const name='<img src=x onerror=alert(1)>.mp4',claimed={...manifest,ready:true,validated:true,rendition:{...manifest.rendition,name}};
  await page.locator('#preparedImportManifest').setInputFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(claimed))});await page.locator('#preparedImportMedia').setInputFiles({name,mimeType:'video/mp4',buffer:media});await check(page);
  await expect(page.locator('#preparedImportSummary')).toContainText(name);await expect(page.locator('#preparedImportSummary img')).toHaveCount(0);await expect(page.locator('#preparedImportSummary')).toContainText('measurement conformance are not verified');expect(await current(page)).toEqual(['green.png']);
 });
 test('a container candidate does not certify invalid AVC picture',async({page})=>{
  const bytes=Buffer.from(media),at=bytes.indexOf('avcC'),end=at-4+bytes.readUInt32BE(at-4);expect(at).toBeGreaterThan(0);bytes.fill(0,at+12,end);
  const forged={...manifest,rendition:{...manifest.rendition,sha256:createHash('sha256').update(bytes).digest('hex')}};
  await page.locator('#preparedImportManifest').setInputFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(forged))});await page.locator('#preparedImportMedia').setInputFiles({name:'review.mp4',mimeType:'video/mp4',buffer:bytes});await check(page);expect(await current(page)).toEqual(['green.png']);await page.locator('#preparedImportLoad').click();
  await expect.poll(()=>page.locator('#layerEditA video').evaluate((v:HTMLVideoElement)=>!!v.error||v.readyState>=2),{timeout:15000}).toBe(true);
  await page.locator('#mediaStatusBtn').click();await page.locator('#mediaStatusRefresh').click();
  const report=await page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA);
  expect(['unknown','unavailable']).toContain(report.capabilities.picture.state);expect(['unknown','unavailable']).toContain(report.capabilities.frameAccess.state);expect(report.admission.preparedProfile).toBe('not-validated');expect(await page.evaluate(()=>(window as any).importReplies)).toEqual([]);
 });
 test('dialog owns keyboard focus, fits narrow windows and blocks ordinary file drops',async({page})=>{
  await page.setViewportSize({width:390,height:650});const dialog=page.locator('#preparedImportDialog');
  const before=await page.evaluate(()=>({grid:(window as any).__testAPI.isGridMode,index:(window as any).__testAPI.currentAssetIndex}));await page.keyboard.press('g');await page.keyboard.press('ArrowRight');expect(await page.evaluate(()=>({grid:(window as any).__testAPI.isGridMode,index:(window as any).__testAPI.currentAssetIndex}))).toEqual(before);
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(d=>d.contains(document.activeElement))).toBe(true);}
  const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(650);
  await dialog.evaluate(d=>{const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['image'],'dropped.png',{type:'image/png'}));d.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));});expect(await current(page)).toEqual(['green.png']);await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#preparedPackageBtn')).toBeFocused();
 });
 test('a queued old close event cannot cancel a reopened dialog',async({page})=>{
  await page.evaluate(()=>{const w=window as any;w._setPreparedImportOpen(false);w._setPreparedImportOpen(true);});await select(page);await check(page);await expect(page.locator('#preparedImportDialog')).toBeVisible();expect(await current(page)).toEqual(['green.png']);
 });

 test('file chooser cancellation keeps the checked form; dialog Escape still clears it',async({page})=>{
  await select(page,true);await page.locator('#preparedImportOthers').setInputFiles(fixture('red.png'));await check(page);
  for(const id of['Manifest','Media','Source','Others']){await page.locator('#preparedImport'+id).dispatchEvent('cancel',{bubbles:true,cancelable:false});await expect(page.locator('#preparedImportDialog')).toBeVisible();await expect(page.locator('#preparedImportLoad')).toBeEnabled();for(const name of['Manifest','Media','Source','Others'])expect(await page.locator('#preparedImport'+name).evaluate((input:HTMLInputElement)=>input.files!.length)).toBe(1);}
  expect(await current(page)).toEqual(['green.png']);await page.keyboard.press('Escape');await expect(page.locator('#preparedImportDialog')).not.toBeVisible();await expect(page.locator('#preparedPackageBtn')).toBeFocused();
  for(const id of['Manifest','Media','Source','Others'])expect(await page.locator('#preparedImport'+id).evaluate((input:HTMLInputElement)=>input.files!.length)).toBe(0);
 });
 test('opening the package modal retires Appearance keyboard capture',async({page,browserName})=>{
  await page.locator('#preparedImportCancel').click();await page.locator('#appearanceButton').click();await expect(page.locator('#appearancePanel')).toBeVisible();
  if(browserName==='chromium'){for(let i=0;i<40&&!(await page.locator('#preparedPackageBtn').evaluate(e=>e===document.activeElement));i++)await page.keyboard.press('Shift+Tab');await expect(page.locator('#preparedPackageBtn')).toBeFocused();}
  else await page.locator('#preparedPackageBtn').focus(); // WebKit's default Tab policy skips buttons; exercise Enter activation.
  await page.keyboard.press('Enter');await expect(page.locator('#preparedImportDialog')).toBeVisible();await expect(page.locator('#appearancePanel')).not.toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#preparedImportDialog')).not.toBeVisible();await expect(page.locator('#preparedPackageBtn')).toBeFocused();expect(await current(page)).toEqual(['green.png']);
 });
