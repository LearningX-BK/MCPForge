// MCPForge — W0-J20 (REDUCED SCOPE — see TASKS.md's note under W0-J20 for
// exactly what this covers and what it defers, and CLAUDE.md §8). 03 §5.3
// item 3: "Insights (the benchmark metrics, because Phase 1 made
// TTFC/VTC/DH/SA@1/MTB into CI gates and a gate nobody can see is a gate
// nobody defends)."
//
// All six named elements are now built for real, against the real
// `BenchReport`/`TtfcReport`/`TokenBudgetGateResult`/`BenchBaseline` shapes
// (`fixtures.ts`/`_lib/derive.ts`):
//   1. Five metric cards (target / current / trend vs baseline / CI pass-fail)
//   2. Per-role TTFC breakdown
//   3. Token-budget pressure (tools/roles near their ceilings)
//   4. The scaling-invariant chart — `_components/scaling-chart-panel.tsx`.
//      Closing this task's one remaining gap: it renders the single real
//      point that exists today (`evals/baseline.json`, itself a provisional
//      snapshot over an empty catalogue/intents suite), honestly labelled
//      "pre-scaling / single baseline, more waves needed for a trend line" —
//      no ±5% band (a band around one point asserts nothing), no fabricated
//      second point. `_lib/derive.ts`'s `buildScalingChartPoint` is the seam;
//      `forge bench --record-baseline` at each future wave boundary is what
//      grows this into a real series.
//   5. Failing benchmark cases — `Sa1Report.failingIntents` (a follow-up to
//      this task fixed the gap noted below: `FailingIntent[]` now survives
//      `computeSa1`) — `_components/failing-intents-panel.tsx`.
import * as React from 'react';

import { fixtureInsightsSource } from './fixtures';
import {
  buildBudgetPressureRows,
  buildFailingIntentRows,
  buildMetricCards,
  buildRoleTtfcRows,
  buildScalingChartPoint,
} from './_lib/derive';
import { MetricCardRow } from './_components/metric-cards';
import { RoleTtfcTable } from './_components/role-ttfc-table';
import { BudgetPressurePanel } from './_components/budget-pressure-panel';
import { FailingIntentsPanel } from './_components/failing-intents-panel';
import { ScalingChartPanel } from './_components/scaling-chart-panel';
import type { InsightsSource } from './types';

const BUDGET_PRESSURE_THRESHOLD = 0.7;

/** `source` is test-injectable — same seam every J-track page follows; the App Router route always uses the default (`fixtures.ts`'s `fixtureInsightsSource`, which is real, not fabricated — see that file's header). */
export default function InsightsPage({
  source = fixtureInsightsSource,
}: {
  readonly source?: () => InsightsSource;
} = {}): React.ReactElement {
  const { report, comparison, baseline, budget } = source();
  const cards = buildMetricCards(report, comparison, baseline?.summary ?? null);
  const roleRows = buildRoleTtfcRows(report);
  const pressureRows = buildBudgetPressureRows(budget);
  const failingIntentRows = buildFailingIntentRows(report);
  const scalingChartPoint = buildScalingChartPoint(baseline);

  return (
    <main className="flex flex-col gap-6 bg-canvas px-6 py-6 text-text-1">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Insights</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          The benchmark metrics behind the CI gates — SA@1, TTFC, VTC, DH and MTB — computed live
          from this repo&apos;s catalogue and eval intents, rank-1 mode (02 §5.9), no model in the
          loop.
        </p>
      </div>

      {baseline === null ? (
        <p data-testid="insights-no-baseline" className="text-[12px] text-text-2">
          No committed baseline read at <code>evals/baseline.json</code> — trend and baseline
          pass/fail below read &quot;no baseline recorded&quot; until one exists.
        </p>
      ) : null}

      <section aria-labelledby="metric-cards-heading">
        <h2 id="metric-cards-heading" className="mb-2 text-sm font-bold text-text-1">
          The five metrics
        </h2>
        <MetricCardRow cards={cards} />
      </section>

      <section aria-labelledby="role-ttfc-heading">
        <h2 id="role-ttfc-heading" className="mb-2 text-sm font-bold text-text-1">
          TTFC by role
        </h2>
        <RoleTtfcTable rows={roleRows} />
      </section>

      <BudgetPressurePanel rows={pressureRows} threshold={BUDGET_PRESSURE_THRESHOLD} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ScalingChartPanel point={scalingChartPoint} />
        <FailingIntentsPanel rows={failingIntentRows} />
      </div>
    </main>
  );
}
