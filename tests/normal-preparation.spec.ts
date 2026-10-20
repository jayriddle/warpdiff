import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {launchCompanion} from './helpers/companion-process';

test.use({serviceWorkers:'block',ignoreHTTPSErrors:true});
let helper:any,directory:string,server:https.Server,appOrigin:string;
const sockets=new Set<any>();
const root=path.resolve(__dirname,'..'),fixture=(name:string)=>path.join(__dirname,'fixtures',name);
const own=(name:string)=>path.join(directory,name);
test.beforeAll(async()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'warpdiff-normal-preparation-'));
  helper=await launchCompanion();
  const run=(args:string[])=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n',...args],{timeout:30000});
  run(['-i',fixture('landscape_a.mp4'),'-t','0.5','-c:v','copy','-c:a','dca','-strict','-2',own('dts_video.mp4')]);
  run(['-i',fixture('landscape_a.mp4'),'-t','0.5','-vf','scale=160:90,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','flac',own('ffv1.mkv')]);
  run(['-i',fixture('stereo.wav'),'-t','0.5','-c:a','dca','-strict','-2',own('audio.dts')]);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',own('key.pem'),'-out',own('cert.pem'),'-subj','/CN=127.0.0.1','-days','1'],{stdio:'pipe'});
  const allowed:string[]=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {pageFiles} from './scripts/stage-pages.mjs'; console.log(JSON.stringify(pageFiles(process.cwd())))"],{cwd:root}).toString());
  server=https.createServer({key:fs.readFileSync(own('key.pem')),cert:fs.readFileSync(own('cert.pem'))},(req,res)=>{
    const name=new URL(req.url!,'https://localhost').pathname.slice(1)||'index.html';
    if(name==='wrong-origin'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Controlled other origin</title>');return;}
    if(!allowed.includes(name)){res.writeHead(404);res.end();return;}
    const types:any={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.txt':'text/plain'};
    res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,name)));
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));appOrigin='https://127.0.0.1:'+(server.address() as any).port;
});
test.afterAll(async()=>{await helper?.close();for(const socket of sockets)socket.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));if(directory)fs.rmSync(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lastSeenVersion','999.0.0');const w=window as any;w.preparationErrors=[];
    addEventListener('error',e=>w.preparationErrors.push(e.message));addEventListener('unhandledrejection',e=>w.preparationErrors.push(String(e.reason)));
    const open=window.open;window.open=function(...args:any[]){w.lastConnectionUrl=args[0];const child=open.apply(window,args as any);w.lastConnectionPopup=child;return child;};});
  await page.goto(appOrigin);
});
test.afterEach(async({page})=>{
  await page.evaluate(()=>{(window as any).clearAllMedia();(window as any).eval('_localPreparationConnection.disconnect()');});
  expect(await page.evaluate(()=>(window as any).preparationErrors)).toEqual([]);
});
async function connect(page:any,origin=helper.origin,approve=true){
  if(!await page.locator('#localPreparationDialog').isVisible())await page.locator('#preparationBtn').click();
  await page.locator('#localPreparationAddress').fill(origin);
  const opening=page.waitForEvent('popup');await page.locator('#localPreparationConnect').click();const popup=await opening;
  await expect(popup.locator('#allow')).toBeEnabled();
  if(approve){await popup.locator('#allow').click();await expect(page.locator('#localPreparationDisconnect')).toBeVisible();}
  return popup;
}
const names=(page:any)=>page.evaluate(()=>(window as any).eval('assetOrder.filter(s=>mediaData[s]).map(s=>mediaData[s].name)'));
async function openIssue(page:any,file=own('dts_video.mp4')){
  await page.locator('#multiFileInput').setInputFiles(file);await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed',{timeout:45000});await expect(page.locator('#localPreparationDialog')).not.toBeVisible();await page.locator('#preparationBtn').click();await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await expect(page.locator('#localPreparationFiles li')).toHaveCount(1);
}
async function opened(page:any,filename:string){
  await expect.poll(()=>names(page),{timeout:45000}).toContain(filename);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/,{timeout:45000});
  await expect.poll(()=>page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA?.capabilities.decodedAnalysis.state),{timeout:45000}).toBe('available');
}

test('ordinary loading does not discover, connect or prepare and keeps the normal app chrome',async({page,context})=>{
  const requests:string[]=[];context.on('request',r=>{if(r.url().startsWith(helper.origin))requests.push(r.url());});
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_a.mp4'));await opened(page,'landscape_a.mp4');
  expect(requests).toEqual([]);expect(context.pages()).toHaveLength(1);
  await expect(page.locator('#localPreparationDialog')).not.toBeVisible();await expect(page.locator('#loadBtn')).toBeVisible();
  expect(await page.evaluate(()=>document.body.classList.contains('managed-review'))).toBe(false);
});

test('helper landing opens the normal app with an explicit prefilled connection',async({page})=>{
  await page.goto(helper.origin);await page.getByRole('link',{name:'Open WarpDiff on this computer',exact:true}).click();
  await expect(page.locator('#localPreparationDialog')).toBeVisible();await expect(page.locator('#localPreparationAddress')).toHaveValue(helper.origin);
  expect(await page.locator('iframe').count()).toBe(0);await expect(page.locator('#loadBtn')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).eval('_localPreparationConnection.state().connected'))).toBe(false);
});

for(const key of ['preparation','%70reparation'])test('helper prefill removes only '+key+' and preserves other fragments',async({page})=>{
  await page.goto(appOrigin+'/?retained=query#frame=12&'+key+'='+encodeURIComponent(helper.origin)+'&note=a%20b');
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await expect(page.locator('#localPreparationAddress')).toHaveValue(helper.origin);
  expect(new URL(page.url()).hash).toBe('#frame=12&note=a%20b');
  expect(new URL(page.url()).search).toBe('?retained=query');
});

test('secure normal app connects explicitly across origins without sending a file for approval',async({page,context})=>{
  const calls:string[]=[];context.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
  await openIssue(page);const popup=await connect(page,helper.origin,false);
  expect(await page.evaluate(()=>isSecureContext)).toBe(true);expect(new URL(popup.url()).origin).not.toBe(appOrigin);
  await expect(page.locator('#localPreparationRun')).toBeDisabled();expect(calls).toEqual([]);
  await popup.locator('#allow').click();await expect(page.locator('#localPreparationRun')).toBeEnabled();expect(calls).toEqual([]);
  await page.locator('#localPreparationRun').click();await opened(page,'dts_video_review.mp4');
  expect(calls.filter(url=>url.endsWith('/api/prepare'))).toHaveLength(1);
  await expect(page.locator('#ffmpegPanel')).not.toBeVisible();await expect(page.locator('#preparedImportDialog')).not.toBeVisible();
  expect(await page.evaluate(()=>(window as any).WarpDiffHostAPI.readMediaInputReports().editA.admission.preparedProfile)).toBe('not-validated');
});

for(const filename of ['ffv1.mkv','audio.dts'])test(`${filename} prepares and opens through normal admission without a second picker`,async({page})=>{
  await connect(page);await page.locator('#localPreparationClose').click();await openIssue(page,own(filename));
  let pickers=0;page.on('filechooser',()=>pickers++);
  await page.locator('#localPreparationRun').click();await opened(page,filename==='audio.dts'?'audio_review.wav':'ffv1_review.mp4');expect(pickers).toBe(0);
});

test('preparation preserves companion files, timestamp-established slot order and normal usage mode',async({page})=>{
  await connect(page);await page.locator('#localPreparationClose').click();
  await page.locator('#multiFileInput').setInputFiles([fixture('red.png'),own('dts_video.mp4')]);
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed',{timeout:45000});await page.locator('#preparationBtn').click();const before=await names(page);
  await page.locator('#localPreparationRun').click();await expect.poll(()=>names(page),{timeout:45000}).toEqual(before.map((n:string)=>n==='dts_video.mp4'?'dts_video_review.mp4':n));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);expect(await page.evaluate(()=>(window as any).eval('_ihwaMode'))).toBe(false);
});

test('cancel retires native work; invalid replacement does not clear it; later files cannot be overwritten',async({page})=>{
  const delayed=await launchCompanion('delayed');
  try{
    await connect(page,delayed.origin);await page.locator('#localPreparationClose').click();await openIssue(page);await page.locator('#localPreparationRun').click();
    await expect.poll(()=>delayed.state().started).toBe(true);
    await page.locator('#multiFileInput').setInputFiles([fixture('green.png'),fixture('stereo.wav')]);
    expect(delayed.state().retired).toBe(false);await expect(page.locator('#localPreparationStatus')).toContainText('Preparing review copies');
    await page.locator('#localPreparationClose').click();await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));
    await expect.poll(()=>delayed.state().retired).toBe(true);await expect.poll(()=>names(page)).toEqual(['green.png']);
    await expect(page.locator('#localPreparationDialog')).not.toBeVisible();await page.waitForTimeout(200);expect(await names(page)).toEqual(['green.png']);
  }finally{await delayed.close();}
});

test('closing the connection during preparation cancels it and retains the source',async({page})=>{
  const delayed=await launchCompanion('delayed');
  try{
    const popup=await connect(page,delayed.origin);await page.locator('#localPreparationClose').click();await openIssue(page);await page.locator('#localPreparationRun').click();
    await expect.poll(()=>delayed.state().started).toBe(true);await popup.close();await expect.poll(()=>delayed.state().retired).toBe(true);
    await expect(page.locator('#localPreparationStatus')).toContainText('unchanged');expect(await names(page)).toEqual(['dts_video.mp4']);
    await expect(page.locator('#localPreparationRun')).toBeDisabled();
  }finally{await delayed.close();}
});

test('a corrupt prepared return fails normal loading and never announces READY to a host',async({page})=>{
  const corrupt=await launchCompanion('corrupt');
  try{
    await page.evaluate(()=>{const w=window as any;w.hostReady=[];addEventListener('message',e=>{if(e.data?.type==='WARPDIFF_LOAD_READY')w.hostReady.push(e.data);});});
    await connect(page,corrupt.origin);await page.locator('#localPreparationClose').click();await openIssue(page);await page.locator('#localPreparationRun').click();
    await expect(page.locator('#localPreparationStatus')).toContainText('unchanged',{timeout:45000});
    expect(await names(page)).toEqual(['dts_video.mp4']);await expect(page.locator('#localPreparationRun')).toBeEnabled();expect(await page.evaluate(()=>(window as any).hostReady)).toEqual([]);
  }finally{await corrupt.close();}
});

test('connection addresses are restricted and blocked popups fail without disturbing the comparison',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  const rejected=await page.evaluate(()=>['https://example.com','http://localhost:1234','http://127.0.0.1:1234/private','http://user:pass@127.0.0.1:1234','http://127.0.0.1:1234/?x=1'].map(value=>{try{(window as any).eval('WarpPreparationConnection').address(value);return false;}catch{return true;}}));expect(rejected).toEqual([true,true,true,true,true]);
  await page.locator('#preparationBtn').click();await page.locator('#localPreparationAddress').fill(helper.origin);
  await page.evaluate(()=>{window.open=()=>null;});await page.locator('#localPreparationConnect').click();
  await expect(page.locator('#localPreparationStatus')).toContainText('Allow the connection window');expect(await names(page)).toEqual(['green.png']);
});

test('wrong-window and wrong-origin handshakes cannot grant a connection',async({page,context})=>{
  // Freeze the legitimate popup before its HELLO. Navigating the real bridge
  // after port transfer correctly disconnects/closes it and cannot test this.
  await context.route(helper.origin+'/connect.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Controlled pending handshake</title><script>addEventListener("message",event=>{if(event.ports[0])event.ports[0].postMessage({type:"ready"})})</script>'}));
  await page.locator('#preparationBtn').click();await page.locator('#localPreparationAddress').fill(helper.origin);
  const opening=page.waitForEvent('popup');await page.locator('#localPreparationConnect').click();const popup=await opening;
  const nonce=await page.evaluate(()=>new URLSearchParams(new URL((window as any).lastConnectionUrl).hash.slice(1)).get('id'));
  await page.evaluate(()=>{(window as any).pinnedConnectionPopup=(window as any).lastConnectionPopup;});
  const attackerOpening=page.waitForEvent('popup');await page.evaluate(url=>window.open(url),helper.origin);const attacker=await attackerOpening;
  await attacker.waitForLoadState('load');
  await attacker.evaluate(({origin,id}:any)=>window.opener.postMessage({type:'WARPDIFF_PREPARATION_HELLO',version:1,id},origin),{origin:appOrigin,id:nonce});
  await page.waitForTimeout(100);
  await expect(page.locator('#localPreparationDisconnect')).not.toBeVisible();
  // Browser navigation may clear opener. Inject the wrong-origin event with
  // the exact expected WindowProxy to exercise that guard independently.
  await page.evaluate(({origin,id}:any)=>window.dispatchEvent(new MessageEvent('message',{source:(window as any).pinnedConnectionPopup,origin,data:{type:'WARPDIFF_PREPARATION_HELLO',version:1,id}})),{origin:appOrigin,id:nonce});
  await page.waitForTimeout(100);
  await expect(page.locator('#localPreparationDisconnect')).not.toBeVisible();await attacker.close();await popup.close();
});

test('narrow preparation dialog keeps native keyboard focus and exposes the main action',async({page})=>{
  await page.setViewportSize({width:390,height:650});await openIssue(page);await connect(page);
  await page.locator('#localPreparationRun').scrollIntoViewIfNeeded();
  const box=(await page.locator('#localPreparationRun').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.locator('#localPreparationRun').focus();await page.keyboard.press('Tab');await expect(page.locator('#localPreparationClose')).toBeFocused();
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.getElementById('localPreparationDialog')!.contains(document.activeElement))).toBe(true);
  await page.locator('#localPreparationRun').focus();await page.keyboard.press('Enter');await opened(page,'dts_video_review.mp4');
});

test('managed host entry disconnects preparation and cannot inherit standalone file authority',async({page})=>{
  const popup=await connect(page);await page.locator('#localPreparationClose').click();
  await page.evaluate(()=>window.postMessage({type:'WARPDIFF_LOAD',requestId:'managed-entry',capabilities:{managedReview:true},error:'controlled host entry'},location.origin));
  await expect(page.locator('body')).toHaveClass(/managed-review/);await expect(page.locator('#preparationBtn')).not.toBeVisible();
  await expect.poll(()=>popup.isClosed()).toBe(true);await expect(page.locator('#localPreparationDialog')).not.toBeVisible();
});

test('an untrusted opener cannot revive a rejected bridge launch',async({context})=>{
  const attacker=await context.newPage();
  try {
    await attacker.route('https://untrusted.example/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><button id="open">Open controlled connection</button>'}));
    await attacker.goto('https://untrusted.example/');
    const id='f'.repeat(32);
    await attacker.evaluate(({url,id})=>{document.getElementById('open')!.onclick=()=>{
      (window as any).child=window.open(url+'/connect.html#'+new URLSearchParams({id,origin:location.origin}));
    };},{url:helper.origin,id});
    const opening=attacker.waitForEvent('popup');await attacker.locator('#open').click();const popup=await opening;
    await expect(popup.locator('#status')).toHaveText('Open this connection window from WarpDiff.');
    await attacker.evaluate(({url,id})=>{const channel=new MessageChannel();(window as any).probe=channel.port1;
      (window as any).child.postMessage({type:'WARPDIFF_PREPARATION_CONNECT',version:1,id},url,[channel.port2]);
    },{url:helper.origin,id});
    await popup.waitForTimeout(100);await expect(popup.locator('#allow')).toBeDisabled();
    await expect(popup.locator('#status')).toHaveText('Open this connection window from WarpDiff.');await popup.close();
  } finally {await attacker.close();}
});

test('disconnect before approval is terminal even when a later CONNECT arrives',async({page})=>{
  const id='e'.repeat(32);
  const opening=page.waitForEvent('popup');
  await page.evaluate(({origin,id})=>{(window as any).latePopup=window.open(origin+'/connect.html#'+new URLSearchParams({id,origin:location.origin}));},{origin:helper.origin,id});
  const popup=await opening;await popup.waitForLoadState('load');
  const transfer=()=>page.evaluate(({origin,id})=>{const channel=new MessageChannel();(window as any).latePopup.postMessage({type:'WARPDIFF_PREPARATION_CONNECT',version:1,id},origin,[channel.port2]);},{origin:helper.origin,id});
  await transfer();await expect(popup.locator('#allow')).toBeEnabled();await popup.locator('#disconnect').click();
  await transfer();await popup.waitForTimeout(100);await expect(popup.locator('#allow')).toBeDisabled();await expect(popup.locator('#status')).toContainText('Disconnected');await popup.close();
});

test('preparation keyboard isolates typing, remapping and native Space from comparison controls',async({page})=>{
  await page.locator('#multiFileInput').setInputFiles(fixture('landscape_a.mp4'));await opened(page,'landscape_a.mp4');
  await page.locator('#appearanceButton').click();
  await page.evaluate(()=>{(window as any)._showLocalPreparation();(window as any).eval("_reassigningActionId='help'");});
  await expect(page.locator('#appearancePanel')).toBeHidden();await page.locator('#localPreparationAddress').focus();
  await page.keyboard.type('s wg');await expect(page.locator('#localPreparationAddress')).toHaveValue('s wg');
  expect(await page.evaluate(()=>(window as any).eval('_reassigningActionId'))).toBe('help');
  await page.evaluate(()=>(window as any).eval('_reassigningActionId=null'));
  await page.locator('#localPreparationClose').focus();await page.keyboard.press('Space');
  await expect(page.locator('#localPreparationDialog')).not.toBeVisible();
  expect(await page.locator('#layerEditA video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
});

test('native dialog.close cancels its job and restores its opener',async({page})=>{
  const delayed=await launchCompanion('delayed');
  try{
    await connect(page,delayed.origin);await page.locator('#localPreparationClose').click();await openIssue(page);await page.locator('#localPreparationRun').click();
    await expect.poll(()=>delayed.state().started).toBe(true);
    await page.evaluate(()=> (document.getElementById('localPreparationDialog') as HTMLDialogElement).close());
    await expect.poll(()=>delayed.state().retired).toBe(true);await expect(page.locator('#preparationBtn')).toBeFocused();
    expect(await names(page)).toEqual(['dts_video.mp4']);
  }finally{await delayed.close();}
});

test('local reload does not wait on optional analysis and can reopen the previous comparison',async({page})=>{
  await connect(page);await page.locator('#localPreparationClose').click();
  await page.locator('#multiFileInput').setInputFiles([fixture('red.png'),own('dts_video.mp4'),fixture('landscape_a.mp4')]);
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed',{timeout:45000});const previous=await names(page);
  await page.evaluate(()=>{
    const w=window as any;w.restoreAnalysis=w._computeAudioAnalysis;
    w.heldAnalysis=[];w._computeAudioAnalysis=()=>new Promise(resolve=>w.heldAnalysis.push(resolve));
  });
  await page.locator('#preparationBtn').click();await page.locator('#localPreparationRun').click();
  await expect.poll(()=>names(page),{timeout:45000}).toContain('dts_video_review.mp4');await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  expect(await page.evaluate(()=>(window as any).eval('_hostLoadRequest'))).toBeNull();
  await page.locator('#preparationBtn').click();await expect(page.locator('#localPreparationRestore')).toBeVisible();
  await page.evaluate(()=>{const w=window as any;w._computeAudioAnalysis=w.restoreAnalysis;});
  await page.locator('#localPreparationRestore').click();await expect.poll(()=>names(page)).toEqual(previous);
  await page.evaluate(()=>{const w=window as any;w.heldAnalysis.forEach(resolve=>resolve(null));});
});
