# 2. Do not support EPUB

Date: 2026-05-28

## Status

Accepted

## Context

The app currently supports two book sources: PDF (rendered via pdf.js) and photo books (numbered image pages). The reader's sync feature works by exchanging a single integer — the current page number — between the two connected devices. This relies on the page count being identical and device-independent.

We considered adding EPUB as a third source format. EPUB comes in two variants:

- **Fixed-layout EPUB**: pre-paginated, dimensions baked into each spine item. Common for children's picture books. Behaves like PDF for our purposes; the integer-page sync model still works.
- **Reflowable EPUB**: HTML/CSS that flows based on viewport, font size, and reader settings. The number of "pages" depends on the device. Common for chapter books and adult fiction. Sync via page number is meaningless; sync via EPUB CFI or paragraph index is possible but cannot guarantee that both readers see the same visual content at the same time.

The app's target users are grandparents and grandchildren (around age 6) reading together over a video call. The product guarantee is "we see the same page". A reflowable book where grandma is on what the child sees as the bottom of one page and the top of the next breaks the core UX premise.

Implementing even fixed-layout-only EPUB requires:

- A new rendering path in `src/reader.js` (EPUB libraries render HTML to an iframe, not a canvas, so it cannot reuse the existing canvas pipeline).
- Adding an EPUB parsing library (e.g. foliate-js or epub.js) to the bundle.
- Layout detection at import time to reject or warn on reflowable EPUBs.
- Cover-image extraction from the OPF manifest for thumbnails.

The PDF and photo paths already cover the realistic use cases for this audience — children's picture books, scanned family albums, and photos of physical books. There is no current user demand for EPUB.

## Decision

We will not add EPUB support at this time. The library accepts PDF and photo books only.

## Consequences

- The sync model remains a single integer, and the "same page on both devices" guarantee holds without caveats.
- Bundle size and code complexity stay smaller; no second rendering pipeline to maintain.
- Users with EPUB-only content cannot import it directly. If this becomes a real pain point, fixed-layout EPUB is the natural extension; this ADR should then be superseded.
- Reflowable EPUB remains out of scope regardless, unless we are willing to weaken the page-sync guarantee.
