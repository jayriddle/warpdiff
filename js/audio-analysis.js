// One serialized analysis job across video and audio-only decoding. Playback and
// UI stay on the main thread; the worker imports the same analysis primitives.
// Only the active job gets a PCM copy, transferred in acknowledged 1 MiB slices.
const _audioAnalysisQueue = [];
let _audioAnalysisJob = null;

function _computeAudioAnalysis(audioBuffer, buckets, isCurrent = () => true) {
    if (_audioAnalysisJob && !_audioAnalysisJob.isCurrent()) {
        _audioAnalysisJob.cancelled = true;
        if (_audioAnalysisJob.cancel) _audioAnalysisJob.cancel();
    }
    return new Promise((resolve, reject) => {
        _audioAnalysisQueue.push({ audioBuffer, buckets, isCurrent, resolve, reject, cancelled: false });
        _pumpAudioAnalysis();
    });
}

async function _runAudioAnalysisWorker(job) {
    const worker = new Worker('js/audio-analysis-worker.js');
    let pending = null;
    let failure = null;
    job.cancel = () => {
        worker.terminate();
        if (pending) { pending.resolve({ cancelled: true }); pending = null; }
    };
    worker.onmessage = event => {
        if (!pending) return;
        const reply = pending;
        pending = null;
        if (event.data.error) reply.reject(new Error(event.data.error));
        else reply.resolve(event.data);
    };
    worker.onerror = event => {
        event.preventDefault();
        failure = new Error(event.message || 'Audio analysis worker failed');
        if (pending) { pending.reject(failure); pending = null; }
    };
    const request = (message, transfer = []) => {
        if (job.cancelled || !job.isCurrent()) return Promise.resolve({ cancelled: true });
        if (failure) return Promise.reject(failure);
        return new Promise((resolve, reject) => {
            pending = { resolve, reject };
            worker.postMessage(message, transfer);
        });
    };
    try {
        const buffer = job.audioBuffer;
        await request({ type: 'init', sampleRate: buffer.sampleRate, length: buffer.length,
            duration: buffer.duration, channels: buffer.numberOfChannels, buckets: job.buckets });
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            if (job.cancelled || !job.isCurrent()) return null;
            const original = buffer.getChannelData(channel);
            for (let offset = 0; offset < original.length; offset += 262144) {
                if (job.cancelled || !job.isCurrent()) return null;
                // Never transfer the source PCM: playback, listening preparation,
                // Opus replacement and audio-only review still own that buffer.
                const data = original.slice(offset, offset + 262144);
                await request({ type: 'samples', channel, offset, data }, [data.buffer]);
            }
        }
        const reply = await request({ type: 'compute' });
        return reply.result || null;
    } finally {
        job.cancel = null;
        worker.terminate(); // release the complete temporary PCM and FFT scratch
    }
}

async function _pumpAudioAnalysis() {
    if (_audioAnalysisJob) return;
    while (_audioAnalysisQueue.length) {
        const job = _audioAnalysisQueue.shift();
        if (job.cancelled || !job.isCurrent()) { job.resolve(null); continue; }
        _audioAnalysisJob = job;
        let result = null;
        try {
            result = await _runAudioAnalysisWorker(job);
        } catch (error) {
            // Retain analysis in browsers/hosts that prohibit workers. This is
            // the existing computation, including every original audio channel.
            if (!job.cancelled && job.isCurrent()) {
                console.warn('Background audio analysis unavailable; using local analysis:', error);
                try {
                    result = {
                        waveform: computeWaveformData(job.audioBuffer, job.buckets),
                        spectrogram: computeSpectrogramData(job.audioBuffer),
                        metrics: computeAudioMetrics(job.audioBuffer)
                    };
                } catch (fallbackError) { job.reject(fallbackError); }
            }
        } finally {
            _audioAnalysisJob = null;
            job.resolve(!job.cancelled && job.isCurrent() ? result : null);
        }
    }
}

function _clearAudioAnalysis() {
    for (const job of _audioAnalysisQueue.splice(0)) { job.cancelled = true; job.resolve(null); }
    if (_audioAnalysisJob) {
        _audioAnalysisJob.cancelled = true;
        if (_audioAnalysisJob.cancel) _audioAnalysisJob.cancel();
    }
}
