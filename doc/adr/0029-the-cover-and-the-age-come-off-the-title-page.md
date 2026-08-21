# 29. The cover and the age come off the title page

Date: 2026-08-21

## Status

Accepted

## Context

Until now the library made a book's cover by rendering the whole of page 1 into
a 480px thumbnail. For the books this app actually holds that is the wrong
picture. A book from [einfachvorlesen.de](https://www.einfachvorlesen.de) opens
on a title page that carries the publisher's own cover art as a small embedded
image, with the title, a blurb, the publisher block and the age recommendation
set around it in text. Shrunk into a 3:4 tile the whole page becomes a grey
block of unreadable type with a postage stamp in the middle — and the one thing
that would let a six-year-old find the book on the shelf, the cover, is a
seventh of it.

Two things on that page are worth having, and both are printed there rather
than inferred:

- **the cover picture**, embedded as a PNG;
- **the age recommendation** — „Ab 3 Jahren", „Ab 5 Jahren", „Ab 7 Jahren" —
  which is exactly the question asked when picking tonight's book for a
  particular grandchild.

Measured across all 50 PDFs currently held (25 downloaded, 25 re-set by
`scripts/retypeset-book.py`, [ADR 28](0028-books-are-retypeset-before-they-reach-the-shelf.md)),
the title page is as uniform as the rest of the source:

- **every** book paints exactly one raster image on page 1, upright to roughly
  square (width/height 0.64–0.99), always exactly 300px tall and 193–298px
  wide, occupying 5–9% of the page area;
- **every** book prints exactly one age recommendation on page 1, and only
  three values occur;
- both survive re-typesetting unchanged — the re-set books place the same image
  smaller (≈5% of the page) but are otherwise identical in structure. One
  reader therefore serves the download and the re-set book alike.

300px is a ceiling, not a choice: einfachvorlesen ships no larger cover, and
`bilder/bild-00.png` in a re-typeset book's working directory holds the very
same pixels. But in today's full-page thumbnail the cover art is only about
140px tall, so reading it out of the page roughly doubles the detail on the
part anyone looks at.

## Decision

**A book's cover picture and its age recommendation are read off page 1 when
the book enters the library — and the same way, whichever way it enters.**

- **`readTitlePage(pdf)` in `src/pdf.js` is the one reader**, returning
  `{ cover, ageTag }`. The two are found independently and either can come back
  null; nothing in it throws, so a book whose title page is not the one we
  expect simply keeps the cover and the tags it would have had before.

- **The cover is found through the page's operator list**, which carries each
  image's pixel size in its arguments — so no rendering is needed to decide.
  A picture qualifies only if page 1 paints exactly one image, its placed shape
  is upright to roughly square (0.5–1.1), it covers at least 15% of the page
  height and 4% of its area, and its short side is at least 120px. Two pictures
  on the page disqualify it outright: choosing between them would be a guess,
  and a wrong cover is the kind of surprise this must not produce.

- **The page is then rendered at exactly the scale that brings the picture out
  at its stored resolution**, and the picture is cut out of it. Rendering it
  larger would interpolate pixels the source never had.

- **The age becomes an ordinary tag** — „Ab 5 Jahren", the source's own
  wording. It is set only when page 1 yields exactly one reading between 1 and
  12. Being an ordinary tag, it sorts itself into the filter row (the collator
  is numeric, so „Ab 3" precedes „Ab 10"), and one tap in „Buch bearbeiten"
  removes it for good. It stays local like every other tag
  ([ADR 16](0016-personal-tags-and-shelf-filtering.md)).

- **However a book reaches the shelf, it arrives with the same cover and the
  same read-off tag.** A book is created in exactly two places — the library's
  PDF import and `importBundle()`, which serves both a dropped `.vorlese` file
  and a book received over a sync session — and both call the one reader. The
  rule is a property of the code's shape, not a convention to be remembered.

- **A book already on the shelf is refreshed only by the library's own PDF
  import.** Re-adding the file there is a deliberate act, so a cover that
  changes is the point of it; that is also the migration path for books
  imported before this existed. A book arriving as a bundle or over a sync
  session never refreshes an existing one: on the shelf of someone who only
  ever receives books, nothing may rearrange itself under their hands. When it
  does refresh, tags are joined and never replaced, and the book keeps its id —
  so the saved room code and the shared-reading keepsake
  ([ADR 11](0011-shared-reading-memory.md)), both keyed by that id, stay with
  it, as do the title, the reader's own tags and the reading position.

**This does not overturn the rule that nothing is auto-tagged.** That rule is
about not writing tags from *how a book is used* — closing one usually means
"that's enough for tonight", not "read" — and it stands. An age recommendation
is the other kind of thing entirely: it is printed on the title page and read
off it, never inferred.

### Alternatives considered

**Extracting the embedded image object instead of cropping a render.** It is
the same pixels by a harder road: colour spaces, soft masks and the timing of
`page.objs` all have to be handled, where cropping a render hands the browser's
own decoder the job.

**Letting the re-typesetter mark the cover**, which already knows it exactly as
`meta.cover` in `buch.json`. That would leave downloaded books without one and
put the knowledge in two places. The built PDF satisfies the same test anyway.

**Offering a switch back to the full-page render** in „Buch bearbeiten". A
control that would be touched perhaps never, in a dialog kept deliberately
short. If the detection is ever found wanting, it can be added then.

**Requiring the age line before accepting a cover.** Measured against 1049
non-title pages, the age pattern never once matched, while the cover's shape
test would have accepted 91 of them — an illustrated page and a cover look
alike, because on a title page an illustration *is* the cover. Coupling the two
would make a foreign PDF's cover strictly safer. It was left uncoupled so that
each fact stands or falls on its own evidence, which is the easier thing to
reason about later; the worst case it admits is a cover showing page 1's
picture instead of page 1.

## Consequences

- The shelf shows book covers. The mood ritual, which ends on the book's
  thumbnail ([ADR 12](0012-mood-ritual-honours-divergence.md)), shows it too
  without knowing anything about this.
- Covers are about 214 × 300px — near 1:1 in CSS pixels on a library card, so
  slightly soft on a retina display, and still roughly twice the detail the
  full-page render gave the same artwork.
- Three filter chips appear on a shelf of these books without anyone tagging
  anything. On a shelf holding one book, none do — chips are derived from the
  books present.
- A PDF from elsewhere keeps the old behaviour whenever its title page fails
  either test, and there is no migration: books already on the shelf gain their
  cover when their file is imported again, and otherwise stay as they are.
- The app now assumes something about einfachvorlesen's title page. Until now
  only `scripts/retypeset-book.py` did. The thresholds above are the whole of
  that assumption, and a book that falls outside them loses nothing.
