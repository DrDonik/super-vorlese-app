import {
  listBooks, saveBook, deleteBook, updateBookTitle, updateBookTags, getThumbs, uid,
  findAndBumpExistingBook, hashBook,
  getCompletionsMany,
} from './storage.js';
import { moodById, moodIconUrl, splitMoods, splitWitness, moodRevealRowsHTML, moodWitnessRowsHTML } from './moods.js';
import { loadPdf, renderThumbnail } from './pdf.js';
import { importBundle } from './bundle.js';
import { attachDebugViewportTrigger } from './debug-viewport.js';
import { closeSyncForBook, lookupRoom, getSavedRoomCode } from './sync.js';
import { applyCodeField, bindCodeSubmit } from './code-field.js';
import { showAlert, showConfirm, openDialog } from './dialog.js';

const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

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

// The one definition of "these are the same tag", used everywhere a tag is
// merged, matched or looked up. Only capitalisation is ignored: „Märchen" and
// „Marchen" stay distinct, because they are different words and folding them
// together would silently rewrite what the user typed.
function tagKey(tag) {
  return tag.toLocaleLowerCase('de-CH');
}

function sameTag(a, b) {
  return tagKey(a) === tagKey(b);
}

// Compares the tag sets of one book, which hold no duplicates, so equal length
// plus containment is a full set comparison and the stored order is irrelevant.
function sameTags(a, b) {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

// Every tag in use, in the same order the A–Z titles get, so „3 Jahre" precedes
// „5 Jahre" precedes „10 Jahre". Tags sharing a key are merged onto the
// spelling encountered first; the edit dialog prevents variants from arising in
// the first place, but a shelf carrying both must not offer the same filter
// twice — and matchesFilter uses the same key, so the merged chip still finds
// the books holding the other spelling.
function collectTags(books) {
  const byKey = new Map();
  for (const book of books) {
    for (const tag of bookTags(book)) {
      if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
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
  const tag = filter.slice(TAG_FILTER_PREFIX.length);
  return bookTags(book).some((t) => sameTag(t, tag));
}

// Collapses whitespace and caps the length, so no chip can stretch the filter
// row out of shape. Returns '' for anything that isn't a usable tag.
function normalizeTag(raw) {
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

let tagLabelSeq = 0;

// The `action` showBookEdit reports when the user wants more than to be done
// with the dialog. Symbols rather than strings: identity comparison can't be
// misread, and neither can ever collide with a title.
const DELETE_REQUESTED = Symbol('delete-requested');
const DISCONNECT_REQUESTED = Symbol('disconnect-requested');

// „Buch bearbeiten": title, tags and deletion in one dialog, opened by the
// pencil that used to only rename. Putting tags on the existing button means
// the card gains no fourth control, so the shelf stays as quiet as it is for
// everyone who never tags. Tags are created here and nowhere else — there is no
// separate place to manage them, and one that no book carries any more is
// simply gone.
//
// Deleting lives here too (issue #143): on the cover it sat a fingerwidth from
// „Buch öffnen", so a child aiming for the book met a red warning instead —
// and the confirmation that follows is weak protection for someone who taps the
// bright button to make a surprise dialog go away. Behind the pencil it is
// reached only on purpose.
// „Trennen" lives here too (issue #133), not on the reader's code screen. It is
// the same move ADR 17 made for deleting: a control used a few times a year has
// no business on a surface used every evening — and since that screen now opens
// by itself after „Gemeinsam lesen", a red one-tap disconnect sat directly under
// the code somebody was in the middle of reading out. A Synchronisations-Code
// belongs to the *book*, so the book's own dialog is where it is given up.
//
// Nothing in here is a draft (ADR 21). A tag is stored the moment its chip is
// tapped — `onTagsChange(tags)` does that and resolves falsy if it failed — and
// the title is stored by whoever called us, on every way out. So there is no
// „Speichern" and no „Abbrechen", only „Fertig".
//
// Resolves with { title, action }, where action is DELETE_REQUESTED,
// DISCONNECT_REQUESTED, or undefined for a plain „Fertig".
function showBookEdit({ title, tags, allTags, syncCode, onTagsChange }) {
  const content = document.createElement('div');
  content.className = 'book-edit-body';

  const tagSection = document.createElement('div');
  tagSection.className = 'book-edit-section';
  content.appendChild(tagSection);

  const label = document.createElement('div');
  label.className = 'dialog-field-label';
  label.id = `tag-picker-label-${++tagLabelSeq}`;
  label.textContent = 'Tags';
  tagSection.appendChild(label);

  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-labelledby', label.id);
  tagSection.appendChild(picker);

  // Fold this book's tags onto the shelf's canonical spelling. collectTags()
  // merges „Gelesen" and „gelesen" into one chip, so without this a book
  // holding the losing spelling would show that chip unpressed — and pressing
  // it would save both spellings at once.
  let selected = new Set(
    tags.map((tag) => allTags.find((t) => sameTag(t, tag)) ?? tag),
  );
  const chips = new Map();
  // The last selection the store is known to hold. A write that fails puts the
  // chips back to it, so what is pressed stays something that was really saved.
  let committed = new Set(selected);
  let writeSeq = 0;

  // Says so in the dialog rather than through showAlert: dialogs are serialized
  // (see dialog.js), so an alert raised from inside this one would only appear
  // after it closes — long after the chip it is about.
  const error = document.createElement('div');
  error.className = 'book-edit-error';
  error.setAttribute('role', 'status');
  error.hidden = true;

  // Unhidden before it is filled, so the live region is already in the
  // accessibility tree when its text changes and the change is announced.
  const setError = (text) => {
    error.hidden = !text;
    error.textContent = text;
  };

  const paintChips = () => {
    for (const [tag, chip] of chips) {
      chip.setAttribute('aria-pressed', String(selected.has(tag)));
    }
  };

  // Writing on the tap is what makes the pressed chip a fact instead of a
  // promise the „Speichern" button used to keep (rule 3, issue #155). The
  // caller hands the writes to the store in tap order; only the newest of them
  // may still speak for the chips, because an older one settling afterwards
  // would paint over a tap that has been made since.
  const writeTags = async () => {
    const seq = ++writeSeq;
    const wanted = new Set(selected);
    let ok = false;
    try {
      ok = (await onTagsChange([...wanted])) !== false;
    } catch (err) {
      console.error('Fehler beim Speichern der Tags', err);
    }
    if (ok) committed = wanted;
    if (seq !== writeSeq) return;
    if (!ok) {
      selected = new Set(committed);
      paintChips();
    }
    setError(ok ? '' : 'Die Tags konnten nicht gespeichert werden.');
  };

  const setSelected = (tag, on) => {
    if (on) selected.add(tag);
    else selected.delete(tag);
    chips.get(tag)?.setAttribute('aria-pressed', String(on));
    // Deliberately not awaited: the chip is already showing the new state and
    // writeTags answers for its own failure.
    writeTags();
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
      const existing = [...chips.keys()].find((t) => sameTag(t, tag));
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
  tagSection.appendChild(newRow);
  tagSection.appendChild(error);

  // Only when there is a code to give up: an empty „Gemeinsam lesen" rubric in
  // every book's dialog would be a permanent question mark for the many books
  // that are never read together (same principle as the filter row in ADR 16).
  let stopBtn = null;
  if (syncCode) {
    const syncSection = document.createElement('div');
    syncSection.className = 'book-edit-section';

    const syncLabel = document.createElement('div');
    syncLabel.className = 'dialog-field-label';
    // „des Buches" is dropped: this is the book's own dialog, and the rubric
    // sits in a column of rubrics that all say what the line under them is.
    syncLabel.textContent = 'Synchronisations-Code';
    syncSection.appendChild(syncLabel);

    const code = document.createElement('div');
    code.className = 'book-edit-sync-code';
    code.textContent = syncCode;
    syncSection.appendChild(code);

    const stopRow = document.createElement('div');
    stopRow.className = 'book-edit-actions';

    stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    // The language of the buttons that end the dialog, not of the „Hinzufügen"
    // it used to be an exact twin of one line above (issue #155). Standing on
    // its own it is outlined rather than bare; see .book-edit-actions.
    stopBtn.className = 'dialog-btn';
    stopBtn.textContent = 'Synchronisation trennen';

    stopRow.appendChild(stopBtn);
    syncSection.appendChild(stopRow);
    content.appendChild(syncSection);
  }

  return openDialog({
    title: 'Buch bearbeiten',
    // Not focused on opening, and so not selected either: see dialog.js. What
    // is typed here is saved by every way out of this dialog, „Synchronisation
    // trennen" included — a way out that quietly dropped it would be the one
    // surprise this dialog can no longer afford now that „Abbrechen" is gone.
    // Deleting is the exception, and only because the book goes with it.
    input: { value: title, labelText: 'Titel', autoFocus: false, allowEmpty: true },
    content: (close, inputEl) => {
      stopBtn?.addEventListener('click', () => close({
        title: inputEl.value,
        action: DISCONNECT_REQUESTED,
      }));
      return content;
    },
    dangerButton: { label: 'Buch löschen', value: { action: DELETE_REQUESTED } },
    buttons: [
      { label: 'Fertig', primary: true, getValue: (titleValue) => ({ title: titleValue }) },
    ],
    cancelValue: (titleValue) => ({ title: titleValue }),
  });
}

export class LibraryView {
  constructor(root, { onOpenBook, onStartShared, onAddPhotos, onJoinRoom }) {
    this.root = root;
    this.onOpenBook = onOpenBook;
    this.onStartShared = onStartShared;
    this.onAddPhotos = onAddPhotos;
    this.onJoinRoom = onJoinRoom;
    this.thumbUrls = [];
    this.renderId = 0;
    this.sortMode = loadSortMode();
    // The shelf doubles as the book picker for „Gemeinsam lesen" (issue #133).
    // While this is on, a tap on a book starts a shared session with it instead
    // of opening it to read alone.
    this.selectMode = false;
    this.hasBooks = false;
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
            <button class="add-book select-cancel" type="button" hidden>Abbrechen</button>
          </div>
        </header>
        <div class="library-status" hidden></div>
        <div class="library-sort" role="group" aria-label="Bücher sortieren" hidden></div>
        <div class="library-filter" role="group" aria-label="Bücher filtern" hidden></div>
        <div class="library-grid"></div>
      </div>
    `;

    // Fünf Taps auf die Überschrift blenden die Viewport-Diagnose ein; siehe
    // debug-viewport.js. Die Überschrift trägt sonst keine Funktion, und eine
    // installierte Web-App hat keine Adressleiste für einen Schalter.
    attachDebugViewportTrigger(this.root.querySelector('.library-header h1'));

    const importInput = this.root.querySelector('.import-input');
    importInput.addEventListener('change', (e) => this.handleImport(e.target.files));

    const photoBtn = this.root.querySelector('.add-photos');
    photoBtn.addEventListener('click', () => this.onAddPhotos?.());

    this.root.querySelector('.select-cancel')
      .addEventListener('click', () => this.setSelectMode(false));

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

  // Turns the shelf into the book picker for „Gemeinsam lesen" and back. What
  // leaves is everything that is not choosing a book: the two add buttons, and
  // (via CSS) the pencil and the mood strip on every card, which would open a
  // dialog instead of starting the session. What stays is the sort pills and the
  // filter chips — arranging and narrowing the shelf *is* finding the book, and
  // a household that has tagged its books wants those chips exactly now.
  //
  // The grid is rebuilt rather than patched so the tile and the cards can never
  // disagree about which mode they are in; its scroll position is carried over,
  // because the books must not move under the finger that is about to pick one.
  async setSelectMode(on) {
    if (this.selectMode === on) return;
    this.selectMode = on;
    this.root.querySelector('.library').classList.toggle('select-mode', on);
    this.root.querySelector('.select-cancel').hidden = !on;
    for (const el of this.root.querySelectorAll('.add-photos, .add-import')) el.hidden = on;

    const grid = this.root.querySelector('.library-grid');
    const scrollTop = grid ? grid.scrollTop : 0;
    await this.renderGrid();
    if (grid) grid.scrollTop = scrollTop;

    // Focus would otherwise be stranded on <body>: entering the mode replaces
    // the „Gemeinsam lesen" tile the dialog returned focus to, and leaving it
    // replaces the card that was just chosen. Programmatic focus does not raise
    // a focus ring after a tap (the app rings :focus-visible only), so this
    // costs a mouse or touch user nothing.
    if (on) this.root.querySelector('.library-grid .book-open')?.focus();
    else this.root.querySelector('.connect-card')?.focus();
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
    // renderFilterBar rebuilds the row, so the chip that was just activated is
    // destroyed and focus would fall back to <body> — leaving a keyboard user
    // to tab in from the top of the page again. Put focus back on the chip's
    // replacement, but only if it had focus: on a tap it does not, and forcing
    // it there would raise a focus ring nobody asked for.
    const hadFocus = this.root.querySelector('.library-filter .filter-chip:focus') !== null;
    await this.renderGrid();
    if (hadFocus) {
      this.root.querySelector(`.library-filter [data-filter="${CSS.escape(id)}"]`)?.focus();
    }
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
    // Read by the „Gemeinsam lesen" dialog, which offers the „choose a book"
    // path only when there is one to choose. Kept in step here because this is
    // the render that draws the tile the dialog is opened from.
    this.hasBooks = allBooks.length > 0;

    const sortBar = this.root.querySelector('.library-sort');
    if (sortBar) sortBar.hidden = allBooks.length === 0;

    if (allBooks.length === 0) {
      activeFilter = null;
      this.renderFilterBar([]);
      grid.innerHTML = '';
      grid.appendChild(this.buildConnectTile());
      const empty = document.createElement('div');
      empty.className = 'empty';
      // No „importiere ein geteiltes Buch": since ADR 17 the app hands out no
      // book files any more, so the third way to a book is the one the tile
      // above offers — a Lesepartner sends it over when you join their session.
      empty.innerHTML = `
        <p>Noch keine Bücher.</p>
        <p>Fotografiere Seiten oder lade ein PDF. Beim gemeinsamen Lesen bekommst du das Buch von deinem Lesepartner.</p>
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
      // „Buch öffnen" is a real button covering the whole card, with cover,
      // title and the other controls layered over it (issue #128). The card
      // itself used to be a div[role="button"] holding buttons — invalid ARIA,
      // and the reason the click handler had to sort out which of them was
      // meant. Cover, title and page count carry pointer-events: none, so a tap
      // anywhere on them still falls through to the open button; the pencil and
      // the mood strip sit above it and catch their own taps.
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <button class="book-open" type="button"></button>
        <div class="book-cover"></div>
        <div class="book-title"></div>
        <div class="book-meta"></div>
        <button class="book-action book-edit" type="button" aria-label="Buch bearbeiten">${ICON_PENCIL}</button>
      `;
      const openBtn = card.querySelector('.book-open');
      // The one signal a screen-reader user gets that the shelf is picking a
      // book rather than opening one — the prompt tile is passive text, and a
      // live region announcing it would fire unreliably across ATs.
      openBtn.setAttribute(
        'aria-label',
        this.selectMode ? `${book.title} gemeinsam lesen` : `${book.title} öffnen`,
      );
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
        // In a span of its own rather than on the cover, which also holds the
        // mood strip: aria-hidden on the cover would take that button with it.
        const glyph = document.createElement('span');
        glyph.textContent = '📖';
        glyph.setAttribute('aria-hidden', 'true');
        cover.appendChild(glyph);
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

      // A real button needs no keydown handling of its own: Enter and Space
      // activate it, and the other controls are siblings rather than children,
      // so nothing has to be filtered back out of this click.
      openBtn.addEventListener('click', () => {
        if (this.selectMode) this.onStartShared?.(book.id);
        else this.onOpenBook(book.id);
      });

      const editBtn = card.querySelector('.book-edit');
      editBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        editBtn.disabled = true;
        const initialTags = bookTags(book);
        // Every tag tap is written on its own (ADR 21), chained so that two
        // quick taps reach the store in the order they were made. The chain is
        // extended the moment a write is asked for, which also makes it the
        // thing to wait on before rebuilding the shelf from that store.
        let tagWrites = Promise.resolve();
        let writtenTags = null;
        const onTagsChange = (tags) => {
          const sorted = [...tags].sort(titleCollator.compare);
          const write = tagWrites.then(async () => {
            const saved = await updateBookTags(book.id, sorted);
            if (saved) {
              writtenTags = sorted;
              book.tags = sorted;
            }
            return saved;
          });
          // A failed write must not stall the chain; the dialog hears about it
          // through the promise handed back to it.
          tagWrites = write.catch(() => {});
          return write;
        };
        let edited;
        try {
          edited = await showBookEdit({
            title: book.title,
            tags: initialTags,
            allTags,
            syncCode: getSavedRoomCode(book.id),
            onTagsChange,
          });
        } finally {
          editBtn.disabled = false;
          // The dialog returns focus to whatever had it on opening — this
          // button — but it does that while the button is still disabled, so
          // the focus fell to <body> and a keyboard user had to start over at
          // the top of the page. Now that it can take focus again, put it back.
          // It matters most on the delete path: the confirmation that follows
          // would otherwise have nothing to return to either.
          editBtn.focus();
        }
        // The title is dropped on this path on purpose: renaming a book and
        // deleting it are opposite intents, and the confirmation names the
        // title the book actually still has. Tags written along the way go with
        // the book itself.
        if (edited.action === DELETE_REQUESTED) {
          await this.confirmAndDelete(book);
          return;
        }
        // The last chip tap can still be in flight: the shelf must not be
        // rebuilt from a store that is one write behind what the user saw.
        await tagWrites;
        const tagsChanged = writtenTags !== null && !sameTags(writtenTags, initialTags);

        const newTitle = edited.title.trim();
        // „Fertig" is never disabled — that would trap whoever cleared the
        // field (rule 7) — so an emptied field means the book keeps the title
        // it has, and the unchanged card says so.
        const titleChanged = newTitle !== '' && newTitle !== book.title;
        let titleFailed = false;
        if (titleChanged) {
          let saved;
          try {
            saved = await updateBookTitle(book.id, newTitle);
          } catch (err) {
            console.error('Fehler beim Speichern', err);
            titleFailed = true;
          }
          // Gone while the dialog was open (deleted in another tab). Nothing was
          // written, so rebuild the shelf — the card simply goes away, which is
          // the truth. An error message would be about a book that no longer is.
          if (saved === false) {
            await this.renderGrid();
            return;
          }
          if (!titleFailed) {
            book.title = newTitle;
            titleEl.textContent = newTitle;
            openBtn.setAttribute('aria-label', `${newTitle} öffnen`);
          }
        }

        // After the rename, so the line names the book by the title it now
        // carries. A failed rename does not hold this up: it was asked for
        // separately and the two have nothing to do with each other.
        if (edited.action === DISCONNECT_REQUESTED) {
          closeSyncForBook(book.id);
          // Nothing on the shelf shows a book's sync state, so without a word
          // here the tap would have no visible result at all (rule 3).
          this.showStatus(`„${book.title}" ist nicht mehr synchronisiert.`);
        }

        // Changed tags can add or drop a filter chip, and can push this very
        // book out of the active filter, so the shelf has to be rebuilt. A new
        // title only moves the card under A–Z; the other orders keep it where
        // it is, and leaving it there preserves the scroll position.
        if (tagsChanged || (titleChanged && !titleFailed && this.sortMode === 'title')) {
          await this.renderGrid();
        }

        // Last, so the shelf behind the message already shows what did survive.
        if (titleFailed) {
          await showAlert({ message: 'Der neue Titel konnte nicht gespeichert werden.' });
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

  // One-shot message in the status line above the shelf, cleared after a few
  // seconds unless something newer has taken its place. The import flows drive
  // the same element step by step; this is for an action that simply happened
  // and would otherwise leave no trace on screen.
  showStatus(message) {
    const status = this.root.querySelector('.library-status');
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    setTimeout(() => {
      if (status.textContent === message) status.hidden = true;
    }, 4000);
  }

  // Reached from the „Buch bearbeiten" dialog, which has closed by the time
  // this runs — dialogs are serialized and never stack (see dialog.js). The
  // confirmation stays even though getting here already takes two deliberate
  // taps: deleting a photographed book destroys the only copy of those pages,
  // and nothing in the app can bring it back (issue #131).
  async confirmAndDelete(book) {
    const confirmed = await showConfirm({
      title: 'Buch löschen',
      message: `„${book.title}" wirklich löschen?`,
      confirmLabel: 'Löschen',
      destructive: true,
    });
    if (!confirmed) return;
    closeSyncForBook(book.id);
    await deleteBook(book.id);
    await this.renderGrid();
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
  // Carries no controls of its own, so unlike a book card it can simply be the
  // button rather than needing one layered over it (issue #128).
  //
  // While a book is being picked it stays in place and becomes the instruction
  // instead. Taking it out would shift the whole shelf by one cell, moving the
  // book the reader was just looking at; and its corner is where „Gemeinsam
  // lesen" always sits, so it is the one spot where the explanation is looked
  // for. Quiet grey rather than a signal colour: per ADR 4 green means connected
  // and red means destructive, and this is neither.
  buildConnectTile() {
    if (this.selectMode) {
      const prompt = document.createElement('div');
      prompt.className = 'book-card connect-card connect-prompt';
      prompt.innerHTML = `
        <span class="book-cover connect-cover" aria-hidden="true">👥</span>
        <span class="book-title">Wähle das Buch, das ihr lesen wollt</span>
      `;
      return prompt;
    }
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'book-card connect-card';
    tile.setAttribute('aria-label', 'Gemeinsam lesen');
    tile.innerHTML = `
      <span class="book-cover connect-cover" aria-hidden="true">👥</span>
      <span class="book-title">Gemeinsam lesen</span>
      <span class="book-meta">Synchronisations-Code eingeben und mitlesen</span>
    `;
    tile.addEventListener('click', () => this.startShared());
    return tile;
  }

  // „Gemeinsam lesen" used to ask for a Synchronisations-Code and nothing else,
  // which only ever served the person who had been given one. Whoever holds the
  // book — often the grandparent — was sent away empty-handed, because a code
  // can only be created inside a book, behind a control in the reader nothing
  // in the library points at (issue #133). Both ways out now stand side by side
  // here, in the reader panel's order so the two screens read alike (rule 1).
  //
  // A wrong code returns to this same dialog with what was typed still in the
  // field, rather than dropping back to the shelf: a mistyped character should
  // cost one keystroke to repair, not six (rule 5).
  async startShared() {
    let code = '';
    for (;;) {
      const chosen = await this.askShared(code);
      if (!chosen) return;
      if (chosen.select) {
        await this.setSelectMode(true);
        return;
      }
      code = chosen.code;
      let room;
      try {
        room = await lookupRoom(code);
      } catch (err) {
        await showAlert({ title: 'Gemeinsam lesen', message: err.message || 'Verbindung fehlgeschlagen.' });
        continue;
      }
      // Fetching the book (or reusing a local copy) and opening the reader
      // synced to the room is shared with the reader's own "Verbinden" field —
      // see openRoom in main.js.
      await this.onJoinRoom?.(room);
      return;
    }
  }

  // Resolves with { select: true }, { code }, or null when cancelled. Both ways
  // out live in the content area because the dialog's button row cannot hold
  // them: three buttons abreast do not fit a phone, and the "— oder —" between
  // the two paths is the whole point. „Verbinden" therefore sits under the field
  // it acts on, which is also where it belongs — it confirms the code, while the
  // row below belongs to the dialog as a whole and carries „Abbrechen" for both
  // paths.
  askShared(prefill) {
    const content = document.createElement('div');
    content.className = 'shared-start';

    // The classes are the reader panel's: this is the same control doing the
    // same job on another screen, and a second set of rules would drift.
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'sync-create-btn';
    selectBtn.textContent = 'Buch auswählen und Code erstellen';

    const or = document.createElement('div');
    or.className = 'sync-or';
    or.textContent = '— oder —';

    const label = document.createElement('div');
    label.className = 'sync-join-label';
    label.textContent = 'Synchronisations-Code von deinem Lesepartner bekommen?';

    const row = document.createElement('div');
    row.className = 'shared-start-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input';
    input.value = prefill;
    input.placeholder = 'Synchronisations-Code';
    input.setAttribute('aria-label', 'Synchronisations-Code');
    applyCodeField(input);

    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'sync-join-btn';
    connectBtn.textContent = 'Verbinden';

    row.appendChild(input);
    row.appendChild(connectBtn);

    // Nothing to pick from on an empty shelf, so that path is not offered — it
    // could only lead to a picker with no books in it (rule 5).
    if (this.hasBooks) {
      content.appendChild(selectBtn);
      content.appendChild(or);
    }
    content.appendChild(label);
    content.appendChild(row);

    return openDialog({
      title: 'Gemeinsam lesen',
      message: 'Einer von euch beiden erstellt den Code und sagt ihn dem anderen am Telefon.',
      content: (close) => {
        selectBtn.addEventListener('click', () => close({ select: true }));
        bindCodeSubmit(input, connectBtn, () => close({ code: input.value }));
        return content;
      },
      buttons: [{ label: 'Abbrechen', value: null }],
      cancelValue: null,
    });
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
