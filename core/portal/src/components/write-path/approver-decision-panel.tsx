// MCPForge — W0-J8: `ApproverDecisionPanel`, the APPROVER's view (03 §7.4,
// §7.6). The content of the eventual `/approvals/[approvalId]` route; the route
// itself is a later J-track task and is not built here.
//
// "the plan text, unmodified, as the largest element. Beside it: who is asking,
// under which role, which tool, which environment, and the **plan hash short
// form** — the approver is approving *that exact plan*, and the hash is what
// makes that claim true rather than rhetorical. Below: effects, warnings,
// guardrails, reversal contract, identity block — the same blocks as the plan
// card, because an approver needs everything the requester saw and nothing
// less. Actions: `Approve` · `Decline` (requires a reason ...) ·
// `Approve with note`."
//
// SECURITY SHAPE — "The approver does not execute; the requester does":
//
//  1. **There is no execute path in this file.** No `onConfirm`, no
//     `confirmAction` slot, no `ConfirmAction` import, no confirm token in any
//     prop, and no `children`/`ReactNode` slot a caller could smuggle one
//     through. The three callbacks are `onApprove(note?)`, `onDecline(reason)`
//     — and that is the entire surface. This mirrors the gateway, where the
//     mint site takes the requester's subject from the stored request and does
//     not accept the approver's at all
//     (core/gateway/policy/approval/types.ts, property 2).
//  2. **Decline requires a reason.** The Decline button carries the real DOM
//     `disabled` attribute until a non-blank reason is typed, and `onDecline`
//     is never called with an empty string. 03 §7.4 returns that reason to the
//     agent as the `next`, and non-negotiable #5 makes a blank one unusable.
//  3. **An expired approval renders as expired.** 03 §7.4: "an expired approval
//     is shown as expired rather than silently disappearing." A decided or
//     expired approval renders the whole plan, plus what happened to it, and
//     NO decision controls — a decision on a dead request is not a thing this
//     panel can express.
//  4. **The panel shows everything the requester saw.** The blocks below are
//     W0-J7's own components, called with the same props, and there is no
//     filter, `compact` or `sections` prop. An approver seeing less than the
//     requester is the failure this arrangement prevents.
'use client';

import * as React from 'react';
import { cn } from 'cn';

import { EnvChip } from '../chips/env-chip';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { EffectsTable } from './effects-table';
import { GuardrailResultList } from './guardrail-result-list';
import { IdentityBlock } from './identity-block';
import { shortHash } from './locked-args';
import { PlanSentence } from './plan-sentence';
import { ReversalContract } from './reversal-contract';
import { WarningList } from './warning-list';
import { personLabel } from './approval-gate-card';
import type {
  ApprovalView,
  GuardrailResultView,
  PlanBodyView,
  ProbeIdentityView,
} from './types';

export interface ApproverDecisionPanelProps {
  approval: ApprovalView;
  /** The plan the approver is approving. Rendered verbatim, largest element. */
  plan: PlanBodyView;
  /** Every guardrail, passed and failed — the same array the requester saw. */
  guardrails?: readonly GuardrailResultView[] | undefined;
  /** Probe-sourced identity of the REQUESTER, who will execute. */
  identity: ProbeIdentityView;
  /** `Approve`, and `Approve with note` when a note has been written. */
  onApprove?: ((note?: string) => void) | undefined;
  /** Never called with a blank reason. */
  onDecline?: ((reason: string) => void) | undefined;
  className?: string | undefined;
}

export function ApproverDecisionPanel({
  approval,
  plan,
  guardrails = [],
  identity,
  onApprove,
  onDecline,
  className,
}: ApproverDecisionPanelProps) {
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const noteId = React.useId();
  const reasonId = React.useId();

  const decidable = approval.state === 'pending';
  const reasonGiven = reason.trim().length > 0;
  const irreversible = plan.reversal.class === 'irreversible';

  return (
    <section
      data-testid="approver-decision-panel"
      data-approval-state={approval.state}
      aria-label={`Approval decision for ${approval.toolId}`}
      className={cn(
        'flex w-full flex-col gap-4 rounded-lg border bg-surface-2 p-4',
        'border-status-write-border border-l-4 border-l-status-write',
        className,
      )}
    >
      {/* The plan text, unmodified, as the largest element. */}
      <PlanSentence plan={plan.plan} />

      {/* Beside it: who is asking, under which role, which tool, which
          environment, and the plan hash short form. */}
      <dl
        data-testid="approval-request-facts"
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]/[1.5]"
      >
        <dt className="font-semibold text-text-2">Requested by</dt>
        <dd data-testid="approval-requester">{personLabel(approval.requester)}</dd>

        <dt className="font-semibold text-text-2">Under role</dt>
        <dd data-testid="approval-requester-role" className="font-mono">
          {approval.requesterRole ?? '— not stated —'}
        </dd>

        <dt className="font-semibold text-text-2">Tool</dt>
        <dd data-testid="approval-tool" className="font-mono">
          {approval.toolId}
          {approval.toolVersion ? ` @ ${approval.toolVersion}` : ''}
        </dd>

        <dt className="font-semibold text-text-2">Environment</dt>
        <dd>
          <EnvChip envClass={approval.envClass} />
        </dd>

        {/* The hash is what makes "that exact plan" true rather than rhetorical. */}
        <dt className="font-semibold text-text-2">Plan hash</dt>
        <dd data-testid="approval-plan-hash" className="font-mono">
          {shortHash(approval.planHash)}
          <span className="ml-2 text-text-2">
            You are approving this exact plan. A different plan has a different hash.
          </span>
        </dd>

        <dt className="font-semibold text-text-2">Arguments hash</dt>
        <dd data-testid="approval-args-hash" className="font-mono">
          {shortHash(approval.argsCanonicalHash)}
        </dd>
      </dl>

      {/* Below: the same blocks as the plan card. Nothing less. */}
      {irreversible ? <ReversalContract reversal={plan.reversal} /> : null}
      <EffectsTable effects={plan.effects} />
      <WarningList warnings={plan.warnings} />
      <GuardrailResultList results={guardrails} />
      {irreversible ? null : <ReversalContract reversal={plan.reversal} />}
      <IdentityBlock identity={identity} />

      {decidable ? (
        <div data-testid="approver-actions" className="flex flex-col gap-3 border-t border-line pt-3">
          <p className="text-[12.5px]/[1.5] text-text-2">
            Approving mints the confirm token for {personLabel(approval.requester)}, who executes
            it. Approving does not execute this call.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId} className="text-[13px]/[1.5] text-text-1">
              Note (optional) — recorded with the approval
            </Label>
            <Textarea
              id={noteId}
              data-testid="approver-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId} className="text-[13px]/[1.5] text-text-1">
              Reason — required to decline, and returned to the agent as its next step
            </Label>
            <Textarea
              id={reasonId}
              data-testid="approver-decline-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              data-testid="approver-approve"
              onClick={() => onApprove?.(note.trim().length > 0 ? note.trim() : undefined)}
            >
              {note.trim().length > 0 ? 'Approve with note' : 'Approve'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="approver-decline"
              // A real `disabled` attribute, not a class. See security note 2.
              disabled={!reasonGiven}
              onClick={() => {
                if (!reasonGiven) return;
                onDecline?.(reason.trim());
              }}
            >
              Decline
            </Button>
            {reasonGiven ? null : (
              <span
                data-testid="approver-decline-hint"
                className="text-[12.5px]/[1.5] text-text-2"
              >
                Declining needs a reason. The requester and the agent see it.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div
          data-testid="approver-decided"
          role="status"
          className="border-t border-line pt-3 text-[13.5px]/[1.55] text-text-1"
        >
          {approval.state === 'expired' ? (
            <p data-testid="approver-expired">
              This approval expired at {new Date(approval.expiresAt).toISOString()}. Approvals
              expire with their plan; nothing was executed and there is no decision to make. The
              requester must plan again.
            </p>
          ) : (
            <p>
              {approval.state === 'approved' ? 'Approved' : 'Declined'} by{' '}
              {approval.decidedBy ? personLabel(approval.decidedBy) : 'an approver'}
              {approval.decidedAt ? ` at ${new Date(approval.decidedAt).toISOString()}` : ''}.
              {approval.decisionReason ? ` Reason: ${approval.decisionReason}` : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
