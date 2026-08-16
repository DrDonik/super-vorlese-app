# 24. Page zoom is local, in fixed steps, and lies on the book

Date: 2026-08-16

## Status

Accepted

## Context

[ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md) put this
app's accessibility effort where its users actually are, and low vision heads
that list. Issue #117 is the largest item on it: the app's whole purpose is
looking at a page, and until now the page was rendered to fit the stage exactly,
with no way to make it bigger. The reader who most needs it is the grandparent
reading aloud.

Issue #117 also claimed that pinch-to-zoom is disabled in the installed iOS web
app. **That is not true**, and the correction matters for the decision:
`index.html` carries a plain `width=device-width, initial-scale=1.0` viewport
with neither `user-scalable=no` nor `maximum-scale`, so nothing suppresses the
browser's own zoom. `overflow: hidden` and the `position: fixed` reader prevent
layout scrolling, not the pinch — iOS zooms the *visual* viewport, which is
unaffected by both.

So the question was not "how do we make zoom possible at all" but "what does the
native pinch fail to give someone who cannot read the print", and there the
answer is substantial:

- **It cannot sharpen the page.** The visual viewport re-rasterises text and
  vectors, but a `<canvas>` is a fixed grid of pixels; magnifying it only
  stretches the pixels the page was rendered with. Bigger, blurrier print is
  half a remedy at best.
- **It shows no state and offers no one-tap way back.** The only exit is the
  opposite gesture (rules 3 and 6 of the Eight Golden Rules).
- **It carries the controls away.** The pinch magnifies the entire interface, so
  panning moves „← Bibliothek", the turn zones and the page indicator off the
  screen (rule 7).
- **It is touch-only.** There is no equivalent on a desktop.

## Decision

The reader gets a loupe of its own, and the native pinch is left alone.

- **Three steps, one button.** 1× → 1,5× → 2× → 1×, on a floating button in the
  bottom-right corner of the stage. Every step is one tap away from every other,
  including the way back. The button shows the factor in force, so the state
  lives in the control rather than in the reader's memory (rule 8).
- **One of the magnified steps fills the width exactly.** On a landscape screen a
  portrait page is letterboxed at the sides, and the most useful magnification
  there is the largest one that still only ever moves in one direction: the page
  as wide as the stage, nothing left over beside it, scrolling up and down and
  swiping to turn (the swipe survives because a page with no sideways play keeps
  it — see above). That factor depends on the page and the screen — 2,1× on an
  iPad held sideways, 2,5× on a 16:9 laptop — so it is computed rather than
  fixed, and it replaces whichever of 1,5× / 2× it comes nearest. The ladder
  stays three rungs long and rising, one rung is always exactly full width, and
  a page that already fills the width (a phone held upright) keeps the plain
  1,5× / 2×. It is deliberately *width*, not „the letterboxed side": filling the
  height on an upright phone would force the reader to scroll across the lines
  of text, which is the one direction reading cannot spare.
- **Not in the chrome row.** After [ADR 23](0023-44px-is-the-floor-and-words-yield-first.md)
  that row measures ~312px on a phone with nothing left to give; a seventh 44px
  target would run it off a 320px screen. The corner also puts the control under
  the thumb and beside what it acts on. It comes and goes with the chrome, but
  stays put while magnified — a way back that hides itself is not one.
- **The page is re-rendered, not scaled up.** `renderCurrent` asks the source for
  the stage multiplied by the factor, so PDF print gets genuinely sharper.
  Photographed pages have no more detail to give but still grow by the promised
  factor. `deviceScaleFor` caps the device-pixel ratio so the product of zoom and
  ratio cannot exceed what iOS will allocate (~16.7 megapixels, 4096 per side),
  which would otherwise hand back a blank canvas.
- **Dragging moves the magnified page.** This is the one gesture the loupe
  changes, and only where there is something to move: a drag pans when the page
  has room to travel that way, and otherwise stays the page-turning swipe it has
  always been. That exception is not a nicety — a portrait page on a landscape
  iPad is still letterboxed at 1,5×, so without it the sideways swipe would come
  to nothing on the very screens grandparents read from. Tapping a turn zone
  still turns, long-press still points, and at 1× nothing changes at all.
- **The loupe lies on the book, not on the page.** Factor and offset survive a
  page turn (the offset re-clamped to the new page), so a reader who needs 1,5×
  does not re-establish it on every page. `+` and `−` walk the same ladder for
  keyboard and desktop; a mouse drags the page.
- **Zoom is not synchronised.** It is a property of one pair of eyes and one
  screen, like the page-navigation toggle in [ADR 14](0014-local-page-navigation-toggle.md).
- **The native pinch stays untouched.** Suppressing it would mean fighting iOS
  gesture handling for no gain: it remains available as the blurry, familiar
  fallback, and readers who never learned it lose nothing.

## Consequences

- Shared attention survives divergent zoom levels, and this is why local zoom is
  affordable: pointer positions travel as *fractions of the page*
  (`pageFraction` measures against the canvas), so a partner's chevrons land on
  the right spot on the page no matter how far either device is zoomed in.
- A partner can point at something outside the magnified reader's visible
  section; the pointer is then clipped at the edge of the stage. Deliberately
  left as it is for now — the two are on a phone call, and „schau mal unten
  links" costs nothing. If it turns out to bite, an edge indicator pointing the
  way is the cheapest remedy that keeps the reader in control of their own view.
- Two zoom mechanisms now exist on iOS and can stack (a native pinch on top of a
  magnified page). Harmless, and the loupe's own state stays readable in its
  button.
- The factor is deliberately *not* persisted across books or sessions: it belongs
  to a reading, not to the device. If it turns out that the same step is chosen
  every single time, `localStorage` — as in ADR 14 — is the obvious next step.
- The full-width step is recomputed from the page in hand, so turning the device
  — or turning to a page of different proportions — can shift it slightly. That
  is the point: the step means „this page, this screen". A photographed page
  whose own pixels run out first (a photo smaller than the stage, which a camera
  does not produce) simply stops where its resolution does; it is then no longer
  exactly full width, but it still moves in only one direction, so the promise
  that matters holds.
- Keyboard users cannot pan a magnified page; the arrow keys keep turning pages,
  which is the far more frequent action and would be a poor thing to overload.
  Mouse and touch both drag.
