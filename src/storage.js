import {
  get, set, del, keys, getMany, setMany, delMany, update, createStore,
} from 'idb-keyval';

// A second handle on the very store idb-keyval's own get/set use, for the one
// operation here that cannot be expressed as a single-key read-modify-write:
// replacing a book's file (see replaceBookFile). The two names are idb-keyval's
// own defaults — `createStore('keyval-store', 'keyval')` in its
// defaultGetStore(), as of idb-keyval 6.3, which package-lock pins. They have to
// match, or this would quietly operate on a private store of its own and every
// replacement would miss; nothing else in this file names them, so they are
// named here.
const bookStore = createStore('keyval-store', 'keyval');

const BOOK_PREFIX = 'book:';
const META_PREFIX = 'meta:';
const THUMB_PREFIX = 'thumb:';
const PAGE_PREFIX = 'page:';
const COMPLETIONS_PREFIX = 'completions:';

function bookKey(id) {
  return `${BOOK_PREFIX}${id}`;
}

function metaKey(id) {
  return `${META_PREFIX}${id}`;
}

function thumbKey(id) {
  return `${THUMB_PREFIX}${id}`;
}

function pageKey(id, pageNumber) {
  return `${PAGE_PREFIX}${id}:${pageNumber}`;
}

function completionsKey(id) {
  return `${COMPLETIONS_PREFIX}${id}`;
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A stable, device-independent fingerprint of a book's content. Two people who
// hold byte-identical copies of the same book share the same hash, which lets
// the sync layer recognise "you already have this book" and avoid re-sending
// it over the network.
export async function hashBook({ type, fileBlob, pages }) {
  if (type === 'photos') {
    // Hash pages one at a time (digest of the concatenated per-page digests)
    // rather than merging every page into one buffer: a 100-page photo book
    // would otherwise hold ~all pages in memory at once and risk an OOM crash
    // on the iPads/phones this app targets.
    const pageHashes = [];
    for (const page of pages) {
      pageHashes.push(await sha256Hex(await page.arrayBuffer()));
    }
    return sha256Hex(new TextEncoder().encode(pageHashes.join('')));
  }
  return sha256Hex(await fileBlob.arrayBuffer());
}

export async function saveBook({
  id, title, fileBlob, thumbBlob, pageCount, contentHash, tags, workTitle,
  previousContentHashes,
}) {
  await set(bookKey(id), fileBlob);
  if (thumbBlob) {
    await set(thumbKey(id), thumbBlob);
  }
  const meta = {
    id,
    type: 'pdf',
    title,
    pageCount,
    addedAt: Date.now(),
    lastPage: 1,
    contentHash: contentHash ?? await hashBook({ type: 'pdf', fileBlob }),
  };
  // null is written, because that null carries information: "looked, and this
  // PDF has no title". undefined is not: the field then stays absent, which
  // means "not read yet", and the next import tries again (see ensureWorkTitle).
  if (workTitle !== undefined) meta.workTitle = workTitle;
  // Only written when there is something to write, so a book whose title page
  // yields no age recommendation keeps the shape every book has always had.
  if (tags?.length) meta.tags = tags;
  // The provenance list travels with a received bundle (ADR 41); a book never
  // replaced carries nothing here, so the field stays absent for those.
  if (Array.isArray(previousContentHashes) && previousContentHashes.length > 0) {
    meta.previousContentHashes = previousContentHashes;
  }
  await set(metaKey(id), meta);
}

export async function savePhotoBook({ id, title, pages, thumbBlob, contentHash }) {
  await setMany(pages.map((page, i) => [pageKey(id, i + 1), page]));
  if (thumbBlob) {
    await set(thumbKey(id), thumbBlob);
  }
  await set(metaKey(id), {
    id,
    type: 'photos',
    title,
    pageCount: pages.length,
    addedAt: Date.now(),
    lastPage: 1,
    contentHash: contentHash ?? await hashBook({ type: 'photos', pages }),
  });
}

// Every change to a single field of a book's metadata goes through here. Read
// and write happen in one IndexedDB transaction, so two updates that overlap —
// markOpened() as the reader opens a book and updateLastPage() on the first
// page turn, say — can no longer overwrite each other's field with a stale
// value.
//
// Returns whether a record was actually there to change. Callers that decide
// something on the strength of the write — "this book already exists, skip the
// import" — must not mistake a vanished book for a successful update.
//
// A book deleted in the meantime is not resurrected. update() always writes
// back whatever the callback returns, so the miss leaves an entry holding
// undefined; the follow-up del() clears it. Every reader would treat such an
// entry as "no such book" anyway, but it would sit in the key list forever.
async function updateMeta(id, mutate) {
  let updated = false;
  await update(metaKey(id), (meta) => {
    if (!meta) return meta;
    updated = true;
    return mutate(meta);
  });
  if (!updated) await del(metaKey(id));
  return updated;
}

// Moves a book to the front of the library by refreshing its addedAt timestamp
// (listBooks() orders newest-first). Used when a re-import should resurface the
// existing copy where the user expects freshly imported books to appear.
// False if the book is gone.
async function touchBook(id) {
  return updateMeta(id, (meta) => ({ ...meta, addedAt: Date.now() }));
}

export async function listBooks() {
  const allKeys = await keys();
  const metaKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith(META_PREFIX));
  const metas = await getMany(metaKeys);
  return metas
    .filter((m) => m)
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBookFile(id) {
  return get(bookKey(id));
}

export async function getPhotoPage(id, pageNumber) {
  return get(pageKey(id, pageNumber));
}

export async function getPhotoPages(id, count) {
  const pageKeys = [];
  for (let i = 1; i <= count; i++) pageKeys.push(pageKey(id, i));
  return getMany(pageKeys);
}

// Replaces a book's cover picture and nothing else. The book keeps its id, so
// everything else keyed by it stays with it: the saved room code, the
// shared-reading keepsake, the title, the tags and the reading position. This is
// what lets a re-import hand an old book the cover this version can read without
// the book becoming a different book (ADR 29).
//
// A book deleted while the picture was being derived would otherwise keep a
// thumbnail nobody can reach any more, so the write is taken back. False then,
// like the other callers that must not act on a book that is gone.
export async function updateBookThumb(id, thumbBlob) {
  await set(thumbKey(id), thumbBlob);
  if (!(await get(metaKey(id)))) {
    await del(thumbKey(id));
    return false;
  }
  return true;
}

export async function getThumb(id) {
  return get(thumbKey(id));
}

export async function getThumbs(ids) {
  return getMany(ids.map(thumbKey));
}

export async function getMeta(id) {
  return get(metaKey(id));
}

// Returns the book's content hash, computing and persisting it on first access
// for books saved before hashing existed (or imported by an older version).
export async function ensureContentHash(id) {
  const meta = await get(metaKey(id));
  if (!meta) return null;
  if (meta.contentHash) return meta.contentHash;
  let contentHash;
  if (meta.type === 'photos') {
    const pages = await getPhotoPages(id, meta.pageCount);
    if (pages.some((p) => !p)) return null;
    contentHash = await hashBook({ type: 'photos', pages });
  } else {
    const fileBlob = await get(bookKey(id));
    if (!fileBlob) return null;
    contentHash = await hashBook({ type: 'pdf', fileBlob });
  }
  // Hashing a large book takes long enough for the book to be deleted meanwhile
  // (the library stays usable while an import runs). A hash for a book that no
  // longer exists would let callers act on a phantom, so report it as no hash.
  //
  // Long enough, too, for the book to be given a new edition meanwhile, which
  // writes the file and its hash together (see replaceBookFile). The hash
  // computed here then describes bytes the book no longer holds, and writing it
  // back would leave the corrected file wearing the old edition's hash — where
  // a partner's device would recognise it as that old edition and synchronise
  // page by page against a different break. So a hash that is there by the time
  // this writes wins, and is what the caller gets.
  let stored = contentHash;
  if (!(await updateMeta(id, (m) => {
    stored = m.contentHash || contentHash;
    return { ...m, contentHash: stored };
  }))) return null;
  return stored;
}

// Finds a locally stored book whose content matches the given hash, or null.
// Backfills missing hashes as it scans so the match works for older books too.
export async function findBookByContentHash(hash, { type, pageCount } = {}) {
  if (!hash) return null;
  const books = await listBooks();
  for (const book of books) {
    if (book.contentHash === hash) return book;
  }
  for (const book of books) {
    if (book.contentHash) continue;
    // Skip hashing books that can't match anyway — a different type or page
    // count rules them out without paying the cost of digesting their content.
    if (type && (book.type || 'pdf') !== type) continue;
    if (pageCount && book.pageCount !== pageCount) continue;
    if ((await ensureContentHash(book.id)) === hash) {
      book.contentHash = hash;
      return book;
    }
  }
  return null;
}

// Finds the single PDF book whose current contentHash is in the given list, or
// null when nothing matches or more than one does (ADR 41). Used by the receive
// path to recognise a locally held edition as an ancestor of the newer one that
// is being folded in: a hard-identity match that does not rely on workTitle.
// `ignoreIds` leaves a book out of the count — the receive path holds the
// freshly imported copy by its own id.
//
// Unknown hashes are backfilled before the "exactly one match" rule decides.
// A shelf with `A` stored and a second book whose hash is `B` but unrecorded
// would otherwise pass as "one match on `A`" while two of the incoming
// ancestors are in fact on the shelf, and the wrong book would be folded
// into. Resolving them up front costs a few PDF opens on the very first
// shared reading after an update, and nothing after that.
export async function findBookByAnyContentHash(hashes, { ignoreIds = [] } = {}) {
  if (!Array.isArray(hashes) || hashes.length === 0) return null;
  const skip = new Set(ignoreIds);
  const wanted = new Set(hashes);
  const books = (await listBooks()).filter(
    (b) => !skip.has(b.id) && (b.type || 'pdf') === 'pdf',
  );
  for (const book of books) {
    if (book.contentHash) continue;
    const h = await ensureContentHash(book.id);
    if (h) book.contentHash = h;
  }
  const matches = books.filter((b) => b.contentHash && wanted.has(b.contentHash));
  if (matches.length !== 1) return null;
  return matches[0];
}

// Merges the given hashes into a book's provenance list without touching its
// current contentHash. Used when a .vorlese bundle carries ancestors the
// local book did not know about and the bundle itself is being discarded as
// a duplicate (ADR 41): the receiver still has to carry the chain forward,
// or the next re-send from this device would drop it. The book's own
// contentHash is never pushed, and anything already there stays in place.
export async function mergeProvenance(id, hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0) return false;
  return updateMeta(id, (meta) => {
    const existing = Array.isArray(meta.previousContentHashes) ? meta.previousContentHashes : [];
    const merged = [...existing];
    for (const h of hashes) {
      if (!h || h === meta.contentHash || merged.includes(h)) continue;
      merged.push(h);
    }
    if (merged.length === existing.length) return meta;
    return { ...meta, previousContentHashes: merged };
  });
}

// If a book with the given content is already in the library, bump it to the
// front and return it; otherwise return null. Lets re-imports of an existing
// book resurface that copy (preserving its reading progress and title) instead
// of silently creating a duplicate.
export async function findAndBumpExistingBook(hash, { type, pageCount } = {}) {
  const existing = await findBookByContentHash(hash, { type, pageCount });
  if (!existing) return null;
  // Deleted between finding and bumping: report no match, so the caller imports
  // the file instead of skipping it as a duplicate of a book that is gone.
  if (!(await touchBook(existing.id))) return null;
  return existing;
}

// --- Work identity (ADR 40) -------------------------------------------------
// contentHash above identifies one *edition* of a book: its bytes as they are.
// workTitle identifies the *work*, so a corrected re-export can be recognised
// as the same book and replace the edition on the shelf instead of landing
// beside it as a second card with no keepsake on it.
//
// The two are deliberately apart, and nothing here is ever used in place of the
// hash. Every question the sync layer asks — "do I already have this book",
// "does this code belong to the book I have open", "did the file arrive
// intact" — keeps asking contentHash, so two editions can never be taken for
// one another and then synchronised page by page against a different break.
//
// The reader that pulls the title out of a PDF is passed in rather than
// imported here: storage knows how to keep a field, not how a PDF is built, and
// importing src/pdf.js would start its worker for every module that only ever
// wanted IndexedDB — the camera, for one. Same reasoning as the `isSame` that
// addBookTag() takes.

// The work title of a stored book, read and persisted on first access for books
// saved before it was recorded. A PDF that carries no title stores null, which
// is the answer "looked, there is none" and keeps the next import from parsing
// the whole file again; only a missing field means "never looked".
export async function ensureWorkTitle(id, readWorkTitleFromBlob) {
  const meta = await get(metaKey(id));
  if (!meta) return null;
  if ((meta.type || 'pdf') !== 'pdf') return null;
  if ('workTitle' in meta) return meta.workTitle;
  const fileBlob = await get(bookKey(id));
  if (!fileBlob) {
    // A book without its file is unreadable, not titleless, and has to be
    // counted as such — unless the whole book has gone in the meantime, which
    // is nothing to report to anybody.
    return (await get(metaKey(id))) ? undefined : null;
  }
  const workTitle = await readWorkTitleFromBlob(fileBlob);
  // A file that could not be read is not a book without a title, and writing it
  // down as one would be permanent: undefined is passed straight back and
  // nothing is stored, so the next run tries again.
  if (workTitle === undefined) return undefined;
  // Opening a PDF takes long enough for the book to be deleted meanwhile (the
  // library stays usable while an import runs) — the same race
  // ensureContentHash() guards against, with the same answer: report no title
  // rather than let a caller act on a book that is gone.
  if (!(await updateMeta(id, (m) => ({ ...m, workTitle })))) return null;
  return workTitle;
}

// Every PDF book on the shelf by its work title, as `{ index, unreadable }`:
// a Map<workTitle, [{id, title}]> and the number of books whose file could not
// be read at all. Books stored before the title was recorded are read on the way
// through, so the index is complete the first time it is built and free every
// time after that. `onBackfill(done, total)` reports only that reading, because
// it is the one part of this a person waits for.
//
// `unreadable` is handed out rather than swallowed because it is the one thing
// that makes the index silently incomplete, and a book missing from it cannot be
// recognised: it would get a duplicate with nothing on screen to say why. The
// caller says so in its closing line.
export async function buildWorkTitleIndex(readWorkTitleFromBlob, onBackfill) {
  const books = (await listBooks()).filter((b) => (b.type || 'pdf') === 'pdf');
  const total = books.filter((b) => !('workTitle' in b)).length;
  let done = 0;
  let unreadable = 0;
  const index = new Map();
  for (const book of books) {
    let workTitle;
    if ('workTitle' in book) {
      workTitle = book.workTitle;
    } else {
      workTitle = await ensureWorkTitle(book.id, readWorkTitleFromBlob);
      onBackfill?.(++done, total);
      if (workTitle === undefined) unreadable++;
    }
    if (!workTitle) continue;
    const entry = { id: book.id, title: book.title };
    const found = index.get(workTitle);
    if (found) found.push(entry);
    else index.set(workTitle, [entry]);
  }
  return { index, unreadable };
}

// Hands a book already on the shelf the file of a newer edition of itself: the
// same story, re-exported after a correction. It keeps its id, so everything
// keyed by that id stays with it — the shared-reading keepsake (ADR 11), the
// title, the reader's own tags — and only what the new file actually changes is
// written. The reading position is carried over but clamped: a correction can
// shorten a book, and "weiter, wo wir waren" must not point past its last page.
//
// The cover and the age tag are not written here. They are read off the title
// page by the one reader every import path uses (ADR 29), so the caller hands
// them to the book afterwards, exactly as it does for a copy it recognised by
// its hash.
//
// Everything happens in one IndexedDB transaction: the book's record is read,
// the caller's precondition is checked against the shelf as it stands *inside*
// that transaction, and the file and the record are written together or not at
// all. That is three separate reasons in one shape:
//
//   * The file and the record must land together. Two writes left a window in
//     which the book held the new bytes under the old page count and the old
//     hash, and if the second write failed it stayed that way.
//   * The record must be modified from the version in the transaction, not from
//     a copy read a moment earlier — otherwise a tag tapped in „Buch
//     bearbeiten" while a long import runs is written back over. This is why
//     every other writer here goes through updateMeta().
//   * `soleWorkTitle` is the shelf's condition for replacing anything at all:
//     exactly one book carries this work title, and it is this one (ADR 40).
//     Checked here rather than before the call, because between a check outside
//     and the write there is always a gap — another tab, another import run —
//     and a book replaced by mistake takes the right one's keepsake with it.
//     `ignoreIds` leaves a book out of that count: the receive path holds the
//     freshly imported copy, which carries the same title by definition.
//   * `requireKnownShelf` additionally refuses when any book here has no work
//     title recorded at all. Such a book cannot be counted — only reading its
//     PDF would say what it is, and that cannot happen inside a transaction —
//     so it might be the second book carrying this very title. After an index
//     has been built, it means a book that arrived since. The receive path asks
//     for this, because it holds back whenever the shelf is not fully known
//     (see adoptEdition); the library's import deliberately does not, because
//     there it would turn one unreadable file into a shelf full of duplicates
//     (ADR 40).
//
// `keepAddedAt` leaves the book's place on the shelf alone. The library's own
// import does bump it, because dropping a file that is already there is one act
// with one answer and the hash path has always bumped; a book folded in from a
// sync session must not move, because nothing on the receiver's shelf may
// rearrange itself under their hands (ADR 29).
//
// False when nothing was written: the book is gone, or the precondition does not
// hold. The caller then treats the file as a book of its own.
export function replaceBookFile(id, {
  fileBlob, pageCount, contentHash, workTitle,
  // The sender's own chain of predecessors, merged in on the receive path so
  // the next step of the chain still recognises either side's ancestry
  // (ADR 41). Omitted on the library's own „PDF ersetzen" and import paths,
  // where only the local predecessor needs to be remembered.
  incomingPreviousContentHashes = [],
  // The hash-match path's in-transaction guard (ADR 41): the target's current
  // contentHash must still be one of the ancestor hashes the caller found it
  // by. A book that was replaced locally between the lookup and the write no
  // longer qualifies, and the write is refused — the newer file stays, and
  // adoptEdition falls through to the title-path. The soleWorkTitle check
  // below is the equivalent guard for the title path.
  requireContentHashIn = null,
  keepAddedAt = false,
  soleWorkTitle = null, ignoreIds = [], requireKnownShelf = false,
}) {
  return bookStore('readwrite', (store) => new Promise((resolve, reject) => {
    const tx = store.transaction;
    let written = false;
    // Resolved from the transaction, not from the last request: `written` is
    // only true once the writes have actually committed. A failing request
    // aborts the transaction on its own, which lands here as a rejection.
    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB-Transaktion abgebrochen'));

    const write = (meta) => {
      const next = {
        ...meta,
        pageCount,
        contentHash,
        lastPage: Math.min(Math.max(meta.lastPage || 1, 1), pageCount),
      };
      // Three states, each with meaning (ADR 40): a string is the title the
      // new PDF carries, null is "read it, no title there", undefined is
      // "could not read it at all" — and that last one must drop the stored
      // title, not leave the predecessor's in place. A stale workTitle would
      // otherwise let a later import's title-path match this book and
      // overwrite the file the person chose.
      if (workTitle === undefined) delete next.workTitle;
      else next.workTitle = workTitle;
      if (!keepAddedAt) next.addedAt = Date.now();
      // The book's provenance list (ADR 41): what it already carried, plus
      // the edition being replaced right now, plus anything the sender knew
      // about further back. Order kept, duplicates dropped, and the current
      // hash never appears in its own provenance — which matters on a
      // revert, where the stored history and the new contentHash can
      // overlap (replacing `B` with `A` on a book whose history is `[A]`
      // must not keep `A` under its own current hash).
      const provenance = [];
      const push = (h) => {
        if (!h || h === contentHash || provenance.includes(h)) return;
        provenance.push(h);
      };
      if (Array.isArray(meta.previousContentHashes)) {
        for (const h of meta.previousContentHashes) push(h);
      }
      push(meta.contentHash);
      for (const h of incomingPreviousContentHashes) push(h);
      if (provenance.length > 0) next.previousContentHashes = provenance;
      store.put(fileBlob, bookKey(id));
      store.put(next, metaKey(id));
      written = true;
    };

    const metaReq = store.get(metaKey(id));
    metaReq.onsuccess = () => {
      const meta = metaReq.result;
      if (!meta) return;
      // Hash-path guard: the target's current contentHash must still be one
      // the caller matched against. If the book was replaced locally in the
      // gap between the lookup and this transaction, the match is void.
      const hashGuardActive = Array.isArray(requireContentHashIn) && requireContentHashIn.length > 0;
      if (hashGuardActive && !requireContentHashIn.includes(meta.contentHash)) {
        return;
      }
      if (!soleWorkTitle && !hashGuardActive) {
        write(meta);
        return;
      }
      // The condition for either path runs over every PDF book on the shelf,
      // minus this write's `ignoreIds`. The workTitle path checks "exactly
      // one carries this title, and it is this one" (ADR 40). The hash path
      // checks the same under its own key: "exactly one carries a hash from
      // this ancestor list, and it is this one" — same race, same guarantee
      // (ADR 41). Combined with the hashGuard above, which has already
      // asserted this book's own hash is still in the list, the uniqueness
      // check closes the window in which a second shelf book could have
      // been given an ancestor hash after the caller's lookup.
      const wantedHashes = hashGuardActive ? new Set(requireContentHashIn) : null;
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const skip = new Set(ignoreIds.map(metaKey));
        const metaKeys = keysReq.result.filter(
          (k) => typeof k === 'string' && k.startsWith(META_PREFIX) && !skip.has(k),
        );
        let pending = metaKeys.length;
        if (pending === 0) return;
        let matches = 0;
        let matchesThisBook = false;
        let hashMatches = 0;
        let hashMatchesThisBook = false;
        let unknown = false;
        for (const key of metaKeys) {
          const req = store.get(key);
          req.onsuccess = () => {
            const m = req.result;
            if (m && (m.type || 'pdf') === 'pdf') {
              if (wantedHashes && m.contentHash && wantedHashes.has(m.contentHash)) {
                hashMatches++;
                if (key === metaKey(id)) hashMatchesThisBook = true;
              }
              if (soleWorkTitle) {
                if (!('workTitle' in m)) unknown = true;
                else if (m.workTitle === soleWorkTitle) {
                  matches++;
                  if (key === metaKey(id)) matchesThisBook = true;
                }
              }
            }
            // The last answer decides, still inside this transaction.
            if (--pending > 0) return;
            let ok = true;
            if (soleWorkTitle) {
              ok = ok && matches === 1 && matchesThisBook && !(requireKnownShelf && unknown);
            }
            if (hashGuardActive) {
              ok = ok && hashMatches === 1 && hashMatchesThisBook;
            }
            if (ok) write(meta);
          };
        }
      };
    };
  }));
}

// Records that the book was just opened, so the library can offer a "zuletzt
// gelesen" order. Books stored before this field existed simply have no value;
// the library falls back to addedAt for them.
export async function markOpened(id) {
  await updateMeta(id, (meta) => ({ ...meta, lastOpenedAt: Date.now() }));
}

export async function updateLastPage(id, page) {
  await updateMeta(id, (meta) => ({ ...meta, lastPage: page }));
}

// --- Shared reading memory (issue #65) --------------------------------------
// Each book carries a chronological list of completion records, one per time it
// was finished together. A pair record is { id, completedAt, mine:[iconId…],
// theirs:[iconId…] } — this device owner's picks and the partner's, from which
// the shared "Wir" moods are derived at render time. The record is stored from
// each device's own perspective (so "mine" is always this device's reader); the
// partner's device holds the mirror image.
//
// A witness record (issue #82) — kept by the one grandparent reading to two
// grandchildren — instead has the shape { id, completedAt, witnessed: true,
// a:[iconId…], b:[iconId…] }: both children's picks, from which „Ihr"/„Du"/„Du"
// is derived at render time. No name is ever stored in either shape.

export async function getCompletions(id) {
  return (await get(completionsKey(id))) || [];
}

// Appends a completion, newest last. Ignores a record whose completedAt already
// exists for this book so a duplicated lock event (e.g. the listener firing
// twice) can never store the same finish twice.
export async function addCompletion(id, record) {
  const list = (await get(completionsKey(id))) || [];
  if (list.some((c) => c.completedAt === record.completedAt)) return list;
  list.push(record);
  await set(completionsKey(id), list);
  return list;
}

// Batch-loads completion lists for several books at once, mirroring getThumbs,
// so the library can render every cover's mood strip without a query per book.
export async function getCompletionsMany(ids) {
  const lists = await getMany(ids.map(completionsKey));
  return lists.map((l) => l || []);
}

// --- Tags (issue #140) -------------------------------------------------------
// Tags are this device's own organisation of the shelf and never leave it:
// they are not part of the .vorlese bundle and not sent over a sync session
// (see ADR 16). There is no tag registry either — the set of known tags is
// derived from the books carrying them, so a tag removed from its last book
// simply ceases to exist.
//
// Title and tags are written apart because the „Buch bearbeiten" dialog no
// longer offers them as one edit: a tag is stored the moment its chip is
// tapped, while the title waits until the dialog closes (ADR 21). Writing both
// on every chip tap would mean saving a title still being typed.
// Both return whether a book was actually there to update, like the other
// callers of updateMeta: a book deleted meanwhile must not leave the library
// showing a freshly renamed card for something that no longer exists.
export async function updateBookTitle(id, title) {
  return updateMeta(id, (meta) => ({ ...meta, title }));
}

// Adds one tag to a book from within the transaction that reads its metadata, so
// a tag set in „Buch bearbeiten" while a slow import is still deriving this one
// cannot be written back over (the reason updateMeta exists at all). Whether two
// tags are the same is the shelf's business, not storage's — the library folds
// capitalisation its own way and passes that judgement in as `isSame`.
export async function addBookTag(id, tag, isSame) {
  return updateMeta(id, (meta) => {
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    if (tags.some((existing) => isSame(existing, tag))) return meta;
    return { ...meta, tags: [...tags, tag] };
  });
}

export async function updateBookTags(id, tags) {
  return updateMeta(id, (meta) => ({ ...meta, tags }));
}

export async function deleteBook(id) {
  const meta = await get(metaKey(id));
  const keysToDelete = [bookKey(id), thumbKey(id), metaKey(id), completionsKey(id)];
  if (meta?.type === 'photos') {
    for (let i = 1; i <= meta.pageCount; i++) {
      keysToDelete.push(pageKey(id, i));
    }
  }
  await delMany(keysToDelete);
}
