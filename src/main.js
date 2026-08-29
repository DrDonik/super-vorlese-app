import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { LibraryView } from './library.js';
import { ReaderView } from './reader.js';
import { CameraView } from './camera.js';
import { findBookByContentHash, ensureContentHash, deleteBook } from './storage.js';
import { importBundle } from './bundle.js';
import { getFirebase, pruneDeadRooms } from './sync.js';
import { receiveBook } from './transfer.js';
import { showAlert, showProgress } from './dialog.js';
import { restoreDebugViewport } from './debug-viewport.js';
import { suppressNativeZoomGestures } from './native-zoom.js';

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

// Die zwei Zoom-Kanäle, an die das `touch-action` an der Wurzel nicht kommt
// (ADR 24, fünfte Ergänzung). Einmal fürs ganze Dokument, vor der ersten
// Ansicht, damit keine Bildschirmseite eine Lücke hat.
suppressNativeZoomGestures();

// Eine Datei, die neben ihr Ziel fällt, öffnet der Browser sonst im Tab — und
// dann ist die App weg. Mitten in einer Vorlese-Sitzung nimmt das nicht nur die
// Ansicht mit, sondern die Sitzung. Also ist der Standardfall überall verboten;
// wer einen Drop annimmt, meldet sich mit einem eigenen Listener (die
// Bibliothek tut das, siehe library.js). `dragover` muss mit: ohne
// preventDefault dort kommt gar kein `drop`, und der Browser navigiert wieder.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    // Ohne Empfänger ist die Antwort auf eine gezogene Datei „hier nicht": die
    // Bibliothek hängt ihr eigenes 'copy' danach dran, jede andere Ansicht
    // bleibt beim Verbotszeichen.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  });
}

const app = document.getElementById('app');
let currentView = null;

function mount(view) {
  if (currentView?.destroy) currentView.destroy();
  currentView = view;
  // Replacing the container's innerHTML below drops the focus onto <body>, so
  // the next Tab would start over at the top of the document after every
  // change of view. Parking the focus on the container instead keeps it inside
  // the app: the first Tab lands on the new view's first control (issue #129).
  //
  // The container, not anything inside the view: it exists before render()
  // paints and survives the innerHTML swap, so the focus is already right
  // while a book is still loading — render() is async and the reader builds up
  // in several steps. And it must not be a control: the reader's shortcuts
  // yield to whatever has focus (see handleKey), so focusing a button here
  // would stop Space and the arrow keys from turning the page.
  app.focus({ preventScroll: true });
  // Die Diagnose-Einblendung hängt an <body> und überlebt den innerHTML-Tausch
  // oben nicht von selbst, wenn sie noch gar nicht existiert; siehe
  // debug-viewport.js.
  restoreDebugViewport();
  return view.render();
}

// revealBookId names the book the shelf is returning from, so it can be brought
// back into view together with the scroll position the library remembers for
// itself (issue #174). Opening the app has nothing to return to and passes none.
function showLibrary({ revealBookId = null } = {}) {
  mount(new LibraryView(app, {
    revealBookId,
    onOpenBook: (id) => showReader(id),
    // The library's „Gemeinsam lesen" → „Buch auswählen" path: open the book and
    // put its Synchronisations-Code on screen, so the code can be read out
    // without first having to find the sync control inside the reader.
    onStartShared: (id) => showReader(id, { startShared: true }),
    onAddPhotos: () => showCamera(),
    onJoinRoom: (room) => openRoom(room),
  }));
}

function showReader(bookId, { joinCode = null, startShared = false } = {}) {
  mount(new ReaderView(app, {
    bookId,
    joinCode,
    startShared,
    onClose: () => showLibrary({ revealBookId: bookId }),
    onJoinRoom: (room) => openRoom(room),
  }));
}

// Given a room already looked up by its Synchronisations-Code, make sure its
// book is in the library — reusing a local copy if we have one, otherwise
// fetching it from the partner over WebRTC — and then open the reader synced to
// that room. Shared by the library's "Gemeinsam lesen" tile and the reader's
// "Verbinden" field, so a Synchronisations-Code always lands in the book it
// belongs to no matter where it was entered.
async function openRoom(room) {
  if (!room.book || !room.book.hash) {
    await showAlert({
      title: 'Gemeinsam lesen',
      message: 'Dieser Synchronisations-Code unterstützt das Senden von Büchern noch nicht. Bitte lass deinen Lesepartner den Synchronisations-Code neu erstellen.',
    });
    return;
  }

  // Already have this exact book? Open the local copy and sync — no download.
  const local = await findBookByContentHash(room.book.hash, {
    type: room.book.type,
    pageCount: room.book.pageCount,
  });
  if (local) {
    showReader(local.id, { joinCode: room.code });
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
    showReader(id, { joinCode: room.code });
  } catch (err) {
    progress.close();
    if (newBookId) await deleteBook(newBookId).catch(() => {});
    console.error('Buch-Übertragung fehlgeschlagen', err?.message || err);
    const corrupt = err?.message === 'integrity';
    await showAlert({
      title: corrupt ? 'Übertragung fehlerhaft' : 'Verbindung nicht möglich',
      message: corrupt
        ? 'Das empfangene Buch war unvollständig oder beschädigt. Bitte versuche es erneut.'
        : 'Dein Lesepartner muss die App offen haben und das Buch aufmachen. Bitte versuche es dann erneut.',
    });
  }
}

function showCamera() {
  mount(new CameraView(app, {
    onClose: () => showLibrary(),
    // The book that was just photographed is the one to show: under A–Z it lands
    // somewhere in the middle of the shelf, and the restored scroll position is
    // from before it existed.
    onSaved: (id) => showLibrary({ revealBookId: id }),
  }));
}

showLibrary();

// After the shelf is on screen, never before it: the library reads from
// IndexedDB and owes the network nothing, while this is the app's first (and,
// on most evenings, only) reason to load Firebase at all. It quietly forgets the
// Synchronisations-Codes whose rooms have run out, so „Buch bearbeiten" shows a
// code only while there is still a room behind it (issue #175).
pruneDeadRooms().catch(() => {});
