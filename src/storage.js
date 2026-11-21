import { get, set, del, keys, getMany, setMany, delMany, update } from 'idb-keyval';

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

export async function saveBook({ id, title, fileBlob, thumbBlob, pageCount, contentHash, tags, workTitle }) {
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
    // Always written, null included, because the null carries information:
    // "looked, and this PDF has no title" (see ensureWorkTitle).
    workTitle: workTitle ?? null,
  };
  // Only written when there is something to write, so a book whose title page
  // yields no age recommendation keeps the shape every book has always had.
  if (tags?.length) meta.tags = tags;
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
  if (!(await updateMeta(id, (m) => ({ ...m, contentHash })))) return null;
  return contentHash;
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
  if (!fileBlob) return null;
  const workTitle = await readWorkTitleFromBlob(fileBlob);
  // Opening a PDF takes long enough for the book to be deleted meanwhile (the
  // library stays usable while an import runs) — the same race
  // ensureContentHash() guards against, with the same answer: report no title
  // rather than let a caller act on a book that is gone.
  if (!(await updateMeta(id, (m) => ({ ...m, workTitle })))) return null;
  return workTitle;
}

// Every PDF book on the shelf by its work title: Map<workTitle, [{id, title}]>.
// Books stored before the title was recorded are read on the way through, so the
// index is complete the first time it is built and free every time after that.
// `onBackfill(done, total)` reports only that reading, because it is the one
// part of this a person waits for.
export async function buildWorkTitleIndex(readWorkTitleFromBlob, onBackfill) {
  const books = (await listBooks()).filter((b) => (b.type || 'pdf') === 'pdf');
  const total = books.filter((b) => !('workTitle' in b)).length;
  let done = 0;
  const index = new Map();
  for (const book of books) {
    let workTitle;
    if ('workTitle' in book) {
      workTitle = book.workTitle;
    } else {
      workTitle = await ensureWorkTitle(book.id, readWorkTitleFromBlob);
      onBackfill?.(++done, total);
    }
    if (!workTitle) continue;
    const entry = { id: book.id, title: book.title };
    const found = index.get(workTitle);
    if (found) found.push(entry);
    else index.set(workTitle, [entry]);
  }
  return index;
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
// False if the book was deleted meanwhile, and the file written for it is taken
// back again — like updateBookThumb(), and for the same reason.
export async function replaceBookFile(id, { fileBlob, pageCount, contentHash, workTitle }) {
  await set(bookKey(id), fileBlob);
  const updated = await updateMeta(id, (meta) => ({
    ...meta,
    pageCount,
    contentHash,
    workTitle: workTitle ?? null,
    lastPage: Math.min(Math.max(meta.lastPage || 1, 1), pageCount),
    // Where the hash path bumps a re-imported book to the front of the shelf,
    // this one does too: dropping a file that is already there is one act with
    // one answer, whether or not its bytes changed in the meantime.
    addedAt: Date.now(),
  }));
  if (!updated) await del(bookKey(id));
  return updated;
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
