import { getBookFile, getMeta, getPhotoPage, updateLastPage, ensureContentHash, addCompletion, uid } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';
import { SyncSession, getSessionForBook, closeSyncForBook, getFirebase } from './sync.js';
import { serveBook } from './transfer.js';
import { exportBook } from './bundle.js';
import { showAlert } from './dialog.js';
import { MOODS, moodById, moodIconUrl, pickMoodBoard, evaluateLock, MOOD_PICK_COUNT, MOOD_MIN_OVERLAP } from './moods.js';

const HIDE_CHROME_AFTER_MS = 2500;
const CHROME_REVEAL_BAND_PX = 80;
const CURSOR_IDLE_MS = 2500;

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
    this.boundKeys = this.handleKey.bind(this);
    this.boundResize = this.scheduleRender.bind(this);
    this.syncSession = null;
    this.isSyncing = false;
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
    // the other participants' picks from Firebase, keyed by clientId.
    this.moodOpen = false;
    this.moodOrder = null; // the shared board (icon ids), agreed via Firebase
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.moodLockHandled = false;
  }

  async render() {
    this.root.innerHTML = `
      <div class="reader">
        <div class="reader-chrome">
          <button class="reader-back" type="button">← Bibliothek</button>
          <div class="reader-title"></div>
          <button class="reader-sync-btn" type="button" aria-label="Sync">⇄</button>
          <div class="reader-page-indicator"></div>
        </div>
        <div class="sync-panel" hidden>
          <div class="sync-panel-card">
            <div class="sync-panel-title">Seiten synchronisieren</div>
            <div class="sync-panel-desc">Teile den Code, damit jemand anderes die gleiche Seite sieht.</div>
            <div class="sync-create-section">
              <button class="sync-create-btn" type="button">Raum erstellen</button>
            </div>
            <div class="sync-or">— oder —</div>
            <div class="sync-join-section">
              <input class="sync-join-input" type="text" placeholder="Code eingeben" maxlength="6" autocomplete="off" spellcheck="false" />
              <button class="sync-join-btn" type="button">Beitreten</button>
            </div>
            <div class="sync-active-section" hidden>
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
          Fertig? Gefühle teilen
        </button>
        <div class="reader-end" hidden>
          <div class="reader-end-card">
            <div class="reader-end-title">Ende des Buches</div>
            <div class="reader-end-sub">Du hast die letzte Seite erreicht.</div>
            <button class="reader-end-library" type="button">Zur Bibliothek</button>
            <button class="reader-end-stay" type="button">Weiterlesen</button>
          </div>
        </div>
        <div class="reader-loading">Lade…</div>
      </div>
    `;

    const reader = this.root.querySelector('.reader');
    this.readerEl = reader;
    reader.querySelector('.reader-back').addEventListener('click', () => this.close());
    reader.querySelector('.reader-zone-prev').addEventListener('click', () => this.goPrev());
    reader.querySelector('.reader-zone-next').addEventListener('click', () => this.goNext());
    reader.querySelector('.reader-end-library').addEventListener('click', () => this.closeToFirstPage());
    reader.querySelector('.reader-end-stay').addEventListener('click', () => this.hideEnd());
    reader.querySelector('.reader-finish-cue').addEventListener('click', () => this.openMood(true));
    reader.querySelector('.reader-end').addEventListener('click', (e) => {
      if (e.target.closest('.reader-end-card')) return;
      this.hideEnd();
    });

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
        showAlert({ message: 'Der Raum wurde geschlossen.' });
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
        showAlert({ message: 'Der Raum wurde geschlossen.' });
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
      if (absX > SWIPE_PX && absX > absY) {
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
    } else if (this.syncSession?.roomCode) {
      // Finishing a book together opens the shared mood ritual instead of the
      // solo end-of-book card; turning forward past the last page is one of its
      // two triggers (the persistent finish cue on the last page is the other).
      this.openMood(true);
    } else {
      this.showEnd();
    }
  }

  async goPrev() {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.renderCurrent();
      if (this.syncSession) this.syncSession.sendPage(this.currentPage).catch(() => {});
    }
  }

  scheduleRender() {
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
    if (this.pageJumpOpen) return;
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

  showEnd() {
    const end = this.root.querySelector('.reader-end');
    if (end) end.hidden = false;
  }

  hideEnd() {
    const end = this.root.querySelector('.reader-end');
    if (end) end.hidden = true;
  }

  // --- Shared reading memory ("mood ritual", issue #65) -------------------

  // The persistent invitation on the last page. It only appears for a synced
  // pair sitting on the final page with no overlay already up, so a solo reader
  // never sees it and it can't compete with the open mood screen.
  updateMoodCue() {
    const cue = this.root.querySelector('.reader-finish-cue');
    if (!cue) return;
    const show = !!this.syncSession?.roomCode
      && this.currentPage === this.totalPages
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
    if (!session?.roomCode) { this.showEnd(); return; }
    this.moodOpen = true;
    this.moodLockHandled = false;
    // The board is a random subset of the catalogue; both devices must show the
    // identical one. The initiator rolls it; a follower adopts what arrived (and
    // falls back to a fresh roll only if it somehow opened without one).
    this.moodOrder = (order && order.length) ? order : pickMoodBoard();
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
    this.updateMoodCue();
    this.renderMoodOverlay();
    if (initiate) {
      session.startMood(this.moodOrder).catch(() => {});
    }
  }

  renderMoodOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'mood-overlay';
    overlay.innerHTML = `
      <div class="mood-card">
        <button class="mood-cancel" type="button" aria-label="Abbrechen">✕</button>
        <div class="mood-title">Wie war das Buch?</div>
        <div class="mood-instructions"></div>
        <div class="mood-grid"></div>
      </div>
    `;
    this.fillMoodGrid(overlay.querySelector('.mood-grid'));
    overlay.querySelector('.mood-cancel').addEventListener('click', () => this.cancelMood());
    // Escape would otherwise bubble to the window listener and close the whole
    // reader. Intercept it on capture so it acts on the ritual instead: conclude
    // once locked, cancel while still picking — mirroring the on-screen buttons.
    this._moodKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (this.moodLockHandled) {
        this.concludeMood();
      } else {
        this.cancelMood();
      }
    };
    document.addEventListener('keydown', this._moodKeyDown, true);
    this.readerEl?.appendChild(overlay);
    this.moodOverlay = overlay;
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
          <span class="mood-partner-badge" aria-hidden="true" hidden></span>
        </span>
      `;
      btn.addEventListener('click', () => this.toggleMoodIcon(mood.id));
      grid.appendChild(btn);
    }
  }

  toggleMoodIcon(id) {
    if (this.moodLockHandled) return;
    if (this.mySelection.has(id)) {
      this.mySelection.delete(id);
    } else if (this.mySelection.size < MOOD_PICK_COUNT) {
      this.mySelection.add(id);
    } else {
      return; // already at the cap; a swap means deselecting one first
    }
    this.renderMoodSelections();
    this.syncSession?.setMoodPicks([...this.mySelection]).catch(() => {});
    this.maybeLockMood();
  }

  // Reflects both sides' current picks onto the grid: this device's selections
  // get the "mine" state, and any icon a partner has chosen carries a small
  // badge so each reader can watch the other's choices arrive in real time.
  renderMoodSelections() {
    const overlay = this.moodOverlay;
    if (!overlay) return;
    const partnerIds = new Set();
    for (const ids of Object.values(this.moodPartnerPicks)) {
      for (const id of ids) partnerIds.add(id);
    }
    for (const btn of overlay.querySelectorAll('.mood-icon')) {
      const id = Number(btn.dataset.id);
      const mine = this.mySelection.has(id);
      btn.classList.toggle('mood-selected', mine);
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      const badge = btn.querySelector('.mood-partner-badge');
      badge.hidden = !partnerIds.has(id);
    }
    const instructions = overlay.querySelector('.mood-instructions');
    if (instructions && !this.moodLockHandled) {
      // Two live counters: how many more this reader still picks, and how many
      // more of their picks must match the partner's to reach the shared total.
      const remaining = MOOD_PICK_COUNT - this.mySelection.size;
      const overlap = [...this.mySelection].filter((id) => partnerIds.has(id)).length;
      const needed = Math.max(0, MOOD_MIN_OVERLAP - overlap);
      let text;
      if (remaining > 0 && needed > 0) text = `Wähle noch ${remaining}. Einigt Euch auf ${needed}.`;
      else if (remaining > 0) text = `Wähle noch ${remaining}.`;
      else if (needed > 0) text = `Einigt Euch auf ${needed}.`;
      else text = 'Wartet, bis ihr fertig seid …';
      instructions.textContent = text;
    }
  }

  // After either side's picks change, see whether this device and a partner now
  // satisfy the lock rule. We only request the lock here; the actual recording
  // happens when the resulting lock node echoes back through handleMood, so both
  // devices act on the one canonical record (identical moods and timestamp).
  maybeLockMood() {
    if (this.moodLockHandled || !this.moodOpen) return;
    const mine = [...this.mySelection];
    for (const partnerIds of Object.values(this.moodPartnerPicks)) {
      const record = evaluateLock(mine, partnerIds);
      if (record) {
        this.syncSession?.lockMood(record).catch(() => {});
        return;
      }
    }
  }

  handleMood(data) {
    if (!this.moodOpen) {
      // The partner opened the ritual: follow them in on their board, without
      // re-flagging.
      if (data && data.open && !data.lock) this.openMood(false, data.order);
      else if (data && data.lock) { this.openMood(false, data.order); this.handleMoodLock(data.lock); }
      return;
    }
    if (!data) {
      // The whole node was removed. While still selecting that means the other
      // party cancelled, so close too; once we've locked and are showing the
      // result, it just means a participant finished tidying up — leave our
      // celebration on screen until this reader dismisses it.
      if (!this.moodLockHandled) this.closeMoodUI();
      return;
    }
    if (data.lock) {
      this.handleMoodLock(data.lock);
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
    this.renderMoodSelections();
    this.maybeLockMood();
  }

  // The agreed completion arrived. Persist the identical record locally on both
  // devices (guarded so a re-fired listener can't store it twice, and so a
  // bystander who never picked doesn't record someone else's finish), then show
  // the satisfying locked result.
  handleMoodLock(lock) {
    if (this.moodLockHandled) return;
    this.moodLockHandled = true;
    if (this.mySelection.size === MOOD_PICK_COUNT) {
      addCompletion(this.bookId, {
        id: uid(),
        completedAt: lock.at,
        shared: lock.shared,
        personal: lock.personal,
      }).catch(() => {});
    }
    this.showMoodResult(lock);
  }

  showMoodResult(lock) {
    const overlay = this.moodOverlay;
    if (!overlay) return;
    const card = overlay.querySelector('.mood-card');
    overlay.classList.add('mood-locked');
    const icons = [...(lock.shared || []), ...(lock.personal || [])];
    const tiles = icons.map((id) => {
      const mood = MOODS.find((m) => m.id === id);
      if (!mood) return '';
      const personal = (lock.personal || []).includes(id);
      return `
        <div class="mood-result-icon${personal ? ' mood-result-personal' : ''}">
          <img src="${moodIconUrl(mood.slug)}" alt="${mood.label}" draggable="false" />
        </div>`;
    }).join('');
    card.innerHTML = `
      <div class="mood-result-title">Euer gemeinsames Gefühl</div>
      <div class="mood-result-icons">${tiles}</div>
      <button class="mood-result-done" type="button">Fertig</button>
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
    // too. Safe after a lock as well: the record is already stored locally.
    this.syncSession?.clearMood().catch(() => {});
    this.closeMoodUI();
  }

  closeMoodUI() {
    // A concluded ritual leaves its node behind; clear it so a re-read starts
    // clean and re-entering the book doesn't replay the celebration. The record
    // is already stored locally on both devices by the time anyone closes, and
    // clearing is idempotent, so both sides closing is harmless. (A cancel
    // before locking clears via cancelMood instead.)
    if (this.moodLockHandled) this.syncSession?.clearMood().catch(() => {});
    this.moodOpen = false;
    this.mySelection = new Set();
    this.moodPartnerPicks = {};
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
        showAlert({ message: 'Der Raum wurde geschlossen.' });
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
        showAlert({ message: 'Der Raum wurde geschlossen.' });
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
      if (this.source) await showAlert({ message: err.message || 'Beitreten fehlgeschlagen.' });
    } finally {
      this.isSyncing = false;
    }
  }

  async syncJoinCode(code) {
    const session = new SyncSession(this.bookId);
    session.onRemotePageChange = (page) => this.onRemotePage(page);
    session.onRoomDeleted = () => {
      this.syncStop();
      showAlert({ message: 'Der Raum wurde geschlossen.' });
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
      await showAlert({ message: err.message || 'Beitreten fehlgeschlagen.' });
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
  // Used when a book is "finished" — the mood ritual concluding and the solo
  // end-of-book card's "Zur Bibliothek" — but deliberately NOT by the chrome
  // back button, which leaves the book wherever the reader paused. When synced,
  // the room's shared page is reset too so the partner reopens at the start.
  closeToFirstPage() {
    this.currentPage = 1;
    updateLastPage(this.bookId, 1).catch(() => {});
    if (this.syncSession) this.syncSession.sendPage(1).catch(() => {});
    this.close();
  }

  destroy() {
    window.removeEventListener('keydown', this.boundKeys);
    window.removeEventListener('resize', this.boundResize);
    clearTimeout(this.hideTimer);
    clearTimeout(this.cursorTimer);
    clearTimeout(this._resizeT);
    clearTimeout(this.pointerSendTimer);
    clearTimeout(this.longPressTimer);
    this.clearAllPointers();
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
