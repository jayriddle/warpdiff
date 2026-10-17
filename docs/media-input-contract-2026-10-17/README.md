# Media input contract foundation — October 17, 2026

Branch: codex/media-input-contract, based on released main `19ec1346fbf4f20f96417280bb89ba63b697081c`. Candidate **3.19.6**, unpublished. Jay authorized moving forward with direct loading retained, explicit user/host preparation and adapters without bundled FFmpeg. This first slice is for architecture review. This slice stops at a local feature commit; no push, PR, merge or publication has been performed.

## Changes and rationale

The [architecture and migration sequence](../media-input-architecture.md) separates evidence/admission from preparation. The first active contract is deliberately limited to the existing MP4 audio-selection policy. It produces immutable versioned assessments; eligibility never means READY or successful decoding. Existing owners still handle loading, host readiness, native/WebCodecs decoding and timing.

The existing copied-command recipe now runs through the built-in manual adapter using an immutable versioned request. Shell quoting, terminal-control refusal, container guidance, stereo AAC compatibility output, silence padding, panel focus and explicit reload semantics are retained. Two classic-script files are included in source loading, service-worker ASSETS and release-pinned staging. No build system or runtime dependency is added.

A trusted-code provider registry supports explicit file preparation with a selected source File. Registration/discovery do not prepare media. Replacement and clear cancel pending work, including providers that ignore the signal. Outputs are always unverified nonempty Files; provider acceptance claims are not forwarded and no automatic loading/READY occurs. This validates an envelope, not the requested recipe or provenance. A real helper/host transport and complete prepared-media validator remain future slices. Existing direct loading and compatibility engines remain available.

The candidate version/cache and README are 3.19.6. This is a quiet foundation: the prior in-app What's New marker/summary remains. Existing user-visible workflow descriptions still apply. No licensing terms or FFmpeg distribution changed.

## Measured verification

| Check | Result |
|---|---|
| Selected browser matrix | **232 passed**, 116 Chrome + 116 WebKit, one worker, zero retries/skips/runner errors; **230.8 seconds** |
| New interface browser checks | Eight passes, four per engine, included above |
| Existing browser regression cases | 224 passes, covering commands/external conversion, host readiness/cleanup and MP4 track policy/fallback |
| Ownership | **1,238 passed**, including 41 new boundary checks |
| Release infrastructure | **25 passed** |
| Four deliberate regressions | Every mutant failed its intended behavioral assertion with the valid File/source setup control passing |
| Runtime source verification | Five served responses match checkout; all 32 runtime-file hashes retained; recorded timing/measurement/canonical owners match released baseline |

The mutations test trusting provider output, running a provider after cancellation, omitting supersession cancellation, and accepting URL/non-File output. They mutate in-memory source only. All original source bytes remain untouched.

The browser matrix used an owned loopback server, existing fixtures, disabled global fixture generation and one worker across both projects. MP4/reference conversion helpers generate their own temporary inputs; no legacy Opus fixture-writing hook ran. This is not a full Chromium CI or complete focused-WebKit run. Hosted checks are deferred until a reviewed PR is ready.

## Retained failures and resolutions

The first ownership run passed 1,236 checks. Two later additional pure checks raised the final count to 1,238. Initial infrastructure was 24 passes/one failure: staging correctly refused two new untracked public assets. Adding them to the index resolved it; no guard was weakened. The passing infrastructure checks were repeated after final runtime changes.

The initial browser run was deliberately interrupted (exit 130): **95 passed, two failed, 135 skipped/not executed**. Two new assertions incorrectly counted four empty slot placeholders as loaded media. The corrected tests filter actual populated media; the full selected matrix then passed all 232 cases. Each initial assertion failure also retained a 60-second teardown timeout; that separate teardown cause was not established or represented as repaired. Raw reports, traces/screenshots, initial test source and interruption reason remain in the evidence directory.

A patch context mismatch and an initial broad file-search glob were corrected during orchestration; they did not establish production defects or change unrelated files.

## Remaining work and limits

Slice 2 is a complete capability/admission report with picture, audio and timing requirements. Slice 3 adds one real external processor and output-profile/provenance verification. Only after that evidence should a prepared-only core replace compatibility branches. A passing decoder or provider sidecar alone cannot certify correct track selection, timing, channel layout, source identity or professional measurement accuracy.

There is no processor selection UI, native helper, remote upload, new host message protocol, automatic conversion or automatic replacement in this slice. The manual provider is the only installed adapter. No physical Safari listening, PCM identity, loudness/true-peak conformance, or repair of historical Grid/44.1kHz/WebKit7.1/readiness observations is claimed.

Detailed local evidence: `output/media-input-contract-2026-10-17-FHeizr/`: verification.json, runtime-verification.json, browser-report.json/log, browser-initial-report.json/log and artifacts, ownership-final.log, infrastructure-final.log, mutation-check.mjs/results.json, and preservation snapshots. These generated files remain ignored and unpublished.

Reproduce with `npm run test:ownership`, `npm run test:infra`, and the five selected browser specs with one worker/zero retries. The WebKit profile includes the four new checks. Use a fresh evidence directory/config to preserve prior logs. **Merge and publication remain on hold.**

Final preservation compared an 11,869-entry starting snapshot: only the 16 planned files and new documentation directory differ; no unrelated file bytes/modes/mtimes or symlinks changed. The owned loopback server was retired and its port verified closed. The feature commit and final status receipt are retained in the ignored evidence directory.
