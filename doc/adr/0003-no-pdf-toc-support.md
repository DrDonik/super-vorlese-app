# 3. Do not support PDF table of contents

Date: 2026-05-28

## Status

Accepted

## Context

Some PDFs embed an outline (table of contents) that pdf.js exposes via `pdf.getOutline()`. Each entry carries a destination that can be resolved to a page number via `pdf.getDestination()` and `pdf.getPageIndex()`. We considered surfacing this outline in the reader as a navigation aid alongside the existing page indicator.

The app's target content is short, illustrated children's picture books read aloud during a video call between a grandparent and a roughly 6-year-old grandchild. Books in this category — typically scanned or image-heavy — overwhelmingly ship without an embedded outline. The photo book source (`PhotoSource` in `src/reader.js`) has no notion of an outline at all, so any TOC entry point in the UI would silently do nothing for that book type and for most PDFs in the library.

The reader chrome is deliberately minimal: back button, title, sync button, page indicator. The page indicator already supports tap-to-jump to an arbitrary page, which covers the rare case where a reader wants to skip ahead. A TOC button or drawer would add UI real estate and cognitive load on a screen designed to stay child-friendly, in exchange for a navigation aid that activates on a small minority of imported books and adds no value over page-jump for the rest.

Empirical verification against a sample of typical German children's picture books was attempted but blocked by the remote execution environment's network policy. The decision rests on the strong prior that scanned and illustrated picture books rarely carry an outline, combined with the UX considerations above.

## Decision

We will not implement PDF outline / table-of-contents navigation in the reader.

## Consequences

- The reader chrome stays as it is: back button, title, sync button, page indicator (with tap-to-jump). No TOC button or drawer is added.
- Readers who want to skip to a specific page continue to use the page indicator input, which works uniformly across PDF and photo books.
- If the library ever shifts toward longer, chaptered books where an outline would be common and useful, this ADR should be superseded rather than amended.
