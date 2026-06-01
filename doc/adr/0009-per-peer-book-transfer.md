# 9. Namespace the WebRTC book transfer per joiner

Date: 2026-06-01

## Status

Accepted

## Context

The peer-to-peer book transfer (ADR 0005) was built for exactly **two**
participants: one joiner pulling the book from one holder. The WebRTC signalling
under `rooms/$roomCode/signal` used three fixed nodes shared by the whole room —
`signal/offer`, `signal/answer`, and a single `signal/ice` list — which assumes
**one handshake per room**.

That assumption breaks the moment two joiners try to receive the book at the same
time (issue #49). With C and D both calling `receiveBook` concurrently:

- Each receiver clears all of `signal/` on start and writes its offer to the
  single `signal/offer` node, so the second clobbers the first.
- The holder's `onValue(signal/offer)` fires for each offer in turn and, in the
  old code, tore down the in-progress connection to start the new one.
- Both receivers push ICE candidates to the one shared `signal/ice` list, which
  the holder filtered only by "not mine" — so it fed *both* receivers' candidates
  into a single peer connection.
- The first receiver to time out removes all of `signal/`, wiping the other's
  in-flight answer and ICE.

Net effect: two simultaneous joiners are likely to leave **both** with no book.

The realistic small-group case that motivates fixing this is a grandparent
reading to two grandchildren in different homes — both children should be able to
open the book at once without being told to join strictly one after the other.
(A classroom of 20 is explicitly **out of scope** here: fanning out one
RTCPeerConnection per joiner from a single phone does not scale to that size and
would need a different model — e.g. uploading the bundle to cloud storage once
and letting joiners download it. Tracked separately.)

Note that the "two holders both answer one joiner" case was **already safe**: it
is a harmless race where the joiner accepts whichever answer arrives first
(guarded by `remoteSet`) and ignores the rest. The genuine corruption is between
two **joiners**, which is what this ADR addresses.

## Decision

Make the handshake **per joiner** instead of per room. Each joiner owns a subtree
`rooms/$roomCode/signal/<peerId>/{offer,answer,ice}`.

- **Receiver.** `receiveBook` writes its offer, reads the answer, and exchanges
  ICE entirely under `signal/<myId>`. On teardown it removes only `signal/<myId>`,
  never the shared `signal/` node, so a sibling joiner's handshake is left intact.
- **Holder.** `serveBook` listens with `onChildAdded` on `signal/` to discover
  each new joiner, then watches that joiner's `offer` and replies under the same
  subtree. It keeps a `Map` of `RTCPeerConnection`s keyed by `peerId` — one per
  joiner — instead of a single `active` connection, so several transfers run in
  parallel. Each peer is closed (and its ICE listener dropped) when its connection
  reaches a terminal `failed`/`closed` state, so the Map doesn't grow over a
  session; `stop()` tears down whatever remains.
- **Multiple holders still race, harmlessly.** When A and B both hold the book and
  C joins, both answer under `signal/<C>` (last write wins on the answer node) and
  both push ICE. C accepts the first answer and ignores the rest; the losing
  holder's connection never completes and is reaped when it reaches `failed`. A and
  B can even end up serving different joiners — a small, welcome load-spreading
  effect.
- **Database rules.** `signal` now validates a `$peerId` wildcard level
  (`/^[a-z0-9]{1,40}$/`) with the existing `offer`/`answer`/`ice` shape nested
  beneath it.

The public API of `receiveBook` / `serveBook` is unchanged, so the callers in
`src/library.js` and `src/reader.js` are untouched.

## Consequences

- Two (or a few) joiners can pull the book simultaneously without corrupting each
  other — the grandparent-with-two-grandchildren case works without choreography.
- The holder now maintains one peer connection per concurrent joiner. For the
  small groups this targets that is cheap; if the holder's uplink is the
  bottleneck, concurrent transfers just take longer rather than failing.
- Holder-side connections are reaped on terminal state, not just on `stop()`.
  `serveBook` closes a peer (and drops its ICE listener) once the connection
  reaches `failed`/`closed` — so a finished transfer, a losing holder's
  never-completing connection when several hold the book, or a joiner that gave up
  and retried under a new id all clean themselves up rather than accumulating in
  the `peers` Map for the life of the session. Pushing toward larger groups would
  still benefit from holders conceding *proactively* (closing as soon as they see
  another holder's answer was accepted, instead of waiting for ICE to fail), but
  that is an optimisation, not a leak.
- Large groups (e.g. a classroom of 20) remain unsupported by design and need a
  different transfer model; this ADR deliberately does not address them.
- Page-turn control is unchanged: anyone in the room can still turn the page. Fine
  for a small reading circle; a "who's driving" notion is left for if and when
  larger groups are tackled.
