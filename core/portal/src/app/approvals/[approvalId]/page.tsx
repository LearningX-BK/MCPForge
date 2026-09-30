// MCPForge — `/approvals/[approvalId]`. W0-P3b: live, read from
// `/api/v1/approvals/{id}` as the signed-in viewer. A request outside the
// viewer's read authority is a 404 at the gateway, identical to a missing
// one, and renders the not-found notice (persona never hides a route, 03 §2).
//
// W0-P25: a pending request can be decided here; the gateway decides, this
// page forwards the verdict through `./actions.ts`.
//
// W0-P3f: which view depends on the stored plan body, as the GATEWAY judged it:
//  - `verified` — the approver sees everything the requester saw, through
//    `ApproverDecisionPanel` (`./approval-review.tsx`).
//  - `absent` — a request raised before bodies were stored: the plan sentence
//    and the P25 form, as before.
//  - `mismatch` — the stored body does not hash to the approved plan. Nothing
//    of it is shown and nothing can be decided; the gateway refuses too.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readApproval } from '@/lib/gateway-client/read-client';

import { RuntimeStateChip } from '../runtime-state-chip';
import { loadToolFacts, toRuntimeEntry } from '../live';
import { decideApprovalAction } from './actions';
import { ApprovalRequestDetail } from './approval-request-detail';
import { ApprovalReview } from './approval-review';
import { declaredGuardrails } from './guardrail-facts';

export const dynamic = 'force-dynamic';

function Heading({ approvalId, children }: { approvalId: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Approval</p>
      <h1 className="flex items-center gap-2 font-mono text-lg text-text-1">
        {approvalId}
        {children}
      </h1>
    </div>
  );
}

export default async function ApprovalDecisionPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}): Promise<React.ReactElement> {
  const { approvalId } = await params;
  const result = await readApproval(approvalId);
  if (result.kind !== 'ok') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <Heading approvalId={approvalId} />
        <LiveStateNotice state={result} subject="This approval" />
      </main>
    );
  }

  const { approval: a, planBody, planBodyStatus } = result.data;
  const entry = toRuntimeEntry(a, loadToolFacts());

  if (planBodyStatus === 'verified' && planBody !== null) {
    const guardrails = declaredGuardrails(a.toolId, a.toolVersion);
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <Heading approvalId={a.id}>
          <RuntimeStateChip state={entry.approval.state} />
        </Heading>
        <ApprovalReview
          approval={entry.approval}
          plan={planBody}
          guardrails={guardrails.kind === 'declared' ? guardrails.results : []}
          guardrailNote={
            guardrails.kind === 'declared'
              ? undefined
              : `The committed manifest for ${a.toolId} is not version ${a.toolVersion ?? '(unrecorded)'}, so its declared guardrails are not listed here. Every guardrail the gateway enforced passed, or no approval would exist.`
          }
          action={decideApprovalAction}
        />
      </main>
    );
  }

  if (planBodyStatus === 'mismatch') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <Heading approvalId={a.id}>
          <RuntimeStateChip state={entry.approval.state} />
        </Heading>
        <section
          role="alert"
          data-testid="approval-plan-mismatch"
          className="flex flex-col gap-1 rounded-lg border border-status-danger-border bg-status-danger-bg p-3 text-[13.5px]/[1.55] text-status-danger-strong"
        >
          <p className="font-semibold">
            This request&apos;s stored plan does not match the plan it was raised with.
          </p>
          <p>
            What would be shown to you is not what would be approved, so none of it is shown and it
            cannot be decided.
          </p>
          <p>
            <span className="font-semibold">Next: </span>
            Report approval {a.id} to the MCPForge operator so the runtime store can be inspected,
            and ask {a.callerSubject} to plan the change again, which raises a fresh request.
          </p>
        </section>
      </main>
    );
  }

  return (
    <ApprovalRequestDetail
      approval={entry.approval}
      planText={a.planSummary}
      application={entry.application}
      sensitivity={entry.sensitivity}
      decide={decideApprovalAction}
    />
  );
}
