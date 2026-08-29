import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import { deviceScaleFor } from './canvas-scale.js';

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

// Draws a page to fill the given box. The reader passes the stage multiplied by
// its zoom factor (issue #117), so a magnified page is re-rendered from the
// vector source at its new size rather than scaled up as pixels — which is the
// whole point of the loupe for someone who can no longer read the print.
export async function renderPageToCanvas(pdf, pageNumber, canvas, maxWidth, maxHeight) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    maxWidth / viewport.width,
    maxHeight / viewport.height,
  );
  const dpr = deviceScaleFor(viewport.width * scale, viewport.height * scale);
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

// ── Die Titelseite auslesen (ADR 29) ─────────────────────────────────────────
// Books from einfachvorlesen.de print two things on their title page that the
// shelf can use as they stand: the publisher's cover picture and the age the
// book is recommended from. Both survive re-typesetting (ADR 28; the tool now
// lives at github.com/DrDonik/retypeset-book), so one reader serves the
// downloaded PDF and the re-set one alike. Every threshold
// below comes from measuring all 50 PDFs currently held — see ADR 29.
//
// Nothing in here throws: a book whose title page is not the one we expect keeps
// the cover and the tags it would have had before, and the import carries on.
const { OPS, Util } = pdfjsLib;

// A picture painted more than once, or alongside a second one, is not the lone
// cover of a title page — so these ops only ever need to be counted, and the
// three that carry their pixel size are the only ones that can be a cover.
const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

function imagePixelSize(fn, args) {
  // paintImageXObject carries [objId, width, height]; the inline and mask forms
  // carry the decoded image itself, which knows its own size.
  if (fn === OPS.paintImageXObject) return { width: args[1], height: args[2] };
  if (fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
    return { width: args[0]?.width, height: args[0]?.height };
  }
  return null;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

// Walks the page's drawing operations keeping the current transform, and returns
// the single image it paints — or null the moment a second one shows up. Which
// of two pictures is "the cover" would be a guess, and a wrong cover is exactly
// the kind of surprise this must not produce.
function soleImagePlacement({ fnArray, argsArray }) {
  const stack = [];
  let ctm = IDENTITY;
  let found = null;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      // Util.transform returns a new array rather than writing into ctm, so the
      // stack can hold the reference itself instead of a copy.
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      ctm = Util.transform(ctm, args);
    } else if (fn === OPS.paintFormXObjectBegin) {
      // One op doing what save + transform do separately; its End restores.
      stack.push(ctm);
      if (args[0]) ctm = Util.transform(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (IMAGE_OPS.has(fn)) {
      if (found) return null;
      const size = imagePixelSize(fn, args);
      if (!size) return null;
      found = { ctm, ...size };
    }
  }
  return found;
}

// An image is painted into the unit square, so its four corners are [0,1]² sent
// through the transform in force — and from there into viewport coordinates,
// which is where the rendered canvas will be measured.
function imageRectInViewport(ctm, viewport) {
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => {
    const point = [x, y];
    Util.applyTransform(point, ctm);
    return viewport.convertToViewportPoint(point[0], point[1]);
  });
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const MIN_COVER_PIXELS = 120;        // below this it is a logo, not a cover
const MIN_COVER_ASPECT = 0.5;        // width / height of the placed picture …
const MAX_COVER_ASPECT = 1.1;        // … upright to roughly square
const MIN_COVER_HEIGHT_SHARE = 0.15; // of the page height
const MIN_COVER_AREA_SHARE = 0.04;   // of the page area
const MAX_RENDER_SIDE = 4000;        // ceiling for the page canvas we crop from

// Whether page 1 shows a cover, and where — the whole decision, kept apart from
// the drawing below so it can be reasoned about on its own. Returns the picture's
// place on the page and the scale to render it at, or null.
export async function coverPlacement(page) {
  const placement = soleImagePlacement(await page.getOperatorList());
  if (!placement) return null;
  const { width: pixelWidth, height: pixelHeight } = placement;
  if (!(pixelWidth > 0) || !(pixelHeight > 0)) return null;
  if (Math.min(pixelWidth, pixelHeight) < MIN_COVER_PIXELS) return null;

  const viewport = page.getViewport({ scale: 1 });
  const rect = imageRectInViewport(placement.ctm, viewport);
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const aspect = rect.width / rect.height;
  if (aspect < MIN_COVER_ASPECT || aspect > MAX_COVER_ASPECT) return null;
  if (rect.height < viewport.height * MIN_COVER_HEIGHT_SHARE) return null;
  if (rect.width * rect.height < viewport.width * viewport.height * MIN_COVER_AREA_SHARE) return null;

  // Render the page just large enough for the cover to come out at the
  // resolution it is actually stored in. Rendering it bigger would interpolate
  // pixels the source never had and cost storage for nothing — einfachvorlesen
  // ships its covers 300px tall and there is no larger version to be had.
  const scale = Math.min(
    pixelWidth / rect.width,
    MAX_RENDER_SIDE / Math.max(viewport.width, viewport.height),
  );
  return { rect, scale };
}

async function readCoverImage(page) {
  const found = await coverPlacement(page);
  if (!found) return null;
  const { rect, scale } = found;
  const scaledViewport = page.getViewport({ scale });
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.ceil(scaledViewport.width);
  pageCanvas.height = Math.ceil(scaledViewport.height);
  await page.render({
    canvasContext: pageCanvas.getContext('2d'),
    viewport: scaledViewport,
  }).promise;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext('2d');
  // JPEG has no transparency, and whatever is left transparent would come out
  // black. Paper is the right assumption under a book cover.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    pageCanvas,
    Math.round(rect.x * scale), Math.round(rect.y * scale), canvas.width, canvas.height,
    0, 0, canvas.width, canvas.height,
  );
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
  });
}

// „Ab 5 Jahren" — the one line of the title page that describes the book rather
// than this copy of it. A renderer cuts a line into text items wherever it
// likes, so the items are joined both with and without a separator: whichever
// way „Ab 5 Jahren" was split, one of the two joins puts it back together.
const AGE_PATTERN = /\bab\s*(\d{1,2})\s*jahr(?:en)?\b/gi;
const MIN_AGE = 1;
const MAX_AGE = 12;

// pdf.js's own page.getTextContent() is written as `for await (… of stream)`,
// and WebKit has never shipped async iteration over a ReadableStream — so on
// Safari it throws before yielding a single word (measured: „undefined is not a
// function (near '...value of readableStream...')"). Draining the very same
// stream through a reader is the plain equivalent and works in every browser.
async function pageTextItems(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      items.push(...value.items);
    }
  } finally {
    // Nothing left to read on the normal path; this matters when the loop above
    // is left by an exception, so the stream is not held open behind us.
    reader.cancel().catch(() => {});
  }
  return items;
}

export async function readAgeTag(page) {
  const items = await pageTextItems(page);
  const parts = items.map((item) => (typeof item?.str === 'string' ? item.str : ''));
  const ages = new Set();
  for (const text of [parts.join(' '), parts.join('')]) {
    for (const [, digits] of text.matchAll(AGE_PATTERN)) ages.add(Number(digits));
  }
  // Two different ages on one page mean this is not the page we take it for, and
  // choosing between them would be a guess. One reading or none.
  if (ages.size !== 1) return null;
  const [age] = ages;
  if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return null;
  return `Ab ${age} ${age === 1 ? 'Jahr' : 'Jahren'}`;
}

// Both facts from one visit to page 1, and each on its own: a book whose cover
// cannot be made out can still yield its age, and the other way round.
export async function readTitlePage(pdf) {
  let page;
  try {
    page = await pdf.getPage(1);
  } catch {
    return { cover: null, ageTag: null };
  }
  // Each half falls back on its own, but never silently: a title page this
  // cannot read is a thing to find out about, and swallowing the reason would
  // leave "no cover, no tag" looking exactly like "nothing to read here".
  const fallback = (what) => (err) => {
    console.warn(`Titelseite: ${what} konnte nicht gelesen werden`, err);
    return null;
  };
  const [cover, ageTag] = await Promise.all([
    readCoverImage(page).catch(fallback('das Cover')),
    readAgeTag(page).catch(fallback('die Altersangabe')),
  ]);
  return { cover, ageTag };
}
