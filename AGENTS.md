# Purpose
This web app's purpose is remote bedtime reading for grandparents and their grandchildren. Both sides will concurrently have this app open on their device and, at the same time, be on a separate video call (unrelated to this app). They should see the same book pages, and the grandparents reads the book to the grandchild. When either of those turn the page, the pages are synced between both devices.

# Implementation Guidelines
1. The app is intended for laypeople who are not used to complicated setups. Essentially, it has to seamlessly work for 6 year olds and their grandparents, with no intervention needed by others.
2. Always think user experience first. If the intended user experience or user flow is unclear, ask.
3. Adhere to the Eight Golden Rules of Interface Design: @InterfaceDesign.md
4. Never jump straight to implementation. Always present your plan and the resulting user experience first and deliberate with the person requesting new code. Only implement new code when the requester explicitely states you should.
5. All new code is reviewed by an expert reviewer. Implement with a goal of a single positive review and no iterations needed.
6. Backwards compatibility is never required. This is a personal app and the maintainer controls all instances, so changes may freely break older clients or stored data without migration paths or fallbacks.

Significant architecture and product-scope decisions are recorded as ADRs in `doc/adr/`; consult them for context and add a new one when making such a decision.

Do not propose adding automated tests or a linter — see [ADR 8](doc/adr/0008-no-tests-or-linter.md) for the reasoning.
