// Takes the browser's own bars off the screen while a book is open (ADR 34).
//
// Installed on the home screen the app already has the screen to itself —
// `display: standalone` in the manifest, and the height correction that goes
// with it at the foot of style.css. Opened in a browser tab it does not: the
// address bar and the tab bar sit above the book, and because a 3:4 page is
// then fitted into what is left of a 3:4 screen, it loses margin at the sides
// as well. The Fullscreen API is the only way to win that space back without
// installing, so the reader asks for it and the library does not — the shelf is
// an adult surface (ADR 18) where the address bar and the other tabs are the
// point.
//
// Touch devices only, deliberately. A desktop browser has carried its own
// fullscreen on F11 (⌃⌘F on a Mac) for twenty years, its window is large to
// begin with, and taking over the whole screen there would tear away the video
// call the reading runs on — the one thing this app must never do. A phone or a
// tablet has none of those objections: the browser is the whole screen there
// already, and its bars are pure loss.
//
// Like the wake lock, this cannot simply be switched on:
//
// - **It needs the tap that opened the book.** requestFullscreen() is granted
//   only while the document holds transient activation, so the call sits at the
//   top of the reader's render() beside keepAwake(), before anything is
//   awaited. A book that arrived over a transfer has no gesture left by then —
//   covered by the same re-arm on the next touch that the wake lock uses, on
//   the same two events, for the same reason.
//
// - **A text field throws us out.** On iOS, focusing a text-entry element ends
//   the fullscreen session; the Synchronisations-Code and the page-jump field
//   both do it. That exit is the platform's, not a decision, so the next touch
//   puts the book back on the full screen.
//
// Which leaves the one distinction this module has to draw: whoever swiped down
// to leave meant it and must not be dragged back in by their next tap (rule 7).
// Both arrive as the same `fullscreenchange`, so they are told apart by what
// holds the focus when it fires — a text field means the platform did it,
// anything else means a person did, and then the book stops asking.
//
// Every failure is silent. A book with the browser's bars above it is the book
// as it stood before this file existed; a message about it would be noise no
// grandparent can act on.

let reading = false;    // a book is on screen
let refused = false;    // this reader left the fullscreen by hand — stop asking
let requesting = false; // a request is in flight; don't stack a second one
let listening = false;

// The complement of the mouse test in reader.js: a device that cannot hover and
// points coarsely is a phone or a tablet. A laptop with a touchscreen still
// reports `hover: hover`, so it stays out of this.
function isTouchDevice() {
  return !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
}

// Installed there are no bars to hide, and asking anyway would lay Safari's
// „swipe down to exit" hint over the first page of the book for nothing.
function isInstalled() {
  return !!window.matchMedia?.('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

function isTextEntry(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function onFullscreenChange() {
  // Registered once and left in place, like the wake lock's visibility
  // listener: this is inert while no book is open, so there is nothing to tear
  // down. leaveFullscreen() clears `reading` before it exits, so the change it
  // causes itself lands here and is ignored.
  if (document.fullscreenElement || !reading) return;
  if (!isTextEntry(document.activeElement)) refused = true;
}

function enter() {
  if (!reading || refused || requesting || document.fullscreenElement) return;
  requesting = true;
  // The root element, not the reader: an overlay outside the fullscreen element
  // is not painted at all, and the dialogs, the sync panel and the mood ritual
  // all live at the top of the document. The root is also the one element the
  // Fullscreen API's own stylesheet leaves alone, so nothing about the layout
  // changes — the page simply gets the pixels the bars had.
  //
  // Nothing is awaited before this call, so the caller's gesture still counts.
  document.documentElement.requestFullscreen().then(() => {
    requesting = false;
    // The book was closed while the request was in flight — otherwise the
    // library would inherit a full screen nobody asked it for.
    if (!reading) document.exitFullscreen().catch(() => {});
  }).catch(() => {
    requesting = false;
  });
}

// Ask for the screen, and keep asking on every touch in the reader. Idempotent:
// a no-op once the book has the screen, and inert on every device and every
// mode this does not apply to.
export function keepFullscreen() {
  if (!reading) {
    if (!isTouchDevice() || isInstalled() || !document.fullscreenEnabled) return;
    reading = true;
    refused = false;
    if (!listening) {
      document.addEventListener('fullscreenchange', onFullscreenChange);
      listening = true;
    }
  }
  enter();
}

export function leaveFullscreen() {
  if (!reading) return;
  reading = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
