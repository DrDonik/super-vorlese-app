# 19. Shared reading starts in the library; one book, one code, per device

Date: 2026-08-14

## Status

Accepted

## Context

„Gemeinsam lesen" is the first tile in the library, and until now it did exactly
one thing: ask for a Synchronisations-Code. That serves the person who has been
given one and nobody else.

Creating a code was only possible **inside a book**, behind the sync button in
the reader chrome — a control nothing in the library points at. So whoever holds
the book, which is often the grandparent, tapped a tile promising the whole
activity, was asked for a code they did not have, and cancelled. Half of
[ADR 15](0015-sync-code-naming-convention.md)'s single activity was unreachable
from the place that names it.

That, rather than the missing pictures, is what made the library unusable for the
person [ADR 18](0018-library-is-an-adult-surface.md) says it must serve.

Two facts about the existing machinery shape the answer:

- A room is stored **per book** (`sync-rooms` in `localStorage`, keyed by book
  id). A code belongs to a book, not to a person — which is exactly why one
  grandparent can read one book with one grandchild and another book with
  another, simultaneously and independently.
- Opening a book **already restores** its saved room: `SyncSession.reconnect()`
  runs on every open, so a pair who have read a book together before are back in
  sync by tapping the cover, with no code and no dialog.

## Decision

**One dialog, two ways out, in the reader panel's order.** The tile opens a
dialog that explains the procedure in one sentence — one of you creates the code
and says it to the other — and then offers *Buch auswählen und Code erstellen*,
„— oder —", and the code field with „Verbinden". Same two paths, same sequence,
same vocabulary as the reader's sync panel, so the two screens teach each other
(rule 1). On an empty shelf the upper path is not shown: it could only lead to a
picker with nothing in it.

**The shelf is the book picker.** Choosing a book turns the library into a
selection mode rather than opening a second, poorer list inside the dialog. The
covers are the one thing on this screen that works for everybody, and building a
list beside them would duplicate the shelf.

In that mode:

- The **sort pills and filter chips stay live.** Arranging and narrowing the
  shelf *is* finding the book, and a household that has tagged its books
  ([ADR 16](0016-personal-tags-and-shelf-filtering.md)) wants those chips exactly
  now. Only what is not choosing a book goes: the two add buttons, and the pencil
  and mood strip on each card, which would open a dialog instead of starting the
  session.
- The **tile stays in its cell and becomes the instruction** („Wähle das Buch,
  das ihr lesen wollt"). Removing it would shift every book by one position,
  moving the cover the reader was just looking at; its corner is also where
  „Gemeinsam lesen" always sits, so it is where an explanation is looked for. It
  is quiet grey, not a signal colour — per [ADR 4](0004-interactive-color-scheme.md)
  green means connected and red means destructive, and an instruction is neither.
- The book's accessible name changes from „… öffnen" to „… gemeinsam lesen", which
  is what tells a screen-reader user the shelf is doing something else right now.

**Picking a book shows its code — existing or new, indistinguishably.** The
reader opens, the ordinary reconnect runs, and only if that came up empty is a
code created. A book that already carries one keeps it: creating a second runs
`syncCreate`'s `syncStop` first, which leaves the room and deletes it outright
when this device is its last member, pulling it out from under a partner still in
it. Whether a code is minutes or weeks old is nothing the user has to think
about, so **the screen is word-for-word the same either way**.

**One book, one code, per device.** This is the limit the design accepts. Reading
the *same* book with two different grandchildren in *separate* sessions is not
possible: they would be handed the same code and land in the same room. Different
books with different grandchildren work perfectly, which is the common shape.

**No „neuen Code erstellen" on the code screen.** It would leave the old room
while the other participant is still enrolled in it: by
[ADR 7](0007-presence-based-room-lifetime.md) the room survives, so they get no
"the room was closed" message — just a session where nothing happens any more.
The honest way out remains „Trennen", which removes this device's membership
properly — in the book's edit dialog, per
[ADR 20](0020-disconnecting-lives-in-the-book-edit-dialog.md).

### Alternatives considered

**Live presence** — a `rooms/$code/online/$id` node with an `onDisconnect`
handler, so the tile could say „Lena ist bei ‚Grüffelo'" and open that book on
one tap, with no code at all in the common case. This does not contradict
[ADR 7](0007-presence-based-room-lifetime.md), whose rejection of `onDisconnect`
was about *membership* (a dropped connection must not count as leaving), and the
pointer already uses the same mechanism. It was not pursued: it needs a schema
change, a database-rules change and deploy
([ADR 6](0006-automate-database-rules-deploy.md)), a presence listener the library
does not have today (`loadFirebase` is lazy and untouched by the shelf), and a
new emission of "this device has this book open". It also only ever *skips* the
dialog decided here — the dialog is the floor it falls back to when nobody is
there, so building the floor first is the right order.

**A „?" help in the library** — see
[ADR 18](0018-library-is-an-adult-surface.md): callouts would repeat labels that
are already on screen.

**Telling the user their book was already set up** — a second wording on the code
screen when the room has other members. Dropped as a distinction the user does
not need to make, at the price noted below.

## Consequences

- The change is confined to the interface: `sync.js`, `storage.js` and
  `database.rules.json` are untouched, so there is no schema, no migration and no
  deploy.
- `dialog.js`'s `content` may now be a function receiving a `close(value)`
  callback, for a dialog with more than one way out. The two paths cannot live in
  the button row — three buttons abreast do not fit a phone, and the "— oder —"
  between them is the point.
- The graying of „Verbinden" until six characters stand, and Enter from within
  the field, moved into `code-field.js` as `bindCodeSubmit`, which the reader
  panel now uses too. Both places ask for the same code and can no longer drift.
- A rejected code returns to the same dialog with what was typed still in the
  field, so a mistyped character costs one keystroke to repair, not six.
- **Nothing teaches the shortcut.** Because the code screen reads the same on a
  book that was already set up, nobody learns that tapping the cover directly
  would have done. The detour is harmless — it ends in the same place — but it
  stays a detour, possibly every evening. Accepted deliberately: a message that
  only sometimes appears is a worse thing to understand than a slightly longer
  path that always works the same way.
- The empty library no longer offers „importiere ein geteiltes Buch": since
  [ADR 17](0017-sync-is-the-only-sharing-path.md) the app hands out no book files,
  so the third route to a book is a Lesepartner sending it during a session.
- The reader's sync button now wears the same 👥 as the library tile instead of
  „⇄", so the two are recognisably one feature. Being an emoji it brings its own
  colours, and the connected state rides on the green fill alone.
- The code screen is the reader's existing sync panel, which put a red „Trennen"
  in front of people who had just created their first code and ended the session
  on one tap. That button predates this change, but this change is what routes
  newcomers past it — so it moved into the book's edit dialog, along with the
  redundant „Verbunden" line. See [ADR 20](0020-disconnecting-lives-in-the-book-edit-dialog.md).
