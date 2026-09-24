// MCPForge — the store contract suite. 02 §10.4 item 8: CI runs this suite
// "against a **temp-file SQLite by default** — fast, and with no Docker
// requirement ... **and additionally runs the identical suite against Postgres
// in a second CI matrix entry**." One suite, two dialects, exactly as 02 §4.4
// does for the two identity providers: both implementations are contract-
// tested so the swap is proven, not hoped.
//
// The SQLite leg always runs, with no Docker requirement, as part of the
// default `pnpm test`. The Postgres leg runs when MCPFORGE_TEST_POSTGRES_URL
// is set, and is skipped — never silently passed — when it is not.
//
// W0-C5 wired that URL: `pnpm test:postgres` (core/gateway/package.json) runs
// this SAME file under `vitest.postgres.config.ts`, whose `globalSetup`
// (`./test-postgres-global-setup.ts`) provisions a disposable Postgres via
// Testcontainers and sets MCPFORGE_TEST_POSTGRES_URL before this file loads —
// no human ever has to start a Postgres or export the URL by hand. That
// opt-in script is "the second CI matrix entry" 02 §10.4 item 8 requires; see
// `vitest.postgres.config.ts` for exactly how a real CI provider would call
// it as the second leg of a two-leg job matrix.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from './store.js';
import { isUuidv7, uuidv7Millis } from './id.js';
import type { StoreConfig } from './config.js';
import type { RuntimeStore } from './repository.js';

const POSTGRES_URL = process.env['MCPFORGE_TEST_POSTGRES_URL'];

function contractSuite(label: string, makeConfig: () => StoreConfig, cleanup?: () => void): void {
  describe(`RuntimeStore contract — ${label}`, () => {
    let store: RuntimeStore;

    beforeAll(async () => {
      store = await openRuntimeStore(makeConfig());
      // A second migrate() must be a no-op — the store is opened on every
      // gateway start and W0-C6 deletes the file between runs.
      await store.migrate();
      await store.heartbeats.deleteOlderThan('9999-12-31T23:59:59.999Z');
    });

    afterAll(async () => {
      await store?.close();
      cleanup?.();
    });

    it('reports the dialect it is actually talking to', () => {
      expect(store.kind).toBe(makeConfig().kind);
      expect(store.descriptor.kind).toBe(store.kind);
    });

    it('writes and reads a row back unchanged', async () => {
      const written = await store.heartbeats.record({
        instanceId: 'gateway-0',
        note: 'contract',
        observedAt: '2026-08-30T10:00:00.000Z',
      });
      expect(isUuidv7(written.id)).toBe(true);
      expect(written.storeKind).toBe(store.kind);

      const read = await store.heartbeats.get(written.id);
      expect(read).toEqual(written);
    });

    it('returns undefined rather than throwing for an unknown id', async () => {
      expect(await store.heartbeats.get('00000000-0000-7000-8000-000000000000')).toBeUndefined();
    });

    it('keeps a null note null on both dialects', async () => {
      const written = await store.heartbeats.record({ instanceId: 'gateway-0' });
      const read = await store.heartbeats.get(written.id);
      expect(read?.note).toBeNull();
    });

    it('orders listRecent newest first', async () => {
      const older = await store.heartbeats.record({
        instanceId: 'gateway-0',
        observedAt: '2026-01-01T00:00:00.000Z',
      });
      const newer = await store.heartbeats.record({
        instanceId: 'gateway-0',
        observedAt: '2026-12-01T00:00:00.000Z',
      });
      const recent = await store.heartbeats.listRecent(2);
      expect(recent[0]?.id).toBe(newer.id);
      expect(recent.map((h) => h.id)).not.toContain(older.id);
    });

    it('ids are time-ordered, which is why they are UUIDv7 and not UUIDv4', async () => {
      const first = await store.heartbeats.record({ instanceId: 'gateway-0' });
      const second = await store.heartbeats.record({ instanceId: 'gateway-0' });
      expect(second.id > first.id).toBe(true);
      expect(uuidv7Millis(second.id)).toBeGreaterThanOrEqual(uuidv7Millis(first.id));
    });

    it('deleteOlderThan removes only the rows before the cut and reports the count', async () => {
      await store.heartbeats.deleteOlderThan('9999-12-31T23:59:59.999Z');
      await store.heartbeats.record({
        instanceId: 'gateway-0',
        observedAt: '2020-01-01T00:00:00.000Z',
      });
      await store.heartbeats.record({
        instanceId: 'gateway-0',
        observedAt: '2020-01-02T00:00:00.000Z',
      });
      const kept = await store.heartbeats.record({
        instanceId: 'gateway-0',
        observedAt: '2030-01-01T00:00:00.000Z',
      });

      const removed = await store.heartbeats.deleteOlderThan('2025-01-01T00:00:00.000Z');
      expect(removed).toBe(2);
      expect(await store.heartbeats.get(kept.id)).toBeDefined();
    });

    // The dialect-difference case W0-C5 requires: a real assertion that would
    // FAIL on Postgres (or SQLite) if `schema/sqlite.ts` and `schema/pg.ts`
    // ever drifted on boolean projection. SQLite has no native boolean type —
    // drizzle's sqlite projection stores 0/1 integers and coerces on read;
    // Postgres has a native `boolean` column. A `true`/`false`/`null` round
    // trip through `audit_call.is_write` / `identity_match` exercises exactly
    // that seam on both dialects with the one shared assertion below — this
    // is "the same discipline the dual identity providers get" (02 §4.4):
    // one suite, not a per-dialect special case.
    it('round-trips booleans, including a null boolean, identically on both dialects', async () => {
      const deploymentId = `contract-bool-${label}`;
      const writeTrue = await store.audit.append({
        callerSubject: 'contract-test-subject',
        consumerId: 'contract-test-consumer',
        humanInTheLoop: true,
        toolId: 'contract.bool.get',
        isWrite: true,
        deploymentId,
        phase: 'execute',
        outcome: 'ok',
        identityMatch: true,
      });
      const writeFalse = await store.audit.append({
        callerSubject: 'contract-test-subject',
        consumerId: 'contract-test-consumer',
        humanInTheLoop: false,
        toolId: 'contract.bool.get',
        isWrite: false,
        deploymentId,
        phase: 'execute',
        outcome: 'ok',
        identityMatch: false,
      });
      const writeNull = await store.audit.append({
        callerSubject: 'contract-test-subject',
        consumerId: 'contract-test-consumer',
        humanInTheLoop: true,
        toolId: 'contract.bool.get',
        isWrite: true,
        deploymentId,
        phase: 'execute',
        outcome: 'ok',
        // identityMatch omitted -> must round-trip as null, not 0/false.
      });

      const readTrue = await store.audit.get(writeTrue.id);
      const readFalse = await store.audit.get(writeFalse.id);
      const readNull = await store.audit.get(writeNull.id);

      expect(readTrue?.humanInTheLoop).toBe(true);
      expect(readTrue?.isWrite).toBe(true);
      expect(readTrue?.identityMatch).toBe(true);

      expect(readFalse?.humanInTheLoop).toBe(false);
      expect(readFalse?.isWrite).toBe(false);
      expect(readFalse?.identityMatch).toBe(false);

      expect(readNull?.identityMatch).toBeNull();
    });

    it('rolls a failed transaction back', async () => {
      const before = (await store.heartbeats.listRecent(100)).length;
      await expect(
        store.transaction(async () => {
          await store.heartbeats.record({ instanceId: 'doomed' });
          throw new Error('deliberate');
        }),
      ).rejects.toThrow('deliberate');
      expect((await store.heartbeats.listRecent(100)).length).toBe(before);
    });
  });
}

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-store-'));
contractSuite(
  'sqlite (temp file)',
  () => ({ kind: 'sqlite', file: join(tempDir, 'runtime.db') }),
  () => rmSync(tempDir, { recursive: true, force: true }),
);

if (POSTGRES_URL !== undefined && POSTGRES_URL.trim().length > 0) {
  contractSuite('postgres', () => ({ kind: 'postgres', connectionString: POSTGRES_URL }));
} else {
  describe.skip('RuntimeStore contract — postgres', () => {
    it('runs when MCPFORGE_TEST_POSTGRES_URL is set (02 §10.4 item 8)', () => {
      expect(true).toBe(true);
    });
  });
}
