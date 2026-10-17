import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

test.use({serviceWorkers:'block'});
let directory:string,packageResult:any;
const source=path.join(__dirname,'fixtures/ac3_video.mp4');
test.beforeAll(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-package-browser-'));
  packageResult=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../tools/media-prepare/prepare.mjs'),'--input',source,'--output',path.join(directory,'package')],{encoding:'utf8',timeout:30000}));});
test.afterAll(()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lastSeenVersion','999.0.0');const w=window as any;w.packageReplies=[];w.packageErrors=[];
    addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.packageReplies.push(e.data);});
    addEventListener('unhandledrejection',e=>w.packageErrors.push(String(e.reason)));
    addEventListener('error',e=>w.packageErrors.push(e.message));});
  await page.goto('/');
  // A test-only picker models an explicit local file handoff; no network transport.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='packageTestInput';document.body.append(input);});
  await page.locator('#packageTestInput').setInputFiles([source,packageResult.manifest,packageResult.rendition]);
});
test.afterEach(async({page})=>expect(await page.evaluate(()=>(window as any).packageErrors)).toEqual([]));

test('explicit file adapter inspects real returned bytes and ordinary loading owns activation',async({page})=>{
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  const result=await page.evaluate(async()=>{
    const w=window as any,[input,manifestFile,mediaFile]=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);
    const api=w.eval('WarpPreparedMedia'),prep=w.eval('WarpMediaPreparation'),registry=w.eval('_mediaPreparationProviders');
    const report=await api.inspectFiles({manifestFile,mediaFile,sourceFile:input});
    registry.register(api.createFileProvider({manifestFile,mediaFile}));const request=prep.createRequest({id:'offline-copy',filename:input.name});
    const registered=w.__testAPI.mediaInputReports;const output=await registry.prepare('prepared-package',request,input);
    const before=w.__testAPI.mediaInputReports;const validation=output.validation;
    w.checkedPackageOutput=output;return{report,registered,before,validation};
  });
  expect(result.report).toMatchObject({status:'candidate',sourceBinding:'matched',renditionBinding:'matched',validation:'normal-load-required',container:{channels:2,sampleRate:48000}});
  expect(result.report.conformance.synchronization).toBe('not-verified');expect(result.registered).toEqual({});expect(result.before).toEqual({});expect(result.validation).toBe('required');
  expect(requests).toEqual([]);
  await page.evaluate(()=>{const w=window as any;w.handleMultipleFiles(w.checkedPackageOutput.files);});
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect.poll(()=>page.evaluate(()=>(window as any).__testAPI.mediaInputReports.editA?.capabilities.decodedAnalysis.state)).toBe('available');
  expect(await page.evaluate(()=>(window as any).__testAPI.mediaInputReports.editA.admission.preparedProfile)).toBe('not-validated');
  expect(requests.some(url=>url.includes('/ffmpeg/'))).toBe(false);expect(await page.evaluate(()=>(window as any).packageReplies)).toEqual([]);
});

test('managed handoff waits for normal correlated READY after successful package inspection',async({page})=>{
  const before=await page.evaluate(async()=>{
    const w=window as any,[input,manifestFile,mediaFile]=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);
    const registry=w.eval('_mediaPreparationProviders');registry.register(w.eval('WarpPreparedMedia').createFileProvider({manifestFile,mediaFile}));
    const request=w.eval('WarpMediaPreparation').createRequest({id:'managed-package',filename:input.name});
    const output=await registry.prepare('prepared-package',request,input);const replies=[...w.packageReplies];
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'managed-package',files:[{name:output.files[0].name,contentType:output.files[0].type,buffer:await output.files[0].arrayBuffer()}]},location.origin);return replies;
  });
  expect(before).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>(window as any).packageReplies)).toEqual([expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'managed-package'})]);
  await expect.poll(()=>page.evaluate(()=>(window as any).__testAPI.mediaInputReports.editA?.capabilities.picture.state)).toBe('available');
});

for(const target of ['source','rendition'])test(`same-name same-size altered ${target} fails without replacing the current comparison`,async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname,'fixtures/green.png'));
  const result=await page.evaluate(async target=>{
    const w=window as any,files=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);let[input,manifestFile,mediaFile]=files;
    const selected=target==='source'?input:mediaFile,bytes=new Uint8Array(await selected.arrayBuffer());bytes[bytes.length-1]^=1;
    const altered=new File([bytes],selected.name,{type:selected.type});if(target==='source')input=altered;else mediaFile=altered;
    try{await w.eval('WarpPreparedMedia').inspectFiles({manifestFile,mediaFile,sourceFile:input});return 'unexpected success';}catch(e:any){return e.message;}
  },target);
  expect(result).toMatch(/SHA-256/);
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('mediaData.editA.name'))).toBe('green.png');
  expect(await page.evaluate(()=>(window as any).packageReplies)).toEqual([]);
});

test('a forged matching manifest cannot turn corrupt media into a candidate',async({page})=>{
  const result=await page.evaluate(async()=>{
    const w=window as any,api=w.eval('WarpPreparedMedia'),[,manifestFile]=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);
    const bytes=new TextEncoder().encode('not an MP4 file'),hash=await crypto.subtle.digest('SHA-256',bytes),manifest=JSON.parse(await manifestFile.text());
    manifest.ready=true;manifest.validated=true;manifest.rendition={name:'review.mp4',size:bytes.length,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')};
    try{await api.inspectFiles({manifestFile:new File([JSON.stringify(manifest)],'warpdiff-package.json'),mediaFile:new File([bytes],'review.mp4')});return false;}catch{return true;}
  });expect(result).toBe(true);expect(await page.evaluate(()=>(window as any).__testAPI.mediaInputReports)).toEqual({});
});

test('implicit SBR cannot satisfy the AAC-LC package profile despite an AOT2 codec string',async({page})=>{
  const result=await page.evaluate(async()=>{
    const w=window as any,[,manifestFile,mediaFile]=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);
    const bytes=new Uint8Array(await mediaFile.arrayBuffer()),description=w._demuxMP4Audio(bytes).description;
    if(description.length!==5)throw Error('Positive AAC-LC fixture must expose its five-byte ASC');
    // Extraction returns a copy. Locate its unique fixture bytes rather than
    // mistaking that copy's byteOffset for a location inside the container.
    const offsets=[];
    for(let at=0;at<=bytes.length-description.length;at++)if(description.every((n:number,i:number)=>bytes[at+i]===n))offsets.push(at);
    if(offsets.length!==1)throw Error('Positive AAC-LC fixture must have one identifiable ASC');
    bytes.set([0x13,0x10,0x56,0xe5,0x98],offsets[0]);
    const summary=w._demuxMP4Audio(bytes,false,null,true),digest=await crypto.subtle.digest('SHA-256',bytes);
    if(!summary)throw Error('Altered fixture must retain valid container tables');
    const manifest=JSON.parse(await manifestFile.text());manifest.rendition.sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    let error='';try{await w.eval('WarpPreparedMedia').inspectFiles({manifestFile:new File([JSON.stringify(manifest)],'warpdiff-package.json'),mediaFile:new File([bytes],'review.mp4')});}catch(e:any){error=e.message;}
    return{codec:summary.codec,sbr:summary.aacSbr,error};
  });
  expect(result).toMatchObject({codec:'mp4a.40.2',sbr:true});expect(result.error).toMatch(/stereo AAC-LC/);
  expect(await page.evaluate(()=>(window as any).__testAPI.mediaInputReports)).toEqual({});
});

test('clear cancels a pending file adapter and late read completion cannot activate a comparison',async({page})=>{
  await page.evaluate(()=>{
    const w=window as any,[input,manifestFile,mediaFile]=Array.from((document.getElementById('packageTestInput') as HTMLInputElement).files!);
    const original=mediaFile.arrayBuffer.bind(mediaFile);mediaFile.arrayBuffer=()=>{w.packageReadStarted=true;return new Promise(resolve=>{w.releasePackageRead=async()=>resolve(await original());});};
    const registry=w.eval('_mediaPreparationProviders');registry.register(w.eval('WarpPreparedMedia').createFileProvider({manifestFile,mediaFile}));
    w.pendingPackage=registry.prepare('prepared-package',w.eval('WarpMediaPreparation').createRequest({id:'cancel',filename:input.name}),input).then(()=>false,(e:any)=>e.name==='AbortError');
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).packageReadStarted)).toBe(true);
  await page.evaluate(()=>(window as any).clearAllMedia());expect(await page.evaluate(()=>(window as any).pendingPackage)).toBe(true);
  await page.evaluate(async()=>{const w=window as any;await w.releasePackageRead();});
  expect(await page.evaluate(()=>(window as any).__testAPI.mediaInputReports)).toEqual({});expect(await page.evaluate(()=>(window as any).packageReplies)).toEqual([]);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});
