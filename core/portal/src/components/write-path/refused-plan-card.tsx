// MCPForge — W0-J8: the Plan Review card in a refused state (03 §7.3).
//
// "`PLAN_EXPIRED` — the card greys, the countdown becomes 'Expired', and the
// only action is `Plan again`. **The original plan text stays visible so the
// user can see what they lost.**"
//
// This is a WRAPPER around W0-J7's `PlanReviewCard`, not a second card. That is
// deliberate and it is the whole design of this file:
//
//  - the plan the user lost is rendered by the same component, from the same
//    props, so "the original plan text stays visible" is structurally true
//    rather than a string this file re-renders and could paraphrase;
//  - nothing here can clear, truncate or replace the plan sentence — it has no
//    access to it beyond passing `plan` straight through;
//  - the greying is a wrapper class plus `aria-disabled`, applied to the
//    presentation only. It never removes content.
//
// SECURITY SHAPE: the `actions` slot is not a prop of this component. A refused
// plan's actions are decided HERE, from the refusal code, so no caller can
// leave a live `Confirm and execute` button under an expired or mismatched
// plan. `PLAN_EXPIRED` gets `Plan again` and nothing else; the other two codes
// get `Plan again` too, because in all three cases the only honest forward move
// is a fresh plan — a refused plan token is never re-presentable.
'use client';

import { cn } from 'cn';

import { Button } from '../ui/button';
import { PlanReviewCard, type PlanReviewCardProps } from './plan-review-card';
import { RefusalBanner } from './refusal-banner';
import type { RefusalView } from './types';

export interface RefusedPlanCardProps
  // `actions` is deliberately excluded — see the security note above.
  extends Omit<PlanReviewCardProps, 'actions'> {
  refusal: RefusalView;
  /** 03 §7.3's "only action". Rendered whenever the host supplies a handler. */
  onPlanAgain?: (() => void) | undefined;
}

export function RefusedPlanCard({
  refusal,
  onPlanAgain,
  className,
  ...planProps
}: RefusedPlanCardProps) {
  return (
    <div
      data-testid="refused-plan-card"
      data-refusal-code={refusal.code}
      className={cn('flex w-full flex-col gap-3', className)}
    >
      {/* The banner is OUTSIDE the greyed region: the refusal is the live part
          of this card, and greying the explanation of the refusal would be
          exactly backwards. */}
      <RefusalBanner refusal={refusal} />

      {/* The card greys. It does not disappear, and it is not cleared: the
          original plan renders from the same props it always did. Not
          `inert`/`pointer-events-none` on the whole region either — the plan is
          still readable, selectable and copyable, which is the point of keeping
          it. */}
      <div
        data-testid="refused-plan-body"
        aria-disabled="true"
        className="opacity-60 grayscale"
      >
        <PlanReviewCard {...planProps} />
      </div>

      {onPlanAgain ? (
        <div>
          <Button type="button" data-testid="plan-again" onClick={onPlanAgain}>
            Plan again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
