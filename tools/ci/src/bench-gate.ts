// `forge ci` stage 10 — the discovery-benchmark regression gate. W0-G7,
// 02 §5.7, §5.9, §5.10.
//
// WHICH STAGE, AND WHY NOT A NEW ONE. 02 §7.2's stage table is fixed at 13
// rows (11 of them local) and stage 10 is already named "Discovery benchmark,
// rank-1 mode", failing on "regression in TTFC, VTC, DH, SA@1, or MTB against
// the recorded baseline" — the exact sentence of this task's `done:`. Until
// now it carried `notImplemented('W0-G7')`. This module is what that slot was
// holding open. No stage is added, renumbered or renamed.
//
// WHY A SUBPROCESS AND NOT AN IMPORT. `@mcpforge/cli` already depends on
// `@mcpforge/ci` (`forge ci` is a CLI command), so `@mcpforge/ci` importing
// `@mcpforge/cli` would be a workspace dependency cycle. The gate therefore
// runs the real `forge bench --json` through `bin/forge.js` and reads its
// stdout — the same executable a developer runs, so the number CI gates on is
// the number the developer sees. The report shape below is consequently a
// STRUCTURAL reader over a JSON process boundary, not a duplicated type: it
// reads only the two fields it gates on (`gates[]` and `summary{}`) and is
// tolerant of every other field bench emits.
//
// TWO FAILURE MODES, BOTH REAL FAILURES, NEVER A SOFT PASS:
//   1. an ABSOLUTE gate breached — TTFC core-hit >2,000, cold >4,000, VTC >30
//      or >16, DH median >2 / p95 >3, or any MTB ceiling — 02 §5.7/§5.10/§5.3,
//      computed and cited by bench itself;
//   2. a REGRESSION against `evals/baseline.json` in any of the five metrics.
// A missing or unreadable baseline is also a failure, not a skip: a gate that
// silently passes when its baseline is absent is the "allowed to fail" that
// CLAUDE.md §5 forbids.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StageOutcome } from './stages.js';

/** Kept in step with `@mcpforge/cli`'s `BASELINE_RELATIVE_PATH` by the test beside this file. */
export const BASELINE_RELATIVE_PATH = 'evals/baseline.json';

/** The two fields of `forge bench --json` this gate reads. Structural, by design — see the header. */
export interface BenchJsonReport {
  readonly ok: boolean;
  readonly gates?: readonly {
    readonly id: string;
    readonly metric: string;
    readonly limit: number;
    readonly observed: number | null;
    readonly ok: boolean;
    readonly source: string;
    readonly detail: string;
  }[];
  readonly summary?: Readonly<Record<string, number>>;
}

export interface BaselineJson {
  readonly schemaVersion?: number;
  readonly coverage?: Readonly<Record<string, number>>;
  readonly summary?: Readonly<Record<string, number>>;
  readonly notes?: readonly string[];
}

/**
 * `higher` = a drop is a regression. Mirrors `@mcpforge/cli`'s
 * `SUMMARY_DIRECTIONS`; the test beside this file asserts the two agree key
 * for key, so the mirror can never drift unnoticed. Anything unlisted is
 * treated as `lower` (a token or hop count), which is the safe default: an
 * unexpected new metric that rises is reported, not ignored.
 */
export const SUMMARY_DIRECTIONS: Readonly<Record<string, 'higher' | 'lower'>> = {
  'sa1.overall': 'higher',
  'sa1.direct': 'higher',
  'sa1.near_miss': 'higher',
  'sa1.negative': 'higher',
  'sa1.sod_negative': 'higher',
  'ttfc.core-hit.max': 'lower',
  'ttfc.core-miss.max': 'lower',
  'ttfc.cold.max': 'lower',
  'vtc.max': 'lower',
  'dh.median': 'lower',
  'dh.p95': 'lower',
  'mtb.card.max': 'lower',
  'mtb.resident.max': 'lower',
  'mtb.describe.max': 'lower',
  'mtb.role-core-set.max': 'lower',
  'mtb.meta-resident': 'lower',
};

const EPSILON = 1e-9;

export interface Regression {
  readonly metric: string;
  readonly direction: 'higher' | 'lower';
  readonly baseline: number;
  readonly current: number;
}

export interface BenchGateVerdict {
  readonly ok: boolean;
  readonly breachedGates: readonly { readonly id: string; readonly observed: number | null; readonly limit: number; readonly source: string }[];
  readonly regressions: readonly Regression[];
  readonly missingFromCurrent: readonly string[];
  readonly comparedMetrics: number;
}

/**
 * The whole verdict as a pure function of two JSON documents — no filesystem,
 * no subprocess — so the gate's logic is unit-testable without spawning
 * anything (the spawning tests in this package are the ones that flake under
 * parallel load).
 */
export function evaluateBenchGate(report: BenchJsonReport, baseline: BaselineJson): BenchGateVerdict {
  const breachedGates = (report.gates ?? [])
    .filter((g) => !g.ok)
    .map((g) => ({ id: g.id, observed: g.observed, limit: g.limit, source: g.source }));

  const current = report.summary ?? {};
  const base = baseline.summary ?? {};
  const regressions: Regression[] = [];
  const missingFromCurrent: string[] = [];
  for (const [metric, baseValue] of Object.entries(base)) {
    const now = current[metric];
    if (now === undefined) {
      missingFromCurrent.push(metric);
      continue;
    }
    const direction = SUMMARY_DIRECTIONS[metric] ?? 'lower';
    const regressed = direction === 'higher' ? now < baseValue - EPSILON : now > baseValue + EPSILON;
    if (regressed) regressions.push({ metric, direction, baseline: baseValue, current: now });
  }

  return {
    ok: breachedGates.length === 0 && regressions.length === 0 && missingFromCurrent.length === 0,
    breachedGates,
    regressions,
    missingFromCurrent,
    comparedMetrics: Object.keys(base).length,
  };
}

export function formatVerdict(verdict: BenchGateVerdict, baseline: BaselineJson): string {
  if (verdict.ok) {
    const coverage = baseline.coverage ?? {};
    const provisional =
      (coverage['intents'] ?? 0) === 0 || (coverage['toolsInCatalogue'] ?? 0) === 0
        ? ' The baseline is PROVISIONAL — recorded over an empty catalogue/intents suite, so this pass proves the gate runs, not that discovery is good. Re-record with `forge bench --record-baseline` once Track I populates manifests/, roles/ and evals/.'
        : '';
    return `Discovery benchmark clean — all absolute gates within budget and no regression across ${verdict.comparedMetrics} baselined metric(s).${provisional}`;
  }
  const lines: string[] = [];
  if (verdict.breachedGates.length > 0) {
    lines.push(`${verdict.breachedGates.length} absolute gate(s) breached:`);
    for (const g of verdict.breachedGates) {
      lines.push(`  ${g.id}: ${g.observed} > ${g.limit} (${g.source})`);
    }
  }
  if (verdict.regressions.length > 0) {
    lines.push(`${verdict.regressions.length} metric(s) regressed against ${BASELINE_RELATIVE_PATH}:`);
    for (const r of verdict.regressions) {
      lines.push(
        `  ${r.metric}: ${r.current} vs baseline ${r.baseline} (${r.direction === 'higher' ? 'higher is better' : 'lower is better'})`,
      );
    }
  }
  if (verdict.missingFromCurrent.length > 0) {
    lines.push(
      `${verdict.missingFromCurrent.length} baselined metric(s) absent from this run — the report shape changed: ${verdict.missingFromCurrent.join(', ')}`,
    );
  }
  lines.push(
    'next: fix the discovery regression named above (ranking, a role\'s coreTools selection, or a tool\'s token cost), or — if the change is intended and reviewed — re-record with `forge bench --record-baseline` and commit the baseline diff.',
  );
  return lines.join('\n');
}

/** Injected by tests so the stage's logic is exercised without spawning the CLI. */
export interface BenchRunner {
  (repoRoot: string): { readonly code: number; readonly stdout: string; readonly stderr: string };
}

const defaultRunner: BenchRunner = (repoRoot) => {
  const bin = join(repoRoot, 'core', 'cli', 'bin', 'forge.js');
  const run = spawnSync(process.execPath, [bin, 'bench', '--json', '--root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
};

export function runBenchRegressionGate(repoRoot: string, runner: BenchRunner = defaultRunner): StageOutcome {
  const baselinePath = join(repoRoot, BASELINE_RELATIVE_PATH);
  if (!existsSync(baselinePath)) {
    return {
      status: 'failed',
      detail: [
        `No benchmark baseline at ${BASELINE_RELATIVE_PATH} — this gate has nothing to compare against and fails closed rather than reporting a pass it cannot back up.`,
        'next: run `forge bench --record-baseline` on a developer machine and commit the result.',
      ].join('\n'),
    };
  }

  let baseline: BaselineJson;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as BaselineJson;
  } catch (err) {
    return {
      status: 'failed',
      detail: `${BASELINE_RELATIVE_PATH} is not readable JSON: ${err instanceof Error ? err.message : String(err)}\nnext: restore it from git, or re-record with \`forge bench --record-baseline\`.`,
    };
  }

  const run = runner(repoRoot);
  if (run.code !== 0) {
    return {
      status: 'failed',
      detail: `forge bench --json exited ${run.code}.\n${(run.stderr || run.stdout).slice(-2000)}`,
    };
  }

  let report: BenchJsonReport;
  try {
    const lastLine = run.stdout.trim().split(/\r?\n/).at(-1) ?? '';
    report = JSON.parse(lastLine) as BenchJsonReport;
  } catch (err) {
    return {
      status: 'failed',
      detail: `forge bench --json did not emit parseable JSON: ${err instanceof Error ? err.message : String(err)}\n${run.stdout.slice(-2000)}`,
    };
  }

  if (report.ok !== true) {
    return {
      status: 'failed',
      detail: `forge bench reported an error envelope rather than a report:\n${JSON.stringify(report).slice(0, 2000)}`,
    };
  }

  const verdict = evaluateBenchGate(report, baseline);
  return { status: verdict.ok ? 'passed' : 'failed', detail: formatVerdict(verdict, baseline) };
}
