import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { LibraryView } from './library.js';
import { ReaderView } from './reader.js';
import { CameraView } from './camera.js';
import {
  findBookByContentHash, findBookByAnyContentHash, ensureContentHash,
  deleteBook, getBookFile, getMeta, buildWorkTitleIndex, replaceBookFile,
} from './storage.js';
import { readWorkTitleFromBlob } from './pdf.js';
import { importBundle } from './bundle.js';
import { getFirebase, pruneDeadRooms, closeSyncForBook } from './sync.js';
import { receiveBook } from './transfer.js';
import { showAlert, showProgress } from './dialog.js';
import { restoreDebugViewport } from './debug-viewport.js';
import { t } from './i18n.js';
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
    // put its Lese-Code on screen, so the code can be read out
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

// A received book that is a newer edition of a book already on this shelf (the
// same work title, ADR 40): its file moves onto that book and the fresh import
// is deleted again. The side that only ever receives books therefore keeps its
// keepsake, its tags and its Lese-Code instead of holding the same story twice,
// once with every evening in it and once with none.
//
// Called only after the integrity check, and deliberately not from inside
// importBundle(): the receive path needs a fresh id it can delete when the data
// turns out to be damaged, and that must never be a book somebody's evenings
// are attached to.
//
// The existing book's cover and tags stay exactly as they are. ADR 29 lets a
// received book refresh nothing that is visible on the receiver's shelf, and
// nothing visible changes here — only what sits behind the card.
//
// Returns the id of the book the edition was folded into, or null when it stays
// a book of its own: no identity to go by, no single match, or a write that
// did not land. The download is kept in every one of those cases.
//
// Two paths are tried in order (ADR 41 then ADR 40):
//
//   1. The sender's `previousContentHashes`. A hard-identity match — exactly
//      one book on this shelf currently holds a hash the sender knows as an
//      ancestor of what it just sent — so the fold-in is unambiguous. This is
//      what carries the "the file was replaced on the sender's side" case
//      across to shelves whose old copies have no `info.Title` and therefore
//      no `workTitle` to be found by.
//
//   2. The arriving `workTitle`. The ADR 40 path, unchanged.
async function adoptEdition({ id, workTitle, contentHash, previousContentHashes, progress }) {
  const [fileBlob, meta] = await Promise.all([getBookFile(id), getMeta(id)]);
  if (!fileBlob || !meta) return null;
  // Replaces a target book's file with the freshly imported one, then clears
  // the keepsake of what just left and deletes the temporary import that
  // carried the new file in. `extraOptions` are passed straight through to
  // `replaceBookFile`, so each path brings its own race-safety conditions:
  // `incomingPreviousContentHashes` for the hash chain, `soleWorkTitle` /
  // `ignoreIds` / `requireKnownShelf` for the work-title path.
  const foldInto = async (targetId, extraOptions) => {
    if (!(await replaceBookFile(targetId, {
      // The card must not move: on the shelf of someone who only receives
      // books, nothing may rearrange itself under their hands (ADR 29), and
      // „Zuletzt hinzugefügt" orders by exactly this field.
      fileBlob, pageCount: meta.pageCount, contentHash, workTitle, keepAddedAt: true,
      ...extraOptions,
    }))) return false;
    // The code this book carried pointed at a room describing the edition that
    // has just been replaced, so it is given up with it — the same move the
    // library's own import makes. The code of the room being joined right now
    // takes its place a moment later, when the reader opens.
    closeSyncForBook(targetId);
    // From here the fold-in has happened, and the book to open is the old one
    // whatever else goes wrong. Clearing away the temporary import is tidying
    // up, not part of the decision: if it fails, the shelf holds one book too
    // many — visible, deletable — and that is far better than sending the
    // reader to a copy with none of their evenings in it.
    try {
      await deleteBook(id);
    } catch (err) {
      console.error('Übernommener Zwischenimport konnte nicht gelöscht werden', err);
    }
    return true;
  };

  try {
    progress.update(1, t('transfer.adopting'));
    if (Array.isArray(previousContentHashes) && previousContentHashes.length > 0) {
      const target = await findBookByAnyContentHash(previousContentHashes, { ignoreIds: [id] });
      // The sender's chain is merged in so the next step still recognises
      // either side's ancestry (ADR 41).
      if (target && await foldInto(target.id, { incomingPreviousContentHashes: previousContentHashes })) {
        return target.id;
      }
    }
    if (!workTitle) return null;
    const { index: byWorkTitle, unreadable } = await buildWorkTitleIndex(readWorkTitleFromBlob);
    // An index that could not read every book is incomplete, and an incomplete
    // index can name one candidate where two exist. The library's own import
    // carries on in that case and says so in its closing line — holding back
    // there would turn one broken file into thirty duplicates (ADR 40). Here
    // the arithmetic is the other way round: this path has no closing line to
    // say it in, and holding back costs exactly one book standing twice on a
    // shelf, which is visible and can be deleted. So it holds back.
    if (unreadable > 0) {
      console.warn('Fassung nicht übernommen: das Regal ist nicht vollständig lesbar');
      return null;
    }
    // Without the fresh import itself, which was just put on the shelf under
    // this very work title.
    const candidates = (byWorkTitle.get(workTitle) || []).filter((c) => c.id !== id);
    if (candidates.length !== 1) return null;
    const target = candidates[0].id;
    // The same condition the library's import writes under, checked inside the
    // write's own transaction — without the fresh import, which carries this
    // work title by definition and is deleted a moment later.
    //
    // `requireKnownShelf` goes with the `unreadable` check above and says the
    // same thing one layer down: this path folds nothing in while any book
    // here is of unknown title, a book that arrived since the index was built
    // included. It cannot be counted without reading its PDF, so it might be
    // the second book carrying this title.
    if (!(await foldInto(target, {
      soleWorkTitle: workTitle, ignoreIds: [id], requireKnownShelf: true,
    }))) return null;
    return target;
  } catch (err) {
    // Nothing has been written to the existing book at this point: the index
    // could not be built, or the book vanished. The transfer is downloaded and
    // verified either way, so it stays on the shelf as a book of its own rather
    // than being thrown away.
    console.error('Fassung konnte nicht übernommen werden', err);
    return null;
  }
}

// Given a room already looked up by its Lese-Code, make sure its
// book is in the library — reusing a local copy if we have one, otherwise
// fetching it from the partner over WebRTC — and then open the reader synced to
// that room. Shared by the library's "Gemeinsam lesen" tile and the reader's
// "Verbinden" field, so a Lese-Code always lands in the book it
// belongs to no matter where it was entered.
async function openRoom(room) {
  if (!room.book || !room.book.hash) {
    await showAlert({
      title: t('sync.activity'),
      message: t('transfer.unsupported'),
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
    title: t('transfer.title'),
    message: t('transfer.message', { title: room.book.title || t('transfer.untitled') }),
  });
  let newBookId = null;
  try {
    const fb = await getFirebase();
    const bundleBlob = await receiveBook(fb, room.code, {
      onProgress: (fraction) => progress.update(fraction),
    });
    progress.update(1, t('transfer.saving'));
    const { id, workTitle, previousContentHashes } = await importBundle(bundleBlob);
    newBookId = id;
    const gotHash = await ensureContentHash(id);
    if (gotHash !== room.book.hash) {
      throw new Error('integrity');
    }
    const adopted = await adoptEdition({
      id, workTitle, previousContentHashes, contentHash: gotHash, progress,
    });
    // The temporary import is gone once it has been folded in, so there is
    // nothing left for the catch below to delete — and the book it was folded
    // into is the one thing it must never delete.
    if (adopted) newBookId = null;
    progress.close();
    showReader(adopted ?? id, { joinCode: room.code });
  } catch (err) {
    progress.close();
    if (newBookId) await deleteBook(newBookId).catch(() => {});
    console.error('Buch-Übertragung fehlgeschlagen', err?.message || err);
    const corrupt = err?.message === 'integrity';
    await showAlert({
      title: t(corrupt ? 'transfer.corrupt.title' : 'transfer.failed.title'),
      message: t(corrupt ? 'transfer.corrupt.message' : 'transfer.failed.message'),
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
// Lese-Codes whose rooms have run out, so „Buch bearbeiten" shows a
// code only while there is still a room behind it (issue #175).
pruneDeadRooms().catch(() => {});
