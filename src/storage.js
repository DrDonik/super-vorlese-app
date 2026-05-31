import { get, set, del, keys, getMany, setMany, delMany } from 'idb-keyval';

const BOOK_PREFIX = 'book:';
const META_PREFIX = 'meta:';
const THUMB_PREFIX = 'thumb:';
const PAGE_PREFIX = 'page:';

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
async function hashBook({ type, fileBlob, pages }) {
  if (type === 'photos') {
    // Hash pages one at a time (digest of the concatenated per-page digests)
    // rather than merging every page into one buffer: a 100-page photo book
    // would otherwise hold ~all pages in memory at once and risk an OOM crash
    // on the iPads/phones this app targets.
    const pageHashes = [];
    for (const page of pages) {
      pageHashes.push(await sha256Hex(new Uint8Array(await page.arrayBuffer())));
    }
    return sha256Hex(new TextEncoder().encode(pageHashes.join('')));
  }
  return sha256Hex(new Uint8Array(await fileBlob.arrayBuffer()));
}

export async function saveBook({ id, title, fileBlob, thumbBlob, pageCount }) {
  await set(bookKey(id), fileBlob);
  if (thumbBlob) {
    await set(thumbKey(id), thumbBlob);
  }
  await set(metaKey(id), {
    id,
    type: 'pdf',
    title,
    pageCount,
    addedAt: Date.now(),
    lastPage: 1,
    contentHash: await hashBook({ type: 'pdf', fileBlob }),
  });
}

export async function savePhotoBook({ id, title, pages, thumbBlob }) {
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
    contentHash: await hashBook({ type: 'photos', pages }),
  });
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
  meta.contentHash = contentHash;
  await set(metaKey(id), meta);
  return contentHash;
}

// Finds a locally stored book whose content matches the given hash, or null.
// Backfills missing hashes as it scans so the match works for older books too.
export async function findBookByContentHash(hash) {
  if (!hash) return null;
  const books = await listBooks();
  for (const book of books) {
    if (book.contentHash === hash) return book;
  }
  for (const book of books) {
    if (book.contentHash) continue;
    if ((await ensureContentHash(book.id)) === hash) return getMeta(book.id);
  }
  return null;
}

export async function updateLastPage(id, page) {
  const meta = await get(metaKey(id));
  if (meta) {
    meta.lastPage = page;
    await set(metaKey(id), meta);
  }
}

export async function renameBook(id, title) {
  const meta = await get(metaKey(id));
  if (meta) {
    meta.title = title;
    await set(metaKey(id), meta);
  }
}

export async function deleteBook(id) {
  const meta = await get(metaKey(id));
  const keysToDelete = [bookKey(id), thumbKey(id), metaKey(id)];
  if (meta?.type === 'photos') {
    for (let i = 1; i <= meta.pageCount; i++) {
      keysToDelete.push(pageKey(id, i));
    }
  }
  await delMany(keysToDelete);
}
