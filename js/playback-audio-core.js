// App-independent, selected-stream slow playback. Media time remains host-owned.
// Signalsmith's default DSP is pinned separately; no source analysis is modified.
(function(root) {
  'use strict';
  const modules = new WeakMap();
  const abort = () => Object.assign(new Error('Playback preparation cancelled'), {name:'AbortError'});
  function moduleReady(ctx, url) {
    let entries = modules.get(ctx);
    if (!entries) { entries = new Map(); modules.set(ctx, entries); }
    if (!entries.has(url)) {
      const pending = ctx.audioWorklet.addModule(url);
      entries.set(url, pending);
      pending.catch(() => entries.delete(url));
    }
    return entries.get(url);
  }
  function create(options) {
    if (!options?.workletUrl) throw Error('A playback worklet URL is required');
    const budget = options.maxBufferBytes ?? 64 * 1024 * 1024;
    if (!(budget > 0)) throw Error('Playback memory budget must be positive');
    let generation = 0, session = null, request = null, pending = null, error = null;
    let mix = {otherGain:1, centerDelta:0};
    const retirements = new Set();
    function rpc(s, method, args = [], transfer = []) {
      if (s.retiring) return Promise.reject(abort());
      const id = ++s.id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { s.replies.delete(id); reject(Error('Playback processor did not respond')); }, 5000);
        s.replies.set(id, {resolve, reject, timer});
        try { s.node.port.postMessage([id, method, ...args], transfer); }
        catch (e) { clearTimeout(timer); s.replies.delete(id); reject(e); }
      });
    }
    function retire(s) {
      if (!s) return Promise.resolve(true);
      if (s.retiring) return s.retiring;
      s.node.onprocessorerror = null;
      for (const reply of s.replies.values()) { clearTimeout(reply.timer); reply.reject(abort()); }
      s.replies.clear();
      s.rejectReady(abort());
      s.buffer = null;
      s.node.disconnect();
      s.retiring = new Promise(resolve => {
        const finish = ok => {
          clearTimeout(timer);
          s.node.port.onmessage = null;
          s.node.port.close();
          s.bytes = 0;
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 1000);
        s.node.port.onmessage = event => { if (event.data?.type === 'disposed') finish(true); };
        try { s.node.port.postMessage({type:'dispose'}); } catch (_) { finish(false); }
      });
      retirements.add(s);
      s.retiring.then(() => retirements.delete(s));
      return s.retiring;
    }
    function reset() {
      ++generation;
      const old = session;
      session = request = pending = null;
      error = null;
      retire(old);
      return Promise.all([...retirements].map(s => s.retiring)).then(values => values.every(Boolean));
    }
    function fail(s, e) {
      if (session !== s) return;
      error = String(e?.message || e);
      session = request = pending = null;
      ++generation;
      retire(s);
      options.onError?.(error);
    }
    function load(ctx, buffer) {
      if (request?.ctx === ctx && request.buffer === buffer) return pending;
      const retired = reset();
      const own = generation;
      request = {ctx, buffer};
      const current = () => own === generation;
      pending = (async () => {
        let s = null;
        try {
          const bytes = buffer.length * buffer.numberOfChannels * 4;
          if (![1, 2, 3].includes(buffer.numberOfChannels)) throw Error('Slow playback requires prepared mono, stereo, or stereo plus center');
          if (buffer.sampleRate !== ctx.sampleRate) throw Error('Slow playback requires full device-rate audio');
          if (!Number.isFinite(bytes) || bytes <= 0 || bytes > budget) throw Error('Slow playback exceeds its memory budget');
          await retired; // One selected processor; do not overlap full PCM copies.
          if (!current()) return false;
          await moduleReady(ctx, options.workletUrl);
          if (!current()) return false;
          const node = new AudioWorkletNode(ctx, 'signalsmith-stretch', {
            numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2]
          });
          s = {ctx, node, buffer, bytes, id:0, command:0, replies:new Map(), ready:false, anchor:null, retiring:null};
          session = s;
          const ready = new Promise((resolve, reject) => { s.resolveReady = resolve; s.rejectReady = reject; });
          node.port.onmessage = event => {
            const data = event.data;
            if (!Array.isArray(data)) return;
            if (data[0] === 'ready') { s.resolveReady(); return; }
            const reply = s.replies.get(data[0]);
            if (reply) { clearTimeout(reply.timer); s.replies.delete(data[0]); reply.resolve(data[1]); }
          };
          node.onprocessorerror = () => fail(s, Error('Slow playback processor failed'));
          const timer = setTimeout(() => s.rejectReady(Error('Slow playback processor did not initialize')), 5000);
          try { await ready; } finally { clearTimeout(timer); }
          if (!current()) return false;
          // Acknowledged <=1 MiB copies bound temporary memory. Transfer only our
          // copies, never the caller's analysis/listening planes.
          const frames = Math.floor(1024 * 1024 / (4 * buffer.numberOfChannels));
          for (let start = 0; start < buffer.length; start += frames) {
            if (!current()) return false;
            const planes = Array.from({length:buffer.numberOfChannels}, (_, c) =>
              buffer.getChannelData(c).slice(start, Math.min(buffer.length, start + frames)));
            await rpc(s, 'addBuffers', [planes], planes.map(p => p.buffer));
          }
          await rpc(s, 'monitorMix', [mix]);
          s.latency = await rpc(s, 'latency');
          if (!current()) return false;
          s.ready = true;
          return true;
        } catch (e) {
          if (current()) {
            if (s) fail(s, e);
            else { error = String(e.message || e); request = null; options.onError?.(error); }
          }
          return false;
        }
      })();
      return pending;
    }
    async function schedule({offset, at, rate}) {
      const s = session;
      if (!s?.ready) return null;
      if (![offset, at, rate].every(Number.isFinite) || rate <= 0) throw Error('Invalid slow playback schedule');
      const command = ++s.command;
      try {
        // outputTime replaces future plans; output supplies the audible anchor.
        await rpc(s, 'schedule', [{active:true, input:offset, output:at, outputTime:s.ctx.currentTime, rate, semitones:0}]);
        if (session !== s || command !== s.command) return null;
        return (s.anchor = {offset, at, rate});
      } catch (e) { if (session === s) fail(s, e); return null; }
    }
    function stop() {
      const s = session;
      if (!s?.ready) return;
      ++s.command;
      s.anchor = null;
      rpc(s, 'stop').catch(e => { if (session === s) fail(s, e); });
    }
    return Object.freeze({load, reset, schedule, stop,
      setMonitorMix(plan) {
        mix = {otherGain:Number.isFinite(plan?.otherGain) ? plan.otherGain : 1,
          centerDelta:Number.isFinite(plan?.centerDelta) ? plan.centerDelta : 0};
        const s = session;
        if (s?.ready) rpc(s, 'monitorMix', [mix]).catch(e => { if (session === s) fail(s, e); });
      },
      get state() { return Object.freeze({ready:!!session?.ready, node:session?.node || null,
        context:session?.ctx || null, buffer:session?.buffer || null, bytes:session?.bytes || 0,
        retiringBytes:[...retirements].reduce((sum, s) => sum + s.bytes, 0),
        latency:session?.latency || 0, anchor:session?.anchor ? {...session.anchor} : null, error, generation}); }
    });
  }
  root.WarpPlaybackAudio = Object.freeze({version:'0.1.0', create});
})(globalThis);
