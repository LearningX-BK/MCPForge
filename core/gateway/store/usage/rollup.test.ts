// MCPForge — W0-N7's done criterion, aggregation-math clauses: hourly and
// daily rollups carry calls, writes, plans minted, plans never confirmed,
// refusals by error code, distinct tools, distinct binding types, distinct
// human subjects acted for, bytes out and p95 latency.
//
// Runs against a temp-file SQLite store, the Wave 0 default (02 §10.4 item 8),
// matching `../audit/audit.test.ts`'s own setup.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { bucketStartFor } from './repository.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from '../audit/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-usage-'));
const dbFile = join(tempDir, 'runtime.db');
let store: RuntimeStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function call(overrides: Partial<AppendAuditCallInput> = {}): AppendAuditCallInput {
  return {
    callerSubject: 'bikash',
    consumerId: 'agent-rollup',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.create',
    bindingType: 'plsql',
    isWrite: true,
    deploymentId: 'rollup',
    phase: 'execute',
    outcome: 'ok',
    ts: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('bucketStartFor', () => {
  it('floors an instant to the start of its hour', () => {
    expect(bucketStartFor('hour', '2026-09-07T12:34:56.789Z')).toBe('2026-09-07T12:00:00.000Z');
  });

  it('floors an instant to the start of its day', () => {
    expect(bucketStartFor('day', '2026-09-07T12:34:56.789Z')).toBe('2026-09-07T00:00:00.000Z');
  });

  it('an instant just before the boundary stays in the earlier bucket', () => {
    expect(bucketStartFor('hour', '2026-09-07T12:59:59.999Z')).toBe('2026-09-07T12:00:00.000Z');
    expect(bucketStartFor('hour', '2026-09-07T13:00:00.000Z')).toBe('2026-09-07T13:00:00.000Z');
  });
});

describe('consumer usage rollups — aggregation math', () => {
  it('accumulates calls, writes, plans minted/confirmed across several calls in one hour', async () => {
    await store.audit.append(call({ phase: 'plan', outcome: 'ok', correlationId: 'a' }));
    await store.audit.append(call({ phase: 'execute', outcome: 'ok', correlationId: 'b' }));
    await store.audit.append(
      call({ phase: 'plan', isWrite: false, outcome: 'ok', correlationId: 'c' }),
    );
    await store.audit.append(
      call({ isWrite: false, outcome: 'ok', phase: 'execute', correlationId: 'd' }),
    );

    const hourBucket = await store.usage.getBucket(
      'agent-rollup',
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(hourBucket).toBeDefined();
    expect(hourBucket!.calls).toBe(4);
    // Only the two `isWrite: true` calls (both default to true; the second and
    // fourth are overridden to false).
    expect(hourBucket!.writes).toBe(2);
    expect(hourBucket!.plansMinted).toBe(2);
    expect(hourBucket!.plansConfirmed).toBe(2);
    expect(hourBucket!.plansNeverConfirmed).toBe(0);

    const dayBucket = await store.usage.getBucket(
      'agent-rollup',
      'day',
      bucketStartFor('day', '2026-09-07T12:00:00.000Z'),
    );
    expect(dayBucket!.calls).toBe(4);
  });

  it('plansNeverConfirmed is minted-minus-confirmed when a plan has no matching execute yet', async () => {
    await store.audit.append(
      call({ deploymentId: 'plans-open', consumerId: 'agent-open', phase: 'plan', correlationId: 'p1' }),
    );
    await store.audit.append(
      call({ deploymentId: 'plans-open', consumerId: 'agent-open', phase: 'plan', correlationId: 'p2' }),
    );
    await store.audit.append(
      call({ deploymentId: 'plans-open', consumerId: 'agent-open', phase: 'execute', correlationId: 'p3' }),
    );

    const bucket = await store.usage.getBucket(
      'agent-open',
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(bucket!.plansMinted).toBe(2);
    expect(bucket!.plansConfirmed).toBe(1);
    expect(bucket!.plansNeverConfirmed).toBe(1);
  });

  it('counts refusals by error code, distinct tools/binding types/subjects, sums bytes out, and computes an exact p95', async () => {
    const consumerId = 'agent-distinct';
    const deploymentId = 'distinct';

    await store.audit.append(
      call({
        deploymentId,
        consumerId,
        toolId: 'jde.ap.voucher.create',
        bindingType: 'plsql',
        callerSubject: 'anita',
        outcome: 'policy_denied',
        errorCode: 'TOOL_NOT_IN_SCOPE',
        bytesOut: 100,
        latencyMsTotal: 100,
        correlationId: 'x1',
      }),
    );
    await store.audit.append(
      call({
        deploymentId,
        consumerId,
        toolId: 'jde.ap.voucher.create',
        bindingType: 'plsql',
        callerSubject: 'anita',
        outcome: 'policy_denied',
        errorCode: 'TOOL_NOT_IN_SCOPE',
        bytesOut: 200,
        latencyMsTotal: 200,
        correlationId: 'x2',
      }),
    );
    await store.audit.append(
      call({
        deploymentId,
        consumerId,
        toolId: 'jde.gl.journal.create',
        bindingType: 'rest',
        callerSubject: 'bikash',
        outcome: 'policy_denied',
        errorCode: 'CONSUMER_NOT_AUTHORIZED',
        bytesOut: 300,
        latencyMsTotal: 300,
        correlationId: 'x3',
      }),
    );
    await store.audit.append(
      call({
        deploymentId,
        consumerId,
        toolId: 'jde.gl.journal.create',
        bindingType: 'rest',
        callerSubject: 'bikash',
        outcome: 'ok',
        bytesOut: 400,
        latencyMsTotal: 400,
        correlationId: 'x4',
      }),
    );

    const bucket = await store.usage.getBucket(
      consumerId,
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(bucket).toBeDefined();
    expect(bucket!.calls).toBe(4);
    expect(bucket!.distinctTools).toBe(2);
    expect(bucket!.distinctBindingTypes).toBe(2);
    expect(bucket!.distinctSubjects).toBe(2);
    expect(bucket!.bytesOut).toBe(1_000);
    expect([...bucket!.refusals].sort((a, b) => a.errorCode.localeCompare(b.errorCode))).toEqual([
      { errorCode: 'CONSUMER_NOT_AUTHORIZED', count: 1 },
      { errorCode: 'TOOL_NOT_IN_SCOPE', count: 2 },
    ]);
    // Nearest-rank p95 over [100, 200, 300, 400] with n=4: ceil(4*0.95)=4th
    // smallest sample -> 400.
    expect(bucket!.p95LatencyMs).toBe(400);
  });

  it('a later call in a later hour lands in a different bucket, and the earlier bucket is untouched', async () => {
    const consumerId = 'agent-two-hours';
    const deploymentId = 'two-hours';
    await store.audit.append(
      call({ deploymentId, consumerId, ts: '2026-09-07T12:30:00.000Z', correlationId: 'h1' }),
    );
    await store.audit.append(
      call({ deploymentId, consumerId, ts: '2026-09-07T13:30:00.000Z', correlationId: 'h2' }),
    );

    const firstHour = await store.usage.getBucket(consumerId, 'hour', '2026-09-07T12:00:00.000Z');
    const secondHour = await store.usage.getBucket(consumerId, 'hour', '2026-09-07T13:00:00.000Z');
    expect(firstHour!.calls).toBe(1);
    expect(secondHour!.calls).toBe(1);

    // Both fall in the same day bucket.
    const day = await store.usage.getBucket(consumerId, 'day', '2026-09-07T00:00:00.000Z');
    expect(day!.calls).toBe(2);
  });

  it('counts identity-echo mismatches per bucket, ignoring true and null/absent (W0-N9)', async () => {
    const consumerId = 'agent-identity';
    const deploymentId = 'identity';

    await store.audit.append(
      call({ deploymentId, consumerId, identityMatch: false, correlationId: 'i1' }),
    );
    await store.audit.append(
      call({ deploymentId, consumerId, identityMatch: false, correlationId: 'i2' }),
    );
    await store.audit.append(
      call({ deploymentId, consumerId, identityMatch: true, correlationId: 'i3' }),
    );
    await store.audit.append(call({ deploymentId, consumerId, correlationId: 'i4' })); // no identityMatch at all

    const bucket = await store.usage.getBucket(
      consumerId,
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(bucket!.calls).toBe(4);
    expect(bucket!.identityMismatches).toBe(2);
  });

  it('returns undefined for a bucket no call has ever landed in', async () => {
    const bucket = await store.usage.getBucket('nobody', 'hour', '2020-01-01T00:00:00.000Z');
    expect(bucket).toBeUndefined();
  });
});
