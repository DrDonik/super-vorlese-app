// The app speaks whatever the browser speaks. There is no language setting and
// no picker anywhere in the UI (ADR 38): a grandparent who has to find a menu
// before the app is readable has already been failed by it, and a household
// where one device is wrong is a household where somebody set it wrong.
// `navigator.languages` is the answer the operating system already holds, and on
// an installed PWA it is the system language — the same one the rest of the
// device is in.
//
// The two readers need not agree. Nothing translated here travels between
// devices: the Synchronisations-Code is six characters, the moods travel as
// numeric ids (see moods.js), and the page number is a number. A French
// grandmother and a German grandchild read the same book on the same page and
// see the same mood board, each in their own words.
//
// Adding a language is one file plus one line in DICTIONARIES below. Everything
// else — plural forms, sorting, dates — follows from the resolved locale.

import { de } from './i18n/de.js';

// Every language the app actually ships. Deliberately derived from what is here
// rather than from a wish list: a language listed without a dictionary would
// resolve, then fall through key by key, and the app would claim to speak
// something it does not.
const DICTIONARIES = { de };

// The language the strings are written in. Every key exists here, so it is the
// last stop for anything a translation has not caught up with yet — a partly
// translated dictionary shows German in the gaps rather than a bare key.
const SOURCE_LANG = 'de';

// Where a browser goes whose language the app does not speak. English rather
// than the source language: the app is built for one German-speaking family,
// but anyone else who opens it is far more likely to get somewhere in English.
const FALLBACK_LANG = 'en';

// The first of the browser's preferences the app can actually speak. Matched on
// the primary subtag only — `de-CH`, `de-DE` and `de-AT` all get the German
// dictionary — while the full tag is kept for Intl, so a German browser in
// Germany still gets German date formats.
function resolveLanguage() {
  const wanted = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  for (const tag of wanted) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (DICTIONARIES[primary]) return { lang: primary, tag: String(tag) };
  }
  const lang = DICTIONARIES[FALLBACK_LANG] ? FALLBACK_LANG : SOURCE_LANG;
  // No regional tag to keep: the browser's own is for a language that is not on
  // screen, and Italian dates under English words would be a third language in
  // the same sentence.
  return { lang, tag: lang };
}

const resolved = resolveLanguage();

// Which dictionary is on. Also what `<html lang>` is set to below.
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
document.documentElement.lang = lang;

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

// Falls through the active dictionary, then English, then German. Every key
// exists in German, so the chain always ends in a real sentence — a bare key on
// screen means the key itself is wrong, which is exactly when it should show.
function lookup(key) {
  return DICTIONARIES[lang]?.[key]
    ?? DICTIONARIES[FALLBACK_LANG]?.[key]
    ?? DICTIONARIES[SOURCE_LANG]?.[key];
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
