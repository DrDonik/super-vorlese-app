import { savePhotoBook, uid } from './storage.js';
import { renderImageThumbnail } from './image.js';
import { showAlert, showConfirm, showPrompt } from './dialog.js';

function defaultTitle() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Foto-Buch ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class CameraView {
  constructor(root, { onClose, onSaved }) {
    this.root = root;
    this.onClose = onClose;
    this.onSaved = onSaved;
    this.stream = null;
    this.pages = [];
    this.thumbUrls = [];
    this.capturing = false;
    this.saving = false;
  }

  async render() {
    this.root.innerHTML = `
      <div class="camera">
        <div class="camera-stage">
          <video class="camera-video" autoplay playsinline muted></video>
          <div class="camera-message" hidden></div>
          <button class="camera-cancel" type="button" aria-label="Abbrechen">✕</button>
          <div class="camera-counter" aria-live="polite">0 Seiten</div>
        </div>
        <div class="camera-strip" aria-label="Aufgenommene Seiten"></div>
        <div class="camera-controls">
          <label class="camera-fallback" hidden>
            <input type="file" accept="image/*" multiple hidden />
            <span>Aus Galerie wählen</span>
          </label>
          <button class="camera-shutter" type="button" aria-label="Foto aufnehmen" disabled>
            <span class="camera-shutter-inner"></span>
          </button>
          <button class="camera-done" type="button" disabled>Fertig</button>
        </div>
      </div>
    `;

    const cam = this.root.querySelector('.camera');
    this.video = cam.querySelector('.camera-video');
    this.message = cam.querySelector('.camera-message');
    this.strip = cam.querySelector('.camera-strip');
    this.shutter = cam.querySelector('.camera-shutter');
    this.doneBtn = cam.querySelector('.camera-done');
    this.counter = cam.querySelector('.camera-counter');
    this.fallback = cam.querySelector('.camera-fallback');
    this.fallbackInput = this.fallback.querySelector('input[type=file]');

    cam.querySelector('.camera-cancel').addEventListener('click', () => this.cancel());
    this.shutter.addEventListener('click', () => this.capture());
    this.doneBtn.addEventListener('click', () => this.finish());
    this.fallbackInput.addEventListener('change', (e) => this.importFromGallery(e.target.files));

    await this.startCamera();
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showError('Kamera wird auf diesem Gerät nicht unterstützt.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
    } catch (err) {
      console.error('Kamera-Zugriff fehlgeschlagen', err);
      this.showError('Kein Zugriff auf die Kamera. Du kannst stattdessen Fotos aus der Galerie wählen.');
      return;
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch (err) {
      console.warn('video.play() fehlgeschlagen', err);
    }
    if (this.video.readyState < 2) {
      await new Promise((resolve) => {
        this.video.addEventListener('loadedmetadata', resolve, { once: true });
      });
    }
    this.shutter.disabled = false;
  }

  showError(msg) {
    this.message.textContent = msg;
    this.message.hidden = false;
    this.fallback.hidden = false;
    this.shutter.disabled = true;
  }

  async capture() {
    if (this.capturing || this.shutter.disabled) return;
    if (!this.video.videoWidth || !this.video.videoHeight) return;
    this.capturing = true;
    this.shutter.classList.add('flash');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.video.videoWidth;
      canvas.height = this.video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
      });
      if (blob) this.addPage(blob);
    } catch (err) {
      console.error('Aufnahme fehlgeschlagen', err);
    } finally {
      setTimeout(() => this.shutter.classList.remove('flash'), 120);
      this.capturing = false;
    }
  }

  async importFromGallery(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    for (const f of files) {
      this.addPage(f);
    }
    this.fallbackInput.value = '';
  }

  addPage(blob) {
    const index = this.pages.length;
    this.pages.push(blob);
    const url = URL.createObjectURL(blob);
    this.thumbUrls.push(url);
    const item = document.createElement('div');
    item.className = 'camera-thumb';
    item.innerHTML = `
      <img alt="" />
      <button class="camera-thumb-del" type="button" aria-label="Foto verwerfen">✕</button>
    `;
    item.querySelector('img').src = url;
    item.querySelector('.camera-thumb-del').addEventListener('click', () => {
      this.removePage(index, item, url);
    });
    item.dataset.index = String(index);
    this.strip.appendChild(item);
    this.strip.scrollLeft = this.strip.scrollWidth;
    this.updateCount();
  }

  removePage(index, item, url) {
    this.pages[index] = null;
    URL.revokeObjectURL(url);
    item.remove();
    this.updateCount();
  }

  livePages() {
    return this.pages.filter((p) => p);
  }

  updateCount() {
    const n = this.livePages().length;
    this.counter.textContent = `${n} ${n === 1 ? 'Seite' : 'Seiten'}`;
    this.doneBtn.disabled = n === 0 || this.saving;
  }

  async finish() {
    if (this.saving) return;
    const pages = this.livePages();
    if (pages.length === 0) return;
    const titleInput = await showPrompt({
      title: 'Buch speichern',
      message: 'Titel des Buches:',
      value: defaultTitle(),
      confirmLabel: 'Speichern',
      allowEmpty: true,
    });
    if (titleInput === null) return;
    const title = titleInput.trim() || defaultTitle();
    this.saving = true;
    this.doneBtn.disabled = true;
    this.doneBtn.textContent = 'Speichere…';
    try {
      const thumbBlob = await renderImageThumbnail(pages[0], 480, 0.8);
      await savePhotoBook({
        id: uid(),
        title,
        pages,
        thumbBlob,
      });
      this.stopCamera();
      this.onSaved();
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
      await showAlert({ message: 'Das Buch konnte nicht gespeichert werden.' });
      this.saving = false;
      this.doneBtn.textContent = 'Fertig';
      this.updateCount();
    }
  }

  async cancel() {
    if (this.livePages().length > 0) {
      const discard = await showConfirm({
        title: 'Aufnahme verwerfen?',
        message: 'Die Fotos gehen verloren.',
        confirmLabel: 'Verwerfen',
        destructive: true,
      });
      if (!discard) return;
    }
    this.stopCamera();
    this.onClose();
  }

  stopCamera() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  destroy() {
    this.stopCamera();
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.thumbUrls = [];
    this.pages = [];
  }
}
