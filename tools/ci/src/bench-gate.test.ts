// W0-G7 — `forge ci` stage 10, the discovery-benchmark regression gate.
//
// Every test here drives the gate through an INJECTED runner rather than
// spawning the real CLI: this package's spawning tests are the ones that flake
// under parallel load, and the gate's logic is a pure function of two JSON
// documents by design (see bench-gate.ts's header).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASELINE_RELATIVE_PATH,
  evaluateBenchGate,
  runBenchRegressionGate,
  type BenchJsonReport,
} from './bench-gate.js';
import { STAGES } from './stages.js';

const SUMMARY = { 'sa1.overall': 0.9, 'ttfc.core-hit.max': 1890, 'vtc.max': 16 };

const REPORT: BenchJsonReport = {
  ok: true,
  gates: [
    { id: 'ttfc.core-hit', metric: 'TTFC', limit: 2000, observed: 1890, ok: true, source: '02 §5.7 Case A', detail: '' },
    { id: 'vtc.hard-cap', metric: 'VTC', limit: 30, observed: 16, ok: true, source: '02 §5.10', detail: '' },
  ],
  summary: SUMMARY,
};

const BASELINE = {
  schemaVersion: 1,
  coverage: { toolsInCatalogue: 6, intents: 12, servers: 2, rolesWithManifest: 1 },
  summary: SUMMARY,
  notes: [],
};

let dirs: string[] = [];
function fixtureRoot(baseline?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-bench-gate-'));
  dirs.push(dir);
  if (baseline !== undefined) {
    mkdirSync(join(dir, 'evals'), { recursive: true });
    writeFileSync(join(dir, BASELINE_RELATIVE_PATH), JSON.stringify(baseline), 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('W0-G7 — stage 10 is the doc-designated slot, not a new stage', () => {
  it('02 §7.2\'s fixed 11-stage table is unchanged and stage 10 now has a real run', () => {
    // 15, not 11, since W0-J21 added stages 14-17 (the 03 §12.7 accessibility
    // gates) — 02 §7.2's own 11-stage table (ids 1-11) is otherwise unchanged.
    expect(STAGES.filter((s) => s.id <= 11)).toHaveLength(11);
    const stage = STAGES.find((s) => s.id === 10)!;
    expect(stage.name).toBe('Discovery benchmark, rank-1 mode');
    expect(stage.failsOn).toContain('regression in TTFC, VTC, DH, SA@1, or MTB');
  });

  // The assertion that this module's SUMMARY_DIRECTIONS mirror the CLI's
  // lives in tests/bench/metrics.test.ts, not here: `@mcpforge/cli` already
  // depends on `@mcpforge/ci`, so importing the CLI from this package — even
  // in a test — would be a workspace dependency cycle. `tests/bench` is a
  // leaf and can safely depend on both sides of the boundary.
});

describe('W0-G7 — the verdict', () => {
  it('a clean run against an identical baseline passes', () => {
    const v = evaluateBenchGate(REPORT, BASELINE);
    expect(v.ok).toBe(true);
    expect(v.comparedMetrics).toBe(3);
  });

  it('a breached ABSOLUTE gate fails even when nothing regressed', () => {
    const breached: BenchJsonReport = {
      ...REPORT,
      gates: [{ ...REPORT.gates![0]!, observed: 2400, ok: false }],
    };
    const v = evaluateBenchGate(breached, BASELINE);
    expect(v.ok).toBe(false);
    expect(v.breachedGates.map((g) => g.id)).toEqual(['ttfc.core-hit']);
  });

  it('a regression fails even when every absolute gate is within budget', () => {
    const worse: BenchJsonReport = { ...REPORT, summary: { ...SUMMARY, 'ttfc.core-hit.max': 1950 } };
    const v = evaluateBenchGate(worse, BASELINE);
    expect(v.ok).toBe(false);
    expect(v.regressions).toEqual([
      { metric: 'ttfc.core-hit.max', direction: 'lower', baseline: 1890, current: 1950 },
    ]);
  });

  it('a drop in SA@1 is a regression; a rise is not', () => {
    expect(evaluateBenchGate({ ...REPORT, summary: { ...SUMMARY, 'sa1.overall': 0.8 } }, BASELINE).ok).toBe(false);
    expect(evaluateBenchGate({ ...REPORT, summary: { ...SUMMARY, 'sa1.overall': 0.95 } }, BASELINE).ok).toBe(true);
  });

  it('an unknown metric is treated as lower-is-better rather than ignored', () => {
    const base = { ...BASELINE, summary: { ...SUMMARY, 'brand.new.metric': 10 } };
    const v = evaluateBenchGate({ ...REPORT, summary: { ...SUMMARY, 'brand.new.metric': 11 } }, base);
    expect(v.regressions.map((r) => r.metric)).toEqual(['brand.new.metric']);
  });
});

describe('W0-G7 — the stage, end to end', () => {
  const runner = (report: unknown, code = 0) => () => ({ code, stdout: `${JSON.stringify(report)}\n`, stderr: '' });

  it('passes on a clean run and says so', () => {
    const out = runBenchRegressionGate(fixtureRoot(BASELINE), runner(REPORT));
    expect(out.status).toBe('passed');
    expect(out.detail).toContain('no regression');
  });

  it('names the provisional baseline in its pass detail rather than implying discovery is proven', () => {
    const provisional = { ...BASELINE, coverage: { toolsInCatalogue: 0, intents: 0, servers: 0, rolesWithManifest: 0 } };
    const out = runBenchRegressionGate(fixtureRoot(provisional), runner({ ...REPORT, summary: SUMMARY }));
    expect(out.status).toBe('passed');
    expect(out.detail).toContain('PROVISIONAL');
  });

  it('FAILS CLOSED when the baseline file is absent — never a silent skip', () => {
    const out = runBenchRegressionGate(fixtureRoot(), runner(REPORT));
    expect(out.status).toBe('failed');
    expect(out.detail).toContain('forge bench --record-baseline');
  });

  it('fails when the baseline is not readable JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-bench-gate-bad-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'evals'), { recursive: true });
    writeFileSync(join(dir, BASELINE_RELATIVE_PATH), '{ not json', 'utf8');
    expect(runBenchRegressionGate(dir, runner(REPORT)).status).toBe('failed');
  });

  it('fails when forge bench itself exits non-zero', () => {
    const out = runBenchRegressionGate(fixtureRoot(BASELINE), runner(REPORT, 3));
    expect(out.status).toBe('failed');
    expect(out.detail).toContain('exited 3');
  });

  it('fails when forge bench returns an error envelope rather than a report', () => {
    const out = runBenchRegressionGate(
      fixtureRoot(BASELINE),
      runner({ ok: false, code: 'CATALOGUE_UNAVAILABLE', message: 'x', next: 'y' }),
    );
    expect(out.status).toBe('failed');
    expect(out.detail).toContain('error envelope');
  });

  it('fails when stdout is not parseable JSON', () => {
    const out = runBenchRegressionGate(fixtureRoot(BASELINE), () => ({ code: 0, stdout: 'not json', stderr: '' }));
    expect(out.status).toBe('failed');
    expect(out.detail).toContain('did not emit parseable JSON');
  });

  it('a failing detail always names an action, never "try again" (non-negotiable 5)', () => {
    const worse: BenchJsonReport = { ...REPORT, summary: { ...SUMMARY, 'vtc.max': 20 } };
    const out = runBenchRegressionGate(fixtureRoot(BASELINE), runner(worse));
    expect(out.status).toBe('failed');
    expect(out.detail).toContain('next:');
    expect(out.detail).not.toMatch(/try again/i);
  });
});
