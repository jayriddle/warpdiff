import {test, expect} from '@playwright/test';
import {readFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const image64 = readFileSync(path.join(__dirname, 'fixtures/green.png')).toString('base64');
const orderImages = ['green.png','red.png','blue.png','fourth.png'].map(name =>
  ({name,base64:readFileSync(path.join(__dirname,'fixtures',name)).toString('base64')}));

// Route-based protocol probes must own their responses. An installed service
// worker can bypass page.route and turn a synthetic HTTP 200 into a real 404.
test.use({serviceWorkers:'block'});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.hostReplies = [];
    w.hostErrors = [];
    w.hostFallbacks = 0;
    addEventListener('message', event => {
      if (/^WARPDIFF_LOAD_(READY|FAILED)$/.test(event.data?.type)) w.hostReplies.push(event.data);
      if (event.data?.type === 'WARPDIFF_PULL_FALLBACK') w.hostFallbacks++;
    });
    addEventListener('error', event => w.hostErrors.push(event.message));
    addEventListener('unhandledrejection', event => w.hostErrors.push(String(event.reason)));
  });
  await page.goto('/');
});

for (const sender of ['same window', 'managed parent']) {
  for (const kind of ['empty signed image', 'empty signed video', 'empty signed audio',
    'corrupt supplied image', 'corrupt supplied video', 'corrupt supplied audio', 'corrupt signed image', 'invalid converted MIME']) {
    test(`${sender} rejects ${kind} with one terminal failure`, async ({page}) => {
      let served = 0;
      await page.route('**/rejected-host-media', route => {
        served++;
        return route.fulfill({status:200,body:kind.startsWith('empty') ? Buffer.alloc(0) : Buffer.from([1,2,3])});
      });
      if (sender === 'managed parent') {
        await page.route('**/media-host.html', route => route.fulfill({contentType:'text/html',
          body:'<!doctype html><iframe src="/"></iframe>'}));
        await page.goto('/media-host.html');
      }
      const app = sender === 'managed parent' ? page.frames().find(frame => frame.parentFrame())! : page;
      await app.waitForFunction(() => typeof (window as any).handleMultipleFiles === 'function');
      await page.evaluate(({kind, sender, base64}) => {
        const item = {name:'rejected.' + (kind.includes('video') ? 'mp4' : kind.includes('audio') ? 'wav' : 'png'),
          contentType:kind.includes('video') ? 'video/mp4' : kind.includes('audio') ? 'audio/wav' : 'image/png', buffer:[1,2,3]};
        // File normalizes this control-containing MIME to the empty string.
        if (kind === 'invalid converted MIME') item.contentType = 'image/png\n';
        const payload = kind.includes('signed') ? {signedItems:[{...item,signedUrl:'/rejected-host-media'}]}
          : {files:kind === 'invalid converted MIME' ? [{name:'valid.png',contentType:'image/png',base64},item] : [item]};
        const receiver = sender === 'managed parent' ? document.querySelector('iframe')!.contentWindow! : window;
        receiver.postMessage({type:'WARPDIFF_LOAD', requestId:'rejected', taskId:'rejected-task',
          capabilities:{managedReview:sender === 'managed parent'}, slotLabels:['','Candidate','Second'], ...payload}, location.origin);
      }, {kind,sender,base64:image64});
      if (kind.includes('signed')) await expect.poll(() => served,
        {message:'The intended HTTP 200 must come from the controlled response'}).toBe(1);
      await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
        expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'rejected',taskId:'rejected-task',error:expect.any(String)}),
      ]);
      await expect(app.locator('#comparisonView')).not.toHaveClass(/active/);
      await expect(app.locator('.asset-layer img, .asset-layer video, .asset-layer audio')).toHaveCount(0);
      await expect(app.locator('#landingCta')).not.toHaveClass(/loading/);
      await expect(app.locator('#ihwaPullBtn')).toBeEnabled();
      expect(await app.evaluate(() => (window as any).eval('_ihwaPullTimer'))).toBeNull();
      expect(await page.evaluate(() => (window as any).hostFallbacks)).toBe(0);
      expect(await app.evaluate(() => (window as any).hostErrors)).toEqual([]);
      // Let any sibling callbacks/activation deadline run; failure stays terminal.
      await app.waitForTimeout(550);
      expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
    });
  }
}

for (const count of [1,2,3,4]) for (const signed of [false,true]) {
  test(`host preserves ${count} label/file associations with descending timestamps via ${signed ? 'signed URLs' : 'supplied bytes'}`, async ({page}) => {
    await page.evaluate(({count,signed,images}) => {
      const files = Array.from({length:count}, (_, i) => ({name:`item-${i+1}.png`, contentType:'image/png',
        lastModified:100000-i*10000, ...(signed ? {signedUrl:'/tests/fixtures/'+images[i].name} : {base64:images[i].base64})}));
      window.postMessage({type:'WARPDIFF_LOAD', requestId:'ordered', capabilities:{managedReview:true},
        slotLabels:count <= 2 ? ['',...files.map((_,i)=>`Label ${i+1}`)] : files.map((_,i)=>`Label ${i+1}`),
        ...(signed ? {signedItems:files} : {files})}, location.origin);
    }, {count,signed,images:orderImages});
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'ordered'}),
    ]);
    const pairs = await page.evaluate(() => (window as any).eval('assetOrder.filter(s=>mediaData[s]).map(s=>({name:mediaData[s].name,label:slotLabel(s)}))'));
    expect(pairs).toEqual(Array.from({length:count}, (_,i)=>({name:`item-${i+1}.png`,label:`Label ${i+1}`})));
    const bytes = await page.evaluate(async () => Promise.all((window as any).eval('assetOrder.filter(s=>mediaData[s]).map(s=>mediaData[s].src)')
      .map(async (src:string) => btoa(Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer()), n=>String.fromCharCode(n)).join('')))));
    expect(bytes).toEqual(orderImages.slice(0,count).map(image=>image.base64));
  });
}

for (const completion of ['resolve','reject']) test(`host waits for every decoded image and ignores old decode ${completion} after replacement`, async ({page}) => {
  await page.evaluate(({base64,completion}) => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function() {
      HTMLImageElement.prototype.decode = original;
      return new Promise((resolve,reject) => { (window as any).finishOldDecode = completion === 'resolve' ? resolve : () => reject(new Error('retired decode failure')); });
    };
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'old-decoding',files:[
      {name:'held.png',contentType:'image/png',base64}, {name:'sibling.png',contentType:'image/png',base64},
    ]}, location.origin);
  }, {base64:image64,completion});
  await page.waitForFunction(() => !!(window as any).finishOldDecode);
  await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).hostReplies)).toEqual([]);
  await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD',requestId:'replacement',
    files:[{name:'new.png',contentType:'image/png',base64}]}, location.origin), image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'replacement'}),
  ]);
  await page.evaluate(() => (window as any).finishOldDecode());
  await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).eval('mediaData.editA.name'))).toBe('new.png');
});

test('a host batch with one decoded image and one rejected image fails and clears every slot', async ({page}) => {
  await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD',requestId:'partial',files:[
    {name:'valid.png',contentType:'image/png',base64}, {name:'invalid.png',contentType:'image/png',buffer:[1,2,3]},
  ]}, location.origin), image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'partial'}),
  ]);
  await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).eval('getLoadedSlotCount()'))).toBe(0);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('valid host audio waits for playable media and decoded waveforms', async ({page}) => {
  await page.evaluate(() => {
    // Host acceptance retires the preceding AudioContext. Hold the first decode
    // on the new context rather than patching an instance that clear discards.
    const proto = AudioContext.prototype, original = proto.decodeAudioData;
    proto.decodeAudioData = function(bytes:ArrayBuffer) {
      proto.decodeAudioData = original;
      return original.call(this,bytes).then(audio => new Promise<AudioBuffer>(resolve => {
        (window as any).finishAudioAnalysis = () => resolve(audio);
      }));
    };
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'audio',signedItems:[
      {name:'valid.wav',contentType:'audio/wav',signedUrl:'/tests/fixtures/mono.wav'},
    ]}, location.origin);
  });
  await page.waitForFunction(() => !!(window as any).finishAudioAnalysis && document.querySelector('audio')!.readyState >= 2);
  await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).hostReplies)).toEqual([]);
  await page.evaluate(() => (window as any).finishAudioAnalysis());
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'audio'}),
  ]);
  expect(await page.evaluate(() => !!(window as any).eval('_audioSlotVizData.editA.audioBuffer'))).toBe(true);
});

test('valid signed host video reaches a decoded first frame before READY', async ({page}) => {
  await page.evaluate(() => window.postMessage({type:'WARPDIFF_LOAD',requestId:'video',signedItems:[
    {name:'valid.mp4',contentType:'video/mp4',signedUrl:'/tests/fixtures/landscape_a.mp4'},
  ]}, location.origin));
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'video'}),
  ]);
  const video = page.locator('.asset-layer video').first();
  expect(await video.evaluate((v:HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0)).toBe(true);
});

for (const managed of [false,true]) for (const signed of [false,true]) {
  test(`first-frame verification rejects metadata-only video after a valid control (${managed ? 'parent' : 'window'}, ${signed ? 'signed' : 'bytes'})`, async ({page}, testInfo) => {
    const directory = testInfo.outputPath('faststart'); mkdirSync(directory, {recursive:true});
    const filename = path.join(directory, 'control.mp4');
    execFileSync('ffmpeg', ['-v','error','-i',path.join(__dirname,'fixtures/landscape_a.mp4'),
      '-c','copy','-movflags','+faststart',filename]);
    const full = readFileSync(filename), end = full.indexOf(Buffer.from('mdat')) + 4;
    expect(end).toBeGreaterThan(8); expect(end).toBeLessThan(full.length);
    let served = 0;
    await page.route('**/first-frame-*.mp4', route => {
      served++;
      return route.fulfill({status:200,contentType:'video/mp4',body:route.request().url().endsWith('full.mp4') ? full : full.subarray(0,end)});
    });
    if (managed) {
      await page.route('**/first-frame-host.html', route => route.fulfill({contentType:'text/html',body:'<!doctype html><iframe src="/"></iframe>'}));
      await page.goto('/first-frame-host.html');
    }
    const app = managed ? page.frames().find(frame => frame.parentFrame())! : page;
    await app.waitForFunction(() => typeof (window as any).handleMultipleFiles === 'function');
    const firstSample = await app.evaluate(bytes => (window as any)._demuxMP4Video(new Uint8Array(bytes))?.samples[0], Array.from(full));
    expect(firstSample?.offset, 'The prefix must end before every video sample').toBeGreaterThanOrEqual(end);
    expect(firstSample?.size).toBeGreaterThan(0);
    async function send(kind:'full'|'empty') {
      await page.evaluate(({managed,signed,kind,base64}) => {
        const receiver = managed ? document.querySelector('iframe')!.contentWindow! : window;
        const item = {name:kind+'.mp4',contentType:'video/mp4',...(signed ? {signedUrl:'/first-frame-'+kind+'.mp4'} : {base64})};
        receiver.postMessage({type:'WARPDIFF_LOAD',requestId:kind,taskId:'first-frame',slotLabels:['','Candidate'],capabilities:{managedReview:managed},
          ...(signed ? {signedItems:[item]} : {files:[item]})},location.origin);
      }, {managed,signed,kind,base64:(kind === 'full' ? full : full.subarray(0,end)).toString('base64')});
    }
    await send('full');
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies), {timeout:15000}).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'full',taskId:'first-frame'}),
    ]);
    expect(await app.locator('.asset-layer video').evaluate((v:HTMLVideoElement) => ({paused:v.paused,time:v.currentTime})))
      .toEqual({paused:true,time:0});
    await expect(app.locator('[data-host-video-probe]')).toHaveCount(0);
    await page.clock.install();
    await send('empty');
    await expect.poll(() => app.locator('.asset-layer video').evaluate((v:HTMLVideoElement) => v.readyState), {timeout:10000}).toBeGreaterThanOrEqual(2);
    if (signed) expect(served, 'Both controlled responses must execute').toBe(2);
    await page.waitForTimeout(550);
    expect(await page.evaluate(() => (window as any).hostReplies),
      'A video without a usable frame must not receive READY').toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'full'}),
    ]);
    await page.clock.fastForward(11000);
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies),
      {message:'Metadata without a usable frame must fail, never receive READY'}).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'full'}),
      expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'empty',taskId:'first-frame'}),
    ]);
    await expect(app.locator('.asset-layer video, [data-host-video-probe]')).toHaveCount(0);
    await expect(app.locator('#comparisonView')).not.toHaveClass(/active/);
    await expect(app.locator('#landingCta')).not.toHaveClass(/loading/);
    await expect(app.locator('#ihwaPullBtn')).toBeEnabled();
    expect(await page.evaluate(() => (window as any).hostFallbacks)).toBe(0);
    await page.clock.fastForward(20000);
    expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(2);
  });
}

test('frame availability accepts black, solid sentinel colors and transparent source pixels', async ({page}) => {
  expect(await page.evaluate(() => {
    const source=document.createElement('canvas'), target=document.createElement('canvas');
    source.width=source.height=target.width=target.height=1;
    const ctx=source.getContext('2d')!, targetCtx=target.getContext('2d')!;
    return ['#000000','#ff0000','#00ff00','transparent'].map(color => {
      ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
      return (window as any)._hostVideoFrameAvailable(source,targetCtx);
    });
  })).toEqual([true,true,true,true]);
});

test('replacing a pending first-frame verification retires its probe and deadline', async ({page}) => {
  await page.evaluate(() => {
    (window as any)._hostVideoFrameAvailable = () => false;
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'held-video',signedItems:[
      {name:'held.mp4',contentType:'video/mp4',signedUrl:'/tests/fixtures/landscape_a.mp4'},
    ]}, location.origin);
  });
  await expect(page.locator('[data-host-video-probe]')).toHaveCount(1);
  await page.clock.install();
  await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD',requestId:'replacement',files:[
    {name:'replacement.png',contentType:'image/png',base64},
  ]},location.origin),image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY',requestId:'replacement'}),
  ]);
  await page.clock.fastForward(20000);
  await expect(page.locator('[data-host-video-probe]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).eval('mediaData.editA.name'))).toBe('replacement.png');
});

test('clearing pending first-frame verification retires its probe without a terminal reply', async ({page}) => {
  await page.evaluate(() => {
    (window as any)._hostVideoFrameAvailable = () => false;
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'cleared-video',signedItems:[
      {name:'held.mp4',contentType:'video/mp4',signedUrl:'/tests/fixtures/landscape_a.mp4'},
    ]}, location.origin);
  });
  await expect(page.locator('[data-host-video-probe]')).toHaveCount(1);
  await page.clock.install();
  await page.evaluate(() => (window as any).clearAllMedia());
  await page.clock.fastForward(20000);
  await expect(page.locator('[data-host-video-probe]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).hostReplies)).toEqual([]);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('a rejected verification play promise fails once and retires its probe', async ({page}) => {
  await page.evaluate(() => {
    (window as any)._hostVideoFrameAvailable = () => false;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      return this.hasAttribute('data-host-video-probe') ? Promise.reject(new DOMException('Blocked probe','NotAllowedError')) : original.call(this);
    };
    window.postMessage({type:'WARPDIFF_LOAD',requestId:'blocked-verifier',signedItems:[
      {name:'valid.mp4',contentType:'video/mp4',signedUrl:'/tests/fixtures/landscape_a.mp4'},
    ]}, location.origin);
  });
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'blocked-verifier'}),
  ]);
  await expect(page.locator('[data-host-video-probe], .asset-layer video')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
});

test('standalone manual loads retain timestamp ordering', async ({page}) => {
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    (window as any).handleMultipleFiles([new File([bytes],'new.png',{type:'image/png',lastModified:20000}),
      new File([bytes],'old.png',{type:'image/png',lastModified:10000})]);
  }, image64);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  expect(await page.evaluate(() => (window as any).eval('[mediaData.editA.name,mediaData.editB.name]'))).toEqual(['old.png','new.png']);
});

test.afterEach(async ({page}) => {
  expect(await page.evaluate(() => (window as any).hostErrors)).toEqual([]);
});

for (const [name, files] of [
  ['malformed base64', [{name:'bad.png', contentType:'image/png', base64:'%%%'}]],
  ['numeric allocation size', [{name:'bad.png', contentType:'image/png', buffer:2 ** 30}]],
  ['arbitrary buffer object', [{name:'bad.png', contentType:'image/png', buffer:{length:2 ** 30}}]],
  ['invalid byte array', [{name:'bad.png', contentType:'image/png', buffer:[0, -1, 256]}]],
  ['empty buffer', [{name:'bad.png', contentType:'image/png', buffer:[]}]],
  ['null file', [null]],
  ['non-array files', {name:'bad.png'}],
  ['invalid metadata', [{name:42, contentType:'image/png', buffer:[1]}]],
  ['too many files', Array.from({length:5}, () => ({name:'bad.png', contentType:'image/png', buffer:[1]}))],
] as const) {
  test(`host load reports and cleans up ${name}`, async ({page}) => {
    await page.evaluate(files => {
      (window as any).pullFromIHWA();
      window.postMessage({type:'WARPDIFF_LOAD', requestId:'bad', taskId:'task-bad', files}, location.origin);
    }, files);
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'bad', taskId:'task-bad', error:expect.any(String)}),
    ]);
    await expect(page.locator('#ihwaPullBtn')).toBeEnabled();
    await expect(page.locator('#landingCta')).not.toHaveClass(/loading/);
    await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
    await expect(page.locator('.asset-layer img, .asset-layer video')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).eval('_ihwaPullTimer'))).toBeNull();
    // A failed request must not prevent a subsequent legitimate load.
    await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD', requestId:'recovered',
      files:[{name:'recovered.png', contentType:'image/png', base64}]}, location.origin), image64);
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toHaveLength(2);
    expect(await page.evaluate(() => (window as any).hostReplies[1])).toMatchObject({type:'WARPDIFF_LOAD_READY', requestId:'recovered'});
  });
}

for (const format of ['base64', 'ArrayBuffer', 'typed view', 'DataView', 'byte array']) {
  test(`host load accepts ${format} without changing the supplied bytes`, async ({page}) => {
    await page.evaluate(({base64, format}) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const padded = new Uint8Array(bytes.length + 8);
      padded.set(bytes, 4);
      const payload = format === 'base64' ? {base64} : {buffer:
        format === 'ArrayBuffer' ? bytes.buffer : format === 'typed view' ? padded.subarray(4, -4) :
        format === 'DataView' ? new DataView(padded.buffer, 4, bytes.length) : Array.from(bytes)};
      window.postMessage({type:'WARPDIFF_LOAD', requestId:'valid', taskId:'task-valid',
        files:[{name:'valid.png', contentType:'image/png', ...payload}]}, location.origin);
    }, {base64:image64, format});
    await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
      expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'valid', taskId:'task-valid'}),
    ]);
    await expect(page.locator('.asset-layer img')).toHaveCount(1);
    const loaded = await page.locator('.asset-layer img').evaluate(async (image:HTMLImageElement) => {
      const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
      return {base64:btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')), width:image.naturalWidth};
    });
    expect(loaded.base64).toBe(image64);
    expect(loaded.width).toBeGreaterThan(0);
  });
}

test('superseded supplied-file failure cannot reset or notify the newer request', async ({page}) => {
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    let held = false;
    window.fetch = (input, init) => {
      if (String(input).startsWith('data:') && !held) {
        held = true;
        return new Promise((_resolve, reject) => { w.rejectOldFile = () => reject(new Error('late old failure')); });
      }
      return original(input, init);
    };
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'old', files:[{name:'old.png', contentType:'image/png', base64}]}, location.origin);
  }, image64);
  await page.waitForFunction(() => !!(window as any).rejectOldFile);
  await page.evaluate(base64 => window.postMessage({type:'WARPDIFF_LOAD', requestId:'new',
    files:[{name:'new.png', contentType:'image/png', base64}]}, location.origin), image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'new'}),
  ]);
  await page.evaluate(async () => {
    (window as any).rejectOldFile();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
});

test('manual replacement retires a pending host failure without clearing the new files', async ({page}) => {
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).startsWith('data:')
      ? new Promise((_resolve, reject) => { w.rejectOldFile = () => reject(new Error('late failure after manual load')); })
      : original(input, init);
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'retired',
      files:[{name:'retired.png', contentType:'image/png', base64}]}, location.origin);
  }, image64);
  await page.waitForFunction(() => !!(window as any).rejectOldFile);
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/green.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await page.evaluate(async () => {
    (window as any).rejectOldFile();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toEqual([]);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
});

test('same-origin parent receives the correlated terminal failure for malformed media', async ({page}) => {
  await page.route('**/invalid-media-host.html', route => route.fulfill({contentType:'text/html', body:
    `<!doctype html><iframe src="/"></iframe><script>
      document.querySelector('iframe').addEventListener('load', event => event.target.contentWindow.postMessage({
        type:'WARPDIFF_LOAD', requestId:'parent-bad', taskId:'parent-task',
        files:[{name:'bad.png', contentType:'image/png', buffer:1024}]
      }, location.origin));
    <\/script>`}));
  await page.goto('/invalid-media-host.html');
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'parent-bad', taskId:'parent-task'}),
  ]);
  await expect(page.locator('iframe').contentFrame().locator('#ihwaPullBtn')).toBeEnabled();
});

test('one failed file aborts its sibling and clears the preceding comparison', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(path.join(__dirname, 'fixtures/green.png'));
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
  await page.evaluate(base64 => {
    const w = window as any, original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).startsWith('data:')) {
        w.siblingSignal = init?.signal;
        return new Promise(resolve => { w.releaseSibling = () => resolve(new Response(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))); });
      }
      return original(input, init);
    };
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'batch', files:[
      {name:'bad.png', contentType:'image/png', buffer:1024},
      {name:'slow.png', contentType:'image/png', base64},
    ]}, location.origin);
  }, image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED', requestId:'batch'}),
  ]);
  expect(await page.evaluate(() => (window as any).siblingSignal.aborted)).toBe(true);
  await page.evaluate(async () => {
    (window as any).releaseSibling();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).hostReplies)).toHaveLength(1);
  await expect(page.locator('.asset-layer img')).toHaveCount(0);
  await expect(page.locator('#comparisonView')).not.toHaveClass(/active/);
});

test('same-window signed URL failure still requests and accepts extension fallback', async ({page}) => {
  await page.route('**/unavailable-host-media.png', route => route.abort('failed'));
  await page.evaluate(base64 => {
    addEventListener('message', event => {
      if (event.data?.type === 'WARPDIFF_PULL_FALLBACK') window.postMessage({
        type:'WARPDIFF_LOAD', requestId:'fallback', files:[{name:'fallback.png', contentType:'image/png', base64}],
      }, location.origin);
    });
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'signed', signedItems:[
      {signedUrl:'/unavailable-host-media.png', name:'signed.png', contentType:'image/png'},
    ]}, location.origin);
  }, image64);
  await expect.poll(() => page.evaluate(() => (window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_READY', requestId:'fallback'}),
  ]);
  await expect(page.locator('.asset-layer img')).toHaveCount(1);
});

test('empty managed-host input fails immediately while standalone extension input retries', async ({page}) => {
  await page.evaluate(()=>{
    (window as any).pullFromIHWA();
    window.postMessage({type:'WARPDIFF_LOAD', requestId:'empty-extension', files:[]}, location.origin);
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).eval('_ihwaPullRetries'))).toBe(1);
  expect(await page.evaluate(()=>(window as any).hostReplies)).toEqual([]);
  await page.evaluate(()=>window.postMessage({type:'WARPDIFF_LOAD', requestId:'empty-managed', taskId:'managed',
    capabilities:{managedReview:true}, files:[],slotLabels:[]}, location.origin));
  await expect.poll(()=>page.evaluate(()=>(window as any).hostReplies)).toEqual([
    expect.objectContaining({type:'WARPDIFF_LOAD_FAILED',requestId:'empty-managed',taskId:'managed'}),
  ]);
  expect(await page.evaluate(()=>(window as any).eval('_ihwaPullTimer'))).toBeNull();
});
