// MCPForge — W0-N7's done criterion, the "same outbox transaction" clause.
// Mirrors `../audit/audit.test.ts`'s own atomicity proof ("is atomic: a
// failing satellite insert takes the audit_call row with it") exactly, but
// the other direction: this proves that when the AUDIT satellite fails, the
// usage rollup this same transaction would otherwise have written is rolled
// back too — and, separately, that a successful append's usage row commits
// together with its audit row, never as a second write a reader could observe
// having happened alone.

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { bucketStartFor } from './repository.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from '../audit/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-usage-atomicity-'));
const dbFile = join(tempDir, 'runtime.db');
let store: RuntimeStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function raw(): Database.Database {
  return new Database(dbFile);
}

function call(overrides: Partial<AppendAuditCallInput> = {}): AppendAuditCallInput {
  return {
    callerSubject: 'bikash',
    consumerId: 'agent-atomic',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.create',
    bindingType: 'plsql',
    isWrite: true,
    deploymentId: 'usage-atomic',
    phase: 'execute',
    outcome: 'ok',
    ts: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('usage rollup atomicity — same outbox transaction as the audit row', () => {
  it('commits the usage bucket increment TOGETHER with the audit row on a normal append', async () => {
    const before = await store.usage.getBucket(
      'agent-atomic',
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(before).toBeUndefined();

    await store.audit.append(call({ correlationId: 'commit-1' }));

    const after = await store.usage.getBucket(
      'agent-atomic',
      'hour',
      bucketStartFor('hour', '2026-09-07T12:00:00.000Z'),
    );
    expect(after?.calls).toBe(1);
  });

  it('rolls the usage bucket increment back TOGETHER with a failing audit satellite insert — neither survives alone', async () => {
    const consumerId = 'agent-rollback';
    const deploymentId = 'usage-rollback';
    const hourStart = bucketStartFor('hour', '2026-09-07T12:00:00.000Z');

    const beforeHead = await store.audit.chainHead(deploymentId);
    const beforeBucket = await store.usage.getBucket(consumerId, 'hour', hourStart);
    expect(beforeBucket).toBeUndefined();

    // The same fault `audit.test.ts` uses to prove ITS OWN atomicity: a
    // NOT NULL violation on a satellite (`audit_result_key.key_value`),
    // which fails only after `buildRow`/the parent INSERT have already run —
    // exactly the point in `append()`'s transaction where the usage write is
    // also queued.
    await expect(
      store.audit.append(
        call({
          consumerId,
          deploymentId,
          correlationId: 'rollback-1',
          resultKeys: [{ keyName: 'voucher_no', keyValue: null as unknown as string }],
        }),
      ),
    ).rejects.toThrow();

    // The audit row did not survive...
    expect(await store.audit.chainHead(deploymentId)).toEqual(beforeHead);
    const db = raw();
    try {
      const orphans = db
        .prepare('SELECT COUNT(*) AS n FROM audit_call WHERE correlation_id = ?')
        .get('rollback-1') as { n: number };
      expect(orphans.n).toBe(0);
    } finally {
      db.close();
    }

    // ...and NEITHER did the usage bucket it would have incremented. If usage
    // were a second, separately-committed write, this bucket would exist with
    // `calls: 1` even though the audit row it summarises does not.
    const afterBucket = await store.usage.getBucket(consumerId, 'hour', hourStart);
    expect(afterBucket).toBeUndefined();

    // And a subsequent, successful call starts the bucket cleanly at 1 — the
    // failed attempt left no partial increment behind.
    await store.audit.append(call({ consumerId, deploymentId, correlationId: 'rollback-2' }));
    const recovered = await store.usage.getBucket(consumerId, 'hour', hourStart);
    expect(recovered?.calls).toBe(1);
  });
});
