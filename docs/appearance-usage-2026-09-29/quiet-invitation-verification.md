# Quieter invitation and sharing-first panel — 3.18.9

Implemented 2026-09-30 after Jay approved moving the provider name out of the short invitation, putting sharing before appearances, and remembering when someone continues without answering. This changes the local working tree only. No commit, push, publication or live GoatCounter traffic.

## Result

- The landing invitation and panel summary describe the optional counts without naming the software. A prominent **What’s shared and who receives it** control exposes the full categories, named GoatCounter recipient, IP/header explanation, privacy link and withdrawal information before someone decides.
- The combined **Appearance and privacy** panel puts sharing first: concise explanation, expandable details, equally styled choices and status. Appearances follow a divider. Every appearance remains available with reporting off.
- The landing detail control opens and focuses the disclosure. General panel opening starts at the top with focus on Close; it no longer scrolls past privacy information to the selected appearance. Native summary keyboard behavior and Escape remain intact. The duplicate landing invitation is visually hidden while this panel is open and returns on close if still unanswered.
- Starting an accepted file load without answering quietly retires the automatic invitation. It stays retired after clear, returning to the landing screen, reload and reopening the app. Opening settings/details or canceling the file picker does not retire it. Merely leaving the landing page open without interaction does not time out the invitation.
- Retirement writes a separate local boolean (`pref_usageInvitationDismissed`, or `pref_usageInvitationDismissedTest` locally). It is neither consent nor a recorded refusal and is never reported. The consent record remains untouched; an outdated Yes remains invalid. Settings remain available for a later explicit choice. Later Yes counts only new work, with no replay.
- Dismissal synchronizes across tabs. Clearing its preference/site data permits the invitation again. If that preference cannot be written, dismissal still works for the current page but may not survive reload. Explicit Yes/No resets the dismissal flag, preserving the normal review request if a later material scope change invalidates an accepted Yes.

Consent scope remains **2**: no collection purpose, metric category or recipient changed. Existing current Yes and saved No remain valid. APP_VERSION, service-worker cache, README and What’s New advance to **3.18.9**. README, FEATURES, MANUAL, in-app Manual, consent record, event documentation and project instructions describe the behavior.

## Verification and corrections

- [Consent/appearance/production-host browser tests](quiet-consent-tests.txt): **40 passed in 24.3 seconds**. Five new tests cover panel order/provider accessibility, quiet dismissal and later opt-in, cross-tab dismissal and preference clearing, ignored outdated Yes, and a failed dismissal-preference write. The production fixture also verifies local-test dismissal cannot hide the real-site invitation. All collector traffic was intercepted or loopback-only.
- The initial run was **39 passed / 1 failed**. Its storage-failure fixture disabled *all* localStorage writes, stopping an existing unrelated app preference write before loading could reach the new dismissal behavior. The fixture now fails only the dismissal preference write, verifying this component’s fallback without claiming the entire app supports unavailable storage. It passes and confirms the invitation can return on reload when no flag was saved.
- Existing old-consent test cases now clear the separate dismissal preference between independent scenarios; a dedicated test checks persistence of actual ignored scope review instead of inadvertently treating those scenarios as the same user continuation.
- Final layout-only refinement hides the duplicate invitation behind the open panel. [Follow-up layout tests](quiet-layout-tests.txt): **3 passed** (keyboard/provider accessibility, narrow layout/reduced motion and appearance persistence).
- [Ownership/structural checks](quiet-ownership.txt): **442 passed, 0 failed**. `git diff --check` passed. The full regression suite was not repeated for this UI/preference change; the preceding 3.18.8 full-suite result remains recorded separately.
- Rendered and inspected desktop and 390×844 mobile layouts. The collapsed mobile panel contains sharing choices and all appearances; expanded details scroll within the viewport, and choices remain reachable. Evidence: [desktop invitation](quiet-invitation-desktop.png), [desktop panel](quiet-panel-desktop.png), [mobile panel](quiet-panel-mobile.png), [mobile details](quiet-details-mobile.png).

## Local review

Open `http://127.0.0.1:8081/?usageTest=1` and reload for 3.18.9. A browser that already saved Yes or No will retain that choice. A fresh browser context shows the invitation; loading files without answering leaves reporting off and suppresses later automatic invitations. Settings can still enable sharing. Local-test and production preferences remain separate.
