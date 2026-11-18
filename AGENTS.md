# Purpose
This web app's purpose is remote bedtime reading for grandparents and their grandchildren. Both sides will concurrently have this app open on their device and, at the same time, be on a separate video call (unrelated to this app). They should see the same book pages, and the grandparents reads the book to the grandchild. When either of those turn the page, the pages are synced between both devices.

# Implementation Guidelines
1. The app is intended for laypeople who are not used to complicated setups. Essentially, it has to seamlessly work for 6 year olds and their grandparents, with no intervention needed by others.
2. This is a personal, iPad first app and the maintainer controls all instances, so changes may freely break older clients or stored data without migration paths or fallbacks. Backward compatibility is never required. iPhone compatibility is a nice-to-have, not a must-have.
3. Always think user experience first. If the intended user experience or user flow is unclear, ask.
4. Adhere to the Eight Golden Rules of Interface Design: @InterfaceDesign.md
5. When proposing functionalities or architecture, always think it through on the meta-level. The context of the UI element in question is usually the level where decisions fall out automatically. Why does the user interact with this element? How did they get here? What do they want to achieve? What does this element do in the entire in-app and out-of-app workflow? What other existing or not-yet-existing elements are related?
6. Significant architecture and product-scope decisions are recorded as ADRs in `doc/adr/`; consult them for context and add a new one when making such a decision.
7. Never jump straight to implementation. Always present your plan and the resulting user experience first and deliberate with the person requesting new code. Only implement new code when the requester explicitly states you should.
8. Do not propose adding automated tests or a linter — see [ADR 8](doc/adr/0008-no-tests-or-linter.md) for the reasoning.
9. All new code will be carefully reviewed by an expert for correctness, security, edge cases, maintainability, and fit with the existing codebase. Implement with a goal of a single positive review and no iterations needed.
10. All user-facing dialogs go through the helpers in `src/dialog.js`. Never use the native `alert`, `confirm` or `prompt`: they clash with the app's own modals, and `prompt` is unreliable in iOS standalone PWAs.

# Mood Icons
The source PNGs are not in the repository; only the WebP tiles generated from them in `public/mood-icons/` are. You need the sources only to change or add icons. They are kept in the GitHub release `mood-icons-source`: run `gh release download mood-icons-source`, then `unzip mood-icons-source.zip -d doc` to restore `doc/mood-icons/`, which `scripts/generate-mood-icons.js` reads. If the sources change, replace the ZIP in that release, because it is their only backup.

# Pull Requests
Write the body in German as usual, but trigger auto-closing of issues with an English keyword: GitHub only auto-closes on `Closes #123` / `Fixes #123` / `Resolves #123`. Therefore: Name every issue the PR finishes on its own `Closes` line at the end of the body; the German prose above it may still explain what was fixed.

Coderabbit does not review this repository automatically (it has fewer than 10 stars), so you must trigger every review yourself: after opening the PR, add a comment containing exactly `@coderabbitai review`. Retrigger the review after every push, documentation included, since every push dismisses the approval (edits to the PR title or body are not pushes and need none). Coderabbit reviews at most once per hour; a trigger inside that window is not run: Coderabbit edits its acknowledgement of the trigger to "Action not completed: Review rate limited", and its summary comment at the top of the PR into a "Review limit reached" notice naming the wait. The trigger is dropped, not queued.

As an exception to guideline 7 (never jump straight to implementation), fix no-brainer feedback directly; discuss anything that is a judgement call with the requester instead of deciding it on your own. Answer every Coderabbit thread whose suggestion was declined: Coderabbit approves only once all its threads are resolved, and lists any that are not in an "Automatic approval withheld" notice in its summary comment. Resolve a declined thread only after the requester has agreed to decline it.

Enable auto-merge (squash) on the PR right after opening it. The ruleset on `main` requires an approving review and a green `build`, and dismisses the approval on every push. Coderabbit's approval is that review, so the PR merges by itself once the review round is done; nobody merges by hand.

Do not rely on PR events reaching you. After every trigger, schedule a check-in with `send_later`: 10 minutes after the trigger, or a minute past the wait a rate-limit notice names. On the check-in, read the PR: merged means done; no reaction from Coderabbit to the trigger means it was lost, so trigger once more; a rate-limit notice means trigger again once it has run out; requested changes mean fixing and discussing as above; a failed `build` means finding its cause and fixing it, or reporting the blocker to the requester. Schedule a new check-in after each step until the PR has merged or waits on the requester.

Dependabot pull requests are exempt from the Coderabbit review. A weekly scheduled task reviews them under the repository owner's account; a Dependabot pull request is not the owner's, so the task enables auto-merge (squash) on each one it judges safe and then approves it, and the ruleset still enforces a green `build`.
