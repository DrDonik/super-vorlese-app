import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { LibraryView } from './library.js';
import { ReaderView } from './reader.js';
import { CameraView } from './camera.js';
import { findBookByContentHash, ensureContentHash, deleteBook } from './storage.js';
import { importBundle } from './bundle.js';
import { getFirebase } from './sync.js';
import { receiveBook } from './transfer.js';
import { showAlert, showProgress } from './dialog.js';

// An installed PWA on iOS is frozen (not reloaded) when reopened, so it never
// checks for a new version on its own — only a force-quit picks one up. Check
// explicitly whenever the app returns to the foreground; with registerType
// 'autoUpdate' a found update activates and reloads on its own. See ADR 11.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  },
});

const app = document.getElementById('app');
let currentView = null;

function mount(view) {
  if (currentView?.destroy) currentView.destroy();
  currentView = view;
  return view.render();
}

function showLibrary() {
  mount(new LibraryView(app, {
    onOpenBook: (id) => showReader(id),
    onAddPhotos: () => showCamera(),
    onJoinRoom: (room) => openRoom(room),
  }));
}

function showReader(bookId, joinCode = null) {
  mount(new ReaderView(app, {
    bookId,
    joinCode,
    onClose: () => showLibrary(),
    onJoinRoom: (room) => openRoom(room),
  }));
}

// Given a room already looked up by its code, make sure its book is in the
// library — reusing a local copy if we have one, otherwise fetching it from the
// partner over WebRTC — and then open the reader synced to that room. Shared by
// the library "Gemeinsam lesen" tile and the reader's "Beitreten" field, so a
// code always lands in the book it belongs to no matter where it was entered.
async function openRoom(room) {
  if (!room.book || !room.book.hash) {
    await showAlert({
      title: 'Gemeinsam lesen',
      message: 'Dieser Code unterstützt das Senden von Büchern noch nicht. Bitte lass deinen Lesepartner den Raum neu erstellen.',
    });
    return;
  }

  // Already have this exact book? Open the local copy and sync — no download.
  const local = await findBookByContentHash(room.book.hash, {
    type: room.book.type,
    pageCount: room.book.pageCount,
  });
  if (local) {
    showReader(local.id, room.code);
    return;
  }

  // Otherwise fetch it from the partner over WebRTC.
  const progress = showProgress({
    title: 'Buch wird geladen',
    message: `„${room.book.title || 'Buch'}" wird von deinem Lesepartner gesendet…`,
  });
  let newBookId = null;
  try {
    const fb = await getFirebase();
    const bundleBlob = await receiveBook(fb, room.code, {
      onProgress: (fraction) => progress.update(fraction),
    });
    progress.update(1, 'Buch wird gespeichert…');
    const { id } = await importBundle(bundleBlob);
    newBookId = id;
    const gotHash = await ensureContentHash(id);
    if (gotHash !== room.book.hash) {
      throw new Error('integrity');
    }
    progress.close();
    showReader(id, room.code);
  } catch (err) {
    progress.close();
    if (newBookId) await deleteBook(newBookId).catch(() => {});
    console.error('Buch-Übertragung fehlgeschlagen', err.message || err);
    const corrupt = err.message === 'integrity';
    await showAlert({
      title: corrupt ? 'Übertragung fehlerhaft' : 'Verbindung nicht möglich',
      message: corrupt
        ? 'Das empfangene Buch war unvollständig oder beschädigt. Bitte versuche es erneut.'
        : 'Dein Lesepartner muss online und im Buch sein, um es zu senden. Bitte versuche es erneut.',
    });
  }
}

function showCamera() {
  mount(new CameraView(app, {
    onClose: () => showLibrary(),
    onSaved: () => showLibrary(),
  }));
}

showLibrary();
