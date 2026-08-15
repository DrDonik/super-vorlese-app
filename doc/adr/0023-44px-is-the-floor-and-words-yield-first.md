# 23. 44px is the floor for every target, and words yield before targets do

Date: 2026-08-15

## Status

Accepted

## Context

`src/style.css` has stated the measure since the sort pills were written: *„44px
is what a six-year-old's or a grandparent's finger needs to hit reliably."* Only
the pills and chips actually held it. The universal-design audit (issue #130)
found the rest of the app between 20px and 43px.
[ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md) puts this
squarely in scope: small tap targets are named there as motor work that pays off
for the people who actually use this app, unlike the screen-reader items the
same audit produced.

Measuring the app in a browser at phone widths turned up two things the audit had
not seen.

**The declared size was not the delivered size.** The reader's chrome bar is a
flex row, and with the default `flex-shrink` its items were squeezed whenever the
row ran out of width. On a 375px screen the „?" button rendered at 23px — under
even the WCAG 2.5.8 floor of 24px — while its rule said 40. „← Bibliothek"
wrapped across two lines and took the whole bar to 88px. The bar was already
failing on phones before anything was made bigger.

**The bar cannot hold six full-size targets and its words.** Measured against the
widest fallback font, „← Bibliothek" plus „Seite 12 / 148" plus four 44px buttons
want 436px. No phone has that. Raising the targets and keeping the labels is not
arithmetically possible, so one of the two had to give.

The audit also assumed the shortfall was a handful of named elements. It was the
whole app: nine more controls measured under 44px, most of them at 43 — a
vertical padding of 12px on a 19px line, which is what a designer writes when
aiming at 44 without checking.

## Decision

**Every interactive element has a target of at least 44 × 44px, and where a row
cannot hold both, the words go and the targets stay.**

- **The floor is expressed as `min-height: 44px` with the content centred**, not
  as padding that happens to add up. Padding drifts with font size and
  line-height — that is how nine controls arrived at 43px — while a floor stays
  true. This is what `.sort-pill`, `.filter-chip` and `.tag-chip` already did;
  it is now the house pattern.
- **A declared size is a promise: nothing in the reader's chrome may shrink
  below it.** The bar's items are `flex: none`. Its title is the sole exception,
  because a title is a label, not a target.
- **Where the visible control must stay small, the target is cast by a
  pseudo-element.** The camera's discard ✕ sits on a 64px preview and a 44px
  disc would bury the photo it exists to let you check, so the ✕ keeps its 20px
  and a 44px field reaches down into the thumbnail behind it.
- **Below 600px the reader's chrome drops its words**: „← Bibliothek" becomes
  „←", „Seite 12 / 148" becomes „12 / 148". Tablets and desktops keep the full
  labels.

What justifies dropping the words is what is on the screen, not what a screen
reader would be told. Per [ADR 18](0018-library-is-an-adult-surface.md) the
reader is the surface measured against the child who cannot yet read, so icons
are already its register — the sync, navigation and help controls carry no words
at all. Every one of these controls is named in the „?" overlay, which is where
an adult who wants words finds them. The title was truncated to nothing at that
width anyway. And the numbers, which are the actual state (#157 raised them to
full `--fg` for exactly that reason), stay: it is the label „Seite" that goes,
not the answer it labels. The library keeps its text, because there the measure
is the grandmother reading a label.

The one piece of markup this adds is `aria-label="Zurück zur Bibliothek"` on the
back button, which becomes icon-only. That is the standing convention for every
icon-only button in this bar rather than new assistive-technology work, and it is
static — it cannot drift out of step the way a per-page label would.

## Consequences

- The reader's chrome bar is 4px taller (76 instead of 72), on top of the 56px
  of bottom padding #157 gave it for its gradient. On a phone it now needs
  ~312px instead of ~436px — one line from 320px up, with room left for a phone
  whose owner has turned the system font size up.
- A phone's chrome bar is icons and numbers only. The „?" overlay is the thing
  that explains it, which makes that overlay load-bearing rather than a nicety:
  a control added to this bar has to be added to the overlay's list too.
- Two labels now live in spans (`.reader-back-label`, `.page-indicator-word`) so
  the stylesheet can drop them. Both are written from one place in `reader.js`,
  because the page indicator is also rewritten when a page jump closes and the
  two paths must not disagree.
- The page indicator carries **no** `aria-label` naming the current page. A
  label maintained inside `writeIndicator` is the drift
  [ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md)
  explicitly declines, and it names that very method.
- Making a control `inline-flex` to centre its content turns its parts into flex
  items, and flex trims whitespace at an item's edge. Spacing between an icon
  and its word is therefore a `gap`, not a typed space.
- The camera's discard target covers the thumbnail's top-right corner and
  reaches into the photo. The rest of the preview stays deliberately inert:
  discarding is immediate and has no undo — the page must be photographed again
  — so the half furthest from the ✕, where a finger steadying the strip lands,
  triggers nothing.
- New controls inherit the floor by copying the pattern; there is no linter to
  catch a regression ([ADR 8](0008-no-tests-or-linter.md)). The check is a
  browser at 320px, and the number to compare against is 44.
