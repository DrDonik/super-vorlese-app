import { getBookFile, getMeta, getPhotoPage, updateLastPage, ensureContentHash } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';
import { SyncSession, getSessionForBook, closeSyncForBook, getFirebase } from './sync.js';
import { serveBook } from './transfer.js';
import { exportBook } from './bundle.js';
import { showAlert } from './dialog.js';

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
          <div class="pointer-layer" aria-hidden="true"></div>
        </div>
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
    reader.querySelector('.reader-end-library').addEventListener('click', () => this.close());
    reader.querySelector('.reader-end-stay').addEventListener('click', () => this.hideEnd());
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
        const pos = this.stageFraction(startX, startY);
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
        const pos = this.stageFraction(t.clientX, t.clientY);
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
    });

    stage.addEventListener('touchcancel', () => {
      clearTimer();
      finishPointer();
      startX = startY = null;
      aborted = false;
    });
  }

  // Position of a viewport point as a fraction (0..1) of the reader stage, so a
  // pointer lands on the same spot of the page on every device regardless of
  // screen size. Clamped, because a finger may drift past the stage edge.
  stageFraction(clientX, clientY) {
    const stage = this.root.querySelector('.reader-stage');
    if (!stage) return { x: 0, y: 0 };
    const r = stage.getBoundingClientRect();
    const x = r.width ? (clientX - r.left) / r.width : 0;
    const y = r.height ? (clientY - r.top) / r.height : 0;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
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
    this.root.querySelector('.pointer-layer')?.appendChild(el);
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
    const layer = this.root.querySelector('.pointer-layer');
    if (layer) layer.replaceChildren();
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
    // Clear pointers only when the page actually changes, not on a re-render
    // from a resize, so a pointer survives an orientation change mid-gesture.
    if (this.lastRenderedPage !== this.currentPage) {
      this.clearAllPointers();
      this.lastRenderedPage = this.currentPage;
    }
    this.updateIndicator();
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
    if (this.syncSession) this.syncSession.stopListeningPointers();
    this.clearAllPointers();
    closeSyncForBook(this.bookId);
    this.syncSession = null;
    this.showSyncInactive();
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
    }
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
