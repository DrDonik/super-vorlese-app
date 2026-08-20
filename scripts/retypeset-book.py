#!/usr/bin/env python3
"""Setzt von einfachvorlesen.de geladene Bücher neu — siehe doc/adr/0028.

Zwei Schritte, damit Handkorrekturen einen Rebuild überleben:

    extract   PDF(s) -> buch.json + bilder/     (Struktur auslesen)
    build     buch.json -> buch.typ -> PDF      (neu setzen)

Zwischen beiden liegt buch.json. Wer eine Kapitelgrenze verschiebt, einen
Absatz zusammenzieht oder ein Bild umhängt, ändert dort — und `build` bleibt
beliebig oft wiederholbar.

Beispiele:

    python3 scripts/retypeset-book.py extract doc/books/downloads/moppi-*-teil-*.pdf
    python3 scripts/retypeset-book.py build doc/books/work/moppi-und-moehre --preview
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - Hinweis statt Traceback
    sys.exit("Fehlt: pymupdf. Installieren mit `pip3 install pymupdf`.")

REPO = Path(__file__).resolve().parent.parent
FONT_DIR = REPO / "scripts" / "fonts"
WORK_ROOT = REPO / "doc" / "books" / "work"
LIBRARY = REPO / "doc" / "books"

# ── Die Signatur der Quelle ────────────────────────────────────────────────
# einfachvorlesen.de setzt seine PDFs vollautomatisch und deshalb messerscharf
# uniform: die Schriftgröße allein sagt, was ein Element ist. Über alle 25
# vermessenen Bücher hinweg gilt das ausnahmslos.
SIZE_TITLE = 24  # Buchtitel, nur auf der Coverseite
SIZE_END = 20  # "Ende der Geschichte!" — Schlussseite mit Werbung
SIZE_HEADING = 16  # Kapitelüberschrift
SIZE_BODY = 14  # Fliesstext
SIZE_META = 12  # "Verlag: Carlsen" usw., nur auf der Coverseite
SIZE_CHROME = 10  # Kopf-/Fusszeile jeder Inhaltsseite
SIZE_FOOTER = 8  # Linkzeile der Schlussseite

# Zeilenabstand innerhalb eines Absatzes ist 20pt, zwischen Absätzen 30pt.
# Gemessen an 3182 Zeilenpaaren aus vier Büchern: keine Zwischenwerte.
PARAGRAPH_GAP = 25

# Das einfachvorlesen-Logo steht als 342x120px-Bild (76pt breit) auf jeder
# Inhaltsseite. Alles darunter ist Seitenschmuck, keine Illustration. Das
# Coverbild ist mit rund 160-220pt schmaler als die Illustrationen im Korpus,
# deshalb zwei Schwellen.
MIN_ILLUSTRATION_WIDTH = 200
MIN_COVER_WIDTH = 100

META_LABELS = {
    "Geschrieben von": "author",
    "Illustriert von": "illustrator",
    "Verlag": "publisher",
    "ISBN": "isbn",
    "Altersgruppe": "age",
}

# ── Seitenmaß ──────────────────────────────────────────────────────────────
# 18x24cm ist exakt 3:4 und trifft damit das 13" iPad Pro (2752x2064) hochkant
# randlos; auf dem 11" iPad bleibt etwas Luft oben und unten. Bei 2.2cm Rand
# bleiben 13.6cm Satzbreite, was mit Atkinson Hyperlegible (0.4537em je
# Zeichen, gemessen) bei 14pt auf 60.7 Zeichen je Zeile führt. Das Original
# hat 65.4 auf A4 — die kleinere Seite lässt den Text auf dem iPad rund ein
# Fünftel größer erscheinen.
PAGE_WIDTH_CM = 18.0
PAGE_HEIGHT_CM = 24.0
MARGIN_CM = 2.2
BODY_SIZE_PT = 14

# Die Illustrationen liegen im Original bei 90-155 dpi. Über ihre dortige
# Anzeigegröße hinaus vergrößert werden sie sichtbar weich, deshalb ist diese
# Größe die Obergrenze — die Seite ist ja ohnehin schmaler als das A4-Original.
MAX_IMAGE_WIDTH_CM = PAGE_WIDTH_CM - 2 * MARGIN_CM
PT_PER_CM = 28.3465


UMLAUTS = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"}


def slugify(text: str) -> str:
    for umlaut, replacement in UMLAUTS.items():
        text = text.replace(umlaut, replacement)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "buch"


# ── Extraktion ─────────────────────────────────────────────────────────────
def page_items(page, min_image_width=MIN_ILLUSTRATION_WIDTH):
    """Text- und Bildelemente einer Seite in Lesereihenfolge.

    PyMuPDF liefert Blöcke in Zeichenreihenfolge, nicht in Leserichtung — auf
    Seiten mit Illustration steht das Bild mal vor, mal nach dem Text. Nach der
    Oberkante sortiert stimmt die Reihenfolge.
    """
    items = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] == 1:
            x0, y0, x1, y1 = block["bbox"]
            if x1 - x0 < min_image_width:
                continue
            items.append(("img", y0, block["bbox"]))
            continue
        for line in block["lines"]:
            runs = line_runs(line)
            if not runs:
                continue
            size = round(line["spans"][0]["size"])
            items.append(("txt", line["bbox"][1], (size, runs)))
    items.sort(key=lambda item: item[1])
    return items


ITALIC_FLAG = 2  # PyMuPDF-Span-Flag


def span_style(span):
    """Kursiv und Medium eines Spans.

    Die Quelle hebt im Fließtext auf zwei Arten hervor: kursiv (135 Stellen —
    Betonungen, Lautmalerei, Verszeilen) und in der Schnitthöhe Medium (104
    Stellen — Gerufenes wie "Nein!" oder "PING!"). Wer vorliest, hört beides,
    also darf beim Auslesen keines verloren gehen. Echtes Fett kommt im
    Fließtext nirgends vor.

    Die Fontnamen sind in den PDFs unterschiedlich abgeschnitten — mal
    "…EV-RegularI", mal bloß "…EV-R" — deshalb kommt die Kursivlage aus den
    Flags und nur die Schnitthöhe aus dem Namen.
    """
    return bool(span["flags"] & ITALIC_FLAG), "-M" in span["font"]


def line_runs(line):
    """Zeile als Folge gleich ausgezeichneter Textstücke."""
    runs: list[dict] = []
    previous = None
    for span in line["spans"]:
        text = span["text"]
        if not text:
            continue
        italic, medium = span_style(span)

        # Zwei Quelldateien lassen an einer Stilgrenze das Leerzeichen weg und
        # zeigen dann "Dreck reinanstatt heraus!". Der Fehler steckt schon im
        # Original; beim Neusetzen wird er repariert, wenn die Spans auch
        # geometrisch lückenlos aneinanderstoßen.
        if (
            previous is not None
            and previous["text"][-1:].isalpha()
            and text[:1].isalpha()
            and span_style(previous) != (italic, medium)
            and abs(previous["bbox"][2] - span["bbox"][0]) < 1
        ):
            runs[-1]["t"] += " "

        if runs and (runs[-1].get("i", False), runs[-1].get("b", False)) == (
            italic,
            medium,
        ):
            runs[-1]["t"] += text
        else:
            run = {"t": text}
            if italic:
                run["i"] = True
            if medium:
                run["b"] = True
            runs.append(run)
        previous = span

    if runs:
        runs[0]["t"] = runs[0]["t"].lstrip()
        runs[-1]["t"] = runs[-1]["t"].rstrip()
    return [run for run in runs if run["t"]]


def runs_text(runs) -> str:
    return "".join(run["t"] for run in runs)


def merge_runs(left, right):
    """Hängt zwei Run-Folgen aneinander und zieht die Naht zusammen."""
    merged = [dict(run) for run in left]
    for run in right:
        if merged and (
            merged[-1].get("i", False),
            merged[-1].get("b", False),
        ) == (run.get("i", False), run.get("b", False)):
            merged[-1]["t"] += run["t"]
        else:
            merged.append(dict(run))
    return merged


def as_block(runs):
    """Absatz-Block: schlichter String, wenn nichts ausgezeichnet ist."""
    if len(runs) == 1 and not runs[0].get("i") and not runs[0].get("b"):
        return {"type": "paragraph", "text": runs[0]["t"]}
    return {"type": "paragraph", "runs": runs}


def save_illustration(doc, page, bbox, out_dir, index):
    """Schreibt die Illustration an bbox als Datei und meldet ihre Maße.

    Das eingebettete Original wird unverändert übernommen; nur wenn sich kein
    Bild zuordnen lässt (mehrere überlagerte Bilder etwa), wird die Fläche als
    PNG gerastert.
    """
    x0, y0, x1, y1 = bbox
    display_width_cm = (x1 - x0) / PT_PER_CM
    display_height_cm = (y1 - y0) / PT_PER_CM

    for info in page.get_image_info(xrefs=True):
        ib = info["bbox"]
        if max(abs(ib[i] - bbox[i]) for i in range(4)) > 2:
            continue
        if not info.get("xref"):
            break
        extracted = doc.extract_image(info["xref"])
        name = f"bild-{index:02d}.{extracted['ext']}"
        (out_dir / name).write_bytes(extracted["image"])
        return name, display_width_cm, display_height_cm

    name = f"bild-{index:02d}.png"
    page.get_pixmap(clip=pymupdf.Rect(*bbox), dpi=200).save(out_dir / name)
    return name, display_width_cm, display_height_cm


def check_source(doc, pdf_path):
    """Bricht ab, wenn das PDF nicht von einfachvorlesen.de stammt.

    Die ganze Extraktion hängt daran, dass Schriftgrößen die Bedeutung
    tragen. Bei einem fremd gesetzten PDF trifft keine der Größen zu und
    heraus käme ein leeres Buch — ein stiller Fehlschlag, der erst beim
    Vorlesen auffiele. Die Hausschrift der Quelle ist das verlässliche
    Erkennungszeichen.
    """
    for page_number in range(min(len(doc), 5)):
        for font in doc[page_number].get_fonts(full=True):
            if "AtkinsonHyperlegible" in font[3]:
                return
    raise SystemExit(
        f"{Path(pdf_path).name} sieht nicht nach einem einfachvorlesen.de-PDF "
        "aus\n(die Hausschrift Atkinson Hyperlegible fehlt). Dieses Werkzeug "
        "kann nur\ndiese Quelle lesen — ein bereits neu gesetztes Buch etwa "
        "nicht."
    )


def extract(pdf_paths, out_dir):
    """Liest Metadaten, Kapitel, Absätze und Bilder aus den Quell-PDFs."""
    image_dir = out_dir / "bilder"
    if image_dir.exists():
        shutil.rmtree(image_dir)
    image_dir.mkdir(parents=True)

    meta: dict[str, str] = {}
    blocks: list[dict] = []
    image_index = 0
    skipped_covers = 0
    skipped_ends = 0
    skipped_duplicates = 0
    seen_pages: set[str] = set()

    for pdf_path in pdf_paths:
        doc = pymupdf.open(pdf_path)
        check_source(doc, pdf_path)
        for page_number in range(len(doc)):
            page = doc[page_number]
            items = page_items(page)
            sizes = {value[0] for kind, _, value in items if kind == "txt"}

            # Coverseite: nur aus dem ersten Teil auswerten, aus den weiteren
            # Teilen verwerfen — sie wiederholt bloß Titel und Klappentext.
            if SIZE_TITLE in sizes:
                if meta:
                    skipped_covers += 1
                    continue
                read_cover(
                    doc, page, page_items(page, MIN_COVER_WIDTH), meta, image_dir
                )
                continue

            # Schlussseite ("Ende der Geschichte!" plus Werbelinks).
            if SIZE_END in sizes:
                skipped_ends += 1
                continue

            # Wer mehrteilige Downloads von Hand zusammensetzt, reicht später
            # leicht die Zusammenfassung *und* einen Rohteil ein. Das würde
            # sonst still Kapitel verdoppeln. Seiten mit genug Text bekommen
            # deshalb einen Fingerabdruck; bildlastige Seiten mit wenig Text
            # bleiben ausgenommen, damit nichts falsch Positives passiert.
            fingerprint = " ".join(
                runs_text(value[1])
                for kind, _, value in items
                if kind == "txt" and value[0] in (SIZE_BODY, SIZE_HEADING)
            )
            if len(fingerprint) >= 200:
                if fingerprint in seen_pages:
                    skipped_duplicates += 1
                    continue
                seen_pages.add(fingerprint)

            previous_y = None
            for kind, y, value in items:
                if kind == "img":
                    image_index += 1
                    name, width_cm, height_cm = save_illustration(
                        doc, page, value, image_dir, image_index
                    )
                    blocks.append(
                        {
                            "type": "image",
                            "file": name,
                            "width_cm": round(width_cm, 2),
                            "height_cm": round(height_cm, 2),
                        }
                    )
                    previous_y = None
                    continue

                size, runs = value
                if size in (SIZE_CHROME, SIZE_FOOTER):
                    continue  # Logo-Zeile, Werbezeile, Seitenzähler
                if size == SIZE_HEADING:
                    blocks.append({"type": "heading", "text": runs_text(runs)})
                    previous_y = None
                    continue
                if size != SIZE_BODY:
                    continue

                starts_paragraph = previous_y is None or (y - previous_y) > PARAGRAPH_GAP
                if starts_paragraph or not blocks or blocks[-1]["type"] != "paragraph":
                    blocks.append(as_block(runs))
                else:
                    # Die Quelle trennt keine Wörter am Zeilenende (0 von über
                    # 5000 geprüften Zeilen), Zusammenfügen mit Leerzeichen ist
                    # deshalb verlustfrei.
                    previous_runs = blocks[-1].get("runs") or [
                        {"t": blocks[-1]["text"]}
                    ]
                    previous_runs[-1]["t"] = previous_runs[-1]["t"].rstrip() + " "
                    blocks[-1] = as_block(merge_runs(previous_runs, runs))
                previous_y = y
        doc.close()

    if not meta.get("title"):
        raise SystemExit(
            "Keine Coverseite gefunden (24pt-Titel). Fehlt der erste Teil?"
        )
    if not any(block["type"] == "paragraph" for block in blocks):
        raise SystemExit(
            f"„{meta['title']}“ enthält keinen Fließtext. Vermutlich weicht das "
            "PDF vom\ngewohnten Aufbau ab — bitte von Hand nachsehen."
        )

    recipe = {
        "meta": meta,
        "page": {
            "width_cm": PAGE_WIDTH_CM,
            "height_cm": PAGE_HEIGHT_CM,
            "margin_cm": MARGIN_CM,
            "body_size_pt": BODY_SIZE_PT,
        },
        "sources": [Path(p).name for p in pdf_paths],
        "blocks": blocks,
    }
    (out_dir / "buch.json").write_text(
        json.dumps(recipe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    counts = {kind: 0 for kind in ("paragraph", "heading", "image")}
    for block in blocks:
        counts[block["type"]] += 1
    print(f"„{meta['title']}“")
    print(
        f"  {counts['paragraph']} Absätze, {counts['heading']} Kapitel, "
        f"{counts['image']} Bilder"
    )
    if skipped_covers or skipped_ends:
        print(
            f"  übersprungen: {skipped_covers} weitere Coverseite(n), "
            f"{skipped_ends} Schlussseite(n)"
        )
    if skipped_duplicates:
        print(
            f"  ACHTUNG: {skipped_duplicates} Seite(n) doppelt eingereicht und "
            "übersprungen —\n"
            "  eine der Quelldateien enthält den Inhalt einer anderen bereits."
        )
    print(f"  -> {out_dir / 'buch.json'}")
    return recipe


def read_cover(doc, page, items, meta, image_dir):
    """Titel, Klappentext, Metadaten und Coverbild von der ersten Seite."""
    title_parts: list[str] = []
    blurb_parts: list[str] = []
    for kind, _, value in items:
        if kind == "img":
            if "cover" not in meta:
                name, width_cm, height_cm = save_illustration(
                    doc, page, value, image_dir, 0
                )
                meta["cover"] = name
                meta["cover_width_cm"] = round(width_cm, 2)
                meta["cover_height_cm"] = round(height_cm, 2)
            continue
        size, text = value[0], runs_text(value[1])
        if size == SIZE_TITLE:
            title_parts.append(text)
        elif size == SIZE_BODY:
            blurb_parts.append(text)
        elif size == SIZE_META and ":" in text:
            label, _, content = text.partition(":")
            key = META_LABELS.get(label.strip())
            if key:
                # Bereits durch line_markup() maskiert.
                meta[key] = content.strip()
    # Mehrteilige Downloads tragen die Teilnummer im Titel ("... (Teil 1)") und
    # einen Hinweissatz im Klappentext. Im zusammengeführten Buch ist beides
    # falsch.
    title = " ".join(title_parts).strip()
    title = re.sub(r"\s*[-–(]?\s*Teil\s+\d+\s*\)?\s*$", "", title).strip(" -–")
    meta["title"] = title

    blurb = " ".join(blurb_parts).strip()
    blurb = " ".join(
        sentence
        for sentence in re.split(r"(?<=[.!?])\s+", blurb)
        if "Teil der Geschichte" not in sentence
    ).strip()
    meta["blurb"] = blurb


# ── Typst-Ausgabe ──────────────────────────────────────────────────────────
def escape(text: str) -> str:
    """Maskiert Typst-Markup. buch.json enthält reinen Text, keine
    Auszeichnung — die steckt in den Runs —, also wird jedes Sonderzeichen
    wörtlich genommen."""
    out = text.replace("\\", "\\\\")
    for char in "#$*_`<>@[]|~/":
        out = out.replace(char, "\\" + char)
    return out


def inline(block) -> str:
    """Absatztext mit Auszeichnung als Typst-Aufrufe.

    `#emph[…]` und `#text(weight: …)[…]` statt der Kurzschreibweise `_…_`:
    zwei Quelldateien lassen an einer Stilgrenze das Leerzeichen weg, und die
    Kurzform verlangt dort eine Wortgrenze, die es dann nicht gibt.
    """
    runs = block.get("runs")
    if runs is None:
        return escape(block["text"])
    parts = []
    for run in runs:
        text = escape(run["t"])
        if run.get("i"):
            text = f"#emph[{text}]"
        if run.get("b"):
            # Die Quelle betont in der Schnitthöhe Medium, nicht in Fett.
            text = f'#text(weight: "medium")[{text}]'
        parts.append(text)
    return "".join(parts)


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def image_call(block) -> str:
    """Bild in Originalgröße, aber nie breiter als der Satzspiegel."""
    width = block["width_cm"]
    height = block["height_cm"]
    if width > MAX_IMAGE_WIDTH_CM:
        height *= MAX_IMAGE_WIDTH_CM / width
        width = MAX_IMAGE_WIDTH_CM
    return f'#abbildung({quote("bilder/" + block["file"])}, {width:.2f}cm, {height:.2f}cm)'


def render_typst(recipe) -> str:
    meta = recipe["meta"]
    page = recipe["page"]
    blocks = recipe["blocks"]

    # Kurze Bücher wiederholen den Buchtitel als einzige Überschrift. Nach der
    # Titelseite ist das eine Dublette, also weg damit.
    def same_title(text):
        return slugify(text) == slugify(meta["title"])

    headings = [b for b in blocks if b["type"] == "heading"]
    if len(headings) == 1 and same_title(headings[0]["text"]):
        blocks = [b for b in blocks if b is not headings[0]]
        headings = []

    # 16pt heißt in der Quelle nicht immer "Kapitel". Es kann auch ein Ausruf
    # mitten in der Geschichte sein ("BEI ARCHE BOA BIST DU RICHTIG!") oder die
    # Überschrift eines Sachanhangs ganz hinten ("Das Watt", "Über
    # Orang-Utans:"). Als Kapitel gilt deshalb nur, was das Buch wirklich
    # gliedert: mehrere Überschriften, von denen die erste weit vorne steht.
    # Alles andere wird als Zwischentitel an Ort und Stelle gesetzt, ohne
    # Seitenumbruch und ohne Eintrag im Inhaltsverzeichnis.
    paragraphs = sum(1 for b in blocks if b["type"] == "paragraph")
    has_chapters = False
    if len(headings) >= 2 and paragraphs:
        before_first = sum(
            1
            for b in blocks[: blocks.index(headings[0])]
            if b["type"] == "paragraph"
        )
        has_chapters = before_first <= 0.25 * paragraphs

    imprint = []
    if meta.get("author"):
        imprint.append(f'Geschrieben von #strong[{escape(meta["author"])}]')
    if meta.get("illustrator"):
        imprint.append(f'Illustriert von #strong[{escape(meta["illustrator"])}]')
    facts = [meta[k] for k in ("publisher", "isbn", "age") if meta.get(k)]

    lines = [
        "// Erzeugt von scripts/retypeset-book.py — nicht von Hand ändern.",
        "// Inhaltliche Korrekturen gehören in buch.json, dann neu bauen.",
        "",
        f'#set document(title: {quote(meta["title"])}, '
        f'author: {quote(meta.get("author", ""))})',
        "",
        "#let TITEL = rgb(\"#8C2F39\")",
        "#let LEISE = rgb(\"#6B6560\")",
        "#let LINIE = rgb(\"#D8D0C8\")",
        "",
        "#set page(",
        f'  width: {page["width_cm"]}cm,',
        f'  height: {page["height_cm"]}cm,',
        f'  margin: {page["margin_cm"]}cm,',
        "  footer: context {",
        "    let n = counter(page).get().first()",
        "    if n > 1 {",
        "      set align(center)",
        "      set text(size: 9pt, fill: LEISE)",
        "      [#n]",
        "    }",
        "  },",
        ")",
        "",
        "// Getrennte Wörter stolpern beim Vorlesen, deshalb ist die Trennung",
        "// zwar erlaubt, aber teuer: Typst greift nur dazu, wenn eine Zeile",
        "// sonst unschön kurz bliebe. Ebenso hoch gewichtet sind Hurenkinder",
        "// und Schusterjungen.",
        '#set text(font: "Atkinson Hyperlegible Next", '
        f'size: {page["body_size_pt"]}pt, lang: "de", region: "ch", '
        "hyphenate: true, "
        "costs: (hyphenation: 400%, runt: 100%, widow: 300%, orphan: 300%))",
        "",
        "// Flattersatz: gleichmäßige Wortabstände lesen sich bei Sehschwäche",
        "// besser als Blocksatz (ADR 22). Der optimierte Umbruch verteilt die",
        "// Zeilenlängen über den ganzen Absatz statt Zeile für Zeile gierig.",
        "// Abstände sind an Grundlinien gemessen, nicht geschätzt: Typst rechnet",
        "// `leading` und `spacing` von Unterlänge zu Oberlänge, bei dieser",
        "// Schrift also 9.35pt weniger als von Grundlinie zu Grundlinie.",
        "// Zeilenabstand 0.83em ergibt 21.0pt = 1.50x Schriftgrad, Absatzabstand",
        "// 1.58em ergibt 31.5pt = 2.25x. Beides sind die Werte, die WCAG 1.4.12",
        "// ansetzt (1.5 bzw. 2.0) — die Quelle bleibt mit 1.43x knapp darunter",
        "// und braucht die Luft bei 60 Zeichen Zeilenlänge.",
        "//",
        "// Kein Erstzeileneinzug: Absätze trennt die Luft. Wer vorliest, hebt",
        "// den Blick zum Kind und sucht die Zeile danach wieder — eine Lücke",
        "// findet man dabei zuverlässiger als einen Einzug.",
        "#set par(justify: false, linebreaks: \"optimized\", leading: 0.83em, "
        "spacing: 1.58em)",
        "",
        "// Überschrift klebt an ihrem ersten Absatz — im Original steht sie",
        "// regelmäßig allein am Seitenfuß.",
        "#show heading: it => block(sticky: true, above: 0pt, below: 0.9em)[",
        '  #set text(font: "Atkinson Hyperlegible Next", weight: "semibold", '
        "size: 19pt, fill: TITEL)",
        "  #set par(justify: false, leading: 0.5em, first-line-indent: 0pt)",
        "  #it.body",
        "]",
        "",
        "// Zwischentitel: eine 16pt-Zeile der Quelle, die das Buch nicht",
        "// gliedert — ein Ausruf in der Geschichte oder der Kopf eines",
        "// Sachanhangs. Bleibt im Fluss, klebt aber an dem, was folgt.",
        "#let zwischentitel(inhalt) = block(sticky: true, above: 1.5em, "
        "below: 0.8em)[",
        '  #set text(font: "Atkinson Hyperlegible Next", weight: "semibold", '
        "size: 15pt, fill: TITEL)",
        "  #set par(justify: false, leading: 0.55em, first-line-indent: 0pt)",
        "  #inhalt",
        "]",
        "",
        "// Illustrationen schwimmen, damit kein Loch entsteht, wenn eine unten",
        "// nicht mehr ganz passt.",
        "#let abbildung(pfad, breite, hoehe) = figure(",
        "  placement: auto,",
        '  scope: "column",',
        "  gap: 1em,",
        "  image(pfad, width: breite, height: hoehe),",
        ")",
        "",
    ]

    # ── Titelseite ─────────────────────────────────────────────────────────
    lines += [
        "// Die Rechteangabe sitzt in der Fußzeile, also außerhalb des",
        "// Satzspiegels. So kann sie weder mit dem Titelblock kollidieren noch",
        "// ihn auf eine zweite Seite schieben, wie lang der Klappentext auch",
        "// ausfällt.",
        "#page(margin: (top: 2.2cm, bottom: 3.4cm, x: 2.2cm), footer: [",
        "  #set align(center)",
        "  #line(length: 30%, stroke: 0.6pt + LINIE)",
        "  #v(2.5mm)",
        "  #block(width: 88%)[",
        "    #set text(size: 8.5pt, fill: LEISE)",
        "    #set par(justify: false, leading: 0.65em)",
        "    #emph[Neu gesetzte Leseausgabe für den privaten Gebrauch. Quelle: "
        "einfachvorlesen.de, ein Service von Stiftung Lesen und Deutsche Bahn "
        "Stiftung. Die Rechte an Geschichte und Illustrationen liegen beim "
        "Verlag.]",
        "  ]",
        "])[",
        "  #set align(center)",
        "  // Der weite Absatzabstand des Korpus würde die Titelseite\n"
        "  // auseinanderziehen; hier zählt der geschlossene Block.",
        "  #set par(spacing: 0.7em, first-line-indent: 0pt)",
        "  #set text(hyphenate: false)",
        "  #v(1fr)",
    ]
    if meta.get("cover"):
        # Coverbilder sind hochkant und unterschiedlich schlank. Nur die Breite
        # zu begrenzen macht schmale Cover sehr hoch und drückt den Titelblock
        # auf eine zweite Seite, deshalb beide Maße deckeln.
        source_width = meta.get("cover_width_cm") or 5.0
        source_height = meta.get("cover_height_cm") or 5.5
        scale = min(5.0 / source_width, 5.5 / source_height, 1.0)
        lines.append(
            f'  #image({quote("bilder/" + meta["cover"])}, '
            f"width: {source_width * scale:.2f}cm)"
        )
        lines.append("  #v(6mm)")
    # Viele Titel tragen ihren Untertitel hinter einem Spiegelstrich
    # ("Wildpferde - Mutig und frei"). Als eine Zeile gesetzt bricht er
    # unschön mit führendem Bindestrich um; getrennt liest er sich als das,
    # was er ist. Nur der freistehende Strich zählt, damit "Orang-Utan"
    # unangetastet bleibt.
    main_title, _, subtitle = meta["title"].partition(" - ")
    lines += [
        '  #text(font: "Atkinson Hyperlegible Next", weight: "bold", size: 28pt, '
        f'fill: TITEL)[{escape(main_title)}]',
    ]
    if subtitle:
        lines += [
            "  #v(3mm)",
            '  #text(font: "Atkinson Hyperlegible Next", size: 17pt, fill: TITEL)'
            f"[#emph[{escape(subtitle)}]]",
        ]
    lines += [
        "  #v(4mm)",
        "  #line(length: 45%, stroke: 0.8pt + TITEL)",
        "  #v(5mm)",
    ]
    if meta.get("blurb"):
        # Lange Klappentexte etwas kleiner, damit die Titelseite eine bleibt.
        blurb_size = 10.5 if len(meta["blurb"]) > 380 else 11.5
        lines += [
            "  #block(width: 86%)[",
            f'    #set text(size: {blurb_size}pt, fill: rgb("#3A3632"))',
            "    #set par(justify: false, leading: 0.7em)",
            f'    #emph[{escape(meta["blurb"])}]',
            "  ]",
            "  #v(6mm)",
        ]
    for line in imprint:
        lines.append(f"  #text(size: 11.5pt)[{line}]")
        lines.append("  #linebreak()")
    if facts:
        lines += [
            "  #v(3mm)",
            f'  #text(size: 10pt, fill: LEISE)[{escape(" · ".join(facts))}]',
        ]
    lines += [
        "]",
        "",
    ]

    # ── Inhaltsverzeichnis ─────────────────────────────────────────────────
    if has_chapters:
        lines += [
            "#page(footer: none)[",
            '  #text(font: "Atkinson Hyperlegible Next", weight: "semibold", '
            "size: 22pt, fill: TITEL)[Inhalt]",
            "  #v(4mm)",
            "  #line(length: 100%, stroke: 0.6pt + LINIE)",
            "  #v(6mm)",
            "  #set par(spacing: 0.7em, first-line-indent: 0pt)",
            "  #outline(title: none, depth: 1)",
            "]",
            "",
        ]

    # ── Korpus ─────────────────────────────────────────────────────────────
    first_heading = True
    for block in blocks:
        if block["type"] == "heading":
            if not has_chapters:
                lines.append(f'#zwischentitel[{escape(block["text"])}]')
                lines.append("")
                continue
            # Kapitel beginnen auf einer neuen Seite; das erste folgt ohnehin
            # auf Titel- bzw. Inhaltsseite.
            if not first_heading:
                lines.append("#pagebreak(weak: true)")
            first_heading = False
            lines.append(f'= {escape(block["text"])}')
            lines.append("")
        elif block["type"] == "image":
            lines.append(image_call(block))
            lines.append("")
        else:
            lines.append(inline(block))
            lines.append("")

    return "\n".join(lines) + "\n"


def build(work_dir, preview=False):
    recipe_path = work_dir / "buch.json"
    if not recipe_path.exists():
        raise SystemExit(f"Kein buch.json in {work_dir}. Erst `extract` laufen lassen.")
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))

    typst_path = work_dir / "buch.typ"
    typst_path.write_text(render_typst(recipe), encoding="utf-8")

    pdf_path = work_dir / f"{recipe['meta']['title']}.pdf"
    result = subprocess.run(
        [
            "typst",
            "compile",
            "--font-path",
            str(FONT_DIR),
            "--root",
            str(work_dir),
            str(typst_path),
            str(pdf_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit("typst konnte das Buch nicht setzen.")

    doc = pymupdf.open(pdf_path)
    page_count = len(doc)
    if preview:
        preview_dir = work_dir / "vorschau"
        if preview_dir.exists():
            shutil.rmtree(preview_dir)
        preview_dir.mkdir()
        # Titel, Inhalt und dann gleichmäßig über das Buch verteilte Seiten.
        sample = sorted(
            index
            for index in {0, 1} | {round(page_count * i / 8) for i in range(1, 8)}
            if index < page_count
        )
        for index in sample:
            doc[index].get_pixmap(dpi=110).save(
                preview_dir / f"seite-{index + 1:03d}.png"
            )
        print(f"  Vorschau: {preview_dir} ({len(sample)} Seiten)")
    doc.close()

    print(f"„{recipe['meta']['title']}“ — {page_count} Seiten")
    print(f"  -> {pdf_path}")
    print("\nIn die Bibliothek übernehmen:")
    print(f'  cp "{pdf_path}" "{LIBRARY}/"')


def sort_parts(paths):
    """Mehrteilige Downloads heißen ...-teil-1.pdf, ...-teil-2.pdf."""

    def key(path):
        match = re.search(r"teil[-_ ]?(\d+)", Path(path).stem, re.IGNORECASE)
        return (0, int(match.group(1))) if match else (1, 0)

    return sorted(paths, key=key)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_extract = sub.add_parser("extract", help="Struktur aus den Quell-PDFs lesen")
    p_extract.add_argument("pdfs", nargs="+", type=Path)
    p_extract.add_argument(
        "-o", "--out", type=Path, help="Arbeitsordner (Vorgabe: doc/books/work/<titel>)"
    )

    p_build = sub.add_parser("build", help="Buch aus buch.json neu setzen")
    p_build.add_argument("work_dir", type=Path)
    p_build.add_argument(
        "--preview", action="store_true", help="Stichprobenseiten als PNG rendern"
    )

    args = parser.parse_args()

    if args.command == "extract":
        missing = [p for p in args.pdfs if not p.exists()]
        if missing:
            raise SystemExit("Nicht gefunden: " + ", ".join(str(p) for p in missing))
        pdfs = sort_parts(args.pdfs)
        if len(pdfs) > 1:
            print("Teile in dieser Reihenfolge:")
            for pdf in pdfs:
                print(f"  {pdf.name}")

        # Der Titel steht erst nach dem Lesen fest, deshalb erst in einen
        # vorläufigen Ordner schreiben und danach umbenennen.
        out_dir = args.out or (WORK_ROOT / ("." + slugify(pdfs[0].stem)))
        out_dir.mkdir(parents=True, exist_ok=True)
        recipe = extract(pdfs, out_dir)
        if not args.out:
            final = WORK_ROOT / slugify(recipe["meta"]["title"])
            if final.exists():
                shutil.rmtree(final)
            out_dir.rename(final)
            print(f"  Arbeitsordner: {final}")
            out_dir = final
        print(f"\nNeu setzen:\n  python3 {Path(__file__).relative_to(REPO)} "
              f'build "{out_dir.relative_to(REPO)}" --preview')
    else:
        build(args.work_dir, preview=args.preview)


if __name__ == "__main__":
    main()
