# 31. Type follows the system font size, and on iOS that means Dynamic Type

Date: 2026-08-22

## Status

Accepted

## Context

`src/style.css` held 53 font sizes and not one `rem` (#125). Absolute pixels
ignore the browser's font-size setting entirely, so the one lever a
grandmother reaches for did nothing. Only page zoom still worked, and in the
reader that is largely defeated by `overflow: hidden` and the `position: fixed`
construction (#117).

[ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md) names
this issue by number as accessibility work that pays off for the people who
actually use this app: ageing eyes are the first constraint it lists.

Converting to `rem` is arithmetic. What the issue treated as a footnote turned
out to be the substance: **on the devices this app is actually read on, `rem`
alone changes nothing.**

`index.html` sets `apple-mobile-web-app-capable`, and the grandparents run the
app installed from the home screen. In an installed iOS web app there is no
browser font-size setting and no page zoom — neither lever exists. iOS has one
system type control, Dynamic Type („Anzeige & Helligkeit → Textgrösse" and the
accessibility „Grössere Schrift"), and CSS reaches it through exactly one value:
`font: -apple-system-body`. With that at the root, every `rem` in the file
follows it.

Two properties of that value shaped the decision.

**It is not portable.** On macOS `-apple-system-body` resolves to 13px and would
shrink the app by a fifth. The declaration is therefore guarded by
`@supports (-webkit-touch-callout: none)`, which is true on iOS WebKit and false
on macOS Safari, on Chrome and on Firefox — the standard idiom, and verified
here: Chromium reports the guard as unsupported and keeps a 16px root.

**Its default is 17px, not 16.** Anchoring the root to it therefore makes the
app about 6 % larger on iOS even for someone who has never touched the setting.
Normalising that back to 16 is possible — a `calc()` indirection over every size
— but it buys pixel-fidelity to a number that was never meaningful: 16px is the
browser's default, while 17px is the size in which every other app on that iPad
sets its body text.

## Decision

**Every font size is a `rem`, and on iOS the root is `-apple-system-body`.**

- **`rem` is for type; px stays for geometry.** Spacing, radii, borders and the
  44px targets from [ADR 23](0023-44px-is-the-floor-and-words-yield-first.md)
  stay in pixels. A target does not become easier to hit because the text got
  bigger, and the floor is a finger, not a font.
- **A glyph that stands in for a picture stays px too.** The 📖 on a coverless
  book and the ✕ on a camera thumbnail are sized to their tile, not read as
  text; their tiles do not grow, so neither do they. Three places, each carrying
  the reason where it stands.
- **The 6 % is accepted, not normalised.** On iOS at default settings the app
  sits at 17px. It is the platform's body size, and paying for the alternative
  in `calc()` on every rule is worse than the difference is worth.
- **The floor of 44px becomes a floor for icon buttons too.** Where a control
  declared `width: 44px; height: 44px`, the glyph inside now grows and would be
  clipped; it is `min-width` / `min-height` instead. This is the same reading
  ADR 23 already gave the measure — 44 is the least a target may be, never the
  most.
- **At a size where a row cannot hold its controls, the row yields.** ADR 23
  lets the words go first and the reader's chrome has none left on a phone, so
  above roughly twice the default size the bar wraps to a second line rather
  than pushing „?" off the screen. Measured: it still holds one line at 200 % on
  a 320px phone, and wraps at 300 %.

## Consequences

- A grandmother's system setting now moves the whole app: library, reader
  chrome, dialogs and the closing ritual. That is the point of the change.
- At the default setting the app is pixel-identical to before on every surface
  except iOS, where it is 6 % larger. The library, the mood archive, the book
  dialog, the reader, the help overlay and the sync panel were diffed against
  `main` at 16px: zero differing subpixels.
- Card-shaped overlays (dialog, sync panel) now carry `max-height` and scroll.
  Growing text used to push them out of a centred overlay at both ends at once,
  where nothing could reach them.
- Long German compounds are the other half of this. „Synchronisations-Code" is
  wider than a phone at twice the size, so text breaks inside a word rather than
  running past the edge of its button.
- **There is no linter and no test** ([ADR 8](0008-no-tests-or-linter.md)). A
  new rule that writes `font-size: 14px` will pass review unless someone
  notices. The check is a browser with its font size set to 200 % — and, for the
  people this was written for, an iPad with „Grössere Schrift" turned up.
- Dynamic Type itself cannot be verified from a development container. The guard
  is verified negatively (Chromium stays at 16px); the positive case needs an
  iPhone or iPad.
