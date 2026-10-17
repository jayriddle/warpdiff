import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));await page.goto('/');});

test('existing preparation panel uses a versioned manual adapter without loading media',async({page})=>{
  const result=await page.evaluate(()=>{const w=window as any;w._registerFfmpegCommand('editA',"clip's.mp4",'ac-3');return w.eval('({entry:_ffmpegCommands.editA,media:Object.keys(mediaData).filter(slot=>mediaData[slot]),providers:_mediaPreparationProviders.describe(_ffmpegCommands.editA.preparation)})');});
  expect(result.entry.providerId).toBe('manual-ffmpeg');expect(result.entry.preparation.version).toBe(1);
  expect(result.entry.preparation.output.analysisBasis).toBe('prepared-copy');expect(result.entry.preparation.output.channels).toBe(2);
  expect(result.providers).toEqual([{id:'manual-ffmpeg',mode:'instructions'}]);expect(result.media).toEqual([]);
  await expect(page.locator('#ffmpegPanel')).toBeVisible();await expect(page.locator('.fp-cmd')).toContainText("'./clip'\\''s.mp4'");
});

test('file providers run only explicitly and their acceptance claims are withheld',async({page})=>{
  const result=await page.evaluate(async()=>{const w=window as any,P=w.eval('WarpMediaPreparation'),registry=w.eval('_mediaPreparationProviders');let calls=0;const request=P.createRequest({id:'explicit',filename:'source.mp4'});registry.register({id:'fixture',version:1,mode:'files',supports:()=>true,prepare(req:any,{input}:any){calls++;return {kind:'files',files:[new File(['bad image'],'prepared.png',{type:'image/png'})],ready:true,validated:true};}});registry.describe(request);const before=calls;const output=await registry.prepare('fixture',request,new File(['source'],'source.mp4',{type:'video/mp4'}));return {before,calls,validation:output.validation,ready:output.ready,validated:output.validated,media:w.eval('Object.keys(mediaData).filter(slot=>mediaData[slot])')};});
  expect(result).toEqual({before:0,calls:1,validation:'required',ready:undefined,validated:undefined,media:[]});
});

test('returned corrupt preparation output fails the ordinary host validation',async({page})=>{
  await page.evaluate(async()=>{const w=window as any,P=w.eval('WarpMediaPreparation'),registry=w.eval('_mediaPreparationProviders');w.replies=[];window.addEventListener('message',e=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(e.data?.type))w.replies.push(e.data);});registry.register({id:'corrupt',version:1,mode:'files',supports:()=>true,prepare:()=>({kind:'files',files:[new File(['not a decoded image'],'bad.png',{type:'image/png'})],validated:true})});const request=P.createRequest({id:'bad-output',filename:'source.mp4'}),output=await registry.prepare('corrupt',request,new File(['source'],'source.mp4'));const f=output.files[0];window.postMessage({type:'WARPDIFF_LOAD',requestId:output.requestId,files:[{name:f.name,contentType:f.type,buffer:await f.arrayBuffer()}]},location.origin);});
  await expect.poll(()=>page.evaluate(()=>(window as any).replies)).toEqual([expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'bad-output'})]);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('clear cancels an adapter and ignores completion from retired work',async({page})=>{
  const result=await page.evaluate(async()=>{const w=window as any,P=w.eval('WarpMediaPreparation'),registry=w.eval('_mediaPreparationProviders');let finish:any,signal:any;registry.register({id:'delayed',version:1,mode:'files',supports:()=>true,prepare(req:any,ctx:any){signal=ctx.signal;return new Promise(resolve=>finish=resolve);}});const pending=registry.prepare('delayed',P.createRequest({id:'stale',filename:'source.mp4'}),new File(['source'],'source.mp4')).then(()=>false,(e:any)=>e.name==='AbortError');await Promise.resolve();w.clearAllMedia();const cancelled=await pending;finish({kind:'files',files:[new File(['late'],'late.mp4')]});await Promise.resolve();return {cancelled,aborted:signal.aborted,media:w.eval('Object.keys(mediaData).filter(slot=>mediaData[slot])'),commands:w.eval('Object.keys(_ffmpegCommands)')};});
  expect(result).toEqual({cancelled:true,aborted:true,media:[],commands:[]});
});
