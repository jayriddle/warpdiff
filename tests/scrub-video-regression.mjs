// Controlled decoder schedules exercise the shipped session, without media data
// or browser timing assumptions. Called by the ownership/logic harness.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export async function runScrubVideoChecks(check, source = readFileSync(new URL('../js/scrub-video.js', import.meta.url), 'utf8')) {
  async function sessionFor({ codec = 'avc1.64001f', count = 300, width = 1280, height = 720,
      colr = {primaries:1,transfer:1,matrix:1}, frameTransfer = 'bt709', platform = '', onColorRejected, constructorThrows = false } = {}) {
    const resources = [], bitmaps = [], draws = [], raf = new Map(), decoders = [];
    let rafId = 0; const gamutListeners=[];let gamutQueries=0;const gamut={matches:false,addEventListener(type,fn){gamutListeners.push(fn);}};
    class Frame {
      constructor(index, format = 'I420', clone = false) {
        this.timestamp = Math.round(index / 24 * 1e6);
        this.format = format;
        this.codedWidth = width; this.codedHeight = height;
        this.colorSpace = { transfer: frameTransfer, primaries: 'bt709', matrix: 'bt709', fullRange:false };
        this.closed = false; this.isClone = clone;
        resources.push(this);
      }
      allocationSize() { return width * height * 1.5; }
      clone() { return new Frame(this.timestamp / 1e6 * 24, this.format, true); }
      close() { this.closed = true; }
    }
    class Decoder {
      static async isConfigSupported(config) { return { supported: true, config }; }
      constructor(callbacks) {
        if (constructorThrows) throw new Error('Controlled decoder constructor failure');
        this.callbacks = callbacks; this.state = 'unconfigured'; this.decodeQueueSize = 0;
        this.resets = 0; this.flushes = 0; this.chunks = [];
        decoders.push(this);
      }
      configure(config) { this.config = config; this.state = 'configured'; }
      decode(chunk) { this.chunks.push(chunk); this.decodeQueueSize++; }
      reset() { this.resets++; this.state = 'unconfigured'; this.decodeQueueSize = 0; }
      addEventListener() {} // Tests decide when work completes, independent of submission.
      flush() {
        this.flushes++;
        if (this.releaseOnFlush) this.emit(count - 1);
        return Promise.resolve();
      }
      close() { this.state = 'closed'; }
      emit(index, format, colorSpace) { const frame = new Frame(index, format); if (colorSpace) Object.assign(frame.colorSpace, colorSpace); this.callbacks.output(frame); }
    }
    const realm = {
      VideoDecoder: Decoder,
      EncodedVideoChunk: class { constructor(chunk) { Object.assign(this, chunk); } },
      _demuxMP4Video: () => ({ codec, colr, codedWidth: width, codedHeight: height,
        samples: Array.from({ length: count }, (_, index) => ({ pts: index / 24, key: index === 0, offset: 0, size: 1 })) }),
      requestAnimationFrame: fn => { raf.set(++rafId, fn); return rafId; },
      cancelAnimationFrame: id => raf.delete(id),
      createImageBitmap: (frame, options) => new Promise((resolve, reject) => {
        const bitmap = { closed: false, close() { this.closed = true; } };
        bitmaps.push({ frame, options, bitmap, resolve: () => resolve(bitmap), reject });
      }),
      URL, navigator: { platform }, window: { location: { href: 'https://example.test/warpdiff/?review=1' },matchMedia(){gamutQueries++;return gamut;} },
    };
    runInNewContext(source+'\nglobalThis.gamutListenerCount = () => _scrubGamutListeners.size;', realm);
    let session;
    try { session = realm._createScrubVideoSession(new Uint8Array(1), onColorRejected); }
    catch (error) {
      if (!constructorThrows) throw error;
      return {error,listeners:realm.gamutListenerCount()};
    }
    if (!session) return { session, decoders };
    await session.ready;
    const canvas = { width: 0, height: 0, style:{filter:''}, getContext: () => ({ drawImage: frame => draws.push(frame.timestamp), clearRect() {} }) };
    session.attach(canvas, 'srgb');
    const paint = () => { const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn()); };
    const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
    return { session, decoder: decoders[0], decoders, bitmaps, resources, draws, paint, settle, canvas, setGamut(value){gamut.matches=value;gamutListeners.forEach(fn=>fn());},gamutQueries:()=>gamutQueries };
  }

  {
    const failed = await sessionFor({constructorThrows:true});
    check('scrub[color]: failed decoder construction cannot retain an input through gamut listeners',
      failed.error?.message === 'Controlled decoder constructor failure' && failed.listeners === 0);
  }

  {
    const realm={URL};runInNewContext(source,realm);
    const filter=(frame,platform,url,wide=false,codec='avc1.640028')=>realm._scrubVideoPresentationFilter(frame,platform,url,wide,codec);
    const native={format:'NV12',colorSpace:{primaries:'bt709',matrix:'bt709',transfer:'bt709',fullRange:false}},url='https://example.test/warpdiff/?review=1#old';
    check('scrub[color]: NV12 correction binds to the stable document and retains its query',filter(native,'MacIntel',url)==='url("https://example.test/warpdiff/?review=1#scrubOverlayColorFix")');
    check('scrub[color]: verified High 4:4:4 AVC I420 stays unfiltered',filter({...native,format:'I420'},'MacIntel',url,false,'avc1.f4001f')==='');
    check('scrub[color]: ordinary AVC software I420 retains native seeking',filter({...native,format:'I420'},'MacIntel',url,false,'avc1.640028')===null);
    check('scrub[color]: opaque Main10 HEVC retains native seeking',filter({...native,format:null},'MacIntel',url,false,'hvc1.2.4.L120.B0')===null);
    check('scrub[color]: unknown planar codec retains native seeking',filter({...native,format:'I420'},'MacIntel',url)===null);
    check('scrub[color]: unmeasured High 4:4:4 NV12 output retains native seeking',filter(native,'MacIntel',url,false,'avc1.f4001f')===null);
    check('scrub[color]: High 4:4:4 I420 with unverified primaries retains native seeking',filter({...native,format:'I420',colorSpace:{...native.colorSpace,primaries:'bt2020'}},'MacIntel',url,false,'avc1.f4001f')===null);
    check('scrub[color]: other platforms never receive macOS compensation',filter(native,'Linux x86_64',url)==='');
    check('scrub[color]: explicit sRGB output does not receive BT709 compensation',filter({...native,colorSpace:{...native.colorSpace,transfer:'iec61966-2-1'}},'MacIntel',url)==='');
    check('scrub[color]: unverified NV12 matrix retains native seeking',filter({...native,colorSpace:{...native.colorSpace,matrix:'smpte170m'}},'MacIntel',url)===null);
    check('scrub[color]: wide-gamut NV12 retains native presentation',filter(native,'MacIntel',url,true)===null);
    check('scrub[color]: wide-gamut software output stays unfiltered',filter({...native,format:'I420'},'MacIntel',url,true,'avc1.f4001f')==='');
    const untagged = await sessionFor({colr:null,platform:'MacIntel'});
    check('scrub[color]: untagged input retains native presentation before decoder allocation', untagged.session === null && untagged.decoders.length === 0);
    const linux = await sessionFor({colr:null,platform:'Linux x86_64'});
    check('scrub[color]: untagged non-macOS input keeps the decoder',!!linux.session);linux.session.close();
    const mov = await sessionFor({colr:{type:'nclc',primaries:1,transfer:1,matrix:1,fullRange:null},platform:'Win32'});
    check('scrub[color]: nclc non-macOS input keeps the decoder',!!mov.session);mov.session.close();
    check('scrub[color]: full-range NV12 remains native until measured',filter({...native,colorSpace:{...native.colorSpace,fullRange:true}},'MacIntel',url)===null);
    check('scrub[color]: 8-bit HEVC NV12 remains native until measured',filter(native,'MacIntel',url,false,'hvc1.1.6.L93.B0')===null);
    let rejected=0;const moving=await sessionFor({platform:'MacIntel',onColorRejected:()=>rejected++});
    moving.session.request(0,true);moving.decoder.emit(0,'NV12');
    moving.bitmaps.forEach(b=>b.resolve());await moving.settle();moving.paint();
    moving.setGamut(true);
    check('scrub[color]: P3 change retires cached output without a new decoder output',moving.session.dead && moving.session.cacheStats.frames===0 && rejected===1 && moving.resources.every(f=>f.closed));
    moving.setGamut(false);moving.session.request(0,true);
    check('scrub[color]: display fallback is sticky until a new load and query is cached',moving.session.dead && rejected===1 && moving.gamutQueries()===1);
    const tagged = await sessionFor();
    tagged.session.request(0,true);tagged.decoder.emit(0);tagged.paint();
    check('scrub[color]: declared SDR still paints without rewriting color metadata', !tagged.session.dead && tagged.session.framesPainted > 0 && !tagged.decoder.config.colorSpace);
    tagged.session.close();
    for (const transfer of ['pq','hlg']) {
      let retired=0;
      const hdr=await sessionFor({frameTransfer:transfer,onColorRejected:()=>{retired++;}});
      hdr.session.request(0,true);hdr.decoder.emit(0);hdr.paint();
      check('scrub[color]: '+transfer+' bitstream conflict retires before painting',hdr.session.dead && hdr.draws.length===0 && hdr.resources.every(f=>f.closed) && retired===1);
      hdr.session.close();
    }
  }


  // Presentation policy is checked before cache insertion/painting, on every
  // output and again after a decoder is recreated around retained cached frames.
  for (const [label,codec,format] of [
    ['opaque HEVC','hvc1.2.4.L120.B0',null], ['ordinary software AVC','avc1.640028','I420']
  ]) {
    let rejected=0;
    const h=await sessionFor({platform:'MacIntel',codec,onColorRejected:()=>{rejected++;}});
    h.session.request(0,true);h.decoder.emit(0,format);h.paint();
    check('scrub[color]: '+label+' rejects before cache or paint',h.session.dead && h.draws.length===0 && h.bitmaps.length===0 && h.resources.every(f=>f.closed) && rejected===1);
    h.session.request(1,true);h.decoder.emit(1,format);h.paint();
    check('scrub[color]: '+label+' cannot restart after rejection',h.decoders.length===1 && h.draws.length===0 && rejected===1 && h.resources.every(f=>f.closed));
    h.session.close();
  }
  for (const resume of [false,true]) {
    let rejected=0;
    const h=await sessionFor({platform:'MacIntel',onColorRejected:()=>{rejected++;}});
    h.session.request(0,true);h.decoder.emit(0,'NV12');h.paint();
    h.bitmaps.forEach(b=>b.resolve());await h.settle();
    const replacement={...h.canvas,style:{filter:''}};
    h.session.attach(replacement,'srgb');
    h.session.request(0,true);
    check('scrub[color]: reattach preserves verified NV12 cache presentation '+resume,replacement.style.filter.includes('?review=1#scrubOverlayColorFix') && h.session.cacheStats.hits===1);
    if(resume){h.session.suspend();h.session.request(1,true);}
    else h.session.request(1,true);
    const before=h.draws.length;
    h.decoders.at(-1).emit(24,'I420');h.paint();
    h.bitmaps.forEach(b=>b.resolve());await h.settle();
    check('scrub[color]: changed output '+(resume?'after resume':'within run')+' retires cache and pending paint',h.session.dead && h.draws.length===before && h.session.cacheStats.bytes===0 && h.resources.every(f=>f.closed) && h.bitmaps.every(b=>b.bitmap.closed) && rejected===1 && h.decoders.every(d=>d.state==='closed'));
  }
  for (const transfer of ['pq','hlg','iec61966-2-1']) {
    let rejected=0;
    const h=await sessionFor({platform:'MacIntel',onColorRejected:()=>{rejected++;}});
    h.session.request(0,true);h.decoder.emit(0,'NV12'); // leave the first paint pending
    h.decoder.emit(0,'NV12',{transfer});h.paint();
    h.bitmaps.forEach(b=>b.resolve());await h.settle();
    check('scrub[color]: later '+transfer+' cannot repaint retained SDR frames',h.session.dead && h.draws.length===0 && h.session.cacheStats.bytes===0 && h.resources.every(f=>f.closed) && h.bitmaps.every(b=>b.bitmap.closed) && rejected===1);
  }

  {
    const normal = await sessionFor();
    check('scrub[codec]: ordinary AVC retains low-delay/hardware-default configuration',
      normal.decoder.config.optimizeForLatency === true && !normal.decoder.config.hardwareAcceleration);
    normal.session.close();
    const software = await sessionFor({ codec: 'avc1.f4001f' });
    check('scrub[codec]: High 4:4:4 AVC requests software throughput',
      software.decoder.config.optimizeForLatency === false && software.decoder.config.hardwareAcceleration === 'prefer-software');
    software.session.close();
  }
  {
    const h = await sessionFor();
    h.session.request(3, true); // 24 submitted frames; no output yet.
    h.decoder.emit(0);
    const resets = h.decoder.resets;
    h.session.request(9 / 24, false); // behind the queue, ahead of emitted work.
    check('scrub[retarget]: queued work does not force a reset for an undecoded retreat', h.decoder.resets === resets);
    h.decoder.emit(9); h.paint();
    check('scrub[retarget]: retreat replaces the later target paint floor', Math.abs(h.session.lastPaintedPts - 9 / 24) < 1e-6);
    h.session.request(2 / 24, false);
    check('scrub[retarget]: an uncached target behind emitted output still resets', h.decoder.resets === resets + 1);
    h.session.close(); h.bitmaps.forEach(b => b.resolve()); await h.settle();
  }
  {
    const h = await sessionFor();
    h.session.request(1, true); h.decoder.emit(24);
    h.session.request(2, true); h.paint();
    check('scrub[paint]: retargeting a discrete seek cannot paint an older pending frame', h.session.framesPainted === 0);
    h.decoder.emit(48); h.paint();
    check('scrub[paint]: the new discrete target is presented', h.session.lastPaintedPts === 2);
    h.session.close(); h.bitmaps.forEach(b => b.resolve()); await h.settle();
  }
  {
    const h = await sessionFor({ codec: 'avc1.f4001f', platform: 'MacIntel' });
    h.session.request(10, true);
    for (let index = 100; index < 250; index++) h.decoder.emit(index);
    h.paint();
    check('scrub[planar-cache]: full-resolution I420 retains more frames within 192 MiB',
      h.session.cacheStats.frames === 145 && h.session.cacheStats.bytes === 145 * 1280 * 720 * 1.5 && h.bitmaps.length === 0);
    h.session.request(200 / 24, true);
    check('scrub[planar-cache]: a backward hit presents the exact source frame',
      h.session.cacheStats.hits === 1 && Math.abs(h.session.lastPaintedPts - 200 / 24) < 1e-6);
    const before = JSON.stringify(h.session.cacheStats);
    h.session.suspend();
    check('scrub[planar-cache]: suspension releases the decoder and retains reusable frames',
      h.decoder.state === 'closed' && before === JSON.stringify(h.session.cacheStats));
    h.session.request(200 / 24, true);
    check('scrub[planar-cache]: resume reuses the exact retained frame with a fresh decoder',
      h.decoders.length === 2 && h.session.cacheStats.hits === 2);
    h.session.close();
    check('scrub[planar-cache]: clear closes all emitted and retained frames and balances bytes',
      h.resources.every(frame => frame.closed) && h.session.cacheStats.frames === 0 && h.session.cacheStats.bytes === 0);
  }
  for (const options of [{ codec: 'avc1.f4001f', width: 2560, height: 1440 }, { codec: 'avc1.f4001f' }, {}]) {
    const h = await sessionFor(options);
    h.session.request(1, true); h.decoder.emit(24, options.width ? 'I420' : null);
    h.paint();
    check('scrub[bitmap]: resized, opaque and ordinary-codec output retains bitmap fallback',
      h.bitmaps.length === 1 && h.bitmaps[0].options.resizeWidth === 1280 && h.session.cacheStats.frames === 0);
    h.bitmaps[0].resolve(); await h.settle();
    check('scrub[bitmap]: fallback publishes a usable cache entry', h.session.cacheStats.frames === 1);
    h.session.close();
  }
  {
    const h = await sessionFor({ codec: 'avc1.f4001f' });
    h.session.request(10, true);
    h.decoder.emit(240); h.decoder.emit(239, null); h.paint();
    h.bitmaps.forEach(b => b.resolve()); await h.settle();
    check('scrub[cache-bytes]: mixed planar/bitmap entries use their own byte costs',
      h.session.cacheStats.frames === 2 && h.session.cacheStats.bytes === 1280 * 720 * 5.5);
    h.session.close();
    check('scrub[cache-bytes]: mixed entries close without negative accounting',
      h.session.cacheStats.bytes === 0 && h.resources.every(frame => frame.closed));
  }
  {
    const h = await sessionFor();
    h.session.request(10, true);
    for (let index = 190; index < 250; index++) h.decoder.emit(index);
    h.paint();
    check('scrub[async-cache]: unresolved bitmap reservations stay within the byte ceiling',
      h.session.cacheStats.frames === 0 && h.session.cacheStats.bytes === 54 * 1280 * 720 * 4);
    h.decoder.emit(190); // Replace a previously evicted reservation at this timestamp.
    const before = h.session.cacheStats.bytes;
    h.bitmaps[0].resolve(); await h.settle();
    check('scrub[async-cache]: an evicted completion neither replaces nor refunds its newer entry',
      h.bitmaps[0].bitmap.closed && h.session.cacheStats.frames === 0 && h.session.cacheStats.bytes === before);
    h.session.close(); h.bitmaps.forEach(b => b.resolve()); await h.settle();
    check('scrub[async-cache]: late completion after clear closes resources without resurrection',
      h.session.cacheStats.frames === 0 && h.session.cacheStats.bytes === 0 &&
      h.bitmaps.every(b => b.bitmap.closed) && h.resources.every(frame => frame.closed));
  }
  {
    const h = await sessionFor();
    h.session.request(1, true); h.decoder.emit(24); h.paint();
    h.bitmaps[0].reject(new Error('bitmap unavailable')); await h.settle();
    check('scrub[async-cache]: failed bitmap preparation releases exactly its reservation',
      h.session.cacheStats.bytes === 0 && h.session.cacheStats.frames === 0 && h.resources.every(frame => frame.closed));
    h.session.close();
  }
  {
    const h = await sessionFor({ codec: 'avc1.f4001f', count: 8 });
    h.decoder.releaseOnFlush = true;
    h.session.request(7 / 24, true); h.paint();
    check('scrub[eof]: file-end flush releases a decoder-buffered final frame',
      h.decoder.flushes === 1 && Math.abs(h.session.lastPaintedPts - 7 / 24) < 1e-6);
    h.session.request(7 / 24, true);
    check('scrub[eof]: repeated final-frame requests do not add flush chains', h.decoder.flushes === 1);
    h.session.close();
  }
}
