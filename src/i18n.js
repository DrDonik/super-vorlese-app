// The app speaks whatever the browser speaks. There is no language setting and
// no picker anywhere in the UI (ADR 38): a grandparent who has to find a menu
// before the app is readable has already been failed by it, and a household
// where one device is wrong is a household where somebody set it wrong.
// `navigator.languages` is the answer the operating system already holds, and on
// an installed PWA it is the system language — the same one the rest of the
// device is in. It answers *which language* and nothing else: the country in
// that tag is not to be believed, and the clock is asked instead (see
// CLOCK_COUNTRIES below).
//
// The two readers need not agree. Nothing translated here travels between
// devices: the Lese-Code is six characters, the moods travel as
// numeric ids (see moods.js), and the page number is a number. A French
// grandmother and a German grandchild read the same book on the same page and
// see the same mood board, each in their own words.
//
// Adding a language is one file plus one line in DICTIONARIES below. Everything
// else — plural forms, sorting, dates — follows from the resolved locale.

import { de } from './i18n/de.js';
import { deDE } from './i18n/de-DE.js';
import { en } from './i18n/en.js';

// Every language the app actually ships, keyed by the tag it answers to.
// Deliberately derived from what is here rather than from a wish list: a
// language listed without a dictionary would resolve, then fall through key by
// key, and the app would claim to speak something it does not.
//
// A key with a region is a *variant*: it carries only what differs from its base
// language and leans on it for the rest (see `chain` below). `de-DE.js` is one
// file under two tags because Austria spells like Germany, and a second file
// holding the same fourteen lines would only be a second file to forget.
const DICTIONARIES = {
  de,
  'de-de': deDE,
  'de-at': deDE,
  en,
};

// The language the strings are written in. Every key exists here, so it is the
// last stop for anything a translation has not caught up with yet — a partly
// translated dictionary shows German in the gaps rather than a bare key.
const SOURCE_LANG = 'de';

// Where a browser goes whose language the app does not speak. English rather
// than the source language: the app is built for one German-speaking family,
// but anyone else who opens it is far more likely to get somewhere in English.
const FALLBACK_LANG = 'en';

// Safari does not hand the browser's language preferences to the page as they
// are. Every tag goes through Apple's `+[NSLocale minimizedLanguagesFromLanguages:]`
// first — a fingerprinting countermeasure that snaps each language onto its one
// likely country and keeps only the first preference. Measured on macOS 26 with
// the system set to Swiss German, British English, Danish, French:
//
//   ["de-CH", "en-GB", "da-CH", "fr-CH"]  →  ["de-DE", "de"]
//
// So `de-CH`, `de-AT` and `de-DE` all reach the page as `de-DE`, on every iPad
// and every iPhone, whatever the device is set to and wherever it stands. The
// country is not merely missing there, it is confidently wrong — and nothing in
// the tag tells that `de-DE` apart from the one a Berlin browser honestly sends.
//
// The clock is not minimized: a browser that lies about the time zone breaks
// every calendar on the web, so `Europe/Zurich` arrives intact. The language
// therefore comes from the browser and the country comes from the clock.
//
// Switzerland has exactly one zone, and so does each of its German-speaking
// neighbours — the whole map is five lines. Only German is listed, because
// German is the only language whose country this app distinguishes (see
// de-DE.js). Should English or French ever gain a regional variant, they gain
// lines here.
const CLOCK_COUNTRIES = {
  'Europe/Zurich': 'CH',
  'Europe/Vaduz': 'LI', // Liechtenstein writes ss and «…», like Switzerland.
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE', // The German exclave inside Switzerland; spells German.
  'Europe/Vienna': 'AT',
};

// Asked of `Intl` on every load rather than stored, because the zone travels
// with the device: a tablet carried across the border answers differently the
// next evening, which is exactly what should happen.
function countryFromClock() {
  try {
    return CLOCK_COUNTRIES[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? null;
  } catch {
    return null;
  }
}

// The country of a German tag is written by the clock and by nothing else. A
// tag saying `de-DE` is worth no more than one saying nothing at all, since
// Safari says `de-DE` for every German speaker alive — so outside the five
// zones the tag is cut back to bare `de`, which lands on Switzerland by the
// rule this file already had for a tag that names no country. A German reader
// on holiday in Spain is then shown Swiss quotation marks for the week; a Swiss
// reader at home is shown Swiss ones always, and that is the trade that counts.
//
// Every other language passes through untouched. Nothing in the app varies by
// their country except date formats, and there the browser's own guess is as
// good as this one.
function withCountryFromClock(tag) {
  const text = String(tag);
  if (text.toLowerCase().split('-')[0] !== 'de') return text;
  const country = countryFromClock();
  return country ? `de-${country}` : 'de';
}

// The first of the browser's preferences the app can actually speak, its
// country rewritten as above. Each preference is tried from its longest form
// down to its bare language before the next one is looked at — the ordinary
// BCP-47 lookup — so a device in Berlin finds the German variant and one in
// Zurich falls past it to plain German. The full tag is kept for Intl either
// way, so a Swiss device gets Swiss date formats off the very dictionary that
// does not name a country.
function resolveLanguage() {
  const wanted = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  for (const preference of wanted) {
    const tag = withCountryFromClock(preference);
    const parts = tag.toLowerCase().split('-');
    while (parts.length) {
      const candidate = parts.join('-');
      if (DICTIONARIES[candidate]) return { lang: candidate, tag };
      parts.pop();
    }
  }
  const lang = DICTIONARIES[FALLBACK_LANG] ? FALLBACK_LANG : SOURCE_LANG;
  // No regional tag to keep: the browser's own is for a language that is not on
  // screen, and Italian dates under English words would be a third language in
  // the same sentence.
  return { lang, tag: lang };
}

const resolved = resolveLanguage();

// Which dictionary is on — a bare language, or a language with a region when a
// variant answered. Also what `<html lang>` is set to below.
export const lang = resolved.lang;

// What every Intl object and every toLocale* call in the app is built from.
// Verified rather than assumed: `navigator.languages` is not guaranteed to hold
// well-formed tags, and one bad entry would otherwise throw a RangeError out of
// a date format in the middle of the mood history. `undefined` is a valid last
// resort — it means the host default, which is what these calls did before.
export const locale = (() => {
  for (const candidate of [resolved.tag, resolved.lang]) {
    try {
      new Intl.PluralRules(candidate);
      return candidate;
    } catch {
      // Not a tag Intl accepts; try the next one.
    }
  }
  return undefined;
})();

// Silbentrennung, Anführungszeichen und die Aussprache durch VoiceOver hängen
// daran, und index.html kann es nicht wissen — dort steht die Sprache, in der
// die Datei geschrieben ist, nicht die, in der die App gerade läuft.
//
// Der volle Tag und nicht der Name des Wörterbuchs: Wer in Zürich liest, liest
// Schweizer Deutsch, also ist `de-CH` die genauere Auskunft als das `de`, unter
// dem dieses Wörterbuch geführt wird — und die Silbentrennung darf sie haben.
// Dass in Safari überhaupt wieder `de-CH` herauskommt, verdankt sich der Uhr;
// der Browser selbst hätte hier `de-DE` gesagt.
document.documentElement.lang = locale ?? lang;

const pluralRules = new Intl.PluralRules(locale);

// `{name}` is replaced from `vars`; a placeholder with nothing to fill it is
// left standing rather than blanked, so a missing variable is visible in the
// UI instead of silently swallowing half a sentence.
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (
    name in vars ? String(vars[name]) : whole
  ));
}

// A dictionary value may be an object of plural forms keyed by CLDR category
// („one", „other", and whatever else a language needs — Danish and German get
// by on two, French counts 0 as one, and a language with more simply lists
// more). The counting variable is always `n`.
function selectForm(value, vars) {
  if (typeof value === 'string') return value;
  const n = Number(vars?.n);
  if (!Number.isFinite(n)) return value.other;
  return value[pluralRules.select(n)] ?? value.other;
}

// Where a key is looked for, in order. Computed once, because it only depends
// on the language, and read on every single t() call.
//
// The base language comes first after a regional variant, and that is what lets
// `de-DE.js` be fourteen lines instead of two hundred: everything it does not
// say, plain German answers.
//
// English sits next, and it is the reason the chain is longer than two. A
// half-finished French dictionary should show its gaps in English, not in
// German: the same reasoning that makes English the fallback for a language the
// app does not speak at all applies key by key inside one it speaks badly.
//
// German is last because it is the source and therefore the only dictionary
// guaranteed complete — so the chain always ends in a real sentence rather than
// a blank. For a German reader the English link is unreachable in practice: it
// can only be taken if de.js is missing a key, which is a defect in de.js, and
// English is then still better than the bare key.
const chain = [...new Set([
  lang,
  lang.includes('-') ? lang.split('-')[0] : null,
  FALLBACK_LANG,
  SOURCE_LANG,
].filter(Boolean))];

// A bare key on screen means the key itself is wrong — which is exactly when it
// should show.
function lookup(key) {
  for (const dict of chain) {
    const value = DICTIONARIES[dict]?.[key];
    if (value != null) return value;
  }
  return undefined;
}

export function t(key, vars) {
  const value = lookup(key);
  if (value == null) return key;
  return interpolate(selectForm(value, vars), vars);
}

// The Intl wrappers below exist so no call site has to know the locale, and so
// there is one place to look when sorting or a date format goes wrong. Each
// falls back to plain string behaviour rather than throwing: a shelf that
// sorts oddly is a small defect, a shelf that does not render is not.

export function collator(options) {
  try {
    return new Intl.Collator(locale, options);
  } catch {
    return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
  }
}

export function formatDate(ts, options) {
  try {
    return new Date(ts).toLocaleDateString(locale, options);
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function foldCase(text) {
  try {
    return text.toLocaleLowerCase(locale);
  } catch {
    return text.toLowerCase();
  }
}
