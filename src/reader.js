import { getBookFile, getMeta, getPhotoPage, getThumb, updateLastPage, markOpened, ensureContentHash, addCompletion, uid } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';
import { SyncSession, getSessionForBook, closeSyncForBook, getFirebase, lookupRoom } from './sync.js';
import { applyCodeField, bindCodeSubmit } from './code-field.js';
import { serveBook } from './transfer.js';
import { exportBook } from './bundle.js';
import { showAlert, showConfirm } from './dialog.js';
import { moodById, moodIconUrl, moodRevealRowsHTML, moodWitnessRowsHTML, pickMoodBoard, MOOD_PICK_COUNT, MOOD_BOARD_COUNT } from './moods.js';
import { keepAwake, letSleep } from './wake-lock.js';

// The chrome serves one intention at a time and then gets out of the way
// (ADR 30). Two waits, because "I am looking for a control" and "I have just
// used one" are not the same span: the first has to survive an older hand
// finding a 44px target, the second only has to let the button's own change
// register before the page is the whole screen again.
const HIDE_CHROME_AFTER_MS = 4000;
const HIDE_CHROME_AFTER_ACTION_MS = 1500;
const CHROME_REVEAL_BAND_PX = 80;
const CURSOR_IDLE_MS = 2500;

// "Point at the page" (ADR 10) is one gesture with one threshold, whether it is
// a finger or a mouse button being held: the same press means the same thing at
// a laptop as on an iPad (rule 1). Both recognisers below measure against these.
const LONG_PRESS_MS = 700;
const MOVE_CANCEL_PX = 10; // movement before activation aborts the press

// The page-turn zones and swipe can be switched off locally, so a listener can
// rest a hand on the screen (or use the pointer) without flipping pages — only
// the reading partner's synced turns move the page then. Pointing and the
// page-jump indicator stay live regardless. The setting is per-device for all
// books (not per book), and read synchronously from localStorage so the zones
// never flash active for a frame before an async store resolves.
const NAV_ENABLED_KEY = 'nav-zones-enabled';

function loadNavEnabled() {
  try { return localStorage.getItem(NAV_ENABLED_KEY) !== 'false'; } catch { return true; }
}

function saveNavEnabled(enabled) {
  try { localStorage.setItem(NAV_ENABLED_KEY, enabled ? 'true' : 'false'); } catch {}
}
// The loupe's steps (issue #117). Steps rather than a continuous zoom: every
// one is reachable and leavable with a single tap, the button can show which is
// in force, and there is no gesture to learn. The last step wraps back to 1×,
// so the way out is never more than one tap away.
//
// One of the two magnified steps gives way to „fills the width" where that is a
// different thing — see zoomSteps and ADR 24.
const ZOOM_STEPS = [1, 1.5, 2];

// Two rungs closer together than this are the same rung with a wasted tap
// between them, so the computed one absorbs the fixed one. It is also what
// decides that a page which already fills the width (a phone held upright,
// where the factor comes out at about 1) contributes no rung at all.
const STEP_MERGE_RATIO = 1.12;

// Beyond this the page is a sliver in a wide stage and „fills the width" would
// be a wild rung nobody asked for — a panorama page, say. It then drops out and
// the plain ladder stands.
const FILL_WIDTH_MAX = 3;

// Rungs are compared as factors, and a factor is a float. This is the „the same
// rung" margin for those comparisons, far below anything the eye could tell.
const SAME_STEP = 1.001;

// Overhang below this counts as none at all; see panPlay.
const PAN_SLACK_PX = 2;

// The pinch works the loupe rather than the browser's own zoom (ADR 24, second
// amendment), and it reaches past the ladder's top rung on purpose: the native
// pinch it takes the place of went to about 5×, and swallowing the gesture only
// to cap it at 2× would take magnification away from exactly the reader the
// loupe was built for. Past 4× the canvas limit (see deviceScaleFor) starts
// eating the sharpness that re-rendering the page is for, so it stops here.
const PINCH_MAX = 4;

// Pinching back down lands on exactly 1× from here — the one magnet in an
// otherwise free gesture. 1× is not merely a small factor: it is the page
// fitted to the stage with its offset let go, and „1,03×" would be none of that
// while still counting as magnified.
const PINCH_SNAP_TO_ONE = 1.05;

// How fast a wheel notch zooms. Exponential, so every notch is the same
// *proportional* step and the way back mirrors the way there. One notch of a
// mouse wheel (deltaY 100) comes to about 1,5× — a rung of the ladder — while a
// trackpad pinch reports many small deltas and therefore runs smoothly.
const WHEEL_ZOOM_RATE = 0.004;

// Wheel deltas come in three units; only pixels can be used as they arrive.
const WHEEL_DELTA_PX = { 0: 1, 1: 16, 2: 100 };

// A wheel zoom renders once the hand comes to rest, not once per notch.
const WHEEL_COMMIT_MS = 160;

// The factor as it goes on the button. One decimal, German comma, and no
// trailing „,0": the full-width step lands on whatever the page and the screen
// make of it, and „2,1×" is as much of that as anyone needs to read.
function formatZoom(factor) {
  return `${String(Math.round(factor * 10) / 10).replace('.', ',')}×`;
}

// How long the book-closing intro runs (cover held, then settling into the
// header) before the mood board accepts taps. Must match the CSS choreography.
const MOOD_INTRO_MS = 1500;

// How long the board stays inert after it's revealed, covering its rise-in so a
// pick can't land while it's still animating in. Matches the `mood-board-rise`
// duration in style.css. A timer (rather than the rise's `animationend`) drives
// the lift so it always fires: a cancelled or dropped animation can skip the
// event, which would strand the board inert — visible but un-tappable.
const MOOD_BOARD_RISE_MS = 500;

// Distinct, high-contrast colours for "point at the page" overlays so several
// participants pointing at once stay visually separable.
const POINTER_COLORS = ['#ff3b6b', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4'];

// Maps a participant id to a stable colour. Both the pointing device and every
// receiver derive the colour from the same id, so no colour data needs to be
// sent over the wire and a peer keeps the same colour for the whole session.
function pointerColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return POINTER_COLORS[h % POINTER_COLORS.length];
}

// Two mood boards are the same when their icon ids match in order.
function sameOrder(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

class PdfSource {
  constructor(pdf) {
    this.pdf = pdf;
    this.numPages = pdf.numPages;
  }
  // The zoom factor the reader passes as a fifth argument is only of interest
  // to a source made of pixels (see PhotoSource): a PDF page is redrawn from
  // its vectors at whatever size the box asks for, and stays sharp doing so.
  async renderPage(n, canvas, w, h) {
    await renderPageToCanvas(this.pdf, n, canvas, w, h);
  }
  destroy() {
    this.pdf?.destroy?.();
  }
}

class PhotoSource {
  constructor(bookId, numPages) {
    this.bookId = bookId;
    this.numPages = numPages;
  }
  async renderPage(n, canvas, w, h, zoom) {
    const blob = await getPhotoPage(this.bookId, n);
    if (!blob) throw new Error(`Seite ${n} fehlt`);
    await renderImageToCanvas(blob, canvas, w, h, zoom);
  }
  destroy() {}
}

async function createSource(meta) {
  if (meta.type === 'photos') {
    return new PhotoSource(meta.id, meta.pageCount);
  }
  const fileBlob = await getBookFile(meta.id);
  if (!fileBlob) return null;
  const pdf = await loadPdf(fileBlob);
  return new PdfSource(pdf);
}

export class ReaderView {
  constructor(root, { bookId, onClose, onJoinRoom, joinCode = null, startShared = false }) {
    this.root = root;
    this.bookId = bookId;
    this.onClose = onClose;
    this.onJoinRoom = onJoinRoom;
    this.joinCode = joinCode;
    // Opened from the library to hand a Synchronisations-Code out: make sure
    // there is one and put it on screen (see ensureSharedCode).
    this.startShared = startShared;
    this.serveStop = null;
    this.source = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.renderToken = 0;
    this.hideTimer = null;
    this.pageJumpOpen = false;
    // The sync panel is an extension of the „👥" button that opened it, so the
    // bar behind it stays put for as long as it is up — sliding it away under
    // an open dialog would take the button's own state marker with it.
    this.syncPanelOpen = false;
    // The "?" help overlay (see openHelp). Tracked so the chrome auto-hide can
    // pause while it is up and so any tap or key can dismiss it.
    this.helpOpen = false;
    this.helpOverlay = null;
    // Whether the chrome was pinned open by the help or the page-jump field
    // when the gesture now in progress began — see tapChrome.
    this.chromePinnedAtPress = false;
    this.boundKeys = this.handleKey.bind(this);
    this.boundResize = this.scheduleRender.bind(this);
    // Page loupe (issue #117): the factor the page is magnified by (see
    // cycleZoom for why the factor and not a rung number) plus the offset, in
    // CSS pixels, by which it is shifted out of its centred resting position.
    // Both are local to this device and to this reading — ADR 24.
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    // The factor the canvas on screen was actually rendered at. It trails
    // this.zoom while a render is in flight — and all through a pinch, which
    // moves the factor sixty times a second and renders once at the end. The
    // quotient of the two is the CSS scale that stands in for the render until
    // it lands (see displayScale), so the page follows the fingers at once and
    // sharpens when the render catches up.
    this.renderedZoom = 1;
    // True between the first and the last of a pinch's two fingers, only so the
    // loupe can stay on screen and count along while the page is being resized.
    this.pinching = false;
    // Renders run one after another on this chain; see renderCurrent.
    this.renderQueue = Promise.resolve();
    this.syncSession = null;
    this.isSyncing = false;
    // Local page-navigation toggle (zones + swipe). Default on; persisted
    // per-device. Read synchronously so the first render is already correct.
    this.navEnabled = loadNavEnabled();
    // Remote/local "point at the page" overlays, keyed by the pointing device's
    // memberId ('local' for this device's own pointer). See attachStageGestures
    // + the pointer helpers below.
    this.pointerEls = new Map();
    this.localPointerActive = false;
    this.lastRenderedPage = 0;
    this.pointerSendTimer = null;
    this.lastPointerSend = 0;
    this.pendingPointer = null;
    this.longPressTimer = null;
    this.mouseHoldTimer = null;
    // Which kind of input the reader last used, so the help overlay can name
    // the gesture they actually have in their hand („Finger" vs. „Maustaste").
    // Seeded from the device itself for the case where the help is opened by
    // keyboard before any pointer has been near the reader.
    this.lastInputWasMouse = !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    // Shared reading memory (issue #65). The mood overlay is built on demand;
    // mySelection is this device's authoritative picks, moodPartnerPicks mirrors
    // the other participants' picks from Firebase, keyed by memberId. The
    // partner's picks stay hidden until the reveal, so neither reader steers the
    // other toward a match.
    this.moodOpen = false;
    this.moodOrder = null; // the shared board (icon ids), agreed via Firebase
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.moodRevealed = false;
    // memberIds present this ritual, used only to count participants (issue #82):
    // three shows an advisory so the reading adult abstains, four or more bows out.
    this.moodPresentIds = [];
    // Gates the present-count branch until the ~1.5 s grace window has elapsed
    // (issue #79). A synced pair momentarily tallies a count of 1 before the
    // partner announces, so the count must settle before the ≤1 tail can bow out
    // to „Ende" — otherwise every paired ritual would misfire on its first tick.
    this.moodSettled = false;
  }

  async render() {
    // First statement, before any await: the tap on the cover that led here is
    // still the current user gesture, and iOS grants the wake lock only on one
    // (ADR 25). Loading the book takes seconds on a large PDF — asking after it
    // would be too late.
    keepAwake();

    this.root.innerHTML = `
      <div class="reader">
        <div class="reader-chrome">
          <button class="reader-back" type="button" aria-label="Zurück zur Bibliothek">←<span class="reader-back-label">Bibliothek</span></button>
          <button class="reader-sync-btn" type="button" aria-label="Gemeinsam lesen">👥</button>
          <div class="reader-title"></div>
          <button class="reader-nav-toggle" type="button" aria-label="Seitennavigation" aria-pressed="true">◀▶</button>
          <div class="reader-page-indicator"></div>
          <button class="reader-help-btn" type="button" aria-label="Hilfe" aria-expanded="false">?</button>
        </div>
        <div class="sync-panel" hidden>
          <div class="sync-panel-card">
            <div class="sync-panel-title">Gemeinsam lesen</div>
            <div class="sync-panel-desc">Damit ihr dieselbe Seite seht, braucht ihr beide den gleichen Synchronisations-Code des Buches.</div>
            <div class="sync-create-section">
              <button class="sync-create-btn" type="button">Synchronisations-Code erstellen</button>
            </div>
            <div class="sync-or">— oder —</div>
            <div class="sync-join-section">
              <div class="sync-join-label">Synchronisations-Code von deinem Lesepartner bekommen?</div>
              <input class="sync-join-input" type="text" placeholder="Synchronisations-Code" aria-label="Synchronisations-Code" />
            </div>
            <div class="sync-active-section" hidden>
              <div class="sync-code-label">Synchronisations-Code des Buches</div>
              <div class="sync-code-display"></div>
              <div class="sync-code-hint">Sag ihn deinem Lesepartner am Telefon.</div>
            </div>
            <div class="sync-panel-actions">
              <button class="sync-panel-close" type="button">Abbrechen</button>
              <button class="sync-join-btn" type="button">Verbinden</button>
            </div>
          </div>
        </div>
        <div class="reader-stage">
          <canvas class="reader-canvas"></canvas>
          <button class="reader-zone reader-zone-prev" type="button" aria-label="Zurück"></button>
          <button class="reader-zone reader-zone-next" type="button" aria-label="Vor"></button>
          <div class="pointer-layer" aria-hidden="true"><div class="pointer-page"></div></div>
        </div>
        <button class="reader-zoom" type="button" aria-label="Seite vergrössern"><span class="reader-zoom-glyph" aria-hidden="true">🔍</span><span class="reader-zoom-factor"></span></button>
        <button class="reader-finish-cue" type="button" hidden>
          <span class="reader-finish-cue-icon" aria-hidden="true">📖</span>
          Fertig? Buch schliessen
        </button>
        <div class="reader-loading">Lade…</div>
      </div>
    `;

    const reader = this.root.querySelector('.reader');
    this.readerEl = reader;
    reader.querySelector('.reader-back').addEventListener('click', () => this.close());
    reader.querySelector('.reader-zone-prev').addEventListener('click', () => this.goPrev());
    reader.querySelector('.reader-zone-next').addEventListener('click', () => this.goNext());
    reader.querySelector('.reader-finish-cue').addEventListener('click', () => this.openMood(true));
    reader.querySelector('.reader-nav-toggle').addEventListener('click', () => this.toggleNav());
    reader.querySelector('.reader-help-btn').addEventListener('click', () => this.toggleHelp());
    reader.querySelector('.reader-zoom').addEventListener('click', () => this.cycleZoom());
    this.applyNavState();
    this.applyZoomState();

    const indicator = reader.querySelector('.reader-page-indicator');
    indicator.setAttribute('role', 'button');
    indicator.setAttribute('tabindex', '0');
    indicator.addEventListener('click', () => this.openPageJump());
    indicator.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openPageJump();
      }
    });
    indicator.addEventListener('pointerdown', (e) => {
      const input = indicator.querySelector('.page-jump-input');
      if (input && e.target !== input) {
        // preventDefault keeps the tap from blurring the field (which would
        // close the jump); the focus then makes the whole 44px box behave like
        // the field it contains, rather than a border of dead pixels around it.
        e.preventDefault();
        input.focus();
      }
    });

    // Keyboard operation reveals the chrome and restarts its wait — arriving on
    // a control (Tab) and using one (Enter, Space) alike. Resting focus alone
    // deliberately does NOT hold it open: the bar would then never settle for
    // anyone whose focus happens to sit on it, which is the defect issue #179
    // reported. Because every key re-reveals, a control that went out of sight
    // under a resting focus comes back the moment it is used, so nothing is
    // ever activated invisibly. The loupe rides along: it is chrome too, it
    // just lives outside the bar.
    //
    // A pointer press on a control lands here as well, and harmlessly: a
    // concealed control is off-screen or has pointer-events: none, so anything
    // that can be pressed was on screen anyway, and the control's own handler
    // then sets whichever wait applies to it.
    const revealForKeyboard = (e) => {
      if (e.target.closest?.('.reader-chrome, .reader-zoom')) this.showChrome();
    };
    reader.addEventListener('focusin', revealForKeyboard);
    reader.addEventListener('keydown', revealForKeyboard);

    reader.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.showCursor();
      // Pointing keeps the chrome away for the same reason the long press does
      // on a touchscreen (ADR 10): dragging the pointer up near the top edge
      // must not slide the bar over the page that is being pointed at.
      if (this.localPointerActive) return;
      if (e.clientY <= CHROME_REVEAL_BAND_PX || e.target.closest('.reader-chrome')) this.showChrome();
    });
    // Capture, so it also sees the presses the chrome's own buttons consume —
    // notably the „?" that opens the help this feeds.
    reader.addEventListener('pointerdown', (e) => {
      this.lastInputWasMouse = e.pointerType === 'mouse';
    }, true);
    // What tapChrome needs and can no longer read for itself: whether the
    // chrome was standing on its own when the gesture began. Both the help and
    // the page-jump field close on this very pointerdown — the help from its own
    // window listener, the field from the blur the press causes — so by the time
    // the tap is recognised, at touchend or pointerup, the state that decides
    // the tap is already gone. On window in the capture phase, and installed
    // here as the reader opens: the help's dismiss listener sits on the same
    // target in the same phase but is only ever added later, so this one runs
    // first and still sees the help open.
    this._chromePressState = () => {
      this.chromePinnedAtPress = this.helpOpen || this.pageJumpOpen;
    };
    window.addEventListener('pointerdown', this._chromePressState, true);
    reader.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      // The stage runs its own gesture recogniser (tap vs. long-press-to-point
      // vs. swipe); let it decide whether a touch there reveals the chrome.
      if (e.target.closest('.reader-stage')) return;
      this.showChrome();
    }, { passive: true });

    // Re-arm the wake lock on the next input in the reader, for the case where
    // the request in render() was refused — a book that arrived over a transfer
    // has no gesture left by the time the reader opens. Which event this has to
    // be is not a free choice: only some events grant the activation the lock
    // needs. `touchend` always does, `pointerdown` only for a mouse, and
    // `pointerup` only for everything except a mouse — and a stage gesture that
    // calls preventDefault can end in `pointercancel` rather than `pointerup`,
    // so the pair below is the one that covers both kinds of device. During a
    // read-aloud such an input arrives at the latest with the next page turn.
    // keepAwake() is inert while the lock is held (ADR 25).
    reader.addEventListener('touchend', keepAwake, { capture: true, passive: true });
    reader.addEventListener('pointerdown', keepAwake, true);

    this.setupSync(reader);

    this.attachStageGestures(reader.querySelector('.reader-stage'));

    window.addEventListener('keydown', this.boundKeys);
    window.addEventListener('resize', this.boundResize);

    const meta = await getMeta(this.bookId);
    if (!meta) {
      await showAlert({ message: 'Buch nicht gefunden.' });
      this.close();
      return;
    }
    reader.querySelector('.reader-title').textContent = meta.title;
    this.bookTitle = meta.title;
    // Preloaded here, while the book opens, so the closing ritual can show the
    // cover (the just-closed book) the instant it begins — no async wait mid-
    // ritual. Absent thumbnails fall back to an icon; the URL is revoked on
    // destroy. Stored separately from the library's thumbnail handling.
    getThumb(this.bookId).then((blob) => {
      if (blob && this.readerEl) this.coverUrl = URL.createObjectURL(blob);
    }).catch(() => {});

    this.source = await createSource(meta);
    if (!this.source) {
      await showAlert({ message: 'Buch nicht gefunden.' });
      this.close();
      return;
    }
    // Only now that the book actually opened — whether tapped in the library or
    // joined via a Synchronisations-Code, both routes pass here. A book whose
    // pages are missing bails out above and must not be pushed to the top of
    // "Zuletzt gelesen".
    markOpened(this.bookId).catch(() => {});

    this.totalPages = this.source.numPages;
    this.currentPage = Math.min(Math.max(meta.lastPage || 1, 1), this.totalPages);

    await this.renderCurrent();
    reader.querySelector('.reader-loading')?.remove();
    this.showChrome();

    const existing = getSessionForBook(this.bookId);
    if (existing) {
      this.syncSession = existing;
      existing.onRemotePageChange = (page) => this.onRemotePage(page);
      existing.onRoomDeleted = () => {
        this.syncStop();
        showAlert({ message: 'Die Synchronisation wurde beendet.' });
      };
      existing.listen();
      this.showSyncActive(existing.roomCode);
    } else if (this.joinCode) {
      // Opened from the library "Gemeinsam lesen" flow: join the given room
      // directly (the book is already in hand, downloaded if it wasn't before).
      await this.syncJoinCode(this.joinCode);
    } else {
      const session = new SyncSession(this.bookId);
      session.onRemotePageChange = (page) => this.onRemotePage(page);
      session.onRoomDeleted = () => {
        this.syncStop();
        showAlert({ message: 'Die Synchronisation wurde beendet.' });
      };
      this.syncSession = session;
      const code = await session.reconnect().catch(() => null);
      if (this.syncSession !== session) {
        session.detach();
        return;
      }
      if (code && session.roomCode) {
        this.showSyncActive(code);
      } else {
        this.syncSession = null;
      }
    }

    if (this.startShared) await this.ensureSharedCode();
  }

  // The tail of the library's „Buch auswählen" path: the book is open, so all
  // that is left is to have a Synchronisations-Code and show it.
  //
  // Deliberately after the reconnect above, and only creating when that came up
  // empty. A book already carrying a code keeps it: creating a second one runs
  // syncCreate's syncStop first, which drops this device's saved code, so a
  // partner still reading in the old room would be talking to nobody. Whether
  // the code was made minutes or weeks ago is nothing the reader has to think
  // about, so the screen is the same either way.
  async ensureSharedCode() {
    if (!this.syncSession?.roomCode) await this.syncCreate();
    // syncCreate reports its own failures and leaves no session behind; showing
    // an empty panel on top of that alert would only be a second thing to close.
    if (this.syncSession?.roomCode) {
      this.openSyncPanel();
    }
  }

  // Unified touch recogniser for the reading stage. It distinguishes three
  // gestures so they never collide:
  //   • quick tap            → show the chrome, or take it away again if it is
  //                            already up (see tapChrome) — but not over a
  //                            page-turn zone, which turns the page via its own
  //                            click handler
  //   • long press (≥700ms)  → "point at the page": four chevrons converge on
  //                            the finger and follow it until release; the
  //                            chrome stays hidden so pointing is unobstructed
  //   • drag                 → turn the page, as a horizontal swipe always has,
  //                            unless the loupe has magnified the page and the
  //                            page can actually move that way, in which case
  //                            it follows the finger (issue #117). This is the
  //                            only gesture the loupe changes, and tapping a
  //                            turn zone still turns the page either way.
  //   • two fingers          → work the loupe: the page grows and shrinks with
  //                            them and moves with their midpoint, instead of
  //                            leaving the browser to zoom the whole window
  //                            (ADR 24, second amendment).
  attachStageGestures(stage) {
    // Captured once: the canvas element is reused across page renders, so a
    // pointer can be measured against the page without a per-touchmove DOM query.
    const canvas = stage.querySelector('.reader-canvas');
    const TAP_MAX_MS = 600;
    const TAP_MAX_PX = 15;
    const SWIPE_PX = 40;

    let startX = null;
    let startY = null;
    let startTime = 0;
    let onZone = false;
    let aborted = false; // a second finger cancels the one-finger gesture
    // The pinch in progress, or null. Holds where the fingers started so the
    // factor and the offset are both measured against that moment rather than
    // accumulated frame by frame, which would drift.
    let pinch = null;
    // Set when the browser's own zoom took the gesture away mid-pinch, and
    // cleared only when every finger has lifted: two fingers still on the glass
    // are the gesture the loupe just handed back, not a new one to pick up.
    let pinchGivenUp = false;
    // Moving the magnified page: latched once the finger has travelled far
    // enough to rule out a tap, with the offset the page started from, so the
    // page follows the finger from where it stood rather than jumping.
    let panning = false;
    let panFromX = 0;
    let panFromY = 0;

    // Instance property (not a closure local) so destroy() can clear a press
    // still pending in its 700ms window and it never fires on a torn-down view.
    const clearTimer = () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    };

    const finishPointer = () => {
      if (this.localPointerActive) this.endLocalPointer();
    };

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        clearTimer();
        finishPointer();
        panning = false;
        aborted = true;
        if (!pinch && e.touches.length === 2) pinch = this.beginPinch(e.touches[0], e.touches[1]);
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      onZone = !!e.target.closest('.reader-zone');
      aborted = false;
      panning = false;
      clearTimer();
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        const pos = this.pageFraction(canvas, startX, startY);
        this.beginLocalPointer(pos.x, pos.y);
      }, LONG_PRESS_MS);
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      // A second finger anywhere on the screen means a pinch, not a one-finger
      // gesture — and `touches` counts them all, including one that came down on
      // a chrome button, whose touchstart never reaches this listener. That is
      // also why the pinch may have to be picked up here rather than in
      // touchstart: two fingers of which only one landed on the stage are still
      // a pinch, and the reader means the page by it either way.
      if (e.touches.length !== 1) {
        clearTimer();
        finishPointer();
        panning = false;
        aborted = true;
        if (e.touches.length === 2) {
          if (!pinch && !pinchGivenUp) pinch = this.beginPinch(e.touches[0], e.touches[1]);
          if (pinch && this.nativeZoomActive()) {
            // The browser is zooming despite the suppression. Stepping aside at
            // the start of a gesture is not enough if it only takes hold
            // halfway through: carrying on here is precisely the two zooms on
            // one pair of fingers this was meant to prevent. So the loupe hands
            // the gesture back and puts itself where the gesture found it,
            // leaving the reader with the native zoom alone — what they had
            // before any of this. Handed back for good until every finger has
            // lifted, rather than snatched again mid-gesture.
            this.cancelPinch(pinch);
            pinch = null;
            pinchGivenUp = true;
          } else if (pinch) {
            // Keep the browser from taking the same two fingers as a zoom of
            // its own on top of this one.
            if (e.cancelable) e.preventDefault();
            this.movePinch(pinch, e.touches[0], e.touches[1]);
          }
        }
        return;
      }
      if (aborted || startX == null) return;
      const t = e.touches[0];
      if (!t) return;
      if (this.localPointerActive) {
        // Suppress scroll / rubber-band / history-swipe so dragging the pointer
        // (e.g. circling the bunny) is smooth. Only while pointing — normal
        // reading scroll/swipe stays untouched, hence the non-passive listener.
        if (e.cancelable) e.preventDefault();
        const pos = this.pageFraction(canvas, t.clientX, t.clientY);
        this.moveLocalPointer(pos.x, pos.y);
        return;
      }
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const travelled = Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX;
      if (travelled) {
        clearTimer(); // moved too far to be a long press (likely a swipe)
        if (!panning && this.canPanAlong(dx, dy)) {
          panning = true;
          panFromX = this.panX;
          panFromY = this.panY;
        }
      }
      if (panning) {
        // Same reason as while pointing: keep the browser from scrolling,
        // rubber-banding, or reading the drag as a back-swipe.
        if (e.cancelable) e.preventDefault();
        this.panTo(panFromX + dx, panFromY + dy);
      }
    }, { passive: false });

    stage.addEventListener('touchend', (e) => {
      clearTimer();
      if (e.touches.length === 0) pinchGivenUp = false;
      // The pinch is over as soon as it is down to one finger; what is left on
      // the glass belongs to no gesture (aborted stays set until the last
      // finger lifts), so lingering with one finger neither turns the page nor
      // starts a drag from where the pinch happened to end.
      if (pinch && e.touches.length < 2) {
        this.endPinch();
        pinch = null;
        startX = startY = null;
        if (e.touches.length === 0) aborted = false;
        // Swallow the synthetic click, or a pinch that ended over a turn zone
        // would also turn the page.
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (this.localPointerActive) {
        finishPointer();
        startX = startY = null;
        // Suppress the synthetic click the browser would otherwise fire on the
        // page-turn zone underneath, so pointing near an edge and releasing
        // doesn't accidentally turn the page.
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (panning) {
        panning = false;
        startX = startY = null;
        // As when pointing: swallow the synthetic click, so letting go of the
        // page over a turn zone doesn't also turn the page.
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (aborted || startX == null) {
        if (e.touches.length === 0) { startX = startY = null; aborted = false; }
        return;
      }
      const dt = Date.now() - startTime;
      const end = e.changedTouches[0];
      const dx = end ? end.clientX - startX : 0;
      const dy = end ? end.clientY - startY : 0;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (this.navEnabled && absX > SWIPE_PX && absX > absY) {
        if (dx < 0) this.goNext();
        else this.goPrev();
      } else if (dt < TAP_MAX_MS && absX < TAP_MAX_PX && absY < TAP_MAX_PX && !onZone) {
        // Where the finger went down, not where it came up: what the tap was
        // aimed at is what the top-edge exception in tapChrome is about.
        this.tapChrome(startY);
      }
      startX = startY = null;
    }, { passive: false });

    stage.addEventListener('touchcancel', () => {
      clearTimer();
      finishPointer();
      if (pinch) {
        this.endPinch();
        pinch = null;
      }
      pinchGivenUp = false;
      startX = startY = null;
      aborted = false;
      panning = false;
    });

    this.attachMouseGestures(stage);
    this.attachWheelZoom(stage);
    this.suppressNativePinch(stage);
  }

  // The mouse's half of the stage gestures: hold the button to point at the
  // page, drag to move the magnified page. Kept apart from the touch recogniser
  // above rather than folded into it — mixing pointer events into that one
  // would double up every touch it already handles — but the pointing it grants
  // is the same gesture, held for the same 700 ms, so a grandmother at a laptop
  // has the feature the help promises her (issue #121; ADR 10, amendment).
  //
  // The two gestures start identically — a button goes down — and movement
  // tells them apart, exactly as it does for a finger.
  attachMouseGestures(stage) {
    // Captured once, as in attachStageGestures: the canvas is reused across
    // renders, so a pointer can be measured against the page without a DOM
    // query on every mouse move of a drag.
    const canvas = stage.querySelector('.reader-canvas');
    const DRAG_START_PX = 3; // a mouse is precise; this only sorts drag from click
    let from = null;

    // Instance property (not a closure local) so destroy() can clear a press
    // still pending in its 700 ms window and it never fires on a torn-down view.
    const clearHold = () => {
      if (this.mouseHoldTimer) { clearTimeout(this.mouseHoldTimer); this.mouseHoldTimer = null; }
    };

    // Taken once a press has become a gesture — pointing, or moving the page —
    // and never before: while the pointer is captured the browser also
    // retargets the click to the capturing element, which would rob the turn
    // zones of the plain clicks that turn pages. Both gestures swallow their
    // click anyway (see below), so from here on the retarget costs nothing and
    // the capture buys what it is for: a release outside the window is still
    // delivered here rather than leaving a pointer standing on the partner's
    // page. A pointer this device no longer has is not an error worth acting on
    // — such a gesture ends through one of the paths below instead.
    const capture = () => {
      if (!from) return;
      try { stage.setPointerCapture(from.id); } catch {}
    };

    // The single way out, so no ending can forget a piece of the state: the
    // hold that may still be pending, the capture, the drag, and the pointer
    // the partner can see. That last one is why this is worth the care a local
    // drag never needed — a pointer left standing is left standing on someone
    // else's screen.
    const endGesture = () => {
      clearHold();
      if (from) {
        if (stage.hasPointerCapture?.(from.id)) stage.releasePointerCapture(from.id);
        from = null;
      }
      if (this.localPointerActive) this.endLocalPointer();
    };

    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      from = {
        x: e.clientX,
        y: e.clientY,
        panX: this.panX,
        panY: this.panY,
        moved: false,
        id: e.pointerId,
        // A click over a zone turns the page (the zone's own handler) and must
        // not also mean the chrome. With navigation off the zones let the press
        // through to the stage, so this is false there and a click in that half
        // of the page reaches the chrome — as the same tap does (ADR 14).
        onZone: !!e.target.closest('.reader-zone'),
      };
      // Where the press began, held by the timer itself rather than read back
      // off `from`, which a drag may have dropped by the time it fires.
      const startX = e.clientX;
      const startY = e.clientY;
      clearHold();
      this.mouseHoldTimer = setTimeout(() => {
        this.mouseHoldTimer = null;
        const pos = this.pageFraction(canvas, startX, startY);
        // Only a press that actually placed a pointer is worth capturing for.
        // Reading alone there is no partner and no pointer (see
        // beginLocalPointer), and capturing anyway would send the click that
        // follows to the stage instead of the turn zone underneath it: a reader
        // who rests the button on a zone for a moment would stop turning pages.
        if (this.beginLocalPointer(pos.x, pos.y)) capture();
      }, LONG_PRESS_MS);
    });

    // On the window, not the stage: a gesture that leaves the stage — or ends
    // outside the window entirely — must still be followed and must still end,
    // rather than leaving the page (or the pointer) stuck to the cursor.
    this._mousePanMove = (e) => {
      // Only the pointer that began this gesture moves it. On a device with
      // both, a finger dragging elsewhere — or a stylus merely hovering, which
      // reports no button held — would otherwise move the page under the mouse
      // or end the gesture outright; a touch belongs to the recogniser above.
      if (!from || e.pointerType !== 'mouse' || e.pointerId !== from.id) return;
      // The button was released somewhere we never heard about (a drag ended
      // over browser chrome, say). Drop the gesture instead of resuming it.
      if (!(e.buttons & 1)) { endGesture(); return; }
      if (this.localPointerActive) {
        // Pointing: the cluster follows the cursor and the page stays put, so
        // the bunny can be circled with a mouse just as with a finger.
        const pos = this.pageFraction(canvas, e.clientX, e.clientY);
        this.moveLocalPointer(pos.x, pos.y);
        return;
      }
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
        clearHold(); // moved too far to be a press held in place
      }
      if (!from.moved) {
        // While the press could still become a pointing gesture, the page only
        // starts moving at that gesture's own cancel distance: a hand that
        // shifts three pixels while holding still would otherwise drag the page
        // out from under the pointer it was about to place. A real drag crosses
        // both distances in the same movement, so dragging feels unchanged.
        const threshold = this.mouseHoldTimer ? MOVE_CANCEL_PX : DRAG_START_PX;
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        // Nothing to move this way (see canPanAlong, which is false at 1x):
        // let go of the gesture so it ends as the ordinary click it looks like
        // — over a turn zone that is a page turn, which is what the same drag
        // does on a touchscreen.
        if (!this.canPanAlong(dx, dy)) { from = null; return; }
        from.moved = true;
        capture();
      }
      this.panTo(from.panX + dx, from.panY + dy);
    };
    // The release, by whichever event carries the news. Matched by pointer id,
    // so a finger's release — or a second pointer's — is left to whoever owns
    // it. `lostpointercapture` is in this list rather than treated as an
    // abandonment because browsers disagree on whether it arrives before or
    // after the `pointerup` it belongs to; ending here means the click below is
    // swallowed either way, and whichever of the two comes second finds the
    // gesture already over and does nothing.
    this._mousePanUp = (e) => {
      if (!from || e.pointerType !== 'mouse' || e.pointerId !== from.id) return;
      const dragged = from.moved;
      const pointed = this.localPointerActive;
      // A press that became neither gesture is a plain click, and on the page
      // itself it means the chrome, exactly as a tap does on a touchscreen
      // (rule 1). What makes it a click rather than a hold is the pointing
      // timer still being pending: a button held past those 700 ms that placed
      // no pointer — reading alone there is nobody to point for — was an
      // attempt to point, not a click. And only a real release counts; a
      // cancelled or stolen gesture ends here too, and ends as nothing.
      const clicked = e.type === 'pointerup' && !dragged && !pointed
        && !from.onZone && !!this.mouseHoldTimer;
      const pressY = from.y;
      endGesture();
      // Releasing still delivers a click to whatever lies underneath. Over a
      // turn zone that would turn the page on top of the gesture just made, so
      // it is swallowed here — the same protection the touch recogniser gets
      // from its preventDefault.
      if (dragged || pointed) this.swallowNextClick();
      else if (clicked) this.tapChrome(pressY);
    };
    // The releases nobody reports: the window loses focus with the button still
    // down, or the tab is hidden mid-gesture. Capture makes these rare, but not
    // impossible — browsers are known to drop the release when it happens
    // outside their own window — and the cost of missing one is a pointer left
    // on the partner's page with nothing to take it away. No click follows an
    // abandoned gesture, so none is swallowed.
    this._mouseGestureAbort = () => { if (from) endGesture(); };
    // Reachable from destroy(), which tears the reader down from outside this
    // closure: the pointer it may still hold is released and the drag dropped
    // there rather than left to the garbage collector.
    this._endMouseGesture = endGesture;
    window.addEventListener('pointermove', this._mousePanMove);
    window.addEventListener('pointerup', this._mousePanUp);
    window.addEventListener('pointercancel', this._mousePanUp);
    stage.addEventListener('lostpointercapture', this._mousePanUp);
    window.addEventListener('blur', this._mouseGestureAbort);
    document.addEventListener('visibilitychange', this._mouseGestureAbort);
  }

  // --- Pinch (ADR 24, second amendment) -----------------------------------

  // Whether the document itself is natively zoomed, in which case the pinch is
  // left alone. Two things ride on this one check. A reader who pinched in the
  // library — where there is no loupe to take the gesture over — carries that
  // zoom into the book, and the only way back out of it is the same gesture; a
  // reader must never be shut inside a state the app then refuses to hear about
  // (rule 7). And should a platform ignore the suppression below and zoom
  // anyway, this is where the app stops fighting it: the loupe steps aside and
  // the reader is left with exactly what they had before, rather than with two
  // zooms at once.
  nativeZoomActive() {
    return (window.visualViewport?.scale ?? 1) > 1.01;
  }

  // The pinch is free between 1× and PINCH_MAX rather than snapping to the
  // ladder: a page that jumps back out of the fingers that just placed it is
  // the app overruling the reader (rule 7), and the loupe holds a factor
  // anyway, so any value between the rungs is a state it can already show and
  // step on from. The one magnet is at the bottom, where „nearly 1×" and 1×
  // are genuinely different things.
  clampPinch(factor) {
    if (!(factor > 0)) return this.zoom;
    if (factor < PINCH_SNAP_TO_ONE) return 1;
    return Math.min(PINCH_MAX, factor);
  }

  // Everything the gesture is measured against, taken once: the fingers' first
  // distance and midpoint, the factor and offset they started from, and the
  // stage's centre (which cannot move while two fingers are down, so it is
  // worth not re-measuring sixty times a second).
  beginPinch(a, b) {
    const stage = this.root.querySelector('.reader-stage');
    if (!stage || this.nativeZoomActive()) return null;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!dist) return null;
    const r = stage.getBoundingClientRect();
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this.pinching = true;
    this.applyZoomState();
    return {
      dist,
      centre,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      midX: (a.clientX + b.clientX) / 2 - centre.x,
      midY: (a.clientY + b.clientY) / 2 - centre.y,
    };
  }

  // Follows the fingers: the factor from how far apart they are now against
  // where they began, and the offset from the promise that the spot they took
  // hold of stays under them. That second half is what makes a pinch feel like
  // handling the page rather than operating a control — and it carries the
  // two-finger drag along for nothing, because a midpoint that has moved is
  // only the same page point asking to be somewhere else.
  //
  // Both are measured from the start of the gesture rather than from the last
  // frame, so the page cannot drift away from the fingers over a long pinch,
  // and pinching back to where one started puts the page back where it was.
  movePinch(pinch, a, b) {
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!dist) return;
    const factor = this.clampPinch(pinch.zoom * (dist / pinch.dist));
    const ratio = factor / pinch.zoom;
    const midX = (a.clientX + b.clientX) / 2 - pinch.centre.x;
    const midY = (a.clientY + b.clientY) / 2 - pinch.centre.y;
    this.zoom = factor;
    this.panX = midX - (pinch.midX - pinch.panX) * ratio;
    this.panY = midY - (pinch.midY - pinch.panY) * ratio;
    this.clampPan();
    this.applyPan();
    this.applyZoomState();
  }

  // On release the factor is already in force and already on the button; what
  // is left is to make the page sharp at it. The canvas keeps its stand-in
  // scale until that render lands (see displayScale), so nothing springs back
  // in between.
  //
  // Deliberately without showChrome: the chrome comes up for a tap, and someone
  // who has just made the page bigger in order to read it is the last person to
  // want the bar over it. The loupe alone stays — while the fingers are down
  // because of `pinching`, and afterwards because the page is magnified.
  endPinch() {
    if (!this.pinching) return;
    this.pinching = false;
    this.applyZoomState();
    if (Math.abs(this.zoom - this.renderedZoom) > 0.001) this.renderCurrent();
  }

  // Undoes a pinch instead of committing it: the factor and the offset go back
  // to what they were when the fingers went down, which is the only sensible
  // place to leave them when the browser has taken the gesture over halfway
  // through — anything else would freeze a half-finished local zoom underneath
  // the native one. Nothing is re-rendered, because the canvas was never
  // re-rendered during the gesture in the first place; putting the factor back
  // is enough to make the stand-in scale 1 again.
  cancelPinch(pinch) {
    this.pinching = false;
    this.zoom = pinch.zoom;
    this.panX = pinch.panX;
    this.panY = pinch.panY;
    this.clampPan();
    this.applyPan();
    this.applyZoomState();
  }

  // Trackpad pinch and Ctrl+wheel, which every browser reports as a wheel event
  // with ctrlKey set. Taken over for the same reason as the touch pinch: left
  // to the browser it zooms the whole window, chrome and all, so the same
  // gesture would mean two different things depending on which device the
  // reader happens to be sitting at (rule 1).
  attachWheelZoom(stage) {
    stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || this.nativeZoomActive()) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const midX = e.clientX - (r.left + r.width / 2);
      const midY = e.clientY - (r.top + r.height / 2);
      const delta = e.deltaY * (WHEEL_DELTA_PX[e.deltaMode] ?? 1);
      const factor = this.clampPinch(this.zoom * Math.exp(-delta * WHEEL_ZOOM_RATE));
      const ratio = factor / this.zoom;
      // Same anchoring as the pinch, with the cursor for a midpoint: what is
      // under the pointer stays under it.
      this.zoom = factor;
      this.panX = midX - (midX - this.panX) * ratio;
      this.panY = midY - (midY - this.panY) * ratio;
      this.clampPan();
      this.applyPan();
      this.applyZoomState();
      // A trackpad pinch arrives as a stream of small notches; rendering each
      // one would queue up dozens of renders for a single gesture. Notches that
      // change nothing — against the ceiling, or back at the factor already on
      // screen — leave any render already waiting alone rather than pushing it
      // further away.
      if (Math.abs(this.zoom - this.renderedZoom) > 0.001) {
        clearTimeout(this._wheelZoomT);
        this._wheelZoomT = setTimeout(() => this.renderCurrent(), WHEEL_COMMIT_MS);
      }
    }, { passive: false });
  }

  // WebKit's own pinch, which is what iOS actually fires on two fingers, and
  // which `touch-action` does not reliably hold back there. Cancelled outright
  // so the page is zoomed once — by the touch handlers above, which have the
  // same two fingers — rather than twice.
  suppressNativePinch(stage) {
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
      stage.addEventListener(type, (e) => {
        if (this.nativeZoomActive()) return;
        if (e.cancelable) e.preventDefault();
      });
    });
  }

  // A mouse drag that ends over a page-turn zone still delivers a click to it.
  // Consume that one click on the way down. The listener is dropped again on
  // the next turn of the event loop, by which time the click has either been
  // dispatched or was never coming (a drag that ended outside the window), so
  // it can never lie in wait for an unrelated click later on.
  swallowNextClick() {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  }

  // Position of a viewport point as a fraction (0..1) of the page image, so a
  // pointer lands on the same spot of the page on every device regardless of
  // screen size or aspect ratio. Measured against the canvas (the page), not the
  // stage: the page is letterboxed inside the stage, so a stage-relative fraction
  // would drift between devices whose viewports have different shapes. Clamped,
  // because a finger may drift past the page edge into the letterbox bar.
  // `canvas` is passed in (attachStageGestures already holds it), so this runs
  // on every touchmove during a drag without a DOM query or a cached element
  // that could go stale.
  pageFraction(canvas, clientX, clientY) {
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    const x = r.width ? (clientX - r.left) / r.width : 0;
    const y = r.height ? (clientY - r.top) / r.height : 0;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  // Overlays the pointer coordinate space (.pointer-page) exactly onto the page
  // image, so the percentage-positioned pointers map to the page rather than to
  // the whole stage. Refreshed after every render and on resize, so a pointer
  // held through an orientation change stays glued to its spot on the page.
  syncPointerPageGeometry() {
    const page = this.root.querySelector('.pointer-page');
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    if (!page || !canvas || !stage) return;
    const s = stage.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    page.style.left = `${c.left - s.left}px`;
    page.style.top = `${c.top - s.top}px`;
    page.style.width = `${c.width}px`;
    page.style.height = `${c.height}px`;
  }

  // Builds the four-chevron + glow-dot overlay for one pointer at fraction
  // (x, y). `colorSeed` keeps a given participant's colour stable across the
  // session; reused for both the local echo and each remote peer.
  createPointerEl(colorSeed, x, y) {
    const el = document.createElement('div');
    el.className = 'pointer';
    el.style.setProperty('--pc', pointerColor(colorSeed));
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const chevron = document.createElement('span');
      chevron.className = `pointer-chevron pointer-chevron-${corner}`;
      el.appendChild(chevron);
    }
    const dot = document.createElement('span');
    dot.className = 'pointer-dot';
    el.appendChild(dot);
    this.root.querySelector('.pointer-page')?.appendChild(el);
    return el;
  }

  setPointerPosition(el, x, y) {
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
  }

  // Fades a pointer out (chevrons fly back out) and removes it once the leave
  // animation ends. `immediate` skips the animation — used on a page turn, so
  // a stale pointer never lingers onto the new page.
  removePointerEl(el, immediate = false) {
    if (!el || el.dataset.leaving) return;
    if (immediate) { el.remove(); return; }
    el.dataset.leaving = '1';
    el.classList.add('pointer-leaving');
    const done = () => el.remove();
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 500); // safety net if animationend never fires
  }

  // Returns whether a pointer was actually placed. The mouse gesture needs to
  // know: a press that pointed at nothing must stay an ordinary click.
  beginLocalPointer(x, y) {
    const session = this.syncSession;
    if (!session || !session.roomCode) return false; // nothing to point at without a partner
    this.localPointerActive = true;
    this.pendingPointer = null;
    const existing = this.pointerEls.get('local');
    if (existing) existing.remove();
    const el = this.createPointerEl(session.memberId, x, y);
    this.pointerEls.set('local', el);
    this.lastPointerSend = Date.now();
    session.sendPointer(x, y).catch(() => {});
    return true;
  }

  moveLocalPointer(x, y) {
    const el = this.pointerEls.get('local');
    if (el) this.setPointerPosition(el, x, y);
    // Throttle the network writes to ~12/s but always flush the final position
    // (trailing edge), so the remote pointer settles exactly where the finger
    // came to rest rather than at the last throttled sample.
    this.pendingPointer = { x, y };
    if (this.pointerSendTimer) return;
    const wait = Math.max(0, 80 - (Date.now() - this.lastPointerSend));
    this.pointerSendTimer = setTimeout(() => {
      this.pointerSendTimer = null;
      const p = this.pendingPointer;
      this.pendingPointer = null;
      if (!p || !this.localPointerActive) return;
      this.lastPointerSend = Date.now();
      this.syncSession?.sendPointer(p.x, p.y).catch(() => {});
    }, wait);
  }

  endLocalPointer() {
    this.localPointerActive = false;
    this.pendingPointer = null;
    if (this.pointerSendTimer) {
      clearTimeout(this.pointerSendTimer);
      this.pointerSendTimer = null;
    }
    const el = this.pointerEls.get('local');
    if (el) {
      this.pointerEls.delete('local');
      this.removePointerEl(el);
    }
    this.syncSession?.clearPointer().catch(() => {});
  }

  // Reconciles the remote peers' pointers against what is currently on screen:
  // adds newcomers (chevrons fly in), moves existing ones as a unit, and fades
  // out those that were released.
  renderRemotePointers(others) {
    if (!this.readerEl) return; // a late sync callback after the view is gone
    for (const [id, pos] of Object.entries(others)) {
      let el = this.pointerEls.get(id);
      if (el && el.dataset.leaving) { el.remove(); el = null; }
      if (!el) {
        el = this.createPointerEl(id, pos.x, pos.y);
        this.pointerEls.set(id, el);
      } else {
        this.setPointerPosition(el, pos.x, pos.y);
      }
    }
    for (const [id, el] of this.pointerEls) {
      if (id === 'local') continue;
      if (!(id in others)) {
        this.pointerEls.delete(id);
        this.removePointerEl(el);
      }
    }
  }

  // Wipes every pointer (local + remote) instantly. Called on a page turn so
  // pointers never bleed across pages.
  clearAllPointers() {
    if (this.localPointerActive) {
      this.localPointerActive = false;
      this.pendingPointer = null;
      if (this.pointerSendTimer) {
        clearTimeout(this.pointerSendTimer);
        this.pointerSendTimer = null;
      }
      this.syncSession?.clearPointer().catch(() => {});
    }
    // Wipe the layer wholesale rather than looping this.pointerEls: a remote
    // pointer that was just released is mid-fade-out — already gone from the
    // map but still animating in the DOM — and must not linger onto the new
    // page. removePointerEl's safety-timeout remove() on these now-detached
    // nodes is a harmless no-op.
    const page = this.root.querySelector('.pointer-page');
    if (page) page.replaceChildren();
    this.pointerEls.clear();
  }

  handleKey(e) {
    // Any key dismisses the help overlay. Escape is consumed by that dismissal
    // (it must not fall through and close the whole reader); every other key
    // then acts as usual, mirroring how a tap closes the help and still
    // performs the tapped action.
    //
    // The „?" button is the one exception, for exactly the reason openHelp's
    // dismiss listener skips its pointerdown: the button toggles the help
    // itself, so closing it here would only let its own activation reopen it a
    // moment later. Enter and Space on it are left to the button.
    if (this.helpOpen) {
      const closesHelpItself = (e.key === 'Enter' || e.key === ' ')
        && e.target.closest?.('.reader-help-btn');
      if (!closesHelpItself) this.closeHelp();
      if (e.key === 'Escape') return;
    }
    // These shortcuts belong to the page, not to whatever control has focus:
    // space on „← Bibliothek" must press that button (the preventDefault below
    // would otherwise swallow its activation), and the arrow keys inside the
    // sync-code field must move the caret. Solved once at the root instead of
    // a stopPropagation() on every field.
    //
    // .reader-page-indicator is named on top of [role="button"] because it
    // changes shape mid-event: its own space handler swaps the label for the
    // page-jump input and strips role/tabindex in the process, so by the time
    // this listener runs on window the role is already gone and the key would
    // fall through to goNext() — opening the jump and turning the page at once.
    //
    // Escape is the deliberate exception — it is the only keyboard way out of
    // the reader, so it must reach here from anywhere. Controls that need it
    // for something nearer (the page-jump field aborts its own editing) stop
    // it on their way past.
    const OWNED_BY_A_CONTROL = 'input, textarea, select, button, [contenteditable], [role="button"], .reader-page-indicator';
    if (e.key !== 'Escape' && e.target.closest?.(OWNED_BY_A_CONTROL)) return;
    // The loupe's keyboard equivalent. „=" comes along because it shares its
    // key with „+" on the common layouts, so it lands whether or not Shift was
    // held. These two walk the ladder rather than wrapping around it: „−" on a
    // page that is already at 1× should do nothing, not jump it to 2×.
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      this.stepZoom(true);
      return;
    }
    if (e.key === '-') {
      e.preventDefault();
      this.stepZoom(false);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      this.goNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      this.goPrev();
    } else if (e.key === 'Escape') {
      // Escape peels off one layer at a time: an open sync panel is what the
      // reader wants closed first, and only a reader with nothing on top of it
      // closes the book. Anything else would make the same key mean „leave the
      // book" in one overlay and „close the overlay" in the next (rule 1).
      const panel = this.root.querySelector('.sync-panel');
      if (panel && !panel.hidden) {
        this.closeSyncPanel();
        return;
      }
      this.close();
    }
  }

  async goNext() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      await this.renderCurrent();
      if (this.syncSession) this.syncSession.sendPage(this.currentPage).catch(() => {});
    } else {
      // Every finish opens the closing overlay (issue #79): a synced pair runs
      // the full mood ritual, while solo (or synced-but-alone) bows out to the
      // same warm „Ende" closure with no keepsake. Turning forward past the last
      // page is one of its two triggers (the persistent finish cue is the other).
      this.openMood(true);
    }
  }

  async goPrev() {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.renderCurrent();
      if (this.syncSession) this.syncSession.sendPage(this.currentPage).catch(() => {});
    }
  }

  // Flip the local page-navigation toggle, persist it, and reflect it in the UI.
  // The chrome is held for the short wait, not the long one: the button's own
  // state change is the entire feedback, and it happens under the finger that
  // asked for it.
  toggleNav() {
    this.navEnabled = !this.navEnabled;
    saveNavEnabled(this.navEnabled);
    this.applyNavState();
    this.showChrome(HIDE_CHROME_AFTER_ACTION_MS);
  }

  // Single source of truth: the `nav-off` class on the reader root drives the
  // zones' pointer fall-through (CSS) and the toggle button's crossed-out look.
  // The zones are also made `inert` so that, with navigation off, keyboard and
  // assistive-technology users can't focus or activate the invisible page-turn
  // buttons either. Swipe is gated in JS via this.navEnabled.
  applyNavState() {
    const reader = this.readerEl;
    if (!reader) return;
    reader.classList.toggle('nav-off', !this.navEnabled);
    const btn = reader.querySelector('.reader-nav-toggle');
    if (btn) btn.setAttribute('aria-pressed', String(this.navEnabled));
    reader.querySelectorAll('.reader-zone').forEach((zone) => {
      zone.inert = !this.navEnabled;
    });
  }

  // --- Page loupe (issue #117) --------------------------------------------

  // How much the page would have to grow to fill the stage's width exactly.
  // Derived from the page's own proportions, which no zoom step changes, so it
  // reads the same at every step and cannot chase itself. Greater than 1 only
  // while the page is letterboxed sideways — a portrait page on a landscape
  // screen, which is a grandparent holding an iPad the usual way round.
  fillWidthFactor() {
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    if (!canvas || !stage) return 1;
    // Measured with getBoundingClientRect, not offsetWidth: those are whole
    // pixels, and a proportion taken from rounded numbers is off by enough that
    // the factor derived from it lands a pixel beside full width — and, because
    // the next reading is then taken from that page, wanders back and forth by
    // a pixel each time the step is revisited. The fractional rect is exact, so
    // the factor is the same number however often it is worked out.
    const r = canvas.getBoundingClientRect();
    const widthAtFullHeight = r.height ? stage.clientHeight * (r.width / r.height) : 0;
    if (!widthAtFullHeight) return 1;
    return Math.max(1, stage.clientWidth / widthAtFullHeight);
  }

  // The ladder in force for the page on screen. „Fills the width" is the most
  // useful magnification there is on a landscape screen: as large as the page
  // can be while still only ever moving in one direction, with no screen left
  // over at the sides. It takes its place among the fixed rungs and absorbs any
  // neighbour it nearly coincides with, so no two rungs are a hand's breadth
  // apart. Where it is not a different thing at all — a page already filling
  // the width, or a sliver of a page whose full width would be a wild jump —
  // it drops out and the plain ladder stands.
  //
  // Computed rather than stored because it depends on the page and the stage:
  // turning the iPad, or turning to a page of different proportions, changes
  // what „full width" means, and the rung should mean it on the page in hand.
  zoomSteps() {
    const fill = this.fillWidthFactor();
    if (fill < STEP_MERGE_RATIO || fill > FILL_WIDTH_MAX) return ZOOM_STEPS;
    const steps = ZOOM_STEPS.filter((step) => (
      Math.max(step, fill) / Math.min(step, fill) >= STEP_MERGE_RATIO
    ));
    steps.push(fill);
    return steps.sort((a, b) => a - b);
  }

  zoomFactor() {
    return this.zoom;
  }

  // The loupe holds a factor, not a rung number. The ladder is not a fixed
  // series — turning the device changes what „fills the width" means, and with
  // it the ladder — so a stored position on it would silently come to mean
  // something else and resize the page under the reader's hands. Holding the
  // factor instead leaves the page exactly as large as it was, and the next tap
  // simply takes the next rung of the ladder now in force.
  cycleZoom() {
    const steps = this.zoomSteps();
    this.applyZoom(steps.find((step) => step > this.zoom * SAME_STEP) ?? steps[0]);
  }

  // „+" and „−" walk the same ladder without wrapping, which is what those keys
  // mean everywhere else: at the top „+" does nothing, at 1× „−" does nothing.
  stepZoom(up) {
    const steps = this.zoomSteps();
    const next = up
      ? steps.find((step) => step > this.zoom * SAME_STEP)
      : steps.findLast((step) => step < this.zoom / SAME_STEP);
    if (next) this.applyZoom(next);
  }

  applyZoom(factor) {
    if (!factor || factor === this.zoom) return;
    // The offset is measured in page pixels, so growing it with the page keeps
    // whatever the reader is looking at in the middle of the screen instead of
    // sliding the view back towards the page's centre on every step.
    const ratio = factor / this.zoom;
    this.zoom = factor;
    this.panX *= ratio;
    this.panY *= ratio;
    this.clampPan();
    // The page takes the new size at once, stretched from the render in hand,
    // and sharpens a moment later when the new one arrives (see displayScale).
    // A button that resizes the page only once the render lands would feel
    // like a button that sometimes did nothing.
    this.applyPan();
    this.applyZoomState();
    this.showChrome();
    this.renderCurrent();
  }

  // What the rendered canvas has to be multiplied by to show the factor in
  // force: 1 whenever the render has caught up, and something else only while
  // one is in flight or while a pinch is under way.
  displayScale() {
    return this.renderedZoom > 0 ? this.zoom / this.renderedZoom : 1;
  }

  // Single source of truth for the magnified state: the `zoomed` class on the
  // reader root frees the canvas from its fit-the-stage sizing (CSS) and keeps
  // the loupe on screen while the rest of the chrome slides away, so the way
  // back to 1× is always in reach. The factor rides in the button itself rather
  // than in a separate indicator — the control and its state in one place.
  applyZoomState() {
    const reader = this.readerEl;
    if (!reader) return;
    const zoom = this.zoomFactor();
    // The fit-the-stage caps have to stay off for as long as the canvas is
    // *laid out* larger than the stage, which outlasts the factor itself:
    // pinching back to 1× takes effect immediately, while the canvas keeps its
    // old size until the render catches up, and a cap applied in between would
    // squeeze the page out of shape for those few frames.
    reader.classList.toggle('zoomed', Math.max(zoom, this.renderedZoom) > 1);
    // While the fingers are on the page the loupe is the only feedback there
    // is, so it stays up and counts along even at 1×, where nothing else on
    // screen would say that a gesture is being heard at all (rule 3).
    reader.classList.toggle('pinching', this.pinching);
    // At rest 1× shows no factor — an unmagnified page is the ordinary state
    // and needs no label. Under the fingers it does: the loupe is then a live
    // readout, and „1×" is how the reader sees that pinching back down has
    // arrived rather than nearly arrived.
    const factor = reader.querySelector('.reader-zoom-factor');
    if (factor) factor.textContent = (zoom > 1 || this.pinching) ? formatZoom(zoom) : '';
  }

  // How far the page can travel from its resting position, per axis: half its
  // overhang, which is exactly the offset that brings one of its edges to the
  // matching edge of the stage (the page rests centred). Zero on an axis where
  // the page fits — an unmagnified page has no play at all, and a magnified one
  // often still has none sideways, because a portrait page on a landscape
  // screen stays letterboxed for a step or two.
  panPlay() {
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    if (!canvas || !stage) return { x: 0, y: 0 };
    // A couple of pixels of overhang are not room to move, they are a rounding
    // remainder — these are whole layout pixels, and the full-width rung lands
    // on exactly that kind of remainder. Left in, it would be enough to latch a
    // drag and swallow the swipe that should have turned the page, so the one
    // rung meant to make sideways swiping reliable would be the one that broke
    // it. Nothing is lost: the last two pixels of a page are not a view.
    const room = (page, view) => {
      const half = (page - view) / 2;
      return half > PAN_SLACK_PX ? half : 0;
    };
    // Measured against the size the page is *shown* at, not the size it was
    // rendered at: mid-pinch those differ, and the play has to follow the page
    // the reader can see, or a page grown under two fingers could not be moved
    // until its render arrived.
    const shown = this.displayScale();
    return {
      x: room(canvas.offsetWidth * shown, stage.clientWidth),
      y: room(canvas.offsetHeight * shown, stage.clientHeight),
    };
  }

  // Holds the page against its own edges. Also what snaps the offset back to
  // zero when the loupe returns to 1×, and what takes in a page turn to a page
  // with less room to give.
  clampPan() {
    const play = this.panPlay();
    this.panX = Math.min(play.x, Math.max(-play.x, this.panX));
    this.panY = Math.min(play.y, Math.max(-play.y, this.panY));
  }

  // Whether a drag this way has anywhere to go — asked of the direction the
  // finger is actually taking, not just of the axis. A page with no sideways
  // play cannot be moved sideways at all, and a page already held against its
  // right edge cannot be moved further right either; rather than let the drag
  // come to nothing, it stays what it was before the loupe existed: a page
  // turn. That makes the far edge of a magnified page the place where swiping
  // on turns the page, which is what a reader who has just read to the edge is
  // reaching for anyway.
  canPanAlong(dx, dy) {
    if (this.zoomFactor() === 1) return false;
    const play = this.panPlay();
    // A drag to the right (dx > 0) carries the page right, raising panX towards
    // +play.x; a drag to the left lowers it towards -play.x. Same for dy.
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? this.panX < play.x : this.panX > -play.x;
    }
    return dy > 0 ? this.panY < play.y : this.panY > -play.y;
  }

  // Writes the offset onto the page and drags the pointer coordinate space
  // along with it, so a partner's pointer stays glued to its spot on the page
  // while the page moves under it.
  applyPan() {
    const canvas = this.root.querySelector('.reader-canvas');
    if (!canvas) return;
    // Translate before scale, so the offset stays what it has always been:
    // screen pixels from the page's centred resting position. The scale is the
    // stand-in for a render still to come (see displayScale) and is 1 — and
    // absent from the transform — at rest.
    const shown = this.displayScale();
    const move = (this.panX || this.panY) ? `translate(${this.panX}px, ${this.panY}px)` : '';
    const grow = shown === 1 ? '' : `scale(${shown})`;
    canvas.style.transform = [move, grow].filter(Boolean).join(' ');
    this.syncPointerPageGeometry();
  }

  panTo(x, y) {
    this.panX = x;
    this.panY = y;
    this.clampPan();
    this.applyPan();
  }

  // Puts the magnified section where a page starts: its top, and its left edge
  // where there is sideways play at all. The page rests centred, so „the
  // beginning" is the full positive offset on both axes rather than zero — and
  // zero play (an unmagnified page, or the full-width rung sideways) simply
  // leaves that axis alone. Used on a page turn, in both directions: a page
  // begins at its beginning whichever way the reader arrived at it.
  panToPageStart() {
    const play = this.panPlay();
    this.panX = play.x;
    this.panY = play.y;
    this.applyPan();
  }

  scheduleRender() {
    // The help callouts were positioned for the old layout; a resize (e.g. an
    // orientation change) invalidates them, so the help simply closes.
    if (this.helpOpen) this.closeHelp();
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(() => this.renderCurrent(), 120);
  }

  // Renders queue rather than overlap. renderPage only takes effect at the end
  // of an await, and every render writes the same canvas, so two in flight land
  // in whatever order their page data happens to arrive: the loser's dimensions
  // are the ones that stay. Tapping the loupe twice in quick succession is
  // exactly that case, and it would leave the page at 1,5× while the button
  // says 2× — renderToken alone cannot prevent it, because by the time it is
  // checked the canvas has already been written. Queued, each render has the
  // canvas to itself, and one that a newer render has overtaken in the meantime
  // steps aside before touching anything.
  renderCurrent() {
    const token = ++this.renderToken;
    this.renderQueue = this.renderQueue
      .then(() => this.renderPass(token))
      .catch(() => {}); // keep the queue alive for the next render
    return this.renderQueue;
  }

  async renderPass(token) {
    if (token !== this.renderToken) return;
    if (!this.source) return;
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    // getBoundingClientRect statt clientWidth/clientHeight: die sind auf ganze
    // Pixel gerundet (dieselbe Überlegung wie in fullWidthFactor). Seit die
    // Seiten exakt 3:4 sind (ADR 28) und der Bildschirm des iPads ebenfalls,
    // entscheidet ein halber Pixel Rundung darüber, ob die Seite höhen- oder
    // breitenbegrenzt eingepasst wird — und damit, ob sie randlos sitzt oder
    // schmale Ränder bekommt.
    const box = stage.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    // The magnified page is rendered at its magnified size rather than scaled
    // up afterwards, so the print gets genuinely sharper and not merely bigger
    // (issue #117). What sticks out past the stage is clipped there and brought
    // into view by panning.
    const zoom = this.zoomFactor();
    let rendered = false;
    try {
      await this.source.renderPage(this.currentPage, canvas, box.width * zoom, box.height * zoom, zoom);
      rendered = true;
    } catch (err) {
      if (token !== this.renderToken) return;
      console.error('Render-Fehler', err);
    }
    if (token !== this.renderToken) return;
    // The canvas now carries this factor at its true size, so the stand-in
    // scale has nothing left to stand in for — unless the render failed, in
    // which case the page stays stretched, which is the honest picture: the
    // factor is in force, it is merely not sharp.
    if (rendered) this.renderedZoom = zoom;
    this.applyZoomState();
    const pageChanged = this.lastRenderedPage !== this.currentPage;
    // Re-overlay the pointer space onto the (possibly resized) page before any
    // pointer is placed, so positions are page-relative on this render too. The
    // factor is kept across page turns and resizes — the loupe lies on the book
    // — but the section does not: a new page begins at its beginning, while a
    // resize or a rotation leaves the reader where they were reading (ADR 24).
    if (pageChanged) {
      this.panToPageStart();
    } else {
      this.clampPan();
      this.applyPan();
    }
    // Clear pointers only when the page actually changes, not on a re-render
    // from a resize, so a pointer survives an orientation change mid-gesture.
    if (pageChanged) {
      this.clearAllPointers();
      this.lastRenderedPage = this.currentPage;
    }
    this.updateIndicator();
    this.updateMoodCue();
    updateLastPage(this.bookId, this.currentPage).catch(() => {});
  }

  // „Seite" rides in its own span so the phone stylesheet can drop the word and
  // keep the numbers, which is what lets every control in the bar reach 44px on
  // a narrow screen (issue #130). Written from one place because the page jump
  // rewrites the indicator when it closes, and the two must not disagree about
  // its shape. Deliberately no aria-label mirroring the page number here: a
  // label that has to be kept in step with the page inside this method is the
  // exact drift ADR 22 declines to take on.
  writeIndicator(page) {
    const ind = this.root.querySelector('.reader-page-indicator');
    const word = document.createElement('span');
    word.className = 'page-indicator-word';
    word.textContent = 'Seite';
    ind.replaceChildren(word, document.createTextNode(`${page} / ${this.totalPages}`));
  }

  updateIndicator() {
    const ind = this.root.querySelector('.reader-page-indicator');
    if (ind.querySelector('.page-jump-input')) return;
    this.writeIndicator(this.currentPage);
  }

  openPageJump() {
    const ind = this.root.querySelector('.reader-page-indicator');
    if (ind.querySelector('.page-jump-input')) return;

    clearTimeout(this.hideTimer);
    this.pageJumpOpen = true;

    ind.removeAttribute('role');
    ind.removeAttribute('tabindex');
    ind.textContent = '';
    const input = document.createElement('input');
    input.className = 'page-jump-input';
    input.style.width = `${this.totalPages.toString().length + 1}ch`;
    input.type = 'number';
    input.min = 1;
    input.max = this.totalPages;
    input.value = this.currentPage;
    input.setAttribute('aria-label', 'Gehe zu Seite');
    ind.appendChild(input);

    const suffix = document.createElement('span');
    suffix.className = 'page-jump-suffix';
    suffix.textContent = `/ ${this.totalPages}`;
    ind.appendChild(suffix);

    input.focus();
    input.select();

    const commit = () => {
      const val = parseInt(input.value, 10);
      const page = isNaN(val) ? this.currentPage : Math.min(Math.max(val, 1), this.totalPages);
      // Not even the short wait here: the page that was asked for is itself the
      // answer, and the bar is lying across the top of it.
      this.closePageJump(page);
      this.hideChrome();
      this.goToPage(page);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') this.closePageJump();
    });
    input.addEventListener('blur', () => this.closePageJump());
  }

  // The field goes and the focus goes with it — nowhere, that is: removing the
  // input leaves the focus on <body>. Nobody jumps twice in a row, and anyone
  // who does can tap the indicator again while the bar is still there. Handing
  // the focus back to the indicator instead used to keep the whole bar on
  // screen for the rest of the reading (issue #179), and swallowed the arrow
  // keys with it (OWNED_BY_A_CONTROL in handleKey).
  //
  // Reached without a page when the jump was abandoned (Escape, or a press
  // somewhere else), which is why the bar keeps the short wait rather than
  // being taken away: nothing changed, so nothing has to be uncovered.
  //
  // Guarded on the flag rather than on the field still being in the DOM,
  // because this method re-enters itself: writing the indicator takes the
  // focused input out, Chromium fires `blur` synchronously as it goes, and that
  // handler calls back in here. On a DOM guard the nested call still found the
  // half-removed input, rewrote the indicator underneath the outer call, and
  // left it to throw out of replaceChildren — taking the goToPage below it with
  // it, so Enter jumped nowhere at all.
  closePageJump(page) {
    if (!this.pageJumpOpen) return;
    this.pageJumpOpen = false;
    const ind = this.root.querySelector('.reader-page-indicator');
    ind.setAttribute('role', 'button');
    ind.setAttribute('tabindex', '0');
    this.writeIndicator(page !== undefined ? page : this.currentPage);
    this.showChrome(HIDE_CHROME_AFTER_ACTION_MS);
  }

  async goToPage(page) {
    if (page === this.currentPage) return;
    this.currentPage = page;
    await this.renderCurrent();
    if (this.syncSession) this.syncSession.sendPage(this.currentPage).catch(() => {});
  }

  // A tap or click on the page, away from the turn zones: the chrome comes up,
  // and the same gesture takes it away again (issue #176). Before, every tap
  // only pushed the four-second auto-hide out again, so a page could not be
  // cleared at all while it was being touched — the way back was to wait and
  // not touch the screen (rules 6 and 7).
  //
  // `y` is where the press landed. Two exceptions, both about a gesture not
  // undoing what it just did:
  //   • Near the top edge the tap only ever shows. That band is where the bar
  //     itself sits, so a finger reaching for one of its controls and missing
  //     would otherwise push away the very thing it was aiming at (rule 5). It
  //     is the band a mouse already reveals the chrome in by hovering, which
  //     makes the edge mean the same thing on both kinds of device (rule 1).
  //   • A gesture that found the help or the page-jump field open has already
  //     closed it, and closing left the chrome behind on purpose. Hiding it in
  //     the same beat would be two changes for one tap. That errand is done
  //     though, so the bar stays for the short wait, not for a new search.
  tapChrome(y) {
    const hidden = this.readerEl?.classList.contains('chrome-hidden');
    if (!hidden && !this.chromePinnedAtPress && y > CHROME_REVEAL_BAND_PX) {
      this.hideChrome();
      return;
    }
    this.showChrome(this.chromePinnedAtPress ? HIDE_CHROME_AFTER_ACTION_MS : HIDE_CHROME_AFTER_MS);
  }

  // The counterpart to showChrome, for the two moments the bar has to go at
  // once rather than after a wait: a tap that means „away with it" (tapChrome,
  // which is where the cases that must not conceal the bar are decided), and a
  // committed page jump, which needs the page it just fetched uncovered. The
  // pending auto-hide goes with it: the bar is already away, so there is
  // nothing left for that timer to do.
  hideChrome() {
    clearTimeout(this.hideTimer);
    this.readerEl?.classList.add('chrome-hidden');
  }

  // `after` says which of the two waits applies: the long one while a control
  // still has to be found, the short one once one has been used and only its
  // receipt is still owed.
  showChrome(after = HIDE_CHROME_AFTER_MS) {
    const reader = this.readerEl;
    if (!reader) return;
    reader.classList.remove('chrome-hidden');
    clearTimeout(this.hideTimer);
    // While the page-jump input, the help overlay or the sync panel is up, the
    // chrome must not slide away under the user: the first two live inside it
    // (the help's callouts point at its controls), and the third was opened
    // from it and reports back to the button that opened it.
    if (this.pageJumpOpen || this.helpOpen || this.syncPanelOpen) return;
    this.hideTimer = setTimeout(() => {
      reader.classList.add('chrome-hidden');
    }, after);
  }

  showCursor() {
    const reader = this.readerEl;
    if (!reader) return;
    if (reader.classList.contains('cursor-hidden')) {
      reader.classList.remove('cursor-hidden');
    }
    const now = Date.now();
    if (!this._lastCursorReset || now - this._lastCursorReset > 250) {
      this._lastCursorReset = now;
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        reader.classList.add('cursor-hidden');
      }, CURSOR_IDLE_MS);
    }
  }

  // --- Help overlay --------------------------------------------------------

  // The chrome's "?" explains the reader in place: a dimmed scrim with short
  // callouts on every control — including the two invisible page-turn zones
  // and the long-press pointing gesture, which are otherwise undiscoverable.
  // The overlay never intercepts input (pointer-events: none in CSS); instead
  // a capture-phase pointerdown listener dismisses it, so tapping a labelled
  // control closes the help AND performs that control's normal action in the
  // same tap, while a tap on empty space just closes it.
  toggleHelp() {
    if (this.helpOpen) this.closeHelp();
    else this.openHelp();
  }

  openHelp() {
    if (this.helpOpen || !this.readerEl) return;
    this.helpOpen = true;
    const reader = this.readerEl;
    reader.classList.add('help-open');
    reader.querySelector('.reader-help-btn').setAttribute('aria-expanded', 'true');
    // Pin the chrome up while the help is open (the helpOpen guard in
    // showChrome suppresses the auto-hide) so the callouts' targets stay put.
    this.showChrome();

    const overlay = document.createElement('div');
    // Purely visual: every callout repeats what the target's own label or
    // aria-label already provides, so the overlay is hidden from AT.
    overlay.setAttribute('aria-hidden', 'true');
    overlay.className = 'help-overlay';
    overlay.innerHTML = `
      <div class="help-band help-band-prev"></div>
      <div class="help-band help-band-next"></div>
    `;
    this.helpOverlay = overlay;
    reader.appendChild(overlay);

    this.addHelpHint('help-hint-zone help-hint-zone-prev', 'Zurück', { glyph: '◀' });
    this.addHelpHint('help-hint-zone help-hint-zone-next', 'Weiter', { glyph: '▶' });
    // Both gestures exist on both kinds of device, so no callout appears or
    // disappears with the hardware — they name „Finger" or „Maus" after what
    // the reader last used, which for the help is whatever they just opened it
    // with (issue #121).
    const holdLabel = this.lastInputWasMouse
      ? 'Linke Maustaste gedrückt halten: auf die Seite zeigen'
      : 'Finger gedrückt halten: auf die Seite zeigen';
    // The second line is the only place the tap-toggle is spelled out: it
    // reveals nothing on the page, so without it the way to clear the bar again
    // is undiscoverable (issue #176).
    // „In die Mitte", weil die Ränder etwas anderes tun: links und rechts wird
    // geblättert, und ganz oben holt die Geste die Leiste nur hervor.
    const tapLabel = this.lastInputWasMouse
      ? 'Kurz in die Mitte klicken: Leiste ein- und ausblenden'
      : 'Kurz in die Mitte tippen: Leiste ein- und ausblenden';
    this.addHelpHint('help-hint-center', holdLabel, {
      sub: ['beim gemeinsamen Lesen', tapLabel],
    });
    // Placed in CSS above the loupe rather than through addChromeHelpHints:
    // that one hangs its bubbles below their control, which for a button in the
    // bottom corner would put the label off the screen.
    this.addHelpHint('help-hint-zoom', 'Seite vergrössern', {
      controlGlyph: '🔍',
      sub: this.lastInputWasMouse
        ? 'vergrössert: mit der Maus verschieben'
        : 'vergrössert: mit dem Finger verschieben',
    });
    this.addChromeHelpHints();
    this.applyHelpLayout();

    // Dismissed on the release, not on the press, so that a swipe scrolls the
    // list layout instead of taking it away — that layout is the one thing here
    // that accepts a pointer at all. For the spatial layout it comes to the same
    // thing: the overlay takes no pointers, so the press still reaches the
    // control underneath and the help goes an instant later.
    let from = null;
    const down = (e) => {
      // The ? button has its own toggle handler; consuming its press here would
      // close the help only to have the click reopen it.
      from = e.target.closest?.('.reader-help-btn') ? null : { x: e.clientX, y: e.clientY };
    };
    const up = (e) => {
      const start = from;
      from = null;
      if (!start || e.type === 'pointercancel') return;
      if (Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX
        || Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX) return;
      this.closeHelp();
    };
    this._helpDismiss = { down, up };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  // One callout bubble. `glyph` stacks a large chevron above the text (the
  // page-turn zones); `sub` adds smaller lines below it — one string or several
  // (the pointing hint, which also names what a plain tap does).
  //
  // `controlGlyph` names the control the callout belongs to. It is invisible in
  // the spatial layout, where the arrow already says which control is meant, and
  // appears only in the list layout below, where there is no arrow left to say
  // it (issue #125).
  addHelpHint(className, text, { glyph, controlGlyph, sub } = {}) {
    const hint = document.createElement('div');
    hint.className = `help-hint ${className}`;
    if (glyph) {
      const g = document.createElement('span');
      g.className = 'help-hint-glyph';
      g.textContent = glyph;
      hint.appendChild(g);
    }
    if (controlGlyph) {
      const g = document.createElement('span');
      g.className = 'help-hint-control-glyph';
      g.textContent = controlGlyph;
      hint.appendChild(g);
    }
    const label = document.createElement('span');
    label.className = 'help-hint-text';
    label.textContent = text;
    hint.appendChild(label);
    for (const line of [sub].flat()) {
      if (!line) continue;
      const s = document.createElement('span');
      s.className = 'help-hint-sub';
      s.textContent = line;
      hint.appendChild(s);
    }
    this.helpOverlay.appendChild(hint);
    return hint;
  }

  // Callouts for the chrome controls, placed under each target with an arrow
  // running up to it. Positioned at open time from the live layout (the bar is
  // a flex row, so the targets' positions vary with viewport and title width).
  // Bubbles stagger across tiers: each starts on its preferred tier and drops
  // a tier while it would horizontally overlap an already-placed bubble, so on
  // a wide screen they sit in two neat rows and on a cramped phone they
  // cascade instead of colliding. A resize closes the help (see
  // scheduleRender) rather than repositioning.
  //
  // Two passes, because both numbers the tier maths needs are measured ones.
  // The step between tiers used to be a constant (46px, „> bubble height"),
  // which held only while every label stayed on one line. Now that type follows
  // the system font size (issue #125), „Zurück zur Bibliothek" is three lines
  // tall at twice the size and the tiers sat on top of each other. The step now
  // comes from the tallest bubble actually measured. For the same reason every
  // bubble hangs from the bottom of the *lowest* control rather than from its
  // own target's: at large type the bar may wrap, and two different starting
  // heights break the tier arithmetic. The arrows are unaffected — each is
  // still measured to its own target.
  addChromeHelpHints() {
    const reader = this.readerEl;
    const base = reader.getBoundingClientRect();
    const targets = [
      ['.reader-back', 'Zurück zur Bibliothek', 0],
      ['.reader-sync-btn', 'Gemeinsam lesen', 1],
      ['.reader-nav-toggle', 'Umblättern an / aus', 0],
      ['.reader-page-indicator', 'Zu einer Seite springen', 1],
    ];
    const bubbles = [];
    for (const [selector, text, preferredTier] of targets) {
      const target = reader.querySelector(selector);
      if (!target) continue;
      // innerText, not textContent: it gives what is actually on screen — „←"
      // and „12 / 148" on a phone, „← Bibliothek" and „Seite 12 / 148" on a
      // tablet. That is exactly what the list needs to point back at the bar
      // once there is no arrow left doing it.
      const hint = this.addHelpHint('help-hint-chrome', text, {
        controlGlyph: target.innerText.trim(),
      });
      const arrow = document.createElement('span');
      arrow.className = 'help-hint-arrow';
      hint.appendChild(arrow);
      bubbles.push({ hint, arrow, r: target.getBoundingClientRect(), preferredTier });
    }
    if (!bubbles.length) return;
    // 11px Luft zwischen den Etagen — dasselbe, was die alte Konstante bei einer
    // einzeiligen Blase liess (46 minus deren 35), damit sich bei normaler
    // Schriftgrösse nichts verschiebt.
    const tierStep = Math.max(...bubbles.map((b) => b.hint.offsetHeight)) + 11;
    const rowBottom = Math.max(...bubbles.map((b) => b.r.bottom)) - base.top;
    const placed = []; // { tier, left, right } of every bubble already laid out
    for (const { hint, arrow, r, preferredTier } of bubbles) {
      const targetX = r.left + r.width / 2 - base.left;
      const targetBottom = r.bottom - base.top;
      // Centre the bubble on its target, clamped to the viewport; the arrow
      // then leans back to stay on the target.
      const width = hint.offsetWidth;
      const left = Math.max(8, Math.min(base.width - 8 - width, targetX - width / 2));
      const right = left + width;
      let tier = preferredTier;
      while (placed.some((p) => p.tier === tier && left < p.right + 8 && right > p.left - 8)) {
        tier++;
      }
      placed.push({ tier, left, right });
      const top = rowBottom + 10 + tier * tierStep;
      hint.style.top = `${top}px`;
      hint.style.left = `${left}px`;
      arrow.style.left = `${Math.max(12, Math.min(width - 12, targetX - left))}px`;
      arrow.style.height = `${top - targetBottom}px`;
    }
  }

  // The spatial layout, or the list. Six callouts anchored to what they name is
  // the better answer and holds on every screen at ordinary type — and on a
  // tablet well past that. On a phone at twice the size it stops being possible:
  // the four chrome bubbles cascade into the middle of the page and land on the
  // zone and gesture callouts, which hang from the page itself. Six bubbles that
  // size do not fit a phone, and no placement makes them.
  //
  // So the layout yields, in the order ADR 23 set for the bar it explains: first
  // the words went, now the arrangement. The callouts become one plain list —
  // each row the control's own glyph and what it does. What is lost is the line
  // from a label to its button; what is kept is every word of it, which at this
  // type size is what was asked for.
  //
  // The trigger is measured, never a breakpoint. Whether the bubbles fit depends
  // on the type size, and a media query cannot see that one: `em` in a media
  // query is the browser's default, not our root — so on iOS, where the size
  // comes from Dynamic Type, a query would be blind to the very setting this is
  // about (ADR 31). The overlay is already laid out at this point, so the honest
  // question is simply how it came out.
  //
  // A quarter of the smaller bubble, not any overlap at all: the zone labels and
  // the gesture callout in the middle of the page have always grazed each other
  // on a narrow phone — 5 % at 320px, and it has never been worth a word. What
  // this is looking for is a bubble sitting on another one's text, which starts
  // around half again the normal size and is past 50 % by twice it.
  applyHelpLayout() {
    const overlay = this.helpOverlay;
    if (!overlay) return;
    const base = this.readerEl.getBoundingClientRect();
    const rects = [...overlay.querySelectorAll('.help-hint')].map((h) => h.getBoundingClientRect());
    const offScreen = rects.some((r) => r.top < base.top - 1 || r.bottom > base.bottom + 1
      || r.left < base.left - 1 || r.right > base.right + 1);
    const buried = rects.some((a, i) => rects.some((b, j) => {
      if (j <= i) return false;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= 0 || h <= 0) return false;
      return w * h > 0.25 * Math.min(a.width * a.height, b.width * b.height);
    }));
    if (offScreen || buried) overlay.classList.add('help-list');
  }

  closeHelp() {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    if (this._helpDismiss) {
      window.removeEventListener('pointerdown', this._helpDismiss.down, true);
      window.removeEventListener('pointerup', this._helpDismiss.up, true);
      window.removeEventListener('pointercancel', this._helpDismiss.up, true);
      this._helpDismiss = null;
    }
    this.helpOverlay?.remove();
    this.helpOverlay = null;
    this.readerEl?.classList.remove('help-open');
    this.readerEl?.querySelector('.reader-help-btn')?.setAttribute('aria-expanded', 'false');
    // Re-arm the chrome auto-hide that openHelp suspended. The short wait: the
    // same press that dismissed the help usually worked a control too, and what
    // is left to show is that control's answer.
    this.showChrome(HIDE_CHROME_AFTER_ACTION_MS);
  }

  // --- Shared reading memory ("mood ritual", issue #65) -------------------

  // The persistent invitation on the last page. It appears for any reader —
  // synced or solo (issue #79) — sitting on the final page with no overlay
  // already up, so it can't compete with the open mood screen. Solo, it leads to
  // the same closing beat it promises („Buch schliessen" → „Ende").
  updateMoodCue() {
    const cue = this.root.querySelector('.reader-finish-cue');
    if (!cue) return;
    const show = this.currentPage === this.totalPages
      && this.totalPages > 0
      && !this.moodOpen;
    cue.hidden = !show;
  }

  // Entry point for both triggers (finish cue, forward-turn). `initiate` is true
  // for the device that started the ritual: it rolls the random board, flags the
  // room, and publishes that board so the partner's listener opens the same one.
  // A device opening in response to that flag passes false and the partner's
  // `order`, and must not re-flag (which would wipe picks already in).
  openMood(initiate, order) {
    if (this.moodOpen) return;
    const session = this.syncSession;
    this.moodOpen = true;
    this.moodRevealed = false;
    this.moodSettled = false;
    // The board is a random subset of the catalogue; both devices must show the
    // identical one. The initiator rolls it and publishes it with the `open`
    // flag in one write, so a follower always arrives with the order in hand.
    this.moodOrder = (order && order.length) ? order : pickMoodBoard(MOOD_BOARD_COUNT);
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.moodPresentIds = [];
    this.updateMoodCue();
    this.renderMoodOverlay();
    // Sync writes only when there's a partner to coordinate with. A solo reader
    // (no room) has no listener, so applyMoodBranch runs only from the intro
    // timer at settle, sees a count of 0, and bows out to „Ende" (issue #79).
    if (initiate && session?.roomCode) {
      session.startMood(this.moodOrder).catch(() => {});
    } else if (session?.roomCode) {
      // The initiator's presence rides startMood; a follower announces itself so
      // every device can tally how many are present (issue #82).
      session.announceMoodPresence().catch(() => {});
    }
  }

  renderMoodOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'mood-overlay';
    // The ritual opens on the just-closed book: its cover sits large and centred
    // for a held beat (the "we finished this" thunk), then settles up into the
    // card's header — so the feelings that follow are visibly about *this* book,
    // not a free-floating grid. The choreography is pure CSS (see .mood-cover-*);
    // here we only render the cover and gate taps until it has settled.
    const cover = this.coverUrl
      ? `<img src="${this.coverUrl}" alt="" draggable="false" />`
      : '<span class="mood-cover-fallback" aria-hidden="true">📖</span>';
    overlay.innerHTML = `
      <div class="mood-card">
        <button class="mood-cancel" type="button" aria-label="Abbrechen">✕</button>
        <div class="mood-cover-header">
          <div class="mood-cover">${cover}</div>
          <div class="mood-cover-title"></div>
        </div>
        <h2 class="mood-board-title">Wie war das Buch?</h2>
        <div class="mood-warning" hidden></div>
        <div class="mood-instructions"></div>
        <div class="mood-grid"></div>
      </div>
    `;
    overlay.querySelector('.mood-cover-title').textContent = this.bookTitle || '';
    this.fillMoodGrid(overlay.querySelector('.mood-grid'));
    overlay.querySelector('.mood-cancel').addEventListener('click', () => this.cancelMood());
    // Escape would otherwise bubble to the window listener and close the whole
    // reader. Intercept it on capture so it acts on the ritual instead: conclude
    // once locked, cancel while still picking — mirroring the on-screen buttons.
    this._moodKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (this.moodRevealed) {
        this.concludeMood();
      } else {
        this.cancelMood();
      }
    };
    document.addEventListener('keydown', this._moodKeyDown, true);
    // Every finish opens on just the cover: the board stays hidden until the grace
    // window confirms a real pair (2–3 present), so the solo, synced-but-alone,
    // and 4+ bow-outs never flash a board only to swap it for „Ende" (issue #79).
    // applyMoodBranch drops `mood-pending` once the count settles in band, which
    // lets the grid and prompt rise in (CSS); a bow-out leaves it on and goes
    // straight to „Ende". The count can't be trusted upfront — a partner's
    // presence may not have announced yet — so this gate replaces the old
    // solo-only hide that left the synced-but-alone case still flashing.
    overlay.classList.add('mood-pending');
    this.readerEl?.appendChild(overlay);
    this.moodOverlay = overlay;
    // The board stays inert from open until it has fully risen in, so no pointer,
    // keyboard, or assistive-tech interaction can pick a mood before it's shown and
    // settled. (inert covers what a CSS pointer-events guard would miss: a keyboard
    // user tabbing in and pressing Enter.) It's lifted in applyMoodBranch when the
    // rise-in ends; reduced motion has no rise, so it's made ready here at once.
    const grid = overlay.querySelector('.mood-grid');
    grid.inert = true;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Reduced motion skips the cover-close choreography, so the grid is tappable
    // at once rather than after the intro.
    if (reducedMotion) grid.inert = false;
    // The intro doubles as the grace window that lets the present-count settle
    // before the band is evaluated (issues #82, #79): only once it elapses is the
    // count trusted, so the ≤1 bow-out can't misfire on a paired ritual's first
    // tick. A synced reader must always wait it out — even under reduced motion —
    // so the partner's presence announcement can land before the initiator's
    // still-empty tally would bow it straight out to „Ende". Only a solo reader,
    // who has no one to wait for and no listener to settle the count, evaluates
    // immediately under reduced motion. moodSettled gates applyMoodBranch.
    if (reducedMotion && !this.syncSession?.roomCode) {
      this.moodSettled = true;
      this.applyMoodBranch();
    } else {
      this._moodIntroT = setTimeout(() => {
        this.moodSettled = true;
        this.applyMoodBranch();
      }, MOOD_INTRO_MS);
    }
    this.renderMoodSelections();
  }

  // Builds the icon buttons for the current shared board (this.moodOrder). Kept
  // separate from renderMoodOverlay so the board can be rebuilt in place if the
  // agreed order arrives or changes after the overlay is already on screen.
  fillMoodGrid(grid) {
    grid.replaceChildren();
    for (const id of this.moodOrder || []) {
      const mood = moodById(id);
      if (!mood) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mood-icon';
      btn.dataset.id = mood.id;
      btn.setAttribute('aria-pressed', 'false');
      // Never captioned on screen (ADR 12, 2026-08-13 amendment): the drawings are
      // a projective prompt, not a vocabulary — the same one honestly means
      // different things after different books, and a visible word would beat the
      // picture and turn the ritual into a sorting task. The label serves only as
      // the accessible name, so the button can be operated at all.
      btn.setAttribute('aria-label', mood.label);
      btn.innerHTML = `
        <span class="mood-image-wrap">
          <img src="${moodIconUrl(mood.slug)}" alt="" draggable="false" />
        </span>
      `;
      btn.addEventListener('click', () => this.toggleMoodIcon(mood.id));
      grid.appendChild(btn);
    }
  }

  toggleMoodIcon(id) {
    if (this.moodRevealed) return;
    if (this.mySelection.has(id)) {
      this.mySelection.delete(id);
    } else if (this.mySelection.size < MOOD_PICK_COUNT) {
      this.mySelection.add(id);
    } else {
      return; // already at the cap; a swap means deselecting one first
    }
    this.renderMoodSelections();
    this.syncSession?.setMoodPicks([...this.mySelection]).catch(() => {});
    this.maybeReveal();
  }

  // Reflects only this device's own picks onto the grid; the partner's picks are
  // deliberately not shown, so the reveal is a genuine surprise and neither
  // reader nudges the other toward matching. The instruction is a simple "still
  // to pick" counter, then a wait once this side is done.
  renderMoodSelections() {
    const overlay = this.moodOverlay;
    if (!overlay || this.moodRevealed) return;
    for (const btn of overlay.querySelectorAll('.mood-icon')) {
      const id = Number(btn.dataset.id);
      const mine = this.mySelection.has(id);
      btn.classList.toggle('mood-selected', mine);
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
    }
    const instructions = overlay.querySelector('.mood-instructions');
    if (instructions) {
      const remaining = MOOD_PICK_COUNT - this.mySelection.size;
      instructions.textContent = remaining > 0
        ? `Wähle ${remaining} ${remaining === 1 ? 'Gefühl' : 'Gefühle'}.`
        : 'Warte auf den anderen …';
    }
  }

  // After either side's picks change, reveal once both readers have picked their
  // full set. Each device computes its own perspective and stores it locally, so
  // there is no shared record to agree on — the partner's device does the same.
  maybeReveal() {
    if (this.moodRevealed || !this.moodOpen) return;
    if (this.mySelection.size === MOOD_PICK_COUNT) {
      // The picker's reveal: pair with the first partner who has a full set. In a
      // three-person room this skips the abstaining adult's empty slot, so each
      // child pairs with its sibling and sees the ordinary „Wir / Ich / Du".
      for (const partnerIds of Object.values(this.moodPartnerPicks)) {
        if (partnerIds.length === MOOD_PICK_COUNT) {
          this.revealMood([...this.mySelection], partnerIds);
          return;
        }
      }
    } else if (this.mySelection.size === 0) {
      // The witness reveal (issue #82): this device picked nothing while two
      // others each completed a full set — the one-grandparent-two-children
      // shape. This only ever fires for the watching adult in a triad: a normal
      // pair has just one partner, and in the 4+ bow-out nobody picks.
      const full = Object.values(this.moodPartnerPicks).filter((ids) => ids.length === MOOD_PICK_COUNT);
      if (full.length === 2) this.revealWitness(full[0], full[1]);
    }
  }

  // Adapts the open ritual to how many devices are present (issues #82, #79). Two
  // is the unchanged dyad. Three shows an advisory so the reading adult abstains
  // and the two children pair with each other — differentiation carried by the
  // humans, not by any device knowing who it is. Both tails of the band bow out to
  // a plain „Ende" closure with no keepsake: ≤1 is a finish with no one to share
  // it with (solo, or a partner who never joined — issue #79), 4+ has no honest
  // pair-plus-witness mapping. The count drives ONLY this advisory and the
  // bow-outs, never a device's ability to pair (that stays purely
  // behaviour-driven), so a miscount can't wrongly gate anyone. Gated on
  // moodSettled and guarded so it never misfires early or disturbs a shown
  // reveal or „Ende".
  applyMoodBranch() {
    if (this.moodRevealed) return;
    // Hold off until the grace window has let the present-tally settle (issue
    // #79); evaluating earlier would bow a normal pair out to „Ende" on the
    // first listener tick, before the partner has announced.
    if (!this.moodSettled) return;
    const overlay = this.moodOverlay;
    if (!overlay) return;
    // Both tails of the participant-count band bow out to the same plain „Ende"
    // with no keepsake (issue #79): ≤1 is a solo reader (count 0) or a synced
    // reader whose partner never joined (count 1); ≥4 has no honest
    // pair-plus-witness mapping (issue #82). The 2–3 board is unchanged.
    if (this.moodPresentIds.length <= 1 || this.moodPresentIds.length >= 4) {
      this.showMoodEnd();
      return;
    }
    // A real pair (2–3) is confirmed: reveal the board, which has stayed hidden
    // through the grace window so a bow-out never flashes it (issue #79). Dropping
    // `mood-pending` lets the grid and prompt rise in (CSS); the cover has already
    // settled into the header by now, so the rise plays as a clean follow-on. The
    // grid stays inert through that rise so no tap, key, or assistive-tech pick
    // lands on a board still animating in — it's made interactive when the rise
    // ends (MOOD_BOARD_RISE_MS later). Guarded on the class so a later presence
    // update — which re-runs this — can't re-arm the gate. Reduced motion has no
    // rise and was readied at open. The timer is stored for teardown.
    if (overlay.classList.contains('mood-pending')) {
      overlay.classList.remove('mood-pending');
      const grid = overlay.querySelector('.mood-grid');
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (grid && !reducedMotion) {
        grid.inert = true;
        this._moodRiseT = setTimeout(() => { grid.inert = false; }, MOOD_BOARD_RISE_MS);
      }
    }
    const warning = overlay.querySelector('.mood-warning');
    if (!warning) return;
    if (this.moodPresentIds.length === 3) {
      warning.textContent = 'Drei Personen anwesend. Nur die Kinder wählen Gefühle.';
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }
  }

  // The band's bow-out tails (≤1 or 4+ present): the ritual does not run. Keep the
  // settled cover in place (no re-animation) and swap the board for a plain „Ende"
  // + „Buch ins Regal stellen". Marked revealed so a peer wiping the node can't
  // yank this card, and so concluding clears the node — no record is stored and
  // the next open is clean. This is also the solo / synced-but-alone close (#79).
  showMoodEnd() {
    const overlay = this.moodOverlay;
    if (!overlay) return;
    this.moodRevealed = true;
    const card = overlay.querySelector('.mood-card');
    card.querySelector('.mood-board-title')?.remove();
    card.querySelector('.mood-warning')?.remove();
    card.querySelector('.mood-instructions')?.remove();
    card.querySelector('.mood-grid')?.remove();
    const end = document.createElement('div');
    end.className = 'mood-end-message';
    end.innerHTML = `
      <div class="mood-result-title">Ende</div>
      <button class="mood-result-done" type="button">Buch ins Regal stellen</button>
    `;
    card.appendChild(end);
    end.querySelector('.mood-result-done').addEventListener('click', () => this.concludeMood());
  }

  handleMood(data) {
    if (!this.moodOpen) {
      // The partner opened the ritual: follow them in on their board.
      if (data && data.open) this.openMood(false, data.order);
      return;
    }
    if (!data) {
      // The whole node was removed. While still selecting that means the other
      // party cancelled, so close too; once we're showing the reveal it just
      // means a participant finished tidying up — leave our reveal on screen
      // until this reader dismisses it.
      if (!this.moodRevealed) this.closeMoodUI();
      return;
    }
    // If both devices opened at once they each rolled a board; the node's order
    // is the one that won. Adopt it so both grids match. This only happens in
    // that opening race, when no picks are in yet, so rebuilding is harmless.
    if (data.order && data.order.length && !sameOrder(data.order, this.moodOrder)) {
      this.moodOrder = data.order;
      this.mySelection = new Set();
      const grid = this.moodOverlay?.querySelector('.mood-grid');
      if (grid) this.fillMoodGrid(grid);
      this.syncSession?.setMoodPicks([]).catch(() => {});
    }
    this.moodPartnerPicks = {};
    for (const [memberId, ids] of Object.entries(data.picks)) {
      if (memberId === this.syncSession?.memberId) continue;
      this.moodPartnerPicks[memberId] = ids;
    }
    this.moodPresentIds = Array.isArray(data.present) ? data.present : [];
    this.renderMoodSelections();
    this.applyMoodBranch();
    this.maybeReveal();
  }

  // Both readers have picked. Store this device's own perspective of the finish
  // ({ mine, theirs }) locally — the partner's device stores the mirror image —
  // then show the reveal. Guarded so a re-fired listener can't store it twice.
  revealMood(mine, theirs) {
    if (this.moodRevealed) return;
    this.moodRevealed = true;
    addCompletion(this.bookId, {
      id: uid(),
      completedAt: Date.now(),
      mine,
      theirs,
    }).catch(() => {});
    this.showMoodResult(mine, theirs);
  }

  showMoodResult(mine, theirs) {
    const overlay = this.moodOverlay;
    if (!overlay) return;
    const card = overlay.querySelector('.mood-card');
    overlay.classList.add('mood-revealed');
    card.innerHTML = `
      <div class="mood-result-title">Eure Gefühle</div>
      ${moodRevealRowsHTML(mine, theirs)}
      <button class="mood-result-done" type="button">Buch ins Regal stellen</button>
    `;
    card.querySelector('.mood-result-done').addEventListener('click', () => this.concludeMood());
  }

  // The witness keeps the whole picture — both children's picks and their overlap
  // (issue #82). Setting moodRevealed first is the persistence guard: it reuses
  // handleMood's „node gone but already revealed → keep my screen" path, so a child
  // tapping „Regal" first can't yank the keepsake before the adult has read it.
  revealWitness(a, b) {
    if (this.moodRevealed) return;
    this.moodRevealed = true;
    addCompletion(this.bookId, {
      id: uid(),
      completedAt: Date.now(),
      witnessed: true,
      a,
      b,
    }).catch(() => {});
    this.showWitnessResult(a, b);
  }

  showWitnessResult(a, b) {
    const overlay = this.moodOverlay;
    if (!overlay) return;
    const card = overlay.querySelector('.mood-card');
    overlay.classList.add('mood-revealed');
    card.innerHTML = `
      <div class="mood-result-title">Eure Gefühle</div>
      ${moodWitnessRowsHTML(a, b)}
      <button class="mood-result-done" type="button">Buch ins Regal stellen</button>
    `;
    card.querySelector('.mood-result-done').addEventListener('click', () => this.concludeMood());
  }

  // The ritual is done and acknowledged: tear it down, then leave the finished
  // book and rewind it to the start.
  concludeMood() {
    this.closeMoodUI();
    this.closeToFirstPage();
  }

  cancelMood() {
    // Clearing the shared node makes the partner's listener close their screen
    // too. Safe after the reveal as well: the record is already stored locally.
    this.syncSession?.clearMood().catch(() => {});
    this.closeMoodUI();
  }

  closeMoodUI() {
    // A concluded ritual leaves its node behind; clear it so a re-read starts
    // clean and re-entering the book doesn't replay the reveal. The record is
    // already stored locally on both devices by the time anyone closes, and
    // clearing is idempotent, so both sides closing is harmless. (A cancel
    // before the reveal clears via cancelMood instead.)
    if (this.moodRevealed) this.syncSession?.clearMood().catch(() => {});
    this.moodOpen = false;
    this.moodSettled = false;
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.moodPresentIds = [];
    clearTimeout(this._moodIntroT);
    clearTimeout(this._moodRiseT);
    if (this._moodKeyDown) {
      document.removeEventListener('keydown', this._moodKeyDown, true);
      this._moodKeyDown = null;
    }
    if (this.moodOverlay) {
      this.moodOverlay.remove();
      this.moodOverlay = null;
    }
    this.updateMoodCue();
  }

  // One way into the sync panel, for the „👥" button and for the library's
  // „Gemeinsam lesen" path alike. The bar stays up for as long as the panel is
  // (the syncPanelOpen guard in showChrome): the panel is that button's own
  // surface, and letting the bar slide away underneath would take the button —
  // and the sync marker it wears — off the screen mid-errand.
  openSyncPanel() {
    const panel = this.root.querySelector('.sync-panel');
    if (!panel || !panel.hidden) return;
    panel.hidden = false;
    this.syncPanelOpen = true;
    this.showChrome();
  }

  // One way out for all three of its exits (Abbrechen/Schliessen, a tap on the
  // backdrop, Escape). The focus is deliberately not handed back to the „👥"
  // button: sitting there it would hold the whole bar on screen for the rest of
  // the reading, exactly as the page indicator did in issue #179. It lands on
  // <body> instead, and the bar shows the button's new state for the short wait
  // before it settles — the code itself was already reported in the panel.
  closeSyncPanel() {
    const panel = this.root.querySelector('.sync-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    this.syncPanelOpen = false;
    this.showChrome(HIDE_CHROME_AFTER_ACTION_MS);
  }

  setupSync(reader) {
    const syncBtn = reader.querySelector('.reader-sync-btn');
    const panel = reader.querySelector('.sync-panel');
    const createBtn = reader.querySelector('.sync-create-btn');
    const joinInput = reader.querySelector('.sync-join-input');
    const joinBtn = reader.querySelector('.sync-join-btn');
    const closeBtn = reader.querySelector('.sync-panel-close');

    syncBtn.addEventListener('click', () => {
      if (panel.hidden) this.openSyncPanel();
      else this.closeSyncPanel();
    });

    closeBtn.addEventListener('click', () => this.closeSyncPanel());

    panel.addEventListener('click', (e) => {
      if (e.target === panel) this.closeSyncPanel();
    });

    createBtn.addEventListener('click', () => this.syncCreate());
    applyCodeField(joinInput);
    // Graying "Verbinden" out until a whole code is typed, and Enter from the
    // field, both live in code-field.js — the library's dialog asks for the
    // same code and must behave identically (rule 1).
    bindCodeSubmit(joinInput, joinBtn, () => this.syncJoin());
  }

  async syncCreate() {
    if (!this.source) {
      await showAlert({ message: 'Buch wird noch geladen. Bitte warten.' });
      return;
    }
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.syncStop();
    try {
      const session = new SyncSession(this.bookId);
      session.onRemotePageChange = (page) => this.onRemotePage(page);
      session.onRoomDeleted = () => {
        this.syncStop();
        showAlert({ message: 'Die Synchronisation wurde beendet.' });
      };
      this.syncSession = session;
      const code = await session.createRoom(this.currentPage, await this.buildBookDescriptor());
      if (!this.source) {
        session.stop();
        this.syncSession = null;
        return;
      }
      this.showSyncActive(code);
    } catch (err) {
      this.syncStop();
      if (this.source) await showAlert({ message: err.message || 'Verbindung fehlgeschlagen. Bitte erneut versuchen.' });
    } finally {
      this.isSyncing = false;
    }
  }

  async syncJoin() {
    if (!this.source) {
      await showAlert({ message: 'Buch wird noch geladen. Bitte warten.' });
      return;
    }
    const input = this.root.querySelector('.sync-join-input');
    const code = input.value.trim();
    if (!code) return;
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      // Look the room up before any session is created or torn down, so the
      // "other book" branch below can bail out without having disturbed an
      // active sync or the open book.
      // Each await below is a point where the listener may meanwhile have left
      // for the library (destroy() nulls this.source and the next view takes
      // over this.root). Re-check after every one and bail out, the same guard
      // the rest of syncJoin/syncCreate use, so a late resolve never shows a
      // dialog over the library or touches a torn-down DOM.
      let room;
      try {
        room = await lookupRoom(code);
      } catch (err) {
        if (!this.source) return;
        await showAlert({ message: err?.message || 'Verbindung fehlgeschlagen.' });
        return;
      }
      if (!this.source) return;

      // A Synchronisations-Code points at one specific book. If it isn't the
      // book open here, syncing by page number would pair two different books —
      // so offer to switch to the book the code is for, over the same path the
      // library takes (local copy by hash, otherwise WebRTC download).
      const ownHash = await ensureContentHash(this.bookId);
      if (!this.source) return;
      if (room.book?.hash && room.book.hash !== ownHash) {
        const goThere = await showConfirm({
          title: 'Anderes Buch',
          message: `Dieser Synchronisations-Code gehört zu „${room.book.title || 'einem anderen Buch'}". Gemeinsam lesen heisst, zu diesem Buch zu wechseln. Jetzt öffnen?`,
          confirmLabel: 'Buch öffnen',
        });
        if (!this.source) return;
        // The code is unusable for the book open here either way, so clear the
        // field to prevent a retry loop (the title was already in the dialog).
        // Clearing programmatically fires no input event, so grey out "Verbinden"
        // by hand to keep it disabled on an empty field (rule 5: prevent errors).
        // On cancel nothing was started or torn down; the Sync-Panel stays open
        // with both next steps — "Synchronisations-Code erstellen" and
        // "Verbinden" — still visible.
        input.value = '';
        this.root.querySelector('.sync-join-btn').disabled = true;
        // Tear the old session down before the switch: openRoom may download for
        // several seconds, and an still-listening session would keep reacting to
        // the old book's page turns and pointers (behind the progress dialog) the
        // whole time. syncStop also resets this view to "not connected", so if the
        // switch fails and this view stays on screen, its UI is left coherent.
        if (goThere) {
          this.syncStop();
          await this.onJoinRoom?.(room);
        }
        return;
      }

      this.syncStop();
      const session = new SyncSession(this.bookId);
      session.onRemotePageChange = (page) => this.onRemotePage(page);
      session.onRoomDeleted = () => {
        this.syncStop();
        showAlert({ message: 'Die Synchronisation wurde beendet.' });
      };
      this.syncSession = session;
      const normalizedCode = await session.joinRoom(code);
      if (!this.source) {
        session.stop();
        this.syncSession = null;
        return;
      }
      this.showSyncActive(normalizedCode);
    } catch (err) {
      this.syncStop();
      if (this.source) await showAlert({ message: err?.message || 'Verbindung fehlgeschlagen.' });
    } finally {
      this.isSyncing = false;
    }
  }

  async syncJoinCode(code) {
    const session = new SyncSession(this.bookId);
    session.onRemotePageChange = (page) => this.onRemotePage(page);
    session.onRoomDeleted = () => {
      this.syncStop();
      showAlert({ message: 'Die Synchronisation wurde beendet.' });
    };
    this.syncSession = session;
    try {
      const normalizedCode = await session.joinRoom(code);
      if (this.syncSession !== session) {
        session.detach();
        return;
      }
      this.showSyncActive(normalizedCode);
    } catch (err) {
      if (this.syncSession === session) this.syncSession = null;
      await showAlert({ message: err.message || 'Verbindung fehlgeschlagen.' });
    }
  }

  async buildBookDescriptor() {
    const meta = await getMeta(this.bookId);
    const hash = await ensureContentHash(this.bookId);
    if (!meta || !hash) return null;
    // Cap the title to the length the room's validation rule permits, so a long
    // (e.g. filename-derived) title can't make room creation fail.
    const title = (meta.title || '').slice(0, 200);
    return { hash, title, pageCount: meta.pageCount, type: meta.type || 'pdf' };
  }

  // While we hold an active room as its creator, stand ready to stream the book
  // to a partner who joins from the library without a copy.
  maybeStartServing() {
    if (this.serveStop) return;
    const session = this.syncSession;
    if (!session?.roomCode) return;
    getFirebase().then((fb) => {
      if (this.syncSession !== session || this.serveStop) return;
      this.serveStop = serveBook(fb, session.roomCode, () => exportBook(this.bookId));
    }).catch(() => {});
  }

  stopServing() {
    if (!this.serveStop) return;
    try { this.serveStop(); } catch {}
    this.serveStop = null;
  }

  syncStop() {
    this.stopServing();
    if (this.syncSession) {
      this.syncSession.stopListeningPointers();
      this.syncSession.stopListeningMood();
    }
    this.clearAllPointers();
    // A finish without a partner has no meaning; tear the ritual down with the
    // session rather than leaving an orphaned overlay or cue on screen.
    if (this.moodOpen) this.closeMoodUI();
    closeSyncForBook(this.bookId);
    this.syncSession = null;
    this.showSyncInactive();
    this.updateMoodCue();
    this.root.querySelector('.reader-sync-btn').classList.remove('sync-active');
  }

  showSyncActive(code) {
    const reader = this.root.querySelector('.reader');
    reader.querySelector('.sync-create-section').hidden = true;
    reader.querySelector('.sync-or').hidden = true;
    reader.querySelector('.sync-join-section').hidden = true;
    reader.querySelector('.sync-panel-desc').hidden = true;
    // Connected: "Verbinden" has nothing left to do, and the dismiss button
    // closes the panel without ending the sync — so it reads "Schliessen".
    reader.querySelector('.sync-join-btn').hidden = true;
    reader.querySelector('.sync-panel-close').textContent = 'Schliessen';
    const active = reader.querySelector('.sync-active-section');
    active.hidden = false;
    active.querySelector('.sync-code-display').textContent = code;
    this.root.querySelector('.reader-sync-btn').classList.add('sync-active');
    this.maybeStartServing();
    if (this.syncSession) {
      this.syncSession.listenPointers((others) => this.renderRemotePointers(others));
      this.syncSession.listenMood((data) => this.handleMood(data));
    }
    this.updateMoodCue();
  }

  showSyncInactive() {
    const reader = this.root.querySelector('.reader');
    reader.querySelector('.sync-create-section').hidden = false;
    reader.querySelector('.sync-or').hidden = false;
    reader.querySelector('.sync-join-section').hidden = false;
    const input = reader.querySelector('.sync-join-input');
    if (input) input.value = '';
    const joinBtn = reader.querySelector('.sync-join-btn');
    joinBtn.hidden = false;
    joinBtn.disabled = true;
    reader.querySelector('.sync-panel-close').textContent = 'Abbrechen';
    reader.querySelector('.sync-panel-desc').hidden = false;
    const active = reader.querySelector('.sync-active-section');
    active.hidden = true;
    active.querySelector('.sync-code-display').textContent = '';
  }

  onRemotePage(page) {
    if (page === this.currentPage) return;
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.renderCurrent();
  }

  close() {
    this.destroy();
    this.onClose();
  }

  // Leaves the reader and rewinds the book to its first page, so reopening it
  // begins a fresh read (and, when synced, a fresh chance at the mood ritual).
  // Used when a book is "finished" — the closing overlay's „Buch ins Regal
  // stellen", for both the synced reveal and the solo/alone „Ende" close (#79) —
  // but deliberately NOT by the chrome back button, which leaves the book wherever
  // the reader paused. When synced, the room's shared page is reset too so the
  // partner reopens at the start.
  closeToFirstPage() {
    this.currentPage = 1;
    updateLastPage(this.bookId, 1).catch(() => {});
    if (this.syncSession) this.syncSession.sendPage(1).catch(() => {});
    this.close();
  }

  destroy() {
    // No book on screen any more, so the device may sleep on its own schedule
    // again (ADR 25).
    letSleep();
    window.removeEventListener('keydown', this.boundKeys);
    window.removeEventListener('resize', this.boundResize);
    // Before the listeners go: a gesture still running ends properly rather
    // than being abandoned half-torn-down.
    this._endMouseGesture?.();
    this._endMouseGesture = null;
    if (this._mousePanMove) {
      window.removeEventListener('pointermove', this._mousePanMove);
      window.removeEventListener('pointerup', this._mousePanUp);
      window.removeEventListener('pointercancel', this._mousePanUp);
      window.removeEventListener('blur', this._mouseGestureAbort);
      document.removeEventListener('visibilitychange', this._mouseGestureAbort);
      this._mousePanMove = null;
      this._mousePanUp = null;
      this._mouseGestureAbort = null;
    }
    if (this._chromePressState) {
      window.removeEventListener('pointerdown', this._chromePressState, true);
      this._chromePressState = null;
    }
    this.closeHelp(); // also detaches its window pointerdown listener
    clearTimeout(this.hideTimer);
    clearTimeout(this.cursorTimer);
    clearTimeout(this._resizeT);
    clearTimeout(this._wheelZoomT);
    clearTimeout(this.pointerSendTimer);
    clearTimeout(this.longPressTimer);
    clearTimeout(this.mouseHoldTimer);
    clearTimeout(this._moodIntroT);
    clearTimeout(this._moodRiseT);
    this.clearAllPointers();
    if (this.coverUrl) {
      URL.revokeObjectURL(this.coverUrl);
      this.coverUrl = null;
    }
    this.readerEl = null;
    this.stopServing();
    if (this.syncSession) {
      this.syncSession.detach();
      this.syncSession = null;
    }
    if (this.source) {
      this.source.destroy();
      this.source = null;
    }
  }
}
