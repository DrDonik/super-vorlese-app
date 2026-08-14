# 21. „Buch bearbeiten" keeps no draft: there is no „Speichern" and no „Abbrechen"

Date: 2026-08-14

## Status

Accepted

## Context

„Buch bearbeiten" collected a title, a set of tags, a way to give up the book's
Synchronisations-Code and a way to delete it, and committed the first two only
when „Speichern" was pressed. Tapping a tag chip flipped it to `aria-pressed`
and a new one typed into the field appeared in the picker straight away, so the
dialog answered every tap as if the tag were now on the book — while nothing had
been written. The feedback was a promise another button had to keep (issue #155,
rule 3).

Making only the tags immediate is not open to us as a half-step. Tags have no
existence of their own: the set of known tags is derived from the books carrying
them ([ADR 16](0016-personal-tags-and-shelf-filtering.md)), so "store this tag"
can only mean "write it onto this book". Adding and toggling are therefore the
same write, and two chips in one row committing at different moments would be
worse than the flat delay they replaced.

Once tags are immediate, „Abbrechen" cannot keep its meaning. It would undo the
title and leave the tags — a button that takes back half of what was done, with
nothing on screen saying which half.

## Decision

**Nothing in the dialog is a draft.** A tag is written the moment its chip is
tapped. The title is written when the dialog closes — by any route: „Fertig",
Escape, a click on the backdrop, or „Synchronisation trennen". The dialog's
closing row holds one button, „Fertig", and „Abbrechen" is gone.

This is the shape of a settings sheet rather than a form: what is on screen is
what is stored, and leaving is not a decision the user has to get right.

Details that follow from it:

- **„Fertig" is never disabled.** A closing button that can be greyed out traps
  whoever cleared the title field (rule 7). An emptied field means the book keeps
  the title it has, and the unchanged card behind the dialog says so.
- **The title field is no longer focused on opening**, and so no longer
  select-all'ed. With no „Abbrechen" left to catch it, a preselected title is one
  stray keystroke from gone. It also keeps the phone keyboard down, which used to
  cover the tag list before it had been read.
- **A failed tag write is reported inside the dialog**, next to the chips, and
  puts them back to the last state that really was stored. `showAlert` cannot be
  used from within an open dialog: dialogs are serialized, so the alert would
  appear only after this one closes, long after the chip it is about.
- **Tag writes are chained in tap order** and only the newest may still repaint
  the chips, so two quick taps cannot land the wrong way round or leave the
  picker showing an older write's outcome.
- **„Synchronisation trennen" saves the title too.** Every way out saving what
  was typed is the whole point; one that quietly dropped it would be the single
  surprise this dialog can no longer afford. Deleting is the exception, and only
  because the book goes with it. This supersedes the third bullet under Decision
  in [ADR 20](0020-disconnecting-lives-in-the-book-edit-dialog.md), which had
  „Trennen" discard anything typed — that reasoning rested on an „Abbrechen"
  that no longer exists.

## Consequences

- **A rename can no longer be taken back in one tap** (rule 6). This is the price
  of the decision. It is bounded: the new title is on the card the moment the
  dialog closes, so the mistake is visible rather than silent, and the pencil is
  one tap away. Not focusing the field removes the accident that would have made
  this bite.
- **Escape no longer means "discard".** It does what „Fertig" does, on purpose:
  two ways of dismissing the same dialog that differed in what they left behind
  would be a surprise for the expert and invisible to everyone else.
- `updateBookDetails` is replaced by `updateBookTitle` and `updateBookTags`.
  Writing both on every chip tap would mean saving a title still being typed.
- The shelf is still rebuilt only once, after the dialog closes, and now waits on
  the chain of tag writes first — it must not be rebuilt from a store that is one
  write behind what the user just saw.
- The dialog got shorter by a button, which is the other half of issue #155: the
  closing row is one unambiguous action instead of a pair to choose between.
