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
- **A computed rung fills the width exactly.** On a landscape screen a portrait
  page is letterboxed at the sides, and the most useful magnification there is
  the largest one that still only ever moves in one direction: the page as wide
  as the stage, nothing left over beside it, scrolling up and down and swiping
  to turn (the swipe survives because a page with no sideways play keeps it —
  see above). That factor depends on the page and the screen — about 2,1× on an
  iPad held sideways, 2,5× on a 16:9 laptop — so it is computed, takes its place
  among the fixed rungs, and absorbs any neighbour within 12 %, so that no two
  rungs are a hand's breadth apart:

  | | ladder |
  | --- | --- |
  | iPad sideways | 1 · 1,5 · **2,1** (absorbs 2×) |
  | a screen where it lands mid-gap | 1 · 1,5 · **1,7** · 2 (four rungs) |
  | phone or iPad upright | 1 · 1,5 · 2 (it is ~1× and drops out) |
  | a sliver of a page, over 3× | 1 · 1,5 · 2 (it would be a wild jump) |

  It is deliberately *width*, not „whichever side is letterboxed": on an upright
  phone that side is the height, and filling it would force the reader to scroll
  across the lines of text — the one direction reading cannot spare.
- **The loupe holds a factor, not a rung number.** The ladder is not a fixed
  series, so a stored position on it would come to mean something else the
  moment the device is turned, and the page would resize under the reader's
  hands. Holding the factor leaves the page exactly as large as it was through a
  rotation; the next tap takes the next rung of the ladder now in force, or
  returns to 1× when there is none above.
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

  *Corrected by the 2026-08-17 amendment below: the factor survives a page turn,
  the offset returns to the top of the new page.*
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
- The full-width rung is computed from the page in hand, so turning the device —
  or turning to a page of different proportions — can shift it, and on some
  screens the ladder is four rungs rather than three. That is the point: the
  rung means „this page, this screen". A photographed page
  whose own pixels run out first (a photo smaller than the stage, which a camera
  does not produce) simply stops where its resolution does; it is then no longer
  exactly full width, but it still moves in only one direction, so the promise
  that matters holds.
- Keyboard users cannot pan a magnified page; the arrow keys keep turning pages,
  which is the far more frequent action and would be a poor thing to overload.
  Mouse and touch both drag.

## Amendment (2026-08-17): the factor lies on the book, the section on the page

„Factor and offset survive a page turn (the offset re-clamped to the new page)"
was one decision too many. The factor belongs to a pair of eyes and holds across
the book, as decided. The *offset* does not: carried over, it sets the reader
down at the same place in the new page as they left the old one — and the place
they left the old one is its end. At the full-width rung, where a page is read
top to bottom, every turn therefore landed at the bottom right of a page not yet
read, and the reader had to drag back up before starting. Re-clamping made that
worse rather than better, because it is precisely what pins the offset to the new
page's bottom edge instead of letting it run out.

**A page turn puts the section at the beginning of the page: its top, and its
left edge where there is sideways play at all.** The resting position is the
page's centre, so „the beginning" is the full positive offset on both axes, not
zero; where an axis has no play — an unmagnified page, or the full-width rung
sideways — nothing moves.

- **In both directions.** Turning back lands at the top too, although the reader
  left that page at its foot. Making the landing point depend on the direction of
  the turn would be a cleverness that costs consistency (rule 1) and surprises
  (rule 7); a page begins at its beginning whichever way one arrives.
- **A remote turn counts as a turn.** When the partner turns the page, both
  readers start at the top of the new one, which is what synchronising the page
  was for.
- **A resize or a rotation is not a turn.** There the offset stays and is merely
  re-clamped, as before: turning the iPad must not take the reader's line away.
  The code already distinguished the two cases for pointer-clearing, and now
  splits the pan the same way.

## Amendment consequences

- The offset is no longer a place in the book that has to remain meaningful
  across pages, only a place in the page in hand, which is the only thing it ever
  described honestly.
- Flipping back and forth to compare the same spot on two pages now costs a drag
  each way. Judged the rarer case by some distance against reading a magnified
  page front to back, and the factor — the expensive thing to re-establish — is
  still kept.
