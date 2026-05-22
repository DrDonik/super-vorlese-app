import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export async function loadPdf(source) {
  let data;
  if (source instanceof Blob) {
    data = await source.arrayBuffer();
  } else {
    data = source;
  }
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}

export async function renderPageToCanvas(pdf, pageNumber, canvas, maxWidth, maxHeight) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    maxWidth / viewport.width,
    maxHeight / viewport.height,
  );
  const dpr = window.devicePixelRatio || 1;
  const scaledViewport = page.getViewport({ scale: scale * dpr });

  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  canvas.style.width = `${scaledViewport.width / dpr}px`;
  canvas.style.height = `${scaledViewport.height / dpr}px`;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
  return { width: scaledViewport.width / dpr, height: scaledViewport.height / dpr };
}

export async function renderThumbnail(pdf, pageNumber = 1, maxDimension = 320) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    maxDimension / viewport.width,
    maxDimension / viewport.height,
  );
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
  });
}
