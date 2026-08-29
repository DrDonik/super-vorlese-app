import { savePhotoBook, uid } from './storage.js';
import { renderImageThumbnail } from './image.js';
import { openDialog, showAlert, showConfirm, showPrompt } from './dialog.js';
import { t } from './i18n.js';

// What the preview's „Verwerfen" resolves to. A symbol so it can never collide
// with anything the dialog might hand back on a normal way out.
const DISCARD = Symbol('discard');

function defaultTitle() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // Ziffern statt eines lokalisierten Datums: der Titel sortiert sich damit
  // von selbst, und ein Buch, das heute Abend entsteht, steht neben dem von
  // gestern. Gespeichert wird er als Titel des Buches und danach nicht mehr
  // übersetzt — ab dann gehört er dem Buch.
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return t('camera.defaultTitle', { date: stamp });
}

export class CameraView {
  constructor(root, { onClose, onSaved }) {
    this.root = root;
    this.onClose = onClose;
    this.onSaved = onSaved;
    this.stream = null;
    this.pages = [];
    this.thumbUrls = [];
    // The one photo a „Rückgängig" can still bring back, or null. See
    // removePage() for why exactly one.
    this.discarded = null;
    this.capturing = false;
    this.saving = false;
  }

  async render() {
    this.root.innerHTML = `
      <div class="camera">
        <div class="camera-stage">
          <video class="camera-video" autoplay playsinline muted></video>
          <div class="camera-message" hidden></div>
          <button class="camera-cancel" type="button" aria-label="${t('common.cancel')}">✕</button>
          <div class="camera-counter" aria-live="polite">${t('common.pages', { n: 0 })}</div>
        </div>
        <div class="camera-strip" aria-label="${t('camera.strip')}"></div>
        <div class="camera-undo" hidden>
          <span>${t('camera.discarded')}</span>
          <button class="camera-undo-btn" type="button">${t('common.undo')}</button>
        </div>
        <div class="camera-controls">
          <label class="camera-fallback" hidden>
            <input type="file" accept="image/*" multiple hidden />
            <span>${t('camera.gallery')}</span>
          </label>
          <button class="camera-shutter" type="button" aria-label="${t('camera.shutter')}" disabled>
            <span class="camera-shutter-inner"></span>
          </button>
          <button class="camera-done" type="button" disabled>${t('common.done')}</button>
        </div>
      </div>
    `;

    const cam = this.root.querySelector('.camera');
    this.video = cam.querySelector('.camera-video');
    this.message = cam.querySelector('.camera-message');
    this.strip = cam.querySelector('.camera-strip');
    this.undoBar = cam.querySelector('.camera-undo');
    this.shutter = cam.querySelector('.camera-shutter');
    this.doneBtn = cam.querySelector('.camera-done');
    this.counter = cam.querySelector('.camera-counter');
    this.fallback = cam.querySelector('.camera-fallback');
    this.fallbackInput = this.fallback.querySelector('input[type=file]');

    cam.querySelector('.camera-cancel').addEventListener('click', () => this.cancel());
    this.shutter.addEventListener('click', () => this.capture());
    this.doneBtn.addEventListener('click', () => this.finish());
    cam.querySelector('.camera-undo-btn').addEventListener('click', () => this.restoreDiscard());
    this.fallbackInput.addEventListener('change', (e) => this.importFromGallery(e.target.files));

    await this.startCamera();
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showError(t('camera.unsupported'));
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
      this.showError(t('camera.noAccess'));
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
    // Taking the next photo answers the question the offer above asks, so it
    // settles the discard before it: whoever has moved on to the next page is
    // not coming back for the one they just threw away.
    this.commitDiscard();
    const index = this.pages.length;
    this.pages.push(blob);
    const url = URL.createObjectURL(blob);
    this.thumbUrls.push(url);
    // The whole tile is the button, and the only thing it does is show the photo
    // properly (ADR 35). „Foto ansehen" rather than „Seite 3 ansehen": the page
    // number moves as pages are discarded, and a label maintained against that
    // is exactly the drift ADR 22 declines. The preview names the page instead,
    // where it is read off the strip as it stands.
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'camera-thumb';
    item.setAttribute('aria-label', t('camera.viewPhoto'));
    // Built rather than parsed from a string: one element does not need an HTML
    // round trip, and it leaves the strip with no HTML sink at all.
    const thumb = document.createElement('img');
    thumb.alt = '';
    thumb.src = url;
    item.appendChild(thumb);
    item.addEventListener('click', () => this.openPage(index, item, url));
    item.dataset.index = String(index);
    this.insertThumb(item, index);
    this.strip.scrollLeft = this.strip.scrollWidth;
    this.updateCount();
  }

  // Which page this is on the strip as it stands, counting only the photos still
  // in it. The capture index cannot answer that: discard page 2 and the third
  // shot taken *is* page 2, which is what the person looking at the strip sees.
  pageNumberOf(index) {
    let n = 0;
    for (let i = 0; i <= index; i++) if (this.pages[i]) n++;
    return n;
  }

  // Big enough to answer the only question a thumbnail raises — is this page
  // sharp, straight and whole? — and the one place discarding is offered, so
  // nobody throws away a photo they have not seen (ADR 35). An ordinary dialog:
  // `dangerButton` already puts a destructive action in a row of its own, a
  // fingerwidth away from the way out, which is exactly the distance this needs.
  async openPage(index, item, url) {
    const image = document.createElement('img');
    image.className = 'camera-preview-image';
    image.src = url;
    image.alt = '';
    const chosen = await openDialog({
      title: t('camera.pageTitle', { n: this.pageNumberOf(index) }),
      content: image,
      cardClass: 'camera-preview-card',
      dangerButton: { label: t('common.discard'), value: DISCARD },
      buttons: [{ label: t('common.close'), value: undefined, primary: true }],
      cancelValue: undefined,
    });
    if (chosen !== DISCARD) return;
    this.removePage(index, item, url);
    // The dialog hands focus back to whatever opened it, and that tile has just
    // left the strip — so the focus would fall to <body> and a keyboard user
    // would start over at the top (issue #129). It goes to the shutter instead:
    // having dealt with this page, the way on is the next one, and „Rückgängig"
    // is one Shift+Tab back, where a way back belongs. On a device whose camera
    // the browser would not open, the shutter is disabled and cannot take it —
    // there the offer that just appeared is the only live control left.
    const next = this.shutter.disabled ? this.undoBar.querySelector('.camera-undo-btn') : this.shutter;
    next.focus({ preventScroll: true });
  }

  // Puts a thumbnail where its page number says it belongs — at the end for a
  // new photo, back between its neighbours for a restored one. `pages` keeps the
  // emptied slot of a discarded photo, so the index a thumbnail was given at
  // capture time still names its place in the book once it returns. For pages
  // that is not cosmetic: the strip is the order they will be bound in.
  insertThumb(item, index) {
    const after = [...this.strip.children].find((el) => Number(el.dataset.index) > index);
    this.strip.insertBefore(item, after ?? null);
  }

  // Only ever reached from the preview, so this is a photo its owner has looked
  // at and judged. What it can still be is the wrong judgement — two shots of one
  // page, and the better one goes — which on a strip you glance at next is
  // noticed in seconds. So the photo is held rather than dropped and the strip
  // offers it back (ADR 35). Exactly one: a second discard is a deliberate second
  // act, and holding more would mean carrying rejected photos through a session
  // that already fills memory with the kept ones. The object URL stays alive with
  // it — it is what the thumbnail is still hanging on.
  removePage(index, item, url) {
    this.commitDiscard();
    this.discarded = { index, item, url, blob: this.pages[index] };
    this.pages[index] = null;
    item.remove();
    this.undoBar.hidden = false;
    this.updateCount();
  }

  // Lets the held photo go for good. Revoked here and not only in destroy(), so
  // a long session that discards its way through many shots never holds on to
  // more than the one that is still on offer.
  commitDiscard() {
    if (!this.discarded) return;
    URL.revokeObjectURL(this.discarded.url);
    this.discarded = null;
    this.undoBar.hidden = true;
  }

  restoreDiscard() {
    const held = this.discarded;
    if (!held) return;
    this.discarded = null;
    this.undoBar.hidden = true;
    this.pages[held.index] = held.blob;
    // The same element, with its picture and its listener intact: it was taken
    // out of the strip, not thrown away.
    this.insertThumb(held.item, held.index);
    held.item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.updateCount();
    // „Rückgängig" has just disappeared from under the finger that pressed it,
    // so the focus would fall to <body> and a keyboard user would start over at
    // the top. It goes onto the restored tile — the photo this round trip was
    // about, back where it belongs and ready to be looked at again.
    held.item.focus({ preventScroll: true });
  }

  livePages() {
    return this.pages.filter((p) => p);
  }

  updateCount() {
    const n = this.livePages().length;
    this.counter.textContent = t('common.pages', { n });
    this.doneBtn.disabled = n === 0 || this.saving;
  }

  async finish() {
    if (this.saving) return;
    const pages = this.livePages();
    if (pages.length === 0) return;
    this.saving = true;
    this.doneBtn.disabled = true;
    const titleInput = await showPrompt({
      title: t('camera.save.title'),
      message: t('camera.save.field'),
      value: defaultTitle(),
      confirmLabel: t('common.save'),
      allowEmpty: true,
    });
    if (titleInput === null) {
      this.saving = false;
      this.updateCount();
      return;
    }
    const title = titleInput.trim() || defaultTitle();
    this.doneBtn.textContent = t('camera.saving');
    try {
      const thumbBlob = await renderImageThumbnail(pages[0], 480, 0.8);
      const id = uid();
      await savePhotoBook({
        id,
        title,
        pages,
        thumbBlob,
      });
      this.stopCamera();
      // The library scrolls the new book into view, so the pages that were just
      // photographed are visible as a book instead of somewhere on the shelf.
      this.onSaved(id);
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
      await showAlert({ message: t('camera.saveFailed') });
      this.saving = false;
      this.doneBtn.textContent = t('common.done');
      this.updateCount();
    }
  }

  async cancel() {
    if (this.cancelling) return;
    this.cancelling = true;
    try {
      if (this.livePages().length > 0) {
        const discard = await showConfirm({
          title: t('camera.discardAll.title'),
          message: t('camera.discardAll.message'),
          confirmLabel: t('common.discard'),
          destructive: true,
        });
        if (!discard) return;
      }
      this.stopCamera();
      this.onClose();
    } finally {
      this.cancelling = false;
    }
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
    // thumbUrls carries the held photo's URL too — it was never taken out — so
    // this covers the discard on offer along with everything still in the strip.
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.thumbUrls = [];
    this.pages = [];
    this.discarded = null;
  }
}
