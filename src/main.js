import './style.css';
import { LibraryView } from './library.js';
import { ReaderView } from './reader.js';
import { CameraView } from './camera.js';

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
  }));
}

function showReader(bookId) {
  mount(new ReaderView(app, { bookId, onClose: () => showLibrary() }));
}

function showCamera() {
  mount(new CameraView(app, {
    onClose: () => showLibrary(),
    onSaved: () => showLibrary(),
  }));
}

showLibrary();
