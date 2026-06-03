import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { LibraryView } from './library.js';
import { ReaderView } from './reader.js';
import { CameraView } from './camera.js';

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
    onJoinBook: (id, code) => showReader(id, code),
  }));
}

function showReader(bookId, joinCode = null) {
  mount(new ReaderView(app, { bookId, joinCode, onClose: () => showLibrary() }));
}

function showCamera() {
  mount(new CameraView(app, {
    onClose: () => showLibrary(),
    onSaved: () => showLibrary(),
  }));
}

showLibrary();
