# 27. A room's lifetime is a countdown, not a clock

Date: 2026-08-18

## Status

Accepted

Revises [ADR 26](0026-the-room-records-that-reading-happened.md) on one point:
new rooms no longer write `updatedAt`. Rooms from before this keep theirs for
the length of the transition, and it still protects them.

## Context

[ADR 26](0026-the-room-records-that-reading-happened.md) took the device
identity out of the room: after it, nobody holding the code can tell *who*
turned a page. One thing was deliberately left standing — `updatedAt`, the
server timestamp written on every page turn — because the reaper
(`scripts/reap-stale-rooms.mjs`) needs to know when a room fell out of use, and
the timestamp names no device.

It still names an evening. „In diesem Raum wurde am 17.08. um 20:14 gelesen" is
the reading household's bedtime routine, at the precision of a minute, refreshed
with every page. The people who can read it were there — but the room does not
need to keep telling them, night after night, at what hour the child was still
awake.

Coarsening the timestamp was considered in ADR 26 and rejected, for a reason
that was about the *rule*, not the idea: `updatedAt` is validated with
`newData.val() == now`, and rounding would have meant relaxing that into a
range, which permits back- and forward-dating. The objection dissolves if the
field stops being a time at all.

## Decision

**A room carries a life counter instead of a timestamp.** It says how many
reaper runs of grace are left, and nothing about when anyone read.

- **The client sets it.** A new room starts at `ROOM_LIFE_MAX` (30). The room
  listener already receives the current value on every change, so the client
  tops it back up to 30 — with a plain `set`, since every client would write the
  same number — when it sees it **below `ROOM_LIFE_REFRESH_BELOW` (24)**. Being
  in the room is what keeps it alive; no extra read, and a room read in nightly
  is written to about once a week rather than every evening.
- **The reaper counts it down**, once per daily run, with the server-side
  `increment(-1)` so a top-up landing between its read and its write cannot be
  overwritten. Deletions and decrements travel in the one multi-path update the
  job already used.
- **Zero is a resting state, not a moment inside the job.** A run only ever
  counts a positive counter down; the room is deleted on the *next* run, once
  zero has stood for a day. A *counting* client cannot have renewed it in
  between: a room this branch would delete reads as over to every such client,
  so none of them writes to it. The cost is one extra day of life, which is
  noise next to thirty.
- **Every deletion is checked against a fresh read.** An *old* client knows
  nothing of the counter and may write its timestamp at any moment, including
  after the job listed the rooms. So each condemned room is read once more, the
  same rule is applied to that fresh state, and only then is it deleted;
  anything that changed is left for the next run. The delete also carries
  `If-Match`, which makes it atomic where the database honours the ETag — but
  the re-read is what this rests on, since it holds regardless (the local
  emulator, for one, does not change its ETag when a field is added).
- **Renewal and admission ask the same question.** A spent counter beside a
  fresh legacy timestamp is a room a current client may join — so it is one it
  must also top up. The earlier "never touch a zero" rule would have let such a
  room die under a client that was reading in it, the moment the old client
  stopped writing.
- **The database rule caps the value** at 30 and forbids negatives, so no client
  can write itself an immortal room.
- **`updatedAt` is gone** from new rooms — not written, not required by the
  room's shape rule.

**Old clients keep working, and keep their rooms.** A client from before this
change writes `updatedAt` and never touches the counter, so its room would
otherwise count down to zero while it is being read in every night. The reaper
therefore deletes a counted room only when the counter is spent **and** the room
carries no fresh timestamp; a spent counter with a fresh timestamp is held at
zero instead. Rooms with no counter at all expire by their timestamp exactly as
before. Both branches live in `planReap()` and the timestamp half can go once no
old client is left.

`ROOM_TTL_MS` therefore stays, as the meaning of "fresh" for that check and for
the client's own reading of a legacy room.

## Consequences

- What a room still tells whoever holds the code: which book it is for, how many
  devices have it set up, the current page — and how much grace is left. That is
  *not* a measure of when it was last read in: a room read every night sits near
  30, because the top-up only happens below 24. At most it says that nobody has
  been there for the last few runs. Not the hour, not the device.
- **The reaper becomes load-bearing.** A wall-clock TTL ages by itself even when
  the job is broken; a counter does not. If the scheduled workflow stops running
  (an expired service-account key, a changed secret), rooms stop ageing entirely
  and nothing surfaces it. This is the real price of the design, accepted for a
  personal app whose room store is a few kilobytes.
- Anyone polling the room daily still sees each top-up and can rebuild a rough
  activity log. The counter narrows what a single look reveals, not what
  sustained watching does — no scheme that expires rooms can, since expiry has
  to be refreshed by use.
- The reaper's decision moved into an exported pure function, `planReap(rooms,
  now)`, and the file only talks to the database when it is run as the job. That
  is what makes the transition rules testable without a database, which is how
  they were tested. The delete takes its request function as an argument for the
  same reason, so it can be driven against an emulator.
- Two things about testing this against the local emulator, both learned the
  hard way: its REST endpoint *is* subject to the rules in a namespace that has
  them, so a simulated old client must write `{".sv": "timestamp"}` rather than
  a client-side `Date.now()`, which `updatedAt`'s `== now` rule rejects; and its
  ETag does not change when a field is added, so a conditional write cannot be
  verified there.
- New rooms and old rooms coexist without migration: the counter is seeded on
  the first top-up from a current client, which is the moment a legacy room
  stops depending on its timestamp.

### Alternatives considered

**A retry loop around the conditional delete.** On a 412 the job could re-read
and try again until it wins. It does not need to: a room it decides to spare
will simply be judged again on the next run, a day later, and nothing is lost
by waiting. A loop would add a failure mode (when to give up) for no gain.

**Leaving deletion unconditional and relying on the resting zero alone.** That
covers counting clients, which stop writing to a spent room, but not the old
ones, which keep writing timestamps until they are gone. The re-read costs one
request on the rare day a room is deleted.
