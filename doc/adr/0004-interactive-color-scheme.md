# 4. Consistent interactive colour scheme

Date: 2026-05-31

## Status

Accepted

## Context

The interactive colours had grown inconsistent. The accent yellow (`#ffb340`) was doing three unrelated jobs at once: marking the primary action (import, done, create room), signalling an active sync, and acting as the keyboard-focus ring. Secondary buttons drifted between an opaque grey and two different translucent values, and a handful of one-off colours (an Apple blue used only for share-hover, a lone green used only for the "connected" status) had no defined role. The result was that a colour no longer told the user what it *meant*: yellow could be "tap me", "sync is on", or "this is focused" depending on where it appeared.

This matters more than usual here because the app's users are roughly 6-year-old children and their grandparents (see ADR 0001's context and the product purpose). Consistent colour is the first of the Eight Golden Rules of Interface Design that this project follows, and an overloaded palette directly undermines it.

## Decision

Each colour gets exactly one job, expressed as a documented CSS custom property in `src/style.css`:

- `--accent` (`#ffb340`): the completing/confirming action in a modal dialog or flow, and nowhere else (dialog confirm, camera "Done", end-of-book "Zur Bibliothek").
- `--surface` (`#2c2c2e`): equal-weight secondary actions on a solid background.
- `--surface-glass` (`rgba(0,0,0,.5)`, hover `.65`): secondary controls layered over photos or book pages (reader and camera chrome). Dark so light text stays legible over white pages.
- `--danger` (`#ff453a`): destructive actions (delete, disconnect).
- `--success` (`#30d158`): the connected / "on" state (active sync button, room code, status).
- `--focus` (`#0a84ff`): a single, universal keyboard-focus ring on every interactive element, plus the focus border on inputs. Reserved for focus only.

Consequently, yellow no longer means "important"; it means "this completes a decision". Screens with no single dominant action (the library, the reader chrome, the sync setup) use equal-weight secondary styling rather than promoting one button. Active sync is green (a state), not yellow, and focus is always blue, so a focused primary button is visible (a yellow ring on a yellow button was not).

The scheme targets modern browsers: it uses `color-mix()` for derived tints without a legacy fallback, consistent with the existing reliance on `backdrop-filter`, `:focus-visible`, and `aspect-ratio`. Supporting browsers older than Safari/iOS 16.2 is explicitly out of scope.

## Consequences

- Colour is now predictable: one colour, one meaning, applied uniformly across the library, reader, sync panel, camera, and dialogs.
- New interactive elements should reuse the variables above rather than introducing literal colours; the role comments in `src/style.css` are the reference.
- Reader and camera chrome share a single dark glass treatment, legible over arbitrary page or photo content.
- The change is CSS-only — no JavaScript or markup was touched — so it carries no behavioural risk beyond appearance.
- If the palette ever needs to expand (e.g. a distinct "warning" state), add a new variable with its own single job rather than overloading an existing one; if a fundamentally different approach is chosen, supersede this ADR rather than editing it.
