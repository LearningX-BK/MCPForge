// MCPForge — proof that `RuntimeStore.transaction` is reentrant. W0-C3.
//
// This is the fix that makes W0-C3's done criterion reachable at all: 02 §3.1.1
// requires the nonce-consuming `INSERT` to be *inside the same transaction as
// the execute*, and the execute path is built out of repository methods that
// each transact. Before this, an inner `transaction()` raised "cannot start a
// transaction within a transaction" on SQLite.
//
// What is asserted here is not that nesting "works" but that it is ONE unit: an
// outer rollback discards inner work, an inner rollback the caller handles
// discards only the inner work, and nothing an inner scope did becomes durable
// before the outermost commit.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openConnection } from './dialect.js';
import { openRuntimeStore } from './store.js';
import type { DialectConnection } from './dialect.js';
import type { RuntimeStore } from './repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-tx-'));

describe('DialectConnection.transaction is reentrant (savepoints)', () => {
  let connection: DialectConnection;

  beforeAll(async () => {
    connection = await openConnection({ kind: 'sqlite', file: join(dir, 'nesting.db') });
    await connection.migrate();
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('tracks depth: 0 outside, 1 in the outer scope, 2 in a nested one', async () => {
    expect(connection.transactionDepth()).toBe(0);
    await connection.transaction(async () => {
      expect(connection.transactionDepth()).toBe(1);
      await connection.transaction(() => {
        expect(connection.transactionDepth()).toBe(2);
        return Promise.resolve();
      });
      expect(connection.transactionDepth()).toBe(1);
    });
    expect(connection.transactionDepth()).toBe(0);
  });

  it('reports depth per async chain, not per connection', async () => {
    // A chain that merely runs at the same time as a transaction is OUTSIDE it
    // and must see 0 — otherwise its next `transaction()` call would silently
    // join a unit it has nothing to do with.
    const held = connection.transaction(async () => {
      await Promise.resolve();
      expect(connection.transactionDepth()).toBe(1);
    });
    const depthSeenByBystander = connection.transactionDepth();
    await held;
    expect(depthSeenByBystander).toBe(0);
  });

  it('unwinds depth when the work throws, at every level', async () => {
    await expect(
      connection.transaction(() => connection.transaction(() => Promise.reject(new Error('boom')))),
    ).rejects.toThrow('boom');
    expect(connection.transactionDepth()).toBe(0);
  });
});

describe('RuntimeStore.transaction composes into ONE atomic unit', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'unit.db') });
  });

  afterAll(async () => {
    await store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets a repository that transacts internally be called inside store.transaction', async () => {
    // The regression this file exists for: `heartbeats.deleteOlderThan` opens a
    // transaction of its own, and before the savepoint fix calling it inside an
    // outer transaction threw rather than joining.
    const removed = await store.transaction(async () => {
      await store.heartbeats.record({ instanceId: 'nested-writer' });
      return store.heartbeats.deleteOlderThan('1970-01-01T00:00:00.000Z');
    });
    expect(removed).toBe(0);
    expect((await store.heartbeats.listRecent(10)).map((h) => h.instanceId)).toContain(
      'nested-writer',
    );
  });

  it('discards inner work when the OUTER scope rolls back — one unit, not two', async () => {
    await expect(
      store.transaction(async () => {
        await store.transaction(async () => {
          await store.heartbeats.record({ instanceId: 'doomed-inner' });
        });
        // The inner scope released its savepoint and returned normally. If that
        // release had committed, the row would survive this throw — which is
        // precisely the failure mode "joins the outer transaction" rules out.
        throw new Error('outer fails after the inner scope succeeded');
      }),
    ).rejects.toThrow('outer fails');

    const instanceIds = (await store.heartbeats.listRecent(50)).map((h) => h.instanceId);
    expect(instanceIds).not.toContain('doomed-inner');
  });

  it('rolls back only the inner scope when the outer scope handles the failure', async () => {
    await store.transaction(async () => {
      await store.heartbeats.record({ instanceId: 'outer-survivor' });
      await store
        .transaction(async () => {
          await store.heartbeats.record({ instanceId: 'inner-casualty' });
          throw new Error('inner fails');
        })
        .catch(() => undefined);
    });

    const instanceIds = (await store.heartbeats.listRecent(50)).map((h) => h.instanceId);
    expect(instanceIds).toContain('outer-survivor');
    expect(instanceIds).not.toContain('inner-casualty');
  });

  it('does NOT fold two unrelated concurrent transactions into one unit', async () => {
    // The distinction a depth counter cannot make and `AsyncLocalStorage` can:
    // this second transaction runs *concurrently with* the first, not *inside*
    // it, so it must be its own unit. If it joined, the first's rollback would
    // discard the second's committed work — a caller silently losing a write it
    // was told had succeeded, which on this product's write path is a lost
    // audit row or an unspent nonce on a call that really happened.
    const doomed = store
      .transaction(async () => {
        await store.heartbeats.record({ instanceId: 'concurrent-doomed' });
        throw new Error('this unit fails');
      })
      .catch(() => 'rolled back');
    const survivor = store.transaction(async () => {
      await store.heartbeats.record({ instanceId: 'concurrent-survivor' });
      return 'committed';
    });

    expect(await doomed).toBe('rolled back');
    expect(await survivor).toBe('committed');

    const instanceIds = (await store.heartbeats.listRecent(50)).map((h) => h.instanceId);
    expect(instanceIds).toContain('concurrent-survivor');
    expect(instanceIds).not.toContain('concurrent-doomed');
  });

  it('nests three deep and still commits as one unit', async () => {
    await store.transaction(() =>
      store.transaction(() =>
        store.transaction(async () => {
          await store.heartbeats.record({ instanceId: 'three-deep' });
        }),
      ),
    );
    expect((await store.heartbeats.listRecent(50)).map((h) => h.instanceId)).toContain(
      'three-deep',
    );
  });
});
