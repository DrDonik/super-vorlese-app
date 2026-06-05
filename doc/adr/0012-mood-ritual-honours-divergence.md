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

## Amendment (2026-06-05): a warmer close

Living with the ritual surfaced that it carried more intent than it signalled.
Two jobs are equally intended — **closure** ("we finished this, together") and a
**conversation starter** for the live call — but the design under-served both:
the transition from the last page into the feelings grid was abrupt (the
*accomplishment* of finishing was never marked), and the reveal led with the
readers' differences. Deliberation (with the Eight Golden Rules, the
parent–child reminiscing research, and the app's anti-coercion stance) settled
the following, without changing the ritual's mechanics or stored shape:

- **The ritual opens by closing the book.** Instead of jumping straight to the
  grid, the just-closed book's cover is held large and centred for a beat — the
  "we got to the end" thunk — then settles up into the mood card's header, where
  it stays while the readers pick. This marks the accomplishment of *finishing*
  (Golden Rule 4) as its own moment, and anchors the feelings to *this* book
  rather than a free-floating grid. The choreography is pure CSS; under
  `prefers-reduced-motion` it degrades to a plain crossfade. The board accepts
  taps only once the cover has settled, so an early tap can't pick a hidden mood.

- **One trigger, which is the book-closing gesture.** The last-page cue is
  relabelled **„Fertig? Buch schliessen"**: a single reader's tap both starts the
  close and is the shared decision to finish, playing the same intro on both
  devices. (Turning forward past the last page remains the second entry point.)

- **The reveal leads with „Wir".** The shared row moves to the top, with „Ich"
  and „Du" beneath it (row order in `moods.js`'s `REVEAL_ROWS`). For two readers
  who, by design, may have felt different things, opening on what they share
  frames the moment warmly; the differences below read as gentle texture rather
  than a "we saw it differently" tally. The same reordering flows to the library
  history, which reuses the reveal layout. The cover strip already rendered
  shared-first, so it is unchanged.

- **„Buch ins Regal stellen" closes the reveal.** The done button is relabelled
  from „Buch schliessen" to **„Buch ins Regal stellen"**: it returns the book to
  the library — the shelf — where it now sits wearing its mood strip. This closes
  the loop the ritual opened (taken from the shelf → read → closed → reflected on
  → returned, changed) and reads as one continuous gesture with the close. The
  underlying behaviour is unchanged: it rewinds the book to page 1 and leaves to
  the library, per device.

- **Solo reading is unchanged, for now.** This amendment keeps the ritual
  synced-only; a solo finish still gets the plain end-of-book card. Letting solo
  reads flow into the same ritual (the reader's three picks, no waiting, no „Wir"
  / „Du" rows) is a worthwhile follow-up tracked separately as issue #79.

## Amendment (2026-06-05): the board draw guarantees an honest range

The original decision kept the board a **pure random** 20-mood subset (see "Board
unchanged at 20"). Living with the catalogue surfaced that it is not evenly spread
across the emotional space — it was reverse-engineered from one adventurous book
and skews heavily toward high-energy positive feelings, with the *difficult* and
*partner-directed* regions thinly represented. A pure random draw of 20 could
therefore hand a child who just finished a sad or scary book a board with **no
fitting word**, and a board with **nothing to aim at the other reader** — pushing
them to pick a cheerful feeling they did not have. That is the exact cheerful-nudge
this ADR set out to refuse: the ritual's whole point is an *honest* word for how
the book felt, divergence included. Deliberation (issue #77) settled the following,
without changing the ritual's mechanics or stored shape:

- **The catalogue was widened where it was thinnest.** Seven illustrations were
  added (ids 41–47, briefs in `doc/mood-icon-descriptions.txt`) to give the
  single-image difficult feelings — scared, overwhelmed, angry — and the
  partner-directed gestures a second variant, plus another sad and another
  courage. This makes a fitting feeling *available* and not always the identical
  tile, but does not by itself fix the *draw*.

- **The draw is now balanced, not pure-random.** `pickMoodBoard` first guarantees
  a per-cluster minimum (`MOOD_BOARD_FLOORS` in `src/moods.js`) — ≥2 low-arousal
  difficult, ≥1 each of high-arousal difficult, relational, calm, courage, and
  tender — picking at random *within* each cluster, then fills the remaining slots
  at random from the whole catalogue, then shuffles display order. Floors cover
  only the regions where thinness genuinely hurts and no positive feeling can
  substitute; the large, substitutable joy and anticipation clusters carry no floor
  and still dominate the fill, so the board stays mostly random. The floors commit
  7 of 20 slots, well under board size.

- **This does not reopen the "don't tune the board" caution.** That caution was
  about *shrinking* the board to manufacture coincidental overlap between readers
  who felt different things. A floor does the opposite: it **widens** the
  vocabulary on offer without changing board size, so it makes honest — including
  *divergent* — naming reliably possible rather than nudging two readers toward the
  same tile. It celebrates overlap only when it happens organically, exactly as
  before.

- **Determinism is unchanged.** The initiator still rolls the board once and
  broadcasts the resulting `order` array; the partner renders whatever arrives and
  never rolls its own. Balancing the draw touches only the initiator's selection,
  so both devices remain identical with no change to the sync layer.
