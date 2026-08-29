# 38. The browser decides the language, and there is no setting

Date: 2026-08-29

## Status

Accepted

Extends [ADR 15](0015-sync-code-naming-convention.md) — the vocabulary it fixed
is now fixed per language rather than once.
Bounds [ADR 12](0012-mood-ritual-honours-divergence.md): the mood illustrations
stay uncaptioned, and this ADR says what their names are for once there are
several sets of them.

## Context

The app was written in German throughout — around 185 strings, spread across
the shelf, the reader, the camera, the closing ritual and every error message,
each one a literal at the point where it was displayed. It is going to be
read by families who are not German-speaking, in English, French, Spanish and
Danish.

Three decisions had to be made before any of that could be typed.

**Who chooses the language.** The obvious answer is a setting, and it is the
wrong one here. This app is opened by a six-year-old and by a grandparent who
is on a video call at the same time; if the first thing either of them meets is
a screen they cannot read, a menu they also cannot read is not the way out. The
device already knows: it is the language the operating system is in, the one
every other app on it is already using, and it was set once by whoever set the
device up.

**What happens when the two readers differ.** A French grandmother reading to a
German grandchild is not an edge case in this app — it is close to the point of
it. That only works if nothing translated ever travels between the two devices.
It happens to be true already: the Synchronisations-Code is six alphanumeric
characters, the page number is a number, and the moods travel as the numeric
`id` of an illustration, never as its name. (The code was renamed to
„Lese-Code" the same day — see the 2026-08-29 amendment to
[ADR 15](0015-sync-code-naming-convention.md). The mechanism this paragraph
describes is unchanged.)

**What the mood illustrations are called.** ADR 12 forbids printing their names
on the board — the drawing is a projective prompt, not a vocabulary, and a
printed word beats the picture. So the 47 names exist only as the accessible
name of a button and the `alt` of a keepsake tile. That does not make them
minor: they are the whole ritual for a reader who cannot see the drawing, and
„Wohliges Gruseln" or „Mit den Gedanken woanders" is a piece of child-facing
emotional writing, not a UI label to be run through a translator.

## Decision

**The browser decides, and nothing else does.** The first of
`navigator.languages` the app has a dictionary for wins, matched on the primary
subtag — `de-CH`, `de-DE` and `de-AT` all get the German dictionary, while the
full tag is kept for `Intl`, so a German browser in Germany still gets German
date formats. There is no picker, no stored preference, and no way to override
it inside the app. Someone who wants the app in another language changes their
device's language, which is where that decision belongs.

**A browser the app cannot speak gets English.** Not German: the app is built
for one German-speaking family, but anyone else who opens it is far more likely
to get somewhere in English. German remains the *source* language and therefore
the last stop for any key a translation has not reached yet — an incomplete
dictionary shows German in its gaps, never a blank or a bare key.

**German is written in Swiss orthography** — „ss", not „ß" — for every `de-*`
browser, Berlin included. The app is built for one household and that household
is in Switzerland.

**Sorting, dates and case folding follow the resolved locale**, replacing the
three hard-coded `de-CH` call sites. Plural forms go through
`Intl.PluralRules` rather than a hand-written ternary: German and Danish get by
on two forms, French counts 0 as singular, and a hand-written „1 : n" would be
wrong in the third language it met.

**The mood names are keyed by `slug`, not by `id`.** The id is what travels over
the wire and what is stored in a completion record, so it belongs to no
language; the name belongs to the language. Translating them is explicitly not
a mechanical job, and the dictionary says so at the point where a translator
will be standing.

**What is deliberately left in German.** The `console` messages, which are for
whoever is debugging; the viewport diagnostic behind the five-tap gesture, which
is a maintainer's tool and not a surface for laypeople; and the app's own name
in the PWA manifest — „Super Vorlese-App" is a proper name, and a manifest is a
single static file that cannot vary per browser anyway.

## Consequences

- The app follows the device. Nobody has to be told where the setting is,
  because there is not one; the same reasoning that keeps the shelf free of
  knobs keeps this off the screen too.
- Two readers in two languages share a book, a page and a mood board without
  either of them noticing there was a question.
- Every new user-facing string is written into `src/i18n/de.js` first and
  referenced by key. A string typed straight into a view is a bug that will
  show up as one language that will not translate.
- Adding a language is one file plus one line. Nothing else in the app has to
  know how many there are.
- **User data is stamped in the language it was created in and stays there.**
  The age recommendation read off a title page (ADR 29) becomes a tag, the
  camera's automatic title becomes a title, and neither is rewritten when the
  device's language changes. That is the correct behaviour — they are the
  user's words from that moment on, and quietly rewriting a tag someone may
  have since edited would be worse than a shelf that mixes two languages.
- The installed app's name on the home screen stays German for everyone.
- A translation may lag without breaking anything, which is what makes it
  possible to ship the machinery now and the four languages one at a time.
