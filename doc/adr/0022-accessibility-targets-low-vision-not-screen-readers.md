# 22. Accessibility targets low vision and pre-literate readers, not screen readers

Date: 2026-08-15

## Status

Accepted

## Context

A universal-design audit produced a batch of issues (#117–#131). Two of them —
#118 (an accessible name for the page canvas, plus announcements on page turns)
and #127 (live regions for five status messages) — proposed work whose only
beneficiary is assistive technology. Before implementing them we asked who
actually gains, and how.

**The book content is not available to assistive technology, and never will be.**
`renderPageToCanvas` (`src/pdf.js`) draws the page with `page.render()`; there is
no `getTextContent()` anywhere in the codebase. Books may equally be photographed
pages (`src/image.js`, `src/camera.js`), where no text exists at all. The page is
an image. An `aria-label` can say *which* page we are on; nothing can say what is
printed on it.

**Neither reading partner benefits.** The reading adult reads the text off the
screen and speaks it into a phone call — that is the app's entire purpose, and it
requires sight, not markup. A perfectly announced "Seite 3 von 20" accompanies a
page they still cannot read aloud. The listening child looks at the pictures;
remove sight and nothing is left that the phone call does not already provide, and
a six-year-old rarely operates a screen reader unaided. The maintainer confirms
that nobody in the actual circle of users — this is a personal app with a known,
small user set — uses assistive technology.

**The real constraints in this user set are different ones**, and `aria-live` is
silent for all of them: ageing eyes (contrast, type size, zoom), unsteady or slow
touch, and a child who cannot yet read. The audit surfaced these too, in issues
that need no assistive technology to pay off.

Two further points shaped the decision:

- **Semantic HTML is not the same thing as ARIA.** A real `<button>`, `inert`, and
  `:focus-visible` earn their keep without any assistive technology, because the
  browser implements behaviour — keyboard activation, focus management, pointer
  suppression. `role`, `aria-label`, and `aria-live` implement no behaviour; they
  have exactly one consumer. Only the second group is in question here.
- **Unverified accessibility is worse than none.** #118's label would have to be
  kept in step with the page inside `updateIndicator`. If the indicator's format
  later changed, the label would drift silently — unnoticed, because nobody reads
  it, and uncaught, because [ADR 8](0008-no-tests-or-linter.md) means no test
  watches it. The code would then claim a support we have never exercised.

## Decision

We will not undertake new work whose only beneficiary is assistive technology.
Issues #118 and #127 are closed as out of scope.

- **Existing markup stays.** The `aria-label`s on icon-only buttons, the
  `aria-pressed` states, and the live regions already in `src/camera.js` and
  `src/dialog.js` are correct and already paid for. This decision is not a mandate
  to strip them, and removing them would be churn with a regression risk and no
  gain.
- **Semantic HTML remains the standard.** Real buttons, `inert`, and a visible
  focus ring are unaffected — they are ordinary quality, not accessibility spend.
- **Ordinary defects filed under the audit's screen-reader heading stay open on
  their own merits.** #119 (global reader shortcuts ignore focus, so Space and the
  arrow keys turn the page while typing in the sync-code field) and #122 (Escape in
  the sync panel closes the whole book) are plain bugs for anyone with a keyboard.
- **Accessibility effort goes where this app's users actually are**: low vision
  (#117 zoom, #124 chrome contrast, #125 px type sizes defeating the system font
  setting), motor (#120 slow or unsteady gestures, #121 pointing without a
  touchscreen, #130 small tap targets beside a destructive action), irreversible
  actions (#131), and feedback a pre-literate child can read — pictures, glows, and
  counts rather than sentences.

## Consequences

- The reader announces nothing on a page turn, and status messages carry no live
  regions. The changing page image is the feedback for a page turn; the green glow
  on a chosen mood icon is the feedback in the closing ritual. Both are already
  there, and both work for the six-year-old, which text does not.
- No shared announcer module, no announcement queue, and no per-render label
  bookkeeping in `src/reader.js`.
- Agents and contributors should not re-propose screen-reader work — including a
  future re-run of the same audit, which will surface these findings again. Cite
  this ADR instead.
- If the circle of users ever includes someone using assistive technology, or if
  the app ever leaves the family, this is the decision to revisit. Doing so would
  start with the book content itself, not with labels: a page that cannot be read
  aloud is the binding constraint, and no amount of ARIA addresses it.
