# 34. The book takes the whole screen, on touch devices and in a browser tab

Date: 2026-08-25

## Status

Accepted

## Context

Everything this app does about the size of a page assumes it has the screen to
itself. `display: standalone` in the manifest, `apple-mobile-web-app-capable` in
`index.html`, the `@media (display-mode: standalone)` block at the foot of
`style.css` that corrects the height to `100vh` so an iPad's 3:4 page sits
edge to edge (#178, #180, #181) — all of it describes the app installed on the
home screen. `debug-viewport.js` even justifies its five-tap switch by saying
that an installed web app has no address bar to put one in.

Opened in a browser tab, none of that holds. The address bar and the tab bar
take the top of the screen, and the cost is worse than the strip they occupy:
with the screen shortened, the page is fitted by height instead of width and
loses margin at the sides too. A book in a tab is visibly smaller than the same
book installed, on both counts.

Installing is the complete answer and stays the recommended one — it is
permanent, it survives a reload, and it brings Dynamic Type and the height
correction with it. But it is a step somebody has to take once, and the person
who most needs the large page is the least likely to have taken it. Issue #183
asks what can be done for the tab.

The Fullscreen API is the only thing that can be. Its support is not in
question: unprefixed in Safari since 16.4 on iPadOS and macOS, on iPhone since
iOS 17.4, and long-standing in Chrome, Edge and Firefox. Its terms are:

- **It needs a user gesture.** It cannot be set on load, and it cannot be
  restored after an await that outlives the activation.
- **It does not survive a reload.** It is a thing done, not a setting held.
- **The browser owns the way out** — a swipe down, `Esc` — and announces it
  itself, so reversal (rule 6) is covered without the app spending anything on
  it.
- **On iOS a text field ends it.** Focusing a text-entry element exits the
  fullscreen session; in this reader the Synchronisations-Code and the page-jump
  field both do.

## Decision

**The reader asks for the full screen on touch devices in a browser tab. The
library never does, and neither does anything installed.**

**Touch only.** `(hover: none) and (pointer: coarse)` — the exact complement of
the mouse test already in `reader.js`. A desktop browser is excluded on purpose,
and not for lack of support: it has had its own fullscreen on F11 (⌃⌘F) for
twenty years, its window is big to start with, and swallowing the whole screen
there would tear away the video call the reading runs on. That call is the
premise of the app; nothing in the app may cover it. On a phone or a tablet none
of those objections exist — the browser is the whole screen there already, and
its bars are pure loss. A laptop with a touchscreen reports `hover: hover` and
stays out.

**The reader, not the library.** The shelf is an adult surface
([ADR 18](0018-library-is-an-adult-surface.md)): the address bar, the other tabs
and the way back out belong to it. The book is the surface that should look like
a book. So the request rides on the tap that opens a book and is given back in
`destroy()` — which covers „← Bibliothek", the closing overlay, and any other
change of view.

**No control, anywhere.** The state is the view: a book means full screen, the
shelf means bars. A button in the chrome would have to be assigned one of the
three waits of [ADR 30](0030-the-chrome-serves-one-intention.md), would sit
unused on the desktop and installed, and could never even show its own state
(the browser's own F11 fullscreen is invisible to `:fullscreen` and to
`document.fullscreenElement`, so a toggle would lie whenever it mattered).

**The root element is what goes fullscreen**, not `.reader`. An overlay outside
the fullscreen element is not painted at all, and the dialogs, the sync panel
and the mood ritual all hang at the top of the document. The root is also the
one element the Fullscreen API's own stylesheet leaves untouched, so no layout
rule changes: the page just gets the pixels the bars had. This is why the change
needs no CSS.

**Asking again is modelled on the wake lock** ([ADR 25](0025-screen-stays-awake-while-reading.md)),
but on `touchend` alone rather than its pair. The wake lock also listens on
`pointerdown` because that is what grants the activation for a *mouse*, and this
never runs where there is one; on a touch device `pointerdown` is precisely the
event that grants nothing. Asking on it would spend the attempt on a certain
rejection and could leave the request that follows on `touchend` with nothing to
do. The retry covers the two cases where the opening gesture is not enough — a
book that arrived over a WebRTC transfer, where the activation expired minutes
ago, and iOS ending the session when a text field takes the focus.

**An exit this app asked for is not evidence about anybody.** `leaveFullscreen()`
clears the session before `exitFullscreen()` reports back, and the reader reaches
itself directly — the sync panel's „Verbinden" goes through `openRoom()` straight
back into `showReader()`, so one book's `destroy()` and the next one's `render()`
run in the same task. The `fullscreenchange` for the first book's exit then
arrives inside the second book's session, and read as a person's decision it
would lock that second book out of the screen it just asked for. So exits this
module causes are counted and discounted; only what is left over is somebody's
choice.

**A person who leaves stays out.** The retry above would otherwise drag someone
back in on their next tap, which is precisely rule 7's surprise. A hand-made
exit and a platform-made exit arrive as the same `fullscreenchange`, so they are
told apart by *when* it fires: the platform's exit is the answer to a focus
event and follows it within a frame or two, while a swipe comes whenever the
reader decides. Only an exit that both finds a text field in the focus and
arrives within half a second of that field taking it counts as the platform's;
everything else is a person, and the book stops asking until it is next opened.

The focus alone is deliberately not enough, and the difference is not
hypothetical: a keyboard stands for as long as somebody is typing a
Synchronisations-Code, and on Android — inside the same touch gate — focusing a
field does not end the session at all, so the field holds the focus through a
swipe that was entirely deliberate. Reading the focus as a verdict rather than
as one half of a coincidence would have re-entered the fullscreen on that
person's next tap.

Every failure is silent, as with the wake lock. A book with the browser's bars
above it is the book exactly as it stood before.

## Consequences

- In a browser tab on an iPad, a book opened from the shelf now fills the screen
  the way the installed app does, and „← Bibliothek" hands it back.
- **Installing remains the better answer** and this does not replace it: the
  full screen lasts one reading and has to be won again after every reload, and
  it does not bring Dynamic Type or the standalone height correction with it.
- **A joined book gets there one tap late.** Opening from a Synchronisations-Code
  that needs a transfer has no activation left when the reader appears, so the
  first page is briefly framed by the bars and the first touch clears them —
  the same one-tap delay the wake lock already has, for the same reason.
- **On an iPad with a keyboard attached, `Esc` is spent on leaving the
  fullscreen** instead of closing the help or the page-jump field, and the
  second press then does the closing. Keyboard-only operation is explicitly not
  this app's audience ([ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md)),
  and the touch path is unaffected.
- **The desktop is answered, not served.** F11 or ⌃⌘F does it for one session,
  and „App installieren" / „Zum Dock hinzufügen" does it permanently in Chrome,
  Edge and Safari. Firefox offers only the first. None of that is the app's code
  to write.
- A fourth thing now hangs on the tap that opens a book, alongside the wake lock
  and the loading of the book itself. The rule that governs all of them is
  unchanged and now stated in two places: nothing may be awaited above it.
