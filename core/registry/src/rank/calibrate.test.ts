// MCPForge — the calibration sweep itself. 02 §5.4.4. W0-G3.
//
// The sweep is tested against a HAND-BUILT scorer with an analytically known
// answer, not against the ranker: the property under test is "the sweep finds
// the F1-maximising floor subject to the SA@1 constraint", and mixing the
// ranker into that would test two things at once and pin the expected answer
// to BM25's arithmetic.

import { describe, expect, it } from 'vitest';
import {
  calibrateFloor,
  selectFloor,
  sweepRange,
  type FloorTrial,
  type LabelledIntent,
} from './calibrate.js';
import type { RankedResult } from './types.js';

/** A ranked list at fixed scores. Only `id` and `score` are read by the sweep. */
function ranking(...pairs: readonly (readonly [string, number])[]): readonly RankedResult[] {
  return pairs.map(([id, score]) => ({
    id,
    score,
    breakdown: {
      fusion: score,
      verbMatch: 0,
      entityMatch: 0,
      activeRole: 0,
      consumption: 0,
      statusPenalty: 0,
    },
    entry: {
      id,
      filters: {
        app: 'jde',
        module: 'ap',
        entity: 'voucher',
        verb: 'get',
        bindingType: 'function',
        archetype: 'transactional',
        sensitivity: 'financial',
        write: false,
        processTags: [],
        packageTags: [],
        roles: [],
        status: 'resolved',
      },
      lexicalDocument: id,
      disambiguation: null,
    },
  }));
}

describe('sweepRange', () => {
  it('is inclusive of both ends and stable to four decimals', () => {
    expect(sweepRange(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sweepRange(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('refuses a degenerate sweep rather than returning one silently', () => {
    expect(() => sweepRange(0, 1, 0)).toThrow(RangeError);
    expect(() => sweepRange(1, 0, 4)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// THE ANALYTIC CASE.
//
// Four positives whose correct tool scores 0.90, and whose runner-up scores
// 0.40. Four negatives whose best (wrong) tool scores 0.50. Therefore, over
// the candidate grid 0.00 … 1.00 in 0.05 steps:
//
//   floor ≤ 0.50 : every negative still returns a tool  → TP 0, recall 0, F1 0
//   0.55 ≤ floor ≤ 0.90 : negatives all suppressed, positives all survive and
//                         rank correctly → SA@1 = 1, precision = recall = 1,
//                         F1 = 1. THE OPTIMAL PLATEAU, eight candidates wide:
//                         0.55 0.60 0.65 0.70 0.75 0.80 0.85 0.90.
//   floor > 0.90 : every positive suppressed → SA@1 = 0, infeasible.
//
// The lower-middle of an eight-wide plateau is index 3 → 0.70. That is the
// number the sweep must return, and it is derivable by hand from the two
// sentences above.
// ---------------------------------------------------------------------------
const ANALYTIC_INTENTS: readonly LabelledIntent[] = [
  { id: 'p1', query: { text: 'p1' }, expected: 'jde.ap.voucher.get' },
  { id: 'p2', query: { text: 'p2' }, expected: 'jde.ap.voucher.get' },
  { id: 'p3', query: { text: 'p3' }, expected: 'jde.ap.voucher.get' },
  { id: 'p4', query: { text: 'p4' }, expected: 'jde.ap.voucher.get' },
  { id: 'n1', query: { text: 'n1' }, expected: null },
  { id: 'n2', query: { text: 'n2' }, expected: null },
  { id: 'n3', query: { text: 'n3' }, expected: null },
  { id: 'n4', query: { text: 'n4' }, expected: null },
];

const analyticScorer = (intent: LabelledIntent): readonly RankedResult[] =>
  intent.expected === null
    ? ranking(['jde.ap.supplier.get', 0.5], ['jde.gl.journal.get', 0.3])
    : ranking(['jde.ap.voucher.get', 0.9], ['jde.ap.voucher.search', 0.4]);

describe('calibrateFloor — the analytic case', () => {
  const result = calibrateFloor(ANALYTIC_INTENTS, analyticScorer, {
    saAt1Target: 0.9,
    candidates: sweepRange(0, 1, 20),
  });

  it('finds the plateau midpoint, 0.70', () => {
    expect(result.chosen).toBe(0.7);
    expect(result.unmetReason).toBe('');
    expect(result.positives).toBe(4);
    expect(result.negatives).toBe(4);
  });

  it('records every candidate, ascending, with no duplicates', () => {
    expect(result.trials).toHaveLength(21);
    const floors = result.trials.map((t) => t.floor);
    expect([...floors].sort((a, b) => a - b)).toEqual(floors);
    expect(new Set(floors).size).toBe(floors.length);
  });

  it('scores the three regimes exactly as the arithmetic says', () => {
    const trial = (floor: number): FloorTrial => {
      const t = result.trials.find((x) => x.floor === floor);
      if (t === undefined) throw new Error(`no trial at ${floor}`);
      return t;
    };
    // Useless: never fires.
    expect(trial(0.5)).toMatchObject({ saAt1: 1, truePositives: 0, falseNegatives: 4, f1: 0 });
    // Optimal.
    expect(trial(0.7)).toMatchObject({
      saAt1: 1,
      precision: 1,
      recall: 1,
      f1: 1,
      feasible: true,
      falsePositives: 0,
    });
    // Destructive: fires on every valid intent.
    expect(trial(0.95)).toMatchObject({ saAt1: 0, falsePositives: 4, feasible: false });
  });

  it('gives the "never fires" floor F1 = 0, not perfect precision', () => {
    const zero = result.trials.find((t) => t.floor === 0);
    expect(zero?.precision).toBe(0);
    expect(zero?.f1).toBe(0);
  });

  it('is subject to the constraint: a higher-F1 but infeasible floor is not chosen', () => {
    // Raise the target above what any floor achieves once one positive is a
    // miss, and the plateau is the only feasible region — unchanged. Lower it
    // to 0 and the answer is still the plateau, because F1 is the objective.
    for (const target of [0, 0.5, 1]) {
      const r = calibrateFloor(ANALYTIC_INTENTS, analyticScorer, {
        saAt1Target: target,
        candidates: sweepRange(0, 1, 20),
      });
      expect(r.chosen).toBe(0.7);
    }
  });

  it('reports no floor at all when the constraint cannot be met', () => {
    // Every positive's correct tool scores 0.90, so a grid starting at 0.95
    // suppresses all of them: SA@1 = 0 everywhere, and 0 < 0.9.
    const r = calibrateFloor(ANALYTIC_INTENTS, analyticScorer, {
      saAt1Target: 0.9,
      candidates: sweepRange(0.95, 1.5, 5),
    });
    expect(r.chosen).toBeNull();
    expect(r.unmetReason).toContain('SA@1 >= 0.9');
    expect(r.unmetReason).toContain('4 positive intent(s)');
  });

  it('counts a positive that survives but ranks second as an SA@1 miss, not a false positive', () => {
    const wrongOrder = (intent: LabelledIntent): readonly RankedResult[] =>
      intent.expected === null
        ? ranking(['jde.ap.supplier.get', 0.5])
        : ranking(['jde.ap.voucher.search', 0.9], ['jde.ap.voucher.get', 0.8]);
    const r = calibrateFloor(ANALYTIC_INTENTS, wrongOrder, {
      saAt1Target: 0.9,
      candidates: [0.7],
    });
    expect(r.trials[0]?.saAt1).toBe(0);
    expect(r.trials[0]?.falsePositives).toBe(0);
    expect(r.chosen).toBeNull();
  });

  it('refuses an empty candidate grid', () => {
    expect(() =>
      calibrateFloor(ANALYTIC_INTENTS, analyticScorer, { saAt1Target: 0.9, candidates: [] }),
    ).toThrow(RangeError);
  });
});

describe('selectFloor', () => {
  const trial = (floor: number, f1: number, feasible = true): FloorTrial => ({
    floor,
    saAt1: feasible ? 1 : 0,
    precision: f1,
    recall: f1,
    f1,
    feasible,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
  });

  it('takes the midpoint of the WIDEST optimal run, not the first one it meets', () => {
    expect(
      selectFloor([
        trial(0.1, 1),
        trial(0.2, 0.4),
        trial(0.3, 1),
        trial(0.4, 1),
        trial(0.5, 1),
        trial(0.6, 0.2),
      ]),
    ).toBe(0.4);
  });

  it('takes the lower middle of an even-length run', () => {
    expect(selectFloor([trial(0.1, 1), trial(0.2, 1)])).toBe(0.1);
  });

  it('ignores an infeasible candidate however high its F1', () => {
    expect(selectFloor([trial(0.1, 0.5), trial(0.2, 1, false)])).toBe(0.1);
  });

  it('returns null when nothing is feasible', () => {
    expect(selectFloor([trial(0.1, 1, false)])).toBeNull();
    expect(selectFloor([])).toBeNull();
  });
});
