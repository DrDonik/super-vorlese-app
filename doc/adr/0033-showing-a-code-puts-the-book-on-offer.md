# 33. Showing a Synchronisations-Code puts the book on offer for the rest of the app run

Date: 2026-08-25

## Status

Accepted

## Context

The peer-to-peer book transfer ([ADR 5](0005-webrtc-book-transfer.md),
[ADR 9](0009-per-peer-book-transfer.md)) has a holder side, `serveBook()`, that
answers joiners who arrive under the room's `signal` node. Until now it was
started and stopped by the reader: `showSyncActive()` started it, and leaving the
view or ending the session stopped it. A book could therefore only be sent while
its holder was sitting in the reader with it open.

That is not where the code always is. [ADR 20](0020-disconnecting-lives-in-the-book-edit-dialog.md)
moved „Synchronisation trennen" into „Buch bearbeiten" and put the
Synchronisations-Code on that screen beside it, so the person giving the code up
can see which one they are giving up. But a code on screen is a code that gets
read out — and read out from there, it did not work. The grandparent taps the
pencil, reads the six characters over the video call, and the grandchild's device
answers with „Dein Lesepartner muss online und im Buch sein". The device that
caused the failure shows nothing at all (issue #175).

The same hole is reachable without the dialog: read the code out in the reader,
then walk back to the shelf while the partner is still hunting for the app, and
the transfer dies mid-flight.

Three ways out were considered.

- **Offer every coded book while the app runs.** Honest and simple, and it makes
  the precondition just "the app is open". But it puts books on offer with no act
  of the user behind it — a book is offered because it once had a code, not
  because anybody is sharing it tonight. (The cost is not performance: RTDB
  multiplexes every listener over one socket, and an idle `onChildAdded` on a
  room nobody writes to costs nothing.)
- **Drop the code from „Buch bearbeiten".** Removes the inconsistency by making
  the app poorer — one would give up a synchronisation without seeing which — and
  leaves the "walked back to the shelf" hole open.
- **Tie the offer to showing the code**, which is what this ADR does.

A time limit on the offer (ten minutes from the last time the code was shown) was
considered and rejected. It saves one idle listener and buys an invisible clock:
the partner's call drops, a parent has to help find the app, twelve minutes pass,
and the transfer fails while the sender's screen looks exactly as it did before.
For a layperson that becomes "but it worked yesterday" — a fault nobody can
reproduce because nothing on screen refers to it (rules 5 and 7). The app run is
the bound instead: the user can see it and can end it.

## Decision

**Showing a book's Synchronisations-Code puts that book on offer, and the offer
stands until the app closes.**

Showing the code is the act of giving it away — it is read out over the call and
typed a minute later. So the two screens that show one, the reader's sync panel
and „Buch bearbeiten", are what start the offer, and they are the only ones: a
device whose books are never read together never offers anything.

- `startServing` / `stopServing` (`src/transfer.js`) keep **one `serveBook()` per
  room code**. Keyed by code, not by book, because the same code is now announced
  from two places and two servers on one device would both answer the same
  joiner, racing to write its one `signal/<peerId>/answer` node.
- `offerBook(bookId, roomCode)` (`src/offer.js`) is the policy in one place, used
  by `showSyncActive()` and by the library's pencil. It is fire-and-forget: a
  book that cannot be offered must not hold up the screen that showed the code.
- The reader no longer owns the server. Leaving the view, and even destroying it,
  leaves the offer standing — that is the point.
- **„Synchronisation trennen" withdraws it**, through `closeSyncForBook()`, which
  reads the saved code before dropping it. Deleting a book leaves through the
  same door. Anything else would let a partner keep pulling a book that is no
  longer shared.
- `showSyncActive()` counts as showing the code even when the panel is still
  folded away, which is how a reconnected book reaches it. That case is the
  common one — the code was exchanged last week and the partner is joining from
  the shelf today — and gating on the panel actually being open would have broken
  it.

**A second decision rides along: a saved code whose room is gone is forgotten at
startup.** `pruneDeadRooms()` (`src/sync.js`) reads each saved room once per app
run and drops the local entry for any that no longer exists or has outlived its
lease. „Buch bearbeiten" then shows neither the code nor „Synchronisation
trennen" for it — the section simply is not there, exactly as for a book that
never had a code ([ADR 20](0020-disconnecting-lives-in-the-book-edit-dialog.md)'s
rule against an empty rubric). Reading a dead code out is the same failure as the
one above, one step later.

It is deliberately **read-only against the database**, unlike `lookupRoom()` and
`reconnect()`, which delete the expired node they stumble over: those hang off
something the user did, while this runs unbidden at every start, and starting the
app should write to no room at all. The node is the reaper's to remove anyway,
with the day of grace [ADR 27](0027-a-room-holds-a-lease-not-a-log.md) gives it.
A read that fails changes nothing — being offline is not the end of a
synchronisation, and a code is given up on a definite answer only.

## Consequences

- The gap between the two screens that show a code is closed: the code in „Buch
  bearbeiten" now does what the one in the reader does. Nothing about either
  screen changes visually, which is the point — they were already telling the
  truth about what they show.
- The sender may leave the reader, browse the shelf, or open another book while
  the partner types; the transfer survives all of it.
- A book can be on offer with no reader open anywhere, so the offer is no longer
  something a view owns. `closeSyncForBook()` is the single place that withdraws
  one, which is also why deleting a book already did the right thing.
- Opening „Buch bearbeiten" to rename a book or add a tag offers that book for
  the rest of the session as a side effect. This is deliberate and harmless: only
  someone already holding the six-character code can pull anything, and the room
  behind it exists for 45 days regardless. What widens is the window, not the
  reach.
- Nothing here renews a room's lease. `updatedAt` is written only by
  `createRoom()` and by `sendPage()` when the lease is due (ADR 27); serving,
  receiving and pruning all stay clear of it, and the database rule pinning it to
  `now` would refuse anything else.
- The app loads Firebase at startup for anyone who has at least one saved code,
  where before it waited for the first sync action. It is kicked off after the
  shelf is on screen, and the shelf itself still owes the network nothing; a user
  with no codes never triggers it.
- A device that is relaunched and goes straight to the shelf offers nothing until
  a code is shown once. The partner's failure message names what to do about it:
  the Lesepartner has to have the app open and the book opened.
