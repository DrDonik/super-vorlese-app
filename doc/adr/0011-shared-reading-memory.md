# 11. Shared reading memory: a mood ritual at book completion

Date: 2026-06-03

## Status

Superseded by [ADR 12](0012-mood-ritual-honours-divergence.md)

## Context

The app keeps two readers — typically a grandparent and grandchild on a video
call — on the same page of a book (issue #65). Finishing a book together is an
emotional beat that, until now, the app did nothing with: the last page simply
ended. We want a brief, shared closing ritual that turns "we finished" into a
small keepsake attached to the book, without adding setup, accounts, or anything
a six-year-old or a grandparent could get stuck on.

The constraints that shaped the design:

- It is **interpersonal, not solitary**. It only makes sense when two people
  finished *together*, so it must be gated on an active sync session and never
  intrude on solo reading.
- It must reuse the existing real-time substrate (Firebase Realtime Database
  rooms) rather than inventing a parallel channel, consistent with page sync
  (ADR 7) and the remote pointer (ADR 10).
- The room model is deliberately **durable, not live-presence** (ADR 7): a
  dropped connection must not count as "left". The ritual has to degrade
  gracefully when one side steps away mid-selection.
- Closure should feel **earned and automatic**, not bureaucratic — no "submit"
  button (Golden Rules: informative feedback, yield closure).

## Decision

When a synced pair reaches the last page, offer a **mood ritual**: both readers
independently pick exactly four mood illustrations; once both have four and at
least three overlap, the screen **locks itself** and the agreed moods are saved
as a dated completion record on the book.

- **Trigger.** Only when a sync session is active and the reader is on the last
  page. A persistent "Fertig? Gefühle teilen" cue on the last page is the
  primary, discoverable entry point; turning forward past the last page is the
  second. Leaving to the library is *not* a trigger (it would hijack an explicit
  "I want to leave"). Solo reading keeps the existing end-of-book card unchanged;
  the mood screen replaces that card only when synced.

- **Selection sync.** Each side writes its picks to `rooms/{code}/mood/picks/
  {clientId}` and sees the other's picks arrive live, mirroring the pointer
  mechanism. The presence of a `mood/open` flag is the signal for the partner's
  device to open the screen too, so either reader's trigger opens it on both.

- **Auto-lock via transaction.** The lock rule (both picked 4, ≥3 overlap) is
  deterministic, so both devices may detect it at once. A Realtime Database
  transaction on `rooms/{code}/mood/lock` collapses simultaneous attempts into a
  single canonical record (one timestamp, one shared/personal split). Both
  devices then read that record back and persist the **identical** completion
  locally — so there is no per-reader identity to reconcile.

- **What is stored.** A completion is `{ id, completedAt, shared:[…],
  personal:[…] }`: the agreed moods, plus each side's single divergent pick (0–2
  total). Records are appended to a per-book `completions:{bookId}` list in
  IndexedDB; finishing again adds another dated entry, with no cap and no memory
  of previous picks. The most recent read surfaces as a mood strip on the book's
  cover, which opens the full chronological history; tapping the cover itself
  still goes straight to reading.

- **Cancellable, resilient.** Either party can cancel at any time, which clears
  the shared node and closes both screens with no record saved. If one side
  steps away mid-selection the screen stays open for the other; the lock simply
  never fires (it requires the partner's four picks), so the durable-presence
  model (ADR 7) needs no exception.

## Consequences

- The mood illustrations are shipped as small WebP tiles under
  `public/mood-icons/`, generated from heavy source PNGs in `doc/mood-icons/` by
  a build step (mirroring the existing icon generation). The ~52 MB of source
  art is intentionally not committed; the ~180 KB of generated tiles is, and the
  generator no-ops when the sources are absent so a clean checkout still builds.
- `database.rules.json` gains a validated `mood` subtree (open flag, per-client
  picks, and the lock record), keeping the room schema closed.
- The completion record stores no reader identity by design. This keeps the data
  symmetric and trivial to sync, at the cost of not being able to label which
  personal mood belonged to whom — an acceptable trade for a two-person ritual.
- More than two participants can share a room (multiple reading circles). The
  ritual is scoped to a pair: a lock forms from this device plus whichever
  partner's picks satisfy the rule. Multi-party mood reconciliation is out of
  scope.
