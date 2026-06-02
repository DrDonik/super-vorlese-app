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
- The chrome no longer appears on a long press in the page area. A quick tap
  still reveals it, so the control is not lost.
