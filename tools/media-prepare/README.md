# Optional local preparation tool

This tool runs outside the browser. Install Node 24 or newer and install FFmpeg/ffprobe separately, then run it from a WarpDiff checkout. It does not download or redistribute those executables and is excluded from the Pages package. Existing direct loading and copied-command preparation remain available.

For a checkout, clone the repository or use **Code → Download ZIP** on its [GitHub page](https://github.com/jayriddle/warpdiff), extract it, and open a terminal in the extracted WarpDiff folder. The example below is for macOS or Linux; replace both paths. Ordinary media and the in-app copied-command audio workflow do not require this tool or a package.

```sh
node tools/media-prepare/prepare.mjs --input '/path/to/source.mp4' --output '/path/to/new-package'
```

Output must be a new directory. The tool creates `review.mp4` and `warpdiff-package.json`; the original is retained. In WarpDiff, open **Help → Advanced → Import externally prepared media**. The dialog has setup guidance under **How to get prepared files** and a **Load ordinary files** route for normal media. Select **warpdiff-package.json** and **review.mp4**, optionally select the original for byte matching, and add up to three companion images or videos. Choose **Check prepared files**, review what is inspected versus unverified, then **Load comparison**. Inspection failure or cancellation preserves the current comparison. Loading starts a new comparison through the normal decoder checks and timestamp ordering. The original is not added automatically. You can also load **review.mp4** with the usual Load/drop workflow; a manifest by itself is not loadable media. Managed hosts continue to use their existing reload channel.

The first recipe accepts MP4/MOV, copies one AVC/H.264 8-bit 4:2:0 picture stream and converts one selected audio stream to stereo AAC-LC at 48 kHz/192 kbps. It pads a short soundtrack to preserve the picture. Source and returned file each have a 64 MiB limit for this first handoff; larger inputs retain the ordinary direct/external workflows. The copied picture must fit 4096 pixels on either axis and 4096×2160 pixels overall. Other containers/picture formats need a different preparation recipe. The helper forces the MOV/MP4 demuxer and a file-only protocol allowlist for both executables; a disguised playlist cannot fetch network media.

With multiple audio streams, first inspect stream indexes using your own FFprobe, then explicitly choose the desired absolute index:

```sh
ffprobe -v error -show_streams -of json '/path/to/source.mp4'
node tools/media-prepare/prepare.mjs --input '/path/to/source.mp4' --output '/path/to/new-package' --audio-stream 2
```

No automatic choice is made for ambiguous tracks. Arguments are passed to executables without a shell. Existing output paths reject; failed/cancelled work removes its own files, never recursively deletes user directory contents. SIGINT/SIGTERM abort preparation, including final file publication. Cleanup waits for the running executable to close; a process that ignores termination is killed after a 500 ms grace period. The helper checks source bytes again after conversion, inspects the output tables and performs a complete FFmpeg decode before returning success. It does not claim browser support for every frame.

This is a **stereo compatibility copy**, not original multichannel analysis. The manifest declares FFmpeg's default downmix and absence of a normalization filter. Decoder processing, AAC encoding and that default mix can alter samples and levels. No channel-preserving sidecar, independently verified mix matrix or source loudness/true-peak certification is supplied. Keep the original.

## File adapter

`WarpPreparedMedia` is a classic-script namespace in the browser and performs no network requests. Registration and discovery never read media or run preparation. A trusted integration supplies the source File and the two returned Files explicitly:

```js
const registry = WarpMediaPreparation.createRegistry();
registry.register(WarpPreparedMedia.createFileProvider({manifestFile, mediaFile}));
const request = WarpMediaPreparation.createRequest({id: 'review-job', filename: sourceFile.name});
const result = await registry.prepare('prepared-package', request, sourceFile);
// result.validation === 'required'
// Explicitly feed result.files into ordinary loading or the existing host channel.
```

Use a job-scoped registry and release it after completion; the provider is one-shot. It drops its selected-file closure when invoked and cannot be reused. The app registry's existing clear cancellation also applies when a trusted integration registers there. Providers are trusted code, not sandboxed plugins.

`inspectFiles({manifestFile, mediaFile, sourceFile?, signal?})` can independently return an immutable report. With a supplied source, both names/sizes/SHA-256 bindings must match. Without the source, `sourceBinding` is `not-checked`; it must never be inferred from a filename. Source binding proves correspondence to selected bytes, not that a producer actually derived the rendition from them. A malicious producer can write matching hashes. No signature or producer authentication is implied.

Inspection checks a bounded 16 KiB versioned manifest, 64 MiB per selected file, exact selected-byte hashes, exactly one video and one audio track, AAC-LC stereo/48 kHz, an explicit container start, and bounded AVC picture/sample tables. Active SBR/HE-AAC extensions reject even when the codec string says `mp4a.40.2`; configurations beyond the 64-byte extension scan are unverified and reject for this recipe. The audio parser reuses its complete compact table/range validation without packet copies. One inspection may remain active, including cancelled reads waiting to settle. There is no inspection queue. File reads and WebCrypto cannot be physically interrupted; cancellation prevents subsequent work/publication, and the reservation stays until the pending operation settles.

The status is **candidate**, with `validation: 'normal-load-required'`. It does not certify full browser decoding, complete AVC parameter sets, CFR/frame mapping, end-to-end synchronization, channel fidelity, source derivation or professional measurements. The existing loader owns decoded frames, playable/analyzed audio and correlated host READY/FAILED. The Media status prepared-profile field remains unvalidated. Provider success, hashes and sidecar claims never authorize READY.

Run `npm run test:ownership`, `npm run test:preparation` and the `prepared-media.spec.ts` Chrome/WebKit cases. The helper checks run in the protected ownership CI job after fixture generation. See [the architecture](../../docs/media-input-architecture.md) and [work record](../../docs/prepared-package-2026-10-17/README.md).
