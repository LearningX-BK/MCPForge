// MCPForge — W0-J20 (reduced scope): pure view derivations for `/insights`.
// No I/O here — everything is a function of a real `InsightsSource`
// (`fixtures.ts` is the only place that reads files), which is what keeps
// this module trivially unit-testable against fixed inputs.
import { SUMMARY_DIRECTIONS } from '@mcpforge/cli/commands/bench';
import { TOKEN_BUDGETS } from '@mcpforge/shared/tokens';
import type {
  BaselineComparison,
  BenchBaseline,
  BenchGate,
  BenchReport,
  BudgetPressureRow,
  FailingIntent,
  MetricCardView,
  RoleTtfcRow,
  ScalingChartPoint,
  TokenBudgetGateResult,
} from '../types';

function gateFor(gates: readonly BenchGate[], id: string): BenchGate | null {
  return gates.find((g) => g.id === id) ?? null;
}

function trendFor(
  metricKey: string,
  currentValue: number,
  comparison: BaselineComparison | null,
  baselineSummary: Readonly<Record<string, number>> | null,
): MetricCardView['trend'] {
  if (!comparison || !baselineSummary || !(metricKey in baselineSummary)) return null;
  const baselineValue = baselineSummary[metricKey]!;
  const direction = SUMMARY_DIRECTIONS[metricKey] ?? 'lower';
  const regressed = comparison.regressions.some((r) => r.metric === metricKey);
  const improved =
    !regressed &&
    (direction === 'higher' ? currentValue > baselineValue : currentValue < baselineValue);
  return { baselineValue, currentValue, direction, improved, regressed };
}

/**
 * The five metric cards (task item 1) — one per 02 §5.9 metric, each sourced
 * from a real `BenchGate` when 02 fixes an absolute ceiling for it, and from
 * the real baseline comparison (`compareToBaseline`) for its trend and, for
 * SA@1 alone (which 02 §5.9 gates only by regression, never a ceiling), for
 * its pass/fail verdict too.
 */
export function buildMetricCards(
  report: BenchReport,
  comparison: BaselineComparison | null,
  baselineSummary: Readonly<Record<string, number>> | null,
): readonly MetricCardView[] {
  const { gates, metrics, overall } = report;

  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

  const sa1Regressed = comparison?.regressions.some((r) => r.metric === 'sa1.overall') ?? null;
  const sa1Trend = trendFor('sa1.overall', overall.sa1, comparison, baselineSummary);

  const ttfcGate = gateFor(gates, 'ttfc.core-hit');
  const vtcGate = gateFor(gates, 'vtc.default-target');
  const dhGate = gateFor(gates, 'dh.median');
  const mtbGate = gateFor(gates, 'mtb.resident');

  return [
    {
      id: 'sa1',
      metric: 'SA@1',
      label: 'Rank-1 accuracy (SA@1)',
      currentText: `${pct(overall.sa1)} (${overall.hits}/${overall.n})`,
      targetText: 'No regression from the committed baseline',
      gate: null,
      trend: sa1Trend,
      ciPass: sa1Regressed === null ? null : !sa1Regressed,
    },
    {
      id: 'ttfc',
      metric: 'TTFC',
      label: 'Time-to-first-correct-call (core-hit)',
      currentText:
        metrics.ttfc.coreHit.max === null ? 'n/a (n=0)' : `${Math.round(metrics.ttfc.coreHit.max)} tokens`,
      targetText: `≤ ${ttfcGate?.limit ?? 2000} tokens (02 §5.7 Case A)`,
      gate: ttfcGate,
      trend: trendFor('ttfc.core-hit.max', metrics.ttfc.coreHit.max ?? 0, comparison, baselineSummary),
      ciPass: ttfcGate?.ok ?? null,
    },
    {
      id: 'vtc',
      metric: 'VTC',
      label: 'Visible tool count',
      currentText: `${metrics.vtc.max} resident definitions`,
      targetText: `≤ ${metrics.vtc.default} default, ${metrics.vtc.hardCap} hard cap (02 §5.10)`,
      gate: vtcGate,
      trend: trendFor('vtc.max', metrics.vtc.max, comparison, baselineSummary),
      ciPass: vtcGate?.ok ?? null,
    },
    {
      id: 'dh',
      metric: 'DH',
      label: 'Discovery hops (median)',
      currentText: metrics.dh.median === null ? 'n/a (n=0)' : `${metrics.dh.median} hops`,
      targetText: '≤ 2 median, ≤ 3 p95 (02 §5.7)',
      gate: dhGate,
      trend: trendFor('dh.median', metrics.dh.median ?? 0, comparison, baselineSummary),
      ciPass: dhGate?.ok ?? null,
    },
    {
      id: 'mtb',
      metric: 'MTB',
      label: 'Message-token budget (largest resident definition)',
      currentText: `${metrics.mtb.maxResidentTokens} / ${metrics.mtb.limits.resident} tokens`,
      targetText: `≤ ${metrics.mtb.limits.resident} tokens hard cap (02 §5.3(b))`,
      gate: mtbGate,
      trend: trendFor('mtb.resident.max', metrics.mtb.maxResidentTokens, comparison, baselineSummary),
      ciPass: mtbGate?.ok ?? null,
    },
  ];
}

/** Task item 2 — `TtfcReport.byRole`, straight through, sorted for a stable render order. */
export function buildRoleTtfcRows(report: BenchReport): readonly RoleTtfcRow[] {
  return Object.entries(report.metrics.ttfc.byRole)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, ttfc]) => ({ role, ttfc }));
}

const PRESSURE_DIMENSIONS: readonly {
  readonly dimension: BudgetPressureRow['dimension'];
  readonly limit: number;
}[] = [
  { dimension: 'card', limit: TOKEN_BUDGETS.card },
  { dimension: 'resident', limit: TOKEN_BUDGETS.residentHard },
  { dimension: 'describe', limit: TOKEN_BUDGETS.describe },
];

/**
 * Task item 3 — tools and roles near their token ceilings, from the real
 * `TokenBudgetGateResult` (`runTokenBudgetGate`, the exact function W0-G5's
 * CI gate and W0-J18's role editor both call). `minPct` filters to rows
 * genuinely under pressure; the caller decides the threshold.
 */
export function buildBudgetPressureRows(
  budget: TokenBudgetGateResult,
  minPct = 0,
): readonly BudgetPressureRow[] {
  const rows: BudgetPressureRow[] = [];
  for (const [toolId, m] of Object.entries(budget.tools)) {
    const measurements: Readonly<Record<BudgetPressureRow['dimension'], number>> = {
      card: m.cardTokens,
      resident: m.residentTokens,
      describe: m.describeTokens,
      roleCoreSet: 0,
    };
    for (const { dimension, limit } of PRESSURE_DIMENSIONS) {
      const measured = measurements[dimension];
      const pctValue = limit === 0 ? 0 : measured / limit;
      rows.push({
        kind: 'tool',
        id: toolId,
        dimension,
        measured,
        limit,
        pct: pctValue,
        overBudget: measured > limit,
      });
    }
  }
  for (const [roleId, r] of Object.entries(budget.roles)) {
    const limit: number = TOKEN_BUDGETS.roleCoreSet;
    rows.push({
      kind: 'role',
      id: roleId,
      dimension: 'roleCoreSet',
      measured: r.coreSetTokens,
      limit,
      pct: limit === 0 ? 0 : r.coreSetTokens / limit,
      overBudget: r.coreSetTokens > limit,
    });
  }
  return rows.filter((r) => r.pct >= minPct).sort((a, b) => b.pct - a.pct);
}

/**
 * Task item — the failing-benchmark-cases panel. `report.overall.failingIntents`
 * is the real `Sa1Report.failingIntents` (bench.ts's `failingIntentsOf`),
 * straight through, sorted for a stable render order. A `near_miss` entry IS
 * the confused pair (`expect` vs `actual`); a `negative`/`sod_negative` entry
 * with `actual !== 'none'` IS the tool it was wrongly answered with — both
 * read directly off the real fields, nothing re-derived or guessed.
 */
export function buildFailingIntentRows(report: BenchReport): readonly FailingIntent[] {
  return [...report.overall.failingIntents].sort((a, b) => a.intent.localeCompare(b.intent));
}

/**
 * Task item 4 — the scaling-invariant chart's real, single data point, read
 * straight off the committed `evals/baseline.json` (`BenchBaseline`). `null`
 * when no baseline file was read at all — there is then nothing to plot.
 * `provisional` is true when the baseline itself was recorded over an empty
 * catalogue and/or an empty intents suite (`coverage.toolsInCatalogue === 0`
 * or `coverage.intents === 0`), which today's committed baseline is — never
 * inferred as "measured at zero" (`evals/baseline.json`'s own note, verbatim).
 */
export function buildScalingChartPoint(baseline: BenchBaseline | null): ScalingChartPoint | null {
  if (!baseline) return null;
  const ttfc = baseline.summary['ttfc.core-hit.max'];
  return {
    recorded: baseline.recorded,
    toolsInCatalogue: baseline.coverage.toolsInCatalogue,
    ttfcCoreHitMax: typeof ttfc === 'number' ? ttfc : null,
    provisional: baseline.coverage.toolsInCatalogue === 0 || baseline.coverage.intents === 0,
  };
}
