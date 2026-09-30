'use client';
// MCPForge — W0-P3f: the approver's full view of one runtime request.
//
// `ApproverDecisionPanel` shows everything the requester saw (03 §7.4): the
// plan sentence, effects, warnings, the declared guardrails and the reversal
// contract, from the plan body the gateway stored at raise time and VERIFIED
// against the approval's plan hash before sending (`/api/v1`). Its Approve and
// Decline go through the same server action as P25's form, so the gateway still
// decides everything: who may approve, self-approval, expiry.
//
// A refusal is shown in full. `PLAN_EXPIRED` uses `RefusalBanner`, whose
// expired variant needs exactly what the gateway returns (message and next).
// Other refusals (self-approval, not an approver, already decided) are shown
// with their code, message and next verbatim.

import * as React from 'react';

import {
  ApproverDecisionPanel,
  RefusalBanner,
  type ApprovalView,
  type GuardrailResultView,
  type PlanBodyView,
} from '@/components/write-path';

import type { DecisionState } from './actions';

export interface ApprovalReviewProps {
  readonly approval: ApprovalView;
  readonly plan: PlanBodyView;
  readonly guardrails: readonly GuardrailResultView[];
  /** Said beside the guardrails when the committed manifest is another version. */
  readonly guardrailNote?: string | undefined;
  /** The decision server action (`./actions.ts`). Injected so tests need no server. */
  readonly action: (prev: DecisionState, form: FormData) => Promise<DecisionState>;
}

const IDLE: DecisionState = { status: 'idle' };

export function ApprovalReview({
  approval,
  plan,
  guardrails,
  guardrailNote,
  action,
}: ApprovalReviewProps) {
  const [state, setState] = React.useState<DecisionState>(IDLE);
  const [pending, startTransition] = React.useTransition();

  function submit(decision: 'approved' | 'rejected', reason: string | undefined) {
    const form = new FormData();
    form.set('approvalId', approval.approvalId);
    form.set('decision', decision);
    if (reason !== undefined) form.set('reason', reason);
    startTransition(async () => {
      setState(await action(IDLE, form));
    });
  }

  if (state.status === 'decided') {
    return (
      <section
        role="status"
        data-testid="approval-decided"
        data-decision={state.decision}
        className="flex flex-col gap-2 rounded-lg border border-status-ok-border bg-status-ok-bg p-3 text-[13.5px]/[1.55] text-status-ok-strong"
      >
        <p className="font-semibold">
          {state.decision === 'approved' ? 'Approved.' : 'Declined.'} Your decision is recorded.
        </p>
        <p data-testid="approval-decided-next">
          <span className="font-semibold">Next: </span>
          {state.next}
        </p>
        <p className="text-[12px] opacity-80">
          Audit call <code className="font-mono">{state.auditCallId}</code>
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      {state.status === 'refused' ? (
        state.code === 'PLAN_EXPIRED' ? (
          <RefusalBanner
            refusal={{ code: 'PLAN_EXPIRED', message: state.message, next: state.next }}
          />
        ) : (
          <section
            role="alert"
            data-testid="approval-decision-refused"
            className="flex flex-col gap-1 rounded-lg border border-status-write-border bg-status-write-bg p-3 text-[13px] text-status-write-strong"
          >
            <p className="font-semibold">
              Not recorded{state.code === undefined ? '' : ` (${state.code})`}: {state.message}
            </p>
            <p data-testid="approval-decision-next">
              <span className="font-semibold">Next: </span>
              {state.next}
            </p>
          </section>
        )
      ) : null}
      {guardrailNote === undefined ? null : (
        <p data-testid="approval-guardrail-note" className="text-[12.5px]/[1.5] text-text-2">
          {guardrailNote}
        </p>
      )}
      <ApproverDecisionPanel
        approval={approval}
        plan={plan}
        guardrails={guardrails}
        onApprove={(note) => submit('approved', note)}
        onDecline={(reason) => submit('rejected', reason)}
      />
    </div>
  );
}
