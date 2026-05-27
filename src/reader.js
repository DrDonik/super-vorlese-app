import { getBookFile, getMeta, getPhotoPage, updateLastPage } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';
import { SyncSession, getSessionForBook, closeSyncForBook } from './sync.js';

const HIDE_CHROME_AFTER_MS = 2500;

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
  constructor(root, { bookId, onClose }) {
    this.root = root;
    this.bookId = bookId;
    this.onClose = onClose;
    this.source = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.renderToken = 0;
    this.hideTimer = null;
    this.boundKeys = this.handleKey.bind(this);
    this.boundResize = this.scheduleRender.bind(this);
    this.syncSession = null;
    this.isSyncing = false;
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
      if (indicator.querySelector('.page-jump-input') && e.target !== indicator.querySelector('.page-jump-input')) {
        e.preventDefault();
      }
    });

    reader.addEventListener('mousemove', () => this.showChrome());
    reader.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      this.showChrome();
    }, { passive: true });

    this.setupSync(reader);

    this.attachSwipe(reader.querySelector('.reader-stage'));

    window.addEventListener('keydown', this.boundKeys);
    window.addEventListener('resize', this.boundResize);

    const meta = await getMeta(this.bookId);
    if (!meta) {
      alert('Buch nicht gefunden.');
      this.close();
      return;
    }
    reader.querySelector('.reader-title').textContent = meta.title;

    this.source = await createSource(meta);
    if (!this.source) {
      alert('Buch nicht gefunden.');
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
        alert('Der Raum wurde geschlossen.');
      };
      existing.listen();
      this.showSyncActive(existing.roomCode);
    } else {
      const session = new SyncSession(this.bookId);
      session.onRemotePageChange = (page) => this.onRemotePage(page);
      session.onRoomDeleted = () => {
        this.syncStop();
        alert('Der Raum wurde geschlossen.');
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

  attachSwipe(el) {
    let startX = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) startX = e.touches[0].clientX;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
      startX = null;
      if (Math.abs(dx) > 40) {
        if (dx < 0) this.goNext();
        else this.goPrev();
      }
    });
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
    this.showChrome = () => {
      const reader = this.root.querySelector('.reader');
      if (reader) reader.classList.remove('chrome-hidden');
      clearTimeout(this.hideTimer);
    };

    ind.removeAttribute('role');
    ind.removeAttribute('tabindex');
    ind.textContent = '';
    const input = document.createElement('input');
    input.className = 'page-jump-input';
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
    delete this.showChrome;
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
    const reader = this.root.querySelector('.reader');
    if (!reader) return;
    reader.classList.remove('chrome-hidden');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      reader.classList.add('chrome-hidden');
    }, HIDE_CHROME_AFTER_MS);
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
      alert('Buch wird noch geladen. Bitte warten.');
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
        alert('Der Raum wurde geschlossen.');
      };
      this.syncSession = session;
      const code = await session.createRoom(this.currentPage);
      if (!this.source) {
        session.stop();
        this.syncSession = null;
        return;
      }
      this.showSyncActive(code);
    } catch (err) {
      this.syncStop();
      if (this.source) alert(err.message || 'Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      this.isSyncing = false;
    }
  }

  async syncJoin() {
    if (!this.source) {
      alert('Buch wird noch geladen. Bitte warten.');
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
        alert('Der Raum wurde geschlossen.');
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
      if (this.source) alert(err.message || 'Beitreten fehlgeschlagen.');
    } finally {
      this.isSyncing = false;
    }
  }

  syncStop() {
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
    clearTimeout(this._resizeT);
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
