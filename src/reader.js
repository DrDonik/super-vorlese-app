import { getBookFile, getMeta, updateLastPage } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';

const HIDE_CHROME_AFTER_MS = 2500;

export class ReaderView {
  constructor(root, { bookId, onClose }) {
    this.root = root;
    this.bookId = bookId;
    this.onClose = onClose;
    this.pdf = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.renderToken = 0;
    this.hideTimer = null;
    this.boundKeys = this.handleKey.bind(this);
    this.boundResize = this.scheduleRender.bind(this);
  }

  async render() {
    this.root.innerHTML = `
      <div class="reader">
        <div class="reader-chrome">
          <button class="reader-back" type="button">← Bibliothek</button>
          <div class="reader-title"></div>
          <div class="reader-page-indicator"></div>
        </div>
        <div class="reader-stage">
          <canvas class="reader-canvas"></canvas>
          <button class="reader-zone reader-zone-prev" type="button" aria-label="Zurück"></button>
          <button class="reader-zone reader-zone-next" type="button" aria-label="Vor"></button>
        </div>
        <div class="reader-loading">Lade…</div>
      </div>
    `;

    const reader = this.root.querySelector('.reader');
    reader.querySelector('.reader-back').addEventListener('click', () => this.close());
    reader.querySelector('.reader-zone-prev').addEventListener('click', () => this.goPrev());
    reader.querySelector('.reader-zone-next').addEventListener('click', () => this.goNext());

    reader.addEventListener('mousemove', () => this.showChrome());
    reader.addEventListener('touchstart', () => this.showChrome(), { passive: true });

    this.attachSwipe(reader.querySelector('.reader-stage'));

    window.addEventListener('keydown', this.boundKeys);
    window.addEventListener('resize', this.boundResize);

    const meta = await getMeta(this.bookId);
    const fileBlob = await getBookFile(this.bookId);
    if (!fileBlob || !meta) {
      alert('Buch nicht gefunden.');
      this.close();
      return;
    }
    reader.querySelector('.reader-title').textContent = meta.title;

    this.pdf = await loadPdf(fileBlob);
    this.totalPages = this.pdf.numPages;
    this.currentPage = Math.min(Math.max(meta.lastPage || 1, 1), this.totalPages);

    this.root.querySelector('.reader-loading').hidden = true;
    await this.renderCurrent();
    this.showChrome();
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
    }
  }

  async goPrev() {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.renderCurrent();
    }
  }

  scheduleRender() {
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(() => this.renderCurrent(), 120);
  }

  async renderCurrent() {
    if (!this.pdf) return;
    const token = ++this.renderToken;
    const canvas = this.root.querySelector('.reader-canvas');
    const stage = this.root.querySelector('.reader-stage');
    try {
      await renderPageToCanvas(this.pdf, this.currentPage, canvas, stage.clientWidth, stage.clientHeight);
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
    ind.textContent = `Seite ${this.currentPage} / ${this.totalPages}`;
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

  close() {
    this.destroy();
    this.onClose();
  }

  destroy() {
    window.removeEventListener('keydown', this.boundKeys);
    window.removeEventListener('resize', this.boundResize);
    clearTimeout(this.hideTimer);
    clearTimeout(this._resizeT);
    if (this.pdf) {
      this.pdf.destroy?.();
      this.pdf = null;
    }
  }
}
