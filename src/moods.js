// Single source of truth for the shared-reading-memory mood illustrations
// (issue #65). The numeric `id` is what travels over the wire and is stored in
// completion records, so it must stay stable; the `slug` maps to the shipped
// asset at public/mood-icons/<slug>.webp (generated from doc/mood-icons/ by
// scripts/generate-mood-icons.js). The order matches doc/mood-icon-descriptions.txt;
// every entry below has a shipped image, so the full file (currently 47) is the
// catalogue the board draws from.
// Each entry also carries a `cluster` — its region in the emotional space
// (valence × arousal, plus `relational` for feelings aimed at the other reader).
// The balanced board draw (issue #77) uses these to guarantee a minimum from the
// under-served regions, so every board offers an honest word for how the book
// felt — including its difficult and partner-directed ends, which a pure random
// draw of the catalogue can leave off entirely. The clusters:
//   joy            — bright, high-energy positive (triumph, silliness, wonder)
//   anticipation   — suspense, eagerness, surprise
//   calm           — low-arousal positive: content, relief, sleepy, recognition
//   tender         — bittersweet, moved
//   courage        — scared but going anyway
//   difficult-high — high-arousal hard feelings: scared, overwhelmed, angry, yuck
//   difficult-low  — low-arousal hard feelings: sad, sulk, bored, lost, unsure
//   relational     — aimed at the other reader (togetherness, love, pride)
export const MOODS = [
  { id: 1, slug: 'crash-and-still-grinning', label: 'Trotzdem fröhlich', cluster: 'joy' },
  { id: 2, slug: 'determined-chin-up', label: 'Jetzt erst recht', cluster: 'courage' },
  { id: 3, slug: 'tummy-butterflies', label: 'Kribbeln im Bauch', cluster: 'anticipation' },
  { id: 4, slug: 'mischief-brewing', label: 'Schabernack', cluster: 'joy' },
  { id: 5, slug: 'wide-eyed-wonder', label: 'Staunen', cluster: 'joy' },
  { id: 6, slug: 'righteous-stomp', label: 'Das ist unfair!', cluster: 'difficult-high' },
  { id: 7, slug: 'slumped-low', label: 'Ganz traurig', cluster: 'difficult-low' },
  { id: 8, slug: 'fist-in-the-air', label: 'Geschafft!', cluster: 'joy' },
  { id: 9, slug: 'sneaky-and-alert', label: 'Leise und wachsam', cluster: 'anticipation' },
  { id: 10, slug: 'cozy-pile', label: 'Kuschelig', cluster: 'relational' },
  { id: 11, slug: 'gloriously-dizzy', label: 'Herrlich wirr', cluster: 'joy' },
  { id: 12, slug: 'quiet-listening', label: 'Gespanntes Lauschen', cluster: 'calm' },
  { id: 13, slug: 'fizzing-excitement', label: 'Aufgeregt', cluster: 'joy' },
  { id: 14, slug: 'brave-but-wobbly', label: 'Mutig, aber zittrig', cluster: 'courage' },
  { id: 15, slug: 'puffed-cheek-exhale', label: 'Erleichtert', cluster: 'calm' },
  { id: 16, slug: 'lip-out-sulk', label: 'Beleidigt', cluster: 'difficult-low' },
  { id: 17, slug: 'contained-glow', label: 'Heimliche Freude', cluster: 'calm' },
  { id: 18, slug: 'silly-serious', label: 'Ernst trotz Quatsch', cluster: 'joy' },
  { id: 19, slug: 'watery-smile', label: 'Lächeln mit Tränen', cluster: 'tender' },
  { id: 20, slug: 'arms-wide-free', label: 'Frei und unbeschwert', cluster: 'joy' },
  // Added later (the board shows a random MOOD_BOARD_COUNT of the full set);
  // ids continue from 20 so the earlier ones stay stable in stored records.
  { id: 21, slug: 'lachkrampf', label: 'Lachkrampf', cluster: 'joy' },
  { id: 22, slug: 'peeking-through-fingers', label: 'Durch die Finger geschaut', cluster: 'anticipation' },
  { id: 23, slug: 'clutched-close-feeling', label: 'Ans Herz gedrückt', cluster: 'tender' },
  { id: 24, slug: 'one-more-please', label: 'Bitte weiterlesen!', cluster: 'anticipation' },
  { id: 25, slug: 'melting-sleepy', label: 'Müde und geborgen', cluster: 'calm' },
  { id: 26, slug: 'hmmm-not-sure', label: 'Nicht ganz überzeugt', cluster: 'difficult-low' },
  { id: 27, slug: 'thats-too-much', label: 'Zu viel auf einmal', cluster: 'difficult-high' },
  { id: 28, slug: 'on-the-edge-lean', label: 'Mitgefiebert', cluster: 'anticipation' },
  { id: 29, slug: 'slow-nod-of-getting-it', label: 'Aha, verstanden', cluster: 'calm' },
  { id: 30, slug: 'warm-and-full', label: 'Wohlig zufrieden', cluster: 'calm' },
  { id: 31, slug: 'secretly-moved', label: 'Heimlich gerührt', cluster: 'tender' },
  // Added later still; ids continue from 31 so earlier stored records stay stable.
  { id: 32, slug: 'again-from-the-start', label: 'Nochmal von vorne!', cluster: 'anticipation' },
  { id: 33, slug: 'scary-shivers', label: 'Wohliges Gruseln', cluster: 'difficult-high' },
  { id: 34, slug: 'gleeful-yuck', label: 'Herrlich eklig', cluster: 'difficult-high' },
  { id: 35, slug: 'real-tears', label: 'Echte Tränen', cluster: 'difficult-low' },
  { id: 36, slug: 'lost-the-thread', label: 'Den Faden verloren', cluster: 'difficult-low' },
  { id: 37, slug: 'politely-elsewhere', label: 'Mit den Gedanken woanders', cluster: 'difficult-low' },
  { id: 38, slug: 'jaw-drop-twist', label: 'Damit nicht gerechnet!', cluster: 'anticipation' },
  { id: 39, slug: 'kiss-across-the-miles', label: 'Kuss in die Ferne', cluster: 'relational' },
  { id: 40, slug: 'proud-of-you', label: 'Stolz auf dich', cluster: 'relational' },
  // Added to thicken under-served clusters for the balanced board draw (issue #77);
  // ids continue from 40 so earlier stored records stay stable. Briefs live in
  // doc/mood-icon-descriptions.txt entries 41–47.
  { id: 41, slug: 'peering-out-from-hiding', label: 'Lieber versteckt', cluster: 'difficult-high' },
  { id: 42, slug: 'hands-over-the-ears', label: 'Ohren zu!', cluster: 'difficult-high' },
  { id: 43, slug: 'the-hot-whole-body-no', label: 'Stinksauer', cluster: 'difficult-high' },
  { id: 44, slug: 'holding-back-the-tears', label: 'Tränen verdrückt', cluster: 'difficult-low' },
  { id: 45, slug: 'one-big-brave-breath', label: 'Tief durchgeatmet', cluster: 'courage' },
  { id: 46, slug: 'hand-across-the-distance', label: 'Hand in die Ferne', cluster: 'relational' },
  { id: 47, slug: 'thumbs-up-for-you', label: 'Daumen hoch für dich', cluster: 'relational' },
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
export const MOOD_BOARD_COUNT = 20; // icons shown on the board (a balanced subset)

// Per-cluster minimums every board guarantees (issue #77). The catalogue skews
// cheerful and high-energy, so a pure random draw of 20 can leave a sad or scary
// book with no fitting word and offer nothing to aim at the other reader — the
// opposite of the ritual's purpose (an honest word for how the book felt, ADR 12).
// Floors cover exactly the regions where a thin board would hurt and substitution
// fails: both difficult poles, the partner-directed feelings, and the small
// calm/courage/tender clusters. Joy and anticipation are large and substitutable,
// so they carry no floor and still dominate the random fill. The sum (7) must stay
// well under MOOD_BOARD_COUNT so most of the board is still a free random draw.
const MOOD_BOARD_FLOORS = {
  'difficult-low': 2, // sad ≠ sulk ≠ bored — needs enough that the right one is there
  'difficult-high': 1, // scared / overwhelmed / angry
  relational: 1, // something to send the other reader
  calm: 1, // a sleepy / cozy word — common at the end of a bedtime book
  courage: 1,
  tender: 1,
};

// Fisher–Yates, in place; returns the same array for chaining.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Builds one board of `count` mood ids in random display order. The full catalogue
// is larger than the board, so each finish shows a fresh selection — but BOTH
// devices must see the same one, so the initiator generates this and shares it over
// the wire (see Sync.startMood); the partner never rolls its own.
//
// The draw is balanced, not pure-random: it first satisfies each cluster floor
// (picking at random from within that cluster), then fills the remaining slots at
// random from everything left, then shuffles so the floor picks aren't bunched at
// the front. This widens the vocabulary on offer without shrinking the board, so it
// never manufactures the coincidental overlap ADR 12 warned against — it only makes
// honest, divergent naming reliably possible.
export function pickMoodBoard(count = MOOD_BOARD_COUNT) {
  const byCluster = new Map();
  for (const m of MOODS) {
    if (!byCluster.has(m.cluster)) byCluster.set(m.cluster, []);
    byCluster.get(m.cluster).push(m.id);
  }
  for (const ids of byCluster.values()) shuffle(ids);

  const picked = new Set();
  // 1. Satisfy each cluster floor from its shuffled members (capped at the
  //    cluster's size, so a floor larger than its cluster simply takes all of it).
  for (const [cluster, min] of Object.entries(MOOD_BOARD_FLOORS)) {
    const ids = byCluster.get(cluster) || [];
    for (let i = 0; i < min && i < ids.length; i++) picked.add(ids[i]);
  }
  // 2. Fill the rest at random from every mood not already chosen.
  for (const id of shuffle(MOODS.map((m) => m.id).filter((id) => !picked.has(id)))) {
    if (picked.size >= count) break;
    picked.add(id);
  }
  // 3. Shuffle the whole board so the floors land in random positions.
  return shuffle([...picked]).slice(0, Math.min(count, MOODS.length));
}

// Every rendered zone is put into catalogue order, so both devices show each row
// identically (issue #139). Without this the two sides disagree, because two
// different orderings meet: a reader's own picks arrive in *tap* order (a Set,
// insertion-ordered), while the partner's arrive in *id* order — the wire stores
// picks as a `{ id: true }` map, and JS hands integer keys back ascending. So the
// same zone read „tap order" on one device and „id order" on the other, which
// made discussing the keepsake over the call needlessly hard („das dritte von
// links …").
//
// Catalogue order is the canonical one because it is available everywhere the
// keepsake is shown, including the library history of long-past finishes — the
// board's display order would not be, as it is rolled per finish and never
// stored. Tap order is no loss: it is never surfaced (a pick shows a ring, not a
// number), the zone split breaks it up anyway, and it already failed to reach the
// partner. Stored records keep whatever order they were written in; sorting on
// render means older keepsakes line up too, with nothing to migrate.
const MOOD_RANK = new Map(MOODS.map((m, i) => [m.id, i]));

function inCatalogueOrder(ids) {
  return [...ids].sort((a, b) => (MOOD_RANK.get(a) ?? Infinity) - (MOOD_RANK.get(b) ?? Infinity));
}

// Splits a completed pair of selections into the three zones the reveal shows:
// `ours` are the moods both readers picked, `mineOnly`/`theirsOnly` are each
// side's own remaining picks. `mine` is always this device's selection, so the
// split is computed per device — there is no shared/agreed record to reconcile.
// Each zone comes back in catalogue order, so both devices render it the same.
export function splitMoods(mine, theirs) {
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  const oursSet = new Set(mine.filter((id) => theirsSet.has(id)));
  return {
    mineOnly: inCatalogueOrder(mine.filter((id) => !oursSet.has(id))),
    ours: inCatalogueOrder(oursSet),
    theirsOnly: inCatalogueOrder(theirs.filter((id) => !mineSet.has(id))),
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
  ['ours', 'Wir', 'ours'],
  ['mine', 'Ich', 'mine'],
  ['theirs', 'Du', 'theirs'],
];

function moodRevealTile(id) {
  const mood = moodById(id);
  if (!mood) return '';
  return `<div class="mood-reveal-tile"><img src="${moodIconUrl(mood.slug)}" alt="${mood.label}" draggable="false" /></div>`;
}

// Renders the labelled rows shared by the picker reveal and the library history.
// Each row is [groupKey, label, styleKey]: `groupKey` indexes `groups`, while
// `styleKey` picks the `.mood-reveal-*` styling — so the witness keepsake can
// reuse the celebrated „ours" styling for „Ihr" and the „theirs" styling for both
// its „Du" rows. A row is omitted entirely when its zone is empty.
function moodRevealRows(rows, groups) {
  const html = rows.map(([groupKey, label, styleKey]) => {
    const ids = groups[groupKey];
    if (!ids.length) return '';
    return `<div class="mood-reveal-row mood-reveal-${styleKey}">
        <span class="mood-reveal-label">${label}</span>
        <div class="mood-reveal-tiles">${ids.map(moodRevealTile).join('')}</div>
      </div>`;
  }).join('');
  return `<div class="mood-reveal-rows">${html}</div>`;
}

export function moodRevealRowsHTML(mine, theirs) {
  const { mineOnly, ours, theirsOnly } = splitMoods(mine, theirs);
  return moodRevealRows(REVEAL_ROWS, { mine: mineOnly, ours, theirs: theirsOnly });
}

// Splits the two children's picks for the witness keepsake (issue #82: one
// grandparent reading to two grandchildren). `shared` are the moods both children
// picked; `aOnly`/`bOnly` are each child's own remaining picks. Same three-zone
// shape as splitMoods, so there are always six picks to keep and the record is
// never empty — honouring divergence (ADR 12) by keeping the whole picture, not
// just the agreement. Catalogue-ordered like splitMoods, so the witness's rows
// match the ones the two children see on their own devices.
export function splitWitness(a, b) {
  const aSet = new Set(a);
  const bSet = new Set(b);
  return {
    shared: inCatalogueOrder(a.filter((id) => bSet.has(id))),
    aOnly: inCatalogueOrder(a.filter((id) => !bSet.has(id))),
    bOnly: inCatalogueOrder(b.filter((id) => !aSet.has(id))),
  };
}

// The witness reveal/keepsake: „Ihr" (what both children felt, celebrated like
// the picker's „Wir") on top, then each child's own picks as two deliberately
// unnamed „Du" rows. Reuses the picker reveal's markup so the keepsake looks
// identical wherever it appears.
const WITNESS_ROWS = [
  ['shared', 'Ihr', 'ours'],
  ['aOnly', 'Du', 'theirs'],
  ['bOnly', 'Du', 'theirs'],
];

export function moodWitnessRowsHTML(a, b) {
  return moodRevealRows(WITNESS_ROWS, splitWitness(a, b));
}
