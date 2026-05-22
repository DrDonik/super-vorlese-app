import { get, set, del, keys } from 'idb-keyval';

const BOOK_PREFIX = 'book:';
const META_PREFIX = 'meta:';
const THUMB_PREFIX = 'thumb:';

function bookKey(id) {
  return `${BOOK_PREFIX}${id}`;
}

function metaKey(id) {
  return `${META_PREFIX}${id}`;
}

function thumbKey(id) {
  return `${THUMB_PREFIX}${id}`;
}

export async function saveBook({ id, title, fileBlob, thumbBlob, pageCount }) {
  await set(bookKey(id), fileBlob);
  if (thumbBlob) {
    await set(thumbKey(id), thumbBlob);
  }
  await set(metaKey(id), {
    id,
    title,
    pageCount,
    addedAt: Date.now(),
    lastPage: 1,
  });
}

export async function listBooks() {
  const allKeys = await keys();
  const metas = [];
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(META_PREFIX)) {
      const meta = await get(k);
      if (meta) metas.push(meta);
    }
  }
  metas.sort((a, b) => b.addedAt - a.addedAt);
  return metas;
}

export async function getBookFile(id) {
  return get(bookKey(id));
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

export async function deleteBook(id) {
  await del(bookKey(id));
  await del(thumbKey(id));
  await del(metaKey(id));
}
