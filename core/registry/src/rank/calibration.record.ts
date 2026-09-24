// MCPForge — the recorded calibration run, as a data structure. W0-G3.
//
// 02 §5.4.4 requires the floor to be "a committed configuration value with
// the calibration run that produced it". This module builds that record; the
// committed copy lives at `core/registry/calibration/score-floor.calibration.json`
// and `./floor.calibration.test.ts` asserts the two are identical, so the
// artefact can never quietly become a stale claim about a run that no longer
// reproduces.

import { CALIBRATED_SCORE_FLOOR, CHOOSE_MARGIN } from './floor.config.js';
import {
  CALIBRATION_DATASET_ID,
  CALIBRATION_INTENTS,
  CALIBRATION_SA_AT_1_TARGET,
} from './calibrate.fixture.js';
import { CALIBRATION_SWEEP, runFixtureCalibration } from './calibrate.fixture.run.js';
import type { CalibrationResult } from './calibrate.js';

export interface CalibrationRecord {
  readonly task: string;
  readonly procedure: string;
  readonly dataset: {
    readonly id: string;
    readonly synthetic: true;
    readonly warning: string;
    readonly positives: number;
    readonly negatives: number;
    readonly intentIds: readonly string[];
  };
  readonly sweep: { readonly min: number; readonly max: number; readonly steps: number };
  readonly constraint: { readonly metric: 'saAt1'; readonly target: number };
  readonly objective: string;
  readonly committed: {
    readonly floor: number;
    readonly margin: number;
    readonly marginSwept: false;
  };
  readonly result: CalibrationResult;
}

/** The dataset warning, carried INSIDE the artefact so a reader who opens only the JSON cannot miss it. */
export const SYNTHETIC_DATASET_WARNING =
  'PLACEHOLDER. Swept over a hand-written synthetic intent set, not the steward-authored benchmark (W0-HG7), which did not exist when this run was recorded (evals/ held only .gitkeep). Not signed off. W0-HG5 requires a human to sign off a floor and the run that produced it; re-run this sweep against the real evals/ intents before that sign-off.';

export function buildCalibrationRecord(): CalibrationRecord {
  const result = runFixtureCalibration();
  return {
    task: 'W0-G3',
    procedure:
      '02 §5.4.4 — sweep the score floor over the benchmark, maximise F1 on the negative set subject to SA@1 on positives holding at target.',
    dataset: {
      id: CALIBRATION_DATASET_ID,
      synthetic: true,
      warning: SYNTHETIC_DATASET_WARNING,
      positives: result.positives,
      negatives: result.negatives,
      intentIds: CALIBRATION_INTENTS.map((i) => i.id),
    },
    sweep: { ...CALIBRATION_SWEEP },
    constraint: { metric: 'saAt1', target: CALIBRATION_SA_AT_1_TARGET },
    objective:
      'F1 with "fires no_tool" as the positive class: TP = negative returning no_tool, FP = positive returning no_tool, FN = negative returning tools.',
    committed: { floor: CALIBRATED_SCORE_FLOOR, margin: CHOOSE_MARGIN, marginSwept: false },
    result,
  };
}
