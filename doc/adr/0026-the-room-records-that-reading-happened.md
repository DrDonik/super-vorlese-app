# 26. The room records that reading happened, not who read when

Date: 2026-08-18

## Status

Accepted

Amends [ADR 7](0007-presence-based-room-lifetime.md) and overrides the
"deferred" framing of live presence in [ADR 19](0019-shared-reading-starts-in-the-library.md).

## Context

Reading a book alone touches no network at all: books live in IndexedDB and
nothing leaves the device. Reading *together* creates a room in the Realtime
Database (`rooms/$code`), and that room accumulated more than the shared page:

- `page`, `senderId`, `updatedAt` — the page exchange
- `book` — hash, type, page count, and the **title**
- `members/$memberId` — one entry per device that has the sync set up, valued
  with a server timestamp
- `pointers/$id`, `mood/*` — transient, wiped by design
- `signal/$peerId` — the WebRTC handshake for sending a book to a joiner

The people who can read a room are the people who were in it: a room is only
reachable through its six-character code, spoken over the call, and the database
root denies listing. So this is not a decision about attackers. It is about what
the app quietly makes legible *between* the participants — a grandparent, a
parent, a child — and about what lingers after everyone has gone.

Three things were wrong by that measure:

- **`senderId` plus `updatedAt` says "device A turned a page yesterday at
  20:14".** `senderId` held the same identifier as the member entry, which is
  persisted in `localStorage` and reused on every reconnect — so "device A" was
  the same device weeks later. Nothing displays this, but anyone holding the
  code can read it.
- **The member timestamp is a record nothing needs.** `leaveRoom` only asks
  whether any member is left, and the reaper works off the room's own
  `updatedAt`. The value said "this device last opened the book at …" and was
  read by no one.
- **An abandoned handshake leaves IP addresses behind.** `receiveBook` removes
  its `signal` subtree on success and on failure, but not when the tab is killed
  or the battery dies. What stays is SDP and ICE candidates — with Google's STUN
  servers configured, that includes the public IP address of both households.
  Unlike a random id, an IP address is stable across rooms, books and months, and
  it locates a household. It could sit there for the room's full 30-day life.

The trigger for looking was a product proposal: a **live presence marker** —
"Oma ist bei ‚Grüffelo'", so the library could offer a one-tap join with no code
at all. ADR 19 had listed it as an alternative "not pursued" for build-order
reasons. Living with the idea made a different objection decisive: it would make
one household's activity continuously legible to the other. "The child was still
in the book at half past ten" is a fact that reading together over a call has
never produced, and it cannot be taken back once people rely on it.

## Decision

**A room may show that it was read in. It may not show who read, or when they
last did.**

- **No presence marker**, now or as a stepping stone to code-free joining. This
  is a rejection, not a deferral; ADR 19's alternatives section is superseded on
  this point. The dialog it described stays the way a session starts.

- **Two identifiers, with different lifetimes.**
  - `memberId` — durable, persisted with the saved room code, reused on
    reconnect, and drawn **fresh per book**. It keys `members`, and (unchanged)
    `pointers` and `mood`. It has to be stable: a new id per app start would
    leave an entry nobody ever removes, and the room would never be deleted.
    Because it is per book, two books mean two rooms with two unrelated ids —
    the database does not show that one device holds both.
  - `senderId` — drawn fresh per app run, never stored. Its only job is the echo
    test in `listen()`: *was that page write my own?* A value that outlives the
    run answers that no better.

- **`members/$id` is `true`.** The key is the whole content; the value carries no
  time, and the database rule permits exactly that value (plus, for the
  changeover, the number an old client still writes). *(Moot since
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): the member set is gone, and
  its rule was removed once no old client was left.)*

- **Joining reuses the membership this device already holds**, or leaves the old
  room first if the code differs. The library's join path reaches `joinRoom()`
  without passing `reconnect()`, so a fresh id used to be saved over the stored
  one — stranding an entry that no „Trennen" could ever remove and that kept its
  room alive until the reaper. That predates this decision, but a decision about
  who is recorded in a room has to make sure each device is recorded once.

- **The handshake is removed even when the joiner vanishes.** `receiveBook`
  registers an `onDisconnect().remove()` on its `signal` subtree before
  publishing the offer, and cancels it in `teardown()`. The holder writes its
  answer and candidates *into the joiner's subtree*, so one registration clears
  both sides. This mirrors the pointers, which have always been tied to the live
  connection ([ADR 10](0010-remote-pointer-presence.md)).

What deliberately stays:

- **`updatedAt`** on the room. The reaper needs it for the 30-day sweep and the
  client uses it to treat an ancient code as gone. It says "this room saw
  activity", naming no device, and coarsening it would buy little at the price of
  a weaker database rule (`newData.val() == now` would have to become a range).
  *(Revised by [ADR 27](0027-a-room-holds-a-lease-not-a-log.md): rewritten on
  every page turn, it also said at what hour of which evening. It is now renewed
  at most once a month, which leaves the rule exactly as strict — the objection
  above was to rounding a timestamp, not to writing one rarely.)*
- **`book.title`** in the clear. The library needs it to say whose book is
  arriving before it has been transferred ([ADR 5](0005-webrtc-book-transfer.md)).
  Removing it is a separate decision about the joining flow, not a side effect of
  this one.
- **`pointers` and `mood`** keyed by `memberId`. Both are wiped by design — the
  pointer by `onDisconnect`, the mood node per ritual — so neither accumulates a
  history. Re-keying `mood` per run would also break the participant count
  ([issue #82](https://github.com/DrDonik/super-vorlese-app/issues/82)) when a
  device restarts mid-ritual. *(Since
  [ADR 27](0027-a-room-holds-a-lease-not-a-log.md) that count is the only reason
  `memberId` is durable at all.)*

## Consequences

- What a room can still tell someone who has the code: that it exists, which
  book it is for, how many devices have the sync set up, and when a page was last
  turned in it. Not which of them did it, and not when a given device last
  opened the book. This is not anonymity towards the other reader, and is not
  meant to be — they were there.
- **Opening a synced book now always adopts the room's page.** A device used to
  recognise its own last write and stay on its locally remembered page; with a
  fresh `senderId` each run, that write reads as someone else's. In practice the
  two pages are identical — whoever turns a page writes both. Where they differ,
  the shared page is the better answer.
- The member rule accepts a boolean *or* a number. Rules are published before the
  app ([ADR 6](0006-automate-database-rules-deploy.md)) and an installed iOS web
  app picks up a new build only when it next comes to the foreground
  ([ADR 11](0011-ios-pwa-auto-update.md)), so for a while old clients keep
  writing timestamps. A rule that rejected them would make `enrollMember()` fail
  silently, drop that device out of the member set, and let the partner's
  „Trennen" delete the room out from under a running session. The tolerance can
  be narrowed to `isBoolean()` once no old client is left. *(It was never
  narrowed: [ADR 27](0027-a-room-holds-a-lease-not-a-log.md) dropped the member
  set altogether, and on 2026-09-01 the whole `members` rule went with it.)*
- ADR 7's "Stable member id" paragraph is amended: the id no longer doubles as
  the page-exchange `senderId`, and the member value is no longer a timestamp.
  Its actual decision — durable membership, no `onDisconnect`, last one out
  deletes the room — is untouched.
- A new device identifier must now be justified before it is introduced: durable
  and shared is the exception, per-run is the default.
