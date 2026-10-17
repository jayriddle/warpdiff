# Media input contracts and preparation adapters

Status: first implementation slice on `codex/media-input-contract`, based on released 3.19.5 (`19ec134`). Candidate 3.19.6 is unpublished. Direct loading remains available, preparation is explicit, and WarpDiff ships no FFmpeg engine. Merge and publication remain on hold.

## Migration slices

WarpDiff's comparison core should consume media whose usable capabilities and timing are known. Preparation providers should repair or convert media outside that core. Container recognition, provider success and verified admission are different evidence.

1. **Contract and adapter foundation — this slice.** Extract the existing MP4 audio-selection policy into immutable versioned assessments. Describe the existing compatibility recipe with a versioned preparation request. Route the manual command through an adapter. Add an explicit trusted-code file-provider interface, cancellation and unverified results. Preserve visible loading behavior.
2. **Capability inventory and admission report.** Extend bounded probes to picture, audio and timing, with explicit known/unknown/unsupported states. Distinguish playback, frame access, listening and original-source analysis. Retain actual first-frame/audio checks and explain unavailable tools. MIME labels, extensions and sidecars cannot certify decoding.
3. **Prepared package and first real processor.** Validate a review rendition plus source/provenance metadata, then implement one separately installed local tool or managed-host adapter end-to-end. Choose one concrete transport. Returned files re-enter normal admission. Validate timeline, duration, leading silence, frame mapping and channel identity with independent fixtures before offering a strict mode.
4. **Separate compatibility from the comparison core.** Introduce a deliberately selected prepared-media mode; move legacy direct-loading support behind its own boundary. Retire each workaround only after the prepared profile replaces it with measured cross-browser evidence. Keep standalone direct loading until an explicit product decision changes that policy.

The first slice does not remove Opus replacement, edit-list handling, native/WebCodecs fallbacks or channel matrices. It delivers no native helper, upload service, strict prepared-only mode or new host protocol.

## MP4 audio-selection contract

`js/media-input-contract.js` exposes the classic-script namespace `WarpMediaInput`, with no DOM, decoder or app-state dependency. `assessMP4Audio(metadata)` returns an immutable report:

```js
{
  contract: 'warpdiff.media-input', version: 1,
  profile: 'mp4-audio-selection-v1', evidence: 'container-metadata',
  status: 'eligible', audioTrackCount: 1,
  decodedAudio: 'eligible', playback: 'browser-managed',
  code: null, message: ''
}
```

Eligible permits the existing owner to try decoding; it does not mean READY, synchronized, conformant or fully playable. A readable zero-track inventory stays eligible so the existing no-audio owner can classify it. Missing/invalid inventories or more than the parser's 64 tracks produce `audio-inventory-unverified`. Multiple tracks produce `audio-track-selection-required`. Both withhold decoded tools while native playback remains browser-managed where supported.

`_mp4AudioAnalysisIssue` delegates to this report. Existing video/lazy, audio-only and container owners retain their generation checks and failure handling. Managed audio-only requires playable analyzed audio; usable managed video may proceed without decoded audio tools. The contract does not choose the browser's playback track.

## Preparation request v1

`js/media-preparation.js` exposes `WarpMediaPreparation`. `createRequest({id, filename, codec})` produces immutable serializable data with contract `warpdiff.media-preparation`, version 1 and recipe `video-audio-compatibility-v1`.

The source is named as video; the reason is unavailable decoded audio. The canonical output is copied video and stereo AAC at 48 kHz/192 kbps, `analysisBasis: 'prepared-copy'`, original retained. The registry reconstructs this request on every call; caller-supplied output claims cannot alter the recipe. Unknown versions/recipes reject. This is today's lossy compatibility copy, not an original multichannel measurement profile.

Requests include no bytes, signed URLs, destination or credentials. The manual adapter preserves literal POSIX quoting, local `./` paths, terminal-control refusal, extension/container guidance and silence padding to retain the complete picture. The existing panel, copy/focus owners and explicit reload workflow remain. Entries retain the request and provider ID. Opening the panel only constructs instructions.

## Trusted provider interface

`createRegistry()` creates an isolated registry. The app registers only `manualFFmpegProvider()` by default. Providers are trusted application code, not sandboxed plugins. This API performs no discovery, script loading, installation, upload or execution of host-supplied provider definitions.

```js
registry.register({
  id: 'installed-helper', version: 1, mode: 'files',
  supports(request) { return request.recipe === 'video-audio-compatibility-v1'; },
  async prepare(request, {input, signal}) {
    // A future, separately implemented transport prepares the selected File.
    // It owns retirement of its external job/resources when signal aborts.
    return {kind: 'files', files: [preparedFile]};
  }
});
```

The example defines an interface; no such transport ships in this slice. Only an explicit `prepare(providerId, request, sourceFile)` call gives a file provider access to the nonempty source File. Its name must match the request. Registration and `describe(request)` do not invoke `prepare`. `supports` must synchronously return true. Instructions providers implement synchronous `plan`; the registry never executes their commands. Duplicate IDs and incompatible versions reject. Methods are captured at registration, although trusted providers still own their internal state.

A registry has one active file request. A valid replacement cancels the prior request. `cancel()` aborts its signal and promptly rejects with `AbortError` even if the provider ignores cancellation. Late results cannot publish through the registry, and old cleanup cannot retire newer work. `clearAllMedia` cancels the app registry, covering clear, reload and host supersession. Providers must still clean up their external process, upload or buffers; this API cannot forcibly undo an uncooperative external job.

Results must contain 1–4 nonempty File objects. URL strings, empty files and fabricated records reject. The envelope/list is copied and frozen, and always carries `validation: 'required'` and `analysisBasis: 'prepared-copy'`. Provider `ready`/`validated` claims are not forwarded. The registry does not load results, replace a slot, create object URLs or send host READY. A later integration must explicitly feed those Files through the normal loader and actual decode checks. A corrupt nonempty output can cross this interface and then correctly fail host admission.

The first boundary validates only the File envelope, not fulfillment of the recipe. Decode success alone also cannot prove the requested timing, track, channel, picture or provenance requirements. Before automatic handoff or prepared-only mode, later admission must compare actual output against those requirements. Tests deliberately return a corrupt image to demonstrate that generic provider output is not a validated video recipe.

The existing `WARPDIFF_LOAD` protocol is unchanged. There is no third-party provider picker or host preparation negotiation yet. Manual users still run the copied command and load the output themselves. Plugin code is not installed by this interface, and a provider's separate licensing/distribution obligations remain its own responsibility.

## Prepared profile to validate later

The package should distinguish original deliverables from review renditions. A candidate browser profile is MP4 with broadly supported H.264/AVC picture, explicit constant frame rate, bounded resolution/bitrate/GOP, known timeline and one selected readable audio track. Exact ceilings need fixtures and browser evidence before enforcement.

Stereo AAC may serve compatibility or headphone review. It must not stand in for original multichannel measurements. A channel-preserving source or lossless analysis sidecar should retain verified layout/order, sample rate, timeline/edit/priming information and provenance. A downmix must declare matrix, center/surround/LFE treatment and headroom; no silent normalization or per-asset level adjustment. Source identity must bind to bytes, not merely filenames. Provider sidecars remain untrusted evidence until matched and checked. Ordinary capability checks cannot establish professional loudness/true-peak conformance.

Standalone and managed users should share assessments and requests. A real host adapter will need explicit job IDs/correlation, cancellation, output ownership, negotiated recipes, consent for remote transport and normal-load verification. These belong with a chosen provider in slice 3.

## Verification and ownership

Pure fault-injection checks in `tests/media-input-regression.mjs` run through ownership. Browser checks in `tests/media-input.spec.ts` cover the real panel adapter, explicit invocation, corrupt output revalidation and clear cancellation in Chrome and WebKit. Existing command, external conversion, host and MP4 suites cover preserved behavior. Both runtime files belong in `sw.js` ASSETS for release-pinned/offline packaging.

The first-slice [work record](media-input-contract-2026-10-17/README.md) records measured results and limitations. The remaining slices are planned work, not completed capabilities.
