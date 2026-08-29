// Keeps the screen awake while a book is open (ADR 25).
//
// The devices this app runs on — an iPad propped against a pillow, a phone on
// the kitchen table — put the display to sleep after 30 seconds to two minutes
// without a touch, and this reading is built so that nobody has to touch
// anything: the listening child has page navigation off (ADR 14) and touches
// nothing at all, and a page that is talked about outlasts the timeout easily.
// So the reader holds a screen wake lock for as long as a book is open.
//
// Two things make this less trivial than the single API call it looks like:
//
// - **The request needs the tap that opened the book.** WebKit grants a wake
//   lock only while the document holds transient activation, and the installed
//   iOS web app is the platform this matters on. So the request has to be
//   issued in the same task as the tap on the cover — before the book is
//   loaded, not after. keepAwake() is called at the very top of the reader's
//   render() and reaches navigator.wakeLock.request() without awaiting
//   anything on the way; everything below is written to keep it that way.
//
// - **The lock does not survive backgrounding.** The browser releases it
//   whenever the page is hidden — the video call brought to the front, an
//   incoming call, the screen locked by hand — and coming back is not a
//   gesture, so the re-request may be refused. It is retried on the next touch
//   anywhere in the reader, which during a read-aloud arrives at the latest
//   with the next page turn. The same retry covers the book that was opened
//   from a Lese-Code, where a transfer of several megabytes runs
//   between the tap and the reader.
//
// Every failure is silent. A screen that sleeps is what every other app on the
// device does; a message about it would be noise no grandparent can act on.

let sentinel = null;   // the granted lock, while we hold one
let wanted = false;    // is a book open?
let requesting = false; // a request is in flight; don't stack a second one
let listening = false;

function acquire() {
  if (!wanted || sentinel || requesting) return;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  requesting = true;
  // Nothing is awaited before this call, so the caller's user gesture — the tap
  // on the cover, or the touch that turns a page — still counts.
  navigator.wakeLock.request('screen').then((lock) => {
    requesting = false;
    if (!wanted) {
      // The book was closed while the request was in flight.
      lock.release().catch(() => {});
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
    });
  }).catch(() => {
    requesting = false;
  });
}

// Ask for the lock, and keep asking as the app comes back to the foreground.
// Idempotent: safe to call on every touch, and a no-op once the lock is held.
export function keepAwake() {
  wanted = true;
  if (!listening) {
    // Registered once and left in place: acquire() is inert while no book is
    // open, so there is nothing to tear down.
    document.addEventListener('visibilitychange', acquire);
    listening = true;
  }
  acquire();
}

export function letSleep() {
  wanted = false;
  const lock = sentinel;
  sentinel = null;
  lock?.release().catch(() => {});
}
