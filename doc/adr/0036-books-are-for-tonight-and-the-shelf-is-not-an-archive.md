# 36. Books are for tonight, and the shelf is not an archive

Date: 2026-08-28

## Status

Accepted

Closes the half of issue #131 that
[ADR 35](0035-a-photo-is-looked-at-before-it-is-discarded.md) left open.
Bounds [ADR 16](0016-personal-tags-and-shelf-filtering.md).

## Context

Issue #131 asked for reversibility in the two places this app destroys
something. ADR 35 did the camera half and deferred the other one, calling it
*„a question about durability, not about undo"* — how to make a photographed
book survive the tap that deletes it.

Working out who actually reaches that tap turned the question into a different
one. Every route to it is an intention, and the intentions do not have a common
answer:

1. **„Das Buch ist durch."** Tidying up. The belief underneath is „ich
   fotografiere es halt neu", which is true while the physical book is in the
   house and false for a library book that has gone back — and nothing on
   screen says which case this is.
2. **„Ich habe es doppelt."** Two shootings of one book. Which of the two
   tiles is the better one is not visible on the shelf, so the wrong one goes —
   and that is noticed in seconds.
3. **„Seite 7 ist unlesbar."** Not an intention to destroy at all: an intention
   to repair, taking the only route the app offers.
4. **The wrong red thing.** Reaching for „Synchronisation trennen" and hitting
   „Buch löschen". A slip, and the existing confirmation is built for slips.
5. **The child with the iPad, waiting for the call.** Wanted nothing. Nobody
   notices until evening.

Only 2 and 3 are caught by an undo measured in seconds, and both of them are
the app's own doing — duplicates it does not make distinguishable, and a book
it will not let you fix. The two where the loss actually hurts, 1 and 5, need
something else entirely: knowing whether this book is replaceable, and a copy
somewhere off this iPad.

Which is where the inventory stops being about undo. Inside the app there is
one deliberate deletion path. Outside it there are several that no in-app
control reaches: Safari clearing website data, storage eviction, the home-screen
icon going, a reset, a lost iPad. For a photo book that was never synced, all of
them destroy the only copy exactly as thoroughly as the red button, and more
often. The one redundancy that exists today is incidental — a book that was read
together is on the partner's device, and `findBookByContentHash` would take it
back — and it is a side effect of the sync, not a promise the app makes.

So „make books durable" is not a small feature. It is export, import, a place to
put the file, and the expectation that the shelf keeps what is put on it. That
is a different product.

## Decision

**This app neither archives books nor manages them. A book on this shelf is for
tonight.**

The capture path exists so that a grandparent can photograph the book in their
hands twenty minutes before the call. It is quick capture by a layperson, not
scanning. Whoever wants to digitise, correct and keep a book is well served
elsewhere — Adobe Scan for the pages, Calibre or Zotero for the shelf — and this
app does not compete with any of them.

What follows, and what this ADR is meant to answer without a fresh discussion
each time:

- **No export and no backup path.** `exportBook()` in `bundle.js` stays what it
  is: infrastructure for the WebRTC transfer, reachable only from `offer.js`.
  Giving it a button would be building the archive badly rather than not
  building it.
- **No page editing.** No replacing a single page, no reordering, no appending
  to a saved book. The reason is not cost: it is that sorting and replacing
  pages presumes a mental model — *„my document has a structure I maintain"* —
  that the people this camera is for do not bring. Their answer to a crooked
  page is to shoot the series again, which takes two minutes, and in an app
  where books are short-lived that is not a workaround for a missing feature.
- **Sorting and tags stay a way to find tonight's book**, not a system to keep.
  ADR 16 already called organising the shelf a power-user job and made the
  feature invisible to everyone who never uses it; this is the ceiling on how
  far it grows. No folders, no collections, no metadata beyond title and tags.
- **Deleting stays a one-way door with a single confirmation.** No undo, no
  trash, no grace period. It is not the accident an undo is built for; it is the
  ordinary end of a book's life here, and the pages come back with the camera.

**With one exception, and it is the whole remaining change to the app:** the
confirmation names the shared evenings when there are any.

`deleteBook` removes the book's completion records along with its pages. Those
are the mood ritual's keepsake (ADR 11/12/26), the strip of faces on the cover,
the dated list behind it. The pages are replaceable and the app now says so by
saying nothing about them. The evenings are not: a re-photographed book is a new
id with an empty history, and no repeat of the original action brings the old
one back. So the message grows a second sentence exactly when there is something
to grow it for:

> „Grüffelo" wirklich löschen? 4 gemeinsame Abende gehen damit verloren.

A book nobody has finished together keeps today's plain question. That is
deliberate: a warning on every deletion is a warning nobody reads, and routine
has to stay routine for the weight to mean anything when it appears (rule 3 —
the response is proportional to the significance of the action).

## Consequences

- `confirmAndDelete` reads the book's completions before it asks. One extra
  IndexedDB lookup on a path used a few times a year, read fresh rather than
  taken from the shelf's render snapshot, because the number is the argument. A
  failed read falls back to the plain question: the sentence is the reason to
  think again, not a precondition of asking, and a store that cannot be read
  must not turn the tap into nothing happening.
- The wording borrows the camera's („Die Fotos gehen verloren.") rather than
  inventing a second phrase for the same kind of loss in the same kind of
  dialog (rule 1). „Gemeinsame Abende" is a new term, and it names what
  happened rather than what is stored — the app's own register, from bedtime
  reading.
- Only *finished* shared reads are counted, because only those leave a record.
  An evening that stopped halfway was never in the history and is not claimed
  to be.
- The dialog does not offer to look at the history before deleting. The strip
  is on the card the user just came from, one tap away, and a confirmation with
  a third way out is no longer a confirmation.
- **The cost of this decision, stated plainly:** a household that treats the
  shelf as an archive will eventually lose a photo book, and the app will not
  have warned them beyond this one line. That is accepted. The alternative is
  the export path, and the export path is the other product.
- Issue #131 closes here. Its acceptance criterion was that the chosen path be
  recorded as an ADR, and for the book half the chosen path is largely not to
  build one.
- The consequence in ADR 35 that reads *„the issue stays open for it"* is
  answered; ADR 35 carries a note at that point.
