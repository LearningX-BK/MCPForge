// MCPForge — the ranking constants, and why each has the value it has.
// 02 §5.4.2 stages 4 and 5. W0-G2.
//
// 02 §5.4.2 names every one of these boosts and names none of their values.
// They are therefore JUDGMENT CALLS, and they are gathered in one file with
// their reasoning attached rather than scattered as magic numbers, because
// the one number in this family that IS specified to be calibrated — the
// stage 6 score floor (02 §5.4.4, W0-G3) — is calibrated against the scale
// these constants establish. A reviewer changing one of these must know it
// invalidates a recorded calibration run.
//
// THE SCALE. Fusion is normalised to (0, 1] (see ./fusion.ts) precisely so
// that boosts can be stated as fractions of "a perfect lexical hit" and so
// that W0-G3's floor is an absolute number with a meaning. Raw reciprocal-
// rank-fusion output is not: with k = 60 a rank-1 hit scores 0.0164 and every
// boost below would swamp the entire channel.

import type { RankWeights } from './types.js';

/**
 * Reciprocal rank fusion's damping constant. 60 is the value from Cormack,
 * Clarke & Buettcher (2009), the paper the technique comes from, and it is
 * used unchanged: there is no MCPForge-specific tuning evidence for a
 * different value at Wave 0, and inventing one would be a guess dressed as a
 * decision. Its consequence here is the adjacent-rank gap after
 * normalisation — 1 − 61/62 ≈ 0.0164 between rank 1 and rank 2 — which the
 * consumption cap below is defined against.
 */
export const RRF_K = 60;

/** The normalised fusion gap between two adjacent lexical ranks at the top of the list. Derived, not chosen. */
export const ADJACENT_RANK_GAP = 1 - (RRF_K + 1) / (RRF_K + 2);

/**
 * "+ the query contains a closed-list verb that matches the tool's verb".
 *
 * 0.25 — a quarter of a perfect lexical hit, and large enough to lift a tool
 * from roughly rank 20 of the lexical channel to the top. That is deliberate
 * and it is what 02 §5.4.2 asks for: "the closed verb list and the fixed
 * entity vocabulary mean a large part of a business intent maps to structured
 * fields, not to fuzzy text... a near-exact lookup wearing a natural-language
 * coat." Verb and entity carry equal weight because neither alone identifies
 * a tool — `voucher.get` vs `voucher.search` is settled by the verb,
 * `voucher.create` vs `journal.create` by the entity — and weighting one
 * above the other would systematically favour one half of that pair.
 */
export const VERB_MATCH_BOOST = 0.25;

/** "+ the query names an entity that matches the tool's entity". Equal to the verb boost, for the reason recorded above. */
export const ENTITY_MATCH_BOOST = 0.25;

/**
 * "+ the tool is in the caller's active role".
 *
 * 0.1 — deliberately much smaller than verb or entity. An active role is a
 * statement about the caller's current work, not about what the query means,
 * so it should settle a near-tie between two plausible tools and must never
 * pull a role-resident tool over one the query structurally names. Non-
 * negotiable framing: this is a RANKING preference, never an authorization.
 * Whether the caller may reach the tool at all was decided at stage 1 by
 * `visible(session)`, and a tool outside an active role is still returned —
 * it is merely returned lower.
 */
export const ACTIVE_ROLE_BOOST = 0.1;

/**
 * "+ tiny tiebreak on consumption count (capped, so a popular tool cannot
 * bury a correct rare one)".
 *
 * 0.01, and the value is DERIVED rather than picked: it is strictly less than
 * `ADJACENT_RANK_GAP` (≈ 0.0164), the normalised fusion distance between two
 * neighbouring lexical ranks. That inequality is the guarantee 02 §5.4.2
 * asks for, in its strongest available form — **no consumption history, of
 * any size, can invert two tools that the lexical channel separated by even
 * one rank position.** Popularity can only ever settle an exact tie. It is
 * also a tenth of the smallest deterministic boost, so it can never
 * out-argue an active role, let alone a verb or entity match.
 *
 * Proved directly in `./rank.consumption.test.ts` against a 10^9-call tool.
 */
export const CONSUMPTION_TIEBREAK_CAP = 0.01;

/**
 * The consumption count at which the tiebreak reaches its cap. 1,000 calls —
 * chosen so the signal saturates within the plausible lifetime traffic of a
 * single Oracle tool rather than growing with an unbounded call log, and so
 * the difference between "used routinely" and "used astronomically" is zero.
 * Below it the contribution grows logarithmically, so 10 calls and 100 calls
 * are meaningfully different while 10^3 and 10^9 are not.
 */
export const CONSUMPTION_REFERENCE_COUNT = 1000;

/**
 * "− penalty for status != resolved".
 *
 * −0.15. Larger than the active-role boost and smaller than a verb or entity
 * match: an unresolved or degraded tool should fall below an equally-matched
 * resolved sibling decisively, but a structurally exact match that happens to
 * be unprobed must still be findable and must still outrank a resolved tool
 * the query does not name. It is a demotion, never a filter — suppressing an
 * unresolved tool from `forge.find` is `ProbeEnabled`'s job at stage 1
 * (02 §5.1), and doing it twice, once silently, would hide a probe failure
 * behind a ranking artefact.
 */
export const STATUS_PENALTY = -0.15;

/** The status value that attracts no penalty. 02 §5.4.2: "penalty for status != resolved". */
export const RESOLVED_STATUS = 'resolved';

export const DEFAULT_RANK_WEIGHTS: RankWeights = Object.freeze({
  rrfK: RRF_K,
  verbMatch: VERB_MATCH_BOOST,
  entityMatch: ENTITY_MATCH_BOOST,
  activeRole: ACTIVE_ROLE_BOOST,
  consumptionCap: CONSUMPTION_TIEBREAK_CAP,
  consumptionReferenceCount: CONSUMPTION_REFERENCE_COUNT,
  statusPenalty: STATUS_PENALTY,
});

export function resolveWeights(overrides?: Partial<RankWeights>): RankWeights {
  if (overrides === undefined) return DEFAULT_RANK_WEIGHTS;
  return { ...DEFAULT_RANK_WEIGHTS, ...overrides };
}
