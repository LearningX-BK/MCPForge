'use client';
// MCPForge — W0-P25: the approver's decision on one pending runtime request.
//
// Two verdicts and a reason, posted through a server action to the gateway's
// `POST /api/v1/approvals/{id}/decision`. The form holds no identity: the
// approver is whoever is signed in, and the gateway refuses anyone who raised
// the request or whose own roles do not include the tool. Its refusal is shown
// verbatim with its `next` (W0-P4 §3). Approving does not execute anything;
// the copy says so, because 03 §7.4 makes that separation the point.

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { DecisionState } from './actions';

export interface DecideFormProps {
  readonly approvalId: string;
  readonly requester: string;
  /** The server action. Injected so a test can drive the form without a server. */
  readonly action: (prev: DecisionState, form: FormData) => Promise<DecisionState>;
}

const IDLE: DecisionState = { status: 'idle' };

export function DecideForm({ approvalId, requester, action }: DecideFormProps) {
  const [state, formAction, pending] = React.useActionState(action, IDLE);
  const reasonId = React.useId();

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
    <form
      action={formAction}
      data-testid="approval-decide-form"
      aria-labelledby={`${reasonId}-heading`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <h2 id={`${reasonId}-heading`} className="text-[14px] font-semibold text-text-1">
        Your decision
      </h2>
      <p className="text-[13px] text-text-2">
        Approving does not run anything. It lets {requester}, who raised this request, run exactly
        the plan above. Declining sends your reason back to them.
      </p>
      <input type="hidden" name="approvalId" value={approvalId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={reasonId}>Reason (required to decline)</Label>
        <Textarea id={reasonId} name="reason" maxLength={2000} disabled={pending} />
      </div>
      {state.status === 'refused' ? (
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
          {state.correlationId === undefined ? null : (
            <p className="text-[12px] opacity-80">
              Correlation id <code className="font-mono">{state.correlationId}</code>
            </p>
          )}
        </section>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approved" disabled={pending}>
          Approve
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="outline" disabled={pending}>
          Decline
        </Button>
      </div>
    </form>
  );
}
