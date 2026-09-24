// MCPForge — shared helpers for the guard lint rules (W0-A3).
// Kept dependency-free and plain ESM so ESLint can load the plugin from source
// with no build step in the lint path.

/** Normalise a filename to POSIX separators so path checks work on Windows. */
export function posixPath(filename) {
  return String(filename ?? '').replace(/\\/g, '/');
}

/** True when the file is `tokens.primitives.css` — the one raw-colour home. */
export function isPrimitivesTokenFile(filename) {
  return /(^|\/)tokens\.primitives\.css$/.test(posixPath(filename));
}

/**
 * 02 §11.5 rule 2 — `SecretStore.get()` is callable only from these two trees.
 */
export function isSecretValueAllowedPath(filename) {
  const p = posixPath(filename);
  return /(^|\/)adapters\//.test(p) || /(^|\/)core\/gateway\/identity\//.test(p);
}

// Raw colour literals: #rgb / #rrggbb / #rrggbbaa, rgb()/rgba(), hsl()/hsla().
export const RAW_COLOR_RE =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\s*\(/;

/** 03 §4.3 + §13.6 — retired brand names and the superseded palette hexes. */
export const RETIRED_BRAND_STRINGS = [
  'LTIMindtree',
  'OraAIX',
  'OraFORGE',
  'OMF',
  '#FA5843',
  '#4FC3F7',
  '#B388FF',
  '#4ADE9B',
];

/**
 * Find retired brand tokens in a piece of text.
 * Word-ish boundaries keep `LTM` (the current brand, 03 §4.3) from matching,
 * and keep `OMF` from firing inside longer identifiers such as `COMFORT`.
 */
export function findRetiredBrandStrings(text) {
  const hits = [];
  for (const term of RETIRED_BRAND_STRINGS) {
    const re = term.startsWith('#')
      ? new RegExp(term.replace('#', '#') + '\\b', 'i')
      : new RegExp('(?<![A-Za-z0-9])' + term + '(?![A-Za-z0-9])');
    if (re.test(text)) hits.push(term);
  }
  return hits;
}
