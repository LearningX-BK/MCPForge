// MCPForge — W0-J15: `orderApprovalQueue` — expiring runtime approvals pin to
// the top, soonest first; everything else sorts by recency (03 §5.3).
import { describe, expect, it } from 'vitest';
import { orderApprovalQueue, entryId } from './order';
import type { ApprovalQueueEntry, RuntimeApprovalEntry } from './types';

const NOW = 1_780_000_000_000;

function runtime(
  id: string,
  state: 'pending' | 'approved' | 'rejected' | 'expired',
  expiresInMs: number,
  decidedAgoMs?: number,
): RuntimeApprovalEntry {
  return {
    kind: 'runtime',
    href: `/approvals/${id}`,
    application: 'JDE AP',
    sensitivity: 'financial',
    approval: {
      approvalId: id,
      state,
      requester: { subject: 'r@example.com' },
      approvers: [{ subject: 'a@example.com' }],
      raisedAt: new Date(NOW - 60_000).toISOString(),
      decidedAt: decidedAgoMs !== undefined ? new Date(NOW - decidedAgoMs).toISOString() : undefined,
      expiresAt: new Date(NOW + expiresInMs).toISOString(),
      planHash: 'sha256:aaaa',
      argsCanonicalHash: 'sha256:bbbb',
      toolId: 'jde.ap.voucher.create',
      envClass: 'prod',
    },
  };
}

function definitional(id: string, createdAgoMs: number, state: 'in_review' | 'withdrawn' = 'in_review'): ApprovalQueueEntry {
  return {
    kind: 'definitional',
    id,
    title: `Change ${id}`,
    state,
    author: 'p@example.com',
    createdAt: new Date(NOW - createdAgoMs).toISOString(),
    href: `/build/${id}`,
    application: 'JDE AP',
  };
}

describe('orderApprovalQueue', () => {
  it('pins pending runtime approvals to the top, soonest expiry first', () => {
    const soon = runtime('apr_soon', 'pending', 45_000);
    const later = runtime('apr_later', 'pending', 25 * 60_000);
    const change = definitional('chg_new', 5 * 60_000);

    const ordered = orderApprovalQueue([change, later, soon]);

    expect(ordered.map(entryId)).toEqual([entryId(soon), entryId(later), entryId(change)]);
  });

  it('does not pin a decided runtime approval — it sorts with the rest by recency', () => {
    const decided = runtime('apr_decided', 'approved', 10 * 60_000, 5 * 60_000);
    const stillPending = runtime('apr_pending', 'pending', 30_000);
    const freshChange = definitional('chg_fresh', 60_000); // 1 min ago — most recent

    const ordered = orderApprovalQueue([decided, freshChange, stillPending]);

    // Pending pins first regardless of recency.
    expect(ordered[0]).toBe(stillPending);
    // The decided runtime row (5m ago) and the fresh change (1m ago) share the
    // recency pool — the fresher one (the change) comes first.
    expect(ordered[1]).toBe(freshChange);
    expect(ordered[2]).toBe(decided);
  });

  it('keeps an expired runtime approval in the list rather than dropping it', () => {
    const expired = runtime('apr_expired', 'expired', -5 * 60_000);
    const ordered = orderApprovalQueue([expired]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]).toBe(expired);
  });

  it('sorts definitional-only entries by recency, most recent first', () => {
    const older = definitional('chg_old', 9 * 24 * 60 * 60_000, 'withdrawn');
    const newer = definitional('chg_new', 26 * 60_000, 'in_review');
    const ordered = orderApprovalQueue([older, newer]);
    expect(ordered).toEqual([newer, older]);
  });
});
