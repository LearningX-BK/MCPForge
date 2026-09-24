// MCPForge — stage 6 of the ranking pipeline: the absolute score floor,
// the `no_tool` verdict (02 §5.4.4) and the top-2 margin `choose` block
// (02 §5.5). W0-G3.
//
// FILE LAYOUT of this task (all under `core/registry/src/rank/`, the same
// `src/`-relative reading of TASKS.md's `touches:` that W0-G1 and W0-G2
// already applied and documented):
//
//   floor.ts             this file — the policy, the verdict shapes, the
//                        `choose` rule, the `next` copy.
//   floor.config.ts      THE COMMITTED CONFIGURATION VALUE — one number, its
//                        provenance, and a pointer to the recorded run.
//   calibrate.ts         the sweep: F1 on negatives maximised subject to
//                        SA@1 on positives holding.
//   calibrate.fixture.ts the SYNTHETIC labelled intent set the committed
//                        value was produced from. See the flag in
//                        `floor.config.ts` — it is not steward data.
//   ../../calibration/score-floor.calibration.json
//                        the recorded run, committed, and re-verified against
//                        a fresh sweep by `floor.calibration.test.ts`.
//
// TWO SHAPES, ONE RULE. `FloorPolicy` (declared by W0-G2 in `./types.ts`)
// returns `RankedResult[]` and therefore cannot express `no_tool` or
// `choose`. It is kept exactly as declared — `createScoreFloorPolicy` is a
// drop-in for `PASS_THROUGH_FLOOR` that truncates the below-floor tail, so
// stage 6 remains a real stage inside `rankTools`. The verdict a caller
// (`forge.find`, W0-G4) actually returns is built by `evaluateFloor`, which
// reads the same config and the same predicates. Neither may drift from the
// other: `isAboveFloor` is the single predicate both call.

import { DEFAULT_FLOOR_CONFIG } from './floor.config.js';
import type { FloorPolicy, RankQuery, RankedResult } from './types.js';

/**
 * The two numbers stage 6 runs on.
 *
 * `floor` is calibrated (02 §5.4.4) and lives in `./floor.config.ts` with its
 * run. `margin` is NOT calibrated by that procedure — 02 §5.4.4's sweep is
 * defined over the negative set and says nothing about the top-2 gap — so it
 * is a documented judgment call, recorded at its definition site rather than
 * dressed up as a calibrated constant.
 */
export interface FloorConfig {
  /** A result scoring strictly below this is not returned. At or above it is returned. */
  readonly floor: number;
  /** The top-2 score gap at or below which two sibling results are treated as a near-miss pair (02 §5.5). */
  readonly margin: number;
}

/**
 * 02 §5.4.4's `next` line, verbatim in its operative half.
 *
 * "The `next` line matters as much as the verdict. Telling an agent
 * explicitly *not* to approximate is the difference between a clean miss and
 * a wrong write." The second sentence is therefore a CONSTANT, not a
 * template: no query, catalogue state or caller may alter, soften or omit it.
 * `floor.test.ts` asserts the wording, not merely its presence.
 */
export const DO_NOT_APPROXIMATE = 'Do not attempt to approximate it with another tool.' as const;

/** The intake half of `next` — 03 §9.2 item 5's hand-off from discovery to Business Intake. */
export const RAISE_THROUGH_INTAKE =
  "If this capability should exist, raise it through the MCPForge portal's Business Intake." as const;

/** The complete `next` string. Intake first, then the prohibition — the prohibition ends the line so it is the last thing an agent reads. */
export const NO_TOOL_NEXT = `${RAISE_THROUGH_INTAKE} ${DO_NOT_APPROXIMATE}` as const;

/** One entry of `no_tool.nearest` — 02 §5.4.4's shape exactly: id and score, nothing else. */
export interface NearestCapability {
  readonly id: string;
  readonly score: number;
}

/** 02 §5.4.4. Returned when nothing clears the floor. */
export interface NoToolVerdict {
  readonly result: 'no_tool';
  readonly reason: string;
  readonly nearest: readonly NearestCapability[];
  readonly next: string;
}

/** The ordinary verdict: the surviving results, plus a `choose` line when 02 §5.5's rule fires. */
export interface ToolsVerdict {
  readonly result: 'tools';
  readonly tools: readonly RankedResult[];
  /** Present only when the top two are within `margin` AND share an entity prefix AND carry disambiguation text. */
  readonly choose?: string;
}

export type FindVerdict = NoToolVerdict | ToolsVerdict;

/** How many nearest capabilities a `no_tool` names. Three: enough to show where the catalogue's mass is, few enough to stay inside the card budget. */
export const NEAREST_LIMIT = 3;

/** Scores are reported to this many decimals, matching 02 §5.4.4's `"score": 0.21`. */
const SCORE_PRECISION = 2;

function roundScore(score: number): number {
  const factor = 10 ** SCORE_PRECISION;
  return Math.round(score * factor) / factor;
}

/** The single floor predicate. Both `createScoreFloorPolicy` and `evaluateFloor` call it; nothing else compares a score to a floor. */
export function isAboveFloor(result: RankedResult, config: FloorConfig): boolean {
  return result.score >= config.floor;
}

/**
 * The `{app}.{module}.{entity}` prefix of a tool id (CLAUDE.md §5:
 * `{app}.{module}.{entity}.{verb}`, and ids are immutable). Returns `null`
 * for an id that is not four segments — a malformed id must never be read as
 * "shares a prefix with everything", which is what a lenient split would do.
 *
 * The prefix is taken from the ID, not from `entry.filters`, because it is
 * the id shape that `forge validate`'s mutual-`disambiguation` rule (02 §5.5
 * item 1) is written against; reading a different field here would let the
 * two rules disagree about what a sibling is.
 */
export function entityPrefix(id: string): string | null {
  const parts = id.split('.');
  if (parts.length !== 4) return null;
  if (parts.some((p) => p.length === 0)) return null;
  return parts.slice(0, 3).join('.');
}

/** Two tool ids are near-miss siblings when both parse and their `{app}.{module}.{entity}` prefixes are equal. */
export function sharesEntityPrefix(a: string, b: string): boolean {
  const pa = entityPrefix(a);
  if (pa === null) return false;
  return pa === entityPrefix(b);
}

/**
 * 02 §5.5 item 2 — "when the top two results are within the margin **and**
 * share an entity prefix, `forge.find` returns both cards plus a `choose`
 * block".
 *
 * Returns the block's text, or `null` when the rule does not fire. Three ways
 * it does not fire, and the third is the one that matters:
 *
 *  - fewer than two results, or the top-2 gap exceeds the margin;
 *  - the top two do not share an `{app}.{module}.{entity}` prefix — a close
 *    `voucher.get` / `journal.get` pair is a ranking near-tie, not a
 *    near-miss pair, and 02 §5.5 is specifically about siblings;
 *  - neither result carries `disambiguation` text. The text is authored by a
 *    steward and required by `forge validate` on any sibling pair; when it is
 *    genuinely absent the correct behaviour is to return both cards with NO
 *    `choose` block, because the alternative is to synthesise guidance about
 *    a write path from field values, which is the one thing agent-facing copy
 *    may not be.
 */
export function chooseBlock(ranked: readonly RankedResult[], config: FloorConfig): string | null {
  const [first, second] = ranked;
  if (first === undefined || second === undefined) return null;
  if (first.score - second.score > config.margin) return null;
  if (!sharesEntityPrefix(first.id, second.id)) return null;

  const texts: string[] = [];
  for (const r of [first, second]) {
    const text = r.entry.disambiguation;
    if (text !== null && text.trim() !== '' && !texts.includes(text.trim())) {
      texts.push(text.trim());
    }
  }
  if (texts.length === 0) return null;
  return texts.join(' ');
}

/**
 * The `reason` of a `no_tool`. 02 §5.4.4's example names what is not covered
 * and where the nearest capabilities sit — "The closest capabilities are in
 * AP and GL, which do not touch payroll."
 *
 * Composed only from values the catalogue actually holds (the query text and
 * the nearest tools' `{app}.{module}` labels). It does not assert what the
 * query was ABOUT — an inference this code cannot make — so the sentence
 * names the request rather than classifying it.
 */
export function noToolReason(queryText: string, nearest: readonly RankedResult[]): string {
  const trimmed = queryText.trim();
  const head =
    trimmed === ''
      ? 'No tool in this catalogue covers this request.'
      : `No tool in this catalogue covers "${trimmed}".`;
  const areas: string[] = [];
  for (const r of nearest) {
    const label = `${r.entry.filters.app}.${r.entry.filters.module}`;
    if (!areas.includes(label)) areas.push(label);
  }
  if (areas.length === 0) {
    return `${head} The catalogue holds no comparable capability.`;
  }
  const list =
    areas.length === 1
      ? areas[0]
      : `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
  return `${head} The closest capabilities are in ${list}, and none of them covers it.`;
}

/**
 * Stage 6 as `rankTools` runs it: drop everything below the floor. Ordering
 * and scores are untouched — this stage removes, it never re-ranks.
 *
 * A pipeline that returns an empty array is NOT the `no_tool` verdict; it is
 * the input to it. `evaluateFloor` builds the verdict, because only it can
 * see the below-floor tail that `nearest` is drawn from.
 */
export function createScoreFloorPolicy(config: FloorConfig = DEFAULT_FLOOR_CONFIG): FloorPolicy {
  return {
    id: `score-floor@${config.floor}`,
    apply: (ranked) => ranked.filter((r) => isAboveFloor(r, config)),
  };
}

/**
 * Build the verdict `forge.find` returns, from the FULL ranked list — the
 * output of stages 1–5, before stage 6 truncation.
 *
 * `limit` truncates the returned cards only; it never affects whether the
 * floor or the margin fired, so an agent asking for one card and an agent
 * asking for five get the same verdict about whether a tool exists.
 */
export function evaluateFloor(
  ranked: readonly RankedResult[],
  query: RankQuery,
  config: FloorConfig = DEFAULT_FLOOR_CONFIG,
): FindVerdict {
  const above = ranked.filter((r) => isAboveFloor(r, config));

  if (above.length === 0) {
    const nearest = ranked.slice(0, NEAREST_LIMIT);
    return {
      result: 'no_tool',
      reason: noToolReason(query.text, nearest),
      nearest: nearest.map((r) => ({ id: r.id, score: roundScore(r.score) })),
      next: NO_TOOL_NEXT,
    };
  }

  // The `choose` rule reads the top two SURVIVORS. A below-floor result is
  // not a candidate the agent is being asked to choose between.
  const choose = chooseBlock(above, config);
  const limit = query.limit;
  const tools =
    limit !== undefined && limit >= 0 && limit < above.length ? above.slice(0, limit) : above;

  return choose === null ? { result: 'tools', tools } : { result: 'tools', tools, choose };
}
