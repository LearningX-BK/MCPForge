// MCPForge — the ranking pipeline's shapes (02 §5.4.2, §5.4.3). W0-G2.
//
// LOCATION NOTE. TASKS.md's `touches:` for W0-G2 reads `core/registry/rank/**`.
// W0-G1 built the index at `core/registry/src/index/**` — the package's
// `rootDir` is `src`, so `core/registry/rank/**` would sit outside the
// compiled tree entirely. This module therefore lives at
// `core/registry/src/rank/**`, the same `src/`-relative reading of the path
// W0-G1 already applied. Documented here rather than silently.
//
// WHAT THIS MODULE OWNS. Stages 1–5 of 02 §5.4.2, in order, over the
// `CatalogueIndex` artefact W0-G1 produces. Stage 6 (absolute score floor →
// `no_tool`, top-2 margin → `choose`) is W0-G3 and is deliberately NOT
// implemented here — the pipeline exposes it as an ordered, pluggable final
// stage with a pass-through default so that "the six stages run in order" is
// a structural property of this file rather than a promise about a later one.

import type { CatalogueIndexEntry, CatalogueIndexFilters } from '../index/types.js';

/** A tool id. Structurally `{app}.{module}.{entity}.{verb}` (CLAUDE.md §5). */
export type ToolId = string;

/**
 * THE SCOPE SEAM (02 §5.4.2 stage 1, "structured fields + visible(session)
 * from §5.1").
 *
 * `visible(session)` is a six-way intersection and it already exists, whole
 * and tested, at `core/gateway/scope/**` (W0-E2). This package does NOT
 * import it and must not: `@mcpforge/gateway` depends on the registry to load
 * the catalogue, so a registry→gateway import would be a circular workspace
 * dependency — the identical reasoning W0-G1 recorded for not importing
 * `@mcpforge/codegen`.
 *
 * Instead the ranker takes the *result* of scope resolution as an input. The
 * gateway satisfies this by construction:
 *
 *     const { visible } = resolveScope(catalogue, ctx);
 *     const visibility = { visibleToolIds: new Set(visible), activeRoleIds: [...] };
 *
 * The seam is deliberately a resolved SET, not a predicate the ranker could
 * call: the ranker has no way to widen it, cannot forget to pass a predicate,
 * and cannot fail open on a throwing check — every one of those decisions
 * stays in `core/gateway/scope/**` where W0-E2's predicate-removal proof
 * covers it. `visibleToolIds` is required and non-optional on purpose. There
 * is no "unscoped" ranking mode, because an optional visibility argument is
 * exactly the shape a caller forgets to pass.
 */
export interface SessionVisibility {
  /** The output of `visible(session)`. A tool absent from this set is dropped at stage 1 and is never scored. */
  readonly visibleToolIds: ReadonlySet<ToolId>;
  /**
   * The caller's ACTIVE roles — 02 §5.4.2 stage 5, "the tool is in the
   * caller's active role". Separate from `visibleToolIds` because visibility
   * is an intersection of six predicates while this boost reads one specific
   * axis: a tool can be visible through a package or an activation without
   * being in an active role, and that difference is the whole point of the
   * boost. Empty is legal and simply means the boost never fires.
   */
  readonly activeRoleIds: readonly string[];
}

/**
 * Stage 1's structured half — exact-match filters over
 * `CatalogueIndexFilters`. Every field is optional; an omitted field filters
 * nothing. Array-valued fields (`processTags`, `packageTags`, `roles`)
 * require the entry to carry EVERY requested value (AND, not OR): a caller
 * narrowing by two tags means both, and an OR here would silently widen a
 * filter the caller believed narrowed.
 */
export interface RankFilters {
  readonly app?: string;
  readonly module?: string;
  readonly entity?: string;
  readonly verb?: string;
  readonly bindingType?: string;
  readonly archetype?: string;
  readonly sensitivity?: string;
  readonly write?: boolean;
  readonly processTags?: readonly string[];
  readonly packageTags?: readonly string[];
  readonly roles?: readonly string[];
  readonly status?: string;
}

/** One `forge.find` query, as the ranker sees it. */
export interface RankQuery {
  /** The caller's natural-language intent. May be empty; an empty query scores every survivor equally on the lexical channel. */
  readonly text: string;
  readonly filters?: RankFilters;
  /** How many results to return. Ranking is exhaustive; this only truncates the tail. */
  readonly limit?: number;
}

/**
 * Consumption counts, keyed by tool id — stage 5's "tiny tiebreak on
 * consumption count". Supplied by the caller (the gateway reads
 * `audit_call` aggregates through `core/gateway/store/`); this package holds
 * no store dependency and treats a missing id as zero.
 */
export type ConsumptionCounts = ReadonlyMap<ToolId, number>;

/**
 * 02 §5.4.3 — THE SEMANTIC CHANNEL, PLUGGABLE AND UNIMPLEMENTED AT WAVE 0.
 *
 * "Wave 0: lexical only. Measure SA@1 on the benchmark. Record it. Wave 1
 * (the hard gate): if SA@1 is below 90% on the lexical channel alone, enable
 * the embedding channel."
 *
 * There is no implementation of this interface anywhere in the repository and
 * that is the deliverable, not an omission — `./semantic.ts` exports the
 * Wave 0 binding as an explicit `null` and `./semantic.test.ts` asserts it.
 * A Wave 1 implementation embeds the query in-process (`onnxruntime-node`)
 * and takes cosine against vectors precomputed at codegen time; the
 * signature below is synchronous and pure so that fusion, boosts and the
 * benchmark stay reproducible in CI — an implementation that needs a network
 * call cannot satisfy it, which is 02 §5.4.3's "no external embedding API,
 * ever" expressed as a type.
 */
export interface SemanticChannel {
  /** Stable identifier for provenance — recorded alongside a benchmark run so a number can be attributed to a channel. */
  readonly id: string;
  /**
   * Score the survivors of stage 1. Returns a similarity per tool id; a tool
   * omitted from the returned map is treated as unranked by this channel and
   * contributes nothing to fusion (it is NOT treated as a zero-similarity
   * bottom rank). Absolute values are never compared across channels — only
   * the induced ordering reaches fusion.
   */
  score(queryText: string, entries: readonly CatalogueIndexEntry[]): ReadonlyMap<ToolId, number>;
}

/** One channel's output, before fusion: a similarity per tool id. */
export type ChannelScores = ReadonlyMap<ToolId, number>;

/** Every additive component of a result's final score, kept separate so a ranking can be explained and each boost tested in isolation. */
export interface ScoreBreakdown {
  /** Stage 4's normalised reciprocal-rank-fusion score, in (0, 1]. */
  readonly fusion: number;
  /** Stage 5: the query contains a closed-list verb matching this tool's verb. */
  readonly verbMatch: number;
  /** Stage 5: the query names an entity matching this tool's entity. */
  readonly entityMatch: number;
  /** Stage 5: this tool is in one of the caller's active roles. */
  readonly activeRole: number;
  /** Stage 5: the capped consumption tiebreak. Never exceeds `CONSUMPTION_TIEBREAK_CAP`. */
  readonly consumption: number;
  /** Stage 5: negative, applied when `status !== 'resolved'`. */
  readonly statusPenalty: number;
}

/** One ranked tool. */
export interface RankedResult {
  readonly id: ToolId;
  /** The sum of every `breakdown` component. Comparable across queries — this is the scale W0-G3's absolute floor is calibrated on. */
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  readonly entry: CatalogueIndexEntry;
}

/**
 * Stage 6 (02 §5.4.2) — "absolute score floor → `no_tool`; small top-2 margin
 * → disambiguation (§5.5)". **W0-G3 owns this**, at `rank/floor.ts`. It is
 * declared here, and applied in order by `rankTools`, so that the pipeline is
 * literally six stages deep today and W0-G3 is a substitution rather than an
 * insertion. The Wave 0 default is `PASS_THROUGH_FLOOR`, which is not a
 * calibrated floor of zero — it is the explicit absence of one.
 */
export interface FloorPolicy {
  readonly id: string;
  apply(ranked: readonly RankedResult[], query: RankQuery): readonly RankedResult[];
}

/** Everything the pipeline needs beyond the query itself. */
export interface RankContext {
  readonly visibility: SessionVisibility;
  readonly consumption?: ConsumptionCounts;
  /** Wave 0: omitted or `null` — 02 §5.4.3. */
  readonly semanticChannel?: SemanticChannel | null;
  /** Wave 0: omitted — W0-G3 supplies the calibrated policy. */
  readonly floor?: FloorPolicy;
  readonly weights?: Partial<RankWeights>;
}

/** The tunable constants of stage 4 and stage 5. See `./weights.ts` for the value of each and the reasoning behind it. */
export interface RankWeights {
  readonly rrfK: number;
  readonly verbMatch: number;
  readonly entityMatch: number;
  readonly activeRole: number;
  readonly consumptionCap: number;
  readonly consumptionReferenceCount: number;
  readonly statusPenalty: number;
}

export type { CatalogueIndexEntry, CatalogueIndexFilters };
