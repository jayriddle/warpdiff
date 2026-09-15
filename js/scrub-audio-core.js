/* WarpScrubAudio 1.1.0 — classic script, no app globals or build step.
 * Canonical source: WarpCap/shared/media/scrub-audio.js. Standalone consumers
 * pin this file and audio/wsola-worklet.js with scripts/vendor-scrub-audio.mjs.
 * Each create() owns one selected listening stream. Source PCM is never changed.
 */
(function (root) {
  'use strict';
  const tuning = Object.freeze({ minRate:0.02, maxRate:4, motionWindow:140,
    motionMinimum:70, clockMs:50, idleMs:130, reanchorTolerance:0.03,
    presentationReanchor:0.25, syncHorizon:0.08, fade:0.03 });
  const modules = new WeakMap();
  const c = Math.SQRT1_2;
  const surroundRows = Object.freeze([[0,1,0],[1,0,1],[2,c,c],[4,c/2,0],[5,0,c/2],[6,c/2,0],[7,0,c/2]].map(Object.freeze));
  function surroundMatrix(channels = 8) { return surroundRows.filter(row => row[0] < channels); }

  function motionVelocity(samples) {
    if (!Array.isArray(samples) || samples.length < 2) return 0;
    const latest = samples[samples.length - 1];
    if (!latest || !Number.isFinite(latest.time) || !Number.isFinite(latest.at)) return 0;
    const recent = samples.filter(s => s && Number.isFinite(s.time) && Number.isFinite(s.at)
      && latest.at - s.at >= 0 && latest.at - s.at <= tuning.motionWindow);
    if (recent.length < 2 || latest.at - recent[0].at < tuning.motionMinimum) return 0;
    const meanAt = recent.reduce((sum, s) => sum + s.at, 0) / recent.length;
    const meanTime = recent.reduce((sum, s) => sum + s.time, 0) / recent.length;
    let covariance = 0, variance = 0;
    for (const s of recent) { const dt = s.at - meanAt; covariance += dt * (s.time - meanTime); variance += dt * dt; }
    return variance > 0 ? Math.max(-tuning.maxRate, Math.min(tuning.maxRate, covariance / variance * 1000)) : 0;
  }
  function grainTempo(velocity) {
    const magnitude = Number.isFinite(velocity) ? Math.abs(velocity) : 0;
    return magnitude ? Math.max(tuning.minRate, Math.min(tuning.maxRate, magnitude)) : 1;
  }
  function continuous(prior, pointerOffset, at, direction, targetOffset = pointerOffset) {
    if (!prior || prior.direction !== direction) return false;
    const elapsed = Math.max(0, at - prior.at);
    const priorTarget = Number.isFinite(prior.pointerOffset) ? prior.pointerOffset
      : Number.isFinite(prior.targetOffset) ? prior.targetOffset : prior.offset;
    const carried = prior.offset + prior.direction * prior.rate * elapsed;
    return Math.abs(pointerOffset - priorTarget) <= tuning.reanchorTolerance + tuning.maxRate * Math.max(elapsed, tuning.clockMs / 1000)
      && direction * (targetOffset - carried) <= tuning.presentationReanchor;
  }
  function streamTempo(prior, offset, at, direction, requestedTempo) {
    const tempo = Math.max(tuning.minRate, Math.min(tuning.maxRate, requestedTempo));
    if (!prior || prior.direction !== direction) return tempo;
    const carried = prior.offset + prior.direction * prior.rate * Math.max(0, at - prior.at);
    return Math.max(tuning.minRate, Math.min(tuning.maxRate, tempo + direction * (offset - carried) / tuning.syncHorizon));
  }

  // Browser 7.1 channel order: FL FR FC LFE BL BR SL SR. Fold before spectral
  // processing so correlated center content shares one phase history. 1/2/4/6
  // channels use the browser's speaker equations. Unknown layouts fail closed.
  function listeningBytes(buffer, sampleRate) {
    if (!buffer || !(buffer.length > 0) || !(buffer.sampleRate > 0) || !(sampleRate > 0)
      || ![1,2,4,6,8].includes(buffer.numberOfChannels)) return Infinity;
    return Math.ceil(buffer.length * sampleRate / buffer.sampleRate) * Math.min(2, buffer.numberOfChannels) * 4;
  }
  // AudioBufferSource rate conversion can interpolate without an anti-alias
  // filter. Use a centered windowed-sinc filter when reducing the sample rate.
  // Prepare in bounded slices, yielding between slices so long previews do not
  // monopolize the UI. No full-rate intermediate listening copy is allocated.
  async function filteredListeningBuffer(buffer, sampleRate, isCurrent) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const length = listeningBytes(buffer, sampleRate) / (channels * 4);
    const out = new AudioBuffer({numberOfChannels:channels, length, sampleRate});
    const ratio = sampleRate / buffer.sampleRate, radius = Math.ceil(16 / ratio);
    const cutoff = 0.47 * ratio, kernels = new Map();
    // Web Audio speaker equations for quad/5.1; the shared explicit matrix for
    // 7.1. Fold after each channel's identical filter to retain stereo phase.
    const rows = buffer.numberOfChannels === 8 ? surroundMatrix(8)
      : buffer.numberOfChannels === 6 ? [[0,1,0],[1,0,1],[2,c,c],[4,c,0],[5,0,c]]
      : buffer.numberOfChannels === 4 ? [[0,0.5,0],[1,0,0.5],[2,0.5,0],[3,0,0.5]]
      : buffer.numberOfChannels === 2 ? [[0,1,0],[1,0,1]] : [[0,1,0]];
    const inputs = rows.map(([channel,left,right]) => ({data:buffer.getChannelData(channel), left, right}));
    const left = out.getChannelData(0), right = channels === 2 ? out.getChannelData(1) : null;
    for (let start = 0; start < length; start += 2048) {
      if (!isCurrent()) return null;
      for (let i = start; i < Math.min(length, start + 2048); i++) {
        const position = i / ratio, base = Math.floor(position);
        const phase = Math.round((position - base) * 1024);
        let kernel = kernels.get(phase);
        if (!kernel) {
          kernel = new Float32Array(radius * 2 + 1);
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const x = k - phase / 1024, distance = x / radius;
            const window = Math.abs(distance) <= 1 ? 0.42 + 0.5 * Math.cos(Math.PI * distance) + 0.08 * Math.cos(2 * Math.PI * distance) : 0;
            const sinc = Math.abs(x) < 1e-10 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
            kernel[k + radius] = sinc * window; sum += kernel[k + radius];
          }
          for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
          kernels.set(phase, kernel);
        }
        const lo = Math.max(-radius, -base), hi = Math.min(radius, buffer.length - 1 - base);
        for (const input of inputs) {
          let value = 0;
          for (let k = lo; k <= hi; k++) value += input.data[base + k] * kernel[k + radius];
          left[i] += value * input.left;
          if (right) right[i] += value * input.right;
        }
      }
      if (start + 2048 < length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return out;
  }
  async function listeningBuffer(buffer, ctx, isCurrent = () => true) {
    if (!isCurrent()) return null;
    if (![1, 2, 4, 6, 8].includes(buffer.numberOfChannels)) throw new Error('Unsupported listening channel layout');
    if (buffer.numberOfChannels <= 2 && buffer.sampleRate === ctx.sampleRate) return buffer;
    if (ctx.sampleRate < buffer.sampleRate) return filteredListeningBuffer(buffer, ctx.sampleRate, isCurrent);
    const channels = Math.min(2, buffer.numberOfChannels);
    const off = new OfflineAudioContext(channels, listeningBytes(buffer, ctx.sampleRate) / (channels * 4), ctx.sampleRate);
    const source = off.createBufferSource(); source.buffer = buffer;
    if (buffer.numberOfChannels === 8) {
      const split = off.createChannelSplitter(8), merge = off.createChannelMerger(2);
      source.connect(split);
      for (const [channel, left, right] of surroundMatrix(8)) {
        for (const [ear, level] of [[0,left],[1,right]]) if (level) {
          const gain = off.createGain(); gain.gain.value = level;
          split.connect(gain, channel); gain.connect(merge, 0, ear);
        }
      }
      merge.connect(off.destination);
    } else source.connect(off.destination);
    source.start();
    return off.startRendering();
  }
  function disposeNode(node) {
    if (!node || node._warpScrubDisposed) return;
    node._warpScrubDisposed = true;
    try { node.port.postMessage({type:'dispose'}); } catch (_) {}
    try { node.disconnect(); } catch (_) {}
  }
  function loadModule(ctx, url) {
    let byUrl = modules.get(ctx);
    if (!byUrl) { byUrl = new Map(); modules.set(ctx, byUrl); }
    if (!byUrl.has(url)) {
      const promise = Promise.resolve().then(() => ctx.audioWorklet.addModule(url));
      byUrl.set(url, promise);
      promise.catch(() => { if (byUrl.get(url) === promise) byUrl.delete(url); });
    }
    return byUrl.get(url);
  }

  function create(options = {}) {
    if (!options.workletUrl) throw new Error('A scrub worklet URL is required');
    const maxBufferBytes = options.maxBufferBytes === undefined ? Infinity : options.maxBufferBytes;
    if (!(maxBufferBytes > 0)) throw new Error('Scrub memory budget must be positive');
    function checkBudget(bytes) {
      if (!Number.isFinite(bytes) || bytes > maxBufferBytes) throw new Error('Continuous scrub exceeds its memory budget');
    }
    const state = {ctx:null, buffer:null, requestedBuffer:null, node:null, promise:null,
      active:false, generation:0, gain:null, bytes:0, retiringBytes:0, error:null};
    let stoppedTimer = null, disposed = false, destination = null, envelope = null, centerFocus = false;
    let fadeUntil = 0, fadeContext = null;
    let preparation = Promise.resolve();
    function cancelStop() { if (stoppedTimer !== null) clearTimeout(stoppedTimer); stoppedTimer = null; }
    function levelAt(time) {
      if (!envelope) return 0;
      const progress = Math.max(0, Math.min(1, (time - envelope.start) / envelope.duration));
      return envelope.from + (envelope.to - envelope.from) * progress;
    }
    function setLevel(level, duration = tuning.fade, force = false) {
      if (!state.gain) return;
      const now = state.ctx.currentTime, from = levelAt(now);
      const to = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
      if (!force && envelope && envelope.to === to) return;
      state.gain.gain.cancelScheduledValues(now);
      state.gain.gain.setValueAtTime(from, now);
      const start = to > 0 && fadeContext === state.ctx ? Math.max(now, fadeUntil) : now;
      state.gain.gain.setValueAtTime(from, start);
      state.gain.gain.linearRampToValueAtTime(to, start + duration);
      envelope = {from, to, start, duration};
    }
    function reset() {
      cancelStop(); state.generation++;
      const node = state.node, gain = state.gain, bytes = state.bytes;
      const level = state.ctx ? levelAt(state.ctx.currentTime) : 0;
      if (node && gain && level > 0 && state.ctx.state !== 'closed') {
        // Release old PCM after its audible fade. A new stream waits out this
        // window, so a source change never crossfades unrelated dialogue.
        setLevel(0, 0.015, true);
        fadeContext = state.ctx; fadeUntil = state.ctx.currentTime + 0.015;
        const retiringContext = fadeContext, retirement = fadeUntil;
        state.retiringBytes += bytes;
        setTimeout(() => {
          disposeNode(node);
          try { gain.disconnect(); } catch (_) {}
          state.retiringBytes -= bytes;
          if (fadeContext === retiringContext && fadeUntil === retirement) { fadeContext = null; fadeUntil = 0; }
        }, 20);
      } else {
        disposeNode(node);
        if (gain) { try { gain.disconnect(); } catch (_) {} }
      }
      state.ctx = null; state.buffer = null; state.requestedBuffer = null;
      state.node = null; state.promise = null; state.gain = null;
      state.active = false; state.bytes = 0; state.error = null;
      destination = null; envelope = null;
    }
    function load(ctx, buffer) {
      if (disposed) return Promise.resolve(false);
      if (!ctx || !buffer || !buffer.length || ctx.state === 'closed') { reset(); return Promise.resolve(false); }
      if (state.ctx === ctx && state.buffer === buffer && state.node) return Promise.resolve(true);
      if (state.ctx === ctx && state.requestedBuffer === buffer && state.promise) return state.promise;
      // A failed buffer stays on the adapter's fallback until an explicit reset
      // or a new buffer. A 50 ms audition clock must not retry a failed load forever.
      if (state.ctx === ctx && state.requestedBuffer === buffer && state.error) return Promise.resolve(false);
      reset(); state.ctx = ctx; state.requestedBuffer = buffer;
      const generation = state.generation;
      const current = () => !disposed && state.generation === generation && state.requestedBuffer === buffer;
      const pending = Promise.resolve().then(() => {
        if (!current()) return null;
        // Check context-rate output before loading, folding or transferring PCM.
        checkBudget(listeningBytes(buffer, ctx.sampleRate));
        return loadModule(ctx, options.workletUrl);
      }).then(() => {
        if (!current()) return null;
        // Offline rendering cannot be cancelled. Serialize preparation and
        // skip superseded requests before allocating their listening copies.
        const queued = preparation.then(() => current() ? (options.prepareBuffer || listeningBuffer)(buffer, ctx, current) : null);
        preparation = queued.then(() => null, () => null);
        return queued;
      }).then(ready => {
        if (!ready || !current()) return false;
        if (ready.numberOfChannels > 2) throw new Error('Scrub processing requires a mono or stereo listening buffer');
        if (ready.sampleRate !== ctx.sampleRate) throw new Error('Scrub listening sample rate must match its audio context');
        // A custom preparation hook must honor the same allocation limit.
        checkBudget(ready.length * ready.numberOfChannels * 4);
        let node;
        try {
          node = new AudioWorkletNode(ctx, 'phase-vocoder-processor', {numberOfInputs:0, outputChannelCount:[ready.numberOfChannels]});
          const channels = [], transfers = [];
          for (let c = 0; c < ready.numberOfChannels; c++) {
            const copy = ready.getChannelData(c).slice(); channels.push(copy.buffer); transfers.push(copy.buffer);
          }
          node.port.postMessage({type:'load', channels}, transfers);
          node.port.postMessage({type:'centerFocus', value:centerFocus});
          // Publish only after every fallible allocation has succeeded. A
          // failed output setup must leave the adapter on its snippet fallback.
          const gain = ctx.createGain(); gain.gain.value = 0;
          state.node = node; state.buffer = buffer; state.bytes = ready.length * ready.numberOfChannels * 4;
          state.gain = gain; state.promise = null;
          node.onprocessorerror = () => {
            if (state.node !== node) return;
            reset(); state.ctx = ctx; state.requestedBuffer = buffer;
            state.error = 'Scrub processor failed';
            if (options.onError) options.onError(state.error);
          };
          return true;
        } catch (error) { disposeNode(node); throw error; }
      }).catch(error => {
        if (!current()) return false;
        state.promise = null; state.error = String(error && error.message || error);
        if (options.onError) options.onError(state.error);
        return false;
      });
      state.promise = pending;
      return pending;
    }
    function update(request) {
      const {offset, tempo, direction = 1, limitOffset = null} = request;
      if (!state.node || disposed) return null;
      if (state.ctx.state === 'closed') { reset(); return null; }
      if (!Number.isFinite(offset) || offset < 0 || offset >= state.buffer.duration || !Number.isFinite(tempo) || tempo <= 0) { stop(); return null; }
      cancelStop(); state.generation++;
      const node = state.node;
      const nextDestination = request.destination || state.ctx.destination;
      if (destination !== nextDestination) {
        if (destination) state.gain.disconnect();
        state.gain.connect(nextDestination); destination = nextDestination;
      }
      node.port.postMessage({type:'limit', pos:Number.isFinite(limitOffset) ? limitOffset * state.ctx.sampleRate : null});
      node.port.postMessage({type:'tempo', value:Math.max(tuning.minRate, Math.min(tuning.maxRate, tempo))});
      if (!state.active) {
        node.connect(state.gain);
        node.port.postMessage({type:'anchor', pos:offset * state.ctx.sampleRate, direction});
        node.port.postMessage({type:'play', value:true});
        state.active = true;
      } else if (!request.continuous) node.port.postMessage({type:'anchor', pos:offset * state.ctx.sampleRate, direction});
      setLevel(request.level === undefined ? 1 : request.level);
      return node;
    }
    function stop() {
      if (!state.node || !state.active) return;
      state.active = false;
      const generation = ++state.generation, node = state.node;
      setLevel(0);
      cancelStop();
      stoppedTimer = setTimeout(() => {
        stoppedTimer = null;
        if (state.generation !== generation || state.active || state.node !== node) return;
        try { node.port.postMessage({type:'play', value:false}); node.disconnect(); } catch (_) {}
      }, (tuning.fade + 0.005) * 1000);
    }
    function setCenterFocus(value) {
      centerFocus = !!value;
      if (state.node) state.node.port.postMessage({type:'centerFocus', value:centerFocus});
    }
    const view = Object.freeze(Object.defineProperties({}, Object.fromEntries(
      Object.keys(state).map(key => [key, {enumerable:true, get:() => state[key]}]))));
    return Object.freeze({state:view, load, update, stop, reset, setCenterFocus,
      dispose() { reset(); disposed = true; }});
  }
  root.WarpScrubAudio = Object.freeze({version:'1.1.0', tuning, create, motionVelocity,
    grainTempo, continuous, streamTempo, listeningBuffer, listeningBytes, surroundMatrix, disposeNode});
})(globalThis);
