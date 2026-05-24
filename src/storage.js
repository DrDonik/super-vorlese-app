import { get, set, del, keys, getMany } from 'idb-keyval';

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
  });
}

export async function savePhotoBook({ id, title, pages, thumbBlob }) {
  for (let i = 0; i < pages.length; i++) {
    await set(pageKey(id, i + 1), pages[i]);
  }
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

export async function getThumb(id) {
  return get(thumbKey(id));
}

export async function getMeta(id) {
  return get(metaKey(id));
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
  await del(bookKey(id));
  await del(thumbKey(id));
  await del(metaKey(id));
  const pagePrefix = `${PAGE_PREFIX}${id}:`;
  const allKeys = await keys();
  const pageKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith(pagePrefix));
  for (const k of pageKeys) {
    await del(k);
  }
}
