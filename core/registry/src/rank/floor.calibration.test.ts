// MCPForge — the committed floor and the committed run must both still be
// what the sweep produces. 02 §5.4.4. W0-G3.
//
// This is the test that makes "a committed configuration value with the
// calibration run that produced it" enforceable rather than aspirational. If
// a ranking weight, a boost, the fixture set or the sweep range changes, the
// committed floor stops being the sweep's answer and this test fails — which
// is correct: that change invalidated the calibration.
//
// To re-record after a deliberate change: run the sweep, put the new
// `chosen` in `./floor.config.ts`, and rewrite the artefact from
// `buildCalibrationRecord()`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCalibrationRecord, SYNTHETIC_DATASET_WARNING } from './calibration.record.js';
import { CALIBRATED_SCORE_FLOOR, CHOOSE_MARGIN, DEFAULT_FLOOR_CONFIG } from './floor.config.js';
import { ACTIVE_ROLE_BOOST } from './weights.js';
import { runFixtureCalibration } from './calibrate.fixture.run.js';
import { CALIBRATION_INTENTS } from './calibrate.fixture.js';

const ARTEFACT = fileURLToPath(
  new URL('../../calibration/score-floor.calibration.json', import.meta.url),
);

describe('the committed score floor', () => {
  const run = runFixtureCalibration();

  it('is the value the sweep chooses — not a constant a human picked', () => {
    expect(run.chosen).not.toBeNull();
    expect(CALIBRATED_SCORE_FLOOR).toBe(run.chosen);
  });

  it('sits on a plateau where F1 on negatives is maximal and SA@1 on positives holds', () => {
    const chosen = run.trials.find((t) => t.floor === CALIBRATED_SCORE_FLOOR);
    expect(chosen).toBeDefined();
    expect(chosen?.feasible).toBe(true);
    expect(chosen?.saAt1).toBeGreaterThanOrEqual(run.saAt1Target);
    const bestF1 = Math.max(...run.trials.filter((t) => t.feasible).map((t) => t.f1));
    expect(chosen?.f1).toBe(bestF1);
  });

  it('is neither useless nor destructive on the set it was calibrated against', () => {
    const chosen = run.trials.find((t) => t.floor === CALIBRATED_SCORE_FLOOR);
    // Useless = never fires: no negative suppressed.
    expect(chosen?.truePositives).toBeGreaterThan(0);
    // Destructive = fires on valid intents.
    expect(chosen?.falsePositives).toBe(0);
  });

  it('sweeps a range containing both degenerate ends, so the plateau is bounded on both sides', () => {
    expect(run.trials[0]?.f1).toBe(0); // floor 0 — never fires
    expect(run.trials[run.trials.length - 1]?.feasible).toBe(false); // above every attainable score
  });

  it('was calibrated over both classes — a sweep with no negatives measures nothing', () => {
    expect(run.positives).toBe(CALIBRATION_INTENTS.filter((i) => i.expected !== null).length);
    expect(run.negatives).toBeGreaterThan(0);
    // 02 §5.4.4: "≥10% of benchmark cases" are negatives.
    expect(run.negatives / (run.positives + run.negatives)).toBeGreaterThanOrEqual(0.1);
  });

  it('is the floor the default configuration uses', () => {
    expect(DEFAULT_FLOOR_CONFIG.floor).toBe(CALIBRATED_SCORE_FLOOR);
    expect(DEFAULT_FLOOR_CONFIG.margin).toBe(CHOOSE_MARGIN);
  });
});

describe('the choose margin', () => {
  // Not calibrated (02 §5.4.4's procedure is defined over the negative set),
  // and derived rather than picked. The derivation is asserted so that a
  // change to ACTIVE_ROLE_BOOST cannot silently orphan the reasoning recorded
  // in floor.config.ts.
  it('is half the smallest structural boost', () => {
    expect(CHOOSE_MARGIN).toBe(ACTIVE_ROLE_BOOST / 2);
  });
});

describe('the recorded run artefact', () => {
  const onDisk: unknown = JSON.parse(readFileSync(ARTEFACT, 'utf8'));
  const fresh = buildCalibrationRecord();

  it('is committed and reproduces exactly', () => {
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('records the value, the constraint, the objective and every trial', () => {
    expect(fresh.result.chosen).toBe(CALIBRATED_SCORE_FLOOR);
    expect(fresh.committed.floor).toBe(CALIBRATED_SCORE_FLOOR);
    expect(fresh.constraint.metric).toBe('saAt1');
    expect(fresh.result.trials.length).toBe(fresh.sweep.steps + 1);
  });

  // The provenance flag is part of the artefact's contract, not a comment:
  // whoever signs W0-HG5 must be unable to read this file without meeting it.
  it('declares on its face that the dataset is synthetic and unsigned', () => {
    expect(fresh.dataset.synthetic).toBe(true);
    expect(fresh.dataset.warning).toBe(SYNTHETIC_DATASET_WARNING);
    expect(fresh.dataset.warning).toContain('PLACEHOLDER');
    expect(fresh.dataset.warning).toContain('W0-HG7');
    expect(fresh.dataset.warning).toContain('W0-HG5');
    expect(fresh.committed.marginSwept).toBe(false);
  });
});
