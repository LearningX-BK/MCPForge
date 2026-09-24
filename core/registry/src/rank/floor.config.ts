// MCPForge — THE COMMITTED SCORE-FLOOR CONFIGURATION. 02 §5.4.4. W0-G3.
//
// "The floor is a committed configuration value with the calibration run that
// produced it. This is what stops `no_tool` becoming either useless (never
// fires) or destructive (fires on valid intents)."
//
// The value below is not a constant a developer chose. It is the output of
// `runFixtureCalibration()` (`./calibrate.fixture.run.ts`), and the full run
// — every candidate, its SA@1, precision, recall and F1 — is committed at
//
//     core/registry/calibration/score-floor.calibration.json
//
// `floor.calibration.test.ts` re-runs the sweep and fails if either this
// value or that artefact drifts from what the sweep produces today. A change
// to any ranking weight in `./weights.ts` therefore breaks the build with a
// message naming the calibration, which is the intended behaviour: a weight
// change invalidates the run that produced the floor.
//
// ############################################################################
// #  OPEN FLAG FOR A HUMAN — W0-HG5 / W0-HG7.                               #
// #                                                                          #
// #  THE RUN THAT PRODUCED THIS NUMBER USED SYNTHETIC INTENTS, NOT STEWARD   #
// #  INTENTS. `evals/` holds only `.gitkeep`; the ≥30 real benchmark intents #
// #  are W0-HG7, a human deliverable that does not exist yet. The sweep      #
// #  machinery is real and tested; the DATA it swept is a hand-written       #
// #  fixture of 8 positives and 4 negatives (`./calibrate.fixture.ts`).      #
// #                                                                          #
// #  This value is therefore a PLACEHOLDER pending W0-HG5, whose gate reads: #
// #  "A human signs off the chosen value and the run that produced it, and   #
// #  both are recorded in the checkpoint artefact." Re-run the sweep against #
// #  the real `evals/` set before that sign-off; do not sign off this one.   #
// ############################################################################

import type { FloorConfig } from './floor.js';

/**
 * The calibrated absolute score floor. Produced by the sweep, not chosen:
 * on the fixture set every candidate in [1.02, 1.24] attains F1 = 1.0 on the
 * negative set with SA@1 = 1.0 on the positives, and 1.12 is that plateau's
 * midpoint.
 *
 * What the number MEANS on this scale is worth stating, because it is the
 * property a reviewer should sanity-check rather than the digits. A result's
 * score is normalised fusion — at most 1.0, and 1.0 for whatever the lexical
 * channel ranked first, however weak the match — plus the stage-5 structured
 * boosts. A floor above 1.0 is therefore the statement 02 §5.4.2 already
 * makes in prose: **being the best of a bad lexical field is not enough; the
 * query must also name this tool's verb or its entity.** That is why the
 * plateau sits where it does, and it is why the floor generalises past the
 * fixture better than its provenance alone would suggest.
 */
export const CALIBRATED_SCORE_FLOOR = 1.12;

/**
 * The top-2 margin for the `choose` block (02 §5.5).
 *
 * JUDGMENT CALL, recorded as one. 02 §5.4.4's calibration procedure is
 * defined over the negative set and produces the FLOOR; it says nothing about
 * the margin, and there is no near-miss-pair benchmark to sweep against until
 * W0-HG7 supplies one (02 §5.5: "Phase 1 requires ≥20% near-miss pairs").
 *
 * 0.05 is derived rather than picked: it is half of `ACTIVE_ROLE_BOOST` (0.1,
 * `./weights.ts`), the smallest structural boost in the pipeline. A gap
 * smaller than half that boost cannot be attributed to any single structured
 * signal — it is lexical noise — so two siblings separated by less than it
 * are genuinely undistinguished by the ranker and the agent deserves the
 * disambiguation line. A gap of 0.1 or more, by contrast, means at least one
 * structural signal fired for one sibling and not the other, and the ranker
 * has actually made a decision.
 *
 * When W0-HG7's near-miss pairs land, this becomes sweepable on the same
 * machinery and should be swept.
 */
export const CHOOSE_MARGIN = 0.05;

/** The configuration stage 6 runs on unless a caller overrides it. */
export const DEFAULT_FLOOR_CONFIG: FloorConfig = Object.freeze({
  floor: CALIBRATED_SCORE_FLOOR,
  margin: CHOOSE_MARGIN,
});
