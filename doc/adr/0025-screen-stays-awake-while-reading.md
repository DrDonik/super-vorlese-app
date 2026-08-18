# 25. The screen stays awake while a book is open

Date: 2026-08-18

## Status

Accepted

## Context

The app is used in exactly the situation in which a device decides nobody needs
it any more: a book on screen, a video call running beside it, and long stretches
in which the app itself is not touched at all. iPadOS and iOS dim and lock the
display after 30 seconds to two minutes without a touch, and this reading is
built so that touching is *not* required —

- the listening side switches page navigation off ([ADR 14](0014-local-page-navigation-toggle.md))
  and then deliberately touches nothing;
- a picture book page that is talked about, pointed at over the call, and asked
  about outlasts the timeout comfortably;
- the reading grandparent's one touch per page is the only input the app sees.

When the screen sleeps mid-story, nothing in the app can explain it. The child
taps to wake it, may miss and leave the app, and the adult has to talk them back
in over the call — the kind of interruption this audience cannot resolve
unaided. It is a defect no interface element can compensate for, so it is fixed
at the source rather than surfaced.

The Screen Wake Lock API covers this, and is available on the browsers this
project targets (Safari/iOS 16.4 and later; [ADR 4](0004-interactive-color-scheme.md)
already sets the floor at 16.2). It needs a secure context, which the app has —
it is served over HTTPS from GitHub Pages — and its permission policy defaults
to `self`, so the top-level app needs no header of its own. Two properties of
the platform shape the implementation:

- **The first wake lock is granted only on a user gesture.** In the installed
  iOS web app, the request must be made while the document still holds transient
  activation — that is, in the same task as the tap that opened the book, not
  after the book has been loaded. Not every input grants that activation:
  `touchend` always does, `pointerdown` only when the pointer is a mouse, and
  `pointerup` only when it is not. WebKit then treats the permission as *sticky*
  for the lifetime of the document, so once a request has succeeded, later ones
  no longer need a gesture. That makes the **first** successful request the one
  that matters, and every path to it has to be able to reach one.
- **A wake lock does not survive backgrounding.** The browser releases it
  whenever the page is hidden: the video call brought to the front, an incoming
  call, the screen locked by hand. Returning to the app is not a gesture — which
  the sticky permission covers, but only for a document that has held a lock
  before.

## Decision

**The reader holds a screen wake lock for exactly as long as a book is open**,
in `src/wake-lock.js`, with no interface of its own.

- **Requested on the opening tap.** `keepAwake()` is the first statement of
  `ReaderView.render()`, before any `await`, and reaches
  `navigator.wakeLock.request('screen')` without awaiting anything on the way.
  The library's cover button calls `onOpenBook` synchronously, so the tap is
  still the current gesture at that point. Requesting after `getMeta()` and the
  PDF load — seconds on a large book — would arrive too late.

- **Re-armed on the next input**, by capture-phase `touchend` *and*
  `pointerdown` listeners on the reader, which between them cover both a
  touchscreen and a mouse under the activation rules above. `pointerup` would
  cover the touchscreen too, on paper — but the reading stage recognises its
  gestures from touch events and calls `preventDefault` on them, and a pointer
  stream taken over that way can end in `pointercancel` instead. `keepAwake()`
  is inert while a lock is held. This is what carries the two cases the opening
  tap cannot: coming back from the background before any lock was ever granted,
  and a book opened from a Synchronisations-Code, where a WebRTC transfer of
  several megabytes runs between the tap and the reader
  ([ADR 5](0005-webrtc-book-transfer.md)). During a read-aloud such a touch
  arrives at the latest with the next page turn. `visibilitychange` retries as
  well, for the platforms that allow it, so in the common case no touch is
  needed at all.

- **Released when the reader is destroyed** — the back button, the end-of-book
  close, deleting the book, any change of view. The library and the camera do
  not hold a lock: the shelf is browsed with the hands, and photographing pages
  is a continuous, hands-on activity.

- **Every failure is silent.** An unsupported browser, a refused request, a
  revoked lock: nothing is shown. A screen that sleeps is what every other app
  on the device does, and a message about it would be noise no grandparent can
  act on ([ADR 18](0018-library-is-an-adult-surface.md): the measure is whether
  the user can *do* something about what they are told).

- **No setting.** A toggle would ask both readers to predict, before the story,
  whether they are going to touch the screen enough — precisely the kind of
  decision this app takes off its users. The lock lasts only while a book is
  open, which is the same span for which the answer is always "keep it on".

### Alternatives considered

**A hidden looping video**, the pre-Wake-Lock trick for keeping iOS awake. It
works without a gesture, but it burns power decoding video for the whole
evening, occupies the audio session next to a video call, and is a workaround
for browsers older than the ones this project supports.

**Requesting the lock in the library**, so it is always held before a book is
even chosen. The shelf is used with the hands and does not need it, and holding
a lock while the app sits open on the library screen keeps a device awake for a
session that may never start.

## Consequences

- The display stays on for as long as a book is open, and the story is no longer
  interrupted by a screen no one can explain to a six-year-old.
- The device uses more power during a reading session, and a book left open goes
  on holding the screen awake until the reader is closed. Both are bounded by an
  explicit "a book is open on screen", which is a state the user can see.
- Browsers without the API, and requests the platform refuses, simply behave as
  before. Nothing else in the reader depends on the lock.
- New views that show a book (should one ever exist beside `ReaderView`) have to
  call `keepAwake()`/`letSleep()` themselves; the module holds a single global
  lock, so nesting is not a concern.
