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
  (Superseded by the 2026-06-07 clarification below: solo gets the closing
  *beat*, not the board.)

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

## Amendment (2026-06-06): three or more participants

ADR 12 left multi-party behaviour as a degenerate "pairs with the first partner to
finish", which silently drops the third person and can pair the devices
inconsistently. For the one realistic >2 shape in this app — **one grandparent
reading to two grandchildren** — we replace that with an explicit, fair design,
while keeping the ritual's dyadic heart and its identity-free, symmetric selection
screen untouched. The three-person case is handled almost entirely downstream of
*behaviour*, never by putting any device into a special "I am the grandparent"
mode (issue #82).

- **Participant count via a grace-window announcement.** When the ritual opens,
  every device announces itself under `mood/present/{clientId}`. The existing
  ~1.5 s cover-close intro (`MOOD_INTRO_MS`), during which the board is `inert`,
  doubles as a settle window: by the time picking is possible, every device has
  tallied how many are present. The count is recomputed reactively (never frozen),
  and the whole-node write in `startMood` wipes any stale `present` from a previous
  finish, so the count reflects *this* ritual only.

- **Two pick, one witnesses — decided by behaviour, not identity.** No device is
  ever marked "the grandparent". When three are present, all three see one extra
  advisory line — „Drei Personen anwesend. Nur die Kinder wählen Gefühle." — above
  the unchanged „Wähle 3 Gefühle". The adult reads it and abstains; the
  pre-reading children pick as before. Roles emerge from who acts: a device that
  picked a full set pairs (as today) with another full set; a device that picked
  **nothing** while **two** others each completed a full set shows the **witness
  reveal**.

- **The witness reveal: „Ihr / Du / Du".** The bystander sees the moods both
  children agreed on (`Ihr`, on top, celebrated like the picker's `Wir`), then each
  child's own picks as two deliberately-unnamed `Du` rows. No name is ever stored
  — consistent with the perspectival-unnamed model.

- **The witness keeps the whole picture.** Honouring divergence means the witness
  stores not just the agreement but the full reveal — both children's picks and
  their overlap — rendered in her history in the same layout. This also removes the
  "what if they overlap on nothing" edge: there are always six picks to keep. Her
  record is a distinct shape (`{ witnessed: true, a, b }`) from the picker's
  `{ mine, theirs }` mirror pair.

- **Four or more bows out.** Beyond three there is no honest pair-plus-witness
  mapping, so the ritual does not run: after the same intro, every device shows
  „Ende" and stores no record. This delivers the *closure* half without a keepsake;
  a richer N-person ritual is explicitly out of scope for now.

- **Invariants that make a wrong count harmless.** The count drives **only** the
  advisory line and the 4+ bow-out — never a device's ability to pair.
  Pairing/witnessing is purely behaviour-driven. Because the grandparent is on a
  parallel video call she has ground truth on how many people are really present,
  and the advisory line **states the number** so she can cross-check it: if a
  stale/idle device inflates a real pair to a phantom "3", she ignores the line and
  picks, and the normal two-person reveal fires. The one un-rescuable residue — a
  phantom inflating a real three to "4" and suppressing to „Ende" — compounds two
  rare events and fails safe; accepted for now.

## Amendment (2026-06-07): solo and synced-but-alone get closure, not a keepsake

Issue #79 originally proposed routing a solo finish into the mood board as a
single-player ritual. On deliberation we **decline** that: the board (pick-3 →
reveal → keepsake) stays gated to a real co-reading moment, and solo finishes
instead get the ritual's *closure* beat — the cover-close „thunk" → „Ende" →
„Buch ins Regal stellen" — with **no** board and **no** stored keepsake.

- **The ritual is interpersonal by design.** [ADR 11](0011-shared-reading-memory.md)
  opens with „It is interpersonal, not solitary … and never intrude on solo
  reading." This ADR reframed the ritual's *content* but never overturned that
  scoping, so a solo board would be the first reversal of that decision — and it
  does not survive scrutiny. Solo, the „Wir / Ich / Du" reveal reveals nothing
  (two of three rows vanish, there is no surprise in your own taps, and no partner
  on the call to talk to), and a solitary keepsake quietly changes what the shelf
  *means* — a paired record is „the feelings we shared across the distance", the
  whole reason this app exists. Closure, by contrast, never needed the board: the
  cover-close animation already delivers „I finished this".

- **Both tails of the participant band bow out to the same „Ende".** This slots
  into the count band introduced by the #82 amendment: the board is the middle of
  the band, and both tails bow out identically. **One** participant (an unsynced
  solo reader, or a synced reader whose partner never joined the ritual) and
  **four or more** both bow out to the same plain „Ende" closure with **no
  keepsake** — reusing the exact `showMoodEnd` path the 4+ tail already used.
  **Two or three** still show the board. This upholds ADR 11's „interpersonal,
  not solitary" premise while giving every finish the same warm cover-close
  ending; a finish with no one to share it with is marked as *closure only*,
  never recorded as a solitary keepsake.

- **The standalone end-of-book card is removed.** Every finish — solo, alone, or
  synced — now flows through the one closing overlay, which **supersedes** the old
  „Ende des Buches" card. This also fixes the two prior dead-ends in one stroke:
  the synced-but-alone board that never revealed (pick 3, nothing happens), and
  the cold standalone end card. The ✕ on the „Ende" screen returns to the last
  page (the old „Weiterlesen"); „Buch ins Regal stellen" shelves the book, rewound
  to page 1 (the old „Zur Bibliothek").

- **No misfire during the grace window.** Because a normal synced pair momentarily
  tallies a count of 1 before the partner announces, the ≤1 bow-out is gated on the
  same ~1.5 s settle window the count band already uses (a `moodSettled` flag): the
  branch is evaluated only after the window elapses, so a paired ritual never
  flashes „Ende" on its first listener tick.

## Amendment (2026-08-13): the illustrations are never named on screen

A universal-design audit (issue #132) read the wordless board as a gap: the
meaning of a mood is carried by the illustration alone, the label lives only as
the button's `aria-label`, and anyone who cannot resolve a drawing has no
fallback — the difficult feelings in particular are finely distinguished
(„Ganz traurig" / „Echte Tränen" / „Tränen verdrückt", ids 7/35/44). It proposed
showing the name of the selected mood beneath the board. We **decline** that, and
record the reason here, because the premise — that each drawing denotes one
feeling that can be assigned to a book — is the thing we disagree with.

- **The illustrations are a projective prompt, not a vocabulary.** The ritual
  never asked for a consistent categorisation of the book. The same drawing
  honestly means different things after different books, and that is the point:
  it hands the reader something to feel *at*, not a term to file the evening
  under.

- **A visible word beats the picture, asymmetrically.** Once the text is on
  screen, the text wins. The question turns from „what does this picture feel
  like for *this* book?" into „which of these 20 words fits?" — a sorting task.
  That is the same move this ADR removed when it dropped the overlap gate: a
  mechanism that ends the conversation. A caption would end it again, one step
  later. At the reveal, „you both picked this one — what was it for you?" becomes
  „we both had *Staunen*", agreed and finished.

- **Divergence reaches into the picking, not just the tally.** Two readers may
  choose the same tile and mean different things by it. Under images that stays a
  conversation; under words it hardens into an agreement that was never there —
  precisely the coincidental overlap this ADR set out not to manufacture.

- **The audit's stated benefit does not exist in this app's shape.** It argued the
  reading adult could confirm what the child hit. Picks are private until the
  reveal (by design, above) and the readers are on separate devices in different
  places, so nobody can see the other's board either way.

- **The one real residue is already answered.** A *mechanical* mistap on a
  neighbouring tile is shown by the selection ring and scale. Under this premise
  there is no semantically wrong tile to protect against.

- **Nothing on screen changes, because the app already matched this principle.**
  `label` is rendered nowhere visible today. Issue #132 would have been the first
  break with the wordless design, not a repair of an inconsistency.

`label` and the accessible name keep their word, deliberately and for reasons
that are not claims about meaning:

- **`label` is a code-side handle** — it ties a stable wire id to its shipped
  asset and gives reviewers something to say out loud. It is not the drawing's
  definition.

- **`aria-label` (board) and `alt` (reveal) solve operability.** A button with no
  accessible name cannot be operated at all; that is a different problem from what
  the board *shows*. Naming the drawn pose instead of the feeling
  („Zusammengesunken, Kopf gesenkt") would be the consistent extension of this
  decision and was considered — it would hand a blind reader the same raw material
  a sighted one gets. We do not take it for now: 20 pose phrases are markedly
  slower to hear than 20 words, and the trade is not clearly a gain. The tension
  is real and is recorded here so it is not rediscovered as a bug.

Consequence: issue #132's acceptance criteria are consciously not met — there is
deliberately no visible textual path to a picture's meaning, and the board's
height budget stays free of a caption line. A future proposal to caption the
illustrations is out of scope by this decision; reopening it means arguing
against the projective premise above, not against the `aria-label`.
