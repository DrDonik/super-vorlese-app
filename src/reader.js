import { getBookFile, getMeta, getPhotoPage, updateLastPage } from './storage.js';
import { loadPdf, renderPageToCanvas } from './pdf.js';
import { renderImageToCanvas } from './image.js';

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

    reader.addEventListener('mousemove', () => this.showChrome());
    reader.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      this.showChrome();
    }, { passive: true });

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
    } else {
      this.showEnd();
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

  showEnd() {
    const end = this.root.querySelector('.reader-end');
    if (end) end.hidden = false;
  }

  hideEnd() {
    const end = this.root.querySelector('.reader-end');
    if (end) end.hidden = true;
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
    if (this.source) {
      this.source.destroy();
      this.source = null;
    }
  }
}
