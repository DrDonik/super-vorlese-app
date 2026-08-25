# 10. Point at the page with a long press

Date: 2026-06-02

## Status

Accepted

## Context

The app is used alongside a video call: a grandparent reads a book to a
grandchild, each on their own device, with the pages kept in sync. Often one
side wants to point at a *spot* on the page — "I'm reading here", or a child
showing where the bunny is hiding — which a shared page number cannot express.
Over a video call you cannot point at the other person's screen.

We want a gesture that lets one participant indicate an exact position on the
current page and have the other participant(s) see it, designed for six-year-olds
and grandparents with no setup or explanation.

Constraints that shaped the design:

- It must not collide with the existing stage gestures: tap-to-reveal-chrome,
  the left/right page-turn zones, and horizontal swipe-to-turn.
- It must work across devices of different sizes/orientations (primarily
  iPad-to-iPad, but not exclusively).
- More than two people can share a room (multiple reading circles), so several
  pointers can be active at once and must stay distinguishable.

## Decision

A **long press** (≥700 ms) on the page activates a pointer: four chevrons fly
inward and converge on the touched spot around a pulsing dot, and the cluster
**follows the finger** until it is lifted — so a participant can also circle or
trace something. The chrome stays hidden during the press so pointing is
unobstructed; a quick tap still reveals the chrome as before.

- **Gesture recognition.** A single unified touch recogniser on the reading
  stage distinguishes quick tap (reveal chrome, unless over a page-turn zone),
  long press (point), and horizontal swipe (turn page). Movement beyond ~10 px
  before the 700 ms threshold aborts the long press, so a swipe never
  accidentally points. This replaced the previous separate swipe handler and the
  blanket "any touch reveals chrome" listener, which could not be reconciled
  otherwise.
- **Position as a fraction.** A pointer is stored as `{ x, y }` fractions
  (0..1) of the reading stage, so it lands on the same place on every screen
  regardless of size. On meaningfully different aspect ratios the spot is
  approximate, which is acceptable for the primarily-iPad audience.
- **Live presence, not durable.** A pointer lives at
  `rooms/$roomCode/pointers/$senderId` only while the finger is held; it is
  removed on release. Unlike room membership (ADR 0007), pointer presence *is* a
  live-socket signal, so it carries an `onDisconnect().remove()` handler to
  clean up if a device drops mid-gesture. Each participant writes only its own
  slot, so concurrent pointers never clobber each other. Position updates are
  throttled to ~12/s with a trailing flush so the remote pointer settles exactly
  where the finger stopped.
- **Local echo.** The pointing device renders its own pointer immediately,
  without waiting for the network round-trip, so the gesture feels instant.
- **Per-peer colour.** Each pointer's colour is derived deterministically from
  the `senderId`, so every device computes the same colour for a given peer with
  no colour data on the wire, and a peer keeps its colour for the whole session.
- **Cleared on page turn.** Any pointer is removed the instant the page changes
  (local or remote), so a stale pointer never bleeds onto the next page. A
  re-render from a resize/orientation change keeps the pointer.

## Consequences

- A new `pointers` subtree is added to the room with its own validation rule in
  `database.rules.json` (fractions in 0..1, keyed by a sender id). The page,
  membership, and WebRTC signalling paths are untouched.
- Negligible cost: pointers are a couple of small numbers written only during an
  active press and auto-removed on release or disconnect.
- The pointer is a touch gesture; it is not wired to mouse input, matching the
  iPad-first audience. Revisit if desktop use becomes common.
  *Superseded by the 2026-08-20 amendment below: a held mouse button points too.*
- The chrome no longer appears on a long press in the page area. A quick tap
  still reveals it, so the control is not lost.

## Amendment (2026-08-20): pointing is not a touch gesture

The consequence above left one thread hanging — *"it is not wired to mouse
input... revisit if desktop use becomes common"* — and issue #121 is that
revisit. Desktop use did become common: a grandmother reading along on her
laptop had no way to point at the page at all, and, worse, the help overlay
promised her one anyway („Finger gedrückt halten: auf die Seite zeigen" was
shown on every device). A feature that exists only in the instructions is worse
than a missing feature (rules 3 and 7).

### Decision

**The same gesture, on every kind of input.** Holding the left mouse button on
the page for the same 700 ms places the same pointer, which then follows the
cursor until the button is released. The partner sees no difference between a
finger and a mouse: the wire format, the throttling, the colours, and the
clearing on a page turn are all untouched — pointing was already input-agnostic
everywhere except in how it is started.

We deliberately did *not* add an explicit "pointing mode" to the chrome, the
alternative the issue offered. A mode is a state to switch on, to recognise, and
to switch off again — three things to learn where the gesture is one, and one
more way for the two devices to behave differently from each other (rule 1).

**Recognition stays split in two, arbitration and all.** `attachStageGestures`
keeps the touch recogniser (tap / long press / swipe / pinch); the mouse gets
its own, `attachMouseGestures`, because folding pointer events into the touch
one would make it handle every touch twice. What the two share is the
threshold: `LONG_PRESS_MS` and `MOVE_CANCEL_PX` are now module constants that
both measure against, so the gesture cannot drift apart between devices.

Within the mouse recogniser, holding-to-point and dragging-the-magnified-page
start identically and are told apart by movement, as they are for a finger. One
consequence is worth naming: while the press could still become a pointer, the
drag does not begin until the pointer's own 10 px cancel distance, rather than
at its usual 3 px. Otherwise a hand that shifts three pixels during the hold
would drag the page out from under the pointer it was about to place. A real
drag crosses both distances in one movement, so dragging is unchanged in
practice.

**The help names the input the reader has in hand.** Because the gesture now
exists everywhere, no callout appears or disappears with the hardware; instead
the wording follows the input type last used on this device (`pointerdown`'s
`pointerType`, seeded from `(hover: hover) and (pointer: fine)` for a help
opened by keyboard). „Maustaste gedrückt halten" at a laptop, „Finger gedrückt
halten" on an iPad — and the same for the loupe's „mit der Maus / mit dem Finger
verschieben". On a hybrid device (a touch laptop, an iPad with a Magic Keyboard)
this follows what the reader is actually using rather than what the device could
in principle do, and it is always current: the help is opened by pressing the
„?" itself.

### Consequences

- Touch behaviour is untouched — structurally, not merely by testing: the touch
  recogniser was not modified beyond reading its two thresholds from module
  scope.
- A mouse press that pointed swallows the click it would otherwise deliver on
  release (`swallowNextClick`), so pointing near the page edge no longer turns
  the page. The drag already did this.
- **A gesture must end even when its release is never reported**, and this
  matters more for pointing than for the drag it shares its code with: a drag
  left hanging is a local annoyance, while a pointer left hanging is left
  hanging on the partner's page. So the pointer is captured — but only once the
  press has actually become a gesture, because while a capture is held the
  browser retargets the *click* to the capturing element as well, which would
  rob the turn zones of the plain clicks that turn pages. On top of that,
  losing the window's focus or the tab's visibility mid-gesture ends it, for the
  browsers that drop a release happening outside their own window.
- Pointing suppresses the chrome's mouse-reveal band, matching the long press,
  which has always kept the chrome away so the page stays unobstructed.
- The pen (`pointerType: 'pen'`) is left with the touch path it already has;
  Apple Pencil fires touch events, so treating it as a mouse would mean handling
  one gesture twice. If a stylus on a non-Apple tablet ever needs this, it is a
  separate, small change.
- There is still no keyboard way to point. Without a pointing device there is no
  spot on the page to point *at* without inventing a cursor, and
  [ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md) puts
  this app's accessibility effort elsewhere.

## Amendment (2026-08-25): every press on the page means something

Issue #120 found the recogniser described above turning slow and shaky hands
away. It sorted a press into tap or long press with two independently tuned
sets of numbers — a tap was under 600 ms and under 15 px, a long press held for
700 ms and cancelled at 10 px — and between those numbers sat gaps in which a
touch was neither: held for 650 ms, or wobbling 20 px, or simply held with a
finger that had drifted 12 px. The gaps miss a quick, steady hand entirely and
catch older and smaller ones daily, which is precisely the audience of ADR 0010.
The chrome hides itself after four seconds, so a reader whose taps keep landing
in a gap is left with a page and no controls at all.

### Decision

**Two thresholds, not four, and each one boundary between two meanings.**

- *Distance.* `SWIPE_PX` (40 px) alone separates turning the page from tapping
  it: at or beyond it sideways the page turns, short of it the press is a tap.
  The former tap radius is gone, so there is nothing between the two.
- *Duration.* A tap has no maximum duration at all. By the time one could
  expire, the 700 ms long press has either claimed the touch — in which case
  `touchend` has already returned above the tap branch — or it never will.

That is the whole fix for the dead zones: they are closed by construction rather
than by choosing kinder numbers, so no future tweak to one threshold can reopen
one. `MOVE_CANCEL_PX` still aborts a long press at 10 px, which now only means
that a wobbly press is a tap instead of a point — not that it is nothing.

**Reading alone, a held press is a tap.** Without a room `beginLocalPointer`
places no pointer, and a press held past 700 ms therefore now falls through to
the tap it looks like and reveals the chrome, on both kinds of input: the mouse
recogniser no longer requires its hold timer to still be pending to count a
release as a click, only that no pointer was placed. The gesture keeps meaning
the nearest available thing rather than nothing at all, and it means the same on
an iPad and at a laptop (rule 1). With a partner nothing changes: the press
points, and pointing has always kept the chrome away.

### Consequences

- There is no duration at which a press on the page does nothing, and no
  distance below the swipe threshold either. The one deliberate remainder is a
  vertical drag of 40 px or more: that is an aimed movement, not a wobble, and
  the reading stage has nothing to scroll.
- A swipe that falls short of `SWIPE_PX` now reveals the chrome instead of doing
  nothing — and the chrome is where the page-turn buttons are, so the reader is
  handed the thing they were reaching for.
- `TAP_MAX_MS`, `TAP_MAX_PX` and the touch recogniser's `startTime` are gone.
- Both recognisers now remember that a press *pointed*, rather than asking
  whether a pointer is still standing. The tap's old 600 ms ceiling happened to
  cover the one case where those differ — a page turn wipes every pointer
  (`clearAllPointers`) while the finger or button is still down — and without
  the memory that press would have come up as a tap and thrown the chrome over
  the page that just arrived. A gesture that pointed stays that gesture until it
  is released, on the glass and at the mouse alike.
- The help overlay is unchanged: it already scopes „auf die Seite zeigen" to
  „beim gemeinsamen Lesen", which is now literally true rather than merely the
  only case where it did anything.
