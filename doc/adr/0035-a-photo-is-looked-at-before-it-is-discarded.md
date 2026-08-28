# 35. A photo is looked at before it is discarded, and the discard is reversible

Date: 2026-08-26

## Status

Accepted

## Context

Issue #131 asks for reversibility in the two places where this app destroys
something: deleting a book from the shelf, and discarding a photo while a book
is being photographed. Golden rule 6 wants both. Side by side, they turn out to
be different problems.

Deleting a book is protected three times over — the pencil, the „Buch
bearbeiten" dialog, „Löschen", and a confirmation that names the title and puts
the focus on „Abbrechen". Nobody arrives there by accident. What that path is not
protected against is a *mistake* rather than a slip: deleting a book in the
belief that it exists elsewhere too. A confirmation cannot catch that, because
the person confirms exactly what they meant to do — and neither can an undo
offer measured in seconds, because that regret arrives weeks later, when somebody
goes looking for the book. That half of the issue is still open, and it is a
question about durability, not about undo. *(Answered by
[ADR 36](0036-books-are-for-tonight-and-the-shelf-is-not-an-archive.md): the
app does not make books durable, and the confirmation names the one thing on
that path that no re-photographing brings back.)*

The camera was the opposite case, and worse than the issue described. The strip
under the viewfinder showed each photo at 64px with a 20px ✕ on it, behind which
[ADR 23](0023-44px-is-the-floor-and-words-yield-first.md) cast a 44px field so
the target would meet the floor. That field covered roughly the top-right half of
the preview, and nothing on screen said so. ADR 23 accepted the cost in as many
words: *„discarding is immediate and has no undo — the page must be photographed
again."*

Looking at it again with the maintainer turned up something ADR 23 had not
asked: **why does anyone touch a thumbnail during a capture session?** To check
the shot — is the page sharp, straight, whole? That is the only reason. A 64px
tile cannot answer it, and the app offered no way to look. So the largest, most
easily hit target on the strip did the destructive thing, and the thing people
actually wanted was not possible at all. The priorities were inverted, and the
oversized invisible target was the symptom.

That also explains why simply shrinking the ✕ is no answer. On a 64px tile any ✕
is either under the 44px floor or buries the photo it exists to let you check.
The dilemma is real — and it dissolves as soon as the tile has one job instead of
two.

## Decision

**The filmstrip's tile means „show me this photo". Discarding happens in the
preview, where the photo can be seen. And a discarded photo is held and offered
back until the next handhold.**

- **The ✕ is gone and the whole 64px tile is the button.** Visible surface and
  tappable surface are now identical by construction, not by careful
  measurement, and the target clears the 44px floor with room to spare. Nothing
  on the strip can destroy anything: the worst a stray tap does is open a
  picture.
- **The preview is an ordinary dialog** — the photo as `content`, fitted rather
  than cropped, with `dangerButton` carrying „Verwerfen". `dialog.js` already
  puts a destructive action in a row of its own, a fingerwidth from the way out,
  which is exactly the separation this needs. No new overlay, focus trap or
  escape handling.
- **The preview names the page from the strip as it stands**, not from the
  capture index: discard page 2 and the third shot taken *is* page 2. The tile's
  own label stays „Foto ansehen" for the same reason ADR 22 declines a
  per-page `aria-label` — a number maintained in two places drifts.
- **Discarding costs a second tap, and that is not a loss.** The first tap was
  always needed: nobody can tell from 64px that a page came out blurred. The
  „extra" step is the step that was missing.
- **The last discarded photo is held and offered back** in a row between the
  strip and the controls („Foto verworfen." · „Rückgängig"). Exactly one — a
  second discard is a deliberate second act, and holding more would carry
  rejected photos through a session that already fills a tablet's memory with
  the kept ones. No timer: the offer ends when it is taken, when another photo
  is discarded, or when the next photo is captured, because taking the next page
  is itself the answer. Any window short enough to feel tidy is too short for
  the people this app is for, and a control that vanishes while it is being
  reached for is the surprise rule 7 warns about.
- **A restored photo goes back to its own place in the strip**, not to the end.
  These are the pages of a book; their order is the book.
- **Where a control needs an invisible target twice its own size, the layout is
  wrong — not the target too small.** ADR 23's tool (casting a target with a
  pseudo-element) stands; the camera ✕ was its only worked example, and that
  example is retired. The oversized field was the app telling us that a
  destructive action had been put on a 64px tile that wanted to do something
  else.

The undo survives the change that removed its original reason. It was built as
the net under an over-large invisible target, and that target is gone; what it
catches now is the deliberate discard that turns out to be wrong — two shots of
one page and the better one goes. Unlike the book, that regret arrives in
seconds, because the strip is the next thing looked at. It is kept on those
merits, not because it was already written.

## Consequences

- Discarding no longer frees the photo's memory at once. One JPEG stays alive
  until the next capture, discard, or the end of the session — bounded at one,
  and revoked in `commitDiscard()` rather than only in `destroy()`.
- The object URL is deliberately *not* revoked in `removePage`. It is what the
  held thumbnail is still displaying, and revoking it would leave a restored
  photo showing a broken image.
- `insertThumb()` is the single way a thumbnail enters the strip; appending a
  new photo is the case where nothing sorts after it. A feature that reorders or
  renumbers pages has to keep `dataset.index`, the slots in `this.pages` and
  `pageNumberOf()` agreeing, or a restored photo lands in the wrong place and
  the preview names the wrong page.
- The tile is a `<button>`, so the strip is keyboard-reachable and each tile
  takes Enter. After a discard the dialog has no opener left to restore focus
  to, so `openPage()` hands it to the shutter — the way on — with „Rückgängig"
  one Shift+Tab back.
- `.camera-preview-card` and `.camera-preview-image` sit with `.mood-history-card`
  rather than among the camera rules: they widen `.dialog-card`, and at equal
  specificity only a later rule can.
- „Fertig" and „Abbrechen" both read `livePages()`, which skips emptied slots, so
  a photo still on offer is neither saved nor counted. Leaving the camera is what
  finally discards it — including when the title prompt is cancelled, which
  returns to the camera with the offer still up.
- The consequence in ADR 23 that reads *„discarding is immediate and has no
  undo"* no longer describes the app, and the control it describes no longer
  exists. ADR 23 carries a note at that point.
- The preview does not page through the strip (no swipe, no arrows). That is a
  second feature with its own state, and the strip it would duplicate is
  directly underneath.
- The book half of issue #131 is not addressed here and the issue stays open for
  it. If books ever get an undo, this is the wording and the shape to copy
  (rule 1).
  *(Superseded by
  [ADR 36](0036-books-are-for-tonight-and-the-shelf-is-not-an-archive.md):
  books get no undo, and #131 closes with that. The camera's offer stands — the
  two halves turned out to be different problems, which is what this ADR said
  from the start.)*
