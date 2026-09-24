// MCPForge — the `awaiting_human_approval` queue's state machine. W0-C3,
// 02 §3.1.1: "No `confirmToken` is minted until a human approves in the portal.
// Phase 3 owns that queue's UX; the gateway owns the state machine."
//
// This file tests the state machine's persistence only. Who may approve, and
// whether an approver may approve their own request, are policy questions the
// chain above answers — see `./types.ts`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { APPROVAL_ID_PREFIX } from './approvals.js';
import { ApprovalNotPendingError } from './types.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-approval-'));

const T0 = '2026-08-30T09:00:00.000Z';
const T1 = '2026-08-30T09:30:00.000Z';
const EXPIRES = '2026-08-30T10:00:00.000Z';
const AFTER_EXPIRY = '2026-08-30T11:00:00.000Z';

function request(overrides: Record<string, unknown> = {}) {
  return {
    planHash: 'plan-hash-0001',
    argsCanonicalHash: 'a'.repeat(64),
    planSummary:
      'Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP. This creates an OPEN PAYABLE in JD Edwards.',
    callerSubject: 'user:aisha.khan@ltm.example',
    consumerId: 'consumer:claude-desktop',
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    expiresAt: EXPIRES,
    now: T0,
    ...overrides,
  };
}

describe('the approval queue state machine', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterAll(async () => {
    await store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a pending request with the agent-facing `apr_` id 02 §3.1.1 shows', async () => {
    const created = await store.approvals.create(request());
    expect(created.id.startsWith(APPROVAL_ID_PREFIX)).toBe(true);
    expect(created.status).toBe('pending');
    expect(created.approverSubject).toBeNull();
    expect(created.decidedAt).toBeNull();
    expect(await store.approvals.get(created.id)).toEqual(created);
  });

  it('binds the plan AND the canonical arguments, not the plan alone', async () => {
    // The reason is the reason the confirm token binds both (02 §3.1.1): an
    // approval that named only a plan would let an agent obtain a human's
    // approval for one set of arguments and execute another.
    const created = await store.approvals.create(request());
    const stored = await store.approvals.get(created.id);
    expect(stored?.planHash).toBe('plan-hash-0001');
    expect(stored?.argsCanonicalHash).toBe('a'.repeat(64));
    // Stored verbatim: this is the record of what a human actually agreed to.
    expect(stored?.planSummary).toContain('OPEN PAYABLE');
  });

  it('lists pending requests oldest first, and drops them from the queue once decided', async () => {
    const pendingBefore = await store.approvals.listPending();
    expect(pendingBefore.length).toBeGreaterThanOrEqual(2);
    expect([...pendingBefore].sort((a, b) => a.createdAt.localeCompare(b.createdAt))).toEqual(
      pendingBefore,
    );

    const target = pendingBefore[0];
    if (target === undefined) {
      throw new Error('expected a pending request');
    }
    await store.approvals.decide({
      id: target.id,
      status: 'approved',
      approverSubject: 'user:marcus.reed@ltm.example',
      reason: 'Checked against PO 0000451.',
      now: T1,
    });
    expect((await store.approvals.listPending()).map((r) => r.id)).not.toContain(target.id);
  });

  it('records who decided, when, and why — an approval nobody’s name is on is not an approval', async () => {
    const created = await store.approvals.create(request());
    const decided = await store.approvals.decide({
      id: created.id,
      status: 'approved',
      approverSubject: 'user:marcus.reed@ltm.example',
      reason: 'Within delegated authority.',
      now: T1,
    });
    expect(decided.status).toBe('approved');
    expect(decided.approverSubject).toBe('user:marcus.reed@ltm.example');
    expect(decided.decisionReason).toBe('Within delegated authority.');
    expect(decided.decidedAt).toBe(T1);
  });

  it('rejects as well as approves', async () => {
    const created = await store.approvals.create(request());
    const decided = await store.approvals.decide({
      id: created.id,
      status: 'rejected',
      approverSubject: 'user:marcus.reed@ltm.example',
      now: T1,
    });
    expect(decided.status).toBe('rejected');
  });

  it('refuses a second decision — one decision, not a lost update', async () => {
    const created = await store.approvals.create(request());
    await store.approvals.decide({
      id: created.id,
      status: 'approved',
      approverSubject: 'user:marcus.reed@ltm.example',
      now: T1,
    });
    const error = await store.approvals
      .decide({
        id: created.id,
        status: 'rejected',
        approverSubject: 'user:someone.else@ltm.example',
        now: T1,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApprovalNotPendingError);
    expect((error as ApprovalNotPendingError).status).toBe('approved');
    // The first approver's name still stands on the record.
    expect((await store.approvals.get(created.id))?.approverSubject).toBe(
      'user:marcus.reed@ltm.example',
    );
  });

  it('two approvers acting at once produce exactly one decision', async () => {
    const created = await store.approvals.create(request());
    const outcomes = await Promise.allSettled([
      store.approvals.decide({
        id: created.id,
        status: 'approved',
        approverSubject: 'user:first@ltm.example',
        now: T1,
      }),
      store.approvals.decide({
        id: created.id,
        status: 'rejected',
        approverSubject: 'user:second@ltm.example',
        now: T1,
      }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ApprovalNotPendingError);
  });

  it('expires pending requests whose window has closed, as a visible state change', async () => {
    const created = await store.approvals.create(request());
    const moved = await store.approvals.expireDue(AFTER_EXPIRY);
    expect(moved).toBeGreaterThanOrEqual(1);
    // Recorded as `expired`, not merely filtered out of a query: the portal's
    // queue and anyone auditing what happened to a request must both see it.
    expect((await store.approvals.get(created.id))?.status).toBe('expired');
    expect((await store.approvals.listPending()).map((r) => r.id)).not.toContain(created.id);
  });

  it('refuses to decide an expired request rather than quietly reviving it', async () => {
    const created = await store.approvals.create(request());
    const error = await store.approvals
      .decide({
        id: created.id,
        status: 'approved',
        approverSubject: 'user:marcus.reed@ltm.example',
        now: AFTER_EXPIRY,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApprovalNotPendingError);
    expect((error as ApprovalNotPendingError).status).toBe('expired');
    expect((await store.approvals.get(created.id))?.approverSubject).toBeNull();
  });

  it('is runtime state, not governance evidence — it lives in the store, not git', async () => {
    // 02 §10.3: the approval RECORD is a git artefact in `approvals/`; the
    // approval QUEUE's runtime state is the store. `W0-C6` deletes `.mcpforge/`
    // and expects a working system, so an in-flight request is expected to be
    // lost and no approval record is.
    const fresh = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'fresh.db') });
    expect(await fresh.approvals.listPending()).toEqual([]);
    await fresh.close();
  });
});
