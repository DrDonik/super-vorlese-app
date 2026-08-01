import {
  listBooks, saveBook, deleteBook, renameBook, getThumbs, uid,
  findAndBumpExistingBook, hashBook,
  getCompletionsMany,
} from './storage.js';
import { moodById, moodIconUrl, splitMoods, splitWitness, moodRevealRowsHTML, moodWitnessRowsHTML } from './moods.js';
import { loadPdf, renderThumbnail } from './pdf.js';
import { exportBook, importBundle, shareOrDownload } from './bundle.js';
import { closeSyncForBook, lookupRoom } from './sync.js';
import { showAlert, showConfirm, showPrompt } from './dialog.js';

const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>`;

function deriveTitle(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Unbenannt';
}

// --- Sorting ----------------------------------------------------------------
// The pills stay visible no matter how many books there are (they only vanish
// with an empty library, which is a visibly different screen): a control that
// appears and disappears as the shelf grows is exactly the kind of surprise
// this app's users should never have to explain to themselves.

const SORT_MODES = [
  { id: 'opened', label: 'Zuletzt gelesen' },
  { id: 'title', label: 'A–Z' },
  { id: 'added', label: 'Hinzugefügt' },
];

// Bedtime reading returns to the same book night after night, so the book you
// last read belongs on top. Until anything has been opened this is identical to
// 'added', because lastOpenedAt falls back to addedAt.
const DEFAULT_SORT = 'opened';
const SORT_STORAGE_KEY = 'library-sort';

function loadSortMode() {
  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    if (SORT_MODES.some((m) => m.id === stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode); the default is fine.
  }
  return DEFAULT_SORT;
}

function storeSortMode(mode) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, mode);
  } catch {
    // Not remembering the choice is a smaller failure than breaking the view.
  }
}

// numeric so „Band 2" precedes „Band 10"; base sensitivity so „Ätna" sorts with
// the A's and capitalisation never splits otherwise identical titles.
const titleCollator = new Intl.Collator('de-CH', { numeric: true, sensitivity: 'base' });

// listBooks() delivers newest-added first and Array.prototype.sort is stable, so
// every mode falls back to that order for ties without comparing explicitly.
function sortBooks(books, mode) {
  if (mode === 'title') {
    return [...books].sort((a, b) => titleCollator.compare(a.title, b.title));
  }
  if (mode === 'opened') {
    const opened = (b) => b.lastOpenedAt ?? b.addedAt;
    return [...books].sort((a, b) => opened(b) - opened(a));
  }
  return books;
}

export class LibraryView {
  constructor(root, { onOpenBook, onAddPhotos, onJoinRoom }) {
    this.root = root;
    this.onOpenBook = onOpenBook;
    this.onAddPhotos = onAddPhotos;
    this.onJoinRoom = onJoinRoom;
    this.thumbUrls = [];
    this.renderId = 0;
    this.sortMode = loadSortMode();
  }

  async render() {
    this.root.innerHTML = `
      <div class="library">
        <header class="library-header">
          <h1>Bibliothek</h1>
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
        <div class="library-sort" role="group" aria-label="Bücher sortieren" hidden></div>
        <div class="library-grid"></div>
      </div>
    `;

    const importInput = this.root.querySelector('.import-input');
    importInput.addEventListener('change', (e) => this.handleImport(e.target.files));

    const photoBtn = this.root.querySelector('.add-photos');
    photoBtn.addEventListener('click', () => this.onAddPhotos?.());

    this.buildSortBar();

    await this.renderGrid();
  }

  buildSortBar() {
    const bar = this.root.querySelector('.library-sort');
    for (const mode of SORT_MODES) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'sort-pill';
      pill.dataset.mode = mode.id;
      pill.textContent = mode.label;
      pill.setAttribute('aria-pressed', String(mode.id === this.sortMode));
      pill.addEventListener('click', () => this.setSortMode(mode.id));
      bar.appendChild(pill);
    }
  }

  async setSortMode(mode) {
    if (mode === this.sortMode) return;
    this.sortMode = mode;
    storeSortMode(mode);
    for (const pill of this.root.querySelectorAll('.sort-pill')) {
      pill.setAttribute('aria-pressed', String(pill.dataset.mode === mode));
    }
    await this.renderGrid();
    // Show the new top of the shelf: reordering while scrolled halfway down
    // would otherwise look like nothing happened.
    const grid = this.root.querySelector('.library-grid');
    if (grid) grid.scrollTop = 0;
  }

  async renderGrid() {
    const grid = this.root.querySelector('.library-grid');
    if (!grid) return;

    // Tag this run. If a newer renderGrid() starts while we're awaiting, the
    // stale run bails out at the next checkpoint instead of clobbering the
    // newer DOM or leaking its object URLs.
    const renderId = ++this.renderId;
    const isStale = () => this.renderId !== renderId;

    const books = sortBooks(await listBooks(), this.sortMode);
    if (isStale()) return;

    const sortBar = this.root.querySelector('.library-sort');
    if (sortBar) sortBar.hidden = books.length === 0;

    if (books.length === 0) {
      grid.innerHTML = '';
      grid.appendChild(this.buildConnectTile());
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `
        <p>Noch keine Bücher.</p>
        <p>Fotografiere Seiten, lade ein PDF oder importiere ein geteiltes Buch.</p>
      `;
      grid.appendChild(empty);
      this.cleanupThumbUrls();
      return;
    }

    // Fetch all thumbnails in one batch so the build loop below is fully
    // synchronous: after this last await there is no interleaving point, so
    // the latest run always completes its DOM swap atomically.
    const [thumbs, completionsLists] = await Promise.all([
      getThumbs(books.map((b) => b.id)),
      getCompletionsMany(books.map((b) => b.id)),
    ]);
    if (isStale()) return;

    const newUrls = [];
    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.buildConnectTile());
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
        newUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        cover.appendChild(img);
      } else {
        cover.classList.add('no-cover');
        cover.textContent = '📖';
      }

      // The most recent shared-reading completion surfaces as a strip of mood
      // miniatures along the bottom of the cover; tapping it opens the full
      // history rather than the book, so the cover tap still goes straight to
      // reading (issue #65).
      const completions = completionsLists[i];
      if (completions.length > 0) {
        const latest = completions[completions.length - 1];
        const strip = document.createElement('button');
        strip.type = 'button';
        strip.className = 'book-mood-strip';
        strip.setAttribute('aria-label', `Gefühle zu „${book.title}" ansehen`);
        // A row of every distinct mood from the latest read: the shared ones,
        // then each reader's own — the cover's at-a-glance memory of the book. A
        // witnessed read (issue #82) shows both children's distinct moods, shared
        // first, the same way.
        let stripIds;
        if (latest.witnessed) {
          const { shared, aOnly, bOnly } = splitWitness(latest.a || [], latest.b || []);
          stripIds = [...shared, ...aOnly, ...bOnly];
        } else {
          const { mineOnly, ours, theirsOnly } = splitMoods(latest.mine || [], latest.theirs || []);
          stripIds = [...ours, ...mineOnly, ...theirsOnly];
        }
        for (const id of stripIds) {
          const mood = moodById(id);
          if (!mood) continue;
          const img = document.createElement('img');
          img.src = moodIconUrl(mood.slug);
          img.alt = '';
          strip.appendChild(img);
        }
        strip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openMoodHistory(book, completions);
        });
        cover.appendChild(strip);
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
        renameBtn.disabled = true;
        let newTitle = null;
        try {
          newTitle = await showPrompt({
            title: 'Buch umbenennen',
            value: book.title,
            confirmLabel: 'Speichern',
          });
        } finally {
          renameBtn.disabled = false;
        }
        if (newTitle === null) return;
        const trimmed = newTitle.trim();
        if (!trimmed || trimmed === book.title) return;
        try {
          await renameBook(book.id, trimmed);
        } catch (err) {
          console.error('Fehler beim Umbenennen', err);
          await showAlert({ message: 'Das Buch konnte nicht umbenannt werden.' });
          return;
        }
        book.title = trimmed;
        titleEl.textContent = trimmed;
        card.setAttribute('aria-label', `${trimmed} öffnen`);
        // Under A–Z the new name usually belongs somewhere else on the shelf;
        // leaving the card where it was would contradict the very order the
        // user selected. The other modes are unaffected by a title change.
        if (this.sortMode === 'title') await this.renderGrid();
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
          await showAlert({ message: `Das Buch konnte nicht geteilt werden: ${err.message || err}` });
        } finally {
          shareBtn.disabled = false;
        }
      });

      const delBtn = card.querySelector('.book-delete');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm({
          title: 'Buch löschen',
          message: `„${book.title}" wirklich löschen?`,
          confirmLabel: 'Löschen',
          destructive: true,
        });
        if (confirmed) {
          closeSyncForBook(book.id);
          await deleteBook(book.id);
          await this.renderGrid();
        }
      });

      fragment.appendChild(card);
    }

    // Commit synchronously: replace the grid, then swap in the new URLs and
    // revoke the batch they replace.
    grid.innerHTML = '';
    grid.appendChild(fragment);
    const oldUrls = this.thumbUrls;
    this.thumbUrls = newUrls;
    for (const url of oldUrls) URL.revokeObjectURL(url);
  }

  // Shows every time this book was finished together, newest first: the date
  // plus that read's moods in the same „Ich / Wir / Du" layout as the reveal, so
  // the history is a faithful keepsake of each finish. Reuses the dialog overlay
  // styling for consistency with the app's other modals.
  openMoodHistory(book, completions) {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const card = document.createElement('div');
    card.className = 'dialog-card mood-history-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', `Gefühle zu „${book.title}"`);

    const fmtDate = (ts) =>
      new Date(ts).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });

    const entries = [...completions].reverse().map((c) => `
      <li class="mood-history-entry">
        <div class="mood-history-date">${fmtDate(c.completedAt)}</div>
        ${c.witnessed ? moodWitnessRowsHTML(c.a || [], c.b || []) : moodRevealRowsHTML(c.mine || [], c.theirs || [])}
      </li>`).join('');

    card.innerHTML = `
      <div class="dialog-title"></div>
      <ul class="mood-history-list">${entries}</ul>
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-primary mood-history-close" type="button">Schliessen</button>
      </div>
    `;
    card.querySelector('.dialog-title').textContent = book.title;

    const close = () => {
      document.removeEventListener('keydown', onKeyDown, false);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKeyDown, false);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('.mood-history-close').addEventListener('click', close);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.mood-history-close').focus();
  }

  // The permanent first tile in the library: starts a synced reading session
  // with a partner. Framed around the intent ("read together"), not as a third
  // way to import a book — joining may fetch the book, or use a copy you have.
  buildConnectTile() {
    const tile = document.createElement('div');
    tile.className = 'book-card connect-card';
    tile.setAttribute('role', 'button');
    tile.tabIndex = 0;
    tile.setAttribute('aria-label', 'Gemeinsam lesen');
    tile.innerHTML = `
      <div class="book-cover connect-cover">👥</div>
      <div class="book-title">Gemeinsam lesen</div>
      <div class="book-meta">Synchronisations-Code eingeben und mitlesen</div>
    `;
    tile.addEventListener('click', () => this.startJoin());
    tile.addEventListener('keydown', (e) => {
      if (e.target !== tile) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.startJoin();
      }
    });
    return tile;
  }

  async startJoin() {
    const entered = await showPrompt({
      title: 'Gemeinsam lesen',
      message: 'Frag deinen Lesepartner nach dem Synchronisations-Code des Buches, das ihr gemeinsam lesen wollt.',
      placeholder: 'Synchronisations-Code',
      confirmLabel: 'Verbinden',
    });
    if (entered === null) return;

    let room;
    try {
      room = await lookupRoom(entered);
    } catch (err) {
      await showAlert({ title: 'Gemeinsam lesen', message: err.message || 'Verbindung fehlgeschlagen.' });
      return;
    }

    // Fetching the book (or reusing a local copy) and opening the reader synced
    // to the room is shared with the reader's own "Verbinden" field — see
    // openRoom in main.js.
    await this.onJoinRoom?.(room);
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
        await showAlert({ message: `„${f.name}" ist kein unterstütztes Format. Bitte eine PDF- oder .vorlese-Datei wählen.` });
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
      const { title } = await importBundle(files[0], { dedupe: true });
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
        try {
          const pageCount = pdf.numPages;
          // Re-importing a book the user already has resurfaces the existing copy
          // (moved to the front) rather than creating a confusing duplicate.
          const contentHash = await hashBook({ type: 'pdf', fileBlob: file });
          if (await findAndBumpExistingBook(contentHash, { type: 'pdf', pageCount })) {
            continue;
          }
          const thumbBlob = await renderThumbnail(pdf, 1, 480);
          await saveBook({
            id: uid(),
            title: deriveTitle(file.name),
            fileBlob: file,
            thumbBlob,
            pageCount,
            contentHash,
          });
        } finally {
          // Release PDF.js document/worker resources on every path (duplicate,
          // success, or error) to avoid OOM crashes on memory-limited devices.
          pdf.destroy?.();
        }
      } catch (err) {
        console.error('Fehler beim Import', file.name, err);
        await showAlert({ message: `„${file.name}" konnte nicht gelesen werden.` });
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
    // Invalidate any in-flight renderGrid() run so it bails out instead of
    // creating URLs into a torn-down view after we have cleaned up.
    this.renderId++;
    this.cleanupThumbUrls();
  }
}
