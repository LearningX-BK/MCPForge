// MCPForge — W0-J10: facet state, URL-encoded.
//
// 03's Catalog spec (§5.3, skimmed for shape only — not this task's `reads:`
// list) treats facets as named groups of selectable values (app, verb,
// binding type, write, sensitivity, package, role, status, ...). This module
// is deliberately generic over the facet *names* the later Catalog task
// (W0-J13) will define — it owns only the encode/decode contract so "a
// filtered view is a shareable link" (03 §12.2/§12.6 keyboard+structure
// framing, and this task's own `done:` line) holds regardless of which
// facets a caller registers.
//
// Judgment call: the task text offers a choice between a `useFacetState`
// hook and a pure `encodeFacets`/`decodeFacets` pair, "your call on the exact
// API", and explicitly prefers a framework-agnostic pure-function core with a
// thin Next.js adapter "so it's directly unit-testable without a router
// mock". That is what this file does: `encodeFacets`/`decodeFacets` operate
// on a plain `Record<string, string[]>` and a `URLSearchParams`-compatible
// string with zero framework dependency; `useFacetState` (in
// `use-facet-state.ts`, a separate 'use client' module) is the thin Next.js
// wiring on top, kept out of this file so this one stays importable from a
// server component or a plain unit test with no DOM.

/** A facet group name -> the set of selected values within it. */
export type FacetState = Record<string, string[]>;

/**
 * Encode facet state into a URLSearchParams-compatible query string
 * fragment (no leading `?`). Each facet group becomes one `key=v1,v2,v3`
 * pair, sorted by group name so the same selection always encodes to the
 * same string (stable, diffable, shareable links). Empty groups are
 * dropped entirely rather than encoded as `key=`.
 */
export function encodeFacets(state: FacetState): string {
  const params = new URLSearchParams();
  const groupNames = Object.keys(state).sort();
  for (const group of groupNames) {
    const values = state[group];
    if (!values || values.length === 0) continue;
    params.set(group, values.slice().sort().join(','));
  }
  return params.toString();
}

/**
 * Decode a URLSearchParams-compatible query string (with or without a
 * leading `?`) back into facet state. Unknown/garbage keys round-trip
 * faithfully — this module does not know a Catalog's facet schema, so it
 * is not this layer's job to drop or validate group names. Duplicate
 * values within one group's comma list are de-duplicated; empty tokens
 * (from a trailing comma, or an empty value) are dropped.
 */
export function decodeFacets(query: string): FacetState {
  const trimmed = query.startsWith('?') ? query.slice(1) : query;
  const params = new URLSearchParams(trimmed);
  const state: FacetState = {};
  for (const [key, raw] of params.entries()) {
    const values = Array.from(new Set(raw.split(',').map((v) => v.trim()).filter(Boolean)));
    if (values.length > 0) {
      state[key] = values;
    }
  }
  return state;
}

/** Is `value` currently selected within `group`? */
export function isFacetSelected(state: FacetState, group: string, value: string): boolean {
  return Boolean(state[group]?.includes(value));
}

/**
 * Pure reducer: toggle `value` within `group`, returning a new state.
 * Never mutates `state`. Removing the last value of a group drops the
 * group key entirely, so it does not linger as `group=` in the URL.
 */
export function toggleFacet(state: FacetState, group: string, value: string): FacetState {
  const current = state[group] ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];

  const rest = { ...state };
  delete rest[group];
  return next.length > 0 ? { ...rest, [group]: next } : rest;
}

/** Pure reducer: clear one facet group entirely. */
export function clearFacetGroup(state: FacetState, group: string): FacetState {
  const rest = { ...state };
  delete rest[group];
  return rest;
}

/** Pure reducer: clear all facet groups. */
export function clearAllFacets(): FacetState {
  return {};
}
