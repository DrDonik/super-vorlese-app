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
//   `touchend`: the one event that grants the activation on a touch device, and
//   the only kind of device this runs on at all.
//
// - **A text field throws us out.** On iOS, focusing a text-entry element ends
//   the fullscreen session; the Synchronisations-Code and the page-jump field
//   both do it. That exit is the platform's, not a decision, so the next touch
//   puts the book back on the full screen.
//
// Which leaves the one distinction this module has to draw: whoever swiped down
// to leave meant it and must not be dragged back in by their next tap (rule 7).
// Both arrive as the same `fullscreenchange`, so they are told apart by *when*
// it fires. The platform's exit is the answer to a focus event and follows it
// within a frame or two; a swipe comes whenever the reader decides, and a field
// still holding the focus proves nothing on its own — a keyboard stands for as
// long as somebody is typing, and a swipe in the middle of that is a decision
// like any other.
//
// Every failure is silent. A book with the browser's bars above it is the book
// as it stood before this file existed; a message about it would be noise no
// grandparent can act on.

// How long after a text field takes the focus an exit can still be the
// platform's doing. The exit is dispatched in answer to the focus itself, so it
// arrives within a frame or two; a person who focuses a field and then decides
// to swipe the fullscreen away needs the keyboard to finish appearing first and
// is far slower than this.
const PLATFORM_EXIT_AFTER_FOCUS_MS = 500;

let reading = false;    // a book is on screen
let refused = false;    // this reader left the fullscreen by hand — stop asking
let requesting = false; // a request is in flight; don't stack a second one
let listening = false;
let textEntryFocusedAt = 0;  // when a text field last took the focus
let pendingSelfExits = 0;    // exits this module asked for, not yet reported

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

// Every exit this module asks for is counted, because the `fullscreenchange`
// that reports it arrives a task later — by which time a *new* reading can
// already have begun. The reader reaches itself directly (the sync panel's
// „Verbinden" goes through openRoom() straight back into showReader), and there
// destroy() and render() run in the same task: without this count the old
// book's exit would land on the new book's session and be read as a person
// walking out of a fullscreen they never had.
function exitOurselves() {
  pendingSelfExits += 1;
  document.exitFullscreen().catch(() => {
    pendingSelfExits -= 1;
  });
}

function onFocusIn(e) {
  if (reading && isTextEntry(e.target)) textEntryFocusedAt = performance.now();
}

function onFullscreenChange() {
  // Both listeners are registered once and left in place, like the wake lock's
  // visibility listener: they are inert while no book is open, so there is
  // nothing to tear down.
  if (document.fullscreenElement) return;
  if (pendingSelfExits > 0) {
    pendingSelfExits -= 1;
    return;
  }
  if (!reading) return;
  // Who ended it? A field still holding the focus is not evidence on its own —
  // the keyboard can stand for as long as somebody is typing, and a swipe in
  // the middle of that is a decision like any other. What distinguishes the
  // platform's exit is that it *follows the focus*: it is the answer to the
  // focus event, not to anything the reader did afterwards.
  const causedByFocus = isTextEntry(document.activeElement)
    && performance.now() - textEntryFocusedAt < PLATFORM_EXIT_AFTER_FOCUS_MS;
  if (!causedByFocus) refused = true;
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
    if (!reading) exitOurselves();
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
    textEntryFocusedAt = 0;
    if (!listening) {
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('focusin', onFocusIn);
      listening = true;
    }
  }
  enter();
}

export function leaveFullscreen() {
  if (!reading) return;
  reading = false;
  if (document.fullscreenElement) exitOurselves();
}
