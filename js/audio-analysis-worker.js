// Private worker realm. Keep all numerical algorithms in audio-viz.js so the
// background and compatibility paths produce identical inspection results.
importScripts('audio-viz.js');

(() => {
    let buffer = null;
    let planes = [];
    let buckets = 0;
    self.onmessage = ({ data }) => {
        try {
            if (data.type === 'init') {
                buckets = data.buckets;
                planes = new Array(data.channels);
                buffer = { sampleRate: data.sampleRate, length: data.length,
                    duration: data.duration, numberOfChannels: data.channels,
                    getChannelData: channel => planes[channel] };
                self.postMessage({ ready: true });
            } else if (data.type === 'samples') {
                if (!planes[data.channel]) planes[data.channel] = new Float32Array(buffer.length);
                planes[data.channel].set(data.data, data.offset);
                self.postMessage({ ready: true });
            } else if (data.type === 'compute') {
                const result = { waveform: computeWaveformData(buffer, buckets),
                    spectrogram: computeSpectrogramData(buffer), metrics: computeAudioMetrics(buffer) };
                const transfers = new Set();
                const collect = value => {
                    if (ArrayBuffer.isView(value)) transfers.add(value.buffer);
                    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
                };
                collect(result);
                self.postMessage({ result }, [...transfers]);
                planes = [];
                buffer = null;
            }
        } catch (error) { self.postMessage({ error: error.message || String(error) }); }
    };
})();
