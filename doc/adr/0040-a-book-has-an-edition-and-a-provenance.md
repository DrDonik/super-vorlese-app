# 40. A book has an edition and a provenance

Date: 2026-11-21

## Status

Accepted

## Context

The books on this shelf are re-typeset before they get there
([ADR 28](0028-books-are-retypeset-before-they-reach-the-shelf.md)), and
correcting one means editing its `buch.json` and building again. In November
2026 all 57 books were read through and about 30 of them corrected — a wrong
chapter split, an illustration in the wrong place, a typo.

Every one of those 30 PDFs has different bytes, and bytes are what the library
knows a book by. Dropping them on the window therefore produced 30 duplicates:
two cards that look identical, no way to tell which is the corrected one, and
the only cure — deleting the old card — takes the shared-reading keepsake
([ADR 11](0011-shared-reading-memory.md)) with it, along with the tags, the
title and the Lese-Code. The evenings a pair of grandparents and a
six-year-old spent in that book are the one thing in this app that cannot be
made again.

So the shelf needs to recognise a corrected book as the same book. The question
is what „the same book" is identified by, and the first answer offered was to
let a book hold a list of the hashes it has ever had.

**That answer is wrong, and the reason is worth writing down.** `contentHash`
is not a duplicate check. It is what three load-bearing decisions ask:

- `openRoom()` in `src/main.js` — „do I already have this book, or must I fetch
  it from my partner?"
- the same function, after the transfer — „did the file arrive intact?"
- `syncJoin()` in `src/reader.js` — „does this Lese-Code belong to the book I
  have open, or would syncing pair two different books?"

A hash list would make all three answer „yes" for two different editions. Two
devices, one holding the corrected book and one the old one, would then
synchronise page turns against different page breaks: the grandparent reads page
seven and the child looks at something else, silently, at bedtime. The
integrity check would lose its meaning in the same stroke.

A second answer was to recognise the book by its cover picture, which a
correction never touches. That one fails for a duller reason: the cover this app
holds is a JPEG an `OffscreenCanvas` encoder produced (`readCoverImage()` in
`src/pdf.js`), and the bytes of that encoding are not promised to be stable
across the browser versions the shelf's thumbnails were made with. It would have
needed a perceptual hash and a threshold measured against the whole shelf.

Neither was necessary, because the identity is already written in every one of
these files. `retypeset-book.py` emits `#set document(title: …)`, so each book
carries its own title in its PDF metadata, and names its output file after it.
The title comes from the 24pt line of the publisher's title page with the
„(Teil N)" suffix stripped, and a correction in the text does not touch it.
Measured over all 57 books: every one carries a title, and no two carry the same.

## Decision

**A book is identified two ways at once, and the two are never confused:
`contentHash` identifies the edition, `workTitle` identifies the work.**

- **`workTitle` is `info.Title` from the PDF's own metadata**, read by
  `readWorkTitle()` in `src/pdf.js`, trimmed and capped at 300 characters. Not
  the file's name and not the title shown on the card, so renaming a book in
  „Buch bearbeiten" cannot affect it: the comparison is always a stored work
  title against a freshly read one. A PDF carrying no title stores `null`, which
  is the answer „looked, there is none" — only a missing field means „never
  looked", which is what lets the shelf's older books be read on the way past.

- **Only the shelf and the receive path ask for it.** Every question the sync
  layer asks still asks `contentHash`, unchanged. Two editions can therefore
  never be taken for one another, which is the whole point of keeping the two
  apart.

- **The library's own PDF import replaces an edition in place** when the bytes
  are unknown but exactly one book on the shelf carries the same work title. The
  book keeps its id, so the keepsake, the title, the reader's own tags and the
  cover stay with it; `pageCount`, `contentHash` and the file change, and
  `lastPage` is carried over but clamped, because a correction can shorten a
  book. The cover and the age tag are refreshed by the one reader every import
  path already uses ([ADR 29](0029-the-cover-and-the-age-come-off-the-title-page.md)).

- **Exactly one candidate, or nothing happens.** Two books with the same work
  title mean the choice would be a guess, and a book replaced by mistake takes
  the right one's keepsake down with it (rule 5). Such a file lands as a book of
  its own, which is what it did before any of this existed. The chosen candidate
  also leaves the index, so two files of one work in a single drop cannot both
  aim at the same book.

- **Replacing an edition gives up the book's Lese-Code** (`closeSyncForBook`).
  A room's `book` descriptor is written once when the room is created and then
  stands for 45 days ([ADR 27](0027-a-room-holds-a-lease-not-a-log.md)); it
  names the old edition's hash, while the offer behind that code would now hand
  out the new file. A partner joining would be told the book is damaged, and a
  partner who still holds the old edition would be synced to it. So the code
  goes with the edition it described, and the next shared reading of that book
  starts with a fresh one — read out over the video call like every other new
  book ([ADR 33](0033-showing-a-code-puts-the-book-on-offer.md)).

- **A received book is folded into the edition it supersedes**, in
  `adoptEdition()` in `src/main.js`, so the side that only ever receives books
  keeps its own keepsake too instead of ending up with the same story twice. It
  runs **after** the integrity check, never before: a book that fails that check
  is deleted again, and adopting first would hand that deletion a book with
  months of evenings in it. Nothing visible on the receiver's shelf changes —
  not the cover, not the tags, not the title — only the file behind the card.

- **The import run ends with one line, not one line per file.** „Fertig: 30
  ersetzt, 0 neu, 27 unverändert." Fifty-seven files are one act with one
  answer (rule 4), and the books that came in as new are named, because on a
  shelf of corrected books an unexpectedly new title is the one thing worth
  looking at. A single file that merely lands as a new book gets no line at all:
  the new card is the answer. A single file that *replaced* something does get
  one, because its card looks exactly as it did before.

### Alternatives considered

**A list of hashes per book**, as described above. It is the shortest change and
it breaks the one guarantee that keeps two devices on the same page.

**A perceptual hash of the cover picture.** Robust against the encoder, but it
needs a distance threshold measured over the whole shelf to be trusted, and it
cannot be trusted silently without that measurement. The PDF's own title needs
no threshold.

**The text of the title page**, which `readAgeTag()` already reads at import and
which would have cost nothing. It breaks on exactly the thing being done: a
typo corrected in the blurb would make the book a different book.

**A new identifier stamped into the PDF by `retypeset-book.py`.** Exact, and
the obvious choice if the title were not already there — but it would be a
third contract across the repository boundary
([ADR 28](0028-books-are-retypeset-before-they-reach-the-shelf.md), ADR 29), and
it would identify nothing on the books already on the shelf, which is the only
set of books that actually needed identifying.

**Asking before each replacement.** The honest answer while the detection was a
guess. With an exact title match and a hard „exactly one candidate" rule, 30
confirmations would be 30 taps for a question whose answer is always yes, and
the closing line reports what happened either way (rule 3 scales the feedback
to the action, it does not demand a dialog).

**A „PDF ersetzen" action in „Buch bearbeiten"** as the manual way in. Not
needed for this: a title that fails to match lands as a new book and says so,
and the file can be corrected and dropped again. It stays available as the
answer if that ever turns out to be too little.

**Carrying the new edition to the partner by itself**, by refreshing the room's
descriptor and letting the other device pull it when the book is next opened.
That is the silent version of the last decision above, and it needs an ordering
field in the room, a rules change, and a file swap under an open reader. It was
weighed and left out: one code read out per corrected book, once, is a price
this household already knows how to pay.

## Consequences

- A correction round is: drop every book on the window, read one line, done. The
  cards do not move and do not change; what changed is behind them.
- The first such run reads every book on the shelf once to learn its work title,
  one PDF opened per book, reported as „Regal wird gelesen: 12/57". Every run
  after that skips it, because the title is then in the book's metadata.
- Each corrected book costs one Lese-Code, once: the old one is given up and a
  new one is read out at the next shared reading. The abandoned rooms expire on
  their own ([ADR 27](0027-a-room-holds-a-lease-not-a-log.md)).
- A book whose own title was corrected is a new book to the shelf, and so is one
  from a source that writes no title into its PDFs. Both are named in the closing
  line; nothing is guessed in either case.
- Two books that already stood on the shelf under the same work title stay as
  they are, and a corrected file for them lands beside them. The shelf says so.
- `src/storage.js` gained a stored field and three functions, and takes the PDF
  reader as an argument rather than importing `src/pdf.js` — the same shape
  `addBookTag()` uses for „are these two tags the same", and for a sharper
  reason here: importing that module starts the PDF.js worker, and the camera
  has no business starting one.
- Found on the way, and fixed with it: `pdf.destroy?.()`, the call every import
  path made to release a document, has never released anything. PDF.js keeps
  `destroy()` on the loading task, not on the document proxy, so the optional
  call quietly did nothing and the worker held every book opened in a run. That
  was survivable at one book and not at a hundred and fourteen, which is what
  this change would have asked of a correction round. `closePdf()` in
  `src/pdf.js` is now the one way to let a document go.

## Amendment (2026-11-21): the write, the snapshot, and the file that will not open

Three details from the review of the change that implemented this, each of them
a way the rules above could be true on paper and wrong in the data.

- **The file and the metadata are written in one transaction.** Two writes left
  a window in which a book held the corrected bytes under the old page count
  and the old hash, and if the second write failed it stayed that way: a book
  nobody holds the metadata for any more. `replaceBookFile()` now reads the
  record, and writes the file and the record together or not at all.

- **Import runs are serialised, and the condition is checked in the write's own
  transaction.** The work-title index is a snapshot taken when a run starts, and
  a file is written minutes later. Nothing stopped a second drop meanwhile — the
  drop target is the whole window, and the file dialog stays open for business —
  so two runs could each replace a book from their own view of the shelf. They
  are queued now, one after another; drops are kept rather than refused.

  The index is therefore only a first answer. „Exactly one book carries this
  work title, and it is this one" is a condition the caller states and
  `replaceBookFile()` checks *inside* the transaction it writes in, because
  between any check outside and the write there is a gap — another tab, another
  run — and a book replaced by mistake takes the right one's keepsake with it.
  When it does not hold, nothing is written and the file lands as a book of its
  own, which the closing line says.

  The same transaction is also why the record is modified from the version it
  reads there rather than from a copy: a tag tapped in „Buch bearbeiten" while a
  long import runs must not be written back over. Every other writer in
  `src/storage.js` goes through `updateMeta()` for exactly that reason, and this
  one cannot, because it writes two keys at once.

- **A file that cannot be read is not a book without a title.** Both answers
  used to come back as null, and the null was written into the record — so one
  unreadable book would have been remembered as titleless for good, stayed
  invisible to the index, and collected a duplicate at every correction round
  with nothing on screen to explain it. The two are now distinct: null is
  "read it, no title", undefined is "could not read it", and only the first is
  stored. The second is counted and named in the closing line („Im Regal nicht
  lesbar: 1"), because a book missing from the index is exactly the case this
  cannot otherwise show.

  What this deliberately does **not** do is refuse every replacement while one
  book on the shelf is unreadable. For the wrong book to be replaced, that
  unreadable book would have to share its work title with another book *and* a
  corrected file of that title would have to be imported. Against that stands
  the certain cost: a single broken file would turn a correction round into
  thirty duplicates. The incompleteness is reported instead of being traded for
  that.
