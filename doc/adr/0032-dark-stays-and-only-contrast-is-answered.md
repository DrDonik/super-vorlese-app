# 32. The palette stays dark, and the only display preference it answers is contrast

Date: 2026-08-22

## Status

Accepted

## Context

Das Universal-Design-Audit hat unter #126 drei Dinge in ein Issue geschrieben:
die App hat keinen Hellmodus, sie wertet `prefers-contrast` nicht aus, und sie
ist unter den Kontrastdesigns von Windows (`forced-colors`) nie geprüft worden.
Sie sehen zusammengehörig aus — alle drei sind Darstellungspräferenzen des
Geräts — kosten aber sehr verschieden viel und nützen sehr verschieden viel.

`src/style.css` setzte `color-scheme: dark` und eine feste Palette;
[ADR 4](0004-interactive-color-scheme.md) hat jeder Farbe darin ihre eine
Aufgabe gegeben.

**Zum Hellmodus** lautete der Einwand: helle Schrift auf Schwarz verträgt sich
schlecht mit Alterssichtigkeit und Astigmatismus — also mit genau der Hälfte
der Zielgruppe, die vorliest. Fehlt ein Schalter, sei das keine Voreinstellung
mehr, sondern eine Festlegung. In dieser App trägt das Argument nicht weit:

- **Beim Lesen ist der Bildschirm ohnehin weiss.** Die Buchseite ist ein
  gerendertes PDF oder ein Foto, im Normalfall weisses Papier, und sie füllt
  den Schirm. Die Knöpfe darüber bleiben aus demselben Grund dunkles Glas (die
  Alpha-Begründung bei `--surface-glass` setzt weisse Seiten voraus). Der
  Dunkelmodus schützt das vorlesende Auge also nicht — er wirkt gar nicht dort,
  wo der Abend verbracht wird.
- **Er wirkt in der Bibliothek**, und die steht eine halbe Minute auf dem
  Schirm, bevor jemand ein Buch öffnet. Die Hauptinformation dort sind die
  Cover, und die tragen ihre eigenen Farben, gleich welche Palette darum liegt.
- **Der Preis wäre unverhältnismässig.** Ein zweiter Wertesatz für rund zehn
  Rollen, dazu die Triage von 66 Deklarationen mit Literalfarben: jede einzeln
  danach zu entscheiden, ob sie über der Seite liegt (bleibt) oder App-Chrome
  ist (wird variabel). Ohne Test und ohne Linter
  ([ADR 8](0008-no-tests-or-linter.md)) fällt nicht auf, wenn eine davon falsch
  einsortiert wird — und auffallen würde es dann jemandem, der gerade vorliest.

**`prefers-contrast: more`** ist der Gegenfall. Der Schalter dazu steckt auf dem
iPad unter Bedienungshilfen → Anzeige & Textgrösse → Kontrast erhöhen, auf dem
Mac und unter Windows ebenso; er ist für die Vorlesenden erreichbar und
liegt damit auf derselben Ebene wie die Schriftgrösse aus
[ADR 31](0031-type-follows-the-system-font-size.md), deren Auswertung schon aus
demselben Grund beschlossen wurde. Nachgemessen fällt die bestehende Palette
nirgends durch: `--fg-dim` steht auf `--bg` bei 7,3:1. Es geht hier also nicht
um einen Mangel, sondern um eine Bitte.

**`forced-colors: active`** ist etwas grundsätzlich anderes. Die Kontrastdesigns
von Windows ersetzen die Palette einer Seite vollständig durch die wenigen
Farben, die der Benutzer im Betriebssystem gewählt hat. ADR 4 fiele darin in
sich zusammen: Gelb („das schliesst ab"), Grün („verbunden") und Rot („das
löscht") würden dieselbe Systemfarbe — der Verlust wiegt für ein Kind, das
Farben liest, bevor es Wörter liest, am schwersten und lässt sich nicht
zurückholen. Reparierbar wären die Glas-Knöpfe (ein Rahmen in der Systemfarbe)
und das „?"-Overlay, dessen zwei hauchdünn aufgehellte Blätter-Zonen zu
volldeckenden Bändern über der Seite würden. Ein Punkt des Issues stimmt dabei
nicht: der Fokusring geht nicht verloren, er wird auf eine Systemfarbe
umgestellt.

Entscheidend ist aber, wo das überhaupt vorkommt. `forced-colors` gibt es nur
unter Windows im Browser; iOS, iPadOS und Android kennen den Zustand nicht.
Niemand im Kreis der Benutzer liest die App an einem Windows-Rechner, und aus
diesem Container ist der Zustand nicht herstellbar.

## Decision

**Die Palette bleibt dunkel, fest verdrahtet.** Kein Hellmodus, weder
automatisch über `prefers-color-scheme` noch als Schalter in der App. Der
Dunkelmodus ist damit ausdrücklich eine Festlegung und keine Voreinstellung —
getroffen, weil die Buchseite die eigentliche Lesefläche ist und die in jedem
Modus weiss bleibt.

**`prefers-contrast: more` wird ausgewertet**, als ein Block direkt unter
`:root`, der nur Werte überschreibt. Keine Regel kommt hinzu, kein Element
ändert Grösse oder Ort, und keine Rolle wechselt ihre Aufgabe aus ADR 4:

| Rolle | normal | mehr Kontrast | was daran besser wird |
| --- | --- | --- | --- |
| `--fg-dim` | `#a1a1a6` | `#d0d0d4` | Nebentext: 7,3:1 → 12,3:1 auf `--bg` |
| `--surface` | `#2c2c2e` | `#48484d` | Knopffüllung gegen den Grund: 1,35:1 → 2,1:1 |
| `--surface-line` | `#3a3a3c` | `#6d6d75` | Linien und Umrisse: 1,7:1 → 3,7:1 |
| `--surface-glass` | `rgba(0,0,0,.65)` | `rgba(0,0,0,.85)` | Knöpfe über weissem Papier: 6,4:1 → 13,9:1 |
| `--focus` | `#0a84ff` | `#4da3ff` | Fokusring über dem Glas: 4,2:1 → 5,8:1 |

Zwei Dinge daran sind bewusst so und nicht anders:

- **`--accent`, `--success` und `--danger` bleiben unangetastet.** Sie stehen
  bei 10,6:1, 9,3:1 und 5,5:1 und tragen jeweils Text auf ihrer eigenen Fläche.
  Ein helleres Gelb, Grün oder Rot würde diesen Text schlechter lesbar machen,
  nicht besser. Nur die leisen Rollen werden lauter.
- **Die Knopffüllung erreicht die 3:1 für eine Bedienelementgrenze weiterhin
  nicht.** Auf diesem Grund ginge das nur, indem der weisse Text auf der
  Füllung unter 4,5:1 fällt. Die Grenze trägt deshalb `--surface-line` — genau
  die Aufteilung, die `.filter-chip[aria-pressed='true']` schon im Normalfall
  vornimmt und dort auch begründet.

**`forced-colors` wird nicht bedient.** Nach der Logik von
[ADR 22](0022-accessibility-targets-low-vision-not-screen-readers.md) — eine
ungeprüfte Zusicherung ist schlechter als keine — wäre ein Block für einen
Zustand, den niemand im Kreis der Benutzer herstellt und den hier niemand
nachstellen kann, eine Behauptung ohne Deckung. Wer die Kontrastdesigns
benutzt und diese App will, kann sie forken.

## Consequences

- Wer sein Gerät wegen der Augen auf Hell gestellt hat, sieht davon in dieser
  App weiterhin nichts. Das ist die Festlegung, und sie ist an die Annahme
  gebunden, dass gelesene Bücher weisse Seiten haben. Ein Regal voll dunkler
  Bilderbücher wäre der Anlass, das hier neu aufzumachen.
- Wer den Kontrast am Gerät erhöht, bekommt dieselbe Oberfläche härter
  gezeichnet: Nebentext rückt an den Haupttext heran, Knöpfe und Pillen heben
  sich vom Grund ab, Haarlinien werden Linien, und die Knöpfe über der Buchseite
  werden nahezu deckend. Die Rangfolge zwischen Haupt- und Nebentext trägt dann
  Grösse und Ort statt Helligkeit — das ist der Handel, den dieser Schalter
  bedeutet.
- Bei normaler Einstellung ändert sich nichts. Der Block ist eine Media Query
  ohne eine einzige Regel ausserhalb; die Voreinstellung kann er nicht
  erreichen.
- Neue Farbwerte, die dazukommen, gehören in beide Sätze — oder in keinen. Eine
  neue Literalfarbe in einer Regel ist unter mehr Kontrast still wirkungslos,
  und wie bei ADR 31 fällt das ohne Linter niemandem auf. Die Prüfung ist ein
  Browser mit `prefers-contrast: more`.
- `prefers-color-scheme` und `forced-colors` sind hiermit beantwortet, nicht
  übersehen. Ein erneuter Durchlauf desselben Audits wird sie wieder melden;
  dann gilt dieser ADR und nicht der Befund.
