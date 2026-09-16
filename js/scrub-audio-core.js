/* WarpScrubAudio 1.2.0 — classic script, no app globals or build step.
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

  // Listening policy is shared by live media, short previews and the continuous
  // processor. A verified center is retained beside the full stereo mix, so
  // controls can change before time stretching without another decode or seek.
  function monitorSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const number = (v, fallback, min, max) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
    return Object.freeze({mode:['full','dialogue','center'].includes(value.mode) ? value.mode : 'full',
      centerDb:number(value.centerDb, 0, 0, 12), otherDb:number(value.otherDb, -9, -60, 0)});
  }
  function monitorRows(channels) {
    return channels === 8 ? surroundMatrix(8)
      : channels === 6 ? [[0,1,0],[1,0,1],[2,c,c],[4,c,0],[5,0,c]]
      : channels === 4 ? [[0,.5,0],[1,0,.5],[2,.5,0],[3,0,.5]]
      : channels === 2 ? [[0,1,0],[1,0,1]] : [[0,1,0]];
  }
  function monitorPlan(value, peaks = null) {
    const settings = monitorSettings(value);
    if (settings.mode === 'full') return Object.freeze({otherGain:1, centerGain:1, centerDelta:0, headroomDb:0});
    const center = 10 ** (settings.centerDb / 20);
    const other = settings.mode === 'center' || settings.otherDb <= -60 ? 0 : 10 ** (settings.otherDb / 20);
    // Bounds from original PCM, independent of master volume. Unknown peaks
    // use a conservative bound; adapters normally publish only after measuring.
    const known = peaks && Number.isFinite(peaks.other) && peaks.other>=0 && Number.isFinite(peaks.center) && peaks.center>=0;
    const bound = known ? other * peaks.other + c * center * peaks.center : other * (1+c) + c*center;
    const headroom = Math.min(1, .98 / Math.max(.98, bound));
    return Object.freeze({otherGain:other*headroom, centerGain:center*headroom,
      centerDelta:c*(center-other)*headroom, headroomDb:20*Math.log10(headroom)});
  }
  async function monitorPeaks(buffer, layout, isCurrent = () => true) {
    if (!['5.1','7.1','stereo-center'].includes(layout)) return null;
    if (!buffer || buffer.numberOfChannels !== ({'5.1':6,'7.1':8,'stereo-center':3})[layout]) return null;
    const data = Array.from({length:buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
    const rows = monitorRows(buffer.numberOfChannels).filter(row => row[0] !== 2);
    let center = 0, other = 0;
    for (let start=0; start<buffer.length; start+=65536) {
      if (!isCurrent()) return null;
      for (let i=start; i<Math.min(buffer.length,start+65536); i++) {
        center = Math.max(center, Math.abs(data[2][i]));
        let left=0, right=0;
        if (layout === 'stereo-center') { left=data[0][i]-c*data[2][i]; right=data[1][i]-c*data[2][i]; }
        else for (const [ch,l,r] of rows) { left+=data[ch][i]*l; right+=data[ch][i]*r; }
        other = Math.max(other, Math.abs(left), Math.abs(right));
      }
      if (start+65536<buffer.length) await new Promise(resolve => setTimeout(resolve,0));
    }
    return Number.isFinite(center) && Number.isFinite(other) ? Object.freeze({center,other}) : null;
  }
  function monitorConnect(source, destination, channels, layout, initial = monitorPlan()) {
    const ctx=source.context, nodes=[], entries=[];
    if (![6,8].includes(channels) && !(channels===3 && layout==='stereo-center')) {
      source.connect(destination); let connected=true;
      return {setMix(){}, disconnect(){if(connected){connected=false;source.disconnect(destination);}}};
    }
    const split=ctx.createChannelSplitter(channels), merge=ctx.createChannelMerger(2);
    nodes.push(split,merge); source.connect(split); merge.connect(destination);
    const rows=layout==='stereo-center' ? [[0,1,0],[1,0,1],[2,1,1]] : monitorRows(channels);
    const level=(row,weight,mix)=>weight*(row===2 ? layout==='stereo-center'?mix.centerDelta:mix.centerGain : mix.otherGain);
    for (const [channel,left,right] of rows) for (const [ear,weight] of [[0,left],[1,right]]) {
      if (!weight) continue;
      const gain=ctx.createGain(), value=level(channel,weight,initial);
      gain.gain.value=value; split.connect(gain,channel); gain.connect(merge,0,ear); nodes.push(gain);
      entries.push({gain,channel,weight,from:value,to:value,start:ctx.currentTime});
    }
    let connected=true;
    return {
      setMix(mix) {
        const now=ctx.currentTime;
        for(const e of entries) {
          const target=level(e.channel,e.weight,mix); if(target===e.to) continue;
          const held=e.from+(e.to-e.from)*Math.max(0,Math.min(1,(now-e.start)/.03));
          e.gain.gain.cancelScheduledValues(now); e.gain.gain.setValueAtTime(held,now);
          e.gain.gain.linearRampToValueAtTime(target,now+.03);
          e.from=held;e.to=target;e.start=now;
        }
      },
      disconnect(){if(!connected)return;connected=false;source.disconnect(split);nodes.forEach(node=>node.disconnect());}
    };
  }
  // A codec's declared layout, never channel count alone, enables Center Only.
  // FLAC metadata starts with a STREAMINFO block. Nonstandard masks fail closed.
  function flacMonitorLayout(bytes) {
    let offset=0, channels=0, mask=null, last=false;
    try {
      while(offset+4<=bytes.length && !last) {
        last=!!(bytes[offset]&128); const type=bytes[offset]&127;
        const length=bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3]; offset+=4;
        if(offset+length>bytes.length) return null;
        if(type===0 && length===34) channels=((bytes[offset+12]>>1)&7)+1;
        if(type===4) {
          const v=new DataView(bytes.buffer,bytes.byteOffset+offset,length); let at=4+v.getUint32(0,true);
          const count=v.getUint32(at,true); at+=4;
          for(let i=0;i<count;i++) {
            const size=v.getUint32(at,true);at+=4;if(at+size>length)return null;
            const text=new TextDecoder().decode(bytes.subarray(offset+at,offset+at+size));at+=size;
            if(/^WAVEFORMATEXTENSIBLE_CHANNEL_MASK=/i.test(text)) {
              const value=text.split('=')[1]; if(!/^(0x[\da-f]+|\d+)$/i.test(value))return null;
              const next=Number(value);if(mask!==null&&mask!==next)return null;mask=next;
            }
          }
        }
        offset+=length;
      }
    } catch (_) { return null; }
    if(!last) return null;
    return channels===6 && (mask===null||mask===0x3f||mask===0x60f) ? '5.1'
      : channels===8 && (mask===null||mask===0x63f) ? '7.1' : null;
  }
  function waveMonitorLayout(bytes) {
    try {
      const text=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
      if(text(0,4)==='fLaC') return flacMonitorLayout(bytes.subarray(4));
      if(text(0,4)!=='RIFF'||text(8,4)!=='WAVE') return null;
      const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let at=12;at+8<=bytes.length;) {
        const size=v.getUint32(at+4,true), start=at+8;if(start+size>bytes.length)return null;
        if(text(at,4)==='fmt ' && size>=40 && v.getUint16(start,true)===0xfffe) {
          const channels=v.getUint16(start+2,true), mask=v.getUint32(start+20,true);
          return channels===6 && [0x3f,0x60f].includes(mask) ? '5.1' : channels===8 && mask===0x63f ? '7.1' : null;
        }
        at=start+size+(size%2);
      }
    } catch (_) {}
    return null;
  }
  function aacMonitorLayout(bytes) {
    // MPEG-4 ES descriptors: accept the declared standard 5.1 configuration.
    // PCE/custom and other eight-channel arrangements need an explicit mapping.
    function walk(start,end) {
      for(let at=start;at<end;) {
        const tag=bytes[at++];let length=0,terminated=false;
        for(let i=0;i<4&&at<end;i++){const value=bytes[at++];length=length*128+(value&127);if(!(value&128)){terminated=true;break;}}
        if(!terminated||at+length>end)return null;
        const limit=at+length;
        if(tag===5 && length>=2) {
          let bit=0; const read=n=>{let value=0;for(let i=0;i<n;i++){if(bit>=length*8)throw Error();value=value*2+((bytes[at+(bit>>3)]>>(7-(bit&7)))&1);bit++;}return value;};
          let object=read(5);if(object===31)object=32+read(6);
          const frequency=read(4);if(frequency===15)read(24);
          const configuration=read(4);
          return [1,2,3,4,5,29].includes(object)&&configuration===6?'5.1':null;
        }
        if(tag===3 && length>=3) {
          let child=at+3;const flags=bytes[at+2];if(flags&128)child+=2;if(flags&64)child+=1+bytes[child];if(flags&32)child+=2;
          const result=walk(child,limit);if(result)return result;
        } else if(tag===4 && length>=13) {const result=walk(at+13,limit);if(result)return result;}
        at=limit;
      }
      return null;
    }
    try{return walk(4,bytes.length);}catch(_){return null;}
  }
  const monitor=Object.freeze({settings:monitorSettings,plan:monitorPlan,rows:monitorRows,
    peaks:monitorPeaks,connect:monitorConnect,flacLayout:flacMonitorLayout,waveLayout:waveMonitorLayout,aacLayout:aacMonitorLayout});

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
  function listeningChannels(buffer, layout) {
    if (!layout) return Math.min(2, buffer.numberOfChannels);
    if ((layout==='stereo-center' && buffer.numberOfChannels===3)
      || (layout==='5.1' && buffer.numberOfChannels===6) || (layout==='7.1' && buffer.numberOfChannels===8)) return 3;
    return Infinity;
  }
  function listeningRows(buffer, layout) {
    if(layout==='stereo-center') return [[0,1,0,0],[1,0,1,0],[2,0,0,1]];
    return monitorRows(buffer.numberOfChannels).map(row=>[...row,layout&&row[0]===2?1:0]);
  }
  function listeningBytes(buffer, sampleRate, layout = null) {
    if (!buffer || !(buffer.length > 0) || !(buffer.sampleRate > 0) || !(sampleRate > 0)
      || ![1,2,4,6,8].includes(buffer.numberOfChannels) && !(buffer.numberOfChannels===3 && layout==='stereo-center')) return Infinity;
    return Math.ceil(buffer.length * sampleRate / buffer.sampleRate) * listeningChannels(buffer,layout) * 4;
  }
  // AudioBufferSource rate conversion can interpolate without an anti-alias
  // filter. Use a centered windowed-sinc filter when reducing the sample rate.
  // Prepare in bounded slices, yielding between slices so long previews do not
  // monopolize the UI. No full-rate intermediate listening copy is allocated.
  async function filteredListeningBuffer(buffer, sampleRate, isCurrent, layout) {
    const channels = listeningChannels(buffer,layout);
    const length = listeningBytes(buffer, sampleRate,layout) / (channels * 4);
    const out = new AudioBuffer({numberOfChannels:channels, length, sampleRate});
    const ratio = sampleRate / buffer.sampleRate, radius = Math.ceil(16 / ratio);
    const cutoff = 0.47 * ratio, kernels = new Map();
    // Web Audio speaker equations for quad/5.1; the shared explicit matrix for
    // 7.1. Fold after each channel's identical filter to retain stereo phase.
    const rows = listeningRows(buffer,layout);
    const inputs = rows.map(([channel,left,right,center]) => ({data:buffer.getChannelData(channel), left, right, center}));
    const left = out.getChannelData(0), right = channels === 2 ? out.getChannelData(1) : null;
    const monitorRight = channels === 3 ? out.getChannelData(1) : right;
    const center = channels === 3 ? out.getChannelData(2) : null;
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
          if (monitorRight) monitorRight[i] += value * input.right;
          if (center) center[i] += value * input.center;
        }
      }
      if (start + 2048 < length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return out;
  }
  async function listeningBuffer(buffer, ctx, isCurrent = () => true, layout = null) {
    if (!isCurrent()) return null;
    if (!Number.isFinite(listeningBytes(buffer,ctx.sampleRate,layout))) throw new Error('Unsupported listening channel layout');
    if ((buffer.numberOfChannels <= 2 || layout==='stereo-center') && buffer.sampleRate === ctx.sampleRate) return buffer;
    if (ctx.sampleRate < buffer.sampleRate) return filteredListeningBuffer(buffer, ctx.sampleRate, isCurrent,layout);
    const channels = listeningChannels(buffer,layout);
    const off = new OfflineAudioContext(channels, listeningBytes(buffer, ctx.sampleRate,layout) / (channels * 4), ctx.sampleRate);
    const source = off.createBufferSource(); source.buffer = buffer;
    if (buffer.numberOfChannels === 8 || layout) {
      const split = off.createChannelSplitter(buffer.numberOfChannels), merge = off.createChannelMerger(channels);
      source.connect(split);
      for (const [channel, left, right, center] of listeningRows(buffer,layout)) {
        for (const [ear, level] of [[0,left],[1,right],[2,center]]) if (level) {
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
    if (!node) return Promise.resolve(true);
    if (node._warpScrubDisposed) return node._warpScrubDisposal;
    node._warpScrubDisposed = true;
    // Closing a context before process() returns false can strand a Chromium
    // active-source root. Its error handler also captures the original PCM.
    // Let context owners await real retirement, and detach that closure now.
    node.onprocessorerror = null;
    node._warpScrubDisposal = new Promise(resolve => {
      const finish = ok => {
        clearTimeout(timer);
        node.port.removeEventListener('message', onMessage);
        try { node.port.close(); } catch (_) {}
        resolve(ok);
      };
      const onMessage = event => { if (event.data?.type === 'disposed') finish(true); };
      // A failed processor or prohibited/suspended context may never render.
      // Cleanup must remain bounded; source closures are released either way.
      const timer = setTimeout(() => finish(false), 1000);
      node.port.addEventListener('message', onMessage);
      node.port.start();
      try { node.port.postMessage({type:'dispose'}); } catch (_) { finish(false); }
      try { node.disconnect(); } catch (_) {}
    });
    return node._warpScrubDisposal;
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
    const state = {ctx:null, buffer:null, requestedBuffer:null, layout:null, node:null, promise:null,
      active:false, generation:0, gain:null, bytes:0, retiringBytes:0, error:null};
    let stoppedTimer = null, disposed = false, destination = null, envelope = null, centerFocus = false;
    let monitorMix = monitorPlan();
    let fadeUntil = 0, fadeContext = null;
    let preparation = Promise.resolve();
    const retirements = new Set();
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
      let release;
      if (node && gain && level > 0 && state.ctx.state !== 'closed') {
        // Release old PCM after its audible fade. A new stream waits out this
        // window, so a source change never crossfades unrelated dialogue.
        setLevel(0, 0.015, true);
        fadeContext = state.ctx; fadeUntil = state.ctx.currentTime + 0.015;
        const retiringContext = fadeContext, retirement = fadeUntil;
        state.retiringBytes += bytes;
        release = new Promise(resolve => setTimeout(() => {
          const retired = disposeNode(node);
          try { gain.disconnect(); } catch (_) {}
          state.retiringBytes -= bytes;
          if (fadeContext === retiringContext && fadeUntil === retirement) { fadeContext = null; fadeUntil = 0; }
          resolve(retired);
        }, 20));
      } else {
        release = disposeNode(node);
        if (gain) { try { gain.disconnect(); } catch (_) {} }
      }
      state.ctx = null; state.buffer = null; state.requestedBuffer = null;
      state.layout = null;
      state.node = null; state.promise = null; state.gain = null;
      state.active = false; state.bytes = 0; state.error = null;
      destination = null; envelope = null;
      retirements.add(release);
      release.then(() => retirements.delete(release));
      // Include earlier audible replacements still fading out. Reset remains
      // synchronous for state and reusable; only resource retirement is async.
      return Promise.all([...retirements]).then(results => results.every(Boolean));
    }
    function load(ctx, buffer, layout = null) {
      if (disposed) return Promise.resolve(false);
      if (!ctx || !buffer || !buffer.length || ctx.state === 'closed') { reset(); return Promise.resolve(false); }
      if (state.ctx === ctx && state.buffer === buffer && state.layout===layout && state.node) return Promise.resolve(true);
      if (state.ctx === ctx && state.requestedBuffer === buffer && state.layout===layout && state.promise) return state.promise;
      // A failed buffer stays on the adapter's fallback until an explicit reset
      // or a new buffer. A 50 ms audition clock must not retry a failed load forever.
      if (state.ctx === ctx && state.requestedBuffer === buffer && state.layout===layout && state.error) return Promise.resolve(false);
      reset(); state.ctx = ctx; state.requestedBuffer = buffer; state.layout=layout;
      const generation = state.generation;
      const current = () => !disposed && state.generation === generation && state.requestedBuffer === buffer;
      const pending = Promise.resolve().then(() => {
        if (!current()) return null;
        // Check context-rate output before loading, folding or transferring PCM.
        checkBudget(listeningBytes(buffer, ctx.sampleRate,layout));
        return loadModule(ctx, options.workletUrl);
      }).then(() => {
        if (!current()) return null;
        // Offline rendering cannot be cancelled. Serialize preparation and
        // skip superseded requests before allocating their listening copies.
        const queued = preparation.then(() => current() ? (options.prepareBuffer || listeningBuffer)(buffer, ctx, current,layout) : null);
        preparation = queued.then(() => null, () => null);
        return queued;
      }).then(ready => {
        if (!ready || !current()) return false;
        if (ready.numberOfChannels > 2 && !(layout && ready.numberOfChannels===3)) throw new Error('Scrub processing requires a mono/stereo mix or verified center preview');
        if (ready.sampleRate !== ctx.sampleRate) throw new Error('Scrub listening sample rate must match its audio context');
        // A custom preparation hook must honor the same allocation limit.
        checkBudget(ready.length * ready.numberOfChannels * 4);
        let node;
        try {
          node = new AudioWorkletNode(ctx, 'phase-vocoder-processor', {numberOfInputs:0, outputChannelCount:[Math.min(2,ready.numberOfChannels)]});
          const channels = [], transfers = [];
          for (let c = 0; c < ready.numberOfChannels; c++) {
            const copy = ready.getChannelData(c).slice(); channels.push(copy.buffer); transfers.push(copy.buffer);
          }
          node.port.postMessage({type:'load', channels, monitorCenter:!!layout}, transfers);
          node.port.postMessage({type:'monitorMix', otherGain:monitorMix.otherGain, centerDelta:monitorMix.centerDelta});
          node.port.postMessage({type:'centerFocus', value:centerFocus});
          // Publish only after every fallible allocation has succeeded. A
          // failed output setup must leave the adapter on its snippet fallback.
          const gain = ctx.createGain(); gain.gain.value = 0;
          state.node = node; state.buffer = buffer; state.bytes = ready.length * ready.numberOfChannels * 4;
          state.gain = gain; state.promise = null;
          node.onprocessorerror = () => {
            if (state.node !== node) return;
            reset(); state.ctx = ctx; state.requestedBuffer = buffer; state.layout = layout;
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
    function setMonitorMix(value) {
      if (!value || !Number.isFinite(value.otherGain) || !Number.isFinite(value.centerDelta)) return;
      monitorMix = {otherGain:Math.max(0,Math.min(1,value.otherGain)),centerDelta:Math.max(-4,Math.min(4,value.centerDelta))};
      if (state.node) state.node.port.postMessage({type:'monitorMix', ...monitorMix});
    }
    const view = Object.freeze(Object.defineProperties({}, Object.fromEntries(
      Object.keys(state).map(key => [key, {enumerable:true, get:() => state[key]}]))));
    return Object.freeze({state:view, load, update, stop, reset, setCenterFocus, setMonitorMix,
      dispose() { disposed = true; return reset(); }});
  }
  root.WarpScrubAudio = Object.freeze({version:'1.2.1', tuning, create, motionVelocity, monitor,
    grainTempo, continuous, streamTempo, listeningBuffer, listeningBytes, surroundMatrix, disposeNode});
})(globalThis);
