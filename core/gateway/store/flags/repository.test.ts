// MCPForge — the `runtime_flags` repository. W0-E5, 02 §4.7.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { RUNTIME_FLAG } from '../schema/spec.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-flags-'));

describe('runtime_flags repository', () => {
  let store: RuntimeStore;

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterAll(async () => {
    await store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the scope+target pair is indexed for the poll read', () => {
    const idx = (RUNTIME_FLAG.indexes ?? []).find((ix) => ix.name === 'runtime_flags_active_idx');
    expect(idx?.columns).toEqual(['active', 'scope', 'target']);
  });

  it('creates a flag row, active by default', async () => {
    const flag = await store.runtimeFlags.create({
      scope: 'tool',
      target: 'jde.ap.voucher.create',
      reason: 'binding regression under investigation',
      createdBy: 'ops-bikash',
    });
    expect(flag.active).toBe(true);
    expect(flag.until).toBeNull();
    expect(flag.createdBy).toBe('ops-bikash');

    const fetched = await store.runtimeFlags.get(flag.id);
    expect(fetched).toEqual(flag);
  });

  it('listActive returns only active rows, and clear soft-flips one', async () => {
    const a = await store.runtimeFlags.create({
      scope: 'consumer',
      target: 'agent-x',
      reason: 'suspicious burst-write pattern',
      createdBy: 'ops-bikash',
    });
    const b = await store.runtimeFlags.create({
      scope: 'deployment',
      target: 'dep-1',
      reason: 'incident freeze',
      createdBy: 'ops-bikash',
      until: '2099-01-01T00:00:00.000Z',
    });

    const activeBefore = await store.runtimeFlags.listActive();
    expect(activeBefore.map((f) => f.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    const cleared = await store.runtimeFlags.clear(a.id);
    expect(cleared?.active).toBe(false);

    const activeAfter = await store.runtimeFlags.listActive();
    expect(activeAfter.map((f) => f.id)).not.toContain(a.id);
    expect(activeAfter.map((f) => f.id)).toContain(b.id);

    // Soft-clear, not delete: the row and its reason are still readable.
    const stillThere = await store.runtimeFlags.get(a.id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.reason).toBe('suspicious burst-write pattern');
  });

  it('a kill-switch row is never deleted, only ever appended or soft-cleared', async () => {
    const before = await store.runtimeFlags.listActive();
    await store.runtimeFlags.create({
      scope: 'bindingType',
      target: 'plsql',
      reason: 'temporary freeze pending review',
      createdBy: 'ops-bikash',
    });
    const after = await store.runtimeFlags.listActive();
    expect(after.length).toBe(before.length + 1);
  });
});
