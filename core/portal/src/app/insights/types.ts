// MCPForge — W0-J20 (reduced scope): `/insights` view types (03 §5.3
// "Insights", 02 §5.7/§5.9/§5.10/§5.3).
//
// Same honesty rule as every other J-track `types.ts`: a field this page
// renders directly mirrors a REAL type from the package that owns it, so a
// later live-wiring task changes a loader, never a component. Two of this
// module's five surfaces (§4 and §5 of the task) are deliberately DEFERRED
// rather than backed by a real type, because the upstream shape genuinely
// does not exist yet — see `_lib/load-insights.ts`'s header for exactly what
// is missing and what unblocks it.
import type {
  BenchGate,
  BenchReport,
  BenchBaseline,
  BaselineComparison,
  Stats,
  TtfcReport,
  RoleTtfc,
  MtbReport,
  FailingIntent,
  BenchCategory,
} from '@mcpforge/cli/commands/bench';
import type { TokenBudgetGateResult, ToolTokenMeasurement, RoleTokenMeasurement } from '@mcpforge/codegen/budget';

export type {
  BenchGate,
  BenchReport,
  BenchBaseline,
  BaselineComparison,
  Stats,
  TtfcReport,
  RoleTtfc,
  MtbReport,
  FailingIntent,
  BenchCategory,
  TokenBudgetGateResult,
  ToolTokenMeasurement,
  RoleTokenMeasurement,
};

/**
 * Everything the page reads. `report`/`budget` are real `BenchReport`/
 * `TokenBudgetGateResult` shapes (field-for-field, no invented keys);
 * `baseline`/`comparison` are `null` when `evals/baseline.json` does not
 * exist or does not parse — a missing baseline is a real, renderable state,
 * never a synthesized one.
 */
export interface InsightsSource {
  readonly report: BenchReport;
  readonly baseline: BenchBaseline | null;
  readonly comparison: BaselineComparison | null;
  readonly budget: TokenBudgetGateResult;
}

/** One of the five metric cards (item 1 of the task). */
export interface MetricCardView {
  readonly id: string;
  readonly metric: 'SA@1' | 'TTFC' | 'VTC' | 'DH' | 'MTB';
  readonly label: string;
  /** Human-readable current value, already formatted (percentage, token count, hop count…). */
  readonly currentText: string;
  readonly targetText: string;
  /** The absolute ceiling gate this card cites, when one exists (`BenchGate`, real). `null` for SA@1, which 02 §5.9 gates only via baseline regression, never an absolute ceiling. */
  readonly gate: BenchGate | null;
  /** `null` when no baseline is recorded for this metric. */
  readonly trend: {
    readonly baselineValue: number;
    readonly currentValue: number;
    readonly direction: 'higher' | 'lower';
    readonly improved: boolean;
    readonly regressed: boolean;
  } | null;
  /** Overall pass/fail badge for the card: the gate's own verdict when a gate exists, else the baseline regression verdict, else `null` (no basis to judge — rendered as "no baseline recorded"). */
  readonly ciPass: boolean | null;
}

/** One row of the per-role TTFC breakdown (item 2), straight off `TtfcReport.byRole`. */
export interface RoleTtfcRow {
  readonly role: string;
  readonly ttfc: RoleTtfc;
}

/** One row of the token-budget pressure panel (item 3) — a tool or a role, its measured tokens, its ceiling, and its pressure fraction. */
export interface BudgetPressureRow {
  readonly kind: 'tool' | 'role';
  readonly id: string;
  readonly dimension: 'card' | 'resident' | 'describe' | 'roleCoreSet';
  readonly measured: number;
  readonly limit: number;
  readonly pct: number;
  readonly overBudget: boolean;
}

/**
 * Item 4, the scaling-invariant chart — one real point off the committed
 * `evals/baseline.json` (`BenchBaseline`), never a fabricated series. `null`
 * when no baseline file exists at all (there is then nothing to plot, not
 * even one point). `provisional` mirrors the baseline's own disclosure
 * (recorded over an empty catalogue/intents suite, 02 §5.9) so the chart
 * never lets a zero read as "measured at zero".
 */
export interface ScalingChartPoint {
  readonly recorded: string;
  readonly toolsInCatalogue: number;
  readonly ttfcCoreHitMax: number | null;
  readonly provisional: boolean;
}
