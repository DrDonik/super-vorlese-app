// Single source of truth for the shared-reading-memory mood illustrations
// (issue #65). The numeric `id` is what travels over the wire and is stored in
// completion records, so it must stay stable; the `slug` maps to the shipped
// asset at public/mood-icons/<slug>.webp (generated from doc/mood-icons/ by
// scripts/generate-mood-icons.js). The order matches doc/mood-icon-descriptions.txt;
// every entry below has a shipped image, so the full file (currently 40) is the
// catalogue the board draws from.
export const MOODS = [
  { id: 1, slug: 'crash-and-still-grinning', label: 'Trotzdem fröhlich' },
  { id: 2, slug: 'determined-chin-up', label: 'Jetzt erst recht' },
  { id: 3, slug: 'tummy-butterflies', label: 'Kribbeln im Bauch' },
  { id: 4, slug: 'mischief-brewing', label: 'Schabernack' },
  { id: 5, slug: 'wide-eyed-wonder', label: 'Staunen' },
  { id: 6, slug: 'righteous-stomp', label: 'Das ist unfair!' },
  { id: 7, slug: 'slumped-low', label: 'Ganz traurig' },
  { id: 8, slug: 'fist-in-the-air', label: 'Geschafft!' },
  { id: 9, slug: 'sneaky-and-alert', label: 'Leise und wachsam' },
  { id: 10, slug: 'cozy-pile', label: 'Kuschelig' },
  { id: 11, slug: 'gloriously-dizzy', label: 'Herrlich wirr' },
  { id: 12, slug: 'quiet-listening', label: 'Gespanntes Lauschen' },
  { id: 13, slug: 'fizzing-excitement', label: 'Aufgeregt' },
  { id: 14, slug: 'brave-but-wobbly', label: 'Mutig, aber zittrig' },
  { id: 15, slug: 'puffed-cheek-exhale', label: 'Erleichtert' },
  { id: 16, slug: 'lip-out-sulk', label: 'Beleidigt' },
  { id: 17, slug: 'contained-glow', label: 'Heimliche Freude' },
  { id: 18, slug: 'silly-serious', label: 'Ernst trotz Quatsch' },
  { id: 19, slug: 'watery-smile', label: 'Lächeln mit Tränen' },
  { id: 20, slug: 'arms-wide-free', label: 'Frei und unbeschwert' },
  // Added later (the board shows a random MOOD_BOARD_COUNT of the full set);
  // ids continue from 20 so the earlier ones stay stable in stored records.
  { id: 21, slug: 'lachkrampf', label: 'Lachkrampf' },
  { id: 22, slug: 'peeking-through-fingers', label: 'Durch die Finger geschaut' },
  { id: 23, slug: 'clutched-close-feeling', label: 'Ans Herz gedrückt' },
  { id: 24, slug: 'one-more-please', label: 'Bitte weiterlesen!' },
  { id: 25, slug: 'melting-sleepy', label: 'Müde und geborgen' },
  { id: 26, slug: 'hmmm-not-sure', label: 'Nicht ganz überzeugt' },
  { id: 27, slug: 'thats-too-much', label: 'Zu viel auf einmal' },
  { id: 28, slug: 'on-the-edge-lean', label: 'Mitgefiebert' },
  { id: 29, slug: 'slow-nod-of-getting-it', label: 'Aha, verstanden' },
  { id: 30, slug: 'warm-and-full', label: 'Wohlig zufrieden' },
  { id: 31, slug: 'secretly-moved', label: 'Heimlich gerührt' },
  // Added later still; ids continue from 31 so earlier stored records stay stable.
  { id: 32, slug: 'again-from-the-start', label: 'Nochmal von vorne!' },
  { id: 33, slug: 'scary-shivers', label: 'Wohliges Gruseln' },
  { id: 34, slug: 'gleeful-yuck', label: 'Herrlich eklig' },
  { id: 35, slug: 'real-tears', label: 'Echte Tränen' },
  { id: 36, slug: 'lost-the-thread', label: 'Den Faden verloren' },
  { id: 37, slug: 'politely-elsewhere', label: 'Mit den Gedanken woanders' },
  { id: 38, slug: 'jaw-drop-twist', label: 'Damit nicht gerechnet!' },
  { id: 39, slug: 'kiss-across-the-miles', label: 'Kuss in die Ferne' },
  { id: 40, slug: 'proud-of-you', label: 'Stolz auf dich' },
];

const MOOD_BY_ID = new Map(MOODS.map((m) => [m.id, m]));

export function moodById(id) {
  return MOOD_BY_ID.get(Number(id)) || null;
}

// Resolves to the served asset path, honouring Vite's base path (the app is
// hosted under /super-vorlese-app/ in production but / in dev).
export function moodIconUrl(slug) {
  return `${import.meta.env.BASE_URL}mood-icons/${slug}.webp`;
}

export const MOOD_PICK_COUNT = 3; // each reader selects exactly this many
export const MOOD_BOARD_COUNT = 20; // icons shown on the board (a random subset)

// Picks `count` mood ids at random, in random order, for one board. The full
// catalogue is larger than the board, so each finish shows a fresh selection —
// but BOTH devices must see the same one, so the initiator generates this and
// shares it over the wire (see Sync.startMood); the partner never rolls its own.
export function pickMoodBoard(count = MOOD_BOARD_COUNT) {
  const ids = MOODS.map((m) => m.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

// Splits a completed pair of selections into the three zones the reveal shows:
// `ours` are the moods both readers picked, `mineOnly`/`theirsOnly` are each
// side's own remaining picks. `mine` is always this device's selection, so the
// split is computed per device — there is no shared/agreed record to reconcile.
export function splitMoods(mine, theirs) {
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  const ours = mine.filter((id) => theirsSet.has(id));
  const oursSet = new Set(ours);
  return {
    mineOnly: mine.filter((id) => !oursSet.has(id)),
    ours,
    theirsOnly: theirs.filter((id) => !mineSet.has(id)),
  };
}

// The reveal (after both readers picked) and the library history both render the
// same three labelled rows — the celebrated shared „Wir" on top, then „Ich" and
// „Du" — so the keepsake looks identical wherever it appears. Leading with „Wir"
// frames the moment around what the readers share; the differences below read as
// gentle texture rather than a "we saw it differently" tally. A row is omitted
// entirely when its zone is empty: no overlap drops the „Wir" row, full agreement
// drops „Ich" and „Du". `mine`/`theirs` are this device's and the partner's
// picks, so „Ich" is always the viewer's own.
const REVEAL_ROWS = [
  ['ours', 'Wir'],
  ['mine', 'Ich'],
  ['theirs', 'Du'],
];

export function moodRevealRowsHTML(mine, theirs) {
  const { mineOnly, ours, theirsOnly } = splitMoods(mine, theirs);
  const groups = { mine: mineOnly, ours, theirs: theirsOnly };
  const tile = (id) => {
    const mood = moodById(id);
    if (!mood) return '';
    return `<div class="mood-reveal-tile"><img src="${moodIconUrl(mood.slug)}" alt="${mood.label}" draggable="false" /></div>`;
  };
  const rows = REVEAL_ROWS.map(([key, label]) => {
    const ids = groups[key];
    if (!ids.length) return '';
    return `<div class="mood-reveal-row mood-reveal-${key}">
        <span class="mood-reveal-label">${label}</span>
        <div class="mood-reveal-tiles">${ids.map(tile).join('')}</div>
      </div>`;
  }).join('');
  return `<div class="mood-reveal-rows">${rows}</div>`;
}
