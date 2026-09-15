/* WSOLA (Waveform-Similarity Overlap-Add) time-stretch AudioWorklet.
   Pitch-preserving variable speed for the opus-sync playback path (Deep clean + Opus clips), where
   audio comes from a decoded AudioBuffer instead of the <video> element. A plain AudioBufferSourceNode
   resamples on playbackRate (chipmunk pitch); this stretches time while keeping pitch.

   Hand-rolled, no dependency. Contract: outputs real-time audio at the context sample rate. `tempo` =
   the video's playbackRate — tempo>1 ⇒ faster (time-compress), tempo<1 ⇒ slower (time-stretch), pitch
   unchanged. The source is fed once at the CONTEXT sample rate (resampled on the main thread if needed),
   so positions here are integer-ish context samples. The main thread owns tempo + read position (seeks);
   this owns only the stretch. Mono-driven similarity search (search on ch0, same offset on every
   channel) keeps stereo coherent. Hann at 50% overlap satisfies COLA, so tempo≈1 reconstructs cleanly.

   No per-frame allocation in process()/_frame() — fixed ring buffer + preallocated scratch — so the
   audio thread never triggers GC (which would glitch). */
class WsolaProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = [];          // source channels (Float32Array, context rate)
    this.len = 0;
    this.nCh = 0;
    this.inPos = 0;        // analysis read pointer (source samples, float)
    this.prevPos = 0;      // last chosen extraction pos — the continuity reference anchor
    this.tempo = 1;
    this.direction = 1;    // +1 forward, -1 reverse (scrub only; ordinary playback stays forward)
    this.playing = false;
    this.disposed = false;
    this.playAt = 0;
    this.ready = false;
    this.pendingAnchor = null; // latest live re-anchor; applied between a one-block fade-out/in
    this.fadeInNext = false;
    this._initWindows();   // sizes depend only on sampleRate (a worklet global)
    this.port.onmessage = (e) => this._msg(e.data);
  }
  _initWindows() {
    const sr = sampleRate;                       // AudioWorklet global = context rate
    this.W = Math.max(256, Math.round(0.025 * sr));   // ~25 ms analysis window
    this.Hs = this.W >> 1;                            // synthesis hop = 50% overlap
    this.delta = Math.round(0.010 * sr);              // ±10 ms similarity search radius
    this.win = new Float32Array(this.W);
    for (let i = 0; i < this.W; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.W - 1));
    // OLA accumulators (one window's worth per channel) + an output ring buffer.
    this.cap = this.W * 8;
    this.acc = [];
    this.ring = [];
    this.rIdx = 0; this.wIdx = 0; this.count = 0;
  }
  _allocChannels(n) {
    this.nCh = n;
    this.acc = [];
    this.ring = [];
    for (let c = 0; c < n; c++) {
      this.acc.push(new Float32Array(this.W));
      this.ring.push(new Float32Array(this.cap));
    }
    this.rIdx = 0; this.wIdx = 0; this.count = 0;
  }
  _resetStream() {                                // on seek/load: drop in-flight OLA + ring
    for (let c = 0; c < this.nCh; c++) this.acc[c].fill(0);
    this.rIdx = 0; this.wIdx = 0; this.count = 0;
  }
  _setAnchor(pos, direction) {
    this.direction = direction < 0 ? -1 : 1;
    this.inPos = Math.max(0, Math.min(this.len - 1, pos));
    this.prevPos = this.inPos;
    this.pendingAnchor = null;
    this.fadeInNext = false;
    this._resetStream();
  }
  _queueAnchor(pos, direction) {
    const anchor = {
      pos: Math.max(0, Math.min(this.len - 1, pos)),
      direction: direction < 0 ? -1 : 1,
    };
    if (this.playing && this.ready) this.pendingAnchor = anchor;
    else this._setAnchor(anchor.pos, anchor.direction);
  }
  _positionInRange(pos = this.inPos) {
    return this.direction > 0 ? pos < this.len : pos >= 0;
  }
  _msg(d) {
    if (d.type === 'dispose') {
      this.playing = false; this.ready = false; this.disposed = true;
      this.ch = []; this.len = 0; this.pendingAnchor = null;
      this._allocChannels(0);
      this.port.postMessage({ type:'disposed' });
      this.port.close();
    } else if (d.type === 'load') {
      this.ch = d.channels.map((b) => new Float32Array(b));
      this.len = this.ch[0] ? this.ch[0].length : 0;
      this._allocChannels(this.ch.length);
      this.direction = 1;
      this.inPos = 0; this.prevPos = 0;
      this.pendingAnchor = null; this.fadeInNext = false;
      this.ready = this.len > 0;
    } else if (d.type === 'seek') {
      this._queueAnchor(d.pos, this.direction);
    } else if (d.type === 'anchor') {
      this._queueAnchor(d.pos, d.direction);
    } else if (d.type === 'tempo') {
      this.tempo = d.value > 0 ? d.value : 1;
    } else if (d.type === 'play') {
      this.playing = !!d.value;
      this.playAt = this.playing && Number.isFinite(d.at) ? d.at : 0;
    }
  }
  // Produce one WSOLA frame: Hs new output samples per channel, written into the ring.
  _frame() {
    const { W, Hs, delta, win, nCh, len, direction } = this;
    const tempo = this.tempo;
    // Similarity search (mono, on ch0): pick offset k∈[-delta,delta] so source@(inPos+k) best
    // continues the waveform we already emitted (the natural continuation = prevPos+Hs). Skipped at
    // tempo≈1 (k=0 reconstructs the signal under COLA).
    let bestK = 0;
    if (Math.abs(tempo - 1) > 1e-3) {
      const c0 = this.ch[0];
      const refBase = this.prevPos + direction * Hs;
      const L = Hs;
      let best = -Infinity;
      for (let k = -delta; k <= delta; k++) {
        const base = Math.round(this.inPos) + k;
        const baseEnd = base + direction * (L - 1);
        if (base < 0 || base >= len || baseEnd < 0 || baseEnd >= len) continue;
        let num = 0;
        for (let i = 0; i < L; i += 4) {            // stride 4 — plenty for a correlation peak
          const refAt = refBase + direction * i;
          const r = (refAt >= 0 && refAt < len) ? c0[refAt] : 0;
          num += c0[base + direction * i] * r;
        }
        if (num > best) { best = num; bestK = k; }
      }
    }
    const pos = Math.round(this.inPos) + bestK;
    for (let c = 0; c < nCh; c++) {
      const src = this.ch[c], acc = this.acc[c], ring = this.ring[c];
      for (let i = 0; i < W; i++) {
        const srcAt = pos + direction * i;
        const s = (srcAt >= 0 && srcAt < len) ? src[srcAt] : 0;
        acc[i] += s * win[i];
      }
      // Emit first Hs of the accumulator into the ring (same write head for every channel — wIdx is
      // advanced once, after this loop), then shift the overlap tail down.
      let wi = this.wIdx;
      for (let i = 0; i < Hs; i++) { ring[wi] = acc[i]; wi = (wi + 1) % this.cap; }
      for (let i = 0; i < W - Hs; i++) acc[i] = acc[i + Hs];
      for (let i = W - Hs; i < W; i++) acc[i] = 0;
    }
    this.wIdx = (this.wIdx + Hs) % this.cap;
    this.count = Math.min(this.cap, this.count + Hs);
    this.prevPos = pos;
    this.inPos += direction * Hs * tempo;            // analysis hop = direction·Hs·tempo
  }
  process(_inputs, outputs) {
    if (this.disposed) return false;
    const out = outputs[0];
    const frames = out[0].length;                    // 128
    if (!this.ready || !this.playing || currentTime < this.playAt) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    let guard = 0;
    while (this.count < frames && this._positionInRange() && guard++ < 128) this._frame();
    for (let c = 0; c < out.length; c++) {
      const ring = this.ring[Math.min(c, this.nCh - 1)];
      const oc = out[c];
      let ri = this.rIdx;
      for (let i = 0; i < frames; i++) {
        if (i < this.count) { oc[i] = ring[ri]; ri = (ri + 1) % this.cap; }
        else oc[i] = 0;
      }
      // A live scrub jump/reversal changes the source anchor only BETWEEN render quanta: fade the
      // old quantum down, reset after every channel has emitted it, then fade the new quantum in.
      // This avoids both a hard discontinuity and overlapping two independent speech positions.
      if (this.pendingAnchor) {
        for (let i = 0; i < frames; i++) oc[i] *= (frames - 1 - i) / Math.max(1, frames - 1);
      } else if (this.fadeInNext) {
        for (let i = 0; i < frames; i++) oc[i] *= i / Math.max(1, frames - 1);
      }
    }
    const consumed = Math.min(frames, this.count);
    this.rIdx = (this.rIdx + consumed) % this.cap;
    this.count -= consumed;
    if (this.pendingAnchor) {
      const anchor = this.pendingAnchor;
      this.pendingAnchor = null;
      this._setAnchor(anchor.pos, anchor.direction);
      this.fadeInNext = true;
    } else if (this.fadeInNext) {
      this.fadeInNext = false;
    }
    return true;
  }
}
registerProcessor('wsola-processor', WsolaProcessor);

/* Scrub-specific phase vocoder. WSOLA is a good low-latency choice for ordinary playback, but at
   very slow pointer speeds its waveform-matching grains audibly replay speech attacks. This engine
   advances one continuous spectral stream instead: time changes with the analysis hop while phase
   advances at the detected frequency, so pitch stays fixed without choosing/repeating source chunks.
   N=2048 and a 1/4 synthesis hop keep latency interactive and Hann² overlap-add gain constant. */
class PhaseVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = []; this.len = 0; this.nCh = 0; this.midSide = false; this.centerFocus = false;
    this.inPos = 0; this.tempo = 1; this.direction = 1; this.limitPos = null;
    this.playing = false; this.ready = false;
    this.disposed = false;
    this.pendingAnchor = null; this.fadeInNext = false;
    this.N = 2048; this.Hs = this.N >> 2; this.bins = (this.N >> 1) + 1;
    this.win = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    this.re = new Float32Array(this.N); this.im = new Float32Array(this.N);
    this.cap = this.N * 8; this.acc = []; this.ring = [];
    this.prevPhase = []; this.sumPhase = [];
    this.rIdx = 0; this.wIdx = 0; this.count = 0;
    this.firstFrame = true; this.lastHa = this.Hs;
    this.port.onmessage = (e) => this._msg(e.data);
  }
  _allocChannels(n) {
    this.nCh = n; this.acc = []; this.ring = []; this.prevPhase = []; this.sumPhase = [];
    for (let c = 0; c < n; c++) {
      this.acc.push(new Float32Array(this.N));
      this.ring.push(new Float32Array(this.cap));
      this.prevPhase.push(new Float32Array(this.bins));
      this.sumPhase.push(new Float32Array(this.bins));
    }
    this._resetStream();
  }
  _resetStream() {
    for (let c = 0; c < this.nCh; c++) {
      this.acc[c].fill(0); this.prevPhase[c].fill(0); this.sumPhase[c].fill(0);
    }
    this.rIdx = 0; this.wIdx = 0; this.count = 0;
    this.firstFrame = true; this.lastHa = this.Hs * this.tempo;
  }
  _setAnchor(pos, direction) {
    this.direction = direction < 0 ? -1 : 1;
    this.inPos = Math.max(0, Math.min(this.len - 1, pos));
    this.pendingAnchor = null; this.fadeInNext = false;
    this._resetStream();
  }
  _queueAnchor(pos, direction) {
    const anchor = { pos:Math.max(0, Math.min(this.len - 1, pos)), direction:direction < 0 ? -1 : 1 };
    if (this.playing && this.ready) this.pendingAnchor = anchor;
    else this._setAnchor(anchor.pos, anchor.direction);
  }
  _msg(d) {
    if (d.type === 'dispose') {
      this.playing = false; this.ready = false; this.disposed = true;
      this.ch = []; this.len = 0; this.midSide = false; this.pendingAnchor = null;
      this._allocChannels(0);
      this.port.postMessage({ type:'disposed' });
      this.port.close();
    } else if (d.type === 'load') {
      const channels = d.channels.map((b) => new Float32Array(b));
      this.midSide = channels.length === 2;
      if(this.midSide){
        // A center signal is L===R. Processing L/R with independent spectral phase histories makes
        // that shared signal decorrelate and sound diffuse. Put shared content wholly in Mid, process
        // Mid/Side continuously, then decode after stretching so the phantom center remains exact.
        const left = channels[0], right = channels[1];
        const mid = new Float32Array(left.length), side = new Float32Array(left.length);
        for(let i = 0; i < left.length; i++){ mid[i] = (left[i] + right[i]) * 0.5; side[i] = (left[i] - right[i]) * 0.5; }
        this.ch = [mid, side];
      } else this.ch = channels;
      this.len = this.ch[0] ? this.ch[0].length : 0;
      this._allocChannels(this.ch.length);
      this.inPos = 0; this.direction = 1; this.limitPos = null; this.pendingAnchor = null; this.fadeInNext = false;
      this.ready = this.len > 0;
    } else if (d.type === 'seek') this._queueAnchor(d.pos, this.direction);
    else if (d.type === 'anchor') this._queueAnchor(d.pos, d.direction);
    else if (d.type === 'tempo') this.tempo = d.value > 0 ? d.value : 1;
    else if (d.type === 'centerFocus') this.centerFocus = !!d.value;
    else if (d.type === 'limit') this.limitPos = Number.isFinite(d.pos)
      ? Math.max(0, Math.min(this.len - 1, d.pos)) : null;
    else if (d.type === 'play') this.playing = !!d.value;
  }
  _fft(re, im, inverse) {
    const n = this.N;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let v = re[i]; re[i] = re[j]; re[j] = v;
        v = im[i]; im[i] = im[j]; im[j] = v;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / size;
      const stepR = Math.cos(angle), stepI = Math.sin(angle), half = size >> 1;
      for (let base = 0; base < n; base += size) {
        let wr = 1, wi = 0;
        for (let k = 0; k < half; k++) {
          const even = base + k, odd = even + half;
          const tr = wr * re[odd] - wi * im[odd];
          const ti = wr * im[odd] + wi * re[odd];
          const er = re[even], ei = im[even];
          re[even] = er + tr; im[even] = ei + ti;
          re[odd] = er - tr; im[odd] = ei - ti;
          const nextWr = wr * stepR - wi * stepI;
          wi = wr * stepI + wi * stepR; wr = nextWr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  _frame() {
    const { N, Hs, bins, len, direction, win } = this;
    const requestedHa = Hs * this.tempo;
    const remaining = Number.isFinite(this.limitPos)
      ? direction * (this.limitPos - this.inPos) : Infinity;
    // A slow H.264 seek can leave the picture held while main-thread timers are delayed. Never let
    // the audio worklet coast past the last confirmed video frame. A one-sample analysis hop freezes
    // the spectrum continuously at the limit without an anchor, restart, repeated syllable, or gap.
    const ha = Math.max(1, Math.min(requestedHa, Math.max(0, remaining)));
    const expectedHa = Math.max(1e-6, this.lastHa);
    for (let c = 0; c < this.nCh; c++) {
      const src = this.ch[c], re = this.re, im = this.im;
      for (let i = 0; i < N; i++) {
        const at = this.inPos + direction * i;
        const lo = Math.floor(at), frac = at - lo;
        const a = lo >= 0 && lo < len ? src[lo] : 0;
        const b = lo + 1 >= 0 && lo + 1 < len ? src[lo + 1] : 0;
        re[i] = (a + (b - a) * frac) * win[i]; im[i] = 0;
      }
      this._fft(re, im, false);
      const prev = this.prevPhase[c], sum = this.sumPhase[c];
      for (let k = 0; k < bins; k++) {
        const real = re[k], imag = im[k];
        const magnitude = Math.hypot(real, imag), phase = Math.atan2(imag, real);
        if (this.firstFrame) sum[k] = phase;
        else {
          const omega = 2 * Math.PI * k / N;
          let delta = phase - prev[k] - omega * expectedHa;
          delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
          sum[k] += (omega + delta / expectedHa) * Hs;
        }
        prev[k] = phase;
        // Advance each frequency continuously on its own measured phase. Grouping bins under
        // spectral peaks made loud speech acquire discrete, synthetic tones (v0.11.16–0.11.17).
        re[k] = magnitude * Math.cos(sum[k]); im[k] = magnitude * Math.sin(sum[k]);
      }
      im[0] = 0; im[N >> 1] = 0;
      for (let k = 1; k < N >> 1; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      this._fft(re, im, true);
      const acc = this.acc[c], ring = this.ring[c];
      for (let i = 0; i < N; i++) acc[i] += re[i] * win[i] * (2 / 3);
      let wi = this.wIdx;
      for (let i = 0; i < Hs; i++) { ring[wi] = acc[i]; wi = (wi + 1) % this.cap; }
      for (let i = 0; i < N - Hs; i++) acc[i] = acc[i + Hs];
      for (let i = N - Hs; i < N; i++) acc[i] = 0;
    }
    this.wIdx = (this.wIdx + Hs) % this.cap;
    this.count = Math.min(this.cap, this.count + Hs);
    this.firstFrame = false; this.lastHa = ha;
    this.inPos += direction * ha;
  }
  _positionInRange() {
    return this.direction > 0 ? this.inPos < this.len : this.inPos >= 0;
  }
  process(_inputs, outputs) {
    if (this.disposed) return false;
    const out = outputs[0], frames = out[0].length;
    if (!this.ready || !this.playing) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    let guard = 0;
    while (this.count < frames && this._positionInRange() && guard++ < 128) this._frame();
    for (let c = 0; c < out.length; c++) {
      const ring = this.ring[Math.min(c, this.nCh - 1)], oc = out[c]; let ri = this.rIdx;
      const mid = this.midSide ? this.ring[0] : null, side = this.midSide ? this.ring[1] : null;
      for (let i = 0; i < frames; i++) {
        if (i < this.count) {
          oc[i] = this.midSide
            ? this.centerFocus ? mid[ri] : (c === 0 ? mid[ri] + side[ri] : mid[ri] - side[ri])
            : ring[ri];
          ri = (ri + 1) % this.cap;
        } else oc[i] = 0;
      }
      if (this.pendingAnchor) {
        for (let i = 0; i < frames; i++) oc[i] *= (frames - 1 - i) / Math.max(1, frames - 1);
      } else if (this.fadeInNext) {
        for (let i = 0; i < frames; i++) oc[i] *= i / Math.max(1, frames - 1);
      }
    }
    const consumed = Math.min(frames, this.count);
    this.rIdx = (this.rIdx + consumed) % this.cap; this.count -= consumed;
    if (this.pendingAnchor) {
      const anchor = this.pendingAnchor; this.pendingAnchor = null;
      this._setAnchor(anchor.pos, anchor.direction); this.fadeInNext = true;
    } else if (this.fadeInNext) this.fadeInNext = false;
    return true;
  }
}
registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
