// MCPForge — single-use confirm nonces. W0-C3, 02 §3.1.1.
//
// The done criterion this file proves: "a nonce is consumed atomically by a
// `UNIQUE`-constrained insert inside the same transaction as the execute, and a
// concurrent second attempt loses deterministically."

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { CONFIRM_NONCE } from '../schema/spec.js';
import { ConfirmNonceAlreadyConsumedError } from './types.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-nonce-'));
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

function consumeInput(nonce: string) {
  return {
    nonce,
    callerSubject: 'user:aisha.khan@ltm.example',
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    planHash: 'plan-hash-0001',
    expiresAt: FAR_FUTURE,
  };
}

describe('confirm nonces are single-use', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterAll(async () => {
    await store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the nonce column is UNIQUE in the single schema definition', () => {
    // The guarantee is the constraint, so the constraint is asserted directly
    // rather than only through its effects.
    const unique = (CONFIRM_NONCE.indexes ?? []).find((ix) => ix.columns.join() === 'nonce');
    expect(unique?.unique).toBe(true);
  });

  it('consumes a nonce once and records who spent it', async () => {
    const consumed = await store.nonces.consume(consumeInput('nonce-happy'));
    expect(consumed.nonce).toBe('nonce-happy');
    expect(consumed.callerSubject).toBe('user:aisha.khan@ltm.example');
    expect(await store.nonces.find('nonce-happy')).toMatchObject({
      toolId: 'jde.ap.voucher.create',
    });
  });

  it('refuses a second consume of the same nonce, naming the consumption that won', async () => {
    await store.nonces.consume(consumeInput('nonce-replay'));
    const error = await store.nonces.consume(consumeInput('nonce-replay')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmNonceAlreadyConsumedError);
    expect((error as ConfirmNonceAlreadyConsumedError).existing.nonce).toBe('nonce-replay');
  });

  it('a concurrent second attempt loses deterministically — exactly one winner', async () => {
    // Genuinely overlapping: both promises are created before either is awaited,
    // so the second insert is issued against a store that the first has already
    // claimed. The arbiter is the UNIQUE index, not the scheduling order, which
    // is why the outcome is one success and one refusal every time rather than
    // one success and one silent duplicate.
    const attempts = await Promise.allSettled([
      store.nonces.consume({ ...consumeInput('nonce-race'), callerSubject: 'user:a' }),
      store.nonces.consume({ ...consumeInput('nonce-race'), callerSubject: 'user:b' }),
    ]);

    const won = attempts.filter((a) => a.status === 'fulfilled');
    const lost = attempts.filter((a) => a.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConfirmNonceAlreadyConsumedError,
    );

    // And the store holds exactly one consumption, whichever caller won it.
    const stored = await store.nonces.find('nonce-race');
    expect(stored).toBeDefined();
    expect(['user:a', 'user:b']).toContain(stored?.callerSubject);
  });

  it('ten concurrent attempts still yield exactly one winner', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => store.nonces.consume(consumeInput('nonce-storm'))),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(
      attempts
        .filter((a): a is PromiseRejectedResult => a.status === 'rejected')
        .every((a) => a.reason instanceof ConfirmNonceAlreadyConsumedError),
    ).toBe(true);
  });

  it('sweeps only nonces whose token can no longer be presented', async () => {
    await store.nonces.consume({
      ...consumeInput('nonce-stale'),
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    await store.nonces.consume({ ...consumeInput('nonce-live'), expiresAt: FAR_FUTURE });

    const removed = await store.nonces.deleteExpired('2021-01-01T00:00:00.000Z');
    expect(removed).toBe(1);
    expect(await store.nonces.find('nonce-stale')).toBeUndefined();
    // Sweeping a live nonce would make its token reusable — the one thing this
    // table exists to prevent.
    expect(await store.nonces.find('nonce-live')).toBeDefined();
  });
});

describe('the nonce is consumed INSIDE the same transaction as the execute (02 §3.1.1)', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'atomic.db') });
  });

  afterAll(async () => {
    await store?.close();
  });

  it('a rolled-back execute leaves the nonce unspent, so the plan can be retried', async () => {
    await expect(
      store.transaction(async () => {
        await store.nonces.consume(consumeInput('nonce-rollback'));
        // Stands in for the binding failing after the nonce was consumed.
        throw new Error('the target refused the write');
      }),
    ).rejects.toThrow('the target refused');

    // If consumption had happened outside the unit, the nonce would now be
    // spent on a call that never happened and the human's approved plan would
    // be unusable — a dead end with no next action.
    expect(await store.nonces.find('nonce-rollback')).toBeUndefined();
  });

  it('a committed execute spends the nonce and writes the audit row as one unit', async () => {
    await store.transaction(async () => {
      await store.nonces.consume({ ...consumeInput('nonce-commit'), callId: 'call-1' });
      await store.audit.append({
        callerSubject: 'user:aisha.khan@ltm.example',
        consumerId: 'consumer:portal',
        humanInTheLoop: true,
        toolId: 'jde.ap.voucher.create',
        isWrite: true,
        deploymentId: 'dep-atomic',
        phase: 'execute',
        outcome: 'ok',
      });
    });

    expect(await store.nonces.find('nonce-commit')).toBeDefined();
    expect(await store.audit.chainHead('dep-atomic')).toBeDefined();
  });

  it('and neither survives if the unit rolls back after the audit append', async () => {
    await expect(
      store.transaction(async () => {
        await store.nonces.consume(consumeInput('nonce-both'));
        await store.audit.append({
          callerSubject: 'user:aisha.khan@ltm.example',
          consumerId: 'consumer:portal',
          humanInTheLoop: true,
          toolId: 'jde.ap.voucher.create',
          isWrite: true,
          deploymentId: 'dep-rollback',
          phase: 'execute',
          outcome: 'ok',
        });
        throw new Error('post-audit failure');
      }),
    ).rejects.toThrow('post-audit failure');

    expect(await store.nonces.find('nonce-both')).toBeUndefined();
    expect(await store.audit.chainHead('dep-rollback')).toBeUndefined();
  });
});
