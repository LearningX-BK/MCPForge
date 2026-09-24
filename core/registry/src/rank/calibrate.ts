// MCPForge — the score-floor calibration sweep. 02 §5.4.4. W0-G3.
//
// "Sweep the score floor over the benchmark's negative set, choose the value
// that maximises F1 on negatives **subject to** SA@1 on positives not
// dropping below target. The floor is a committed configuration value with
// the calibration run that produced it."
//
// This module is the MACHINERY. It is deliberately decoupled from
// `rankTools`: it takes a `scoreIntent` function that turns one labelled
// intent into a ranked list, so the same sweep runs over the real index
// (`forge bench`, W0-G6) and over the synthetic fixture set that produced the
// currently committed value. See `./floor.config.ts` for the flag on which of
// those two the committed number came from.
//
// WHAT "F1 ON NEGATIVES" MEANS HERE, stated once so no reader has to infer
// it. The positive class of the F1 is **firing `no_tool`**:
//
//   TP  a negative intent (no correct tool exists) that returns `no_tool`
//   FP  a positive intent (a correct tool exists) that returns `no_tool`
//   FN  a negative intent that returns tools anyway
//
// That is the only assignment under which F1 measures what 02 §5.4.4 wants
// measured: precision punishes a floor that suppresses valid intents
// ("destructive") and recall punishes one that never fires ("useless").
// SA@1 is scored separately and only ever over positives.

import type { RankQuery, RankedResult } from './types.js';

/** A labelled benchmark intent. `expected: null` marks a NEGATIVE — an out-of-catalogue intent whose correct answer is `no_tool` (02 §5.4.4). */
export interface LabelledIntent {
  readonly id: string;
  readonly query: RankQuery;
  /** The tool id that must rank first, or `null` for a negative. */
  readonly expected: string | null;
}

/** Ranks one intent through stages 1–5. The sweep supplies no floor of its own — it applies each candidate floor to this output. */
export type ScoreIntent = (intent: LabelledIntent) => readonly RankedResult[];

/** What one candidate floor scored. */
export interface FloorTrial {
  readonly floor: number;
  /** Selection accuracy at rank 1, over POSITIVES only. In [0, 1]. */
  readonly saAt1: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Whether `saAt1 >= saAt1Target`. Only feasible trials may be chosen. */
  readonly feasible: boolean;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

export interface CalibrationOptions {
  /** The SA@1 floor the constraint enforces. 02 §5.4.4: "subject to SA@1 on positives not dropping below target." */
  readonly saAt1Target: number;
  /** The floors to try, in any order. `sweepRange` builds a linear one. */
  readonly candidates: readonly number[];
}

export interface CalibrationResult {
  /** The winning floor, or `null` when NO candidate satisfied the SA@1 constraint. */
  readonly chosen: number | null;
  /** Why `chosen` is `null`, when it is. Empty string otherwise. */
  readonly unmetReason: string;
  readonly saAt1Target: number;
  readonly positives: number;
  readonly negatives: number;
  /** Every candidate's score, ascending by floor — the run, recorded in full so the choice is auditable and not merely asserted. */
  readonly trials: readonly FloorTrial[];
}

/** A linear sweep of `steps + 1` candidates from `min` to `max` inclusive, rounded to `decimals` so a recorded run is byte-stable. */
export function sweepRange(min: number, max: number, steps: number, decimals = 4): number[] {
  if (steps <= 0) throw new RangeError('sweepRange: steps must be positive');
  if (max < min) throw new RangeError('sweepRange: max must be >= min');
  const factor = 10 ** decimals;
  const out: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    out.push(Math.round((min + ((max - min) * i) / steps) * factor) / factor);
  }
  return out;
}

/** Would this ranked list, under this floor, return `no_tool`? The sweep's only use of the floor — deliberately the same `>=` comparison `isAboveFloor` makes. */
function firesNoTool(ranked: readonly RankedResult[], floor: number): boolean {
  return !ranked.some((r) => r.score >= floor);
}

function f1Of(
  tp: number,
  fp: number,
  fn: number,
): { precision: number; recall: number; f1: number } {
  // A floor that never fires has TP = FP = 0: precision is undefined, and it
  // is reported as 0 rather than 1. Treating "never fires" as perfect
  // precision would make the useless floor win every sweep, which is exactly
  // the outcome 02 §5.4.4 exists to prevent.
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/**
 * Pick the winner from a completed sweep: the midpoint of the widest
 * contiguous run of feasible candidates achieving the maximum F1. `trials`
 * must be ascending by floor — `calibrateFloor` guarantees it. Returns `null`
 * when no candidate is feasible.
 *
 * Exported because the selection rule is the part of the procedure a reviewer
 * is most likely to want to check in isolation against a hand-built trial
 * table, without running a ranker.
 */
export function selectFloor(trials: readonly FloorTrial[]): number | null {
  const feasible = trials.filter((t) => t.feasible);
  if (feasible.length === 0) return null;
  const bestF1 = Math.max(...feasible.map((t) => t.f1));

  let bestRun: FloorTrial[] = [];
  let run: FloorTrial[] = [];
  for (const trial of trials) {
    if (trial.feasible && trial.f1 === bestF1) {
      run.push(trial);
      if (run.length > bestRun.length) bestRun = [...run];
    } else {
      run = [];
    }
  }
  // `bestRun` is non-empty: at least one trial attains `bestF1` and is feasible.
  const midpoint = Math.floor((bestRun.length - 1) / 2);
  return bestRun[midpoint]?.floor ?? null;
}

/**
 * Run the sweep.
 *
 * Ranking happens ONCE per intent, not once per (intent, floor) pair: the
 * floor is a post-filter over stages 1–5, so re-ranking per candidate would
 * be both slower and an opportunity for the sweep to measure something the
 * runtime does not do.
 *
 * TIE-BREAKING, and why it is not "take the lowest". F1 over a finite
 * benchmark is a step function: every floor in the gap between the best
 * negative's score and the worst positive's score scores identically. Taking
 * either edge of that plateau puts the committed value one floating-point
 * step away from a case it was calibrated to separate. The sweep therefore
 * takes the **midpoint of the widest contiguous run of optimal, feasible
 * candidates** — the value furthest from both failure modes and the one most
 * likely to survive the next intent added to the set. On an even-length run
 * the lower-middle candidate is taken, so the tie-break itself errs towards
 * returning a card the agent can reject rather than suppressing a capability
 * that exists.
 */
export function calibrateFloor(
  intents: readonly LabelledIntent[],
  scoreIntent: ScoreIntent,
  options: CalibrationOptions,
): CalibrationResult {
  if (options.candidates.length === 0) {
    throw new RangeError('calibrateFloor: at least one candidate floor is required');
  }

  const ranked = intents.map((intent) => ({ intent, results: scoreIntent(intent) }));
  const positives = ranked.filter((r) => r.intent.expected !== null);
  const negatives = ranked.filter((r) => r.intent.expected === null);

  const candidates = [...new Set(options.candidates)].sort((a, b) => a - b);
  const trials: FloorTrial[] = candidates.map((floor) => {
    let hits = 0;
    let falsePositives = 0;
    for (const { intent, results } of positives) {
      const survivors = results.filter((r) => r.score >= floor);
      if (survivors.length === 0) falsePositives += 1;
      else if (survivors[0]?.id === intent.expected) hits += 1;
    }
    let truePositives = 0;
    let falseNegatives = 0;
    for (const { results } of negatives) {
      if (firesNoTool(results, floor)) truePositives += 1;
      else falseNegatives += 1;
    }
    // SA@1 over an empty positive set is 1 by convention (nothing failed);
    // the caller is warned about an empty set by `positives: 0` in the result.
    const saAt1 = positives.length === 0 ? 1 : hits / positives.length;
    const { precision, recall, f1 } = f1Of(truePositives, falsePositives, falseNegatives);
    return {
      floor,
      saAt1,
      precision,
      recall,
      f1,
      feasible: saAt1 >= options.saAt1Target,
      truePositives,
      falsePositives,
      falseNegatives,
    };
  });

  const chosen = selectFloor(trials);

  return {
    chosen,
    unmetReason:
      chosen === null
        ? `No candidate floor held SA@1 >= ${options.saAt1Target} on ${positives.length} positive intent(s).`
        : '',
    saAt1Target: options.saAt1Target,
    positives: positives.length,
    negatives: negatives.length,
    trials,
  };
}
