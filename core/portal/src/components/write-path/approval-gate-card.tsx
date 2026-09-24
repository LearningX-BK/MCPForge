// MCPForge — W0-J8: `ApprovalGateCard`, the REQUESTER's view of the approval
// gate (03 §7.4, §7.6).
//
// "When the plan comes back `awaiting_human_approval` instead of
// `confirm_required`, the card changes shape rather than the flow branching to
// a different screen: the same plan content, with the actions replaced by a
// status block — approval id, the named approver(s), when it was raised, and a
// live state. Plus a copyable link ... **No polling spinner as the only
// feedback** — the state block says 'waiting for Meera Rao since 14:02'
// because a named person is more actionable than a spinner."
//
// So: this is W0-J7's `PlanReviewCard` with a status block in its `actions`
// slot. Same card, same content, different shape.
//
// SECURITY SHAPE — "the approver does not execute; the requester does":
//
//   This component is the requester's, and it is the ONLY one of the two
//   approval components that has a confirm affordance at all. The confirm
//   action is passed in as `confirmAction` and is rendered **only** when
//   `approval.state === 'approved'` — a pending, rejected or expired approval
//   renders no execute affordance whatever the caller passed. That mirrors the
//   gateway: `RaiseOutcome` has no `confirmToken` field, and the token minted
//   on approval is bound to the requester's subject
//   (core/gateway/policy/approval/types.ts). See approver-decision-panel.tsx
//   for the other half of the separation.
//
// There is no spinner in this file, in any state.
'use client';

import type { StatusEntry } from '@mcpforge/shared';
import { cn } from 'cn';

import type { ReactNode } from 'react';

import { StatusChip } from '../chips/status-chip';
import { PlanReviewCard, type PlanReviewCardProps } from './plan-review-card';
import type { ApprovalPersonView, ApprovalStateView, ApprovalView } from './types';

/** How a person is named in prose. Subject is the audit value; it always shows. */
export function personLabel(person: ApprovalPersonView): string {
  return person.displayName ? `${person.displayName} (${person.subject})` : person.subject;
}

/** `14:02` — the "since" in "waiting for Meera Rao since 14:02". */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The state line. Never a bare status word and never a spinner: for a pending
 * approval it names a person and a time, which is what the requester can
 * actually act on.
 */
export function approvalStateSentence(approval: ApprovalView): string {
  const names = approval.approvers.map(personLabel).join(', ');
  switch (approval.state) {
    case 'pending':
      return names.length > 0
        ? `Waiting for ${names} since ${timeOfDay(approval.raisedAt)}.`
        : `Waiting for an approver since ${timeOfDay(approval.raisedAt)}. No approver is named on this request — chase it with the link below.`;
    case 'approved':
      return `Approved by ${approval.decidedBy ? personLabel(approval.decidedBy) : 'an approver'}${
        approval.decidedAt ? ` at ${timeOfDay(approval.decidedAt)}` : ''
      }. You can now confirm and execute — the approver did not.`;
    case 'rejected':
      return `Declined by ${approval.decidedBy ? personLabel(approval.decidedBy) : 'an approver'}${
        approval.decidedAt ? ` at ${timeOfDay(approval.decidedAt)}` : ''
      }.${approval.decisionReason ? ` Reason: ${approval.decisionReason}` : ''}`;
    case 'expired':
      return `This approval expired at ${timeOfDay(approval.expiresAt)}. Nothing was executed. Plan again to raise a fresh approval.`;
  }
}

const STATE_CHIP: Record<ApprovalStateView, StatusEntry> = {
  pending: {
    token: 'status-write',
    label: 'Awaiting approval',
    srLabel: 'Approval state: awaiting a human approval. No confirm token has been minted.',
    icon: 'UserCheck',
  },
  approved: {
    token: 'status-ok',
    label: 'Approved',
    srLabel: 'Approval state: approved. The confirm token is minted and bound to the requester.',
    icon: 'CircleCheck',
  },
  rejected: {
    token: 'status-danger',
    label: 'Declined',
    srLabel: 'Approval state: declined. No confirm token exists and nothing was executed.',
    icon: 'CircleX',
  },
  expired: {
    token: 'status-neutral',
    label: 'Expired',
    srLabel: 'Approval state: expired. The approval died with its plan and nothing was executed.',
    icon: 'TimerOff',
  },
};

export interface ApprovalGateCardProps extends Omit<PlanReviewCardProps, 'actions'> {
  approval: ApprovalView;
  /**
   * The requester's `ConfirmAction`. Rendered ONLY when the approval is
   * `approved` — see the security note at the top of this file.
   */
  confirmAction?: ReactNode;
}

export function ApprovalGateCard({
  approval,
  confirmAction,
  ...planProps
}: ApprovalGateCardProps) {
  const chip = STATE_CHIP[approval.state];

  return (
    <PlanReviewCard
      {...planProps}
      actions={
        <div
          data-testid="approval-status-block"
          data-approval-state={approval.state}
          className={cn('flex w-full flex-col gap-2 rounded-md border border-line bg-surface-3 p-3')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip entry={chip} />
            <span className="font-mono text-[12px]/[1.45] text-text-2">
              <span className="sr-only">Approval id: </span>
              {approval.approvalId}
            </span>
          </div>

          {/* A named person and a time — never a spinner (03 §7.4). */}
          <p
            data-testid="approval-state-sentence"
            role="status"
            aria-live="polite"
            className="text-[13.5px]/[1.55] text-text-1"
          >
            {approvalStateSentence(approval)}
          </p>

          <p className="text-[12.5px]/[1.5] text-text-2">
            Raised {new Date(approval.raisedAt).toISOString()} · expires{' '}
            {new Date(approval.expiresAt).toISOString()}
          </p>

          {approval.approvalUrl ? (
            <p className="text-[12.5px]/[1.5]">
              <a
                data-testid="approval-link"
                href={approval.approvalUrl}
                className="font-mono underline underline-offset-2"
              >
                {approval.approvalUrl}
              </a>{' '}
              <span className="text-text-2">— the approval, to chase out of band.</span>
            </p>
          ) : null}

          {/* The requester executes, and only after approval. */}
          {approval.state === 'approved' && confirmAction ? (
            <div data-testid="approval-confirm-slot" className="pt-1">
              {confirmAction}
            </div>
          ) : null}
        </div>
      }
    />
  );
}
