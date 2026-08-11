# 17. Sync is the only sharing path; the book card keeps one action button

Date: 2026-08-11

## Status

Accepted

## Context

Every book card carried three 32-px buttons in its top-right corner — share,
edit, delete — sitting on the cover, a fingerwidth from the surface that opens
the book, and permanently visible on touch devices.

Two problems met there.

**The share button had lost its job.** It exports the book as a `.vorlese`
bundle and hands it to the system share sheet or downloads it. Since sync
sessions began transferring the book itself ([ADR 5](0005-webrtc-book-transfer.md),
[ADR 9](0009-per-peer-book-transfer.md)), nobody has shared a book as a file:
the partner who needs the book gets it by joining the room. A control used once
a year sat on every cover, every night (issue #143).

**Delete was the wrong neighbour for open.** A confirmation dialog already
guarded it, but a confirmation does not prevent the misfire — it asks the person
who just misfired to confirm, and its bright button is the destructive one. For
a six-year-old aiming at a book and meeting a red warning instead, that is thin
protection (issues #130, #131).

The card's construction was the third problem underneath both: a
`div[role="button"]` containing four real buttons. Invalid ARIA, a contradictory
screen-reader structure, and the reason the click handler had to work out which
of the nested buttons a tap had really meant (issue #128).

## Decision

**Books are shared by reading together, not by sending files.** The share button
is gone from the card. `.vorlese` remains as a *format* — it is what a sync
session ships to a joining device — but the app no longer offers the user a file.
Import still accepts `.vorlese`, so bundles that already exist keep working;
that costs no visible surface.

`shareOrDownload()` stays in `bundle.js` without a caller, marked as such. A
local backup of photographed books is the use case that would want it back, and
those photos exist nowhere else.

**Deleting moved into the „Buch bearbeiten" dialog**, on a separated row below
title and tags, with the existing confirmation behind it. Deleting a book now
costs three taps instead of two. That is the right trade: opening a book happens
every evening, deleting one happens a few times a year, and only one of them is
irreversible.

**The card became honest markup.** It is a plain container holding a real
`<button>` for „Buch öffnen" that spans the whole card, with the cover, title and
page count painted over it and passing taps through (`pointer-events: none`),
and the pencil and the mood strip layered above catching their own. Nothing
visual moved. The hand-written Enter/Space handling and the
`closest('.book-actions')` filter are gone — a real button does both by itself.
The „Gemeinsam lesen" tile, which has no controls of its own, simply became a
button.

With one action button left in the cover's top-right corner, it fits 44 px:
three did not, on a 140-px column.

## Consequences

- Moving a book to a second device now requires a sync session with both devices
  online at once. Producing a `.vorlese` file offline is no longer possible from
  the UI. This is the one capability the change costs, and the reason
  `shareOrDownload()` is kept rather than deleted.
- Deleting a book cannot be reached from the shelf any more, only from a dialog
  the user opened on purpose. It does not make deletion reversible — issue #131
  is untouched, and the confirmation stays for that reason.
- Per book, at most three keyboard stops remain instead of at most five, each a
  real control with a name: „öffnen" and the pencil always, the mood strip only
  once the book has been finished together at least once.
- `openDialog()` gained a `dangerButton` slot: a destructive action on the
  dialog's subject, rendered on its own row above the accept/cancel pair, which
  share their row evenly and would otherwise place a delete beside „Speichern".
  It is styled like the app's other dialog buttons, and so inherits their 43px
  height rather than reaching 44px — a detail for issue #130's pass over the
  app's remaining targets, not a card concern.
- The card's tap targets are settled; the rest of issue #130 — the 20-px photo
  discard, the reader chrome, the page indicator — is a separate pass.
