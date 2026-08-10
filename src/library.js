import {
  listBooks, saveBook, deleteBook, updateBookDetails, getThumbs, uid,
  findAndBumpExistingBook, hashBook,
  getCompletionsMany,
} from './storage.js';
import { moodById, moodIconUrl, splitMoods, splitWitness, moodRevealRowsHTML, moodWitnessRowsHTML } from './moods.js';
import { loadPdf, renderThumbnail } from './pdf.js';
import { exportBook, importBundle, shareOrDownload } from './bundle.js';
import { closeSyncForBook, lookupRoom } from './sync.js';
import { showAlert, showConfirm, showPrompt, openDialog } from './dialog.js';

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

// --- Tags and filtering (issue #140) ----------------------------------------
// Organising the shelf is a power-user job — the parent who keeps the library,
// not the child or the grandparent who reads from it. So the filter row does
// not exist until there is something to filter: a library nobody has tagged
// looks exactly as it did before, and the book cards themselves are unchanged.
//
// Filtering, not grouping by tag: a book can carry several tags, so tag
// headings would either repeat a book on the shelf or need an arbitrary
// "primary tag" rule. One filter at a time also spares everyone boolean logic
// (rule 8) and can never produce a combination that matches nothing.

const FILTER_DONE = 'done';
const FILTER_OPEN = 'open';
const TAG_FILTER_PREFIX = 'tag:';

const MAX_TAG_LENGTH = 20;

// Session-scoped on purpose, and deliberately not stored the way the sort mode
// is: a filter *hides* books, and nobody should open the app to a shelf that is
// silently half empty. A module-level value outlives the view being remounted
// (open a book, come back) and dies with the page — exactly the lifetime we
// want. Within a session the selected chip stays visible right above the grid,
// so the missing books are always explained and one tap from coming back.
let activeFilter = null;

function bookTags(book) {
  return Array.isArray(book.tags) ? book.tags : [];
}

function sameCaseInsensitive(a, b) {
  return a.localeCompare(b, 'de-CH', { sensitivity: 'base' }) === 0;
}

// Compares the tag sets of one book, which hold no duplicates, so equal length
// plus containment is a full set comparison and the stored order is irrelevant.
function sameTags(a, b) {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

// Every tag in use, in the same order the A–Z titles get, so „3 Jahre" precedes
// „5 Jahre" precedes „10 Jahre". Tags that differ only in capitalisation are
// merged onto the spelling encountered first; the edit dialog prevents them
// from arising in the first place, but a shelf carrying both must not offer the
// same filter twice.
function collectTags(books) {
  const byKey = new Map();
  for (const book of books) {
    for (const tag of bookTags(book)) {
      const key = tag.toLocaleLowerCase('de-CH');
      if (!byKey.has(key)) byKey.set(key, tag);
    }
  }
  return [...byKey.values()].sort(titleCollator.compare);
}

// The chips on offer for the shelf in front of us. „Schon gelesen" / „Noch
// nicht gelesen" appear only as a pair and only while they actually divide the
// shelf: with every book finished — or none — one chip would show everything
// and the other nothing. Because every chip is derived from these very books,
// no chip can filter the shelf down to an empty grid.
//
// Finished means the book has a shared-reading completion (ADR 11/12), the fact
// the app already records when two readers end a book together. Nothing is ever
// auto-tagged: closing a book usually means "that's enough for tonight", so a
// tag written on that event would be wrong more often than right.
function buildFilterChips(books, doneFlags) {
  const chips = [];
  const doneCount = doneFlags.filter(Boolean).length;
  if (doneCount > 0 && doneCount < books.length) {
    chips.push({ id: FILTER_DONE, label: 'Schon gelesen' });
    chips.push({ id: FILTER_OPEN, label: 'Noch nicht gelesen' });
  }
  for (const tag of collectTags(books)) {
    chips.push({ id: `${TAG_FILTER_PREFIX}${tag}`, label: tag });
  }
  return chips;
}

function matchesFilter(book, isDone, filter) {
  if (!filter) return true;
  if (filter === FILTER_DONE) return isDone;
  if (filter === FILTER_OPEN) return !isDone;
  return bookTags(book).includes(filter.slice(TAG_FILTER_PREFIX.length));
}

// Collapses whitespace and caps the length, so no chip can stretch the filter
// row out of shape. Returns '' for anything that isn't a usable tag.
function normalizeTag(raw) {
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

let tagLabelSeq = 0;

// „Buch bearbeiten": title and tags in one dialog, opened by the pencil that
// used to only rename. Putting tags on the existing button means the card gains
// no fourth control, so the shelf stays as quiet as it is for everyone who
// never tags. Tags are created here and nowhere else — there is no separate
// place to manage them, and one that no book carries any more is simply gone.
// Resolves with { title, tags }, or null when cancelled.
function showBookEdit({ title, tags, allTags }) {
  const content = document.createElement('div');
  content.className = 'book-edit-tags';

  const label = document.createElement('div');
  label.className = 'book-edit-label';
  label.id = `tag-picker-label-${++tagLabelSeq}`;
  label.textContent = 'Tags';
  content.appendChild(label);

  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-labelledby', label.id);
  content.appendChild(picker);

  // Fold this book's tags onto the shelf's canonical spelling. collectTags()
  // merges „Gelesen" and „gelesen" into one chip, so without this a book
  // holding the losing spelling would show that chip unpressed — and pressing
  // it would save both spellings at once.
  const selected = new Set(
    tags.map((tag) => allTags.find((t) => sameCaseInsensitive(t, tag)) ?? tag),
  );
  const chips = new Map();

  const setSelected = (tag, on) => {
    if (on) selected.add(tag);
    else selected.delete(tag);
    chips.get(tag)?.setAttribute('aria-pressed', String(on));
  };

  const addChip = (tag) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip';
    chip.textContent = tag;
    chip.setAttribute('aria-pressed', String(selected.has(tag)));
    chip.addEventListener('click', () => setSelected(tag, !selected.has(tag)));
    chips.set(tag, chip);
    picker.appendChild(chip);
  };

  // Every tag in the library, so tagging a book is picking, not retyping
  // (rule 8). A tag this book alone carries is part of that list already.
  for (const tag of allTags) addChip(tag);

  const newRow = document.createElement('div');
  newRow.className = 'tag-new';

  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.className = 'dialog-input tag-new-input';
  newInput.placeholder = 'Neuer Tag';
  newInput.maxLength = MAX_TAG_LENGTH;
  newInput.autocomplete = 'off';
  newInput.setAttribute('aria-label', 'Neuen Tag hinzufügen');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tag-add';
  addBtn.textContent = 'Hinzufügen';

  const syncAddBtn = () => { addBtn.disabled = normalizeTag(newInput.value) === ''; };

  // Typing a tag that exists already — in any capitalisation — selects that one
  // instead of putting a near-duplicate next to it.
  const commitNewTag = () => {
    const tag = normalizeTag(newInput.value);
    if (tag) {
      const existing = [...chips.keys()].find((t) => sameCaseInsensitive(t, tag));
      if (!existing) addChip(tag);
      setSelected(existing ?? tag, true);
    }
    newInput.value = '';
    syncAddBtn();
    newInput.focus();
  };

  newInput.addEventListener('input', syncAddBtn);
  newInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // While the cursor is in this field, Enter belongs to it: it adds the tag
    // rather than reaching the dialog, which would discard the half-typed word.
    e.preventDefault();
    e.stopPropagation();
    commitNewTag();
  });
  addBtn.addEventListener('click', commitNewTag);
  syncAddBtn();

  newRow.appendChild(newInput);
  newRow.appendChild(addBtn);
  content.appendChild(newRow);

  return openDialog({
    title: 'Buch bearbeiten',
    input: { value: title, placeholder: 'Titel', label: 'Titel' },
    content,
    buttons: [
      { label: 'Abbrechen', value: null },
      {
        label: 'Speichern',
        primary: true,
        getValue: (titleValue) => ({ title: titleValue, tags: [...selected] }),
      },
    ],
    cancelValue: null,
  });
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
        <div class="library-filter" role="group" aria-label="Bücher filtern" hidden></div>
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

  // Rebuilt on every render rather than once like the sort pills, because the
  // chips themselves come and go as books are tagged, finished or deleted.
  renderFilterBar(chips) {
    const bar = this.root.querySelector('.library-filter');
    if (!bar) return;
    bar.hidden = chips.length === 0;
    bar.innerHTML = '';
    for (const chip of chips) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'filter-chip';
      el.dataset.filter = chip.id;
      el.textContent = chip.label;
      el.setAttribute('aria-pressed', String(chip.id === activeFilter));
      el.addEventListener('click', () => this.setFilter(chip.id));
      bar.appendChild(el);
    }
  }

  // Tapping the active chip clears the filter: the control that hid the books
  // brings them back, so there is no separate „Alle" chip to look for (rule 6).
  async setFilter(id) {
    activeFilter = activeFilter === id ? null : id;
    await this.renderGrid();
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

    const allBooks = sortBooks(await listBooks(), this.sortMode);
    if (isStale()) return;

    const sortBar = this.root.querySelector('.library-sort');
    if (sortBar) sortBar.hidden = allBooks.length === 0;

    if (allBooks.length === 0) {
      activeFilter = null;
      this.renderFilterBar([]);
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
    // the latest run always completes its DOM swap atomically. Loaded for the
    // whole shelf, not just the visible part — the filter chips are derived
    // from the completions of every book, and filtering afterwards keeps that
    // single batch as the last await.
    const [allThumbs, allCompletions] = await Promise.all([
      getThumbs(allBooks.map((b) => b.id)),
      getCompletionsMany(allBooks.map((b) => b.id)),
    ]);
    if (isStale()) return;

    const doneFlags = allCompletions.map((list) => list.length > 0);
    const chips = buildFilterChips(allBooks, doneFlags);
    // The chip we were filtering by can disappear under us — the last book
    // carrying that tag gets deleted or retagged, or finishing the final open
    // book collapses the „gelesen" pair. Fall back to the whole shelf rather
    // than leaving a filter active that nothing on screen explains.
    if (activeFilter && !chips.some((c) => c.id === activeFilter)) activeFilter = null;
    this.renderFilterBar(chips);
    const allTags = collectTags(allBooks);

    const books = [];
    const thumbs = [];
    const completionsLists = [];
    for (let i = 0; i < allBooks.length; i++) {
      if (!matchesFilter(allBooks[i], doneFlags[i], activeFilter)) continue;
      books.push(allBooks[i]);
      thumbs.push(allThumbs[i]);
      completionsLists.push(allCompletions[i]);
    }

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
          <button class="book-action book-edit" type="button" aria-label="Buch bearbeiten">${ICON_PENCIL}</button>
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

      const editBtn = card.querySelector('.book-edit');
      editBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        editBtn.disabled = true;
        let edited = null;
        try {
          edited = await showBookEdit({
            title: book.title,
            tags: bookTags(book),
            allTags,
          });
        } finally {
          editBtn.disabled = false;
        }
        if (edited === null) return;
        const newTitle = edited.title.trim();
        if (!newTitle) return;
        const newTags = [...edited.tags].sort(titleCollator.compare);
        const titleChanged = newTitle !== book.title;
        const tagsChanged = !sameTags(newTags, bookTags(book));
        if (!titleChanged && !tagsChanged) return;
        try {
          await updateBookDetails(book.id, { title: newTitle, tags: newTags });
        } catch (err) {
          console.error('Fehler beim Speichern', err);
          await showAlert({ message: 'Die Änderungen konnten nicht gespeichert werden.' });
          return;
        }
        book.title = newTitle;
        book.tags = newTags;
        titleEl.textContent = newTitle;
        card.setAttribute('aria-label', `${newTitle} öffnen`);
        // Changed tags can add or drop a filter chip, and can push this very
        // book out of the active filter, so the shelf has to be rebuilt. A new
        // title only moves the card under A–Z; the other orders keep it where
        // it is, and leaving it there preserves the scroll position.
        if (tagsChanged || (titleChanged && this.sortMode === 'title')) await this.renderGrid();
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
