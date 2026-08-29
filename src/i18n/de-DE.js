// Deutschland und Österreich. Trägt ausschliesslich die Werte, die sich von der
// Schweizer Quelle in src/i18n/de.js unterscheiden — alles andere fällt eine
// Stufe tiefer und kommt von dort (die Kette steht in i18n.js).
//
// Zwei Unterschiede, und beide sind Typografie, nicht Wortwahl:
//
//   * Anführungszeichen: „…" statt «…». U+201E unten, U+201C oben.
//   * ß statt ss, wo die Regel es verlangt: schließen, vergrößern, heißt.
//
// Nicht jedes ss wird zu ß. „Kuss", „lass", „muss", „passt" und „stattdessen"
// behalten es auch in Deutschland — nach kurzem Vokal steht ss, nach langem und
// nach Diphthong ß. Diese Datei zählt die betroffenen Wörter deshalb einzeln
// auf, statt sie einer Regel zu überlassen, die sie mitreissen würde.
//
// Registriert ist sie unter `de-de` und `de-at`: Österreich schreibt wie
// Deutschland, und ein eigenes File dafür wäre dieselbe Datei zweimal.
//
// Wer in de.js einen neuen Text mit Anführungszeichen oder einem der fünf
// Wörter oben anlegt, braucht hier eine Zeile dazu. Vergisst er sie, zeigt die
// App in Deutschland den Schweizer Wortlaut — sichtbar falsch gesetzt, aber
// nie leer.

export const deDE = {
  // ── Anführungszeichen und Rechtschreibung ───────────────
  'sync.otherBook.message': 'Dieser Lese-Code gehört zu „{title}“. Gemeinsam lesen heißt, zu diesem Buch zu wechseln. Jetzt öffnen?',

  // ── Nur die Anführungszeichen ───────────────────────────
  'library.book.moods': 'Gefühle zu „{title}“ ansehen',
  'library.disconnected': 'Ihr lest „{title}“ nicht mehr gemeinsam.',
  'library.delete.question': '„{title}“ wirklich löschen?',
  'library.import.unsupported': '„{name}“ ist kein unterstütztes Format. Bitte eine PDF- oder .vorlese-Datei wählen.',
  'library.import.imported': '„{title}“ importiert.',
  'library.import.unreadable': '„{name}“ konnte nicht gelesen werden.',
  'transfer.message': '„{title}“ wird von deinem Lesepartner gesendet…',

  // ── Nur die Rechtschreibung ─────────────────────────────
  'common.close': 'Schließen',
  'reader.zoom': 'Seite vergrößern',
  'reader.finishCue': 'Fertig? Buch schließen',
  'help.zoom': 'Seite vergrößern',
  'help.zoom.mouse': 'vergrößert: mit der Maus verschieben',
  'help.zoom.touch': 'vergrößert: mit dem Finger verschieben',
};
