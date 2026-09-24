// MCPForge — W0-J7: the Plan Review card (03 §7.2), "the most designed
// component in the product".
//
// "Anchored in `--status-write` (amber) with a `--status-write` left rule, on
// `--bg-surface-2`. Contents, in this order, **because the order is the
// argument**."
//
// The order is therefore fixed in this file and is not parameterised:
//
//   1  plan sentence            PlanSentence
//   -  (irreversible only)      ReversalContract, as the filled danger banner,
//                               "above the effects table rather than below it"
//   2  effects table            EffectsTable        (irreversible rows first)
//   3  warnings                 WarningList
//   4  guardrails evaluated     GuardrailResultList (passed ones included)
//   5  reversal contract        ReversalContract    (non-irreversible position)
//   6  identity                 IdentityBlock       (probe-sourced)
//   7  arguments, locked        LockedArgs
//   8  expiry                   PlanExpiryCountdown
//   9  actions                  — NOT this task. `actions` is a slot W0-J8's
//                                 ConfirmAction fills; nothing is rendered when
//                                 it is absent, and this component never
//                                 invents an action of its own.
//
// SECURITY SHAPE: there is no `order`, `sections`, `hide*`, `compact` or
// `variant` prop. Every block above renders whenever its data is present, and
// the irreversible banner's position is derived from `plan.reversal.class`
// alone. A caller cannot reorder the argument or drop a part of it.
import type { ReactNode } from 'react';
import { cn } from 'cn';

import { EffectsTable } from './effects-table';
import { GuardrailResultList } from './guardrail-result-list';
import { IdentityBlock } from './identity-block';
import { LockedArgs } from './locked-args';
import { PlanExpiryCountdown } from './plan-expiry-countdown';
import { PlanSentence } from './plan-sentence';
import { ReversalContract } from './reversal-contract';
import { WarningList } from './warning-list';
import type {
  GuardrailResultView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
} from './types';

export interface PlanReviewCardProps {
  /** The gateway's `confirm_required` body: plan, effects, warnings, reversal. */
  plan: PlanBodyView;
  /** Every guardrail on the tool — passed and failed. All are rendered. */
  guardrails?: readonly GuardrailResultView[] | undefined;
  /** Probe-sourced identity view. See identity-block.tsx before widening. */
  identity: ProbeIdentityView;
  /** Canonical arguments plus the hash the confirm token binds. */
  locked: LockedArgsView;
  /** ISO-8601 `tokenExpiresAt`. Omit only where no plan token exists yet. */
  expiresAt?: string | undefined;
  /** Injectable clock for the countdown, for tests. */
  now?: (() => number) | undefined;
  /**
   * Item 9's action row. W0-J8 supplies `ConfirmAction` / `Change arguments` /
   * `Discard plan` here; this task renders the slot and nothing else.
   */
  actions?: ReactNode;
  className?: string | undefined;
}

export function PlanReviewCard({
  plan,
  guardrails = [],
  identity,
  locked,
  expiresAt,
  now,
  actions,
  className,
}: PlanReviewCardProps) {
  const irreversible = plan.reversal.class === 'irreversible';

  return (
    <section
      data-testid="plan-review-card"
      aria-label="Plan review"
      className={cn(
        // --bg-surface-2 with the --status-write left rule (03 §7.2).
        'flex w-full flex-col gap-4 rounded-lg border bg-surface-2 p-4',
        'border-status-write-border border-l-4 border-l-status-write',
        className,
      )}
    >
      {/* 1 — first and largest. Verbatim, never clipped; the card grows. */}
      <PlanSentence plan={plan.plan} />

      {/* irreversible: the reversal contract becomes a banner, here. */}
      {irreversible ? <ReversalContract reversal={plan.reversal} /> : null}

      {/* 2 */}
      <EffectsTable effects={plan.effects} />

      {/* 3 */}
      <WarningList warnings={plan.warnings} />

      {/* 4 */}
      <GuardrailResultList results={guardrails} />

      {/* 5 — the ordinary position, when it is not a banner. */}
      {irreversible ? null : <ReversalContract reversal={plan.reversal} />}

      {/* 6 */}
      <IdentityBlock identity={identity} />

      {/* 7 */}
      <LockedArgs locked={locked} />

      {/* 8 */}
      {expiresAt ? <PlanExpiryCountdown expiresAt={expiresAt} now={now} /> : null}

      {/* 9 — W0-J8's slot. */}
      {actions ? <div data-testid="plan-actions">{actions}</div> : null}
    </section>
  );
}
