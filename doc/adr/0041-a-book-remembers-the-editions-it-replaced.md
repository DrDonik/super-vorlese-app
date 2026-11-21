# 41. A book remembers the editions it replaced

Date: 2026-11-21

## Status

Accepted. Extends [ADR 40](0040-a-book-has-an-edition-and-a-provenance.md).

## Context

ADR 40 lets a corrected re-export fold into the book already on the shelf by
matching `workTitle` — the `info.Title` the re-typesetter writes into every
PDF. The receive path does the same, so an edition arriving over sync lands
on top of its predecessor instead of beside it.

That works for every book the re-typesetter ever touched. It fails for books
imported from `einfachvorlesen.de` without being re-typeset first, because
the PDFs that site delivers carry no `info.Title` at all (Creator "pdf-lib",
Producer "macOS Quartz"). Five such books are on the shelf — Arche Noah,
Major Tom – Der Fluch der Mumie, Die Superhörnchen, Wildpferde, Otto fährt
los. Their stored `workTitle` is `null`, and `takeSoleCandidate()` in
`src/library.js` refuses a null work title (it would match every other
null-work-title book on the shelf). So re-typesetting these five books now
and dropping them in would land them as five new cards next to the originals,
with no keepsake on the new cards and no way to automatically fold them in.

The symmetric problem exists on the receive side. Even if the owner replaces
the file manually, the partner's device re-reads the arriving PDF's own
metadata and, since the partner's old copy has `workTitle = null`, cannot
match it either. The partner ends up with two cards holding the same book,
and the keepsake is on the wrong one.

A hash list sharing `contentHash`'s identity was already weighed in ADR 40
and rejected: two editions would then answer "yes" to the three
load-bearing questions ("do I have this book", "did it arrive intact",
"does this Lese-Code belong to the open book"), and two devices would
synchronise page turns against different page breaks.

The fix sits next to that rejection, not inside it: a list of previous
editions, **distinct from `contentHash`**, used only as a second answer by
the one path that is already allowed to fold a book in.

## Decision

**A book carries the list of `contentHash` values its file ever had before
the current one.** It is a provenance, not an identity.

- **Stored at `meta.previousContentHashes`**, appended on every replacement
  through `replaceBookFile()`. The field is absent on books that were never
  replaced, so nothing changes under existing books on existing shelves. A
  replacement that happens to hand the book bytes it once held does not
  re-push that hash.

- **`contentHash` stays the sole identity of the current edition.** The three
  questions in ADR 40 still ask only `contentHash`, unchanged:
  `findBookByContentHash()` searches the current hash, never the provenance
  list. Two editions therefore still cannot be taken for one another, and
  page sync between two devices still runs on exact bytes.

- **Sent with every `.vorlese` bundle** as `manifest.previousContentHashes`
  when the list is non-empty. `exportBook()` writes it; `importBundle()`
  reads it; `saveBook()` stores it on the freshly imported book. Omitting it
  when empty keeps the manifest of books that were never replaced identical
  to what it was.

- **Used by `adoptEdition()` in `src/main.js` as the first match path, before
  `workTitle`.** If the shelf holds exactly one book whose current
  `contentHash` is in the arriving bundle's `previousContentHashes`, the new
  file folds into that book and the fresh import is deleted again. Only
  then does `workTitle` take over, as before.

- **Merged on fold-in.** When a receive path folds in, the receiver's own
  `previousContentHashes` keeps its predecessors and gains the sender's,
  plus the receiver's current hash — so the next step of the chain still
  recognises either side's ancestry. Deduplicated, order kept.

- **A new "PDF ersetzen" action in „Buch bearbeiten"**, placed Dialog-wide
  under the Lese-Code rubric and above the divider, styled like „Trennen"
  (`dialog-btn`, outlined, neutral). It opens a file picker; the chosen PDF
  goes through the same reader every import path uses (`loadPdf`,
  `readTitlePage`, `readWorkTitle`, `hashBook`) and lands via
  `replaceBookFile()`. The book keeps its id, its keepsake, its tags and
  its title; the previous hash is appended to `previousContentHashes`
  automatically by `replaceBookFile()`.

  As in ADR 40's drop-import replace path, the book gives up its Lese-Code:
  the room behind that code names the old edition, and the offer behind it
  would now hand out the new file. `closeSyncForBook()` is called, and the
  next shared reading starts with a fresh code — which is exactly how the
  partner's device then sees `previousContentHashes` and adopts the new
  edition into the matching old copy.

  The action is PDF-only. A photographed book is never a re-export of
  itself, and the camera remains the way to replace its pages.

  No confirmation dialog in front of the file picker: the picker is already
  the confirmation (two deliberate taps), the old file is still on the
  user's device, and the keepsake stays with the book either way (rule 5).

- **No feedback to the receiver that a replacement happened.** The card
  looks the same, the title is the same, the keepsake is where it was. A
  line saying "your copy was updated" would describe nothing the reader
  can see (rule 3), and the one thing the reader can see — that pressing on
  reads correctly from the new file — is the only report that matters.

### Alternatives considered

**Matching on `manifest.title` when `workTitle` yields nothing.** The
sender's display title, which travels in every bundle already. It rules the
shelf's own capitalisation and Umlaut spelling in, both of which drift
(einfachvorlesen.de encodes `ä` as `_` in filenames, so the shelf's
filename-derived title reads "Otto fa hrt los" while the re-typeset PDF
carries "Otto fährt los"). Would have needed a normalisation ladder and
would still have missed the Umlaut books.

**A manual repair dialog listing every title-less book.** The partner would
see it on every sync against an un-matched edition. Robust but noisy, and
it would be seen most by whoever uses the app most quietly.

**Making the sender write a sidecar record "this id had hash X before".**
Same information as `previousContentHashes` with more moving parts and
nothing to show for it.

**Letting `contentHash` itself be a list.** Explicitly rejected in ADR 40
and not reopened here: the provenance list is strictly separate from the
identity and does not participate in any of the three load-bearing checks.

## Consequences

- The five un-titled books are repaired in one pass: open each in „Buch
  bearbeiten", tap „PDF ersetzen", pick the re-typeset file. The owner's
  book keeps its id, its keepsake, its tags, its Lese-Code; the previous
  hash is recorded. On the next shared reading the partner's device sees
  `manifest.previousContentHashes = [old]`, matches the old copy there, and
  folds in.

- `meta.previousContentHashes` is a new persistent field. It is absent on
  every book until that book is replaced for the first time, and small
  afterwards: a chain of length ten costs 640 bytes. There is no bound in
  the code; practical ceilings (how often a book is corrected) make one
  pointless.

- `manifest.previousContentHashes` is a new (optional) field in the
  `.vorlese` manifest. Per guideline 2 no migration is needed: an older
  app ignores the field and falls back to the workTitle path; a newer app
  reading an older bundle sees no field and does the same.

- The symmetric case the fix does not cover is a replacement that already
  happened before this change shipped: the owner's old hash is gone, and
  there is nothing for the partner to match against. For the five books
  named above this is not a concern — none of them have been replaced yet
  — but the general rule is: this change prevents loss going forward, it
  does not reconstruct it.

- „PDF ersetzen" is deliberately a rare action. It is the owner's answer
  when the shelf fails to recognise a re-export, and the common path stays
  what ADR 40 made it: drop the file and let the index match.
