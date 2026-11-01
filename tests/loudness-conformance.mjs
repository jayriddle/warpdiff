// EBU Tech 3341 / Tech 3342 and ITU-R BS.1770 conformance signals.
//
// Signals are synthesized here. The EBU downloadable programme files are not
// used. Cases 7, 8, 3342-5 and 3342-6 are copyrighted programme excerpts and
// are not reproducible from the written specification.
//
// WarpDiff shows integrated loudness, loudness range, true peak, and a
// short-term envelope (one 3 s value per second). It does not show a momentary
// number, so Tech 3341 cases 12–14 are not asserted. Cases 10 and 11 ask for
// the maximum short-term reading of a tone that can sit between those one-second
// steps. Measured on the current envelope, case 10’s maximum short-term is
// −23.0, −23.2, −23.8 and −23.2 LUFS for silence offsets i = 0, 1, 10 and 19,
// against −23.0 ±0.1. That gap is reported rather than given a wider tolerance.
//
// Tolerances are the ones printed in Tech 3341 Table 1 and Tech 3342 Table 1:
// integrated and steady short-term ±0.1 LU, loudness range ±1 LU, true peak
// +0.2/−0.4 dBTP. Displayed loudness and true peak are the meter’s 0.1-step readings.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const api = runInNewContext(
    readFileSync(new URL('../js/audio-viz.js', import.meta.url), 'utf8') +
    '\n({computeAudioMetrics});',
    {});

const RATE = 48000;

function tone(levelDb, seconds, freq = 1000, phase = 0, fade = 0) {
    const amp = 10 ** (levelDb / 20);
    const n = Math.round(RATE * seconds);
    const data = new Float32Array(n);
    const fadeN = Math.round(fade * RATE);
    for (let i = 0; i < n; i++) {
        let window = 1;
        if (fadeN && i < fadeN) window = 0.5 - 0.5 * Math.cos(Math.PI * i / fadeN);
        else if (fadeN && i >= n - fadeN) window = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / fadeN);
        data[i] = amp * window * Math.sin(2 * Math.PI * freq * i / RATE + phase);
    }
    return data;
}
function silence(seconds) { return new Float32Array(Math.round(RATE * seconds)); }
function cat(parts) {
    const n = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Float32Array(n);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
}
function measure(planes, layout = null) {
    return api.computeAudioMetrics({
        sampleRate: RATE, length: planes[0].length, numberOfChannels: planes.length,
        duration: planes[0].length / RATE, getChannelData: index => planes[index],
    }, layout);
}
function stereo(data) { return measure([data, data]); }
function near(actual, expected, tolerance) {
    return actual !== null && Math.abs(Number(actual) - expected) <= tolerance + 1e-9;
}
// Tech 3341 true-peak tolerance is asymmetric: +0.2 / −0.4 dB around the expected level.
function nearPeak(actual, expected) {
    const value = Number(actual);
    return actual !== null && value >= expected - 0.4 - 1e-9 && value <= expected + 0.2 + 1e-9;
}

export function runLoudnessConformanceChecks(check) {
    function ok(name, fn) {
        try { check('loudness-conformance: ' + name, fn() === true); }
        catch (error) { check('loudness-conformance: ' + name + ' (' + (error && error.message) + ')', false); }
    }

    ok('Tech 3341 #1: 1 kHz stereo −23 dBFS is −23.0 LUFS on integrated and short-term', () => {
        const metrics = stereo(tone(-23, 20));
        return near(metrics.integratedLUFS, -23, 0.1)
            && metrics.stBlks.length > 0
            && metrics.stBlks.every(value => Math.abs(value + 23) <= 0.1);
    });
    ok('Tech 3341 #2: 1 kHz stereo −33 dBFS is −33.0 LUFS on integrated and short-term', () => {
        const metrics = stereo(tone(-33, 20));
        return near(metrics.integratedLUFS, -33, 0.1)
            && metrics.stBlks.every(value => Math.abs(value + 33) <= 0.1);
    });
    ok('Tech 3341 #3: relative gate keeps the −23 dBFS body and drops the −36 dBFS edges', () => {
        const metrics = stereo(cat([tone(-36, 10), tone(-23, 60), tone(-36, 10)]));
        return near(metrics.integratedLUFS, -23, 0.1);
    });
    ok('Tech 3341 #4: absolute gate drops −72 dBFS and the integrated result stays −23.0', () => {
        const metrics = stereo(cat([
            tone(-72, 10), tone(-36, 10), tone(-23, 60), tone(-36, 10), tone(-72, 10),
        ]));
        const quiet = stereo(tone(-72, 20));
        return near(metrics.integratedLUFS, -23, 0.1) && quiet.integratedLUFS === null;
    });
    ok('Tech 3341 #5: relative gate of −26/−20/−26 dBFS integrates to −23.0', () => {
        const metrics = stereo(cat([tone(-26, 20), tone(-20, 20.1), tone(-26, 20)]));
        return near(metrics.integratedLUFS, -23, 0.1);
    });
    ok('Tech 3341 #6: 5.0 levels in a 5.1 layout with a silent LFE integrate to −23.0', () => {
        // L R C LFE Ls Rs. Ls/Rs are the −30 dBFS surrounds; LFE is silent, as in
        // the EBU 6-channel WAVEEX edition of this case. Per-channel peaks are
        // −28, −28, −24, none, −30, −30 dBFS.
        const seconds = 20, n = Math.round(RATE * seconds);
        const channel = db => {
            const data = new Float32Array(n);
            if (db === null) return data;
            const amp = 10 ** (db / 20);
            for (let i = 0; i < n; i++) data[i] = amp * Math.sin(2 * Math.PI * 1000 * i / RATE);
            return data;
        };
        const metrics = measure([
            channel(-28), channel(-28), channel(-24), channel(null), channel(-30), channel(-30),
        ], '5.1');
        return metrics.loudnessLayout === '5.1' && near(metrics.integratedLUFS, -23, 0.1)
            && metrics.stBlks.every(value => Math.abs(value + 23) <= 0.1);
    });
    ok('Tech 3341 #9: a 3 s −20/−30 dBFS cycle holds short-term at −23.0', () => {
        const cycle = cat([tone(-20, 1.34), tone(-30, 1.66)]);
        const metrics = stereo(cat([cycle, cycle, cycle, cycle, cycle]));
        return metrics.stBlks.length > 0 && metrics.stBlks.every(value => Math.abs(value + 23) <= 0.1);
    });

    ok('Tech 3342 #1: −20 then −30 dBFS has loudness range 10 LU', () => {
        return near(stereo(cat([tone(-20, 20), tone(-30, 20)])).lra, 10, 1);
    });
    ok('Tech 3342 #2: −20 then −15 dBFS has loudness range 5 LU', () => {
        return near(stereo(cat([tone(-20, 20), tone(-15, 20)])).lra, 5, 1);
    });
    ok('Tech 3342 #3: −40 then −20 dBFS has loudness range 20 LU', () => {
        return near(stereo(cat([tone(-40, 20), tone(-20, 20)])).lra, 20, 1);
    });
    ok('Tech 3342 #4: five-level staircase has loudness range 15 LU', () => {
        const metrics = stereo(cat([
            tone(-50, 20), tone(-35, 20), tone(-20, 20), tone(-35, 20), tone(-50, 20),
        ]));
        return near(metrics.lra, 15, 1);
    });

    const peaks = [
        ['#15 phase 0', 1 / 4, 0.5, 0, -6],
        ['#16 phase 45°', 1 / 4, 0.5, Math.PI / 4, -6],
        ['#17 phase 60°', 1 / 6, 0.5, Math.PI / 3, -6],
        ['#18 phase 67.5°', 1 / 8, 0.5, 67.5 * Math.PI / 180, -6],
        ['#19 amplitude 1.41', 1 / 4, 1.41, Math.PI / 4, 3],
    ];
    for (const [name, ratio, amp, phase, expected] of peaks) {
        ok('Tech 3341 ' + name + ' true peak is ' + expected + ' dBTP', () => {
            const metrics = stereo(tone(20 * Math.log10(amp), 0.5, RATE * ratio, phase, 0.01));
            return nearPeak(metrics.truePeakDBTP, expected);
        });
    }

    ok('Tech 3341 #20–23: decimated phase-continuous burst stays within the true-peak tolerance', () => {
        for (const offset of [0, 1, 2, 3]) {
            const data = decimatedBurst(offset);
            const metrics = measure([data, data]);
            if (!nearPeak(metrics.truePeakDBTP, 0)) return false;
        }
        return true;
    });
}

// Tech 3341 cases 20–23. Synthesize at 4×48 kHz: an fs/6 tone at half scale with
// one phase-continuous period of fs/4 at full scale, low-pass below the output
// Nyquist, then keep every fourth sample at the stated offset.
function decimatedBurst(offset) {
    const fs = RATE, highRate = fs * 4, n = Math.round(highRate * 0.2);
    const high = new Float64Array(n);
    const period = Math.round(highRate / (fs / 4));
    const start = Math.floor(n / 2);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const burst = i >= start && i < start + period;
        const freq = burst ? fs / 4 : fs / 6;
        high[i] = (burst ? 1 : 0.5) * Math.sin(phase);
        phase += 2 * Math.PI * freq / highRate;
    }
    const fade = Math.round(0.005 * highRate);
    for (let i = 0; i < fade; i++) {
        const window = 0.5 - 0.5 * Math.cos(Math.PI * i / fade);
        high[i] *= window;
        high[n - 1 - i] *= window;
    }
    const filtered = lowpassQuarter(high);
    const out = new Float32Array(Math.floor((filtered.length - offset) / 4));
    for (let i = 0; i < out.length; i++) out[i] = filtered[offset + i * 4];
    return out;
}
function lowpassQuarter(input) {
    const taps = 255, cutoff = 0.125 * 0.92, mid = (taps - 1) / 2;
    const kernel = new Float64Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
        const m = i - mid;
        const sinc = Math.abs(m) < 1e-9 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * m) / (Math.PI * m);
        kernel[i] = sinc * (0.5 * (1 - Math.cos(2 * Math.PI * i / (taps - 1))));
        sum += kernel[i];
    }
    for (let i = 0; i < taps; i++) kernel[i] /= sum;
    const out = new Float64Array(input.length);
    for (let n = 0; n < input.length; n++) {
        let acc = 0;
        for (let k = 0; k < taps; k++) {
            const j = n - k;
            if (j >= 0) acc += kernel[k] * input[j];
        }
        out[n] = acc;
    }
    return out;
}
