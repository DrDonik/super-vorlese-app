# 35. A discarded photo is held until the next handhold

Date: 2026-08-26

## Status

Accepted

## Context

Issue #131 asks for reversibility in the two places where this app destroys
something: deleting a book from the shelf, and discarding a photo while a book
is being photographed. Golden rule 6 wants both. Looking at the two side by
side, they turn out to be different problems.

Deleting a book is protected three times over — the pencil, the „Buch
bearbeiten" dialog, „Löschen", and a confirmation that names the title and puts
the focus on „Abbrechen" (`dialog.js`). Nobody arrives there by accident. What
that path is not protected against is a *mistake* rather than a slip: deleting a
book in the belief that it exists elsewhere too. A confirmation cannot catch
that, because the person confirms exactly what they meant to do — and neither
can an undo offer measured in seconds, because that regret arrives weeks later,
when somebody goes looking for the book. That half of the issue is therefore
still open, and it is a question about durability, not about undo.

Discarding a photo is the opposite case. There is no confirmation at all, and
there should not be: photographing thirty pages means discarding the blurred
ones as you go, and a modal per discard would make the common path unbearable.
The ✕ is 20px on a 64px preview, and [ADR 23](0023-44px-is-the-floor-and-words-yield-first.md)
casts a 44px target behind it that reaches down and left into the photo —
deliberately, because 44px is the floor, but it means roughly the top-right
half of every preview discards the page it is showing, with nothing on screen
saying so. ADR 23 accepted that cost in as many words: *„discarding is immediate
and has no undo — the page must be photographed again."* This is the slip the
issue describes, and it is the one worth paying for.

The pages exist only in memory until „Fertig" writes the book, and `removePage`
already keeps the emptied slot in `this.pages` rather than splicing it out, so
the page order survives a discard by itself. Making the discard reversible is a
matter of not letting go of the blob quite so early.

## Decision

**A discarded photo is held, and offered back, until the next handhold in the
same capture session.**

- **Exactly one.** The photo most recently discarded is the one on offer. A
  second discard is a deliberate second act and settles the first. Holding a
  history would mean carrying rejected photos through a session that already
  fills a tablet's memory with the kept ones — the same concern `storage.js`
  names when it hashes photo books page by page.
- **The offer stands until something answers it, and there is no timer.** It
  ends when the photo is taken back, when another photo is discarded, or when
  the next photo is captured or imported — taking the next page is itself the
  answer that the discarded one was right to go. A countdown was considered and
  rejected: any window short enough to feel tidy is too short for the person
  this app is for, and a control that vanishes while being reached for is the
  surprise rule 7 warns about.
- **The photo returns to its own place in the strip**, not to the end. These
  are the pages of a book; their order is the book. The index a thumbnail was
  given at capture time still names its slot, so the same element goes back
  between the same neighbours, with its ✕ and its listener intact.
- **The offer is a row of its own** between the strip and the controls, carrying
  „Foto verworfen." and a „Rückgängig" button at the full 44px. It cannot live
  inside the strip, because `.camera-strip:empty` hides itself and discarding
  the only photo is precisely when the offer must stay on screen.
- **The ✕ and its target are left exactly as ADR 23 set them.** The mismatch
  between the 20px glyph and the 44px field is the reason this decision exists;
  the answer is to make the accident cheap, not to break the floor ADR 23
  established. What that consequence of ADR 23 now costs is one tap, not a page
  photographed again.

## Consequences

- Discarding no longer frees the photo's memory at once. One JPEG of a tablet
  camera frame stays alive until the next capture, discard or the end of the
  session — bounded at one, and revoked in `commitDiscard()` rather than only
  in `destroy()` so a session that discards many shots never accumulates them.
- The object URL is deliberately *not* revoked in `removePage`. It is what the
  held thumbnail is still displaying, and revoking it would leave a restored
  photo showing a broken image.
- `insertThumb()` is now the single way a thumbnail enters the strip; appending
  a new photo is the case where nothing sorts after it. A future feature that
  reorders or renumbers pages has to keep `dataset.index` and the slots in
  `this.pages` agreeing, or a restored photo lands in the wrong place.
- „Fertig" and „Abbrechen" both read `livePages()`, which skips the emptied
  slots, so a photo still on offer is neither saved nor counted. Leaving the
  camera is what finally discards it — including the case where the title
  prompt is cancelled, which returns to the camera with the offer still up.
- The consequence in ADR 23 that reads *„discarding is immediate and has no
  undo"* is superseded by this decision. The comment on `.camera-thumb-del::after`
  in `style.css` says so at the place a reader will meet it.
- The book half of issue #131 is not addressed here and the issue stays open for
  it. Nothing in this decision presumes an answer there; if books ever get an
  undo, this is the wording and the shape to copy (rule 1).
