// MCPForge — binds the synthetic fixture set to the real ranking pipeline and
// runs the sweep. W0-G3.
//
// Separated from `./calibrate.fixture.ts` (data) and `./calibrate.ts`
// (machinery) so that the machinery holds no dependency on `rankTools` and
// can be tested against an analytically-known synthetic scorer. This file is
// the only place the two meet, and it is what produced the committed run at
// `core/registry/calibration/score-floor.calibration.json`.

import { calibrateFloor, sweepRange, type CalibrationResult } from './calibrate.js';
import {
  CALIBRATION_INTENTS,
  CALIBRATION_SA_AT_1_TARGET,
  calibrationIndex,
} from './calibrate.fixture.js';
import { rankTools } from './pipeline.js';
import { seeAll } from './rank.fixtures.js';

/**
 * The swept range: 0 to 2.00 in 0.02 steps (101 candidates).
 *
 * The upper bound is not arbitrary. A result's score is fusion (normalised to
 * (0, 1] — `./fusion.ts`) plus the stage-5 boosts, so the maximum attainable
 * score is 1 + verb 0.25 + entity 0.25 + active role 0.1 + consumption 0.01 =
 * 1.61 (`./weights.ts`). Sweeping to 2.00 therefore contains BOTH degenerate
 * ends — a floor of 0 that never fires, and a floor above every attainable
 * score that always fires — so the recorded run shows the whole curve rather
 * than a window chosen around the answer.
 */
export const CALIBRATION_SWEEP = Object.freeze({ min: 0, max: 2, steps: 100 });

/** Run the sweep over the synthetic fixture world. Deterministic: `rankTools` is a pure function and the fixture set is frozen. */
export function runFixtureCalibration(): CalibrationResult {
  const index = calibrationIndex();
  const visibility = seeAll(index);
  return calibrateFloor(
    CALIBRATION_INTENTS,
    (intent) => rankTools(index, intent.query, { visibility }),
    {
      saAt1Target: CALIBRATION_SA_AT_1_TARGET,
      candidates: sweepRange(CALIBRATION_SWEEP.min, CALIBRATION_SWEEP.max, CALIBRATION_SWEEP.steps),
    },
  );
}
