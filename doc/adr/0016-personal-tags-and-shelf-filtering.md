# 16. Personal tags, and filtering rather than grouping the shelf

Date: 2026-08-10

## Status

Accepted

## Context

With many books the library becomes hard to survey (issue #140). Households
want to separate their shelf along their own lines — by the child the book
suits, by whether it has been read — and the obvious vehicle is user-defined
tags.

The constraints that shaped the design:

- Organising the shelf is a **power-user job**: the parent who keeps the
  library, not the six-year-old or the grandparent who reads from it. The
  feature must therefore be as close to invisible as possible for everyone who
  never uses it.
- A book can carry **several tags** at once ("5 Jahre" and "gelesen"), so any
  presentation has to cope with overlap.
- The app already records when a book was **finished together**: the completion
  records of the mood ritual (ADR 11/12).

## Decision

**Tags are filtered, not grouped.** A single-select chip row sits below the
existing sort pills; tapping the active chip clears the filter, so there is no
separate "Alle" chip. Grouping by tag with headings was rejected: a book with
several tags would either appear more than once on the shelf or need an
arbitrary "primary tag" rule, and the sort pills already own the notion of
arranging the shelf. Single select also spares users boolean logic.

The chip row **does not exist** until there is something to filter, and the book
cards themselves are unchanged — no tag badges on covers. A library nobody has
tagged looks exactly as it did before.

**"Finished" is derived, never auto-tagged.** Two built-in chips, "Schon
gelesen" and "Noch nicht gelesen", partition the shelf using the completion
records. They appear only as a pair and only while both sides are non-empty;
otherwise one chip would show everything and the other nothing. The originally
proposed behaviour — writing a "gelesen" tag when a book is closed — was
rejected: closing a book usually means "that's enough for tonight", so the tag
would be wrong more often than right, and silently attaching a false label
violates the rules on keeping users in control and preventing errors. Deriving
the fact from data the app already holds cannot be wrong and stores nothing.

Because every chip is derived from the books actually on the shelf, no filter
can ever produce an empty grid.

**Tags are strictly personal.** They live on the book's metadata record
(`meta.tags`), and are deliberately absent from the `.vorlese` bundle and from
the sync session. Tags encode one household's view of its own shelf; shipping
them to a reading partner would impose that view on someone who did not ask for
it and would make a filter row appear unbidden on a grandparent's device —
exactly the intrusion this feature must avoid. The page-sync channel is
untouched.

**No tag registry, and no place to manage tags.** The set of known tags is
derived from the books carrying them, so a tag removed from its last book
ceases to exist and an explicit delete is unnecessary. Tags are created and
assigned in one place: the pencil on a book card, which now opens "Buch
bearbeiten" (title plus tags) instead of a bare rename prompt. Reusing that
button keeps the card at three controls.

**The active filter is session-scoped.** It is deliberately not persisted the
way the sort mode is: a filter hides books, and nobody should open the app to a
shelf that is silently half empty. It survives the library view being remounted
(open a book, come back) and dies with the page.

## Consequences

- `storage.js` replaces `renameBook()` with `updateBookDetails()`, writing title
  and tags in one transaction, matching the single edit the dialog offers.
- `dialog.js` exports its previously internal `openDialog()`, extended with an
  optional content area and a per-button `getValue`, so the edit dialog reuses
  the existing overlay, queue and focus trap rather than a second copy of them.
- Tags entered in a capitalisation that already exists on the shelf are folded
  onto the existing spelling, so the filter row cannot offer "Gelesen" beside
  "gelesen".
- Renaming a tag is not supported: it would mean rewriting every book that
  carries it, for a feature whose whole point is to stay small. Removing the tag
  from each book and adding the new one achieves the same result.
- A book exported and re-imported — on a second device of one's own, say —
  arrives without tags. Accepted as the price of keeping them personal.
- *[ADR 36](0036-books-are-for-tonight-and-the-shelf-is-not-an-archive.md)
  fixes the ceiling this feature grows to: sorting and tags are a way to find
  tonight's book, not a system to keep. No folders, no collections, no metadata
  beyond title and tags.*
- On iOS an installed PWA is frozen rather than reloaded (ADR 11), so there the
  filter also survives what a user would call closing the app. The selected chip
  stays visible above the grid throughout, so a short shelf always carries its
  own explanation and is one tap from coming back.

## Amendment (2026-08-29): the chips combine with AND, and a dead chip greys out

Single select was chosen so nobody would have to think in boolean logic. The
question it cannot answer turns out to be the ordinary one: *„was kann ich
diesem Kind heute Abend vorlesen, das wir noch nicht hatten?"* — „Noch nicht
gelesen" **and** „Ab 7 Jahren". Neither chip alone gets there, and the shelf a
household reaches for at bedtime is exactly the intersection.

**Chips are multi-select and combine with AND.** Tapping a chip adds its
condition; tapping a pressed chip drops it again. There is still no „Alle" chip
and no operator to choose: the only boolean anyone meets is the one they
already mean when they name two things at once.

**A chip that would leave the shelf empty is greyed out and refuses taps.** This
is what keeps the original guarantee — *no filter can ever produce an empty
grid* — after the thing that used to provide it, one condition at a time, is
gone. It is the interface preventing the error rather than reporting it
(rule 5): no sequence of taps can reach an empty shelf, so nobody is asked to
undo a move the interface let them make.

Three things follow from doing it this way rather than allowing the empty
result:

- **„Schon gelesen" and „Noch nicht gelesen" exclude each other for free.** No
  book is both, so pressing one kills the other by the same arithmetic that
  kills „Märchen" when no fairy tale is unread. The pair needs no rule of its
  own, and the row has one behaviour throughout (rule 1).
- **Dead chips keep their place.** Removing them instead would slide the row out
  from under the finger, and would throw away the answer to a question the user
  just asked: that there is no unread book for a seven-year-old is worth seeing.
- **A pressed chip is never dead.** Dropping a filter only ever widens the
  result, so every choice can be taken back with one tap (rule 6).

**The shelf can still empty out under a selection already made,** and there it
says so. Take the last 7+ book the two of them had finished off „Ab 7 Jahren"
with the pencil, and „Schon gelesen" plus „Ab 7 Jahren" is suddenly nobody. The
grid then carries the same kind of note the empty library has always carried,
and points at the lit chips above it. Repairing it by dropping a filter was
rejected: the shelf would answer an edit to one book by producing a dozen
others, which is a larger surprise than the empty shelf and a worse account of
what was asked for (rule 7). The lit chips are the explanation, and either of
them is one tap from undone — the way out is the way in.

## Amendment consequences

- `activeFilter` becomes a module-level `Set`; the lifetime argument above is
  unchanged, and a chip that disappears under the user (its last book deleted or
  retagged) now drops out of the set individually instead of clearing it.
- The chip row is rendered after the grid's contents are known, because
  liveness is a fact about the shelf that is about to be drawn.
- A tap redraws the row twice: once at once, from the shelf the last render
  measured, and again when the render that follows returns. Only the first one
  makes „no sequence of taps reaches an empty shelf" true — the render reads
  storage, and until it came back the row still offered the neighbours the tap
  had just killed, so two quick taps walked straight past the greying.
- Chips are still built from the whole shelf, so the row's contents and order
  never depend on what is selected — only the greying does.
- The dead state is a dimming of the whole chip rather than a colour of its own,
  so it follows the tokens into the increased-contrast variant (ADR 32): 7.3:1
  falls to 2.9:1 normally and 12.4:1 to 4.3:1 there. Below the text minimum on
  purpose — it is a disabled control, and it has to be plainly weaker than the
  live chip beside it.
- Clearing several filters costs one tap each. Accepted: two conditions is the
  case this amendment exists for, and a reset chip would either shift the row as
  it appeared or contradict the „no Alle chip" decision above.
