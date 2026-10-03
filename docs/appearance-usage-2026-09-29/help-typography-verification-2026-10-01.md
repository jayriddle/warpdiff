# Help body-text owner — 2026-10-01

Jay reported oversized Appearance and privacy text in Getting Started and requested an owner for the proper size. The release candidate remains **3.18.12**, consent scope **4**.

## Cause and change

The popup's list rule specified 13px text, but `.quick-start-body` did not specify a body size. The long Appearance and privacy paragraph therefore inherited the browser's 16px default. It was visibly larger than neighboring instructions and repeated the full disclosure as one dense paragraph.

`.quick-start-body` now owns the **13px** body size, text color and 1.7 line height for Help and What's New. Lists and paragraphs inherit it; tables explicitly inherit the size. Removed the list-level size and the icon table's inline size. Headings, keyboard badges and footer links retain their existing role-specific sizes. Paragraph spacing has a shared rule, so future paragraphs will also inherit the correct typography.

Reduced the Getting Started appearance/privacy entry to three short bullets: where to choose the five appearances, optional sharing with all features available either way, and where to read the details or change a remembered choice. The complete privacy disclosure remains in Appearance and privacy and the in-app/Markdown manuals. Analytics code, consent scope, disclosure/collector contract, app/cache versions and What's New content did not change.

Recorded the typography owner and concise-help convention in `AGENTS.md`. Only the popup presentation was affected, so the existing capability descriptions in README, FEATURES and MANUAL remain accurate.

## Verification

- In the local in-app browser at 1280 × 720, inspected the updated popup visually. [Screenshot](help-typography-evidence-2026-10-01/help-desktop.jpg).
- Actual [computed styles](help-typography-evidence-2026-10-01/computed-styles.json) show 13px for the popup body, all three appearance/privacy bullets, the surrounding list text and the icon table. The body line height is 22.1px.
- Existing help/shortcut browser test: **1 passed, 1.6 seconds, no retries**. The test exercises opening H, closing it, and opening Help with ?. No new test was added for this low-impact presentation edit.
- Existing ownership/pure-logic harness: **444 passed, 0 failed**. App/cache/README alignment and analytics integrity/contract checks pass.
- `git diff --check` passed. The usage adapter hash remains `sha256-D9dsUTie8UWB9gfEf84gTtysJGT1vFfXMUuzNYbjglE=`.

No failing check occurred. Native Safari was not revisited or interrupted while Jay was performing listening tests. This typography edit was visually checked in the in-app browser; it does not expand the previous Safari media verification. No full media or analytics suite was rerun for CSS/help copy alone.

The local server at `http://127.0.0.1:8081/?usageTest=1` serves the update on reload and remains running for Jay's Safari checks. The temporary background inspection tab was closed. No commit, push, deployment or live analytics request was performed.
