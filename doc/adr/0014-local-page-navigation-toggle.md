# 14. Local page-navigation toggle

Date: 2026-06-08

## Status

Accepted

## Context

When two people read together, one drives the pages and the other listens. The
listener still touches their screen — to point at the page on a long press, or
simply because a six-year-old rests a hand on it — and every stray tap on a
page-turn zone or accidental swipe flips the page for both devices. The listener
has no way to opt out of driving the pages while keeping the rest of the reading
experience.

We wanted a way to suppress *self-initiated* page navigation on one device
without affecting the partner, and without losing pointing, the page-jump
indicator, or the chrome.

## Decision

A toggle button in the reader chrome switches the local page-navigation
affordances on and off:

- **Off** disables the tap zones and the swipe gesture.
- Pointing (long press), the page-jump indicator, and tap-to-reveal-chrome stay
  live. With the zones inert, a tap anywhere simply reveals the chrome.
- Pages pushed by the synced partner still turn the page — the toggle only gates
  this device's own navigation, never incoming sync.

The setting is **per-device for all books**, not per book, persisted in
`localStorage`. It is read synchronously at construction so the zones never flash
active for a frame before the setting loads. Default is on, preserving existing
behaviour.

State is shown through the button's glyph — outward arrows, dimmed and struck
through with a diagonal line when off — rather than colour. Per
[ADR 4](0004-interactive-color-scheme.md) each colour has exactly one job:
`--success` is the connected state and `--danger` is a destructive action.
Turning navigation off is neither, so green/red would misrepresent it and clash
with the sync button's green.

In the chrome the sync button moves left to sit beside the library button, and
the new toggle takes the sync button's former slot next to the page indicator,
grouping connection controls on the left and page/view controls on the right.

## Consequences

- A listener can read along, point, and tap freely without moving the pages; only
  the reading partner's turns advance the book.
- Keyboard arrow navigation is intentionally left unaffected: it is a deliberate,
  precise desktop input, not an accidental-touch source, and the feature targets
  the touch-listener case.
- A new global (non-per-book) settings concern now lives in `localStorage`,
  alongside the existing sync-room state, distinct from the per-book data in
  IndexedDB.
