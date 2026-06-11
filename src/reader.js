import { getBookFile, getMeta, getPhotoPage, getThumb, updateLastPage, ensureContentHash, addCompletion, uid } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';
import { SyncSession, getSessionForBook, closeSyncForBook, getFirebase } from './sync.js';
import { serveBook } from './transfer.js';
import { exportBook } from './bundle.js';
import { showAlert } from './dialog.js';
import { moodById, moodIconUrl, moodRevealRowsHTML, moodWitnessRowsHTML, pickMoodBoard, MOOD_PICK_COUNT, MOOD_BOARD_COUNT } from './moods.js';

const HIDE_CHROME_AFTER_MS = 2500;
const CHROME_REVEAL_BAND_PX = 80;
const CURSOR_IDLE_MS = 2500;

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
  async renderPage(n, canvas, w, h) {
    const blob = await getPhotoPage(this.bookId, n);
    if (!blob) throw new Error(`Seite ${n} fehlt`);
    await renderImageToCanvas(blob, canvas, w, h);
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
  constructor(root, { bookId, onClose, joinCode = null }) {
    this.root = root;
    this.bookId = bookId;
    this.onClose = onClose;
    this.joinCode = joinCode;
    this.serveStop = null;
    this.source = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.renderToken = 0;
    this.hideTimer = null;
    this.pageJumpOpen = false;
    // The "?" help overlay (see openHelp). Tracked so the chrome auto-hide can
    // pause while it is up and so any tap or key can dismiss it.
    this.helpOpen = false;
    this.helpOverlay = null;
    this.boundKeys = this.handleKey.bind(this);
    this.boundResize = this.scheduleRender.bind(this);
    this.syncSession = null;
    this.isSyncing = false;
    // Local page-navigation toggle (zones + swipe). Default on; persisted
    // per-device. Read synchronously so the first render is already correct.
    this.navEnabled = loadNavEnabled();
    // Remote/local "point at the page" overlays, keyed by senderId ('local'
    // for this device's own pointer). See attachStageGestures + the pointer
    // helpers below.
    this.pointerEls = new Map();
    this.localPointerActive = false;
    this.lastRenderedPage = 0;
    this.pointerSendTimer = null;
    this.lastPointerSend = 0;
    this.pendingPointer = null;
    this.longPressTimer = null;
    // Shared reading memory (issue #65). The mood overlay is built on demand;
    // mySelection is this device's authoritative picks, moodPartnerPicks mirrors
    // the other participants' picks from Firebase, keyed by clientId. The
    // partner's picks stay hidden until the reveal, so neither reader steers the
    // other toward a match.
    this.moodOpen = false;
    this.moodOrder = null; // the shared board (icon ids), agreed via Firebase
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.moodRevealed = false;
    // clientIds present this ritual, used only to count participants (issue #82):
    // three shows an advisory so the reading adult abstains, four or more bows out.
    this.moodPresentIds = [];
    // Gates the present-count branch until the ~1.5 s grace window has elapsed
    // (issue #79). A synced pair momentarily tallies a count of 1 before the
    // partner announces, so the count must settle before the ≤1 tail can bow out
    // to „Ende" — otherwise every paired ritual would misfire on its first tick.
    this.moodSettled = false;
  }

  async render() {
    this.root.innerHTML = `
      <div class="reader">
        <div class="reader-chrome">
          <button class="reader-back" type="button">← Bibliothek</button>
          <button class="reader-sync-btn" type="button" aria-label="Gemeinsam lesen">⇄</button>
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
              <div class="sync-join-row">
                <input class="sync-join-input" type="text" placeholder="Synchronisations-Code" aria-label="Synchronisations-Code" maxlength="6" autocomplete="off" spellcheck="false" />
                <button class="sync-join-btn" type="button">Verbinden</button>
              </div>
            </div>
            <div class="sync-active-section" hidden>
              <div class="sync-code-label">Synchronisations-Code des Buches</div>
              <div class="sync-code-display"></div>
              <div class="sync-status">Verbunden</div>
              <button class="sync-stop-btn" type="button">Trennen</button>
            </div>
            <button class="sync-panel-close" type="button">Schliessen</button>
          </div>
        </div>
        <div class="reader-stage">
          <canvas class="reader-canvas"></canvas>
          <button class="reader-zone reader-zone-prev" type="button" aria-label="Zurück"></button>
          <button class="reader-zone reader-zone-next" type="button" aria-label="Vor"></button>
          <div class="pointer-layer" aria-hidden="true"><div class="pointer-page"></div></div>
        </div>
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
    this.applyNavState();

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
        e.preventDefault();
      }
    });

    reader.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.showCursor();
      if (e.clientY <= CHROME_REVEAL_BAND_PX || e.target.closest('.reader-chrome')) this.showChrome();
    });
    reader.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      // The stage runs its own gesture recogniser (tap vs. long-press-to-point
      // vs. swipe); let it decide whether a touch there reveals the chrome.
      if (e.target.closest('.reader-stage')) return;
      this.showChrome();
    }, { passive: true });

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
  }

  // Unified touch recogniser for the reading stage. It distinguishes three
  // gestures so they never collide:
  //   • quick tap            → reveal the chrome (but not over a page-turn zone,
  //                            which turns the page via its own click handler)
  //   • long press (≥700ms)  → "point at the page": four chevrons converge on
  //                            the finger and follow it until release; the
  //                            chrome stays hidden so pointing is unobstructed
  //   • horizontal swipe     → turn the page
  attachStageGestures(stage) {
    // Captured once: the canvas element is reused across page renders, so a
    // pointer can be measured against the page without a per-touchmove DOM query.
    const canvas = stage.querySelector('.reader-canvas');
    const LONG_PRESS_MS = 700;
    const MOVE_CANCEL_PX = 10; // movement before activation aborts the long press
    const TAP_MAX_MS = 600;
    const TAP_MAX_PX = 15;
    const SWIPE_PX = 40;

    let startX = null;
    let startY = null;
    let startTime = 0;
    let onZone = false;
    let aborted = false; // multi-touch (e.g. pinch) cancels the gesture

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
        aborted = true;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      onZone = !!e.target.closest('.reader-zone');
      aborted = false;
      clearTimer();
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        const pos = this.pageFraction(canvas, startX, startY);
        this.beginLocalPointer(pos.x, pos.y);
      }, LONG_PRESS_MS);
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
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
      if (Math.abs(t.clientX - startX) > MOVE_CANCEL_PX ||
          Math.abs(t.clientY - startY) > MOVE_CANCEL_PX) {
        clearTimer(); // moved too far to be a long press (likely a swipe)
      }
    }, { passive: false });

    stage.addEventListener('touchend', (e) => {
      clearTimer();
      if (this.localPointerActive) {
        finishPointer();
        startX = startY = null;
        // Suppress the synthetic click the browser would otherwise fire on the
        // page-turn zone underneath, so pointing near an edge and releasing
        // doesn't accidentally turn the page.
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
        this.showChrome();
      }
      startX = startY = null;
    }, { passive: false });

    stage.addEventListener('touchcancel', () => {
      clearTimer();
      finishPointer();
      startX = startY = null;
      aborted = false;
    });
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

  beginLocalPointer(x, y) {
    const session = this.syncSession;
    if (!session || !session.roomCode) return; // nothing to point at without a partner
    this.localPointerActive = true;
    this.pendingPointer = null;
    const existing = this.pointerEls.get('local');
    if (existing) existing.remove();
    const el = this.createPointerEl(session.clientId, x, y);
    this.pointerEls.set('local', el);
    this.lastPointerSend = Date.now();
    session.sendPointer(x, y).catch(() => {});
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
    if (this.helpOpen) {
      this.closeHelp();
      if (e.key === 'Escape') return;
    }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      this.goNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      this.goPrev();
    } else if (e.key === 'Escape') {
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
  // The chrome is kept up so the listener sees the button's state change.
  toggleNav() {
    this.navEnabled = !this.navEnabled;
    saveNavEnabled(this.navEnabled);
    this.applyNavState();
    this.showChrome();
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

  scheduleRender() {
    // The help callouts were positioned for the old layout; a resize (e.g. an
    // orientation change) invalidates them, so the help simply closes.
    if (this.helpOpen) this.closeHelp();
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(() => this.renderCurrent(), 120);
  }

  async renderCurrent() {
    if (!this.source) return;
    const token = ++this.renderToken;
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    if (stage.clientWidth === 0 || stage.clientHeight === 0) return;
    try {
      await this.source.renderPage(this.currentPage, canvas, stage.clientWidth, stage.clientHeight);
    } catch (err) {
      if (token !== this.renderToken) return;
      console.error('Render-Fehler', err);
    }
    if (token !== this.renderToken) return;
    // Re-overlay the pointer space onto the (possibly resized) page before any
    // pointer is placed, so positions are page-relative on this render too.
    this.syncPointerPageGeometry();
    // Clear pointers only when the page actually changes, not on a re-render
    // from a resize, so a pointer survives an orientation change mid-gesture.
    if (this.lastRenderedPage !== this.currentPage) {
      this.clearAllPointers();
      this.lastRenderedPage = this.currentPage;
    }
    this.updateIndicator();
    this.updateMoodCue();
    updateLastPage(this.bookId, this.currentPage).catch(() => {});
  }

  updateIndicator() {
    const ind = this.root.querySelector('.reader-page-indicator');
    if (ind.querySelector('.page-jump-input')) return;
    ind.textContent = `Seite ${this.currentPage} / ${this.totalPages}`;
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
    suffix.textContent = ` / ${this.totalPages}`;
    ind.appendChild(suffix);

    input.focus();
    input.select();

    const commit = () => {
      const val = parseInt(input.value, 10);
      const page = isNaN(val) ? this.currentPage : Math.min(Math.max(val, 1), this.totalPages);
      this.closePageJump(page, true);
      this.goToPage(page);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') this.closePageJump(undefined, true);
    });
    input.addEventListener('blur', () => this.closePageJump());
  }

  closePageJump(page, shouldFocus = false) {
    const ind = this.root.querySelector('.reader-page-indicator');
    if (!ind.querySelector('.page-jump-input')) return;
    this.pageJumpOpen = false;
    ind.setAttribute('role', 'button');
    ind.setAttribute('tabindex', '0');
    const displayPage = page !== undefined ? page : this.currentPage;
    ind.textContent = `Seite ${displayPage} / ${this.totalPages}`;
    this.showChrome();
    if (shouldFocus) ind.focus();
  }

  async goToPage(page) {
    if (page === this.currentPage) return;
    this.currentPage = page;
    await this.renderCurrent();
    if (this.syncSession) this.syncSession.sendPage(this.currentPage).catch(() => {});
  }

  showChrome() {
    const reader = this.readerEl;
    if (!reader) return;
    reader.classList.remove('chrome-hidden');
    clearTimeout(this.hideTimer);
    // While the page-jump input or the help overlay is up, the chrome must not
    // slide away under the user (the callouts point at its controls).
    if (this.pageJumpOpen || this.helpOpen) return;
    this.hideTimer = setTimeout(() => {
      reader.classList.add('chrome-hidden');
    }, HIDE_CHROME_AFTER_MS);
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
    this.addHelpHint('help-hint-center', 'Finger gedrückt halten: auf die Seite zeigen', {
      sub: 'beim gemeinsamen Lesen',
    });
    this.addChromeHelpHints();

    this._helpDismiss = (e) => {
      // The ? button has its own toggle handler; consuming its pointerdown
      // here would close the help only to have the click reopen it.
      if (e.target.closest?.('.reader-help-btn')) return;
      this.closeHelp();
    };
    window.addEventListener('pointerdown', this._helpDismiss, true);
  }

  // One callout bubble. `glyph` stacks a large chevron above the text (the
  // page-turn zones); `sub` adds a smaller second line (the pointing hint).
  addHelpHint(className, text, { glyph, sub } = {}) {
    const hint = document.createElement('div');
    hint.className = `help-hint ${className}`;
    if (glyph) {
      const g = document.createElement('span');
      g.className = 'help-hint-glyph';
      g.textContent = glyph;
      hint.appendChild(g);
    }
    const label = document.createElement('span');
    label.className = 'help-hint-text';
    label.textContent = text;
    hint.appendChild(label);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'help-hint-sub';
      s.textContent = sub;
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
  addChromeHelpHints() {
    const reader = this.readerEl;
    const base = reader.getBoundingClientRect();
    const TIER_STEP = 46; // > bubble height, so tiers never touch vertically
    const targets = [
      ['.reader-back', 'Zurück zur Bibliothek', 0],
      ['.reader-sync-btn', 'Gemeinsam lesen', 1],
      ['.reader-nav-toggle', 'Umblättern an / aus', 0],
      ['.reader-page-indicator', 'Zu einer Seite springen', 1],
    ];
    const placed = []; // { tier, left, right } of every bubble already laid out
    for (const [selector, text, preferredTier] of targets) {
      const target = reader.querySelector(selector);
      if (!target) continue;
      const r = target.getBoundingClientRect();
      const hint = this.addHelpHint('help-hint-chrome', text);
      const arrow = document.createElement('span');
      arrow.className = 'help-hint-arrow';
      hint.appendChild(arrow);
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
      const top = targetBottom + 10 + tier * TIER_STEP;
      hint.style.top = `${top}px`;
      hint.style.left = `${left}px`;
      arrow.style.left = `${Math.max(12, Math.min(width - 12, targetX - left))}px`;
      arrow.style.height = `${top - targetBottom}px`;
    }
  }

  closeHelp() {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    if (this._helpDismiss) {
      window.removeEventListener('pointerdown', this._helpDismiss, true);
      this._helpDismiss = null;
    }
    this.helpOverlay?.remove();
    this.helpOverlay = null;
    this.readerEl?.classList.remove('help-open');
    this.readerEl?.querySelector('.reader-help-btn')?.setAttribute('aria-expanded', 'false');
    // Re-arm the chrome auto-hide that openHelp suspended.
    this.showChrome();
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
      // The illustration carries the meaning; the label is kept only as the
      // accessible name (no visible caption), per the screen's design.
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
    for (const [clientId, ids] of Object.entries(data.picks)) {
      if (clientId === this.syncSession?.clientId) continue;
      this.moodPartnerPicks[clientId] = ids;
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

  setupSync(reader) {
    const syncBtn = reader.querySelector('.reader-sync-btn');
    const panel = reader.querySelector('.sync-panel');
    const createBtn = reader.querySelector('.sync-create-btn');
    const joinInput = reader.querySelector('.sync-join-input');
    const joinBtn = reader.querySelector('.sync-join-btn');
    const stopBtn = reader.querySelector('.sync-stop-btn');
    const closeBtn = reader.querySelector('.sync-panel-close');

    syncBtn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });

    closeBtn.addEventListener('click', () => {
      panel.hidden = true;
    });

    panel.addEventListener('click', (e) => {
      if (e.target === panel) panel.hidden = true;
    });

    createBtn.addEventListener('click', () => this.syncCreate());
    joinBtn.addEventListener('click', () => this.syncJoin());
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.syncJoin();
    });
    stopBtn.addEventListener('click', () => this.syncStop());
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
    this.syncStop();
    try {
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
      if (this.source) await showAlert({ message: err.message || 'Verbindung fehlgeschlagen.' });
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
    window.removeEventListener('keydown', this.boundKeys);
    window.removeEventListener('resize', this.boundResize);
    this.closeHelp(); // also detaches its window pointerdown listener
    clearTimeout(this.hideTimer);
    clearTimeout(this.cursorTimer);
    clearTimeout(this._resizeT);
    clearTimeout(this.pointerSendTimer);
    clearTimeout(this.longPressTimer);
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
