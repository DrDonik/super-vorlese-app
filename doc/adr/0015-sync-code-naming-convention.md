# 15. Name the pairing code „Synchronisations-Code des Buches" in the UI

Date: 2026-06-11

## Status

Accepted

## Context

The pairing/sync feature referred to itself with three unrelated metaphors and
named the same six-character code differently depending on where the user stood:

- The library tile said „Gemeinsam lesen" but asked for „den Code deines
  Lesepartners".
- The reader's sync panel was titled „Seiten synchronisieren", its button said
  „Raum erstellen", and its description told the user to „Teile den Code" before
  any code existed.
- Error messages spoke of a „Raum" („Raum existiert nicht", „Kein freier
  Raum-Code…", „Der Raum wurde geschlossen.").

So a layperson met „Raum", „Lesepartner", „Code", „Sync" and „Synchronisieren"
for what is one concept — violating the first Golden Rule (consistency) and
leaving the user unsure what to share, with whom, and how. The dialog also
failed to guide the user from the state their device was in (reading alone) to
the state they wanted (reading together): the instruction to share a code
appeared before a code had been created.

## Decision

There is exactly one name for the activity and exactly one name for the code,
with a single point of reference — the **book**, never a „Raum" or a
„Lesepartner".

- **Activity:** „Gemeinsam lesen" everywhere (library tile and reader panel
  title alike).
- **The code:** „Synchronisations-Code des Buches". The full phrase is used
  where the code is introduced or labelled (the panel description, the live-code
  label, the library join prompt); the short form „Synchronisations-Code" is
  used on buttons and input fields, where „des Buches" is already obvious because
  the user is inside a book.
- **The person** stays „Lesepartner" — it names a *person*, not the code, so it
  is not part of the confusion being removed.
- **The dialog guides state → state.** While reading alone, the panel offers two
  clearly separated paths: create a Synchronisations-Code to hand out, *or* enter
  one received from a Lesepartner. The code and the act of sharing it appear only
  once the code exists, in the connected state, under the
  „Synchronisations-Code des Buches" label.
- **Internal identifiers are deliberately left unchanged.** The code still calls
  this a `room` — `roomCode`, the `rooms/$roomCode` Realtime Database paths, the
  `sync-*` CSS classes, and the wording of earlier ADRs (e.g. ADR 0007). These
  are invisible to users; renaming the database path would drag in
  `database.rules.json`, `transfer.js` and the reaper script for no user benefit
  and real risk. This ADR is the bridge: in the UI it is the
  „Synchronisations-Code des Buches"; in the code it is the room.

## Consequences

- Users read one consistent vocabulary across the library, the reader, and every
  error and status message.
- New user-facing strings must follow this convention: „Gemeinsam lesen" for the
  activity, „Synchronisations-Code (des Buches)" for the code, „Lesepartner" for
  the other person, and never „Raum" in anything a user can see.
- A documentation gap is accepted on purpose: code and UI use different words for
  the same node. This ADR exists so that divergence is intentional and
  discoverable rather than a fresh source of confusion.

## Amendment (2026-08-29): the code is the „Lese-Code", and „Trennen" is the way back

Translating the app (ADR 38) forced the same naming decision a second time, in a
language where „Synchronisation" has no everyday equivalent. English „sync" is
the implementation's word and reads as jargon; the obvious English rendering of
the original decision was therefore worse than the original. Working out what
English should say showed that the German had the same weakness and had simply
been read past:

- **The name is long where it is spoken.** This code's whole purpose is to be
  read out loud over a video call, usually by a grandparent to a child who then
  types it. „Synchronisations-Code" is twenty-one characters and five syllables
  of Latinate machinery around a six-character string.
- **The name is long where the screen is short.** It sits on buttons and rubrics
  that ADR 23 already asks to give up their words first on a narrow screen. A
  shorter name relieves that pressure instead of adding to it.
- **The pair was missing an end.** The sync panel has always offered
  „Verbinden". Its opposite was called „Synchronisation trennen" — a different
  noun, so the two never read as the two directions of one thing.

The requirement this ADR actually makes is untouched by any of that: one name
for the activity, one for the code, a single point of reference in the *book*,
and never „Raum". Only the chosen words change.

- **The code:** „Lese-Code", long form „Lese-Code des Buches". It says what the
  code is for, stays anchored on the book, and a six-year-old can say it.
- **The way back:** „Trennen", the counterpart to „Verbinden". The rubric
  directly above it names the code and shows it, so the button needs no noun.
- **The activity** stays „Gemeinsam lesen", **the person** stays „Lesepartner".
- **English follows the same shape:** „Read together", „reading code" / „the
  book's reading code", „reading partner", „Connect" / „Disconnect".
- **„Synchronisation" leaves the user-facing vocabulary entirely.** The status
  line that read „ist nicht mehr synchronisiert" named a concept the app no
  longer has a word for; it now says „Ihr lest „{title}" nicht mehr gemeinsam",
  which uses the name of the activity and needs no metaphor.
- **Internal identifiers are still deliberately left alone**, as above: `room`,
  `roomCode`, the `rooms/$roomCode` paths, the `sync-*` CSS classes and
  `database.rules.json` are unchanged. The bridge this ADR describes is now two
  planks wide — in the code it is the room, in the UI it is the Lese-Code — and
  that is still cheaper than renaming a database path for no user benefit.

## Amendment consequences

- Fifteen dictionary keys change in each language, and the comments in `src/`
  that quote the UI name follow. Nothing is stored under the old name — it lives
  in no record in IndexedDB and in nothing Firebase holds — so there is no
  migration and no compatibility question.
- The nine older ADRs that quote „Synchronisations-Code" are **not** rewritten.
  They are dated decisions and record what was true when they were made; this
  amendment is the bridge, exactly as the original decision was the bridge
  between `room` and the name on screen.
- New user-facing strings follow the amended convention: „Gemeinsam lesen" for
  the activity, „Lese-Code (des Buches)" for the code, „Lesepartner" for the
  other person, „Verbinden" and „Trennen" for the two directions, and still
  never „Raum".
