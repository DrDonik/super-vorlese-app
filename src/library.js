import { listBooks, saveBook, deleteBook, renameBook, getThumb } from './storage.js';
import { loadPdf, renderThumbnail } from './pdf.js';

const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Unbenannt';
}

export class LibraryView {
  constructor(root, { onOpenBook }) {
    this.root = root;
    this.onOpenBook = onOpenBook;
    this.thumbUrls = [];
  }

  async render() {
    this.cleanupThumbUrls();
    this.root.innerHTML = `
      <header class="library-header">
        <h1>Vorlese-Bibliothek</h1>
        <label class="add-book">
          <input type="file" accept="application/pdf" multiple hidden />
          <span>+ Buch hinzufügen</span>
        </label>
      </header>
      <div class="library-status" hidden></div>
      <div class="library-grid"></div>
    `;

    const input = this.root.querySelector('input[type=file]');
    input.addEventListener('change', (e) => this.handleFiles(e.target.files));

    await this.renderGrid();
  }

  async renderGrid() {
    const grid = this.root.querySelector('.library-grid');
    const books = await listBooks();
    if (books.length === 0) {
      grid.innerHTML = `
        <div class="empty">
          <p>Noch keine Bücher.</p>
          <p>Tippe oben auf <strong>+ Buch hinzufügen</strong> und wähle ein PDF.</p>
        </div>
      `;
      return;
    }
    grid.innerHTML = '';
    for (const book of books) {
      const card = document.createElement('button');
      card.className = 'book-card';
      card.type = 'button';
      card.innerHTML = `
        <div class="book-cover"></div>
        <div class="book-title"></div>
        <div class="book-meta"></div>
        <div class="book-actions">
          <button class="book-action book-rename" type="button" aria-label="Buch umbenennen">${ICON_PENCIL}</button>
          <button class="book-action book-delete" type="button" aria-label="Buch löschen">${ICON_TRASH}</button>
        </div>
      `;
      card.querySelector('.book-title').textContent = book.title;
      card.querySelector('.book-meta').textContent = `${book.pageCount} Seiten`;

      const cover = card.querySelector('.book-cover');
      const thumb = await getThumb(book.id);
      if (thumb) {
        const url = URL.createObjectURL(thumb);
        this.thumbUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        cover.appendChild(img);
      } else {
        cover.classList.add('no-cover');
        cover.textContent = '📖';
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('.book-action')) return;
        this.onOpenBook(book.id);
      });

      const renameBtn = card.querySelector('.book-rename');
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newTitle = prompt('Neuer Titel:', book.title);
        if (newTitle === null) return;
        const trimmed = newTitle.trim();
        if (!trimmed || trimmed === book.title) return;
        await renameBook(book.id, trimmed);
        await this.renderGrid();
      });

      const delBtn = card.querySelector('.book-delete');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`„${book.title}" wirklich löschen?`)) {
          await deleteBook(book.id);
          await this.renderGrid();
        }
      });

      grid.appendChild(card);
    }
  }

  async handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const status = this.root.querySelector('.library-status');
    status.hidden = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      status.textContent = `Verarbeite ${i + 1}/${files.length}: ${file.name}…`;
      try {
        const pdf = await loadPdf(file);
        const thumbBlob = await renderThumbnail(pdf, 1, 480);
        await saveBook({
          id: uid(),
          title: deriveTitle(file.name),
          fileBlob: file,
          thumbBlob,
          pageCount: pdf.numPages,
        });
      } catch (err) {
        console.error('Fehler beim Import', file.name, err);
        alert(`„${file.name}" konnte nicht gelesen werden.`);
      }
    }
    status.hidden = true;
    await this.renderGrid();
  }

  cleanupThumbUrls() {
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.thumbUrls = [];
  }

  destroy() {
    this.cleanupThumbUrls();
  }
}
