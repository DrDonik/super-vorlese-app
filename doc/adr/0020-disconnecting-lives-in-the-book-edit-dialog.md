# 20. Disconnecting lives in the book's edit dialog, not on the reading surface

Date: 2026-08-14

## Status

Accepted

## Context

[ADR 19](0019-shared-reading-starts-in-the-library.md) made the reader's sync
panel open by itself after „Gemeinsam lesen" → „Buch auswählen", so it is now the
first thing a newcomer sees with a Synchronisations-Code on it. That panel
carried a full-width red „Trennen" directly under the code, and it acted on one
tap with no confirmation.

`syncStop()` does three things at once (`src/reader.js`, `src/sync.js`):

1. `leaveRoom` removes this device's membership — and if nobody else is enrolled,
   **deletes the room node outright**.
2. `removeRoomForBook` drops the locally saved code.
3. The panel returns to its inactive state and **clears the code display**.

So a mis-tap while reading the code out over the phone kills the code in the same
motion: the partner types it and is told it does not exist, and the code is gone
from the screen and from storage, with nothing saying what happened. If the
partner had already joined, the room survives ([ADR 7](0007-presence-based-room-lifetime.md))
but they are never told — `onRoomDeleted` fires only when the room node itself
disappears — so their device keeps showing a live session that no longer reaches
anyone.

Guarding it with a confirmation was considered and rejected on the project's own
reasoning from [ADR 17](0017-sync-is-the-only-sharing-path.md): "a confirmation
does not prevent the misfire — it asks the person who just misfired to confirm".
That ADR's answer for deleting a book was to *move the control*, not to gate it.

## Decision

**„Trennen" moves into „Buch bearbeiten", beside title, tags and deletion.** The
reader's code screen keeps only what it is for: the label, the code, the sentence
saying what to do with it, and „Schliessen".

This is [ADR 17](0017-sync-is-the-only-sharing-path.md)'s trade applied a second
time — a control used a few times a year has no place on a surface used every
evening — and it lands somewhere more coherent than the reader ever was: a
Synchronisations-Code belongs to a **book** ([ADR 15](0015-sync-code-naming-convention.md),
and the room is keyed per book id), and the book's own dialog is where a book's
lasting properties are changed.

Generalised, for controls added later: **what permanently changes a book lives in
„Buch bearbeiten"; the reading surface carries only what is used while reading.**

Details that follow from it:

- The section **exists only while the book carries a code**. An empty „Gemeinsam
  lesen" rubric in every book's dialog would be a standing question for the many
  books nobody ever reads together — the same rule the filter row follows in
  [ADR 16](0016-personal-tags-and-shelf-filtering.md).
- „Trennen" is **neutral, not red**. On that screen the red lettering belongs to
  „Buch löschen", which destroys the only copy of photographed pages; giving both
  the same colour would flatten a real difference, and per
  [ADR 4](0004-interactive-color-scheme.md) each colour has exactly one job.
- It **ends the dialog**, the same shape „Buch löschen" has, so „Abbrechen" never
  has to mean "and undo that too". Anything typed is dropped with it: giving up
  the code and renaming the book are separate errands.
- The shelf says so afterwards. Nothing on a book card shows sync state, so
  without a line in the status bar the tap would have no visible result at all
  (rule 3).

**„Verbunden" is gone from the code screen.** The code display is already green,
and green is this app's one meaning for connected (ADR 4) — the line repeated the
colour in words. It was also subtly untrue: it reads as "your Lesepartner is
there" when all it ever meant was "this device is enrolled in the room".

## Consequences

- Getting out of a session **from inside the book** now costs leaving the reader,
  the pencil, and the dialog. This is the price. It is small: a code that exists
  but is the wrong one opens a *different book*, which is obvious immediately, and
  going back is one tap.
- Getting a **fresh code** for the same book — the „one book, one code" limit in
  ADR 19 — becomes easier to find rather than harder: it is now a deliberate act
  on the book, in the place one would look, instead of a red button inside the
  reader.
- `syncStop()` stays in the reader; it is still how the view tears a session down
  when a room disappears or a new code replaces an old one. Only the button is
  gone.
- `closeSyncForBook()` already worked without a live session (it is what deleting
  a book calls), so the library needed no new sync machinery.
- The reader's sync panel now has exactly one control in its connected state:
  „Schliessen". A screen that appears unbidden in front of a technically
  inexperienced adult offers nothing that can go wrong.
