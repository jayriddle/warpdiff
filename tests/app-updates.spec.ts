import {test, expect, Page} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';

// Real HTTP cache, service worker, workers and worklets. No request routing or retries.
test.use({serviceWorkers:'allow'});
const root = path.join(__dirname, '..');
const version=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/const APP_VERSION = '([^']+)'/)![1];
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const stageScript = `import {stagePages} from './scripts/stage-pages.mjs'; stagePages({root:process.argv[1],output:process.argv[2],sha:process.argv[3]});`;
async function fixture(probes = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-updates-'));
  const source = path.join(directory, 'source'); fs.mkdirSync(source);
  const files:string[] = JSON.parse(execFileSync('node', ['--input-type=module', '-e',
    "import {pageFiles} from './scripts/stage-pages.mjs'; console.log(JSON.stringify(pageFiles(process.cwd())))"], {cwd:root}).toString());
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(source,file)), {recursive:true}); fs.copyFileSync(path.join(root,file),path.join(source,file)); }
  execFileSync('git',['init','-q'],{cwd:source}); execFileSync('git',['add','.'],{cwd:source});
  const stages:Record<string,string> = {};
  for (const sha of [A,B,C]) {
    for (const file of ['js/timecode.js','js/audio-viz.js','js/audio-analysis-worker.js','js/scrub-worklet.js']) {
      let content = fs.readFileSync(path.join(root,file),'utf8');
      if (probes && file === 'js/timecode.js') content += `\nglobalThis._fixtureRelease = '${sha}';\n`;
      if (probes && file === 'js/audio-viz.js') content += `\nglobalThis._fixtureAlgorithm = '${sha}';\n`;
      if (probes && file === 'js/audio-analysis-worker.js') content += `\npostMessage({release:'${sha}',algorithm:globalThis._fixtureAlgorithm});\n`;
      if (probes && file === 'js/scrub-worklet.js') content += `\nregisterProcessor('release-${sha}', class extends AudioWorkletProcessor {process(){return false;}});\n`;
      fs.writeFileSync(path.join(source,file),content);
    }
    const output = stages[sha] = path.join(directory,sha);
    execFileSync('node',['--input-type=module','-e',stageScript,source,output,sha],{cwd:root});
  }
  let revision = A, broken = '', mismatch = false, network = true, legacy = false;
  let replacement = '', manifestControl = false;
  const requests:{url:string,revision:string}[] = [];
  const server = http.createServer((req,res) => {
    const url = new URL(req.url!, 'http://localhost'); requests.push({url:url.pathname,revision});
    if (!network || (broken && url.pathname.endsWith(broken))) {req.socket.destroy();return;}
    if (url.pathname === '/host.html') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Managed host</title>');return;}
    const mount = ['/app/', '/warpdiff/', '/sibling/'].find(prefix=>url.pathname.startsWith(prefix));
    if (!mount) {res.writeHead(404);res.end();return;}
    const relative = url.pathname.slice(mount.length) || 'index.html';
    if (relative === 'media.png') {res.writeHead(200,{'Content-Type':'image/png'});res.end(fs.readFileSync(path.join(root,'tests/fixtures/red.png')));return;}
    const file = path.resolve(stages[revision], relative);
    if (!file.startsWith(stages[revision]+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
    const ext = path.extname(file);
    const mime:Record<string,string>={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.txt':'text/plain'};
    res.writeHead(200,{'Content-Type':mime[ext] || 'application/octet-stream',
      'Cache-Control':relative === 'index.html' || relative === 'sw.js' ? 'no-cache' : 'public,max-age=600'});
    let content:Buffer|string=fs.readFileSync(file);
    if (manifestControl && relative === 'index.html') content='<!doctype html><link rel="manifest" href="manifest.json"><title>Released manifest</title>';
    if (legacy && relative === 'index.html') content=fs.readFileSync(path.join(root,'index.html'),'utf8')
      .replace('<script src="js/app-updates.js"></script>', '<script>globalThis._appBackgroundScriptUrl=file=>file;</script>')
      .replace('_registerAppServiceWorker();', "navigator.serviceWorker.register('sw.js');")
      .replace('const APP_VERSION = ', "globalThis._fixtureHtml = '"+revision+"'; const APP_VERSION = ");
    if (legacy && relative === 'sw.js') content=legacyWorker();
    res.end(mismatch && relative.endsWith('/js/timecode.js') ? 'globalThis.WRONG_RELEASE = true;' : content);
    if (replacement && relative === 'index.html') {revision=replacement;replacement='';}
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/app/`;
  return {url,directory,requests,stages,server,
    set:(next:string,fail='',wrong=false)=>{revision=next;broken=fail;mismatch=wrong;},
    replaceAfterDocument:(next:string)=>{replacement=next;},
    manifestControl:(enabled:boolean)=>{manifestControl=enabled;},
    legacy:()=>{legacy=true;}, modern:()=>{legacy=false;},
    offline:()=>{network=false;}, online:()=>{network=true;},
    close:async()=>{const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed;fs.rmSync(directory,{recursive:true,force:true});}};
}
// Frozen predecessor policy: stable URLs, default HTTP-cache fetch, network-first writes.
// This negative control reproduces the risk rather than asking a fixed implementation to fail.
function legacyWorker() {
  const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const assets=source.slice(source.indexOf('const ASSETS'),source.indexOf('const SCOPE'));
  return `const CACHE_NAME='warpdiff-v3.19.3';${assets}
    const urls=new Set(ASSETS.map(a=>new URL(a,self.registration.scope).href));
    self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
    self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});
    self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!urls.has(e.request.url))return;
      e.respondWith(fetch(e.request).then(r=>{if(r.ok&&r.type==='basic'){const c=r.clone();e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(e.request,c)));}return r;}).catch(()=>caches.match(e.request)));});`;
}

async function installed(page:Page, sha:string) {
  await page.waitForFunction(sha => (window as any)._fixtureRelease === sha, sha);
  await expect.poll(()=>page.evaluate(async sha => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.active?.state !== 'activated' || navigator.serviceWorker.controller?.state !== 'activated') return false;
    if (registration.installing) return false;
    return await new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>resolve(false),2000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data.sha===sha);};navigator.serviceWorker.controller!.postMessage({type:'WARPDIFF_RELEASE_QUERY'},[channel.port2]);});
  },sha),{timeout:10000}).toBe(true);
}
async function backgroundFiles(page:Page, sha:string) {
  const result = await page.evaluate(async sha => {
    const worker = new Worker((window as any)._appBackgroundScriptUrl('js/audio-analysis-worker.js'));
    const message = await new Promise(resolve=>{worker.onmessage=event=>resolve(event.data);worker.onerror=()=>resolve(null);});
    worker.terminate();
    const ctx = new AudioContext();
    try {await ctx.audioWorklet.addModule((window as any)._appBackgroundScriptUrl('js/scrub-worklet.js')); const node=new AudioWorkletNode(ctx,'release-'+sha);node.disconnect();}
    finally {await ctx.close();}
    return message;
  },sha);
  expect(result).toEqual({release:sha,algorithm:sha});
}

test('warmed updates keep open comparisons and lazy audio files on their own release', async ({page,context}) => {
  const f=await fixture(); const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(f.url+'?appearance=old'); await installed(page,A);
    await page.locator('#multiFileInput').setInputFiles(path.join(root,'tests/fixtures/red.png'));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    f.set(B);
    const next=await context.newPage();await next.goto(f.url+'?appearance=new');await installed(next,B);
    // New controller must neither reload the old page nor move its base URL.
    expect(await page.evaluate(()=>({sha:(window as any)._fixtureRelease,base:document.baseURI}))).toEqual({sha:A,base:f.url+'releases/'+A+'/'});
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    f.offline();
    const inspect=async (p:Page)=>await p.evaluate(async()=>({base:document.baseURI,files:await Promise.all((await caches.keys()).map(async name=>({name,urls:(await(await caches.open(name)).keys()).map(r=>r.url)})))}));
    fs.writeFileSync(test.info().outputPath('before-offline.json'),JSON.stringify({old:await inspect(page),next:await inspect(next)},null,2));
    expect(await page.evaluate(async()=>await(await fetch('js/timecode.js')).text())).toContain(A);
    expect(await next.evaluate(async()=>await(await fetch('js/timecode.js')).text())).toContain(B);
    try {await backgroundFiles(page,A); await backgroundFiles(next,B);} catch(error) {
      fs.writeFileSync(test.info().outputPath('failed-offline.json'),JSON.stringify({old:await inspect(page),next:await inspect(next),requests:f.requests},null,2));throw error;
    }
    await next.reload();await expect(next.locator('#appVersion')).toHaveText('v'+version+' · '+B.slice(0,7));
    await next.goto(f.url+'index.html?usageTest=1'); await installed(next,B);
    expect(await next.evaluate(()=>[...document.scripts].filter(s=>s.src).every(s=>s.src.includes('/releases/'+(window as any)._fixtureRelease+'/')))).toBe(true);
    f.online();await page.close();
    await next.evaluate(()=>navigator.serviceWorker.controller!.postMessage({type:'WARPDIFF_RELEASE_CLEANUP',sha:'b'.repeat(40)}));
    await expect.poll(()=>next.evaluate(async()=> (await caches.keys()).some(n=>n.includes('-'+'a'.repeat(40)+'-')))).toBe(false);
    await expect.poll(()=>next.evaluate(async()=> (await caches.keys()).some(n=>n.includes('-'+'b'.repeat(40)+'-')))).toBe(true);
    expect(errors).toEqual([]);await next.close();
  } finally {if(!page.isClosed())await page.goto('about:blank');await f.close();}
});

test('incomplete and wrong-byte updates preserve the previous complete offline bundle', async ({page}) => {
  const f=await fixture();
  try {
    await page.goto(f.url);await installed(page,A);
    await page.evaluate(async()=>{await (await caches.open('host-cache')).put('/keep',new Response('keep'));});
    f.set(B,'/js/preferences.js');
    await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())!.update();});
    await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.installing)).toBe(false);
    expect(await page.evaluate(async()=> (await caches.keys()).some(n=>n.includes('-'+'b'.repeat(40)+'-')))).toBe(false);
    f.set(C,'',true);
    await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())!.update();});
    await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.installing)).toBe(false);
    expect(await page.evaluate(async()=> (await caches.keys()).some(n=>n.includes('-'+'c'.repeat(40)+'-')))).toBe(false);
    f.offline();await page.reload();await installed(page,A);await backgroundFiles(page,A);
    expect(await page.evaluate(async()=>await (await caches.match('/keep'))!.text())).toBe('keep');
  } finally {await page.goto('about:blank');await f.close();}
});

test('first-load script mismatch stops startup with a usable retry message', async ({page}) => {
  const f=await fixture();
  try {
    f.set(A,'',true);await page.goto(f.url);
    await expect(page.locator('#appUpdateFailure')).toContainText('could not load this update completely');
    expect(await page.evaluate(()=>typeof (window as any).__testAPI)).toBe('undefined');
    f.offline();await page.locator('#appUpdateFailure button').click();
    await expect(page.locator('#appUpdateFailure button')).toHaveText('Try again when online');
    await expect(page.locator('#appUpdateFailure button')).toBeEnabled();
    f.online();
    f.set(A,'/js/usage.js');
    // The click starts asynchronous refetches before reloading this same URL.
    // Observe that new document before evaluating its globals.
    const reloaded = page.waitForEvent('framenavigated', frame=>frame === page.mainFrame());
    await page.locator('#appUpdateFailure button').click();
    await reloaded;await page.waitForLoadState('load');
    await expect.poll(()=>page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).__testAPI)).toBe('object');
    await expect(page.locator('#appUpdateFailure')).toHaveCount(0);
  } finally {await page.goto('about:blank');await f.close();}
});

for (const predecessor of [false,true]) test('recovery navigates to the available release after the original directory disappears'+(predecessor?' with a predecessor controller':''), async ({page,context}) => {
  const f=await fixture();
  let legacyPage:Page|null=null;
  try {
    // The predecessor case must use the exact cacheable stable URL. The other
    // case independently verifies that recovery preserves query and fragment.
    const url=predecessor?f.url:f.url+'?recover=deployment#preserve';
    if (predecessor) {
      legacyPage=await context.newPage();
      f.legacy();await legacyPage.goto(f.url);await legacyPage.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await expect.poll(()=>legacyPage!.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
      // A current worker conservatively retains this unknown legacy client's
      // stable document cache. A non-navigation lookup must bypass that cache.
      f.modern();f.set(C);await page.goto(f.url+'?installed-predecessor=1');await installed(page,C);
      f.set(A);
    }
    f.replaceAfterDocument(B);await page.goto(url);
    await expect(page.locator('#appUpdateFailure')).toBeVisible();
    expect(await page.evaluate(()=>({sha:document.querySelector<HTMLMetaElement>('meta[name="warpdiff-release"]')!.content,
      startup:typeof (window as any).__testAPI,controlled:!!navigator.serviceWorker.controller})))
      .toEqual({sha:A,startup:'undefined',controlled:predecessor});
    f.set(B,'/js/usage.js');
    const before=f.requests.length;
    const prefetched:string[]=[];
    let navigated=false;
    page.on('request',request=>{
      if (request.isNavigationRequest() && request.frame()===page.mainFrame()) navigated=true;
      else if (!navigated) prefetched.push(request.url());
    });
    const reloaded=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame(),timeout:10000});
    await page.locator('#appUpdateFailure button').click();
    await reloaded;await page.waitForLoadState('load');
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).__testAPI)).toBe('object');
    await expect.poll(()=>page.evaluate(()=>(window as any)._fixtureRelease)).toBe(B);
    expect(page.url()).toBe(url);
    await expect(page.locator('#appUpdateFailure')).toHaveCount(0);
    expect(prefetched.some(url=>url.endsWith('/releases/'+B+'/js/timecode.js'))).toBe(true);
    expect(f.requests.slice(before).some(request=>request.url==='/app/')).toBe(true);
    expect(f.requests.slice(before).some(request=>request.url.includes('/releases/'+A+'/js/'))).toBe(false);
    await page.locator('#multiFileInput').setInputFiles(path.join(root,'tests/fixtures/red.png'));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  } finally {await legacyPage?.close();await page.goto('about:blank');await f.close();}
});

test('manifest retains released identity at distinct app subpaths', async ({browser,browserName}) => {
  const f=await fixture(false);
  const identities:string[]=[];
  try {
    for (const mount of ['/warpdiff/','/sibling/']) {
      const context=await browser.newContext({serviceWorkers:'block'});
      try {
        const page=await context.newPage();
        const url=new URL(mount,f.url).href;
        f.manifestControl(true);await page.goto(url);
        const cdp=browserName==='chromium'?await context.newCDPSession(page):null;
        const baseline=cdp?await cdp.send('Page.getAppManifest'):null;
        if (baseline) expect((baseline as any).manifest.id).toBe(url);
        f.manifestControl(false);await page.goto(url);
        await expect.poll(()=>page.evaluate(()=>typeof (window as any).__testAPI)).toBe('object');
        const manifest=await page.evaluate(async()=>{
          const url=document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
          return {url,value:await(await fetch(url)).json()};
        });
        if (cdp) {
          const processed=(await cdp.send('Page.getAppManifest') as any).manifest;
          expect(processed.id).toBe((baseline as any).manifest.id);
          expect(processed.startUrl).toBe(url);expect(processed.scope).toBe(url);
          identities.push(processed.id);
        }
        expect(manifest.value).not.toHaveProperty('id');
        expect(new URL(manifest.value.start_url,manifest.url).href).toBe(url);
        expect(new URL(manifest.value.scope,manifest.url).href).toBe(url);
      } finally {await context.close();}
    }
    if (browserName==='chromium') expect(new Set(identities).size).toBe(2);
  } finally {await f.close();}
});

test('managed iframe uses the pinned release without registering a service worker', async ({page}) => {
  const f=await fixture();
  try {
    await page.goto(new URL('../host.html',f.url).href);
    await page.setContent('<iframe src="'+f.url+'?managed=1"></iframe>');
    await expect.poll(()=>page.frames().some(frame=>frame.url().includes('?managed=1'))).toBe(true);
    const frame=page.frames().find(frame=>frame.url().includes('?managed=1'))!;
    await expect.poll(()=>frame.evaluate(()=> (window as any)._fixtureRelease)).toBe(A);
    expect(await frame.evaluate(()=>navigator.serviceWorker.getRegistrations().then(r=>r.length))).toBe(0);
    f.set(B);f.offline();await backgroundFiles(frame as any,A);
    f.online();
    await page.evaluate(()=>{(window as any).hostReplies=[];window.addEventListener('message',event=>{if(/^WARPDIFF_LOAD_(READY|FAILED)$/.test(event.data?.type))(window as any).hostReplies.push(event.data);});document.querySelector('iframe')!.contentWindow!.postMessage({type:'WARPDIFF_LOAD',requestId:'relative-input',capabilities:{managedReview:true},slotLabels:['','Candidate'],signedItems:[{name:'relative.png',contentType:'image/png',signedUrl:'media.png'}]},location.origin);});
    await expect.poll(()=>page.evaluate(()=>(window as any).hostReplies)).toEqual([expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'relative-input'})]);
  } finally {await page.goto('about:blank');await f.close();}
});

test('predecessor negative control reproduces warm HTTP-cache mixing', async ({page}) => {
  const f=await fixture();
  try {
    f.legacy();await page.goto(f.url);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await expect.poll(()=>page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
    f.set(B);await page.goto(f.url+'?fresh-document=1');
    expect(await page.evaluate(()=>(window as any)._fixtureHtml)).toBe(B);
    expect(await page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
  } finally {await page.goto('about:blank');await f.close();}
});

test('a warmed legacy tab survives the first release-pinned upgrade', async ({page,context}) => {
  const f=await fixture();
  try {
    f.legacy();await page.goto(f.url);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await expect.poll(()=>page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
    f.modern();f.set(B);const next=await context.newPage();await next.goto(f.url+'?first-upgrade=1');await installed(next,B);
    expect(await page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
    f.offline();await next.reload();await installed(next,B);await backgroundFiles(next,B);
    expect(await page.evaluate(async()=> (await caches.keys()).includes('warpdiff-v3.19.3'))).toBe(true);
    await next.close();
  } finally {await page.goto('about:blank');await f.close();}
});

test('exact candidate packaging analyses audio and loads both canonical worklets offline',async({page})=>{
  const f=await fixture(false);
  try {
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'serviceWorker',{configurable:true,get(){throw new DOMException('Storage policy blocks service workers','SecurityError');}}));
    await page.goto(f.url);
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).__testAPI)).toBe('object');
    f.offline();
    const result=await page.evaluate(async()=>{
      const w=window as any;
      const buffer=new AudioBuffer({length:48000,sampleRate:48000,numberOfChannels:2});
      for(let ch=0;ch<2;ch++)for(let i=0;i<buffer.length;i++)buffer.getChannelData(ch)[i]=Math.sin(i*.04)*.25;
      const expected={waveform:w.computeWaveformData(buffer,128),spectrogram:w.computeSpectrogramData(buffer),metrics:w.computeAudioMetrics(buffer)};
      const originals=[w.computeWaveformData,w.computeSpectrogramData,w.computeAudioMetrics];
      let foregroundCalls=0;
      const forbidden=()=>{foregroundCalls++;throw Error('Exact-package worker check must not use foreground analysis');};
      let actual;
      try {
        w.computeWaveformData=w.computeSpectrogramData=w.computeAudioMetrics=forbidden;
        actual=await w._computeAudioAnalysis(buffer,128);
      } finally {[w.computeWaveformData,w.computeSpectrogramData,w.computeAudioMetrics]=originals;}
      const NativeWorker=w.Worker;
      let blockedWorkerAttempts=0;
      let fallback;
      try {
        w.Worker=class {constructor(){blockedWorkerAttempts++;throw Error('Verify intentional foreground compatibility');}};
        fallback=await w._computeAudioAnalysis(buffer,128);
      } finally {w.Worker=NativeWorker;}
      const ctx=new AudioContext();
      try {
        await ctx.audioWorklet.addModule(w._appBackgroundScriptUrl('js/scrub-worklet.js'));
        const scrub=new AudioWorkletNode(ctx,'phase-vocoder-processor');scrub.disconnect();
        await ctx.audioWorklet.addModule(w._appBackgroundScriptUrl('js/signalsmith-worklet.js'));
      } finally {await ctx.close();}
      // Compare every returned sample/field here. Sending three multi-megabyte
      // analyses through the browser protocol made this check time out in CI.
      let comparedValues=0;
      const difference=(a:any,b:any,path='analysis'):string|null=>{
        if(Object.is(a,b)){comparedValues++;return null;}
        if(ArrayBuffer.isView(a)||ArrayBuffer.isView(b)){
          if(!ArrayBuffer.isView(a)||!ArrayBuffer.isView(b)||a.constructor.name!==b.constructor.name||a.byteLength!==b.byteLength)return path+' type/length';
          for(let i=0;i<(a as any).length;i++){comparedValues++;if(!Object.is((a as any)[i],(b as any)[i]))return path+'['+i+']';}
          return null;
        }
        if(a&&b&&typeof a==='object'&&typeof b==='object'){
          if(Array.isArray(a)!==Array.isArray(b))return path+' type';
          const keys=Object.keys(a);if(keys.length!==Object.keys(b).length)return path+' keys';
          for(const key of keys){if(!Object.hasOwn(b,key))return path+'.'+key;const mismatch=difference(a[key],b[key],path+'.'+key);if(mismatch)return mismatch;}
          return null;
        }
        return path;
      };
      const workerDifference=difference(actual,expected),fallbackDifference=difference(fallback,expected);
      return {workerDifference,fallbackDifference,comparedValues,foregroundCalls,blockedWorkerAttempts,
        sha:document.querySelector<HTMLMetaElement>('meta[name="warpdiff-release"]')!.content};
    });
    expect(result.workerDifference).toBeNull();expect(result.fallbackDifference).toBeNull();expect(result.comparedValues).toBeGreaterThan(0);
    expect(result.foregroundCalls).toBe(0);expect(result.blockedWorkerAttempts).toBe(1);
    expect(result.sha).toBe(A);expect(errors).toEqual([]);
    expect(JSON.stringify(result).length).toBeLessThan(4096);
    await test.info().attach('analysis-parity',{body:Buffer.from(JSON.stringify(result)),contentType:'application/json'});
  } finally {await page.goto('about:blank');await f.close();}
});
