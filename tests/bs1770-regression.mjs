// Reference vectors for ITU-R BS.1770 loudness and true peak.
//
// Integrated-loudness expectations were measured with FFmpeg 6.1.1
// (`-filter_complex ebur128=peak=true`) on 4.0 s tones at −20 dBFS peak
// (amplitude 10^(−20/20)). They agree with the Recommendation's published
// 48 kHz K-weighting coefficients and with the same bilinear pre-filter / RLB
// design at the other rates below (the design used by libebur128 and FFmpeg).
// FFmpeg prints −70.0 LUFS for an LFE-only signal; that is the absolute-gate
// floor, so the integrated reading is withheld rather than shown as a level.
//
// The 12 kHz, phase-π/4, unit-amplitude sine at 48 kHz is the audit's true-peak
// vector (analytic peak 1, FFmpeg 0.0 dBTP). Reconstruction is the BS.1770
// Annex 2 49-tap Hann-windowed sinc, 4× below 96 kHz and 2× below 192 kHz.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC = readFileSync(new URL('../js/audio-viz.js', import.meta.url), 'utf8');
const api = runInNewContext(SRC + '\n({computeAudioMetrics, _kwCoeffs, _truePeakCh});', {});

function tone(freq, rate, seconds, amp, phase = 0, fade = 0) {
    const n = Math.round(rate * seconds);
    const data = new Float32Array(n);
    const fadeN = Math.round(fade * rate);
    for (let i = 0; i < n; i++) {
        let w = 1;
        if (fadeN > 0 && i < fadeN) w = 0.5 - 0.5 * Math.cos(Math.PI * i / fadeN);
        else if (fadeN > 0 && i >= n - fadeN) w = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / fadeN);
        data[i] = amp * w * Math.sin(2 * Math.PI * freq * i / rate + phase);
    }
    return data;
}
function audio(planes, rate) {
    return {
        sampleRate: rate, length: planes[0].length, numberOfChannels: planes.length,
        duration: planes[0].length / rate, getChannelData: index => planes[index],
    };
}
function silent(channels, rate, seconds) {
    const n = Math.round(rate * seconds);
    return audio(Array.from({ length: channels }, () => new Float32Array(n)), rate);
}
function put(buffer, channel, data) { buffer.getChannelData(channel).set(data); }

const AMP = 10 ** (-20 / 20);

export function runBs1770Checks(check) {
    function ok(name, fn) {
        try { check('bs1770: ' + name, fn() === true); }
        catch (error) { check('bs1770: ' + name + ' (' + (error && error.message) + ')', false); }
    }

    ok('48 kHz coefficients are the published BS.1770 values', () => {
        const c = api._kwCoeffs(48000);
        const close = (got, expected) => Math.abs(got - expected) < 1e-12;
        const shelf = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
        const rlb = [1, -2, 1, -1.99004745483398, 0.99007225036621];
        return c.hs.every((value, i) => close(value, shelf[i])) && c.hp.every((value, i) => close(value, rlb[i]));
    });
    ok('K-weighting stays finite at every analysis rate and refuses an inaudible rate', () => {
        const rates = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
        return rates.every(rate => {
            const c = api._kwCoeffs(rate);
            return c && c.hs.every(Number.isFinite) && c.hp.every(Number.isFinite);
        }) && api._kwCoeffs(48000).hp[3] !== api._kwCoeffs(44100).hp[3]
            && api._kwCoeffs(3000) === null && api._kwCoeffs(Number.NaN) === null;
    });

    // 4 s, −20 dBFS peak. Displayed integrated LUFS from the FFmpeg run above.
    const tones = [
        [48000, 50, '-27.6'], [48000, 100, '-24.8'], [48000, 1000, '-23.0'], [48000, 5000, '-19.7'],
        [44100, 50, '-27.6'], [44100, 100, '-24.8'], [44100, 1000, '-23.0'], [44100, 5000, '-19.7'],
        [96000, 50, '-27.7'], [96000, 100, '-24.9'], [96000, 1000, '-23.0'], [96000, 5000, '-19.7'],
        [8000, 1000, '-23.0'], [11025, 1000, '-23.0'], [16000, 1000, '-23.0'], [22050, 1000, '-23.0'],
        [32000, 1000, '-23.0'], [88200, 1000, '-23.0'], [176400, 1000, '-23.0'], [192000, 1000, '-23.0'],
    ];
    for (const [rate, freq, lufs] of tones) ok(`${freq} Hz at ${rate} Hz reads ${lufs} LUFS`, () => {
        const metrics = api.computeAudioMetrics(audio([tone(freq, rate, 4, AMP)], rate));
        return metrics.integratedLUFS === lufs && metrics.loudnessLayout === 'mono' && metrics.truePeakDBTP === '-20.0';
    });

    ok('a 1 kHz tone in Ls is 1.5 LU louder than the same tone in L', () => {
        const left = silent(6, 48000, 4); put(left, 0, tone(1000, 48000, 4, AMP));
        const surround = silent(6, 48000, 4); put(surround, 4, tone(1000, 48000, 4, AMP));
        const right = silent(6, 48000, 4); put(right, 5, tone(1000, 48000, 4, AMP));
        const center = silent(6, 48000, 4); put(center, 2, tone(1000, 48000, 4, AMP));
        return api.computeAudioMetrics(left, '5.1').integratedLUFS === '-23.0'
            && api.computeAudioMetrics(center, '5.1').integratedLUFS === '-23.0'
            && api.computeAudioMetrics(surround, '5.1').integratedLUFS === '-21.5'
            && api.computeAudioMetrics(right, '5.1').integratedLUFS === '-21.5'
            && api.computeAudioMetrics(surround, '5.1').loudnessLayout === '5.1';
    });
    ok('LFE is excluded from 5.1 and 7.1 programme loudness and still has a true peak', () => {
        const five = silent(6, 48000, 4); put(five, 3, tone(1000, 48000, 4, AMP));
        const seven = silent(8, 48000, 4); put(seven, 3, tone(100, 48000, 4, AMP));
        const lfe5 = api.computeAudioMetrics(five, '5.1');
        const lfe7 = api.computeAudioMetrics(seven, '7.1');
        return lfe5.integratedLUFS === null && lfe5.truePeakDBTP === '-20.0'
            && lfe7.integratedLUFS === null && lfe7.truePeakDBTP === '-20.0';
    });
    ok('7.1 side and back surrounds use the same +1.5 dB weight', () => {
        const back = silent(8, 48000, 4); put(back, 4, tone(1000, 48000, 4, AMP));
        const side = silent(8, 48000, 4); put(side, 6, tone(1000, 48000, 4, AMP));
        const front = silent(8, 48000, 4); put(front, 0, tone(1000, 48000, 4, AMP));
        return api.computeAudioMetrics(front, '7.1').integratedLUFS === '-23.0'
            && api.computeAudioMetrics(back, '7.1').integratedLUFS === '-21.5'
            && api.computeAudioMetrics(side, '7.1').integratedLUFS === '-21.5'
            && api.computeAudioMetrics(side, '7.1').loudnessLayout === '7.1';
    });
    ok('an unverified or mismatched layout counts every channel, including LFE', () => {
        const surround = silent(6, 48000, 4); put(surround, 4, tone(1000, 48000, 4, AMP));
        const lfe = silent(6, 48000, 4); put(lfe, 3, tone(1000, 48000, 4, AMP));
        const mismatched = api.computeAudioMetrics(surround, '7.1');
        const unlabeled = api.computeAudioMetrics(surround, null);
        const included = api.computeAudioMetrics(lfe, null);
        return mismatched.loudnessLayout === 'unverified' && mismatched.integratedLUFS === '-23.0'
            && unlabeled.loudnessLayout === 'unverified' && unlabeled.integratedLUFS === '-23.0'
            && included.integratedLUFS === '-23.0';
    });
    ok('mono and stereo do not need a layout label', () => {
        const mono = audio([tone(1000, 48000, 4, AMP)], 48000);
        const stereo = silent(2, 48000, 4); put(stereo, 1, tone(1000, 48000, 4, AMP));
        return api.computeAudioMetrics(mono).loudnessLayout === 'mono'
            && api.computeAudioMetrics(mono, '5.1').loudnessLayout === 'mono'
            && api.computeAudioMetrics(stereo).integratedLUFS === '-23.0'
            && api.computeAudioMetrics(stereo).loudnessLayout === 'stereo';
    });

    ok('tapered 12 kHz unit sine at phase π/4 reads 0.0 dBTP', () => {
        const data = tone(12000, 48000, 1, 1, Math.PI / 4, 0.05);
        let sample = 0;
        for (let i = 0; i < data.length; i++) sample = Math.max(sample, Math.abs(data[i]));
        const metrics = api.computeAudioMetrics(audio([data], 48000));
        const db = Number(metrics.truePeakDBTP);
        // Sample peak of this phase is −3 dB. Cubic interpolation under-read by ~1.1 dB.
        return metrics.truePeakDBTP === '0.0' && sample < 0.75 && db > -0.1 && db < 0.1;
    });
    ok('a quiet prefix does not hide a later inter-sample peak', () => {
        const rate = 48000;
        const lead = new Float32Array(Math.round(rate * 1.5));
        const burst = tone(12000, rate, 0.5, 0.8, Math.PI / 4, 0.02);
        const joined = new Float32Array(lead.length + burst.length);
        joined.set(burst, lead.length);
        const metrics = api.computeAudioMetrics(audio([joined], rate));
        const alone = api.computeAudioMetrics(audio([burst], rate));
        return metrics.truePeakDBTP === alone.truePeakDBTP && Number(metrics.truePeakDBTP) > -2.3;
    });
    ok('oversampling still runs at 96 kHz, where the factor drops to 2×', () => {
        // fs/4 at phase π/4 never lands on a sample crest (peak √2/2) but the
        // continuous peak is still full scale.
        const data = tone(24000, 96000, 0.5, 1, Math.PI / 4, 0.02);
        let sample = 0;
        for (let i = 0; i < data.length; i++) sample = Math.max(sample, Math.abs(data[i]));
        const peak = api._truePeakCh(data, 96000);
        return sample < 0.75 && peak > 0.95 && Number((20 * Math.log10(peak)).toFixed(1)) === 0;
    });
    ok('192 kHz true peak is the sample peak', () => {
        const data = tone(1000, 192000, 0.25, 0.5, 0, 0);
        return Math.abs(api._truePeakCh(data, 192000) - 0.5) < 1e-6;
    });
    ok('a long full-scale tone stays within a few seconds', () => {
        const rate = 48000, n = rate * 20;
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) data[i] = Math.sin(2 * Math.PI * 100 * i / rate);
        const started = Date.now();
        const metrics = api.computeAudioMetrics(audio([data, data], rate));
        return Date.now() - started < 8000 && metrics.channels === 2 && Number(metrics.truePeakDBTP) > -0.2;
    });
}
