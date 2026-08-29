// Putting a book on offer: the policy side of the WebRTC transfer (ADR 33).
//
// Showing a Lese-Code *is* the act of giving it to somebody — it is
// read out over the video call, and the partner types it a moment later. So the
// two screens that show a code, the reader's sync panel and „Buch bearbeiten",
// are exactly the two places that put the book on offer, and they are the only
// ones: a device whose books are never read together never offers anything.
//
// The offer then stands for the rest of the app run. It deliberately does not
// end when the screen that made it goes away: reading the code out and walking
// back to the shelf while the partner is still hunting for the app is the normal
// course of a bedtime story, and it must not cut the transfer off. Taking the
// offer back is „Trennen" (via closeSyncForBook), and otherwise closing the app.

import { getFirebase, getSavedRoomCode } from './sync.js';
import { exportBook } from './bundle.js';
import { startServing } from './transfer.js';

// Fire-and-forget: a book that cannot be offered — no network, Firebase not
// reachable — must not hold up the screen that announced it. The screen's job
// is to show the code, and it has done that either way; the partner's device is
// where a transfer that then fails is reported, with the one instruction that
// helps ("your Lesepartner has to have the app open").
//
// The bundle is fetched by book id rather than through a closure over the view
// that asked, because this outlives that view.
export function offerBook(bookId, roomCode) {
  if (!bookId || !roomCode) return;
  getFirebase()
    .then((fb) => {
      // Checked again on the far side of the wait, and this is not a rare race:
      // „Trennen" and „Buch löschen" both sit in the very dialog whose opening
      // started this offer, and loading Firebase the first time in a run takes
      // long enough to tap one. stopServing() cannot help there —
      // at that moment there is nothing in its map yet — so without this check
      // the offer would come up *after* the withdrawal and quietly go on sharing
      // a book the user just stopped sharing.
      //
      // The saved code is the authority rather than a flag of our own: it is
      // what „this device shares this book" means everywhere else, and every way
      // of giving a book up (disconnecting, deleting, replacing the code with a
      // fresh one) already goes through closeSyncForBook and drops it.
      if (getSavedRoomCode(bookId) !== roomCode) return;
      startServing(fb, roomCode, () => exportBook(bookId));
    })
    .catch(() => {});
}
