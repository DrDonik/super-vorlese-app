// Dänisch. Vollständig, also kein Variantenwörterbuch wie de-DE.js: Dänisch
// wird in einem Land geschrieben, und `da-DK` fällt in der Kette von selbst auf
// `da` (siehe i18n.js). Ein zweites File für Dänemark gäbe es nichts zu sagen.
//
// Die Kommentare stehen auf Deutsch, obwohl en.js seine auf Englisch hat: sie
// sind für den, der die Datei pflegt, und das ist derselbe Betreiber wie bei
// de.js. Ein dänischer Kommentarblock wäre für die einzige Person unlesbar, die
// hier je etwas ändert.
//
// ADR 15 verlangt einen Namen für die Tätigkeit, einen für den Code und einen
// für die andere Person, alle am Buch verankert und nie ein „Raum". Für
// Dänisch:
//
//   „Gemeinsam lesen"       → „Læs sammen"
//   „Lese-Code"             → „læsekode"
//   „Lese-Code des Buches"  → „bogens læsekode"
//   „Lesepartner"           → „læsemakker"
//   „Verbinden" / „Trennen" → „Forbind" / „Afbryd"
//
// „læsekode" ist neun Zeichen und drei Silben — ein Grosselternteil liest es am
// Telefon vor, ein Sechsjähriger spricht es nach, und es steht auf Knöpfen, die
// ADR 23 als erste bittet, ihre Wörter aufzugeben. „læsemakker" ist in
// dänischen Schulen der eingeführte Ausdruck fürs paarweise Lesen und damit
// wärmer als das wörtliche „læsepartner". „Afbryd" kollidiert nicht mit
// „Annuller" (common.cancel), und im Dialog, in dem es steht, gibt es kein
// Abbrechen.
//
// Anführungszeichen sind »…«, Guillemets mit den Spitzen nach aussen — genau
// andersherum als das Schweizer «…» in de.js. Acht Werte fassen damit einen
// Buchtitel oder Dateinamen ein. Einen Apostroph kennt das Dänische hier nicht:
// der Genitiv ist ein blankes -s („bogens læsekode").
//
// Daraus folgt dieselbe Regel wie in jedem dieser Wörterbücher, und sie ist die
// einzige harte: nie " < > in einem Wert. Ein Teil dieser Texte wird in
// Vorlagen-Literale eingesetzt (Knopfnamen, aria-labels).
//
// Plural: Dänisch hat `one` und `other` wie Deutsch. Die zählende Variable
// heisst immer `n`, andere Platzhalter stehen als `{name}` im Text. `pdf.ageTag`
// braucht wie im Englischen gar keine Formen — „år" ist unveränderlich.

export const da = {
  // ── Wiederkehrende Wörter ────────────────────────────────────────────
  'common.ok': 'OK',
  'common.cancel': 'Annuller',
  'common.close': 'Luk',
  'common.done': 'Færdig',
  'common.add': 'Tilføj',
  'common.save': 'Gem',
  'common.undo': 'Fortryd',
  // „Kassér" und nicht „Slet": gelöscht wird ein Buch, verworfen ein Foto, das
  // noch nirgends steht. Die Kamera sagt unten dasselbe Wort.
  'common.discard': 'Kassér',
  'common.input': 'Indtastning',
  'common.or': '— eller —',
  'common.pages': { one: '{n} side', other: '{n} sider' },

  // ── Bibliothek ───────────────────────────────────────────────────────
  'library.title': 'Bibliotek',
  'library.photograph': 'Tag billeder',
  'library.import': 'Importér',
  'library.sortGroup': 'Sortér bøger',
  'library.filterGroup': 'Filtrér bøger',
  'library.dropTarget': 'Slip en PDF her',

  'library.sort.opened': 'Sidst læst',
  // „A–Å" und nicht „A–Z": das dänische Alphabet endet auf Å, und der
  // Intl.Collator hinter dieser Sortierung stellt Æ Ø Å auch wirklich dorthin.
  // Ein „A–Z" auf dem Knopf würde drei Buchstaben unterschlagen, die im Regal
  // sichtbar hinter dem Z stehen.
  'library.sort.title': 'A–Å',
  'library.sort.added': 'Tilføjet',

  'library.filter.done': 'Allerede læst',
  'library.filter.open': 'Ikke læst endnu',

  'library.empty.title': 'Ingen bøger endnu.',
  'library.empty.body': 'Tag billeder af nogle sider, eller hent en PDF. Når I læser sammen, sender din læsemakker bogen til dig.',
  'library.empty.dropHint': 'Du kan også bare trække en PDF herind.',

  'library.noMatch.title': 'Ingen bog passer til alle filtrene.',
  'library.noMatch.body': 'Tryk på et af filtrene ovenfor for at slå det fra igen.',

  'library.book.open': 'Åbn {title}',
  'library.book.readTogether': 'Læs {title} sammen',
  'library.book.moods': 'Se følelserne til »{title}«',
  'library.book.edit': 'Redigér bogen',

  'library.disconnected': 'I læser ikke længere »{title}« sammen.',
  'library.titleSaveFailed': 'Den nye titel kunne ikke gemmes.',
  'library.deleteFailed': 'Bogen kunne ikke slettes.',

  'library.delete.title': 'Slet bogen',
  'library.delete.confirm': 'Slet',
  'library.delete.question': 'Vil du virkelig slette »{title}«?',
  // „går tabt" ist dasselbe Wort wie in der Kamera („Billederne går tabt."),
  // damit die App denselben Verlust einmal benennt (Regel 1).
  'library.delete.evenings': {
    one: 'En fælles aften går tabt med den.',
    other: '{n} fælles aftener går tabt med den.',
  },

  'library.import.unsupported': '»{name}« er ikke et understøttet format. Vælg en PDF- eller .vorlese-fil.',
  'library.import.reading': 'Importerer {name}…',
  'library.import.imported': '»{title}« er importeret.',
  'library.import.failed': 'Importen mislykkedes: {error}',
  'library.import.processing': 'Behandler {index}/{total}: {name}…',
  'library.import.unreadable': '»{name}« kunne ikke læses.',

  // ── Buch bearbeiten ──────────────────────────────────────────────────
  'bookEdit.title': 'Redigér bogen',
  'bookEdit.titleField': 'Titel',
  'bookEdit.tags': 'Tags',
  'bookEdit.newTag': 'Nyt tag',
  'bookEdit.newTagLabel': 'Tilføj et nyt tag',
  'bookEdit.tagsSaveFailed': 'Dine tags kunne ikke gemmes.',
  // „bogens" fällt weg: das ist der Dialog des Buches, und die Zeile steht in
  // einer Spalte von Rubriken, die alle sagen, was darunter steht.
  'bookEdit.syncCode': 'Læsekode',
  // Das Gegenstück zu „Forbind" im Sync-Panel. Die Rubrik direkt darüber nennt
  // den Code und zeigt ihn, also braucht der Knopf kein eigenes Substantiv —
  // und „Slet" darf hier nicht stehen, weil einen Blick weiter „Slet bogen" den
  // ganzen Abend mitnimmt (Regel 5).
  'bookEdit.disconnect': 'Afbryd',
  'bookEdit.delete': 'Slet bogen',

  // ── Gemeinsam lesen ──────────────────────────────────────────────────
  'sync.activity': 'Læs sammen',
  'sync.code': 'Læsekode',
  'sync.codeOfBook': 'Bogens læsekode',
  'sync.tileHint': 'Skriv en læsekode og læs med',
  'sync.selectPrompt': 'Vælg den bog, I vil læse',

  'sync.start.message': 'En af jer laver koden og læser den op for den anden i telefonen.',
  'sync.start.selectBook': 'Vælg en bog og lav en kode',
  'sync.joinLabel': 'Har du fået en læsekode af din læsemakker?',
  'sync.connect': 'Forbind',

  'sync.panel.desc': 'For at I kan se den samme side, skal I begge have bogens læsekode.',
  'sync.panel.create': 'Lav en læsekode',
  'sync.codeHint': 'Læs den op for din læsemakker i telefonen.',

  'sync.ended': 'I læser ikke længere sammen.',
  'sync.connectFailed': 'Forbindelsen mislykkedes.',
  'sync.connectFailedRetry': 'Forbindelsen mislykkedes. Prøv igen.',
  'sync.bookLoading': 'Bogen indlæses stadig. Vent et øjeblik.',

  // {n} ist die Codelänge aus sync.js, damit der Satz mitwandert, falls sie
  // sich je ändert.
  'sync.error.length': 'En læsekode består af {n} tegn.',
  'sync.error.unknown': 'Den læsekode findes ikke.',
  'sync.error.noFreeCode': 'Der kunne ikke laves en læsekode. Prøv igen.',

  'sync.otherBook.title': 'En anden bog',
  'sync.otherBook.message': 'Den læsekode hører til »{title}«. At læse sammen betyder at skifte til den bog. Vil du åbne den nu?',
  'sync.otherBook.confirm': 'Åbn bogen',
  'sync.otherBook.untitled': 'en anden bog',

  // ── Ein Buch kommt über die Leitung ──────────────────────────────────
  'transfer.title': 'Bogen hentes',
  'transfer.message': '»{title}« sendes af din læsemakker…',
  'transfer.untitled': 'Bogen',
  'transfer.saving': 'Bogen gemmes…',
  'transfer.corrupt.title': 'Overførslen er beskadiget',
  'transfer.corrupt.message': 'Bogen, der kom frem, var ufuldstændig eller beskadiget. Prøv igen.',
  'transfer.failed.title': 'Kan ikke forbinde',
  'transfer.failed.message': 'Din læsemakker skal have appen åben og bogen åben. Prøv så igen.',
  'transfer.unsupported': 'Den læsekode kan endnu ikke sende bøger. Bed din læsemakker om at lave en ny læsekode.',

  // ── Leser ────────────────────────────────────────────────────────────
  'reader.back': 'Tilbage til biblioteket',
  // Das Wort neben dem Pfeil, das auf einem schmalen Bildschirm wegfällt
  // (ADR 23) — deshalb steht es getrennt vom Namen des Knopfes darüber.
  'reader.backLabel': 'Bibliotek',
  'reader.navToggle': 'Sidenavigation',
  'reader.help': 'Hjælp',
  'reader.prev': 'Tilbage',
  'reader.next': 'Frem',
  'reader.zoom': 'Forstør siden',
  'reader.finishCue': 'Færdig? Luk bogen',
  'reader.loading': 'Indlæser…',
  'reader.page': 'Side',
  'reader.goToPage': 'Gå til side',

  // ── Hilfe ────────────────────────────────────────────────────────────
  // „Tilbage / Videre" statt „Tilbage / Frem" wie an den Blätterzonen: hier
  // stehen die beiden Wörter nebeneinander und müssen als Paar lesbar sein.
  'help.prev': 'Tilbage',
  'help.next': 'Videre',
  'help.hold.mouse': 'Hold venstre museknap nede: peg på siden',
  'help.hold.touch': 'Hold fingeren nede: peg på siden',
  'help.hold.sub': 'når I læser sammen',
  'help.tap.mouse': 'Klik kort i midten: vis og skjul bjælken',
  'help.tap.touch': 'Tryk kort i midten: vis og skjul bjælken',
  'help.zoom': 'Forstør siden',
  'help.zoom.mouse': 'forstørret: flyt den med musen',
  'help.zoom.touch': 'forstørret: flyt den med fingeren',
  'help.chrome.back': 'Tilbage til biblioteket',
  'help.chrome.sync': 'Læs sammen',
  'help.chrome.nav': 'Bladring til / fra',
  'help.chrome.jump': 'Hop til en side',

  // ── Das Ritual am Ende eines Buches ──────────────────────────────────
  'mood.boardTitle': 'Hvordan var bogen?',
  'mood.warningThree': 'Tre personer er med. Kun børnene vælger følelser.',
  'mood.remaining': { one: 'Vælg {n} følelse.', other: 'Vælg {n} følelser.' },
  'mood.waiting': 'Venter på den anden …',
  'mood.end': 'Slut',
  'mood.shelf': 'Stil bogen på hylden',
  'mood.result': 'Jeres følelser',
  // Die Zeilen der Enthüllung. „Vi" steht oben, weil der Moment um das
  // Gemeinsame herum gebaut ist; „I" ist dasselbe aus der Sicht des
  // Grosselternteils, das zwei Kindern vorliest (Issue #82).
  'mood.row.ours': 'Vi',
  'mood.row.mine': 'Jeg',
  'mood.row.theirs': 'Du',
  'mood.row.yours': 'I',

  // ── Kamera ───────────────────────────────────────────────────────────
  'camera.strip': 'Fotograferede sider',
  'camera.shutter': 'Tag et billede',
  'camera.gallery': 'Vælg fra galleriet',
  'camera.discarded': 'Billedet er kasseret.',
  // „Se billedet" und nicht „Se side 3": die Seitenzahl wandert, wenn Fotos
  // verworfen werden. Die Vorschau nennt die Seite stattdessen selbst.
  'camera.viewPhoto': 'Se billedet',
  'camera.pageTitle': 'Side {n}',
  'camera.unsupported': 'Kameraet understøttes ikke på denne enhed.',
  'camera.noAccess': 'Ingen adgang til kameraet. Du kan vælge billeder fra galleriet i stedet.',
  'camera.save.title': 'Gem bogen',
  'camera.save.field': 'Bogens titel:',
  'camera.saving': 'Gemmer…',
  'camera.saveFailed': 'Bogen kunne ikke gemmes.',
  'camera.discardAll.title': 'Vil du kassere billederne?',
  'camera.discardAll.message': 'Billederne går tabt.',
  // {date} ist ein Zeitstempel in Ziffern, damit die Bücher eines Abends
  // beieinander stehen. Wird als Titel gespeichert und danach nicht mehr
  // übersetzt — ab dann gehört er dem Buch.
  'camera.defaultTitle': 'Fotobog {date}',

  // ── Titel, die beim Anlegen gestempelt werden ────────────────────────
  'title.untitled': 'Uden titel',
  'title.imported': 'Importeret bog',
  'title.exportFilename': 'bog',

  // ── Was auf der Titelseite steht ─────────────────────────────────────
  // „år" ist unveränderlich, also tut wie im Englischen ein einfacher String
  // die Arbeit, für die das Deutsche zwei Formen braucht.
  'pdf.ageTag': 'Fra {n} år',

  // ── Fehler an Dateien und Büchern ────────────────────────────────────
  'error.bookNotFound': 'Bogen blev ikke fundet.',
  'error.pdfMissing': 'PDF-filen mangler.',
  'error.pageMissing': 'Side {n} mangler.',
  'error.unreadable': 'Filen kan ikke læses.',
  'error.manifestMissing': 'Ugyldig fil: manifestet mangler.',
  'error.manifestCorrupt': 'Ugyldig fil: manifestet er beskadiget.',
  'error.foreignFile': 'Denne fil kommer ikke fra Vorlese-App.',
  'error.unknownFormat': 'Filen har et ukendt eller for nyt format.',
  'error.badPageCount': 'Filen indeholder et ugyldigt sidetal.',
  'error.pageMissingInBundle': 'Side {n} mangler i pakken.',
  'error.pdfMissingInBundle': 'PDF-filen mangler i pakken.',
  'error.pdfCorruptInBundle': 'PDF-filen i pakken er beskadiget.',
  'error.unknownBookType': 'Ukendt bogtype: {type}',

  // ── Die Namen der Gefühls-Bilder ─────────────────────────────────────
  // Auf dem Brett steht keiner dieser Namen (ADR 12) — die Zeichnung ist ein
  // Anstoss, kein Vokabular. Sie sind der zugängliche Name des Knopfes und das
  // `alt` der Erinnerungs-Kachel, also alles, was jemand hört, der die
  // Zeichnung nicht sieht.
  //
  // Geschrieben aus den Zeichnungs-Briefs in doc/mood-icon-descriptions.txt,
  // nicht aus dem Deutschen oder Englischen, damit jeder Name direkt auf sein
  // Bild antwortet statt auf eine Übersetzung davon. Register wie dort:
  // kindgerecht, konkret, gefühlsgenau.
  'moodLabel.crash-and-still-grinning': 'Glad alligevel',
  'moodLabel.determined-chin-up': 'Giver ikke op',
  'moodLabel.tummy-butterflies': 'Sommerfugle i maven',
  'moodLabel.mischief-brewing': 'Op til ballade',
  'moodLabel.wide-eyed-wonder': 'Hold da op!',
  'moodLabel.righteous-stomp': 'Det er ikke fair!',
  'moodLabel.slumped-low': 'Helt ked af det',
  'moodLabel.fist-in-the-air': 'Jeg klarede det!',
  'moodLabel.sneaky-and-alert': 'Stille og på vagt',
  'moodLabel.cozy-pile': 'Hyggeligt sammen',
  'moodLabel.gloriously-dizzy': 'Dejligt forvirret',
  'moodLabel.quiet-listening': 'Lytter godt efter',
  'moodLabel.fizzing-excitement': 'Helt spændt',
  'moodLabel.brave-but-wobbly': 'Modig, men rystende',
  'moodLabel.puffed-cheek-exhale': 'Lettet',
  'moodLabel.lip-out-sulk': 'Fornærmet',
  'moodLabel.contained-glow': 'Hemmelig glæde',
  // „at holde masken" ist auf Dänisch genau das, was das Bild zeigt: die Miene
  // bewahren, während ringsum Unsinn passiert.
  'moodLabel.silly-serious': 'Holder masken',
  'moodLabel.watery-smile': 'Smiler med tårer',
  'moodLabel.arms-wide-free': 'Fri og let',
  'moodLabel.lachkrampf': 'Latterkrampe',
  // Nicht „kigger gennem fingrene": das heisst auf Dänisch ein Auge zudrücken,
  // also etwas durchgehen lassen. „frem mellem" rettet die Geste des Bildes.
  'moodLabel.peeking-through-fingers': 'Kigger frem mellem fingrene',
  'moodLabel.clutched-close-feeling': 'Tæt ind til hjertet',
  'moodLabel.one-more-please': 'Læs videre!',
  'moodLabel.melting-sleepy': 'Træt og tryg',
  'moodLabel.hmmm-not-sure': 'Ikke helt overbevist',
  'moodLabel.thats-too-much': 'For meget på én gang',
  'moodLabel.on-the-edge-lean': 'På kanten af stolen',
  'moodLabel.slow-nod-of-getting-it': 'Nåh, nu forstår jeg',
  'moodLabel.warm-and-full': 'Varm og tilfreds',
  'moodLabel.secretly-moved': 'Hemmeligt rørt',
  'moodLabel.again-from-the-start': 'Om igen fra starten!',
  'moodLabel.scary-shivers': 'Dejligt uhyggeligt',
  'moodLabel.gleeful-yuck': 'Føj, hvor klamt!',
  'moodLabel.real-tears': 'Rigtige tårer',
  'moodLabel.lost-the-thread': 'Har tabt tråden',
  'moodLabel.politely-elsewhere': 'Langt væk i tankerne',
  'moodLabel.jaw-drop-twist': 'Det så jeg ikke komme!',
  'moodLabel.kiss-across-the-miles': 'Kys over afstanden',
  'moodLabel.proud-of-you': 'Stolt af dig',
  'moodLabel.peering-out-from-hiding': 'Helst i skjul',
  'moodLabel.hands-over-the-ears': 'Hænderne for ørerne',
  'moodLabel.the-hot-whole-body-no': 'Helt vildt sur',
  'moodLabel.holding-back-the-tears': 'Holder tårerne tilbage',
  'moodLabel.one-big-brave-breath': 'Tager en dyb indånding',
  'moodLabel.hand-across-the-distance': 'Hånd over afstanden',
  'moodLabel.thumbs-up-for-you': 'Tommel op til dig',
};
