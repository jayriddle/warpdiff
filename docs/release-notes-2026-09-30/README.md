# What's New compaction — 2026-09-30

Condensed the pending 3.18.11 release popup from 106 historical/development entries (about 5,271 words) to two bullets. After verifying the actual public baseline, the final copy is:

- More consistent audio volume when scrubbing forward or backward.
- New Starfield, Solar, Nebula and Glacier appearances.

The version appears once in the popup header. Removed implementation steps, repeated interim appearance adjustments, analytics test details and older release history from the popup. Hosted reporting remains disabled, so the summary does not advertise it as an available new feature. Preserved all prior entries in [the release-note archive](../release-notes-archive.md), marked as historical and potentially superseded.

Updated AGENTS.md to keep future popups to one current-release summary with two or three brief user-facing bullets. README links to the archive. Retained the existing unpublished version, 3.18.11, rather than creating another release number for an editorial cleanup. No comparison or analytics logic changed.

Verification: ownership/pure-logic harness **444 passed, 0 failed** ([log](ownership.txt)); whitespace check passed. A disposable Chromium context simulated an upgrade from 3.17.8 and verified the popup has only two bullets, fits without scrolling at 1280×800 and 390×844, dismisses correctly and saves 3.18.11 as seen, with zero page errors ([results](browser-check.json)). No new permanent tests were added for this small editorial change; the unrelated media suite was not repeated.

The first preview passed at desktop width but failed the narrow-viewport boundary check: the existing fixed 420 px popup overflowed a 390 px viewport. Replaced its width with a viewport-capped value and repeated both checks successfully. Final screenshots were visually inspected: [desktop](desktop.png), [mobile](mobile.png).

## Follow-up: important changes since the actual public release

The live site and latest successful Pages deployment identified **3.17.5**, deployed 2026-09-16 at commit `a950a15b73dcb4aaf4e0e205d372c0a483767607`, as the public baseline. The initial compaction incorrectly focused on 3.18 changes and paired appearances with the Grid ordering fix. Jay clarified that only the most important issues should appear. Replaced that minor-fix bullet with the forward/backward scrub-volume improvement from unpublished 3.17.7–3.17.8. Omitted the keyboard-focus fix and other minor fixes. The popup remains two bullets, with no additional version bump.

Updated the working rule to select highlights relative to the verified public release. The screenshots and browser results above record the initial wording/layout check; they are retained as historical verification, not screenshots of the revised text. This follow-up changed prose only: inspected the two-item markup and passed `git diff --check`; no browser or media tests were repeated.

Existing unrelated working-tree changes were preserved. No commit, push or deployment.
