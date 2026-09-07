# 39. Each path says who does what, and the reader's control says its name

Date: 2026-09-07

## Status

Accepted

## Context

[ADR 19](0019-shared-reading-starts-in-the-library.md) built the library's
„Gemeinsam lesen" dialog as a copy of the reader's sync panel, so that the two
screens would teach each other. Read aloud to a real pair, only one of them
worked. The panel was understood; the dialog was not, and the reader's sync
button was not recognised as a button at all and never found again.

Comparing the two screens as they had actually been built shows three
differences, none of them intended by ADR 19.

**The dialog stacked three full-width buttons.** „Buch auswählen und Code
erstellen", then „Verbinden" under the field
([ADR 19](0019-shared-reading-starts-in-the-library.md) put it there so the
field would keep the full width), then „Abbrechen" alone in the dialog's own
row — where every other dialog in this app puts its confirming action. The
panel has two: one above, and „Abbrechen" and „Verbinden" side by side below.
The screen's last line said „Abbrechen" in the position that means „yes"
(rule 1).

**The dialog described the procedure, the panel the goal.** „Einer von euch
beiden erstellt den Code und sagt ihn dem anderen am Telefon" against „Damit
ihr dieselbe Seite seht, braucht ihr beide den gleichen Lese-Code des Buches".

**The library tile described one of the two paths.** „Lese-Code eingeben und
mitlesen" is the joiner's half. The person holding the book — usually the
grandparent, the very person ADR 19 set out to serve — was told before opening
the dialog that this was not for them.

Removing the procedure sentence exposes a fourth problem that had been hiding
behind it. Nothing else on either screen says that the two people take
*opposite* halves. If both tap „Lese-Code erstellen", each gets a code, neither
gets an error, and the two only find out on the phone that their codes differ —
after which one of them has to walk back out of a session they have already
started. A silent failure is what rule 5 asks the interface to prevent.

## Decision

**The library dialog is the reader's panel again**, part for part: the same
sentence, the same order, the same classes, and „Verbinden" back in the button
row beside „Abbrechen". It is the row's primary, which sounds like more weight
than it carries: below six characters the button is disabled, and
`.dialog-btn-primary:disabled` is the same quiet filled grey the panel's
„Verbinden" wears. The accent arrives with the sixth character, where it means
„jetzt" rather than „hier entlang".

**Each path carries a rubric naming who does what**, and the two are mirrors:

> Du sagst deinem Lesepartner den Lese-Code
> — oder —
> Dein Lesepartner sagt dir den Lese-Code

Same sentence shape, subject and object swapped, the name of the code at the
end of both. The reciprocity is then visible where the choice is made instead
of being asserted in a paragraph above it that has to be read, held and applied
(rule 8). Both rubrics name the code rather than a pronoun: the pronoun would
point back at the grey sentence above, which is the line that gets skimmed.

The description shrinks to the goal — „Damit ihr beide dieselbe Seite seht:" —
because the structure below it now says the rest. The tile below the 👥 says
the same thing in the same words: „Beide sehen dieselbe Seite".

**The reader's sync button wears „Gemeinsam lesen" beside its 👥**, like
„← Bibliothek" two places to its left. This replaces the glyph-only button
[ADR 19](0019-shared-reading-starts-in-the-library.md) introduced. The word is
the longest in the chrome, so it yields before the others, at 720px rather than
the row's usual 600px: measured at normal type the labelled row needs 649px
before the title gets anything at all, and below that the „?" dropped into a
second row — the `flex-wrap` valve that
[ADR 23](0023-44px-is-the-floor-and-words-yield-first.md) reserves for very
large type. 720px leaves the title about 70px.

### Alternatives considered

**Two dialogs, one question each** — first „who has the book", then a screen
for the code alone. It removes the field from the deciding screen, which is the
strongest thing to be said for it. Not taken: the panel proves that two paths
on one screen are understood when the screen is built like the panel, so the
number of steps was not the defect. It also costs the joiner — often the child,
the least able user here — an extra step, and it would have broken ADR 19's
mirror rather than restoring it. It stays the next thing to try if a real pair
fails on this one.

**„Mein Buch teilen" / „Buch vom Lesepartner empfangen"** as the two labels.
Rejected on both halves: „teilen" is the word for the thing this app
deliberately does not do since [ADR 17](0017-sync-is-the-only-sharing-path.md)
— hand out a file — and on an iPad it names the system share sheet; „empfangen"
asserts a transfer that often does not happen, because the partner may already
have the book or be rejoining a room from last week.

**Hiding the sync label by font size as well as by width.** The right rule
would be „when the words no longer fit", not „below 720px", but a media query
cannot express it: `rem` and `em` there resolve against the browser's initial
font size, not against the root that [ADR 31](0031-type-follows-the-system-font-size.md)
pins to `-apple-system-body` on iOS. A container query could see it, and a
resize observer certainly could; neither is worth its complexity for a bar that
wraps into two readable rows and hides itself after a moment.

## Consequences

- `sync.start.message` is gone, and `sync.panel.desc` now serves both screens,
  so the sentence exists once and cannot drift. `sync.createLabel` is new,
  `sync.joinLabel` and `sync.tileHint` are rewritten,
  `sync.start.selectBook` shortens to „Buch auswählen" because the rubric above
  it already says what it brings in. Nothing is stored under any of these, so
  there is no migration.
- The library dialog is an ordinary `openDialog` with an `input` again. Graying
  „Verbinden" until six characters stand, and Enter from within the field, come
  from `dialog.js`; `bindCodeSubmit` is left with the reader panel as its only
  caller. The two places still share what matters — `applyCodeField` and
  `isCompleteRoomCode` — so they cannot disagree about what a complete code is.
- The dialog's field takes the focus only when it is the only thing to do (an
  empty shelf) or when a rejected code is sitting in it waiting to be typed
  over. Otherwise focus parks on the card, which announces the dialog and keeps
  the phone keyboard down.
- `.shared-start-row` and `.sync-join-label` are gone; the rubric is
  `.sync-path-label` and both paths wear it. It sets `text-wrap: balance`,
  without which both sentences broke at the hyphen in „Lese-Code" and left
  „Code" alone on a line.
- At large Dynamic Type the reader's chrome now wraps a row earlier than it did
  — two rows from about 1.4× type on a 768px tablet, three from about 1.6×.
  Nothing overflows and no target shrinks; this is the valve doing its job, one
  step sooner than before.
- The help overlay's callout for the sync button repeats a word that is now on
  the button itself at 720px and above. Kept: the overlay labels every control,
  and „← Bibliothek" beside „Zurück zur Bibliothek" has always done the same.
  A `data-help-glyph` attribute keeps the button's own label out of the
  overlay's glyph column, which the other three rows line up against.
