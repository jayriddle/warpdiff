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
  const requests:{url:string,revision:string}[] = [];
  const server = http.createServer((req,res) => {
    const url = new URL(req.url!, 'http://localhost'); requests.push({url:url.pathname,revision});
    if (!network || (broken && url.pathname.endsWith(broken))) {req.socket.destroy();return;}
    if (url.pathname === '/host.html') {res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Managed host</title>');return;}
    if (url.pathname === '/app/media.png') {res.writeHead(200,{'Content-Type':'image/png'});res.end(fs.readFileSync(path.join(root,'tests/fixtures/red.png')));return;}
    if (!url.pathname.startsWith('/app/')) {res.writeHead(404);res.end();return;}
    const relative = url.pathname.slice(5) || 'index.html';
    const file = path.resolve(stages[revision], relative);
    if (!file.startsWith(stages[revision]+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
    const ext = path.extname(file);
    const mime:Record<string,string>={'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.txt':'text/plain'};
    res.writeHead(200,{'Content-Type':mime[ext] || 'application/octet-stream',
      'Cache-Control':relative === 'index.html' || relative === 'sw.js' ? 'no-cache' : 'public,max-age=600'});
    let content:Buffer|string=fs.readFileSync(file);
    if (legacy && relative === 'index.html') content=fs.readFileSync(path.join(root,'index.html'),'utf8')
      .replace('<script src="js/app-updates.js"></script>', '<script>globalThis._appBackgroundScriptUrl=file=>file;</script>')
      .replace('_registerAppServiceWorker();', "navigator.serviceWorker.register('sw.js');")
      .replace('const APP_VERSION = ', "globalThis._fixtureHtml = '"+revision+"'; const APP_VERSION = ");
    if (legacy && relative === 'sw.js') content=legacyWorker();
    res.end(mismatch && relative.endsWith('/js/timecode.js') ? 'globalThis.WRONG_RELEASE = true;' : content);
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/app/`;
  return {url,directory,requests,stages,server,
    set:(next:string,fail='',wrong=false)=>{revision=next;broken=fail;mismatch=wrong;},
    legacy:()=>{legacy=true;}, modern:()=>{legacy=false;},
    offline:()=>{network=false;}, online:()=>{network=true;},
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(directory,{recursive:true,force:true});}};
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
    f.set(A,'/js/usage.js');await page.locator('#appUpdateFailure button').click();
    await expect.poll(()=>page.evaluate(()=>(window as any)._fixtureRelease)).toBe(A);
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).__testAPI)).toBe('object');
    await expect(page.locator('#appUpdateFailure')).toHaveCount(0);
  } finally {await page.goto('about:blank');await f.close();}
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
      const actual=await w._computeAudioAnalysis(buffer,128);
      const expected={waveform:w.computeWaveformData(buffer,128),spectrogram:w.computeSpectrogramData(buffer),metrics:w.computeAudioMetrics(buffer)};
      const ctx=new AudioContext();
      try {
        await ctx.audioWorklet.addModule(w._appBackgroundScriptUrl('js/scrub-worklet.js'));
        const scrub=new AudioWorkletNode(ctx,'phase-vocoder-processor');scrub.disconnect();
        await ctx.audioWorklet.addModule(w._appBackgroundScriptUrl('js/signalsmith-worklet.js'));
      } finally {await ctx.close();}
      const serialize=(value:any):any=>ArrayBuffer.isView(value)?Array.from(value as any):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serialize(v)])):value;
      return {actual:serialize(actual),expected:serialize(expected),sha:document.querySelector<HTMLMetaElement>('meta[name="warpdiff-release"]')!.content};
    });
    expect(result.actual).toEqual(result.expected);expect(result.sha).toBe(A);expect(errors).toEqual([]);
  } finally {await page.goto('about:blank');await f.close();}
});
