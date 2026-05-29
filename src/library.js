import { listBooks, saveBook, deleteBook, renameBook, getThumbs, uid } from './storage.js';
import { loadPdf, renderThumbnail } from './pdf.js';
import { exportBook, importBundle, shareOrDownload } from './bundle.js';
import { closeSyncForBook } from './sync.js';

const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>`;

function deriveTitle(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Unbenannt';
}

export class LibraryView {
  constructor(root, { onOpenBook, onAddPhotos }) {
    this.root = root;
    this.onOpenBook = onOpenBook;
    this.onAddPhotos = onAddPhotos;
    this.thumbUrls = [];
  }

  async render() {
    this.root.innerHTML = `
      <header class="library-header">
        <h1>Vorlese-Bibliothek</h1>
        <div class="library-actions">
          <button class="add-book add-photos" type="button">
            <span>📷 Fotografieren</span>
          </button>
          <label class="add-book add-import">
            <input class="import-input" type="file" accept="application/pdf,.pdf,.vorlese,.zip,application/zip,application/octet-stream" multiple hidden />
            <span>📥 Importieren</span>
          </label>
        </div>
      </header>
      <div class="library-status" hidden></div>
      <div class="library-grid"></div>
    `;

    const importInput = this.root.querySelector('.import-input');
    importInput.addEventListener('change', (e) => this.handleImport(e.target.files));

    const photoBtn = this.root.querySelector('.add-photos');
    photoBtn.addEventListener('click', () => this.onAddPhotos?.());

    await this.renderGrid();
  }

  async renderGrid() {
    // Capture the URLs currently in use and revoke them only after the new
    // grid is built (in `finally`), so the existing thumbnails stay valid
    // while this async rebuild is in flight.
    const oldUrls = this.thumbUrls;
    this.thumbUrls = [];
    try {
      const grid = this.root.querySelector('.library-grid');
      const books = await listBooks();
      if (books.length === 0) {
        grid.innerHTML = `
          <div class="empty">
            <p>Noch keine Bücher.</p>
            <p>Fotografiere Seiten, lade ein PDF oder importiere ein geteiltes Buch.</p>
          </div>
        `;
        return;
      }
      // Fetch all thumbnails in one batch so the build loop below stays
      // synchronous — no awaits inside the loop means no interleaving if
      // renderGrid() is triggered again before this run finishes.
      const thumbs = await getThumbs(books.map((b) => b.id));
      grid.innerHTML = '';
      for (let i = 0; i < books.length; i++) {
        const book = books[i];
        const card = document.createElement('div');
        card.className = 'book-card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-label', `${book.title} öffnen`);
        card.innerHTML = `
          <div class="book-cover"></div>
          <div class="book-title"></div>
          <div class="book-meta"></div>
          <div class="book-actions">
            <button class="book-action book-share" type="button" aria-label="Buch teilen">${ICON_SHARE}</button>
            <button class="book-action book-rename" type="button" aria-label="Buch umbenennen">${ICON_PENCIL}</button>
            <button class="book-action book-delete" type="button" aria-label="Buch löschen">${ICON_TRASH}</button>
          </div>
        `;
        const titleEl = card.querySelector('.book-title');
        titleEl.textContent = book.title;
        card.querySelector('.book-meta').textContent = `${book.pageCount} Seiten`;

        const cover = card.querySelector('.book-cover');
        const thumb = thumbs[i];
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

        const open = () => this.onOpenBook(book.id);
        card.addEventListener('click', (e) => {
          if (e.target.closest('.book-actions')) return;
          open();
        });
        card.addEventListener('keydown', (e) => {
          if (e.target !== card) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });

        const renameBtn = card.querySelector('.book-rename');
        renameBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newTitle = prompt('Neuer Titel:', book.title);
          if (newTitle === null) return;
          const trimmed = newTitle.trim();
          if (!trimmed || trimmed === book.title) return;
          try {
            await renameBook(book.id, trimmed);
          } catch (err) {
            console.error('Fehler beim Umbenennen', err);
            alert('Das Buch konnte nicht umbenannt werden.');
            return;
          }
          book.title = trimmed;
          titleEl.textContent = trimmed;
          card.setAttribute('aria-label', `${trimmed} öffnen`);
        });

        const shareBtn = card.querySelector('.book-share');
        shareBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          shareBtn.disabled = true;
          try {
            const bundle = await exportBook(book.id);
            await shareOrDownload(bundle);
          } catch (err) {
            console.error('Teilen fehlgeschlagen', err);
            alert(`Das Buch konnte nicht geteilt werden: ${err.message || err}`);
          } finally {
            shareBtn.disabled = false;
          }
        });

        const delBtn = card.querySelector('.book-delete');
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`„${book.title}" wirklich löschen?`)) {
            closeSyncForBook(book.id);
            await deleteBook(book.id);
            await this.renderGrid();
          }
        });

        grid.appendChild(card);
      }
    } finally {
      for (const url of oldUrls) URL.revokeObjectURL(url);
    }
  }

  async handleImport(fileList) {
    const files = Array.from(fileList || []);
    const importInput = this.root.querySelector('.import-input');
    if (importInput) importInput.value = '';
    if (files.length === 0) return;
    const pdfs = [];
    const bundles = [];
    for (const f of files) {
      const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
      if (ext === 'pdf' || f.type === 'application/pdf') {
        pdfs.push(f);
      } else if (ext === 'vorlese' || ext === 'zip' || f.type === 'application/zip') {
        bundles.push(f);
      } else {
        alert(`„${f.name}" ist kein unterstütztes Format. Bitte eine PDF- oder .vorlese-Datei wählen.`);
      }
    }
    if (pdfs.length > 0) await this.handleFiles(pdfs);
    for (const bundle of bundles) await this.handleBundle([bundle]);
  }

  async handleBundle(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const status = this.root.querySelector('.library-status');
    status.hidden = false;
    status.textContent = `Importiere ${files[0].name}…`;
    try {
      const { title } = await importBundle(files[0]);
      status.textContent = `„${title}" importiert.`;
    } catch (err) {
      console.error('Import fehlgeschlagen', err);
      status.textContent = `Import fehlgeschlagen: ${err.message || err}`;
    }
    await this.renderGrid();
    const finalMsg = status.textContent;
    setTimeout(() => {
      if (status.textContent === finalMsg) status.hidden = true;
    }, 4000);
  }

  async handleFiles(filesOrFileList) {
    const files = Array.isArray(filesOrFileList) ? filesOrFileList : Array.from(filesOrFileList || []);
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
