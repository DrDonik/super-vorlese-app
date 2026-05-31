# 5. Transfer books peer-to-peer over WebRTC when joining a sync

Date: 2026-05-31

## Status

Accepted

## Context

Until now, syncing required both partners to already hold the same book locally
(books live only in IndexedDB; see the local-first model implied by ADR 0002).
A grandchild who wanted to read a book the grandparent had photographed first
had to receive it out of band (e.g. a shared `.vorlese` file) before they could
join. For the target audience — a 6-year-old and a grandparent on a video call —
that extra step is a real barrier.

We want: when you join a sync from the library for a book you don't have, the
book arrives from your partner automatically, and you land on the same page.

Two sub-problems:

1. **Identity.** The room previously carried only a page number, so any code
   could be joined with any book (you could "sync" Harry Potter against Lord of
   the Rings). To decide "do I already have this book?" we need a stable,
   device-independent identifier.
2. **Transport.** Moving a multi-megabyte book between two devices.

For transport we considered three options:

- **Firebase Realtime Database (base64 chunks):** reuses existing infra but is
  the wrong tool for binary — base64 inflates size by a third, and a few large
  picture books would blow past RTDB's free-tier storage (1 GB) and download
  (10 GB/month) limits.
- **Firebase Storage:** purpose-built and robust (store-and-forward works even
  if the holder later goes offline), but requires enabling the billing-backed
  Blaze plan and managing cleanup of stale files.
- **WebRTC data channel (peer-to-peer):** the book streams directly between
  devices and never touches Firebase, so there is no per-byte cost and no
  storage to clean up.

The product flow keeps both partners online and the app in the foreground at the
same time: they start a video call, put it in picture-in-picture, open the app,
exchange the code, and read. That makes a live peer-to-peer connection viable,
and the no-cost property fits the project's zero-infrastructure ethos.

## Decision

When a partner joins a sync from the library for a book they do not already
have, the book is transferred **peer-to-peer over a WebRTC data channel**, using
Firebase only for signalling (SDP offer/answer and ICE candidates under the
room's `signal` node).

- **Book identity** is a SHA-256 content hash stored in each book's metadata and
  published in the room descriptor (`{ hash, title, pageCount, type }`). The
  joiner compares it against their library: a match opens the local copy with no
  download; otherwise the book is fetched. The hash also lets us reject genuinely
  mismatched joins.
- **Wire format** reuses the existing `.vorlese` bundle (`bundle.js`); the
  received bundle's hash is verified against the descriptor before it is kept.
- **STUN only, no TURN.** A direct connection covers the common case (both on
  home Wi-Fi). On strict/symmetric NATs it may fail; that is treated the same as
  the partner being offline.
- **Offline partner / failed connection:** the transfer fails cleanly with a
  message asking the user to ensure the partner is online and in the book, and
  to try again. Nothing partial is stored.
- The room's page exchange switched from `set` to `update` so paging never
  clobbers the book descriptor or an in-flight handshake.

## Consequences

- Joining for a missing book "just works" while both partners are present —
  no out-of-band file sharing.
- No new billing or backend: book bytes never traverse Firebase; only small
  signalling messages do.
- The "books are strictly local" assumption is relaxed: a book can now arrive
  over the network, though it still lives only in the receiver's IndexedDB
  afterwards as a normal, deletable library entry.
- The feature depends on both partners being online simultaneously and the app
  staying in the foreground; backgrounding mid-transfer (e.g. switching fully to
  the call) can interrupt it. This is acceptable given the intended flow but is
  the main fragility. If it proves painful, Firebase Storage store-and-forward
  is the natural fallback and this ADR should be revisited.
- Rooms created by an app version predating this feature carry no book
  descriptor; joining them from the library prompts the user to have the room
  re-created. The in-reader "join by code" path (for a book you already hold) is
  unaffected.
