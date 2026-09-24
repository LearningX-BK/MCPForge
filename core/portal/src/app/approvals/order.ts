// MCPForge — W0-J15: the queue's ONE ordering rule (03 §5.3).
//
// "The queue is one list with a hard visual separation by urgency: expiring
// runtime approvals pin to the top with a live countdown."
//
// Pinned group: every runtime approval still `pending` (i.e. still capable of
// expiring — approved/rejected/expired runtime approvals are not "expiring"
// any more), ordered by `expiresAt` ascending so the soonest-to-expire is
// literally first. Everything else — decided/expired runtime rows AND every
// definitional row — sorts by recency of the last thing that happened to it,
// most recent first, so a fresh proposal or a freshly-decided approval does
// not get buried.
import type { ApprovalQueueEntry } from './types';

function isPinned(entry: ApprovalQueueEntry): boolean {
  return entry.kind === 'runtime' && entry.approval.state === 'pending';
}

function activityInstant(entry: ApprovalQueueEntry): number {
  if (entry.kind === 'runtime') {
    return new Date(entry.approval.decidedAt ?? entry.approval.raisedAt).getTime();
  }
  return new Date(entry.createdAt).getTime();
}

export function orderApprovalQueue(
  entries: readonly ApprovalQueueEntry[],
): readonly ApprovalQueueEntry[] {
  const pinned = entries.filter(isPinned).sort((a, b) => {
    // Both are runtime+pending here, so `expiresAt` is always present.
    const ea = new Date((a as Extract<ApprovalQueueEntry, { kind: 'runtime' }>).approval.expiresAt).getTime();
    const eb = new Date((b as Extract<ApprovalQueueEntry, { kind: 'runtime' }>).approval.expiresAt).getTime();
    return ea - eb;
  });
  const rest = entries
    .filter((e) => !isPinned(e))
    .sort((a, b) => activityInstant(b) - activityInstant(a));
  return [...pinned, ...rest];
}

/** A stable per-row id, used for React keys and for bulk-selection sets. */
export function entryId(entry: ApprovalQueueEntry): string {
  return entry.kind === 'runtime' ? `runtime:${entry.approval.approvalId}` : `definitional:${entry.id}`;
}
