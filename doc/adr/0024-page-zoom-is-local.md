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

## Second amendment (2026-08-17): the pinch works the loupe

„The native pinch stays untouched" left the reader with two ways to make the page
bigger that do not behave alike. The loupe re-renders the page, shows the factor,
comes back in one tap and keeps „← Bibliothek", the turn zones and the page
indicator on the screen. The pinch does none of that: it stretches the pixels
already rendered, says nothing about its state, is undone only by its own reverse,
and carries the controls off the edge of the display. Which one a grandparent
gets is decided by whether they reached for the corner or for the page.

The list above was written as the case for building a loupe *beside* the pinch.
Read again, it is the case for the pinch *becoming* the loupe: every one of those
four failings is a thing the loupe already does properly, and the pinch is the
gesture people already know. **The reading stage therefore takes the pinch and
works the loupe with it.** Everywhere else in the app — library, dialogs — the
browser's own pinch is left exactly as it was; there is no loupe there to take it
over, and low vision (ADR 22) must keep the one magnification those screens have.

- **Free between 1× and 4×, not snapped to the ladder.** A page that springs
  back out of the fingers that just placed it is the app overruling the reader
  (rule 7). Nothing has to be given up for that: the loupe was already built to
  hold a *factor* rather than a rung, so 1,7× is a state it can show and step on
  from. The ceiling sits deliberately above the ladder's top rung — the pinch it
  replaces went to about 5×, and swallowing the gesture only to stop at 2× would
  take magnification away from exactly the reader this was all for. Past 4× the
  canvas limit begins eating the sharpness that re-rendering the page is for.
- **One magnet, at the bottom.** Pinching back down lands on exactly 1× from
  1,05× on, because 1× is not merely a small factor: it is the fitted page with
  its offset let go and the loupe out of the way, and „1,03×" is none of that.
- **The loupe shows itself and counts along.** While two fingers are down it is
  the only feedback on screen, so it comes up with the gesture — at 1× too — and
  without the chrome's four-second fade, which a pinch can easily outrun. The
  rest of the chrome stays away: someone who has just made the page bigger in
  order to read it is the last person who wants the bar over it.
- **The page follows the fingers, not a control.** The spot taken hold of stays
  under them, measured from the start of the gesture rather than accumulated
  frame by frame, so nothing drifts and pinching back to where one began puts
  the page back where it was. Moving both fingers pans, which falls out of the
  same rule for free.
- **The render comes after.** A factor is committed sixty times a second and a
  page cannot be re-rendered that often, so the canvas is stretched from the
  render in hand while the fingers move and re-rendered once they lift. The
  stand-in scale is held until the sharp render lands, so the page never springs
  back to its old size in between — and the loupe button now works the same way,
  which it did not before.
- **Trackpad and Ctrl+wheel too.** They have the same problem for the same
  reason — the browser zooms the whole window, chrome and all — and one notch is
  about a rung of the ladder.
- **Unless the document is already natively zoomed.** Then the pinch is handed
  straight back to the browser. A reader who pinched in the library carries that
  zoom into the book, and the gesture that undoes it must keep working; nobody
  may be shut inside a state the app then refuses to hear about (rule 7).

## Second amendment consequences

- The `visualViewport.scale` check is also the graceful failure. Whether an
  installed iPadOS web app really lets `gesturestart` be cancelled can only be
  established on the device; if it does not, the app sees the native zoom take
  hold, steps aside, and the reader is left with exactly what they had before —
  rather than with two zooms fighting over the same two fingers. It is asked at
  every step of a gesture and not only at its start, because a native zoom that
  takes hold halfway through is the same failure arriving late: the pinch is
  handed back mid-flight and the loupe returns to the factor the fingers found,
  instead of freezing a half-finished local zoom underneath the browser's.
- „Two zoom mechanisms now exist on iOS and can stack" is no longer true in the
  reader, which is where it mattered. It is still true of the library, and there
  it costs nothing: no page, no loupe, no confusion about which one answered.
- Factors between the rungs are now ordinary, where before every value came off
  the ladder. Nothing in the app assumed otherwise — the button always looked
  for the next rung *above the current factor* — but the ladder is now the
  vocabulary of the tap and the keyboard rather than of the whole feature.
- The stage takes `touch-action: none`, so the browser's double-tap zoom goes
  with the pinch. It was never a way anybody reached the page: two of the three
  double-taps on a reading stage land on a turn zone.
- Nothing about this is synchronised, and nothing about it is stored: the pinch
  sets the same local, per-reading factor the button always set.

## Third amendment (2026-08-26): the Mac gets the same gestures

The second amendment took the pinch away from the browser everywhere. On a
MacBook it took it away and gave nothing back: `suppressNativePinch` cancelled
WebKit's `gesturestart` / `gesturechange` / `gestureend` on every device, and its
comment explained why that was safe — „so the page is zoomed once, by the touch
handlers above, which have the same two fingers". A trackpad has no fingers on
any glass; it fires no touch events at all, and on macOS Safari those three
gesture events are the *whole* channel the pinch has. So the page was zoomed not
once but never, and the trackpad was left with `ctrl` + scrolling — the
Chrome/Firefox convention — as its only way to magnify a page. Two-finger
swiping did nothing at all, on a magnified page as much as on an unmagnified one.

That is a regression against this ADR's own first rule, that the same gesture
means the same thing wherever the reader is sitting, and the remedy is not to
build a pinch for the Mac but to let the suppression become an adoption.

**The wheel and the two fingers move the page — they never mean more than
that. Where there is nothing to move, nothing happens.**

| input | at 1× | magnified |
| --- | --- | --- |
| trackpad pinch | zooms | zooms |
| `ctrl` + wheel/scroll | zooms (unchanged) | zooms (unchanged) |
| wheel / two fingers vertically | nothing | moves the page vertically |
| two fingers horizontally | nothing | moves the page horizontally |

- **Swiping sideways does not turn the page at 1×.** Otherwise the same gesture
  would mean two different things depending on whether the page happens to
  overhang its stage — turning here, moving there. The distinction that matters:
  *having nothing to do* (scrolling a document that fits its window) is not the
  same as *doing something else*. A drag with a finger or a mouse is a different
  case and keeps its page turn: a press is a deliberate approach to the page,
  where a scroll often *begins* by accident — a hand brushing the trackpad —
  and rule 5 says an accident must not turn the page.
- **„Nothing" means swallowed, not ignored.** A sideways two-finger swipe is the
  browser's back gesture on a Mac, and this app pushes no history to go back to:
  the reader would leave the app, and with it the book, which lives only in
  memory. Reading alone that loses the page; reading together it leaves the room.
  Wheel events over the stage are therefore consumed even where they move
  nothing, with `overscroll-behavior: contain` on the stage as the belt to that
  braces.
- **Where the gesture comes from decides, not what the device is.** The gesture
  events are adopted only when no fingers are on the glass — counted live, and
  with a grace period after the last one lifts. On iOS the touch handlers still
  have the same two fingers, so there the events stay merely cancelled and
  nothing about the iPad changes. An iPad with a trackpad attached is both
  devices at once, which is exactly why the question is asked of the gesture
  rather than of the user agent.
- **No re-render for moving.** A zoom changes what the page must be rendered at;
  an offset does not. Moving is a transform and stays one, so it costs a
  composite and nothing else.
- **The chrome stays away**, as it already does for the mouse drag and after a
  pinch (ADR 30): the bar would sit over the very part of the page the reader is
  moving into view.

## Third amendment consequences

- A trackpad pinch and `ctrl` + wheel now reach the loupe through two different
  code paths, one per browser family: WebKit fires gesture events, everyone else
  a `ctrl`-wheel. Both anchor under the cursor through the same `applyPinchAt`,
  and a wheel arriving while a gesture is in progress is ignored, so a browser
  that ever fired both could not zoom twice.
- The Mac now has three ways to magnify (pinch, `ctrl`+wheel, the button) and
  the iPad two. That is one gesture per convention rather than three ideas: each
  is what that device's readers already reach for.
- Scrolling a magnified page has no indicator — no scrollbar, no hint that there
  is more page below. Deliberately left out of this change: it is output where
  this was input, and the iPad has had the same gap since issue #117. A real
  scrollbar is also not cheap here, since the loupe moves the page by transform
  and the stage needs `overflow: hidden` and `touch-action: none`.
- None of this can be verified in CI — there are no tests (ADR 8) and no Safari
  in the agent environment. The diagnosis rests on the code and on the
  maintainer's observation; acceptance needs a real Mac and a real iPad.

## Fourth amendment (2026-08-26): the double-tap goes everywhere, the pinch stays

The second amendment said that outside the reader „the browser's own pinch is
left exactly as it was". That sentence was about the pinch, but what it actually
left alone was every browser gesture, the double-tap zoom among them — and on an
installed iPad web app that one fires in the library and in the camera, where
nothing in this app has ever asked for two quick taps.

Two quick taps on the same spot are nevertheless something people do here, and
the camera is the plain case: photographing a book means tapping the shutter
again and again in the same place. The app answers by magnifying itself. That
is rule 7 at its most literal — a surprise, in place of the thing the finger
asked for.

The library has a second case, and there the app was contradicting itself: the
viewport debugger opens on five quick taps on „Bibliothek"
(`attachDebugViewportTrigger`). The app asks for a rapid run of taps in one
place and the browser zooms away on the second of them.

The delay is the second half of the cost, and it is paid on every tap rather
than only on the accidental ones: while a second tap could still mean something,
iOS holds the first for about 300 ms to find out. Every tile in the library and
every press of the shutter has been waiting on a gesture nobody wants.

**`touch-action: manipulation` at the root of the document.** It names exactly
one gesture — the double-tap zoom — and leaves scrolling and the two-finger
zoom untouched.

- **The pinch is not affected, and that is the point.** The second amendment's
  reasoning stands unchanged: the library and the dialogs have no loupe to take
  the pinch over, and low vision (ADR 22) must keep the one magnification those
  screens have. This amendment narrows that earlier sentence rather than
  reversing it — the pinch stays everywhere it was; the double-tap goes.
- **The root is the right place because the browser intersects down the tree.**
  The effective behaviour of a touch is the intersection of `touch-action` along
  the ancestor chain, so a stricter value further down still wins: the reading
  stage keeps `none` and the help list keeps `pan-y`. Nothing that already
  suppressed more suppresses less now.
- **The scattered `manipulation` declarations come out.** Eight controls carried
  the property themselves — dialog buttons, the mood cards, the loupe. Each is
  now covered by the root, and the loupe's was never doing anything anyway: it
  sits inside a stage that says `none`. One rule, in one place, so the next
  control added to this app is right without anyone remembering to make it so.

## Fourth amendment consequences

- Double-tapping to *undo* a native zoom is gone with it. The reversal is the
  reverse pinch — the mirror of the gesture that caused the state, which is a
  reversal rule 6 accepts, and the same trade the second amendment made on the
  reading stage.
- Two of the Eight Golden Rules are answered by removing something rather than
  adding it: the surprise (rule 7) and the delay before every acknowledgement
  (rule 3).
- Like the third amendment, this cannot be verified in CI (ADR 8) and shows
  nothing on a desktop browser, where the double-tap zoom does not exist.
  Acceptance is a real iPad, in the installed web app: the shutter twice
  quickly in the camera; in the library the sort pills, the filter chips or the
  free space beside the tiles, all of which stay on the shelf. **Not** a tile —
  the first tap already opens the book, so the second one lands in the reader,
  which has been immune since the second amendment. Five quick taps on
  „Bibliothek" should now reach the viewport debugger rather than zooming on the
  way. And the counter-check, that this took only the one gesture: the pinch
  still magnifies the library, the reader's pinch still works the loupe (`none`
  on the stage), and the help list still scrolls under a finger (`pan-y`).

## Fifth amendment (2026-08-26): the pinch goes everywhere too

The fourth amendment took the double-tap app-wide and left the pinch deliberately
standing, on the second amendment's reasoning: outside the reading stage there is
no loupe to take the gesture over, and low vision (ADR 22) must keep the one
magnification those screens have. Testing on the device showed what that sentence
costs, and it is more than it buys.

**The same screen means two things at once.** With the sync panel open over a
book, a pinch on the page works the loupe and a pinch on the panel zooms the
browser. Nothing distinguishes them but which layer the fingers happened to land
on — the stage says `touch-action: none`, the panel above it inherited
`manipulation` from the root. Rule 1 in its plainest form, and unlike a
difference between *places* (the library is not the reader) this one is a
difference between two halves of one display.

**And it leaves a trace.** `nativeZoomActive` hands the pinch back to the browser
whenever `visualViewport.scale > 1`, so someone who magnifies the panel and then
closes it finds the loupe stopped working: the gesture on the page now zooms the
window too, until they pinch all the way back out. Nothing on screen says why.
The same path runs from the library into the book, and it has been open since the
second amendment.

**One rule for the whole app: two fingers magnify the page, and nothing else —
unless the browser has already zoomed, in which case the gesture is the
browser's, so that the way back is never barred.** The second half is not new;
it is `nativeZoomActive`, the reading stage's own rule, now asked everywhere.

- **`touch-action: pan-x pan-y` at the root**, which is the fourth amendment's
  value minus the `pinch-zoom` keyword: scrolling in both directions, and no
  gesture beyond it. Stricter values further down stay stricter, exactly as
  before.
- **Two channels CSS cannot reach**, and they are the two the third amendment
  already had to tell apart for the stage. WebKit's `gesture*` events: a trackpad
  pinch has no finger on any glass and therefore no `touch-action` that applies
  to it, and on iOS they are the belt to the CSS braces, since whether an
  installed web app honours the property there can only be established on the
  device. And `ctrl` + wheel, which is how Chrome and Firefox report a trackpad
  pinch, for which there is no CSS at all. Both live in `src/native-zoom.js`,
  installed once on the document; `nativeZoomActive` moves there with them, so
  the stage and the app-wide suppression ask one question rather than two that
  could drift apart.
- **Not `user-scalable=no`.** iOS has ignored it since version 10, for the good
  reason that it was the lever pages used to forbid magnification outright. The
  route taken here suppresses a gesture and steps aside the moment the platform
  disagrees; that one does neither.
- **The keyboard is untouched.** ⌘/Ctrl and `+` / `−` / `0` still zoom the
  window on a desktop. A gesture slips out of a hand resting on a trackpad and
  is what this is about; a keystroke is a decision, and taking it away would be
  shutting a door rather than choosing which side of it a gesture opens.
  The reader had to be told: its loupe binds bare `+` / `=` / `−`, and it was
  swallowing them with ⌘ or Ctrl held as well, so the promise above was untrue
  inside an open book. It now ignores them when a modifier is down — Shift
  excepted, which is what makes a `=` into a `+` in the first place — the same
  test `dialog.js` already applies to a modal's keys, for the same reason.

## Fifth amendment consequences

- The library, the camera and every dialog lose the native pinch, which was
  their only in-app magnification. What replaces it was already built: since
  ADR 31 every font size follows the system font setting, which is the better
  magnification for text — it reflows rather than pushing the controls off the
  screen, and it is the setting an iPad reader has already made once for every
  app. Below the app, iOS's own accessibility zoom is untouched by anything
  here. What is genuinely gone is magnifying a *cover* on the shelf, judged a
  small loss against a gesture that meant two things.
- The camera is the case that loses nothing at all: a pinch there reads as „come
  closer", and the browser's zoom instead enlarges the viewfinder and its
  surround while the photograph stays exactly as it was.
- The second amendment's „the library and the dialogs keep the browser's pinch"
  is withdrawn, and with it the fourth amendment's counter-check that the pinch
  still magnifies the library. What remains of that reasoning is
  `nativeZoomActive`, which is now the app's escape hatch rather than the
  library's.
- A non-passive `wheel` listener on the document is the price of the second
  channel: `ctrl` is only visible inside the listener, so it cannot be scoped
  more narrowly, and the browser can no longer scroll the library off the main
  thread on a desktop. A list of tiles, and only where a wheel is involved.
- Unverifiable in CI as ever (ADR 8). Acceptance is an iPad and a Mac: pinch the
  library, pinch the camera, pinch the sync panel with a book open, pinch a
  dialog — nothing may move. Pinch the page: the loupe. On the Mac the same four
  with the trackpad, in Safari and in Chrome, since the two take different
  channels. The escape hatch cannot be staged deliberately any more — with the
  suppression working there is no longer a way to zoom the document natively by
  hand — and that is the right shape for it: it is reachable exactly where the
  suppression fails, which is the one situation it was written for. What it
  looks like when it does its job is a screen that magnifies as it did before
  any of this, rather than one where two zooms fight over the same two fingers.
