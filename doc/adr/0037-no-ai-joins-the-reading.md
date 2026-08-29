# 37. No AI joins the reading

Date: 2026-08-28

## Status

Accepted

Bounds [ADR 28](0028-books-are-retypeset-before-they-reach-the-shelf.md) and
stands beside [ADR 36](0036-books-are-for-tonight-and-the-shelf-is-not-an-archive.md)
as the second answer to "what does this app not become".

## Context

The question has now been asked twice, from the same direction both times: the
app looks finished, the shelf works, the sync works, the ritual works — could a
language model enrich the evening? Explicitly *not* as gamification, which this
project has never wanted; as something that makes the reading better.

Asking it a second time is the reason to write this down. ADR 36 was written to
answer a recurring question "without a fresh discussion each time", and this is
the other question of that kind.

The architectural situation frames every answer. The app is a static page on
GitHub Pages plus a Realtime Database. A model call at read time needs a key,
therefore a proxy, therefore running cost, latency and a new way to fail — at
19:45, with the child already waiting. And it would spend something the app has
so far kept: reading alone touches no network at all, and the room deliberately
does not record who read when
([ADR 26](0026-the-room-records-that-reading-happened.md)). Anything
precomputable avoids all of that by being computed before the book reaches the
shelf, in the workflow that already prepares books (ADR 28).

Four candidates were worked through on those terms. All four fell, and the
reasons differ enough to be worth keeping, because it is the reasons that
generalise.

1. **A reading preview for the adult choosing tonight's book** — what happens
   in it, how long it takes to read aloud, what is emotionally in it. It fell on
   a fact about the content: every einfachvorlesen.de book already prints its
   own blurb on page 1, where the cover and the age recommendation are read from
   ([ADR 29](0029-the-cover-and-the-age-come-off-the-title-page.md)), and every
   other book reaches this shelf deliberately, carried there by someone who
   knows what it is. The feature would have restated what the book says about
   itself.

2. **Dialogic-reading prompts** — one good question per chapter for whoever is
   reading aloud, on their device only. This one was refused on principle rather
   than on cost, and the principle is autonomy: a grandparent asking their own
   grandchild their own question is the act the app exists to carry, and a card
   that supplies the question replaces the reader's judgement about a child only
   they know. [ADR 12](0012-mood-ritual-honours-divergence.md) already turned
   the app around once on exactly this ground — it had been pressing two readers
   toward one feeling, and stopped. A prompt card would have repeated that
   mistake on the adult's side of the call.

3. **Reading a photographed book's title and cover off the first shot**, so a
   photo book stops being called "Foto-Buch 2026-08-28 19:12". A real
   quality-of-life gain, and the wrong ratio: it is the only candidate that
   cannot be precomputed — the photos are taken on the user's device — so it
   alone would have bought the whole proxy, the key and the bedtime failure
   mode, in exchange for not typing a title on a path used a few times a year,
   for a book that ADR 36 says is for tonight.

4. **Generalising the extractor beyond einfachvorlesen.de**, with a model
   supplying the judgement that the font-size signature supplies for that one
   source. Agreed with in principle and still not worth building: the audience
   is the maintainer alone, a script covering every source is a large piece of
   work that would still fail on a fifth of the books, and a maintainer who
   needs a `buch.json` for a foreign PDF already has a model at hand and can ask
   for one directly. ADR 28's two-step recipe assumes the first step may be
   wrong and puts the correction in `buch.json`; that assumption is exactly what
   makes the ad-hoc route sufficient.

Alongside those, a set of ideas was ruled out on principle before cost was even
considered, and they are recorded here so the ruling holds for whatever is
proposed next:

- **A synthetic reading voice.** The grandparent's voice is the entire point of
  the app. Offering an alternative next to it undermines the purpose rather than
  extending it.
- **Generated stories.** A different product, and one that devalues the real
  books the shelf exists for.
- **Listening in through the microphone** — reading coaching, progress
  detection, anything of that shape. Surveillance in a child's room, against
  everything ADR 26 settled.
- **A machine-written summary of the evening** in the mood ritual. ADR 12 put
  the value in each person naming their own feeling; a device that says what the
  evening was takes precisely that away.
- **OCR of photo books into typeset books.** ADR 36 already made photo books
  quick capture rather than scanning, and Adobe Scan does the scanning job
  better and faster than this app ever would.

## Decision

**This app binds no AI — not at read time, and not in the tooling this
repository ships.**

Nothing in `src/` calls a model, no proxy is stood up, no key exists to hold.
The re-typesetting tool stays the deterministic extractor ADR 28 describes; it
moved to [its own repository](https://github.com/DrDonik/retypeset-book) in
August 2026 unchanged, and carries no model there either.
A maintainer who uses a language model ad hoc to produce a `buch.json` for a
book from another source is doing hand work outside the repository, the same as
editing that file by hand; it is not a feature, it ships nothing, and this ADR
does not restrict it.

A future proposal has to answer four questions, and none of the four candidates
above answered all of them:

1. **Does the book, or its source, already say this?** If it does, the app
   would only be repeating it less reliably.
2. **Does it take a judgement away from the people reading?** Choosing the
   book, asking the question, naming the feeling and reading the words are the
   acts this app is built to carry between two people. It may not perform them.
3. **Does it make the app reach the network while someone is reading?** Solo
   reading touches nothing today, and the room knows as little as ADR 26 leaves
   it knowing. That is a property, not an accident.
4. **Would the maintainer reach for a model directly instead?** If the answer
   is yes, the feature is a worse version of something that already works.

**With that, the app is feature-complete for its purpose.** The shelf, the
capture, the sync, the pointer, the zoom and the closing ritual are the whole of
what it set out to do. Further work needs a reason arriving from use — an
evening that went badly, a thing a six-year-old could not do — not a capability
looking for somewhere to be applied.

## Consequences

- The question closes until something new is on the table. A fresh proposal is
  welcome and has to name which of the four tests it passes, rather than
  reopening the four candidates.
- No proxy, no API key, no runtime dependency, no bill, and no new failure that
  can appear at bedtime. The privacy position of ADR 26 keeps its foundation:
  what the two households do with a book stays between the two devices.
- **The cost, stated plainly:** the app will never help pick tonight's book,
  never offer a way into the conversation, and never make a photographed book
  name itself. Each of those stays a human act. That is accepted, because each
  is the same act as reading aloud — done by someone who knows this particular
  child.
- "Feature-complete" is a status, not an ending. Bugs are still bugs, the
  dependencies still move, and a real difficulty that shows up in use is still
  worth building for. What it rules out is building because there is capacity to
  build.
- This ADR is immutable like every other one (ADR 1). If a model becomes
  something the app can call without a key, a bill and a network round trip at
  read time, question 3 changes its answer — and questions 1, 2 and 4 do not.
