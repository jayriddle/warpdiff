# Media input contracts and preparation adapters

Status: foundation, capability report and initial offline prepared-package handoff implemented locally on `codex/media-input-contract`, based on released 3.19.5 (`19ec134`). Candidate 3.19.6 is unpublished. Direct loading remains available, preparation is explicit, and WarpDiff ships no FFmpeg engine. Full prepared-profile conformance remains future work. Merge and publication remain on hold.

## Migration slices

WarpDiff's comparison core should consume media whose usable capabilities and timing are known. Preparation providers should repair or convert media outside that core. Container recognition, provider success and verified admission are different evidence.

1. **Contract and adapter foundation — implemented.** Extract the existing MP4 audio-selection policy into immutable versioned assessments. Describe the existing compatibility recipe with a versioned preparation request. Route the manual command through an adapter. Add an explicit trusted-code file-provider interface, cancellation and unverified results. Preserve visible loading behavior.
2. **Capability inventory and admission report — implemented conservatively.** Observe existing picture/audio decoding and metadata, with explicit available/unavailable/unknown/not-applicable states. Distinguish playback, frame access, listening and original-source analysis. Retain actual first-frame/audio checks and explain unavailable tools. MIME labels, extensions and sidecars cannot certify decoding. Exact CFR, full synchronization and original-source fidelity stay unverified.
3. **Prepared package and first real processor — initial file handoff implemented.** A separate Node tool invokes user-installed FFmpeg/ffprobe and returns a review rendition plus manifest through offline file exchange. Browser inspection binds selected bytes and validates bounded AVC/AAC container facts; returned files still re-enter normal admission. Complete timeline/frame/channel/provenance conformance, broader profiles and a user package picker remain future work before any strict mode.
4. **Separate compatibility from the comparison core.** Introduce a deliberately selected prepared-media mode; move legacy direct-loading support behind its own boundary. Retire each workaround only after the prepared profile replaces it with measured cross-browser evidence. Keep standalone direct loading until an explicit product decision changes that policy.

The implemented slices do not remove Opus replacement, edit-list handling, native/WebCodecs fallbacks or channel matrices. The optional external Node tool is not an installed browser helper or network service. There is no upload service, strict prepared-only mode or new host message protocol.

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

## Direct capability report v1

`WarpMediaInput.assessCapabilities(facts)` is pure policy for profile `direct-capabilities-v1`. It returns a deeply immutable report with `contract: 'warpdiff.media-input'`, `version: 1`, kind/container, known track count, admission, capabilities, timing and structured issues. A report contains no filenames, URLs, credentials or source bytes. The dialog adds the current filename with `textContent` only.

`js/media-admission.js` owns observation, compact evidence and presentation. The existing loader, decode generations, analysis results, timeline-confidence flags and listening buffers remain authoritative. Per-slot facts are bound to the current media object and loading token; clear/replacement drops them. MP4/WebM metadata is reused from existing parsing, without an extra file read or demux pass. Unknown formats are not classified by extension. Reports do not create a second decoding/readiness state machine.

The report distinguishes:

- **Picture:** a successfully decoded image or actual initial video frame. Dimensions/metadata alone are insufficient. Managed video uses the existing bounded first-frame verifier; a separate verification element can establish source decoding while the comparison element's pixel access remains unknown.
- **Pixel access:** the current comparison element supplied readable pixels. Refresh uses the existing sentinel-based helper on one temporary 1×1 canvas per current image/video, at most two draws each; it creates no timers, decoders or media elements and never plays/seeks media. A paused element without drawable pixels stays unknown until a later explicit Refresh or existing load observation.
- **Native playback:** actual native media data, plus verified picture for video. This establishes initial readiness, not every soundtrack or complete-file integrity. Images do not need this capability.
- **Audio decoding, loaded-file analysis and scrub audio:** successful sample decoding, completed existing analysis aggregates and an existing listening buffer are separate evidence. Track-selection policy can withhold decoded tools while native picture remains usable. Preview budget failure need not invalidate completed analysis. Verified absence of audio differs from a failed/heuristic no-audio result.
- **Original-source analysis:** not certified by decode or loaded-file metrics. A prepared/downmixed file can provide analysis of that copy without proving original channel fidelity or professional loudness/true-peak conformance.
- **Timing:** finite positive native duration is labeled reported metadata. An audio start needs an explicit existing confidence flag or parsed container timestamp; numeric fallback zero stays unknown. Exact frame rate/CFR and full A/V synchronization remain unverified even when a start is known.

`admission.state` is a snapshot of the existing loader decision (`pending`, `admitted`, or an observed media failure), with `authority: 'existing-loader'` and `preparedProfile: 'not-validated'`. The report does not drive `WARPDIFF_LOAD_READY`, promote a provider claim or certify a prepared recipe. No new host acceptance message is added.

Users open **Media status** from the header after loading. Refresh performs the bounded frame check, and decode milestones coalesce updates only while the native modal dialog is open. The dialog owns keyboard input while open and restores focus on close; clear hides it and retires previous reports. There is no polling loop or background report probe.

Same-origin hosts may discover `WarpDiffHostAPI.capabilities.mediaInputReportVersion === 1` and call `WarpDiffHostAPI.readMediaInputReports()`. It returns a frozen slot-keyed snapshot, empty after clear. This additive metadata getter cannot load media, run preparation, dispatch commands or authorize READY. Existing command-catalog and host-load protocols retain their owners.

This is evidence inventory for ordinary direct loading. It is not prepared-profile conformance validation. Full timeline/frame/channel/provenance verification belongs to slice 3 and must precede a strict mode or retirement of compatibility workarounds.

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

The [initial offline package and local tool](../tools/media-prepare/README.md) implement part of this boundary: versioned manifest, exact selected-byte binding, bounded track/sample-table inspection and a real separately run processor. `WarpPreparedMedia` returns **candidate**, with normal loading required. It does not promote the Media status prepared profile to validated. Source hashes bind selected originals but cannot authenticate a producer or prove derivation. Full-file browser decode, exact frame mapping/CFR, A/V synchronization, channel identity and measurement conformance remain unverified.

The transport is explicit file exchange: the external CLI produces `review.mp4` plus `warpdiff-package.json`; standalone users load the MP4 normally, while trusted tooling invokes the one-shot file-provider adapter with the selected original and both returned files. No script discovery, network service, media upload, automatic manifest import or automatic slot replacement is added. The manual adapter remains the only default app registration. CLI/reference fixtures exercise AC-3 conversion, selected-track tones, copied frame hashes, leading onset, short-track padding, surround-to-stereo declaration, cancellation and cleanup. These fixtures do not establish universal conformance.

The inspector limits a manifest to 16 KiB and each file to 64 MiB, with one active inspection including unsettled cancelled reads/digests. It reuses the audio demuxer's complete compact-table/range checks through an opt-in no-copy summary mode; existing metadata/extraction modes are unchanged. The video parser checks sample tables; complete AVC parameter sets and rendering remain the loader's/later validation's responsibility. These bounds are not a whole-browser memory budget.

The package should distinguish original deliverables from review renditions. A candidate browser profile is MP4 with broadly supported H.264/AVC picture, explicit constant frame rate, bounded resolution/bitrate/GOP, known timeline and one selected readable audio track. Exact ceilings need fixtures and browser evidence before enforcement.

Stereo AAC may serve compatibility or headphone review. It must not stand in for original multichannel measurements. A channel-preserving source or lossless analysis sidecar should retain verified layout/order, sample rate, timeline/edit/priming information and provenance. A downmix must declare matrix, center/surround/LFE treatment and headroom; no silent normalization or per-asset level adjustment. Source identity must bind to bytes, not merely filenames. Provider sidecars remain untrusted evidence until matched and checked. Ordinary capability checks cannot establish professional loudness/true-peak conformance.

Standalone and managed users should share assessments and requests. A real host adapter will need explicit job IDs/correlation, cancellation, output ownership, negotiated recipes, consent for remote transport and normal-load verification. These belong with a chosen provider in slice 3.

## Verification and ownership

Pure fault-injection checks in `tests/media-input-regression.mjs` and `tests/media-admission-regression.mjs` run through ownership. Browser checks in `tests/media-input.spec.ts` cover the real panel adapter, explicit invocation, corrupt output revalidation and clear cancellation in Chrome and WebKit. `tests/media-admission.spec.ts` adds actual decoded capability reports, timing uncertainty, multi-track withholding, first-frame rejection, owner retirement and dialog keyboard/focus/layout checks in both engines. Existing command, external conversion, host and MP4 suites cover preserved behavior. All three boundary/adapter runtime files belong in `sw.js` ASSETS for release-pinned/offline packaging.

The [foundation work record](media-input-contract-2026-10-17/README.md), [capability-report work record](media-admission-report-2026-10-17/README.md) and [prepared-package work record](prepared-package-2026-10-17/README.md) record measured results and limitations. Remaining slice-3 conformance/UI work and slice 4 are planned, not completed capabilities.
