# Saved-settings reliability — October 15, 2026

Scope: independent-review finding F3, starting from released `main` at `acde748321b7912addaf751335d988c35eea82f7` (3.19.2). Feature branch: `codex/settings-reliability`. The user authorized completion through protected merge and publication after review and required checks. This is a quiet 3.19.3 maintenance release; the 3.19.1 What's New marker and summary remain.

## Behavior and rationale

`js/preferences.js` owns access to browser storage for ordinary preferences. Getter/read failures return safe defaults, malformed JSON recovers only its key even when removal fails, and known scalar preferences are checked for type and usable bounds. Failed ordinary writes retain a serialized choice in this page and show one save warning. Reloads may restore an older durable value or a default. Readable durable storage remains fresh across tabs; successful saves do not pin stale snapshots.

Shortcut bindings must be strings in an object, with prototype-sensitive property names excluded. Valid entries survive alongside invalid entries. Rotations retain only quarter turns for known slots; invalid nested JSON cannot abort startup. Colors validate independently, retaining valid fields. The existing raw keys and double-encoded rotation format remain compatible; no broad storage reset or key migration occurs.

Privacy and info-bar persistence remain with their existing owners. Their reads distinguish a missing key from an unreadable key, and strict writes still throw. Consent, invitation records, daily claims and info-bar profiles never enter the ordinary visit fallback. Unreadable permission cannot authorize sharing. An explicit Yes during a failed save retains the existing current-page-only behavior and warning; a failed No retains the existing removal/refusal protections. `js/usage.js`, its integrity hash, disclosure, consent scope and event vocabulary are unchanged.

The new classic script is loaded before the inline app and included in the versioned offline assets. No build tool or runtime dependency is added. README, FEATURES, MANUAL, in-app help/manual and AGENTS describe recovery and persistence limits.

## Review

The author's second pass checked startup reads, all ordinary write call sites, validation against actual UI bounds, cross-tab reads, module ordering, service-worker inclusion, and the strict privacy boundary. This is author review, not a new independent review. Existing ownership/source checks were updated for extraction; new preference checks execute the shipped factory with fault-injected storage rather than reproducing its implementation.

The review caught an initial regression: swallowing a failed daily-marker read made it look absent, permitting a count. The existing `daily counting fails closed on read` browser test failed. Strict owners now retain observable read failures, and five direct strict-read regressions were added. The analytics adapter itself was not edited.

## Verification and retained failures

Raw evidence: `output/settings-reliability-2026-10-15-AlnWOT/` (ignored, not deployed). `verification.json` records measured results and source hashes; hosted and publication receipts will also be retained there and linked from the PR.

- Initial ownership run: 869 passed / 3 failed, because extraction changed three source guards. Those guards were updated around the same owners and preference behavior now runs directly.
- Initial new browser run: 10 passed / 14 failed. Most failures were test mistakes: uppercase shortcut labels, an already-assigned reassignment key, reading a lexical global through `window`, rotations being reset on file loading, and acting before the final three-image layout. One startup failure reported `_loadCustomKeys is not defined` while using the temporary Python server; its cause is unestablished. The regular project server is used thereafter. Do not describe that observation as a proven app repair.
- After correcting the new tests and waiting for decoded images/layout: 24 Chrome cases passed with zero retries.
- Broader initial related run: 126 passed / 2 failed. One was the strict-read regression fixed above. The other was the existing info-bar touch-scroll test receiving `info-drop-after` instead of `info-drop-before`. A second broader run passed 127 cases and failed that same touch assertion; the daily-counting correction passed. Isolated paired touch probes passed 6/6 against both released and current production, and an added-delay baseline probe passed. Instrumentation measured a row moving 13 px after its bounding box was read and showed CDP touch delivery still pending. The test now moves the held pointer into the interior, waits for that delivery and scroll retirement, then measures the target. All scrolling, drop-order, persistence, release/cancel and close-focus assertions remain. Production drag code is unchanged. This removes an identified measurement race; the exact cause of the earlier failures is not conclusively established.
- Initial infrastructure run: 17 passed / 1 failed because the new public script was not yet tracked. Staging the intended new script satisfied the existing safeguard; infrastructure then passed 18/18.
- Baseline negative controls serve exact released HTML/hotkeys/appearance bytes in disposable contexts without reverting the checkout. Five selected cases each fail one intended behavioral assertion: damaged shortcuts, nested rotations, denied getter/read access, and failed write interrupting comparison activation. JSON validation requires one failed result/error, zero retries, no runner errors, the exact copied-file path and dynamically found assertion line. This proves the new tests detect the released defects.

Final local/hosted results and publication status are recorded separately below/in `verification.json`; earlier failures are not relabeled as passes.

## Limits and remaining work

Visit fallback is not durable storage. Generic storage recovery does not grant usage permission or replace the privacy/info-bar warnings. Recovery validates setting shapes, not arbitrary future preference schemas. No physical Safari test is claimed; Playwright WebKit is automated engine coverage.

This slice does not address asset-version coherence, unknown-size WebM clusters, loudness/true-peak conformance, broad architectural migration or the media-preparation contract. The historical Grid `topGap = -899` and prior unrelated short-preview/native-FLAC observations remain unexplained; current passes do not establish repairs.

## New independent deep review received during verification

The user supplied `warpdiff-deep-review.md`, pinned to released `acde748`. It is source-review evidence, not authorization to implement its new recommendations in this slice. Targeted inspection supports its concerns about shared MP4 audio tables across tracks, the one-second native decode race plus unconditional fallback Opus flag, fractional canvas dimensions, fixed spectrogram labels, Vorbis being returned as Opus, and the audio parser's weaker limits/exception boundary. These deserve separate reproductions and bounded fixes. Direct execution of the shipped timecode formatter reproduced `59.9996 → 00:59.1000`, `100 s @ 29.97 → 100:27` and `100 s @ 23.976 → 99:21` in the relevant formats. A fresh read-only dependency audit independently matched six affected development packages (five high, one moderate); dependencies and lockfile were not changed.

F3 and N29 overlap this saved-settings change. The remaining findings do not establish a newly introduced defect in this diff. Recommended next substantial slice: bounded audio parsing with explicit track/codec selection, then controlled decode ownership and WebM coverage. Fractional-DPR rendering, frequency labels and timecode are valuable smaller correctness slices.

Qualifications: severity is not established for every finding; source plausibility is not measured runtime impact. The precise memory peak needs measurement. Lowering the Opus restart threshold to 40 ms is not accepted without drift/listening evidence, because restart frequency matters. Timecode must distinguish elapsed seconds, frame indices and an explicitly chosen NDF/DF convention. A 16.16 sample-entry field alone cannot represent 96 kHz; codec/version-specific metadata needs validation rather than assuming reading more bits solves it. Track selection must agree with native listening or be made explicit, not merely pick a convenient track. Clear/rotation and per-slot mute retention need defined product semantics. `UNLICENSED` is deliberate, not stale metadata. The repository's default test server uses `-l 8080` without an explicit loopback host, so the review's loopback-only assumption should not be relied on. Full released Chromium inventory is 499 cases, rather than the review's approximate 380. No general absence-of-security-defects claim is inferred from this targeted review.

## Final local checks

| Check | Measured result |
|---|---|
| Related Chromium settings, appearance, consent, daily claims and info-bar suites | 128 passed, zero retries, 155.7 s |
| Complete focused WebKit profile (existing 112 + 24 settings cases) | 136 passed, zero retries |
| Ownership and pure regressions | 912 passed, zero failed |
| Release infrastructure | 18 passed |
| Five released-baseline negative controls | All failed their intended behavioral assertions |

JSON reports were checked for complete expected local counts, one result per case, no runner errors, failures, skips or retries. Full hosted Chromium and the focused WebKit inventory remain required on the PR and on `main`; local related coverage does not claim to be the complete Chromium suite. All local browser runs used one worker, sequentially. Existing media fixture sentinels were present and fixture writes were refused unless byte-identical (identical writes were skipped).
