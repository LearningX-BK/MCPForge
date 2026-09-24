// MCPForge — W0-J15: the runtime-approval-state chip for the queue row.
//
// `ApprovalStateView` (`pending`/`approved`/`rejected`/`expired`) is W0-J8's
// vocabulary (write-path/types.ts) — this file adds no new state, only a
// `StatusEntry` mapping for it so the queue row can use the same
// `StatusChip` primitive `ChangeStateChip` and every other chip use. The
// four entries mirror `approval-gate-card.tsx`'s own `STATE_CHIP` table
// (same tokens, same icons, same srLabel wording) rather than diverging —
// duplicated here because that table is module-private to a file outside
// this task's `touches: core/portal/src/app/approvals/**`.
import type { StatusEntry } from '@mcpforge/shared';
import type { ApprovalStateView } from '@/components/write-path';
import { StatusChip, type ChipTreatment } from '@/components/chips';

export const RUNTIME_APPROVAL_STATE: Readonly<Record<ApprovalStateView, StatusEntry>> = {
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

export interface RuntimeStateChipProps {
  state: ApprovalStateView;
  treatment?: ChipTreatment | undefined;
  className?: string | undefined;
}

export function RuntimeStateChip({ state, treatment, className }: RuntimeStateChipProps) {
  return <StatusChip entry={RUNTIME_APPROVAL_STATE[state]} treatment={treatment} className={className} />;
}

/** The kind chip — "differentiated but not separated" (03 §5.3). */
const KIND_ENTRY: Readonly<Record<'runtime' | 'definitional', StatusEntry>> = {
  runtime: {
    token: 'status-write',
    label: 'Runtime',
    srLabel: 'Runtime approval. A live write call is waiting on a human, backed by the gateway audit store.',
    icon: 'Zap',
  },
  definitional: {
    token: 'status-platform',
    label: 'Definitional',
    srLabel: 'Definitional approval. A proposed git change is waiting on review.',
    icon: 'GitPullRequest',
  },
};

export function KindChip({ kind, className }: { kind: 'runtime' | 'definitional'; className?: string }) {
  return <StatusChip entry={KIND_ENTRY[kind]} treatment="outline" className={className} />;
}
