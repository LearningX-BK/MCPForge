// MCPForge — W0-J7: the reversal contract (03 §7.2 item 5).
//
// "class, the reversing tool (linked), the window (`720 hours`, rendered also
// as *'until 26 Sep 2026'*), and the preconditions. For `irreversible`, this
// block becomes a filled danger banner reading **'This cannot be undone'**
// with the reason, and it appears *above* the effects table rather than below
// it."
//
// SECURITY SHAPE: the `irreversible` treatment is derived from
// `reversal.class`, never from a prop. There is no `variant`, no `asBanner`,
// no `suppress` — a caller holding an irreversible reversal cannot render it
// as an ordinary block, and PlanReviewCard's placement of the banner above the
// effects table is likewise derived from the same field (see plan-review-card
// .tsx). The exact string "This cannot be undone" is a constant in this file
// and is not interpolated from any input.
import { TriangleAlert } from 'lucide-react';
import { REVERSAL_CLASS } from '@mcpforge/shared';
import { cn } from 'cn';

import { StatusChip } from '../chips';
import type { PlanReversalView } from './types';

/** 03 §7.2 item 5, verbatim. Never templated, never overridable. */
export const IRREVERSIBLE_BANNER_TEXT = 'This cannot be undone';

export interface ReversalContractProps {
  reversal: PlanReversalView;
  className?: string | undefined;
}

// Judgment call: the month abbreviations are a fixed table rather than
// Intl's `month: 'short'`, because ICU renders September as "Sept" in en-GB
// and 03 §7.2 writes the window as "until 26 Sep 2026". A reversal deadline
// that renders differently depending on the runtime's ICU build is not a
// deadline anyone can quote back, so this is deliberately not locale-varying.
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

// Exported for W0-J9's `ReversalAction`, which renders the same window on the
// completed call and must render it identically — a deadline that reads one way
// on the plan and another way on the result is the same unquotable deadline
// this table exists to prevent. Additive: no existing behaviour changes.
export function formatWindowEnd(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // "until 26 Sep 2026" — day-month-year, UTC, the doc's own rendering.
  return `until ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function ReversalContract({ reversal, className }: ReversalContractProps) {
  const entry = REVERSAL_CLASS[reversal.class];

  if (reversal.class === 'irreversible') {
    return (
      <section
        data-testid="reversal-contract"
        data-irreversible="true"
        role="note"
        aria-labelledby="plan-irreversible-heading"
        className={cn(
          'flex w-full items-start gap-2 rounded-md border px-3 py-2',
          // The one filled danger treatment in this family.
          'border-status-danger-strong bg-status-danger-strong text-white',
          className,
        )}
      >
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <h3
            id="plan-irreversible-heading"
            data-testid="irreversible-banner"
            className="text-[0.9375rem]/[1.6] font-bold"
          >
            {IRREVERSIBLE_BANNER_TEXT}
          </h3>
          {reversal.reason ? (
            <p className="text-[13.5px]/[1.55]">{reversal.reason}</p>
          ) : null}
          {reversal.preconditions ? (
            <p className="text-[13.5px]/[1.55]">{reversal.preconditions}</p>
          ) : null}
        </div>
      </section>
    );
  }

  const windowEnd = formatWindowEnd(reversal.windowEndsAt);

  return (
    <section
      data-testid="reversal-contract"
      data-irreversible="false"
      aria-labelledby="plan-reversal-heading"
      className={cn('w-full', className)}
    >
      <h3
        id="plan-reversal-heading"
        className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Reversal contract
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
        <dt className="text-text-2">Class</dt>
        <dd>
          <StatusChip entry={entry} />
        </dd>

        {reversal.tool ? (
          <>
            <dt className="text-text-2">Reversing tool</dt>
            <dd className="font-mono text-[11.5px]/[1.45]">
              {reversal.toolHref ? (
                <a className="underline underline-offset-2" href={reversal.toolHref}>
                  {reversal.tool}
                </a>
              ) : (
                reversal.tool
              )}
            </dd>
          </>
        ) : null}

        {reversal.windowHours !== undefined ? (
          <>
            <dt className="text-text-2">Window</dt>
            <dd data-testid="reversal-window">
              {`${reversal.windowHours} hours${windowEnd ? ` — ${windowEnd}` : ''}`}
            </dd>
          </>
        ) : null}

        {reversal.preconditions ? (
          <>
            <dt className="text-text-2">Preconditions</dt>
            <dd>{reversal.preconditions}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
