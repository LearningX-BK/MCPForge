// MCPForge — idempotency records. W0-C3, 02 §3.1.2.
//
// The done criterion this file proves: "the idempotency record is written
// **before** the binding is invoked and completed after; a replay within
// `scopeHours` returns the original result."

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { IDEMPOTENCY_RECORD } from '../schema/spec.js';
import {
  DEFAULT_IDEMPOTENCY_SCOPE_HOURS,
  confirmTokenHash,
  idempotencyKeyFor,
} from './idempotency.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-idem-'));

const T0 = '2026-08-30T09:00:00.000Z';
const PLUS_1H = '2026-08-30T10:00:00.000Z';
const PLUS_25H = '2026-08-31T10:00:00.000Z';

function call(overrides: Partial<Parameters<RuntimeStore['idempotency']['begin']>[0]> = {}) {
  return {
    callerSubject: 'user:aisha.khan@ltm.example',
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    argsCanonicalHash: 'a'.repeat(64),
    confirmToken: 'cnf_01J9EXAMPLE',
    now: T0,
    ...overrides,
  };
}

describe('the idempotency key is 02 §3.1.2’s composition', () => {
  it('binds all five parts — a change to any one changes the key', () => {
    const base = idempotencyKeyFor(call());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyKeyFor(call({ callerSubject: 'user:other' }))).not.toBe(base);
    expect(idempotencyKeyFor(call({ toolId: 'jde.ap.voucher.cancel' }))).not.toBe(base);
    expect(idempotencyKeyFor(call({ toolVersion: '2.0.0' }))).not.toBe(base);
    expect(idempotencyKeyFor(call({ argsCanonicalHash: 'b'.repeat(64) }))).not.toBe(base);
    expect(idempotencyKeyFor(call({ confirmToken: 'cnf_OTHER' }))).not.toBe(base);
  });

  it('is stable — the same five parts always compose the same key', () => {
    expect(idempotencyKeyFor(call())).toBe(idempotencyKeyFor(call({ now: PLUS_25H })));
  });

  it('defaults the window to 24 hours (02 §3.1.2)', () => {
    expect(DEFAULT_IDEMPOTENCY_SCOPE_HOURS).toBe(24);
  });

  it('has a UNIQUE key column in the single schema definition', () => {
    const unique = (IDEMPOTENCY_RECORD.indexes ?? []).find(
      (ix) => ix.columns.join() === 'idempotency_key',
    );
    expect(unique?.unique).toBe(true);
  });
});

describe('idempotency records', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterAll(async () => {
    await store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the record BEFORE the binding is invoked, as pending with no result', async () => {
    const begun = await store.idempotency.begin(call());
    expect(begun.outcome).toBe('started');
    // The row exists and is durable at the moment the caller is told to invoke
    // the binding — which is the entire point: the retry of a call that timed
    // out mid-binding must find something.
    const stored = await store.idempotency.get(begun.idempotencyKey);
    expect(stored?.status).toBe('pending');
    expect(stored?.result).toBeNull();
    expect(stored?.completedAt).toBeNull();
    expect(stored?.expiresAt).toBe('2026-08-31T09:00:00.000Z');
  });

  it('never stores the confirm token in the clear', async () => {
    const stored = await store.idempotency.get(idempotencyKeyFor(call()));
    expect(stored?.confirmTokenHash).toBe(
      createHash('sha256').update('cnf_01J9EXAMPLE', 'utf8').digest('hex'),
    );
    expect(JSON.stringify(stored)).not.toContain('cnf_01J9EXAMPLE');
    expect(confirmTokenHash('cnf_01J9EXAMPLE')).toBe(stored?.confirmTokenHash);
  });

  it('completes the record AFTER, with the outcome', async () => {
    const key = idempotencyKeyFor(call());
    const completed = await store.idempotency.complete({
      idempotencyKey: key,
      result: { voucherNumber: '0000451', status: 'OPEN' },
      callId: 'call-1',
      now: PLUS_1H,
    });
    expect(completed.status).toBe('completed');
    expect(completed.result).toEqual({ voucherNumber: '0000451', status: 'OPEN' });
    expect(completed.completedAt).toBe(PLUS_1H);
    expect(completed.callId).toBe('call-1');
  });

  it('a repeat within scopeHours returns the ORIGINAL result rather than executing again', async () => {
    const repeat = await store.idempotency.begin(call({ now: PLUS_1H }));
    expect(repeat.outcome).toBe('replayed');
    expect(repeat.record.result).toEqual({ voucherNumber: '0000451', status: 'OPEN' });
    // Byte-identical to the first outcome, not a re-derivation of it.
    expect(repeat.record.callId).toBe('call-1');
    expect(await store.idempotency.findReplay(repeat.idempotencyKey, { now: PLUS_1H })).toEqual(
      repeat.record,
    );
  });

  it('a repeat AFTER the window executes again — and the new row describes the new execution', async () => {
    const after = await store.idempotency.begin(call({ now: PLUS_25H }));
    expect(after.outcome).toBe('started');
    expect(after.record.status).toBe('pending');
    expect(after.record.createdAt).toBe(PLUS_25H);
    expect(
      await store.idempotency.findReplay(after.idempotencyKey, { now: PLUS_25H }),
    ).toBeUndefined();
  });

  it('honours a caller-supplied scopeHours over the window recorded on the row', async () => {
    const key = idempotencyKeyFor(call());
    await store.idempotency.complete({ idempotencyKey: key, result: { ok: true }, now: PLUS_25H });
    // Recorded window is 24h from PLUS_25H, so the row itself is still live…
    expect(await store.idempotency.findReplay(key, { now: PLUS_25H })).toBeDefined();
    // …but a tool that declares a one-hour window is out of scope already.
    const muchLater = '2026-09-01T12:00:00.000Z';
    expect(
      await store.idempotency.findReplay(key, { now: muchLater, scopeHours: 1 }),
    ).toBeUndefined();
  });

  it('reports an in-flight duplicate rather than letting it execute', async () => {
    const first = await store.idempotency.begin(call({ argsCanonicalHash: 'c'.repeat(64) }));
    expect(first.outcome).toBe('started');
    const second = await store.idempotency.begin(call({ argsCanonicalHash: 'c'.repeat(64) }));
    // Not `started` — the binding must not be invoked twice — and not
    // `replayed` either, because there is no original result to replay yet.
    expect(second.outcome).toBe('in_flight');
    expect(second.record.status).toBe('pending');
  });

  it('two concurrent begins on one key produce exactly one "started"', async () => {
    const input = call({ argsCanonicalHash: 'd'.repeat(64) });
    const [a, b] = await Promise.all([
      store.idempotency.begin(input),
      store.idempotency.begin(input),
    ]);
    expect([a.outcome, b.outcome].filter((o) => o === 'started')).toHaveLength(1);
    expect([a.outcome, b.outcome].filter((o) => o === 'in_flight')).toHaveLength(1);
  });

  it('replays a recorded failure rather than retrying it', async () => {
    const input = call({ argsCanonicalHash: 'e'.repeat(64) });
    const begun = await store.idempotency.begin(input);
    await store.idempotency.fail({
      idempotencyKey: begun.idempotencyKey,
      errorCode: 'TARGET_TIMEOUT',
      result: { code: 'TARGET_TIMEOUT', next: 'Check jde.ap.voucher.get before retrying.' },
      now: PLUS_1H,
    });
    const repeat = await store.idempotency.begin({ ...input, now: PLUS_1H });
    // Conservative by design: a binding that reported an error may still have
    // committed at the target, so the failure is replayed rather than re-run.
    expect(repeat.outcome).toBe('replayed');
    expect(repeat.record.status).toBe('failed');
    expect(repeat.record.errorCode).toBe('TARGET_TIMEOUT');
  });

  it('refuses to settle a record that was never begun', async () => {
    await expect(
      store.idempotency.complete({ idempotencyKey: 'f'.repeat(64), result: {} }),
    ).rejects.toThrow(/never called/);
  });

  it('cannot overwrite an outcome a replay is already serving', async () => {
    const input = call({ argsCanonicalHash: '1'.repeat(64) });
    const begun = await store.idempotency.begin(input);
    await store.idempotency.complete({
      idempotencyKey: begun.idempotencyKey,
      result: { first: true },
      now: PLUS_1H,
    });
    await expect(
      store.idempotency.complete({
        idempotencyKey: begun.idempotencyKey,
        result: { second: true },
        now: PLUS_1H,
      }),
    ).rejects.toThrow();
    const stored = await store.idempotency.get(begun.idempotencyKey);
    expect(stored?.result).toEqual({ first: true });
  });

  it('sweeps records whose window has closed', async () => {
    const removed = await store.idempotency.deleteExpired('2099-01-01T00:00:00.000Z');
    expect(removed).toBeGreaterThan(0);
    expect(await store.idempotency.get(idempotencyKeyFor(call()))).toBeUndefined();
  });
});

describe('where `begin` sits relative to the execute transaction', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'atomic.db') });
  });

  afterAll(async () => {
    await store?.close();
  });

  // These two tests document a composition decision the policy chain (W0-F3)
  // must make deliberately, because the store supports both and they are not
  // equivalent:
  //
  //  - `begin` COMMITTED BEFORE the execute transaction (the first test) is
  //    what 02 §3.1.2 means by "written before the binding is invoked". The
  //    record survives a rolled-back or crashed execute, which is exactly the
  //    ambiguous-timeout case the mechanism exists for: no local transaction
  //    can be atomic with a side effect in JD Edwards, so the record has to
  //    outlive the local unit or it protects nothing.
  //  - `begin` INSIDE the execute transaction (the second test) ties the record
  //    to the unit's fate. Coherent — a rolled-back unit spent no nonce and
  //    wrote no audit row, so a retry is a genuinely fresh attempt — but it
  //    leaves the crash-after-target-commit window open.
  //
  // The nonce is the opposite way round and is not a choice: 02 §3.1.1 requires
  // it inside the unit, so a rolled-back execute leaves the human's approved
  // plan usable rather than burning it.

  it('committed before the unit, the record survives a rolled-back execute', async () => {
    const input = call({ argsCanonicalHash: '2'.repeat(64) });
    const begun = await store.idempotency.begin(input);
    await expect(
      store.transaction(async () => {
        await store.nonces.consume({
          nonce: 'nonce-idem-outside',
          callerSubject: input.callerSubject,
          toolId: input.toolId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
        throw new Error('execute failed');
      }),
    ).rejects.toThrow('execute failed');

    expect(await store.idempotency.get(begun.idempotencyKey)).toBeDefined();
    expect(await store.nonces.find('nonce-idem-outside')).toBeUndefined();
  });

  it('opened inside the unit, the record is discarded with it', async () => {
    const input = call({ argsCanonicalHash: '3'.repeat(64) });
    await expect(
      store.transaction(async () => {
        await store.idempotency.begin(input);
        throw new Error('execute failed');
      }),
    ).rejects.toThrow('execute failed');
    expect(await store.idempotency.get(idempotencyKeyFor(input))).toBeUndefined();
  });
});
