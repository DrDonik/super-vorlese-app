// Single source of truth for the shared-reading-memory mood illustrations
// (issue #65). The numeric `id` is what travels over the wire and is stored in
// completion records, so it must stay stable; the `slug` maps to the shipped
// asset at public/mood-icons/<slug>.webp (generated from doc/mood-icons/ by
// scripts/generate-mood-icons.js). The order matches doc/mood-icon-descriptions.txt.
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

export const MOOD_PICK_COUNT = 4; // each reader selects exactly this many
export const MOOD_MIN_OVERLAP = 3; // shared moods needed to auto-lock

// Decides whether two readers' selections lock in a completion. Both must have
// picked exactly MOOD_PICK_COUNT and share at least MOOD_MIN_OVERLAP of them.
// Returns the resolved record { shared, personal } (ids sorted ascending) when
// lockable, or null otherwise. `shared` is the agreed moods; `personal` is each
// side's divergent pick(s) — empty when every pick matches.
export function evaluateLock(picksA, picksB) {
  if (picksA.length !== MOOD_PICK_COUNT || picksB.length !== MOOD_PICK_COUNT) return null;
  const setB = new Set(picksB);
  const shared = picksA.filter((id) => setB.has(id));
  if (shared.length < MOOD_MIN_OVERLAP) return null;
  const sharedSet = new Set(shared);
  const personal = [...picksA, ...picksB].filter((id) => !sharedSet.has(id));
  const dedupe = (arr) => [...new Set(arr)].sort((a, b) => a - b);
  return { shared: dedupe(shared), personal: dedupe(personal) };
}
