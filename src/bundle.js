import { zip, unzip } from 'fflate';
import {
  getMeta, getPhotoPage, getBookFile, getThumb,
  savePhotoBook, saveBook, uid,
} from './storage.js';

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
  return cleaned || 'buch';
}

export async function exportBook(id) {
  const meta = await getMeta(id);
  if (!meta) throw new Error('Buch nicht gefunden.');
  const type = meta.type || 'pdf';
  const manifest = {
    app: APP_TAG,
    version: BUNDLE_VERSION,
    type,
    title: meta.title,
    pageCount: meta.pageCount,
  };
  const entries = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
  const thumb = await getThumb(id);
  if (thumb) entries['thumb.jpg'] = await blobToBytes(thumb);

  if (type === 'photos') {
    for (let i = 1; i <= meta.pageCount; i++) {
      const page = await getPhotoPage(id, i);
      if (!page) throw new Error(`Seite ${i} fehlt.`);
      entries[pagePath(i)] = await blobToBytes(page);
    }
  } else {
    const pdfBlob = await getBookFile(id);
    if (!pdfBlob) throw new Error('PDF-Datei fehlt.');
    entries['book.pdf'] = await blobToBytes(pdfBlob);
  }

  const data = await zipAsync(entries);
  return {
    blob: new Blob([data], { type: 'application/zip' }),
    filename: `${safeFilename(meta.title)}.vorlese`,
  };
}

export async function importBundle(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  let entries;
  try {
    entries = await unzipAsync(data);
  } catch {
    throw new Error('Datei kann nicht gelesen werden.');
  }
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) throw new Error('Ungültige Datei: Manifest fehlt.');
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
  } catch {
    throw new Error('Ungültige Datei: Manifest beschädigt.');
  }
  if (manifest.app !== APP_TAG) throw new Error('Diese Datei stammt nicht aus der Vorlese-App.');

  const id = uid();
  const thumbBytes = entries['thumb.jpg'];
  const thumbBlob = thumbBytes ? new Blob([thumbBytes], { type: 'image/jpeg' }) : null;

  if (manifest.type === 'photos') {
    const pages = [];
    for (let i = 1; i <= manifest.pageCount; i++) {
      const pageBytes = entries[pagePath(i)];
      if (!pageBytes) throw new Error(`Seite ${i} fehlt im Bundle.`);
      pages.push(new Blob([pageBytes], { type: 'image/jpeg' }));
    }
    await savePhotoBook({ id, title: manifest.title, pages, thumbBlob });
  } else {
    const pdfBytes = entries['book.pdf'];
    if (!pdfBytes) throw new Error('PDF fehlt im Bundle.');
    await saveBook({
      id,
      title: manifest.title,
      fileBlob: new Blob([pdfBytes], { type: 'application/pdf' }),
      thumbBlob,
      pageCount: manifest.pageCount,
    });
  }
  return { id, title: manifest.title };
}

export async function shareOrDownload({ blob, filename }) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: filename });
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
