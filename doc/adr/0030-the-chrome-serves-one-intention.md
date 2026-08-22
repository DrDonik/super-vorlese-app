# 30. The chrome serves one intention at a time

Date: 2026-08-22

## Status

Accepted

## Context

The bar across the top of the reader slides away after four seconds so that a
book looks like a book. When it comes back, and how long it stays, was never
written down as a rule — it was decided separately at every control. The result
felt different from button to button, and one defect grew straight out of that
gap (#179): after a jump made through the page-number indicator, the bar stayed
on screen for the rest of the reading.

The cause was a CSS escape hatch. Because the bar is the only way to reach
„Zurück", the page jump and sync, a control was never supposed to sit
unreachable above the top edge while it held the focus — so
`.reader-chrome:focus-within` cancelled the transform again. That let the bar be
visible while the class `chrome-hidden` was set. State and screen disagreed, and
four symptoms drifted apart with them: the loupe faded while the bar stayed; the
tap-to-hide gesture from #176 read the wrong state; closing the sync panel
brought the bar back as a ghost; and a left-behind focus pinned it for good —
taking the arrow keys with it, since a focused control swallows them
(`OWNED_BY_A_CONTROL`).

Looking at what people actually want from the bar showed that a single wait
cannot express the problem at all. Someone who summons it is looking for a
control and needs time to hit a 44px target with an older, unsteady hand
([ADR 23](0023-44px-is-the-floor-and-words-yield-first.md)). Someone who has
just pressed one needs only the receipt. Those are different spans, and serving
both with one number means serving one of them badly.

## Decision

The chrome — the bar and the loupe together — serves exactly one intention: it
comes when someone looks for it, stays while the intention is open, gives its
receipt and goes.

**Three waits instead of one:**

- **The search wait, 4 s** (`HIDE_CHROME_AFTER_MS`) — after a reveal (a tap, the
  mouse at the top edge), after keyboard operation, and after the loupe, where a
  second click is likely.
- **The receipt wait, 1.5 s** (`HIDE_CHROME_AFTER_ACTION_MS`) — the intention is
  done and only its feedback is still owed: the navigation toggle, a closed
  help overlay, a closed sync panel, an abandoned page jump.
- **At once** — a committed page jump. The requested page *is* the answer, and
  the bar is lying across the top of it.

**Three states stop the clock entirely:** an open page-jump field, an open help
overlay, an open sync panel. The first two live inside the bar; the third is the
own surface of the button that opened it. Whoever stops the clock restarts it on
closing, with the receipt wait.

**Focus holds nothing open.** No control is handed the focus back after its work
is done — neither the page indicator after a jump nor the sync button after the
panel. Instead: *keyboard operation* reveals the chrome and restarts the search
wait, both arriving on a control (Tab) and using one (Enter, Space). Resting
focus alone does not. Nothing is pulled away while someone is tabbing, and a
control that slipped out of sight under a resting focus returns the moment it is
used — so nothing is ever activated invisibly.

Together these let the CSS escape hatches go without replacement. The
`chrome-hidden` class is once again the single truth about what is on screen.

## Consequences

- #179 stops being a case to fix and becomes a state that cannot occur:
  visibility and class can no longer disagree. The three further symptoms of the
  same cause go with it.
- Doing two things in a row costs one extra reveal — a tap anywhere on the page.
  That is the deliberate price for a resting book looking like a book (rule 8).
- Jumping by keyboard, or closing the sync panel, loses the focus position and
  tabs from the start again. Keyboard-only operation is not this app's audience
  per [ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md), and
  the reveal rule above keeps it from ever grasping at nothing.
- Every new control in the bar has to be assigned one of the three waits. That
  is one decision more per button — and exactly the decision whose absence
  produced the defect.
