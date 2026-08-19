# 7. Keep a sync room alive as long as anyone has it set up

Date: 2026-05-31

## Status

Accepted

## Context

A sync room (`rooms/$roomCode` in the Realtime Database) used to be owned by its
**creator**. When the creator explicitly disconnected ("Trennen") or removed the
book, the whole room node was deleted, so every other participant immediately
got "Der Raum wurde geschlossen." — even if they were still reading. Non-creators
leaving only detached locally and never affected the room. Tying the room's
lifetime to one person is the wrong model: the creator stepping away should not
tear down everyone else's session (see issue #50, and it becomes more disruptive
once 3+ reading circles are supported, issue #49).

We want a room to stay active as long as **at least one participant still has the
sync set up** in their app — so that someone can close the app and reopen the
book the next day or next week and the sync is still there — and to be cleaned up
only once everyone has genuinely left.

A natural reflex is to use RTDB's `onDisconnect()` live-presence handlers, so a
member is removed the moment their socket drops. We deliberately **rejected**
that: the intended usage is intermittent (a nightly bedtime read), so a dropped
connection — a closed tab, a backgrounded app, a flaky network — must *not* count
as leaving. Membership has to be durable across disconnects, not a live-socket
signal.

## Decision

Track a room's participants in a durable `members` subtree and delete the room
only when the last participant **explicitly** leaves.

- **Member set.** Each room carries `rooms/$roomCode/members/$memberId`, written
  when a participant creates, joins, or reconnects. The value is a server
  timestamp, validated by the database rules. *(Amended by
  [ADR 26](0026-the-room-records-that-reading-happened.md): the value is now
  `true`. Nothing ever read it, and a per-device timestamp recorded when someone
  last opened the book. Removed entirely by
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): the set was a standing record
  of the room's participants, bought for a deletion that in practice never
  happened.)*
- **Durable, not live.** There is no `onDisconnect()` handler. Closing the app,
  losing the network, or backgrounding leaves the member entry in place, so the
  participant rejoins the still-alive room on their next reconnect via the saved
  room code.
- **Stable member id.** The id is persisted alongside the saved room code in
  `localStorage` and reused on reconnect (it also serves as the page-exchange
  `senderId`), so reconnecting refreshes the same membership instead of
  orphaning it under a fresh random id. *(Amended by
  [ADR 26](0026-the-room-records-that-reading-happened.md): the page exchange
  now carries its own per-run id. Amended again by
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): with the member set gone, the
  id is kept durable only for the mood ritual's participant count.)*
- **Last one out cleans up.** *(Removed by
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): disconnecting is now purely
  local and every room ends with its lease.)* Only an explicit disconnect —
  tapping "Trennen" or deleting the book — removes that device's member entry. If the member set is
  then empty, that same client deletes the whole room node. A lone creator who
  disconnects is the last member, so the room is removed immediately, exactly as
  before.
- **"Der Raum wurde geschlossen." only when truly gone.** Removing one member
  leaves `page`/`senderId`/`updatedAt` intact, so other participants' listeners
  still see a non-null room and the closed-room message does not fire. It fires
  only when the room node itself disappears — i.e. the last participant left.
- **TTL unchanged.** *(Superseded by
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): the TTL is 45 days, the
  timestamp is a lease rather than a record of the last page turn, and the reaper
  is no longer a safety net but the only way a room ends.)* The 30-day
  `updatedAt` TTL and the server-side reaper
  (`scripts/reap-stale-rooms.mjs`) remain the safety net for rooms abandoned
  without a clean disconnect (everyone closed the app, or a device lost its saved
  state and so never removed its member entry).

## Consequences

- The creator leaving no longer ends the session for everyone; the room lives as
  long as anyone still has it set up.
- No new infrastructure or billing: the member set is a few small timestamps in
  the existing room node, and signalling/page paths are untouched. *(Amended by
  [ADR 26](0026-the-room-records-that-reading-happened.md): the entries hold
  `true` rather than timestamps, the page path carries its own per-run id, and
  the signalling subtree gained an `onDisconnect` cleanup. The point of this
  bullet — that membership costs no new infrastructure — still holds.)*
- A room with no page activity for 30+ days is still reaped even if a member is
  nominally enrolled. The intended "next day / next week" usage is well within
  that window, and the TTL is the deliberate backstop against rooms that would
  otherwise linger forever (e.g. a ghost member from a wiped device).
- Simultaneous explicit leaves are harmless: in the rare case two leavers each
  still see the other in the set, neither deletes the room and it is simply
  reaped later — strictly safer than deleting a room out from under an active
  reader.
- **Serving a missing book is still gated on the creator.** The WebRTC
  book-transfer (ADR 0005) only streams while the creator's session is open. If
  the creator leaves but the room persists, a *new* joiner who lacks the book can
  no longer fetch it. The transfer only matters at join time, so this is
  accepted for now and tracked separately (related to issue #49).
- Rooms created before this change carry no `members` subtree. A participant on
  the new code who joins or reconnects enrolls itself; a leaver that finds no
  member id of its own defers cleanup of such a legacy room to the reaper rather
  than risk deleting it out from under an older client.
