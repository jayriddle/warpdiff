# WarpDiff 3.18.12 release verification — October 2, 2026

Jay authorized deployment of the reviewed standalone candidate on October 2. GitHub Pages publishes `master` from the repository root. The previous public revision is `a950a15b73dcb4aaf4e0e205d372c0a483767607` (3.17.5). The release includes the six previously unpublished commits plus the reviewed working-tree changes.

The application adds landing appearances and consent-controlled, scope-4 usage/reliability counts, preserves hidden Grid slot ordering, improves help typography, and addresses Safari seek/presentation and scrub-output behavior. App/cache versions are 3.18.12. The analytics document/adapter contract is `3.18.12/scope-4`; the collector's HTML integrity remains `sha256-D9dsUTie8UWB9gfEf84gTtysJGT1vFfXMUuzNYbjglE=`. Provider configuration and its limits are recorded in [usage-account.md](usage-account.md).

## Verification and independent decision

- The [current-candidate full regression](appearance-usage-2026-09-29/release-checkpoint-2026-10-02.md) passed **344 browser tests**, with one existing skip, zero failures/flaky cases/retries, and **467 ownership/pure-logic checks**.
- The [independent focused review](appearance-usage-2026-09-29/focused-safari-review-2026-10-02.md) recommends **SHIP** for standalone WarpDiff and **HOLD** for a future WarpCap bundle upgrade. It reproduced no actionable standalone production defect. Its separate full run retained one transient-label test failure, not a demonstrated conversion failure.
- The [follow-up](appearance-usage-2026-09-29/focused-safari-followup-2026-10-02.md) fixes that test's observation race, with **9 audio-format cases and 467 ownership checks passing**. Real WASM conversion still runs; both original and final labels must be recorded in order. No reviewed browser runtime bytes changed.
- Release packaging adds `scripts/` to `_config.yml` exclusions. Existing `docs/`, `tests/`, dependency and Markdown exclusions remain. **467 ownership checks passed again after this packaging change.** No additional application behavior or collection category changed.

Release source/documentation/tests and the primary verification reports are committed. Detailed local browser captures, raw collector/test logs, synthetic media, and copied neighboring WarpCap source are preserved in the local evidence directories rather than added to the public repository. Those reports' evidence links are workspace references; public Markdown reports are not a complete reproduction bundle.

## Limits and separate host work

The historical Safari silent direct-output trigger remains unidentified. Native generated-stream output was audible in Jay's original session, and both direct output and the shipping workaround were subsequently audible while scrubbing his original clips. Chromium capability fixtures verify policy, scheduling and signal flow rather than native hearing. Surround/mobile codec support and extra output latency retain the documented limits; no new universal support claim is made.

WarpCap has its own pinned viewer. The review reproduced an existing host-cover/deferred-resume defect in both its current 3.14.5 vendor and this candidate. Publishing standalone WarpDiff does not update that bundle. The future host upgrade remains held for a single viewer suspension owner and actual host lifecycle/activity acceptance.

The deployment operation must confirm the Pages build's commit and the live HTML, extracted scripts, service worker and generated `version.json`. Hosted analytics aggregation is still a separate deliberate opt-in/dashboard check; local and intercepted tests did not send a live count. Final publication receipts and any failed checks/resolutions are retained in the local deployment record.
