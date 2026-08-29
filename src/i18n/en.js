// English. Also the fallback for every browser whose language the app does not
// speak (see i18n.js), so this is the dictionary strangers meet — it carries
// more weight than its four siblings.
//
// Spelling is British, which is what a European household expects and what the
// rest of the app's European context implies.
//
// ADR 15 fixes one name for the activity, one for the code and one for the
// other person, all anchored on the *book*. The English set:
//
//   „Gemeinsam lesen"        → „Read together"
//   „Lese-Code"              → „reading code"
//   „Lese-Code des Buches"   → „the book's reading code"
//   „Lesepartner"            → „reading partner"
//   „Verbinden" / „Trennen"  → „Connect" / „Disconnect"
//
// Both languages dropped „Synchronisation" together (ADR 15, Ergänzung vom
// 2026-08-29): it is the implementation's word, it is long, and it has to be
// said out loud on the phone by a grandparent. The requirement ADR 15 actually
// makes — one consistent name, anchored on the book — is met by „reading code",
// which a six-year-old can also say. „Raum" has no English equivalent here
// either; there is none, deliberately.
//
// As in de.js: a value is a string or an object of CLDR plural forms, the
// counting variable is always `n`, other placeholders are `{name}`. A language
// that needs no plural for a given phrase may use a plain string where German
// uses forms (see `pdf.ageTag`).
//
// English quotes are “…” and the apostrophe is ’, both typographic — as are the
// German ones next door, which come in two sets since German split by region:
// «…» in de.js for Switzerland, „…" in de-DE.js for Germany and Austria. So the
// one rule this file needs is absolute and needs no exceptions: never " < > in
// a value. Part of these texts is interpolated into markup (button names,
// aria-labels), and with no straight quote anywhere in any dictionary the
// question of which ones never comes up.

export const en = {
  // ── Words that recur ─────────────────────────────────────────────────
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.done': 'Done',
  'common.add': 'Add',
  'common.save': 'Save',
  'common.undo': 'Undo',
  'common.discard': 'Discard',
  'common.input': 'Input',
  'common.or': '— or —',
  'common.pages': { one: '{n} page', other: '{n} pages' },

  // ── Library ──────────────────────────────────────────────────────────
  'library.title': 'Library',
  'library.photograph': 'Take photos',
  'library.import': 'Import',
  'library.sortGroup': 'Sort books',
  'library.filterGroup': 'Filter books',
  'library.dropTarget': 'Drop a PDF here',

  'library.sort.opened': 'Last read',
  'library.sort.title': 'A–Z',
  'library.sort.added': 'Added',

  'library.filter.done': 'Already read',
  'library.filter.open': 'Not read yet',

  'library.empty.title': 'No books yet.',
  'library.empty.body': 'Photograph some pages or load a PDF. When you read together, your reading partner sends you the book.',
  'library.empty.dropHint': 'You can also just drag a PDF here.',

  'library.noMatch.title': 'No book matches all the filters.',
  'library.noMatch.body': 'Tap one of the filters above to switch it off again.',

  'library.book.open': 'Open {title}',
  'library.book.readTogether': 'Read {title} together',
  'library.book.moods': 'See the feelings for “{title}”',
  'library.book.edit': 'Edit book',

  'library.disconnected': 'You are no longer reading “{title}” together.',
  'library.titleSaveFailed': 'The new title could not be saved.',
  'library.deleteFailed': 'The book could not be deleted.',

  'library.delete.title': 'Delete book',
  'library.delete.confirm': 'Delete',
  'library.delete.question': 'Really delete “{title}”?',
  // „lost" is the camera's word for the same kind of loss in the same kind of
  // dialog („The photos will be lost."), so the app says it one way (rule 1).
  'library.delete.evenings': {
    one: 'One shared evening is lost with it.',
    other: '{n} shared evenings are lost with it.',
  },

  'library.import.unsupported': '“{name}” is not a supported format. Please choose a PDF or .vorlese file.',
  'library.import.reading': 'Importing {name}…',
  'library.import.imported': '“{title}” imported.',
  'library.import.failed': 'Import failed: {error}',
  'library.import.processing': 'Processing {index}/{total}: {name}…',
  'library.import.unreadable': '“{name}” could not be read.',

  // ── Edit book ────────────────────────────────────────────────────────
  'bookEdit.title': 'Edit book',
  'bookEdit.titleField': 'Title',
  'bookEdit.tags': 'Tags',
  'bookEdit.newTag': 'New tag',
  'bookEdit.newTagLabel': 'Add a new tag',
  'bookEdit.tagsSaveFailed': 'The tags could not be saved.',
  'bookEdit.syncCode': 'Reading code',
  // The counterpart to „Verbinden" / „Connect" in the sync panel — the missing
  // end of a pair the app already had. The rubric right above names the code
  // and shows it, so the button needs no noun of its own.
  'bookEdit.disconnect': 'Disconnect',
  'bookEdit.delete': 'Delete book',

  // ── Reading together ─────────────────────────────────────────────────
  'sync.activity': 'Read together',
  'sync.code': 'Reading code',
  'sync.codeOfBook': 'The book’s reading code',
  'sync.tileHint': 'Enter a reading code and read along',
  'sync.selectPrompt': 'Choose the book you want to read',

  'sync.start.message': 'One of you creates the code and reads it out to the other on the phone.',
  'sync.start.selectBook': 'Choose a book and create a code',
  'sync.joinLabel': 'Got a reading code from your reading partner?',
  'sync.connect': 'Connect',

  'sync.panel.desc': 'To see the same page, you both need the same reading code for this book.',
  'sync.panel.create': 'Create a reading code',
  'sync.codeHint': 'Read it out to your reading partner on the phone.',

  'sync.ended': 'You are no longer reading together.',
  'sync.connectFailed': 'Could not connect.',
  'sync.connectFailedRetry': 'Could not connect. Please try again.',
  'sync.bookLoading': 'The book is still loading. Please wait.',

  'sync.error.length': 'A reading code has {n} characters.',
  'sync.error.unknown': 'There is no such reading code.',
  'sync.error.noFreeCode': 'No reading code could be created. Please try again.',

  'sync.otherBook.title': 'A different book',
  'sync.otherBook.message': 'This reading code belongs to “{title}”. Reading together means switching to that book. Open it now?',
  'sync.otherBook.confirm': 'Open the book',
  'sync.otherBook.untitled': 'a different book',

  // ── A book comes over the wire ───────────────────────────────────────
  'transfer.title': 'Loading the book',
  'transfer.message': '“{title}” is being sent by your reading partner…',
  'transfer.untitled': 'The book',
  'transfer.saving': 'Saving the book…',
  'transfer.corrupt.title': 'Transfer damaged',
  'transfer.corrupt.message': 'The book that arrived was incomplete or damaged. Please try again.',
  'transfer.failed.title': 'Cannot connect',
  'transfer.failed.message': 'Your reading partner needs the app open with the book open too. Then please try again.',
  'transfer.unsupported': 'This reading code cannot send books yet. Please ask your reading partner to create a new reading code.',

  // ── Reader ───────────────────────────────────────────────────────────
  'reader.back': 'Back to the library',
  'reader.backLabel': 'Library',
  'reader.navToggle': 'Page navigation',
  'reader.help': 'Help',
  'reader.prev': 'Back',
  'reader.next': 'Forward',
  'reader.zoom': 'Enlarge the page',
  'reader.finishCue': 'Finished? Close the book',
  'reader.loading': 'Loading…',
  'reader.page': 'Page',
  'reader.goToPage': 'Go to page',

  // ── Help ─────────────────────────────────────────────────────────────
  'help.prev': 'Back',
  'help.next': 'Next',
  'help.hold.mouse': 'Hold the left mouse button down: point at the page',
  'help.hold.touch': 'Hold your finger down: point at the page',
  'help.hold.sub': 'while reading together',
  'help.tap.mouse': 'Click briefly in the middle: show and hide the bar',
  'help.tap.touch': 'Tap briefly in the middle: show and hide the bar',
  'help.zoom': 'Enlarge the page',
  'help.zoom.mouse': 'enlarged: move it with the mouse',
  'help.zoom.touch': 'enlarged: move it with your finger',
  'help.chrome.back': 'Back to the library',
  'help.chrome.sync': 'Read together',
  'help.chrome.nav': 'Page turning on / off',
  'help.chrome.jump': 'Jump to a page',

  // ── The ritual at the end of a book ──────────────────────────────────
  'mood.boardTitle': 'How was the book?',
  'mood.warningThree': 'Three people here. Only the children choose feelings.',
  'mood.remaining': { one: 'Choose {n} feeling.', other: 'Choose {n} feelings.' },
  'mood.waiting': 'Waiting for the other one …',
  'mood.end': 'The end',
  'mood.shelf': 'Put the book on the shelf',
  'mood.result': 'Your feelings',
  'mood.row.ours': 'We',
  'mood.row.mine': 'I',
  'mood.row.theirs': 'You',
  'mood.row.yours': 'You both',

  // ── Camera ───────────────────────────────────────────────────────────
  'camera.strip': 'Photographed pages',
  'camera.shutter': 'Take a photo',
  'camera.gallery': 'Choose from gallery',
  'camera.discarded': 'Photo discarded.',
  'camera.viewPhoto': 'View photo',
  'camera.pageTitle': 'Page {n}',
  'camera.unsupported': 'The camera is not supported on this device.',
  'camera.noAccess': 'No access to the camera. You can choose photos from the gallery instead.',
  'camera.save.title': 'Save the book',
  'camera.save.field': 'Title of the book:',
  'camera.saving': 'Saving…',
  'camera.saveFailed': 'The book could not be saved.',
  'camera.discardAll.title': 'Discard these photos?',
  'camera.discardAll.message': 'The photos will be lost.',
  'camera.defaultTitle': 'Photo book {date}',

  // ── Titles stamped when something is created ─────────────────────────
  'title.untitled': 'Untitled',
  'title.imported': 'Imported book',
  'title.exportFilename': 'book',

  // ── What is read off the title page ──────────────────────────────────
  // English needs no plural here, so a plain string does the job where German
  // carries two forms.
  'pdf.ageTag': 'Age {n} and up',

  // ── Errors on files and books ────────────────────────────────────────
  'error.bookNotFound': 'Book not found.',
  'error.pdfMissing': 'The PDF file is missing.',
  'error.pageMissing': 'Page {n} is missing.',
  'error.unreadable': 'The file cannot be read.',
  'error.manifestMissing': 'Invalid file: manifest missing.',
  'error.manifestCorrupt': 'Invalid file: manifest damaged.',
  'error.foreignFile': 'This file does not come from the Vorlese-App.',
  'error.unknownFormat': 'The file has an unknown or too recent format.',
  'error.badPageCount': 'The file contains an invalid page count.',
  'error.pageMissingInBundle': 'Page {n} is missing from the bundle.',
  'error.pdfMissingInBundle': 'The PDF is missing from the bundle.',
  'error.pdfCorruptInBundle': 'The PDF in the bundle is damaged.',
  'error.unknownBookType': 'Unknown book type: {type}',

  // ── The names of the feeling pictures ────────────────────────────────
  // Never printed on the board (ADR 12) — these are the accessible name of the
  // button and the `alt` of the keepsake tile, which makes them the whole
  // ritual for a reader who cannot see the drawing.
  //
  // Written from the drawing briefs in doc/mood-icon-descriptions.txt rather
  // than from the German, so each name answers the picture directly. Register
  // matches the German: short, concrete, child-facing — the word a six-year-old
  // would reach for, not the accurate one an adult would.
  'moodLabel.crash-and-still-grinning': 'Happy anyway',
  'moodLabel.determined-chin-up': 'Now more than ever',
  'moodLabel.tummy-butterflies': 'Butterflies',
  'moodLabel.mischief-brewing': 'Up to mischief',
  'moodLabel.wide-eyed-wonder': 'Wonder',
  'moodLabel.righteous-stomp': 'That’s not fair!',
  'moodLabel.slumped-low': 'So sad',
  'moodLabel.fist-in-the-air': 'Did it!',
  'moodLabel.sneaky-and-alert': 'Quiet and watchful',
  'moodLabel.cozy-pile': 'Snuggled up',
  'moodLabel.gloriously-dizzy': 'Wonderfully muddled',
  'moodLabel.quiet-listening': 'All ears',
  'moodLabel.fizzing-excitement': 'Excited',
  'moodLabel.brave-but-wobbly': 'Brave but wobbly',
  'moodLabel.puffed-cheek-exhale': 'Relieved',
  'moodLabel.lip-out-sulk': 'Sulking',
  'moodLabel.contained-glow': 'Secretly pleased',
  'moodLabel.silly-serious': 'Straight face',
  'moodLabel.watery-smile': 'Smiling through tears',
  'moodLabel.arms-wide-free': 'Free and light',
  'moodLabel.lachkrampf': 'Giggle fit',
  'moodLabel.peeking-through-fingers': 'Peeking through fingers',
  'moodLabel.clutched-close-feeling': 'Held close',
  'moodLabel.one-more-please': 'Please read on!',
  'moodLabel.melting-sleepy': 'Sleepy and safe',
  'moodLabel.hmmm-not-sure': 'Not quite convinced',
  'moodLabel.thats-too-much': 'Too much at once',
  'moodLabel.on-the-edge-lean': 'On the edge of my seat',
  'moodLabel.slow-nod-of-getting-it': 'Ah, I get it',
  'moodLabel.warm-and-full': 'Warm and content',
  'moodLabel.secretly-moved': 'Secretly moved',
  'moodLabel.again-from-the-start': 'Again from the start!',
  'moodLabel.scary-shivers': 'Lovely shivers',
  'moodLabel.gleeful-yuck': 'Gloriously yucky',
  'moodLabel.real-tears': 'Real tears',
  'moodLabel.lost-the-thread': 'Lost the thread',
  'moodLabel.politely-elsewhere': 'Miles away',
  'moodLabel.jaw-drop-twist': 'Never saw that coming!',
  'moodLabel.kiss-across-the-miles': 'A kiss across the miles',
  'moodLabel.proud-of-you': 'Proud of you',
  'moodLabel.peering-out-from-hiding': 'Rather stay hidden',
  'moodLabel.hands-over-the-ears': 'Ears covered!',
  'moodLabel.the-hot-whole-body-no': 'Really cross',
  'moodLabel.holding-back-the-tears': 'Holding back tears',
  'moodLabel.one-big-brave-breath': 'One big brave breath',
  'moodLabel.hand-across-the-distance': 'A hand across the distance',
  'moodLabel.thumbs-up-for-you': 'Thumbs up for you',
};
