// MCPForge — 02 §5.4.2 STAGE 5: the deterministic boosts.
//
//   +  the query contains a closed-list verb that matches the tool's verb
//   +  the query names an entity that matches the tool's entity
//   +  the tool is in the caller's active role
//   +  tiny tiebreak on consumption count (capped, so a popular tool cannot bury a correct rare one)
//   -  penalty for status != resolved
//
// W0-G2. Each boost is a separate exported function of (entry, context) with
// no reference to any other — the task's `done:` requires them "separately
// testable" and the way to guarantee that is to make each one independently
// *callable*, then have `applyBoosts` do nothing but sum them. The isolation
// proof in `./rank.boosts.test.ts` follows the predicate-removal shape W0-E2
// used for `visible(session)`: zero one weight, show the ordering changes in
// exactly the expected place and nowhere else.
//
// EVERY BOOST IS A PREFERENCE, NEVER A PERMISSION. None of them can add a
// tool — a boost only reweights something stage 1 already admitted — and the
// active-role boost in particular is not an authorization signal. Reachability
// was settled by `visible(session)` before any of this ran.

import { VERBS } from '@mcpforge/shared';
import { namesStructuredValue, tokenSet } from './tokenize.js';
import { RESOLVED_STATUS } from './weights.js';
import type {
  CatalogueIndexEntry,
  ConsumptionCounts,
  RankWeights,
  ScoreBreakdown,
  SessionVisibility,
} from './types.js';

/** The closed 19-item verb list, as a set. Imported from `@mcpforge/shared` — never re-listed here, so the list has exactly one definition (CLAUDE.md §5). */
const CLOSED_VERBS: ReadonlySet<string> = new Set<string>(VERBS);

/**
 * Which closed-list verbs does this query contain? A verb whose id is
 * multi-word (`run_report`, `get_status`, `run_process`) matches only when
 * every one of its tokens is present, so "get the status" hits `get_status`
 * and, correctly, `get` as well — the entity boost and the lexical channel
 * separate those two, and dropping `get` here would silently make a
 * single-verb query stop boosting its own tool.
 */
export function queryVerbs(queryText: string): ReadonlySet<string> {
  const tokens = tokenSet(queryText);
  const found = new Set<string>();
  for (const verb of CLOSED_VERBS) {
    if (namesStructuredValue(tokens, verb)) found.add(verb);
  }
  return found;
}

/** "+ the query contains a closed-list verb that matches the tool's verb". */
export function verbMatchBoost(
  entry: CatalogueIndexEntry,
  queryText: string,
  weights: RankWeights,
): number {
  return queryVerbs(queryText).has(entry.filters.verb) ? weights.verbMatch : 0;
}

/**
 * "+ the query names an entity that matches the tool's entity".
 *
 * The entity vocabulary is not a fixed list anywhere in the repo — an entity
 * is the third segment of `{app}.{module}.{entity}.{verb}` (CLAUDE.md §5) and
 * the catalogue's entities ARE the vocabulary. So the test is direct: does
 * the query name THIS tool's entity. No candidate-set membership check is
 * needed, and none is done — a query naming an entity that exists in no tool
 * simply boosts nothing.
 */
export function entityMatchBoost(
  entry: CatalogueIndexEntry,
  queryText: string,
  weights: RankWeights,
): number {
  return namesStructuredValue(tokenSet(queryText), entry.filters.entity) ? weights.entityMatch : 0;
}

/** "+ the tool is in the caller's active role". Reads `SessionVisibility.activeRoleIds` against the entry's compiled `roles`. */
export function activeRoleBoost(
  entry: CatalogueIndexEntry,
  visibility: SessionVisibility,
  weights: RankWeights,
): number {
  if (visibility.activeRoleIds.length === 0) return 0;
  const entryRoles = new Set(entry.filters.roles);
  return visibility.activeRoleIds.some((role) => entryRoles.has(role)) ? weights.activeRole : 0;
}

/**
 * "+ tiny tiebreak on consumption count (capped, so a popular tool cannot
 * bury a correct rare one)".
 *
 *   contribution = cap · min(1, ln(1 + count) / ln(1 + reference))
 *
 * Two properties, both tested:
 *  - **Capped.** The contribution never exceeds `weights.consumptionCap`
 *    (0.01), which is strictly below the fusion distance between two
 *    adjacent lexical ranks — see `./weights.ts`. A tool with 10^9 calls
 *    therefore cannot overtake a tool the lexical channel put one place
 *    ahead of it, no matter how rare that tool is.
 *  - **Saturating.** Logarithmic below the reference count and flat above
 *    it, so the ranker distinguishes "never used" from "used", and stops
 *    caring beyond that.
 *
 * A negative or non-finite count contributes zero rather than throwing: this
 * is aggregate telemetry from the audit store, and a corrupt counter must
 * degrade the tiebreak, never the search.
 */
export function consumptionTiebreak(
  entry: CatalogueIndexEntry,
  consumption: ConsumptionCounts | undefined,
  weights: RankWeights,
): number {
  const count = consumption?.get(entry.id);
  if (count === undefined || !Number.isFinite(count) || count <= 0) return 0;
  const reference = Math.log1p(Math.max(1, weights.consumptionReferenceCount));
  const ratio = reference === 0 ? 1 : Math.log1p(count) / reference;
  return weights.consumptionCap * Math.min(1, ratio);
}

/** "− penalty for status != resolved". A demotion, never a filter — see `./weights.ts`. */
export function statusPenalty(entry: CatalogueIndexEntry, weights: RankWeights): number {
  return entry.filters.status === RESOLVED_STATUS ? 0 : weights.statusPenalty;
}

export interface BoostInput {
  readonly queryText: string;
  readonly visibility: SessionVisibility;
  readonly consumption?: ConsumptionCounts;
  readonly weights: RankWeights;
}

/** Stage 5 in full: the fusion score plus every component, each computed independently. */
export function applyBoosts(
  entry: CatalogueIndexEntry,
  fusion: number,
  input: BoostInput,
): ScoreBreakdown {
  return {
    fusion,
    verbMatch: verbMatchBoost(entry, input.queryText, input.weights),
    entityMatch: entityMatchBoost(entry, input.queryText, input.weights),
    activeRole: activeRoleBoost(entry, input.visibility, input.weights),
    consumption: consumptionTiebreak(entry, input.consumption, input.weights),
    statusPenalty: statusPenalty(entry, input.weights),
  };
}

/** The sum of every component of a breakdown. The one place a final score is computed. */
export function totalScore(breakdown: ScoreBreakdown): number {
  return (
    breakdown.fusion +
    breakdown.verbMatch +
    breakdown.entityMatch +
    breakdown.activeRole +
    breakdown.consumption +
    breakdown.statusPenalty
  );
}
