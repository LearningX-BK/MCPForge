// MCPForge — W0-P3b: one runtime approval request, as the gateway holds it.
//
// Read-only, and deliberately so. The plan text is the exact string the
// gateway stored and the requester saw, rendered verbatim through
// `PlanSentence`. Nothing here is re-derived or invented: an approval row
// carries no effect list, reversal contract or probe identity, so none is
// shown. `ApproverDecisionPanel` needs all three and returns when a real
// source for them exists (W0-P3d).
//
// DECIDING IS NOT WIRED. The gateway's approval gate can decide
// (`policy/approval/gate.ts`), but no transport exposes a decision to a
// human: `/mcp` serves tools, and `/api/v1` is read-only by decision
// (W0-P2 §7). A decision endpoint is a new write path and needs the owner's
// decision first. This component says so rather than offering a button that
// would record nothing.

import * as React from 'react';

import { PlanSentence } from '@/components/write-path';
import type { ApprovalView } from '@/components/write-path';

import { RuntimeStateChip } from '../runtime-state-chip';

export interface ApprovalRequestDetailProps {
  readonly approval: ApprovalView;
  /** The exact plan string the requester was shown. `null` when the gateway stored none. */
  readonly planText: string | null;
  readonly application: string;
  readonly sensitivity: string;
}

function when(iso: string | undefined): string {
  return iso === undefined ? '—' : new Date(iso).toLocaleString();
}

export function ApprovalRequestDetail({
  approval,
  planText,
  application,
  sensitivity,
}: ApprovalRequestDetailProps) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <div>
        <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Approval</p>
        <h1 className="flex items-center gap-2 font-mono text-lg text-text-1">
          {approval.approvalId}
          <RuntimeStateChip state={approval.state} />
        </h1>
      </div>

      {planText === null ? (
        <p data-testid="approval-plan-missing" className="text-[13px] text-text-2">
          The gateway stored no plan text for this request, so none is shown. The plan hash below
          still identifies exactly what was requested.
        </p>
      ) : (
        <PlanSentence plan={planText} />
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-text-2">Requested by</dt>
        <dd data-testid="approval-requester" className="text-text-1">
          {approval.requester.subject}
        </dd>
        <dt className="text-text-2">Tool</dt>
        <dd className="font-mono text-text-1">
          {approval.toolId} {approval.toolVersion ?? ''}
        </dd>
        <dt className="text-text-2">Application</dt>
        <dd className="text-text-1">{application}</dd>
        <dt className="text-text-2">Sensitivity</dt>
        <dd className="text-text-1">{sensitivity}</dd>
        <dt className="text-text-2">Raised</dt>
        <dd className="text-text-1">{when(approval.raisedAt)}</dd>
        <dt className="text-text-2">Expires</dt>
        <dd className="text-text-1">{when(approval.expiresAt)}</dd>
        <dt className="text-text-2">Plan hash</dt>
        <dd data-testid="approval-plan-hash" className="font-mono break-all text-text-1">
          {approval.planHash}
        </dd>
        {approval.decidedBy !== undefined ? (
          <>
            <dt className="text-text-2">Decided by</dt>
            <dd data-testid="approval-decided-by" className="text-text-1">
              {approval.decidedBy.subject} — {when(approval.decidedAt)}
            </dd>
          </>
        ) : null}
        {approval.decisionReason !== undefined ? (
          <>
            <dt className="text-text-2">Reason</dt>
            <dd className="text-text-1">{approval.decisionReason}</dd>
          </>
        ) : null}
      </dl>

      {approval.state === 'pending' ? (
        <section
          role="status"
          data-testid="approval-decision-not-wired"
          className="rounded-lg border border-status-write-border bg-status-write-bg p-3 text-[13px] text-status-write-strong"
        >
          <p className="font-semibold">Deciding from the portal is not available yet.</p>
          <p className="mt-1">
            The gateway can hold and check an approval, but it does not yet accept a human decision
            over any of its interfaces, so a button here would record nothing. Next: the owner
            decides whether the gateway gains a decision path (it would be a write path, which the
            read API does not allow).
          </p>
        </section>
      ) : null}
    </main>
  );
}
