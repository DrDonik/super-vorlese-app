import { deviceScaleFor } from './canvas-scale.js';

export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Photographed pages are pixels, not vectors, so a photo is never drawn larger
// than it was taken — except when the reader is zoomed (issue #117), where the
// point is a bigger picture even at the cost of sharpness. `maxUpscale` is that
// permission: it carries the zoom factor, so the page grows by exactly the
// factor the loupe promises whether the photo has detail left to give or not.
export async function renderImageToCanvas(blob, canvas, maxWidth, maxHeight, maxUpscale = 1) {
  const img = await loadImageFromBlob(blob);
  const scale = Math.min(
    maxWidth / img.naturalWidth,
    maxHeight / img.naturalHeight,
    maxUpscale,
  );
  const cssWidth = img.naturalWidth * scale;
  const cssHeight = img.naturalHeight * scale;
  const dpr = deviceScaleFor(cssWidth, cssHeight);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { width: cssWidth, height: cssHeight };
}

export async function renderImageThumbnail(blob, maxDimension = 480, quality = 0.8) {
  const img = await loadImageFromBlob(blob);
  const scale = Math.min(
    maxDimension / img.naturalWidth,
    maxDimension / img.naturalHeight,
    1,
  );
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}
