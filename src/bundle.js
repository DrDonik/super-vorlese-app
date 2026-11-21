import { zip, unzip } from 'fflate';
import {
  getMeta, getPhotoPages, getBookFile, getThumb,
  savePhotoBook, saveBook, uid, hashBook, findAndBumpExistingBook,
  mergeProvenance,
} from './storage.js';
import { loadPdf, closePdf, readTitlePage, readWorkTitle } from './pdf.js';
import { t } from './i18n.js';

const APP_TAG = 'super-vorlese';
const BUNDLE_VERSION = 1;
const PAGE_FILENAME_DIGITS = 4;

function pagePath(n) {
  return `pages/${String(n).padStart(PAGE_FILENAME_DIGITS, '0')}.jpg`;
}

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function zipAsync(entries) {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function unzipAsync(data) {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

function safeFilename(title) {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || t('title.exportFilename');
}

export async function exportBook(id) {
  const meta = await getMeta(id);
  if (!meta) throw new Error(t('error.bookNotFound'));
  const type = meta.type || 'pdf';
  const manifest = {
    app: APP_TAG,
    version: BUNDLE_VERSION,
    type,
    title: meta.title,
    pageCount: meta.pageCount,
  };
  // The provenance travels with the bundle so the receiver can recognise the
  // older edition on its own shelf and fold the new one in (ADR 41). Only when
  // the sender has something to say, so a book never replaced carries the same
  // manifest it always did.
  if (Array.isArray(meta.previousContentHashes) && meta.previousContentHashes.length > 0) {
    manifest.previousContentHashes = meta.previousContentHashes;
  }
  const entries = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
  const thumb = await getThumb(id);
  if (thumb) entries['thumb.jpg'] = await blobToBytes(thumb);

  if (type === 'photos') {
    const pages = await getPhotoPages(id, meta.pageCount);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) throw new Error(t('error.pageMissing', { n: i + 1 }));
      entries[pagePath(i + 1)] = await blobToBytes(page);
    }
  } else {
    const pdfBlob = await getBookFile(id);
    if (!pdfBlob) throw new Error(t('error.pdfMissing'));
    entries['book.pdf'] = await blobToBytes(pdfBlob);
  }

  const data = await zipAsync(entries);
  return {
    blob: new Blob([data], { type: 'application/zip' }),
    filename: `${safeFilename(meta.title)}.vorlese`,
  };
}

const MAX_PAGE_COUNT = 1000;

// `dedupe` makes a re-import of a book the user already has resurface the
// existing copy (moved to the front) instead of creating a duplicate. It is
// opt-in because the WebRTC receive path relies on always getting a fresh book
// id that it can verify and delete on an integrity failure.
export async function importBundle(file, { dedupe = false } = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  let entries;
  try {
    entries = await unzipAsync(data);
  } catch {
    throw new Error(t('error.unreadable'));
  }
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) throw new Error(t('error.manifestMissing'));
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
  } catch {
    throw new Error(t('error.manifestCorrupt'));
  }
  if (manifest.app !== APP_TAG) throw new Error(t('error.foreignFile'));

  const version = Number(manifest.version);
  if (!Number.isInteger(version) || version < 1 || version > BUNDLE_VERSION) {
    throw new Error(t('error.unknownFormat'));
  }
  const title = String(manifest.title ?? '').trim() || t('title.imported');
  const pageCount = Number(manifest.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
    throw new Error(t('error.badPageCount'));
  }

  // The sender's chain of earlier editions (ADR 41). Only string entries are
  // kept, so a manifest with the wrong shape never reaches storage. The field
  // is optional in every direction: an older bundle has none and works, a
  // newer bundle with none works too.
  const previousContentHashes = Array.isArray(manifest.previousContentHashes)
    ? manifest.previousContentHashes.filter((h) => typeof h === 'string' && h.length > 0)
    : [];

  const id = uid();
  const thumbBytes = entries['thumb.jpg'];
  const thumbBlob = thumbBytes ? new Blob([thumbBytes], { type: 'image/jpeg' }) : null;

  // Read on the PDF path below and handed back to the caller, which is how a
  // received book can be recognised as a newer edition of one already on this
  // shelf (ADR 40). A photographed book has no work title — it is nobody's
  // re-export — and none is invented for it.
  let workTitle = null;

  if (manifest.type === 'photos') {
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      const pageBytes = entries[pagePath(i)];
      if (!pageBytes) throw new Error(t('error.pageMissingInBundle', { n: i }));
      pages.push(new Blob([pageBytes], { type: 'image/jpeg' }));
    }
    const contentHash = await hashBook({ type: 'photos', pages });
    if (dedupe) {
      const existing = await findAndBumpExistingBook(contentHash, { type: 'photos', pageCount });
      if (existing) {
        // The bundle is being discarded as a duplicate, but its ancestors
        // belong on the local book so a later re-send from here still carries
        // them (ADR 41). A photographed book normally has no provenance, but
        // the shape is kept uniform with the PDF path.
        if (previousContentHashes.length > 0) {
          await mergeProvenance(existing.id, previousContentHashes);
        }
        return { id: existing.id, title: existing.title, previousContentHashes };
      }
    }
    await savePhotoBook({ id, title, pages, thumbBlob, contentHash });
  } else if (manifest.type === 'pdf') {
    const pdfBytes = entries['book.pdf'];
    if (!pdfBytes) throw new Error(t('error.pdfMissingInBundle'));
    const fileBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    let pdf;
    try {
      pdf = await loadPdf(fileBlob);
    } catch {
      throw new Error(t('error.pdfCorruptInBundle'));
    }
    let actualPageCount;
    let cover = null;
    let ageTag = null;
    try {
      actualPageCount = pdf.numPages;
      // However a book reaches the shelf, it arrives with the same cover and
      // the same tags read off its title page (ADR 29) — this is the path a
      // book takes when it comes over a sync session or as a .vorlese file, so
      // it reads the title page just like the drag-and-drop import does.
      ({ cover, ageTag } = await readTitlePage(pdf));
      workTitle = await readWorkTitle(pdf);
    } finally {
      await closePdf(pdf);
    }
    const contentHash = await hashBook({ type: 'pdf', fileBlob });
    if (dedupe) {
      // A book already on this shelf is left exactly as it stands — its cover
      // does not change under the owner's hands and no tag appears on it. The
      // one place that does refresh an existing book is the library's own PDF
      // import, where re-adding the file is the deliberate act (ADR 29).
      const existing = await findAndBumpExistingBook(contentHash, { type: 'pdf', pageCount: actualPageCount });
      if (existing) {
        // Keep the incoming ancestry on the local book, see the photos path
        // above (ADR 41).
        if (previousContentHashes.length > 0) {
          await mergeProvenance(existing.id, previousContentHashes);
        }
        return { id: existing.id, title: existing.title, workTitle, previousContentHashes };
      }
    }
    await saveBook({
      id,
      title,
      fileBlob,
      // The bundle's own thumb.jpg is the sender's full-page render of page 1 —
      // the very thing the cover replaces, and a perfectly good fallback when
      // there is no cover to be found.
      thumbBlob: cover ?? thumbBlob,
      pageCount: actualPageCount,
      contentHash,
      workTitle,
      tags: ageTag ? [ageTag] : undefined,
      // The provenance travels onto the new card so a later send from this
      // device still carries the whole chain (ADR 41).
      previousContentHashes,
    });
  } else {
    throw new Error(t('error.unknownBookType', { type: manifest.type }));
  }
  return { id, title, workTitle, previousContentHashes };
}

// Deliberately without a caller since the export button left the book cards
// (issue #143, ADR 17). exportBook() above is very much alive — it is what a
// sync session ships to a joining device — but nothing in the UI hands a bundle
// to the user any more. Kept because it is the piece a local backup of
// photographed books would need, and because writing it again would cost more
// than the twenty lines it takes to leave standing.
export async function shareOrDownload({ blob, filename }) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
