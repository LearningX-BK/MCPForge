'use client';

// MCPForge — W0-J18: the role token-budget meter (02 §5.3(d), 03 §5.3 tab 1).
//
// "the role token-budget meter names the tools to demote when over 1,300".
// NAMES them. A number alone tells an admin they have a problem and nothing
// about what to do with it, so the over-budget state renders the gate's own
// `demote` list — chosen by `chooseDemotions`, the same function `forge ci`
// stage 9 uses, so the portal and CI never name different tools.
import { cn } from 'cn';

import type { RoleBudgetView } from '../types';

export interface RoleBudgetMeterProps {
  budget: RoleBudgetView;
}

export function RoleBudgetMeter({ budget }: RoleBudgetMeterProps) {
  const pct = Math.min(100, Math.round((budget.coreSetTokens / budget.limit) * 100));
  const over = budget.overBudget;

  return (
    <section
      aria-labelledby="role-budget-heading"
      data-testid="role-budget-meter"
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="role-budget-heading" className="text-sm font-bold text-text-1">
          Role core set
        </h3>
        <p className="text-[12.5px] text-text-2">
          <span
            data-testid="role-budget-count"
            className={cn('font-mono font-bold', over ? 'text-status-danger-strong' : 'text-text-1')}
          >
            {budget.coreSetTokens}
          </span>
          <span> / {budget.limit} tokens</span>
        </p>
      </div>

      <div
        role="meter"
        aria-valuenow={budget.coreSetTokens}
        aria-valuemin={0}
        aria-valuemax={budget.limit}
        aria-label={`Role core set: ${budget.coreSetTokens} of ${budget.limit} tokens`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn('h-full', over ? 'bg-status-danger-strong' : 'bg-status-ok-strong')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {over ? (
        <div className="mt-3" data-testid="role-budget-demote">
          <p className="text-[12.5px] font-semibold text-status-danger-strong">
            Over the {budget.limit}-token budget. Demote these {budget.demote.length} tool
            {budget.demote.length === 1 ? '' : 's'} from <code>coreTools</code>:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {budget.demote.map((toolId) => (
              <li key={toolId} className="font-mono text-[12.5px] text-text-1">
                {toolId}
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-[70ch] text-[12px] text-text-2">
            Demoting a tool from <code>coreTools</code> does not remove it from the role — the
            agent reaches it through <code>forge.find</code> (one extra hop) instead of finding it
            resident.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-text-2">
          Within budget. Nothing to demote.
        </p>
      )}
    </section>
  );
}
