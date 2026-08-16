// How many device pixels a page canvas may be rendered at.
//
// Until the reader could zoom (issue #117) this was simply devicePixelRatio: a
// page always fitted the stage, so even a 3× phone stayed near 3.6 megapixels.
// A zoomed page is a multiple of the stage, and the product of the two runs
// into a hard platform limit — iOS refuses to allocate a canvas beyond roughly
// 16.7 million pixels or 4096 pixels per side, and hands back a blank one
// instead of an error. So the ratio is capped rather than the zoom: the page
// stays as sharp as the device allows and only gives up resolution once it
// would otherwise not render at all.
const MAX_CANVAS_PIXELS = 16000000;
const MAX_CANVAS_SIDE = 4096;

export function deviceScaleFor(cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  if (!(cssWidth > 0) || !(cssHeight > 0)) return dpr;
  return Math.min(
    dpr,
    Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)),
    MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight),
  );
}
