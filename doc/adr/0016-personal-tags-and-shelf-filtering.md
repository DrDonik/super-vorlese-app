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
