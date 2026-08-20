# 28. Books are re-typeset before they reach the shelf

Date: 2026-08-20

## Status

Accepted

## Context

The books read in this app come from [einfachvorlesen.de](https://www.einfachvorlesen.de),
a free service of Stiftung Lesen and Deutsche Bahn Stiftung. Their PDFs are
generated automatically, and it shows. On a typical page:

- a chapter heading lands at the very bottom with a single line of text under
  it, because nothing keeps a heading with the text it introduces;
- every page carries the einfachvorlesen logo, the line "Ein Service von
  Stiftung Lesen und Deutsche Bahn Stiftung", and a `5/20` counter — three
  pieces of chrome that say nothing to a child and interrupt an adult reading
  aloud;
- illustrations sit flush left rather than centred, and the space beside and
  under them is left empty;
- the text is A4, ragged right without hyphenation, with paragraph gaps wide
  enough that a page holds far less than it looks like it should.

The result is legible but unlovely, and it is read for half an hour at a
stretch by a grandparent on one screen and a six-year-old on another. It is
worth setting properly.

Two properties of the source make that tractable. First, because the PDFs are
machine-generated they are **structurally uniform**: measured across all 25
books currently held, font size alone identifies every element — 24pt is the
title on the cover page, 16pt a chapter heading, 14pt body text, 12pt the
publisher block, 10pt the page chrome, 20pt the closing advertisement page. The
gap between baselines is 20pt inside a paragraph and 30pt between paragraphs,
with no intermediate values in 3182 measured line pairs, and no word is broken
across a line in over 5000 lines. Second, longer books are offered as numbered
parts, each a self-contained PDF with its own cover and closing page, splitting
at chapter boundaries.

An earlier attempt (the book *Tinka Knitterflügel*, May 2026) proved the output
worth having but was not a workflow: its text had been transcribed into Python
literals by hand, so nothing about it could be repeated for the next book, and
the script was lost with the directory it lived in.

## Decision

**Books are re-typeset by `scripts/retypeset-book.py` before being added to the
shelf, in two steps with an editable recipe between them.**

    extract   PDF(s) -> buch.json + bilder/
    build     buch.json -> buch.typ -> PDF

- **The intermediate file is the point.** `extract` writes `buch.json`, a plain
  list of paragraphs, headings and images. A wrong chapter split or an
  awkwardly placed illustration is corrected there, and `build` can then be run
  any number of times without losing the correction. The hand-transcribed
  `content_p*.py` of the Tinka attempt was the same idea without the automatic
  first step; automating extraction is what makes the recipe cheap enough to
  regenerate.

- **Typst does the setting**, driven by a generated `book.typ`. Chapters start
  on a new page; `block(sticky: true)` binds a heading to its first paragraph;
  illustrations are floats, so a picture that no longer fits moves on rather
  than leaving a hole.

- **The page is 18 × 24 cm, not A4.** That is exactly 3:4, which fills a 13"
  iPad Pro (2752 × 2064) held upright edge to edge and leaves only a little
  room on an 11" iPad. Since the reader fits each page into the viewport, a
  shorter page means larger apparent text: about 1.24× the original on the 13",
  1.17× on the 11". Phones are not a target — nobody in this household reads
  aloud from one.

- **Atkinson Hyperlegible Next at 14pt**, vendored under `scripts/fonts/` with
  its OFL licence. It is the source's own typeface, designed for low vision,
  which is the accessibility target this project has already committed to
  ([ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md)). The
  copies embedded in the source PDFs are subsets and cannot be typeset with.
  At 2.2 cm margins this yields 60.7 characters per line against the original's
  65.4 — measured, not estimated, at 0.4537 em per character.

- **Spacing is measured at the baselines, not guessed.** Typst computes
  `leading` and `spacing` from descender to ascender, which for this face is
  9.35pt short of the baseline-to-baseline distance — so the first draft's
  seemingly generous `spacing: 0.9em` produced only 2pt more air between
  paragraphs than between lines, and the page read as one undifferentiated
  slab. The source, for all its faults, was more readable here. Body text is
  therefore set to **1.50× the type size line to line (21.0pt) and 2.25×
  paragraph to paragraph (31.5pt)**, the values WCAG 1.4.12 uses (1.5 and 2.0);
  the source sits at 1.43× and 2.14×. There is **no first-line indent**:
  paragraphs are separated by air alone, because someone reading aloud looks up
  at the child and back down, and finds a gap again more reliably than an
  indent.

- **Emphasis in the body text is preserved.** The source marks it two ways —
  italic (135 spans: stressed words, sound words, verse) and the Medium weight
  (104 spans: shouted words like "Nein!" and "PING!"). Both change how a
  sentence is read aloud, so both survive extraction, as runs in `buch.json`
  rather than inline markers. Typst's `#emph[…]` and `#text(weight: "medium")`
  are used instead of the `_…_` shorthand, which requires a word boundary that
  two of the source files do not provide.

- **A 16pt line is only a chapter if it divides the book.** It can equally be a
  shout inside the story ("BEI ARCHE BOA BIST DU RICHTIG!", on the first page
  of text) or the head of a factual afterword ("Über Orang-Utans:", "Das
  Watt" — on the last pages). Headings therefore become chapters, with a page
  break and a table-of-contents entry, only when there are at least two of them
  *and* the first appears within the opening quarter of the text. Everything
  else is set in place as a subheading. A lone heading that merely repeats the
  book title is dropped.

- **Ragged right with reluctant hyphenation.** Even word spacing tracks better
  than justified text at this measure, and hyphenation is priced at 400% so
  Typst reaches for it only when a line would otherwise fall badly short. A
  word broken across a line makes a person reading aloud stumble; the first
  draft produced seven hyphens on a single page and now produces one.

- **Illustrations are never enlarged beyond their size in the source.** They
  are embedded at 90–155 dpi, which is a ceiling, not a choice.

- **The source is verified before anything is read.** Since the whole
  extraction rests on font sizes carrying meaning, a PDF set by anyone else
  yields a book with no text at all — a silent failure that would surface only
  at bedtime. The presence of Atkinson Hyperlegible is checked first, and a
  book that produces no paragraphs is refused.

- **Duplicate pages are detected and skipped.** Parts are assembled by passing
  several PDFs at once, sorted by their `-teil-N` suffix, keeping the cover of
  the first and dropping every closing page. Because a merged file and a raw
  part look alike months later, pages are fingerprinted by their text and a
  repeat is skipped with a warning rather than silently doubling five chapters.

- **The finished PDF stays in the working directory.** The script prints the
  `cp` command; what enters the library is the maintainer's decision, and the
  original download is never overwritten.

Sources, recipes and output all live under `doc/books/`, which is not tracked —
there is no licence to republish these books, and the repository holds only the
tool ([ADR 8](0008-no-tests-or-linter.md) applies: the check is a rendered page
looked at, not a test suite). `build --preview` renders sample pages as PNG for
exactly that.

### Alternatives considered

**A Claude Code skill instead of a script.** Extraction is fully deterministic
once the font-size signature is known, so a language model in the loop would
add cost and variance without adding judgement. It would also have to live
under `.claude/`, which this repository deliberately keeps untracked.

**Reflowing the original PDF in place** — deleting the chrome, nudging images.
This cannot fix the two things that matter most, the A4 measure and the
orphaned headings, because both are consequences of where the text was broken
in the first place.

**Keeping A4** to match the source and the Tinka precedent. It is the safest
page for an unknown device and the worst for the two known ones.

**Re-using the fonts embedded in the source PDFs**, avoiding a vendored copy.
They are subsets (`AAAAAB+AtkinsonHyperlegibleEV-Regular`) holding only the
glyphs that book happened to use.

## Consequences

- Books gain roughly a fifth in apparent text size on the devices actually used,
  and lose the logo, the advertisement line and the page counter entirely.
- Chaptered books grow about 20–35% in page count — a smaller page, plus a page
  break before every chapter. Picture books stay level or shrink. Page turns are
  synchronised by index and the book file is transferred per peer
  ([ADR 9](0009-per-peer-book-transfer.md)), so a re-typeset book and its
  original simply never meet.
- The workflow only reads einfachvorlesen.de PDFs, by design. A book from
  another source needs its own extractor, and the guard says so plainly instead
  of producing an empty one.
- Correcting a book means editing `buch.json` and rebuilding; the correction
  survives, but it is not carried back into the source PDF.
- Typst and PyMuPDF become development-time dependencies. Neither is shipped to
  the browser; the app only ever sees the finished PDF.
