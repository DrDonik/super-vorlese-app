# 13. No large-group (classroom) support; the app stays an intimate reading circle

Date: 2026-06-07

## Status

Accepted

## Context

[ADR 9](0009-per-peer-book-transfer.md) namespaced the WebRTC book transfer per joiner so a small reading circle
— a grandparent reading to two or three grandchildren — can all pull the book at
once. It explicitly left the **large-group** case (one reader streaming to ~20+
listeners, e.g. a teacher reading remotely to a class) out of scope, tracked
separately as issue #58.

Issue #58 lays out what large-group support would take:

- **Move the bundle off the reader's device.** Per-peer fan-out from a phone does
  not scale to 20 simultaneous transfers (uplink, CPU, memory). The proposal is to
  upload the `.vorlese` bundle once to cloud storage (e.g. Firebase Storage) and
  have joiners download it from there.
- **A "who's driving" page-control role.** In a classroom you want only the reader
  turning pages, rather than the symmetric "anyone may turn" the app has today.
- **A holder-concede optimisation** for many simultaneous joins.

What *already* works at any size is the page sync itself: the room holds a single
shared current page and every device just renders whatever anyone wrote, with no
re-broadcast. So this is not a question of whether the plumbing *could* be made to
scale — it largely could. It is a question of whether we *should*, and that is a
product-scope decision rather than a technical one.

The app's purpose (see [AGENTS.md](../../AGENTS.md)) is **remote bedtime reading for grandparents
and their grandchildren** — a close, mutual, one-to-a-few experience for laypeople
with no setup, designed so a six-year-old and a grandparent can use it with no
intervention. Nearly every feature is shaped around that intimacy and would have to
be *undone* for a classroom:

- The book-closing **mood ritual** is deliberately scoped to one-to-three intimate
  participants and bows out entirely at four or more ([ADR 12](0012-mood-ritual-honours-divergence.md) and its amendment).
  It celebrates the feelings *two people shared across the distance* — meaningless,
  even faintly absurd, broadcast to a class of twenty.
- The **remote pointer** and the **shared "we finished this together" keepsake**
  likewise presume a small, trusting circle.
- **Symmetric page control** ("either reader may turn the page") *is* the intimacy;
  a classroom needs the opposite — an asymmetric "teacher drives, class watches"
  role, i.e. a different interaction model.

A classroom version is therefore not a bigger version of this app; it is a
*different product*, and pursuing it would pull in exactly the machinery this app
exists to avoid: server-side hosting of whole book bundles (storage billing, a
content-lifecycle/cleanup model, and copyright exposure from holding books in the
cloud rather than transiting them ephemerally between two devices that already hold
them), plus roles, permissions, and the moderation/accounts concerns that follow.
Each of those erodes the "nothing to administer, works for a grandparent and a
six-year-old" property that defines the project.

## Decision

We will **not** support large reading groups (classrooms, ~20+ listeners). The
supported scope is a small, intimate reading circle — typically a grandparent and
one or two grandchildren. Concretely:

- Book transfer stays **peer-to-peer** ([ADR 5](0005-webrtc-book-transfer.md), [ADR 9](0009-per-peer-book-transfer.md)). We will not upload
  bundles to cloud storage for fan-out. The small-group ceiling of per-peer
  transfer is the supported ceiling **by design**, not a limitation to fix.
- Page-turn control stays **symmetric** — anyone in the room may turn the page. We
  will not add a reader/teacher "who's driving" role or page-control permissions.
- The holder-concede optimisation is not pursued for the sake of scale.

Issue #58 is closed as out of scope.

## Consequences

- [ADR 9](0009-per-peer-book-transfer.md)'s per-peer transfer remains the only transfer mechanism; its handful-of-
  joiners ceiling is intentional.
- No server-side book hosting: no storage billing, no content-moderation or cleanup
  model, and no copyright exposure from hosting whole books — the bundle only ever
  lives on participants' devices and transits ephemerally between them.
- The interpersonal features (mood ritual, remote pointer, shared keepsake) stay
  coherent because they only ever face a small circle; we never have to build a
  "broadcast mode" that disables them.
- If the project's purpose ever changes — a deliberate pivot to educational or
  classroom use — this is the decision to revisit. It would be a new product
  direction, not an incremental feature, reopening hosting, roles, accounts, and
  moderation as first-class concerns.
- The holder-concede tweak, if ever wanted for snappier *small*-group joins, can be
  taken up on its own narrow merits, decoupled from any notion of scale.
