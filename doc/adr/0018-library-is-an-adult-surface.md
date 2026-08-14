# 18. The library is an adult surface; the reader is the shared one

Date: 2026-08-14

## Status

Accepted

## Context

[AGENTS.md](../../AGENTS.md) sets one bar for the whole app: it has to work for
six-year-olds and their grandparents with no intervention by anyone else. Issue
#133 held the library up against that bar and found it almost entirely German
running text — „Gemeinsam lesen", „Synchronisations-Code eingeben und mitlesen",
the sort pills, the empty state — with the two emoji on the add buttons as the
only non-written foothold. It proposed two remedies: pictures beside the text on
the load-bearing actions, and a „?" help in the library mirroring the reader's.

Which of the two matters more depends on a question the issue itself raised and
left open: **who actually operates the library?** That answer also decides how
every control added there in future should be judged, so it belongs here rather
than in one issue's comment thread.

[ADR 16](0016-personal-tags-and-shelf-filtering.md) already answered a narrow
version of it — organising the shelf is "a power-user job: the parent who keeps
the library, not the six-year-old or the grandparent who reads from it". What
was missing is the same judgement for the rest of the view, and in particular
for starting a shared reading session, which is neither organising nor reading.

Three roles meet in this app, and only one of them is stuck:

- The **parent who keeps the library** photographs, imports, tags and deletes.
  A power user, at their own device, in no difficulty.
- The **grandparent** has to bring a shared reading session about, alone, with
  nobody beside them to help — the entire point of the app is that the other
  household is far away. This is the hard case.
- The **child** picks a book. On the child's side an adult is realistically
  present anyway: someone has to set up the video call the app presumes.

## Decision

**The library is measured against the least technical adult; the reader is
measured against the child who cannot yet read.**

- In the **reader**, everything essential must be operable without reading:
  covers, tap zones, gestures, the mood icons. It already is, and the „?"
  overlay exists there precisely because two of those affordances are invisible.
- In the **library**, the measure is the grandmother who has to start a session
  unaided. Text is acceptable there — she reads fine. What is not acceptable is
  a control whose *purpose or procedure* she cannot work out.

Two consequences follow immediately, and both settle issue #133's proposals:

**No pictograms on the sort pills or filter chips.** „Zuletzt gelesen", „A–Z",
„Hinzugefügt" are used by the shelf-keeper, and any icon for them would be
invented rather than recognised. Adding one buys nothing for the child (who does
not sort) and costs clarity for the adult (who does).

**No „?" overlay in the library.** The reader's help earns its place by labelling
things that cannot be seen. In the library every control is visible and already
labelled, so callouts would repeat the labels back. The grandmother's difficulty
is not "what is this button" but "what am I supposed to do, and where does this
code come from" — a procedural question, answered at the point of decision
rather than behind a question mark. See
[ADR 19](0019-shared-reading-starts-in-the-library.md).

## Consequences

- Issue #133's acceptance criterion "the help mechanism is shared between library
  and reader" falls away: there is no second overlay to share one with. The
  reader's `openHelp` / `addHelpHint` / `addChromeHelpHints` stay where they are,
  unextracted, until a second caller genuinely exists.
- Future controls in the library are judged by "can a technically inexperienced
  adult work out what this does and what to do next", not by "can a
  pre-literate child use it". Future controls in the reader are judged the other
  way round.
- The one thing the child does in the library — choosing a book by its cover —
  stays fully pictorial, and the book-picking step of
  [ADR 19](0019-shared-reading-starts-in-the-library.md) is deliberately built on
  covers for that reason.
- This is a statement about *where the bar sits*, not licence to write more prose:
  the wording rules of [ADR 15](0015-sync-code-naming-convention.md) are
  unchanged, and shorter remains better everywhere.
