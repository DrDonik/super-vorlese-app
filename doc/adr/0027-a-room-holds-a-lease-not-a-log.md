# 27. A room holds a lease, not a log and not a guest list

Date: 2026-08-19

## Status

Accepted

Amends [ADR 7](0007-presence-based-room-lifetime.md), whose member set this
removes, and revises [ADR 26](0026-the-room-records-that-reading-happened.md) on
the one point where it decided to keep `updatedAt` as it was.

## Context

[ADR 26](0026-the-room-records-that-reading-happened.md) took the device
identity out of the room: nobody holding the code can still tell *who* turned a
page. Two things it left standing say more than they need to.

**`updatedAt` names an evening.** The server timestamp was rewritten on every
single page turn, so a room that is read in nightly carried, at the precision of
a minute, the hour at which the child was still awake — refreshed every evening,
readable by anyone with the code. ADR 26 kept it because the reaper
(`scripts/reap-stale-rooms.mjs`) has to know when a room fell out of use, and
rejected coarsening it for a reason about the *rule*: `updatedAt` is validated
with `newData.val() == now`, and rounding would have meant relaxing that into a
range.

**`members/$id` names how many devices are in the room**, one key per device
that has the sync set up. It buys exactly one mechanism: when the last
participant explicitly leaves, that client deletes the room. The mechanism rests
on an assumption that does not hold. A grandparent and a child finish a book and
put the tablet down; nobody goes into „Buch bearbeiten" to tap „Synchronisation
trennen". Rooms are abandoned, not closed. So the room paid for a standing
record of its participants — written afresh on every reconnect, which is why
merely *opening* a synced book used to write to the database — in exchange for a
deletion that in practice never happens.

Both are small signals. Neither is worth what it costs.

## Decision

**A room holds a lease. It does not hold a log of when it was read in, and it
does not hold a list of who is in it.**

- **`updatedAt` becomes a lease renewal.** It is written once when the room is
  created and refreshed only when it is older than `ROOM_REFRESH_MS` (30 days).
  It still says exactly what the reaper needs — this room is still in use — and
  no longer says when anyone last read.

- **The renewal only ever rides a page write.** Never on connecting,
  reconnecting or looking a code up. This is the whole point rather than an
  implementation detail: a timestamp written when a device comes online *is* the
  "who was last there, and when" record, at whatever interval it is written. The
  value the decision needs is already in hand — the room listener delivers the
  whole node on every change — so the check costs no read. As a result, opening a
  synced book now writes nothing to the database at all. Only turning a page
  does.

- **A room lives 45 days without a page turn** (`ROOM_TTL_MS`), which is also
  when every client starts refusing the code. The reaper deletes one day later
  (`REAP_GRACE_MS`). The client is therefore always the stricter of the two: a
  room the sweep has condemned already reads as gone to everyone, so nobody can
  renew it in the gap between the job's listing and its write, and the deletion
  needs no conditional request.

- **`members` is gone, and with it the closing mechanics.** No enrolment, no
  `leaveRoom`, no "last one out deletes the room". „Synchronisation trennen" and
  deleting a book are now purely local: this device forgets the code, and the
  room stays until its lease runs out. The partner keeps reading either way,
  which is what ADR 7 wanted (issue #50) — it just no longer costs a guest list.

- **The database rule for `members` stays, for now.** Rules are published before
  the app ([ADR 6](0006-automate-database-rules-deploy.md)) and an installed iOS
  web app only picks up a new build when it next comes to the foreground
  ([ADR 11](0011-ios-pwa-auto-update.md)). An old client that could no longer
  enrol would find an empty member set on „Trennen" and delete the room out from
  under a current client — issue #50 again, by accident. The rule can go once no
  old client is left.

- **`memberId` stays durable, for a different reason than before.** ADR 7 and
  ADR 26 justified persisting it by the member set: a fresh id per app start
  would strand an entry nobody removes. That reason is gone. What remains is the
  mood ritual's participant count (issue #82), which would count a device that
  restarts mid-ritual twice. The id now appears only in `pointers` and `mood`,
  both wiped by design, so it never accumulates into a history.

## Consequences

- What a room still tells someone holding the code: which book it is for, the
  current page, and that its lease was renewed at some point — at most once a
  month, and possibly a month ago. Not who is in it, not how many, and not when
  it was last read in.
- **It is a trade, not a pure win.** A room that would once have been deleted
  the moment its last participant left now stands for up to 46 days with its
  book title and page in it. What goes is a live record of the people in the
  room; what stays longer is an anonymous husk. Replacing a code for a book
  leaves the old room behind the same way.
- **The reaper is now the only thing that deletes a room** — but not the only
  thing that ages one. The lease is a wall clock: it expires whether or not the
  job runs, and every client refuses an expired code and deletes the room when
  it meets one. A stopped reaper therefore means clutter, not rooms that stay
  joinable forever.
- „Der Raum wurde geschlossen." effectively no longer fires during a session.
  Nothing but the reaper removes a room node now, so the handler remains as the
  answer to a room that expired under a session left open for weeks.
- The timestamp that remains is not a blurred time but a *rare exact* one: one
  minute per room per month, with no way to tell whether the room has been read
  in since. Losing the last of it would cost more than it is worth — see the
  alternatives below.
- Anyone who can poll the room continuously still sees `page` change in real
  time, whatever the room stores about time. This design narrows what a single
  later look reveals, which is the thing it can actually narrow.
- **The transition is bounded but not empty.** An old client carries a 30-day
  TTL and deletes any room whose timestamp is older than that. A room only
  reaches such an age 30 days after this ships, and only while nobody has turned
  a page in it since — so the risk is an old client, itself unopened for 30 days,
  meeting a room in exactly that window. Per the project's standing position on
  backwards compatibility, that is accepted rather than engineered around.

### Alternatives considered

**A countdown instead of a timestamp.** A room could carry a counter of
remaining reaper runs, topped up while it is in use and decremented by the job —
no wall-clock in the room at all. It was built and rejected here. Once `members`
is gone the reaper is already the only path that deletes a room; a counter makes
it also the only thing that *ages* one, and the two failure modes stack. If the
scheduled workflow stops (an expired service-account key, a changed secret),
every room stays joinable forever and nothing surfaces it, where an expired lease
is refused by every client on sight. The gain would be one exact minute per room
per month, and the price included a two-branch transition for old clients still
writing timestamps, along with conditional deletes to keep the job from removing
a room that had just been renewed.

**Rounding the timestamp to a day.** ADR 26's objection — that `== now` would
have to become a range — is weaker than it looks: `<= now` still forbids
forward-dating, so no client could write itself an immortal room, and
back-dating only shortens a room's own life. The real cost is elsewhere: the
client would have to round its own clock, and a device running fast would have
its page writes rejected near midnight, silently breaking the page exchange. Not
worth it for one minute a month.

**Counting participants instead of naming them.** A number in place of the id
set still says how many devices are in the room, still has to be maintained on
both sides, and still breaks on the case that motivated all of this: a device
that simply never leaves.

**Deleting the room whenever someone disconnects.** That is exactly the
behaviour ADR 7 was written to end (issue #50): one person stepping away tears
down everyone else's session.
