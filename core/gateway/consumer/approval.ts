// MCPForge — the approval record a consumer-registry change carries. W0-N1.
//
// 02 §11.2: registration is admin-approved, and because the record is a git
// artefact "admin approval is FREE — it is the change-proposal flow that
// already exists." Wave 0 exit criterion 8's `approvals/` machinery is what
// that flow records into, and `core/codegen/src/rules/grants.ts` already
// resolves an approval by its file basename or by an explicit `id:` inside
// it. This module follows that convention exactly rather than inventing a
// second one.
//
// NEEDS_HUMAN (flagged, not fabricated): the plan states that approvals live
// in `approvals/` and that a record names its approver and its expiry, but it
// specifies no field-by-field schema for `kind: Approval`, and there is no
// `approval.schema.json` — `Approval` is not one of the five MANIFEST_KINDS.
// The shape below is therefore the minimum the plan's own prose requires and
// nothing more, and `approver`/`approvedAt` are ABSENT rather than filled
// with a placeholder: this file will not write a name nobody gave.

import { stringify as stringifyYaml } from 'yaml';

export type ApprovalAction = 'register' | 'suspend' | 'retire' | 'rotate-credential-schedule';

export interface BuildApprovalInput {
  readonly action: ApprovalAction;
  readonly consumerId: string;
  readonly summary: string;
  /** `Principal.subject` of the requester — never the approver. */
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly reason?: string;
  readonly today: string;
}

export interface BuiltApprovalRecord {
  readonly id: string;
  readonly content: string;
}

export function approvalRecordPath(id: string): string {
  return `approvals/${id}.yaml`;
}

/**
 * A DRAFT approval record: `status: pending`, no approver, no approvedAt.
 * The named approver completes it at review — which is the point. A record
 * that arrived pre-approved by the process that requested it would be the
 * decoration 02 §11.4.4 names as a failure mode.
 */
export function buildApprovalRecord(input: BuildApprovalInput): BuiltApprovalRecord {
  const id = `${input.today}-consumer-${input.consumerId}-${input.action}`;
  const doc = {
    apiVersion: 'mcpforge/v1',
    kind: 'Approval',
    id,
    status: 'pending',
    subject: { kind: 'Consumer', id: input.consumerId },
    action: input.action,
    summary: input.summary,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
  };
  const header = [
    '# MCPForge approval record — governance evidence, committed with the change it approves.',
    '# PENDING: the named approver completes `approver:` and `approvedAt:` at review.',
    "# Nothing in this repository fills those two fields on an approver's behalf.",
    '',
  ].join('\n');
  return { id, content: `${header}${stringifyYaml(doc, { lineWidth: 0 })}` };
}
