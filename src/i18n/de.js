// Deutsch — die Quellsprache. Jeder Schlüssel der App steht hier, und nur hier
// vollständig: Übersetzungen dürfen Lücken haben, diese Datei nicht (siehe
// i18n.js). Wer einen neuen Text in die App schreibt, schreibt ihn zuerst hier.
//
// Rechtschreibung ist schweizerisch: „ss" statt „ß", also „schliessen",
// „vergrössern", „heisst". Das gilt für alle `de-*`-Browser, auch für Berlin —
// die App ist für einen Haushalt gebaut, und der ist in der Schweiz.
//
// Die Anführungszeichen sind „…" (unten/oben), wie überall sonst im Projekt.
//
// Ein Wert ist entweder ein String oder ein Objekt mit Pluralformen nach den
// CLDR-Kategorien. Die zählende Variable heisst immer `n`; andere Platzhalter
// stehen als `{name}` im Text. Platzhalter, die in einer Sprache nicht
// vorkommen, dürfen wegfallen — ein Platzhalter ohne Wert bleibt dagegen sichtbar
// stehen, damit ein vergessenes Argument auffällt statt den Satz zu zerstören.
//
// Anführungszeichen sind hier — wie überall sonst im Projekt — „…" mit einem
// typografischen Zeichen unten und einem geraden oben. Das ist gewachsen und
// bleibt so, damit die App und ihr Quelltext dieselbe Schreibweise führen.
//
// Ein Teil dieser Texte wird als HTML eingesetzt (Knopfnamen, aria-labels in
// Vorlagen-Literalen), ein anderer über textContent oder setAttribute. Wer das
// nicht bei jedem Schlüssel nachsehen will, hält sich an zwei Regeln:
//
//   * Nie < oder > in einem Wert. Ausnahmslos.
//   * Ein Wert mit Anführungszeichen darf nur dort stehen, wo er über
//     textContent oder setAttribute geht. Das trifft heute auf alle acht
//     solchen Werte zu; wer einen neuen anlegt, prüft die Aufrufstelle.
//
// Zur Wortwahl beim gemeinsamen Lesen gilt ADR 15 in seiner Ergänzung vom
// 2026-08-29: die Tätigkeit heisst „Gemeinsam lesen", der Code „Lese-Code (des
// Buches)", die andere Person „Lesepartner", das Gegenstück zu „Verbinden"
// heisst „Trennen", und „Raum" kommt nirgends vor.

export const de = {
  // ── Wiederkehrende Wörter ────────────────────────────────────────────
  // Dieselbe Handlung heisst überall gleich (Regel 1), deshalb stehen die
  // Knopfbeschriftungen, die in mehreren Dialogen vorkommen, genau einmal.
  'common.ok': 'OK',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schliessen',
  'common.done': 'Fertig',
  'common.add': 'Hinzufügen',
  'common.save': 'Speichern',
  'common.undo': 'Rückgängig',
  'common.discard': 'Verwerfen',
  // Der Name, den ein Eingabefeld bekommt, wenn der Dialog ihm keinen gibt.
  'common.input': 'Eingabe',
  'common.or': '— oder —',
  // Der Umfang eines Buches, auf der Karte im Regal und im Zähler der Kamera.
  'common.pages': { one: '{n} Seite', other: '{n} Seiten' },

  // ── Bibliothek ───────────────────────────────────────────────────────
  'library.title': 'Bibliothek',
  // Ohne Emoji: das steht im Markup und ist in jeder Sprache dasselbe.
  'library.photograph': 'Fotografieren',
  'library.import': 'Importieren',
  'library.sortGroup': 'Bücher sortieren',
  'library.filterGroup': 'Bücher filtern',
  'library.dropTarget': 'PDF hier ablegen',

  'library.sort.opened': 'Zuletzt gelesen',
  'library.sort.title': 'A–Z',
  'library.sort.added': 'Hinzugefügt',

  'library.filter.done': 'Schon gelesen',
  'library.filter.open': 'Noch nicht gelesen',

  'library.empty.title': 'Noch keine Bücher.',
  'library.empty.body': 'Fotografiere Seiten oder lade ein PDF. Beim gemeinsamen Lesen bekommst du das Buch von deinem Lesepartner.',
  // Steht nur dort, wo die Geste existiert (siehe .empty-drop-hint).
  'library.empty.dropHint': 'Eine PDF kannst du auch einfach hierher ziehen.',

  'library.noMatch.title': 'Kein Buch passt zu allen Filtern.',
  'library.noMatch.body': 'Tippe oben auf einen der eingeschalteten Filter, um ihn wieder auszuschalten.',

  // Der Name des Öffnen-Knopfes, der die ganze Karte bedeckt. Im Auswahlmodus
  // sagt er, was ein Tippen jetzt wirklich tut — für Screenreader die einzige
  // Ankündigung, dass das Regal gerade ein Buch aussucht.
  'library.book.open': '{title} öffnen',
  'library.book.readTogether': '{title} gemeinsam lesen',
  'library.book.moods': 'Gefühle zu „{title}" ansehen',
  'library.book.edit': 'Buch bearbeiten',

  'library.disconnected': 'Ihr lest „{title}" nicht mehr gemeinsam.',
  'library.titleSaveFailed': 'Der neue Titel konnte nicht gespeichert werden.',
  'library.deleteFailed': 'Das Buch konnte nicht gelöscht werden.',

  'library.delete.title': 'Buch löschen',
  'library.delete.confirm': 'Löschen',
  'library.delete.question': '„{title}" wirklich löschen?',
  // „gehen verloren" ist dasselbe Wort wie in der Kamera („Die Fotos gehen
  // verloren."), damit die App denselben Verlust einmal benennt (Regel 1).
  'library.delete.evenings': {
    one: 'Ein gemeinsamer Abend geht damit verloren.',
    other: '{n} gemeinsame Abende gehen damit verloren.',
  },

  'library.import.unsupported': '„{name}" ist kein unterstütztes Format. Bitte eine PDF- oder .vorlese-Datei wählen.',
  'library.import.reading': 'Importiere {name}…',
  'library.import.imported': '„{title}" importiert.',
  'library.import.failed': 'Import fehlgeschlagen: {error}',
  'library.import.processing': 'Verarbeite {index}/{total}: {name}…',
  'library.import.unreadable': '„{name}" konnte nicht gelesen werden.',

  // ── Buch bearbeiten ──────────────────────────────────────────────────
  'bookEdit.title': 'Buch bearbeiten',
  'bookEdit.titleField': 'Titel',
  'bookEdit.tags': 'Tags',
  'bookEdit.newTag': 'Neuer Tag',
  'bookEdit.newTagLabel': 'Neuen Tag hinzufügen',
  'bookEdit.tagsSaveFailed': 'Die Tags konnten nicht gespeichert werden.',
  // „des Buches" fällt weg: das ist der Dialog des Buches, und die Zeile steht
  // in einer Spalte von Rubriken, die alle sagen, was darunter steht.
  'bookEdit.syncCode': 'Lese-Code',
  // Das Gegenstück zu „Verbinden" im Sync-Panel, und mehr braucht der Knopf
  // nicht: die Rubrik direkt darüber nennt den Code und zeigt ihn.
  'bookEdit.disconnect': 'Trennen',
  'bookEdit.delete': 'Buch löschen',

  // ── Gemeinsam lesen ──────────────────────────────────────────────────
  'sync.activity': 'Gemeinsam lesen',
  'sync.code': 'Lese-Code',
  'sync.codeOfBook': 'Lese-Code des Buches',
  'sync.tileHint': 'Lese-Code eingeben und mitlesen',
  'sync.selectPrompt': 'Wähle das Buch, das ihr lesen wollt',

  'sync.start.message': 'Einer von euch beiden erstellt den Code und sagt ihn dem anderen am Telefon.',
  'sync.start.selectBook': 'Buch auswählen und Code erstellen',
  'sync.joinLabel': 'Lese-Code von deinem Lesepartner bekommen?',
  'sync.connect': 'Verbinden',

  'sync.panel.desc': 'Damit ihr dieselbe Seite seht, braucht ihr beide den gleichen Lese-Code des Buches.',
  'sync.panel.create': 'Lese-Code erstellen',
  'sync.codeHint': 'Sag ihn deinem Lesepartner am Telefon.',

  'sync.ended': 'Ihr lest nicht mehr gemeinsam.',
  'sync.connectFailed': 'Verbindung fehlgeschlagen.',
  'sync.connectFailedRetry': 'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
  'sync.bookLoading': 'Buch wird noch geladen. Bitte warten.',

  // {n} ist die Codelänge aus sync.js, damit der Satz mitwandert, falls sie
  // sich je ändert.
  'sync.error.length': 'Der Lese-Code besteht aus {n} Zeichen.',
  'sync.error.unknown': 'Diesen Lese-Code gibt es nicht.',
  'sync.error.noFreeCode': 'Es konnte kein Lese-Code erstellt werden. Bitte erneut versuchen.',

  'sync.otherBook.title': 'Anderes Buch',
  'sync.otherBook.message': 'Dieser Lese-Code gehört zu „{title}". Gemeinsam lesen heisst, zu diesem Buch zu wechseln. Jetzt öffnen?',
  'sync.otherBook.confirm': 'Buch öffnen',
  // Wenn der Code zwar ein Buch nennt, aber keinen Titel dazu hat.
  'sync.otherBook.untitled': 'einem anderen Buch',

  // ── Ein Buch kommt über die Leitung ──────────────────────────────────
  'transfer.title': 'Buch wird geladen',
  'transfer.message': '„{title}" wird von deinem Lesepartner gesendet…',
  'transfer.untitled': 'Buch',
  'transfer.saving': 'Buch wird gespeichert…',
  'transfer.corrupt.title': 'Übertragung fehlerhaft',
  'transfer.corrupt.message': 'Das empfangene Buch war unvollständig oder beschädigt. Bitte versuche es erneut.',
  'transfer.failed.title': 'Verbindung nicht möglich',
  'transfer.failed.message': 'Dein Lesepartner muss die App offen haben und das Buch aufmachen. Bitte versuche es dann erneut.',
  'transfer.unsupported': 'Dieser Lese-Code unterstützt das Senden von Büchern noch nicht. Bitte lass deinen Lesepartner den Lese-Code neu erstellen.',

  // ── Leser ────────────────────────────────────────────────────────────
  'reader.back': 'Zurück zur Bibliothek',
  // Das Wort neben dem Pfeil, das auf einem schmalen Bildschirm wegfällt
  // (ADR 23) — deshalb steht es getrennt vom Namen des Knopfes darüber.
  'reader.backLabel': 'Bibliothek',
  'reader.navToggle': 'Seitennavigation',
  'reader.help': 'Hilfe',
  'reader.prev': 'Zurück',
  'reader.next': 'Vor',
  'reader.zoom': 'Seite vergrössern',
  'reader.finishCue': 'Fertig? Buch schliessen',
  'reader.loading': 'Lade…',
  // Steht im Seitenanzeiger vor den Zahlen und fällt auf dem Telefon weg.
  'reader.page': 'Seite',
  'reader.goToPage': 'Gehe zu Seite',

  // ── Hilfe ────────────────────────────────────────────────────────────
  // „Zurück / Weiter" statt „Zurück / Vor" wie an den Blätterzonen: hier stehen
  // die beiden Wörter nebeneinander und müssen als Paar lesbar sein.
  'help.prev': 'Zurück',
  'help.next': 'Weiter',
  'help.hold.mouse': 'Linke Maustaste gedrückt halten: auf die Seite zeigen',
  'help.hold.touch': 'Finger gedrückt halten: auf die Seite zeigen',
  'help.hold.sub': 'beim gemeinsamen Lesen',
  // „In die Mitte", weil die Ränder etwas anderes tun: links und rechts wird
  // geblättert, und ganz oben holt die Geste die Leiste nur hervor.
  'help.tap.mouse': 'Kurz in die Mitte klicken: Leiste ein- und ausblenden',
  'help.tap.touch': 'Kurz in die Mitte tippen: Leiste ein- und ausblenden',
  'help.zoom': 'Seite vergrössern',
  'help.zoom.mouse': 'vergrössert: mit der Maus verschieben',
  'help.zoom.touch': 'vergrössert: mit dem Finger verschieben',
  'help.chrome.back': 'Zurück zur Bibliothek',
  'help.chrome.sync': 'Gemeinsam lesen',
  'help.chrome.nav': 'Umblättern an / aus',
  'help.chrome.jump': 'Zu einer Seite springen',

  // ── Das Ritual am Ende eines Buches ──────────────────────────────────
  'mood.boardTitle': 'Wie war das Buch?',
  'mood.warningThree': 'Drei Personen anwesend. Nur die Kinder wählen Gefühle.',
  'mood.remaining': { one: 'Wähle {n} Gefühl.', other: 'Wähle {n} Gefühle.' },
  'mood.waiting': 'Warte auf den anderen …',
  'mood.end': 'Ende',
  'mood.shelf': 'Buch ins Regal stellen',
  'mood.result': 'Eure Gefühle',
  // Die Zeilen der Enthüllung. „Wir" steht oben, weil der Moment um das
  // Gemeinsame herum gebaut ist; „Ihr" ist dasselbe aus der Sicht des
  // Grosselternteils, das zwei Kindern vorliest (Issue #82).
  'mood.row.ours': 'Wir',
  'mood.row.mine': 'Ich',
  'mood.row.theirs': 'Du',
  'mood.row.yours': 'Ihr',

  // ── Kamera ───────────────────────────────────────────────────────────
  'camera.strip': 'Aufgenommene Seiten',
  'camera.shutter': 'Foto aufnehmen',
  'camera.gallery': 'Aus Galerie wählen',
  'camera.discarded': 'Foto verworfen.',
  // „Foto ansehen" und nicht „Seite 3 ansehen": die Seitenzahl wandert, wenn
  // Fotos verworfen werden. Die Vorschau nennt die Seite stattdessen selbst.
  'camera.viewPhoto': 'Foto ansehen',
  'camera.pageTitle': 'Seite {n}',
  'camera.unsupported': 'Kamera wird auf diesem Gerät nicht unterstützt.',
  'camera.noAccess': 'Kein Zugriff auf die Kamera. Du kannst stattdessen Fotos aus der Galerie wählen.',
  'camera.save.title': 'Buch speichern',
  'camera.save.field': 'Titel des Buches:',
  'camera.saving': 'Speichere…',
  'camera.saveFailed': 'Das Buch konnte nicht gespeichert werden.',
  'camera.discardAll.title': 'Aufnahme verwerfen?',
  'camera.discardAll.message': 'Die Fotos gehen verloren.',
  // {date} ist ein Zeitstempel in Ziffern, damit die Bücher eines Abends
  // beieinander stehen. Wird als Titel gespeichert und danach nicht mehr
  // übersetzt — ab dann gehört er dem Buch.
  'camera.defaultTitle': 'Foto-Buch {date}',

  // ── Titel, die beim Anlegen gestempelt werden ────────────────────────
  // Wie der Kamera-Titel oben: ab dem Speichern sind das Nutzerdaten und
  // wandern nicht mehr mit der Sprache.
  'title.untitled': 'Unbenannt',
  'title.imported': 'Importiertes Buch',
  'title.exportFilename': 'buch',

  // ── Was auf der Titelseite steht ─────────────────────────────────────
  // Die Altersempfehlung, von der ersten Seite gelesen (ADR 29). Wird als Tag
  // gespeichert, also ebenfalls in der Sprache des Imports.
  'pdf.ageTag': { one: 'Ab {n} Jahr', other: 'Ab {n} Jahren' },

  // ── Fehler an Dateien und Büchern ────────────────────────────────────
  'error.bookNotFound': 'Buch nicht gefunden.',
  'error.pdfMissing': 'PDF-Datei fehlt.',
  'error.pageMissing': 'Seite {n} fehlt.',
  'error.unreadable': 'Datei kann nicht gelesen werden.',
  'error.manifestMissing': 'Ungültige Datei: Manifest fehlt.',
  'error.manifestCorrupt': 'Ungültige Datei: Manifest beschädigt.',
  'error.foreignFile': 'Diese Datei stammt nicht aus der Vorlese-App.',
  'error.unknownFormat': 'Die Datei hat ein unbekanntes oder zu neues Format.',
  'error.badPageCount': 'Die Datei enthält eine ungültige Seitenanzahl.',
  'error.pageMissingInBundle': 'Seite {n} fehlt im Bundle.',
  'error.pdfMissingInBundle': 'PDF fehlt im Bundle.',
  'error.pdfCorruptInBundle': 'PDF im Bundle ist beschädigt.',
  'error.unknownBookType': 'Unbekannter Buch-Typ: {type}',

  // ── Die Namen der Gefühls-Bilder ─────────────────────────────────────
  // Nach `slug` geschlüsselt, nicht nach der numerischen id: die id reist über
  // die Leitung und muss stabil bleiben, der Name gehört der Sprache.
  //
  // Auf dem Brett steht keiner dieser Namen (ADR 12, Ergänzung vom
  // 2026-08-13) — die Zeichnung ist ein Anstoss, kein Vokabular, und ein
  // gedrucktes Wort würde das Bild schlagen. Sie sind der zugängliche Name des
  // Knopfes und das `alt` der Kachel, also das, was jemand hört, der das Bild
  // nicht sieht.
  //
  // Deshalb ist das hier die heikelste Stelle der ganzen Übersetzung: die
  // Wörter müssen kindgerecht, konkret und gefühlsgenau sein, nicht bloss
  // wörtlich richtig. Wer übersetzt, schaue sich das Bild dazu an
  // (public/mood-icons/<slug>.webp) und lese die Beschreibung in
  // doc/mood-icon-descriptions.txt.
  'moodLabel.crash-and-still-grinning': 'Trotzdem fröhlich',
  'moodLabel.determined-chin-up': 'Jetzt erst recht',
  'moodLabel.tummy-butterflies': 'Kribbeln im Bauch',
  'moodLabel.mischief-brewing': 'Schabernack',
  'moodLabel.wide-eyed-wonder': 'Staunen',
  'moodLabel.righteous-stomp': 'Das ist unfair!',
  'moodLabel.slumped-low': 'Ganz traurig',
  'moodLabel.fist-in-the-air': 'Geschafft!',
  'moodLabel.sneaky-and-alert': 'Leise und wachsam',
  'moodLabel.cozy-pile': 'Kuschelig',
  'moodLabel.gloriously-dizzy': 'Herrlich wirr',
  'moodLabel.quiet-listening': 'Gespanntes Lauschen',
  'moodLabel.fizzing-excitement': 'Aufgeregt',
  'moodLabel.brave-but-wobbly': 'Mutig, aber zittrig',
  'moodLabel.puffed-cheek-exhale': 'Erleichtert',
  'moodLabel.lip-out-sulk': 'Beleidigt',
  'moodLabel.contained-glow': 'Heimliche Freude',
  'moodLabel.silly-serious': 'Ernst trotz Quatsch',
  'moodLabel.watery-smile': 'Lächeln mit Tränen',
  'moodLabel.arms-wide-free': 'Frei und unbeschwert',
  'moodLabel.lachkrampf': 'Lachkrampf',
  'moodLabel.peeking-through-fingers': 'Durch die Finger geschaut',
  'moodLabel.clutched-close-feeling': 'Ans Herz gedrückt',
  'moodLabel.one-more-please': 'Bitte weiterlesen!',
  'moodLabel.melting-sleepy': 'Müde und geborgen',
  'moodLabel.hmmm-not-sure': 'Nicht ganz überzeugt',
  'moodLabel.thats-too-much': 'Zu viel auf einmal',
  'moodLabel.on-the-edge-lean': 'Mitgefiebert',
  'moodLabel.slow-nod-of-getting-it': 'Aha, verstanden',
  'moodLabel.warm-and-full': 'Wohlig zufrieden',
  'moodLabel.secretly-moved': 'Heimlich gerührt',
  'moodLabel.again-from-the-start': 'Nochmal von vorne!',
  'moodLabel.scary-shivers': 'Wohliges Gruseln',
  'moodLabel.gleeful-yuck': 'Herrlich eklig',
  'moodLabel.real-tears': 'Echte Tränen',
  'moodLabel.lost-the-thread': 'Den Faden verloren',
  'moodLabel.politely-elsewhere': 'Mit den Gedanken woanders',
  'moodLabel.jaw-drop-twist': 'Damit nicht gerechnet!',
  'moodLabel.kiss-across-the-miles': 'Kuss in die Ferne',
  'moodLabel.proud-of-you': 'Stolz auf dich',
  'moodLabel.peering-out-from-hiding': 'Lieber versteckt',
  'moodLabel.hands-over-the-ears': 'Ohren zu!',
  'moodLabel.the-hot-whole-body-no': 'Stinksauer',
  'moodLabel.holding-back-the-tears': 'Tränen verdrückt',
  'moodLabel.one-big-brave-breath': 'Tief durchgeatmet',
  'moodLabel.hand-across-the-distance': 'Hand in die Ferne',
  'moodLabel.thumbs-up-for-you': 'Daumen hoch für dich',
};
