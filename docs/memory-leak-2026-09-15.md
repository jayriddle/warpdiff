# Memory leak investigation and repair

Date: 2026-09-15. Local WarpDiff 3.17.3, shared scrub component 1.2.1.

Canonical component checkpoint: `ba897af7fce82800196ab4b02bb2210c57bf6b2f`, pinned in [SCRUB_AUDIO_LOCK.json](../js/SCRUB_AUDIO_LOCK.json). Both repositories hold local commits; deployment remains held.

## Conclusion

**A real audio leak was reproduced and fixed.** Clearing a comparison closed its audio context before the Continuous scrub processor had finished shutting down. Chrome kept the processor alive; its error callback retained the input audio buffer. This was independent of FLAC decoding and the new background analysis worker.

For `505a7754367fd458-stripped-sync-fixed.mp4`, each load-and-clear cycle retained another **4,534,272 bytes (4.32 MiB)** of scrub input, plus the processor and closed audio context. After seven loads, a heap snapshot contained seven old audio buffers, seven processors, and seven contexts. Restoring the historical shutdown code makes the regression tests fail.

This can increase memory pressure during a long review session. **It does not establish that the leak caused every reported picture judder.** A separate 90-second continuous-playback run showed stable audio/frame caches and zero reported dropped frames across 2,160 playback frames.

## Measured results

The supplied file is 8.091 seconds of H.264 picture with 7.872 seconds of 48 kHz, eight-channel FLAC audio. Its source bytes were unchanged. Measurements used an isolated, muted Chrome 152.0.7977.83 session at 1639×1492 and device pixel ratio 2. The user's browser comparison was not changed.

| Check | Before | After |
| --- | --- | --- |
| Array backing storage after clear | Increased by 4.32 MiB per load | Approximately 0.87 MiB after every one of eight cycles |
| Old input buffers / scrub processors | One more retained per load | All measured old objects collected after clear |
| Analysis worker after readiness/clear | Terminated | Terminated |
| Scrub-video sessions after clear | Released | Released |
| Last removed native video | Retained by the primary-video reference | Collected; its source and decoder explicitly released |
| 90-second ordinary playback after scrubbing | No valid baseline playback measurement in this probe | Stable caches; 0/2,160 reported dropped frames |

The frame cache held 73 images, approximately 190.7 MiB, throughout the final playback run. That is intentional bounded storage for responsive reverse scrubbing and is released on clear. Process memory remained higher than initial startup because it also includes browser and graphics allocation pools. Array storage and live-object checks are not measurements of all GPU/native memory.

The heap's retaining chain was: browser pending-activity root → AudioWorkletNode → processor-error listener → loading closure → AudioBuffer. The same node retained its AudioContext. This matches Chromium's [active-processor lifetime implementation](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/audio_worklet_node.cc), which treats an active processor as pending work.

Selected counters, intermediate runs, source hash, and heap findings are retained in [the measurements](memory-leak-2026-09-15-measurements.json). No movie frames or audio samples are included.

## What changed

- The shared processor acknowledges disposal from its final audio render, which returns false. An acknowledgement in the message handler was too early.
- Shared reset/disposal clear state immediately and return a promise covering current and earlier fading processors. Disposal removes the error callback and closes its message port.
- WarpDiff disconnects old output routes, allows the old context to finish that terminal render, then closes that captured context. A suspended context is resumed to drain cleanup. A new comparison can load immediately; an old completion cannot close its new context.
- Clearing also drops the primary-video and cached pointer references, pauses removed media, removes their sources, and releases their native decoders.
- The canonical change is in WarpCap's shared component and pinned into standalone WarpDiff. WarpSonic uses the same component; its interface is unchanged. WarpCap's bundled WarpDiff was not refreshed.

The source audio, channel mixing, Continuous processing, waveform, spectrogram, and loudness calculations were not reduced or changed. The cost is a brief asynchronous cleanup before closing the old context. A one-second timeout bounds failed/prohibited processor shutdown; such environments may retain browser-native context internals despite source-closure cleanup.

## Verification and corrections

- WarpDiff: **423 ownership checks; 244 browser checks passed, one existing skip**. The full browser run used two workers and no retries.
- Shared component: **14 browser checks passed**, including real collection from idle/audible shutdown, previous fading replacements, channel preservation, failed loading, and reuse after reset.
- WarpSonic audio/playback regression selection: **26 passed**. WarpCap logic: **1,206 passed**; CI passed.
- Historical WarpDiff `3170a58:index.html`: both new lifecycle tests failed. Historical canonical `cbfb694` controller: three new checks failed; historical processor: the idle closed-context check failed. Benign running-context cases remained green.
- The first playback probe accidentally combined overlapping transport commands and stayed paused. A second attempt restarted after a scrub without restoring native looping and stopped at the end. Neither was used as playback evidence. The final probe uses one play command after a settled pause and checks active native looping throughout.
- The initial integration test also required a closed native context itself to collect immediately during rapid replacement. Bundled Chromium 145 retained a native worklet proxy even after input buffers and processor nodes collected; current Chrome 152 passed the stronger collection check. The portable regression asserts actual input/node/video collection, old-context closure, and replacement-context survival. The current-Chrome end-to-end probe additionally verifies context collection. This browser difference remains a limitation, not an assertion that all native memory is always reclaimed immediately.
- An ownership check run while historical canonical code was temporarily injected failed the expected neighboring-source equality check. After restoration, all 423 checks passed. The existing worklet lifetime guard was updated for terminal-render acknowledgement and passed.

## Reproduction

Serve this checkout on port 8080, then run:

```sh
node tests/investigate-memory.mjs --clip /path/to/clip.mp4 \
  --cycles 8 --loop-seconds 90 --out /path/to/memory.json
npx playwright test tests/memory-lifecycle.spec.ts --workers=1 --retries=0
```

Optional `--snapshot /path/to/memory.heapsnapshot` captures a local heap snapshot after final clear. The probe stores only primitive counters and WeakRefs in the page; it does not hold the objects being measured alive. Collection is forced after clear and at playback endpoints, not during the measured 90-second playback interval.

This is a local checkpoint. No push, deployment, source-media conversion, or user-tab reload was performed. Remaining acceptance: whether judder persists in the user's normal review session after reloading this version.
