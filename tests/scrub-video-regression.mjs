// Controlled decoder schedules exercise the shipped session, without media data
// or browser timing assumptions. Called by the ownership/logic harness.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export async function runScrubVideoChecks(check, source = readFileSync(new URL('../js/scrub-video.js', import.meta.url), 'utf8')) {
  async function sessionFor({ codec = 'avc1.64001f', count = 300, width = 1280, height = 720 } = {}) {
    const resources = [], bitmaps = [], draws = [], raf = new Map(), decoders = [];
    let rafId = 0;
    class Frame {
      constructor(index, format = 'I420', clone = false) {
        this.timestamp = Math.round(index / 24 * 1e6);
        this.format = format;
        this.codedWidth = width; this.codedHeight = height;
        this.colorSpace = { transfer: 'bt709', primaries: 'bt709', matrix: 'bt709' };
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
      emit(index, format) { this.callbacks.output(new Frame(index, format)); }
    }
    const realm = {
      VideoDecoder: Decoder,
      EncodedVideoChunk: class { constructor(chunk) { Object.assign(this, chunk); } },
      _demuxMP4Video: () => ({ codec, codedWidth: width, codedHeight: height,
        samples: Array.from({ length: count }, (_, index) => ({ pts: index / 24, key: index === 0, offset: 0, size: 1 })) }),
      requestAnimationFrame: fn => { raf.set(++rafId, fn); return rafId; },
      cancelAnimationFrame: id => raf.delete(id),
      createImageBitmap: (frame, options) => new Promise((resolve, reject) => {
        const bitmap = { closed: false, close() { this.closed = true; } };
        bitmaps.push({ frame, options, bitmap, resolve: () => resolve(bitmap), reject });
      }),
      window: {},
    };
    runInNewContext(source, realm);
    const session = realm._createScrubVideoSession(new Uint8Array(1));
    await session.ready;
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: frame => draws.push(frame.timestamp), clearRect() {} }) };
    session.attach(canvas, 'srgb');
    const paint = () => { const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn()); };
    const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
    return { session, decoder: decoders[0], decoders, bitmaps, resources, draws, paint, settle };
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
    const h = await sessionFor({ codec: 'avc1.f4001f' });
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
