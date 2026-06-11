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
