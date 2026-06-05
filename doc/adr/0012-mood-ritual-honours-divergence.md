# 12. The mood ritual honours divergence instead of forcing agreement

Date: 2026-06-05

## Status

Accepted

Supersedes [ADR 11](0011-shared-reading-memory.md).

## Context

ADR 11 introduced the book-closing mood ritual: when a synced pair finishes a
book, both readers pick four moods from a shared board, and the screen locks once
their picks overlap by at least three. Living with that design surfaced a tension
with the app's purpose (a warm, shared bedtime moment) and with the Eight Golden
Rules:

- **Forced agreement conflates a shared feeling with compliance.** Requiring a
  three-mood overlap pressures a six-year-old to abandon what they actually felt
  so the screen will unlock — the opposite of the emotional-literacy value the
  ritual is meant to carry. In a grandparent/grandchild pair the more verbal
  adult tends to steer, so "agreement" in practice means the child conforms.
- **It erases the generational difference that makes remote grandparent-reading
  precious.** Oma feeling tenderness while the child feels silliness is the
  gift, not noise to reconcile away.
- **The overlap gate is a silent dead-end** (Golden Rules 5 and 7): if picks
  never agree, nothing happens and there is no feedback explaining why.
- The research on parent–child *reminiscing* (co-constructing an emotional
  narrative of a shared event) points the other way: the value is in each person
  *naming and elaborating their own* feeling, with overlap a happy coincidence
  rather than a requirement.

The overlap gate did do one useful thing — it forced the readers to talk over
the call. Any redesign has to keep a reason to talk while dropping the coercion.

## Decision

Reframe the ritual from "agree on a shared mood" to **"tell me about your
feelings"**. Both readers still pick on the same shared board, but agreement is
no longer required and the partner's picks are hidden until the reveal.

- **Pick three, independently and privately.** Each reader picks exactly three
  (down from four). The partner's picks are synced over the wire but **not shown
  during selection**, so neither reader steers the other toward a match and the
  reveal stays a genuine surprise.

- **Reveal on "both picked", not "both agree".** The moment both readers have
  three picks, each device reveals — a count, fully within each person's control,
  with no dead-end. There is no overlap threshold.

- **Per-device perspective storage replaces the shared lock.** ADR 11 stored a
  single canonical `{ shared, personal }` record, written via a Realtime Database
  transaction so both devices agreed on one identical, anonymous blob. We instead
  store, on each device, **its own perspective**: `{ id, completedAt, mine:[3],
  theirs:[3] }`, where `mine` is always that device owner's picks. The partner's
  device holds the mirror image. The shared `mood/lock` node and its transaction
  are removed entirely — there is no longer anything to reconcile across devices,
  so the reveal is computed and saved locally on each side.

  This is no longer *symmetric-anonymous* (an identical record on both sides) but
  *perspectival-unnamed*: it enables an honest "Ich / Du" labelling while still
  never storing a name. Since completions already live in per-device IndexedDB,
  each device naturally only ever holds — and labels — its own viewpoint.

- **The reveal shows three labelled rows: „Ich" / „Wir" / „Du".** This device's
  own remaining picks on top, the shared moods celebrated in the middle, the
  partner's remaining picks at the bottom. A row is omitted when its zone is
  empty, so **no overlap** simply drops the „Wir" row (six feelings to talk
  about, no gaping hole) and **full agreement** drops „Ich" and „Du" (one shared
  row, "you felt exactly the same"). The shared row gets a soft glow — overlap is
  celebrated when it happens organically, never engineered.

- **„Buch schliessen" closes per device.** The reveal carries a single button
  that rewinds the book to page 1 and returns to the library. Either reader
  closes when ready; there is nothing to synchronise, since each device has
  already stored its own record.

- **Board unchanged at 20.** The board stays a random 20-mood subset of the
  catalogue, shared by the initiator so both devices render the identical one.
  Board size is a scannability choice, deliberately *not* tuned to make overlap
  more likely (shrinking it would mostly manufacture *coincidental* matches
  between readers who felt different things, and narrow each reader's ability to
  name the feeling they actually had).

- **The library mirrors the reveal.** Each finish is stored as another dated
  entry; the cover strip shows a row of every distinct mood from the latest read,
  and the history renders each entry in the same „Ich / Wir / Du" layout, so the
  keepsake looks identical wherever it appears.

## Consequences

- The conversation the old gate forced still happens, but shifts from "let's
  agree" *before* the lock to "tell me about yours" *after* the reveal — arguably
  a richer prompt, since the reveal surfaces concrete differences to discuss.
- The sync layer simplifies: no `lockMood` transaction, no `mood/lock` node (the
  database rules drop the whole subtree), and `listenMood` no longer parses a
  lock. The only shared mood state is the `open` flag, the board `order`, and the
  per-client `picks`.
- The two devices now store mirror-image records rather than identical ones. They
  also stamp their own `completedAt`, so the timestamps differ slightly between
  devices — harmless, as the records are independent and per-device.
- Because reveal no longer depends on a server-confirmed lock, each device saves
  locally as soon as it observes both sets of picks; a re-fired listener is
  guarded so a finish is never stored twice.
- This is a breaking change to the stored completion shape (`shared`/`personal`
  → `mine`/`theirs`); per the project's no-migration policy, older records are
  not converted.
- The ritual remains pair-scoped: in a room of more than two, the reveal pairs
  this device with the first partner who has a full set of picks.
