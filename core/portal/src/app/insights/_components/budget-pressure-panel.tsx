// MCPForge — W0-J20 (reduced scope): token-budget pressure (task item 3),
// reusing the exact `runTokenBudgetGate` mechanism W0-J13/J14/J18 already
// use (`../_lib/derive.ts`'s `buildBudgetPressureRows`) — same meter visual
// language as `governance/_components/budget-meter.tsx`.
import { cn } from 'cn';
import type { BudgetPressureRow } from '../types';

const DIMENSION_LABEL: Readonly<Record<BudgetPressureRow['dimension'], string>> = {
  card: 'discovery card',
  resident: 'resident definition',
  describe: 'forge.describe response',
  roleCoreSet: 'role core set',
};

function Meter({ row }: { readonly row: BudgetPressureRow }) {
  const pctClamped = Math.min(100, Math.round(row.pct * 100));
  return (
    <li
      data-testid={`budget-pressure-row-${row.kind}-${row.id}-${row.dimension}`}
      className="flex flex-col gap-1 rounded-lg border border-line bg-bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-text-1">{row.id}</span>
        <span className="text-[11.5px] text-text-2">
          {DIMENSION_LABEL[row.dimension]} · {row.measured}/{row.limit} tokens
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={row.measured}
        aria-valuemin={0}
        aria-valuemax={row.limit}
        aria-label={`${row.id} ${DIMENSION_LABEL[row.dimension]}: ${row.measured} of ${row.limit} tokens`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn('h-full', row.overBudget ? 'bg-status-danger-strong' : 'bg-status-write-strong')}
          style={{ width: `${pctClamped}%` }}
        />
      </div>
    </li>
  );
}

export interface BudgetPressurePanelProps {
  readonly rows: readonly BudgetPressureRow[];
  /** Rows at or above this fraction of their ceiling are shown; below it, "nothing under pressure". */
  readonly threshold: number;
}

export function BudgetPressurePanel({ rows, threshold }: BudgetPressurePanelProps) {
  const pressured = rows.filter((r) => r.pct >= threshold);
  return (
    <section
      aria-labelledby="budget-pressure-heading"
      data-testid="budget-pressure-panel"
      className="rounded-lg border border-line bg-bg-surface p-4"
    >
      <h3 id="budget-pressure-heading" className="mb-1 text-sm font-bold text-text-1">
        Token-budget pressure
      </h3>
      <p className="mb-3 text-[11.5px] text-text-2">
        Tools and roles at or above {Math.round(threshold * 100)}% of their token ceiling (02 §5.3).
      </p>
      {pressured.length === 0 ? (
        <p data-testid="budget-pressure-empty" className="text-[12.5px] text-text-2">
          Nothing measured is within {Math.round(threshold * 100)}% of its ceiling.
        </p>
      ) : (
        <ul data-testid="budget-pressure-list" className="flex flex-col gap-2">
          {pressured.map((row) => (
            <Meter key={`${row.kind}-${row.id}-${row.dimension}`} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
