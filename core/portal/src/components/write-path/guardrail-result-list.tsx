// MCPForge — W0-J7: guardrails evaluated (03 §7.2 item 4).
//
// "every guardrail on the tool, with pass/fail and the value checked. Showing
// the guardrails that *passed* is deliberate: it tells the approver what was
// actually enforced, not just what failed."
//
// SECURITY SHAPE: this component takes one array and renders every element of
// it. There is no `showPassed`, no `filter`, no `variant: 'failures'` and no
// `max` — a caller that could hide the passed guardrails could make the card
// assert less enforcement than took place, which is precisely the claim the
// approver is relying on. The absence of that prop is the design, not an
// oversight; do not add one.
import { CircleCheck, CircleX } from 'lucide-react';
import { cn } from 'cn';

import type { GuardrailResultView } from './types';

export interface GuardrailResultListProps {
  /** Every guardrail on the tool — passed and failed alike. All are rendered. */
  results: readonly GuardrailResultView[];
  className?: string | undefined;
}

export function GuardrailResultList({ results, className }: GuardrailResultListProps) {
  if (results.length === 0) return null;

  return (
    <section aria-labelledby="plan-guardrails-heading" className={cn('w-full', className)}>
      <h3
        id="plan-guardrails-heading"
        className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Guardrails evaluated
      </h3>
      <ul data-testid="guardrail-list" className="flex flex-col gap-1">
        {results.map((g) => (
          <li
            key={g.id}
            data-testid="guardrail-item"
            data-passed={String(g.passed)}
            className={cn(
              'flex items-start gap-2 rounded-md border px-2 py-1.5 text-[13.5px]/[1.55]',
              g.passed
                ? 'border-line bg-surface-3 text-text-1'
                : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
            )}
          >
            {g.passed ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="font-semibold">{g.label}</span>{' '}
              <span className="font-mono text-[11.5px]/[1.45]">({g.id})</span>{' '}
              <span>— {g.passed ? 'Passed' : 'Failed'}.</span>{' '}
              <span className="text-text-2">Checked: {g.valueChecked}</span>
              {g.message ? <span className="block">{g.message}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
