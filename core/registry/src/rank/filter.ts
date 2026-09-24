// MCPForge — 02 §5.4.2 STAGE 1: hard filters.
//
//   "1. Hard filters   structured fields + visible(session) from §5.1.
//                      A tool the caller cannot reach is never ranked, never returned."
//
// W0-G2. This is the stage the task's `done:` criterion singles out, and the
// property it asserts is stronger than "ranked low": a tool outside
// `visible(session)` never reaches the lexical channel, never reaches fusion,
// never acquires a score, and cannot appear in any output of this package —
// including corpus statistics, which is why `./bm25.ts` takes its document
// frequencies from the survivors and not from the whole index.
//
// The order inside this stage is visibility FIRST, then structured filters.
// Both are conjunctive so the resulting set is identical either way; running
// visibility first means that a bug in structured filtering can only ever
// leave the set too NARROW, never leak an unreachable tool.

import type { CatalogueIndexEntry, RankFilters, SessionVisibility } from './types.js';

/** Does the entry carry every requested value of an array-valued filter? AND, never OR — see `RankFilters`. */
function hasEveryTag(entryTags: readonly string[], requested: readonly string[]): boolean {
  if (requested.length === 0) return true;
  const present = new Set(entryTags);
  return requested.every((tag) => present.has(tag));
}

/** The structured half of stage 1: exact match on every supplied `CatalogueIndexFilters` field. */
export function matchesFilters(
  entry: CatalogueIndexEntry,
  filters: RankFilters | undefined,
): boolean {
  if (filters === undefined) return true;
  const f = entry.filters;
  if (filters.app !== undefined && f.app !== filters.app) return false;
  if (filters.module !== undefined && f.module !== filters.module) return false;
  if (filters.entity !== undefined && f.entity !== filters.entity) return false;
  if (filters.verb !== undefined && f.verb !== filters.verb) return false;
  if (filters.bindingType !== undefined && f.bindingType !== filters.bindingType) return false;
  if (filters.archetype !== undefined && f.archetype !== filters.archetype) return false;
  if (filters.sensitivity !== undefined && f.sensitivity !== filters.sensitivity) return false;
  if (filters.write !== undefined && f.write !== filters.write) return false;
  if (filters.status !== undefined && f.status !== filters.status) return false;
  if (filters.processTags !== undefined && !hasEveryTag(f.processTags, filters.processTags))
    return false;
  if (filters.packageTags !== undefined && !hasEveryTag(f.packageTags, filters.packageTags))
    return false;
  if (filters.roles !== undefined && !hasEveryTag(f.roles, filters.roles)) return false;
  return true;
}

/**
 * Stage 1 in full. Returns the survivors, in the index's own order (sorted by
 * id, W0-G1's guarantee), so the whole pipeline is deterministic before a
 * single score is computed.
 *
 * There is no variant of this function that skips visibility. `visibility` is
 * a required parameter and the filter is unconditional: the only way to rank
 * an unreachable tool would be to hand the ranker a visibility set that
 * already contains it, which is `core/gateway/scope/**`'s decision to make
 * and W0-E2's predicate-removal proof to defend.
 */
export function applyHardFilters(
  entries: readonly CatalogueIndexEntry[],
  visibility: SessionVisibility,
  filters?: RankFilters,
): readonly CatalogueIndexEntry[] {
  const survivors: CatalogueIndexEntry[] = [];
  for (const entry of entries) {
    if (!visibility.visibleToolIds.has(entry.id)) continue;
    if (!matchesFilters(entry, filters)) continue;
    survivors.push(entry);
  }
  return survivors;
}
