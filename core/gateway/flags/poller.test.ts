// MCPForge — the kill switch's hot-reload poll. W0-E5, 02 §4.7's "takes
// effect within the 5-second poll with no redeploy" `done:` criterion.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { createPolledRuntimeFlagSource } from './poller.js';

describe('createPolledRuntimeFlagSource', () => {
  // Belt-and-braces: guarantees real timers are restored for every
  // subsequently-running test file in this worker even if a test above threw
  // before reaching its own `finally`.
  afterAll(() => {
    vi.useRealTimers();
  });

  it('activeFlags() is empty before any read, then reflects the store after refreshNow()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-poll-'));
    const store: RuntimeStore = await openRuntimeStore({
      kind: 'sqlite',
      file: join(dir, 'runtime.db'),
    });
    try {
      const source = createPolledRuntimeFlagSource(store.runtimeFlags);
      expect(source.activeFlags()).toEqual([]);

      await store.runtimeFlags.create({
        scope: 'tool',
        target: 'jde.ap.voucher.create',
        reason: 'binding regression',
        createdBy: 'ops-bikash',
      });

      // No refresh yet — a caller reading the cache right now still sees the
      // pre-write state. This is the honest "within one poll interval", not
      // "instant", half of the claim.
      expect(source.activeFlags()).toEqual([]);

      await source.refreshNow();
      const flags = source.activeFlags();
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({
        scope: 'tool',
        target: 'jde.ap.voucher.create',
        reason: 'binding regression',
      });
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('NO REDEPLOY: the same running source instance sees a flag written after it was created, with no restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-poll-noredeploy-'));
    const store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
    try {
      // The source is created FIRST, against an empty table — standing in for
      // "the gateway process already started" — and `forge kill`'s effect
      // (a fresh process writing the same store) is proved visible to it
      // without constructing a new source or touching the process at all.
      const source = createPolledRuntimeFlagSource(store.runtimeFlags, { intervalMs: 5000 });
      await source.refreshNow();
      expect(source.activeFlags()).toEqual([]);

      await store.runtimeFlags.create({
        scope: 'consumer',
        target: 'agent-x',
        reason: 'burst-write anomaly',
        createdBy: 'ops-bikash',
      });

      await source.refreshNow();
      expect(source.activeFlags().map((f) => f.target)).toEqual(['agent-x']);
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('actually polls on a real interval (fake timers), within the 5-second default', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-poll-timer-'));
    try {
      const store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
      const source = createPolledRuntimeFlagSource(store.runtimeFlags);
      source.start();
      expect(source.polling).toBe(true);

      await store.runtimeFlags.create({
        scope: 'tool',
        target: 'jde.ap.voucher.create',
        reason: 'kill-switched',
        createdBy: 'ops-bikash',
      });
      expect(source.activeFlags()).toEqual([]);

      await vi.advanceTimersByTimeAsync(5000);
      expect(source.activeFlags()).toHaveLength(1);

      source.stop();
      expect(source.polling).toBe(false);
      await store.close();
    } finally {
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails CLOSED on a store error: the last-known-good flags are kept, never silently cleared', async () => {
    const errors: unknown[] = [];
    const failing = {
      listActive: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      clear: vi.fn(),
    };
    // First call succeeds and seeds the cache; the second call fails.
    failing.listActive.mockResolvedValueOnce([
      {
        id: '1',
        scope: 'tool',
        target: 't',
        reason: 'r',
        until: null,
        createdBy: 'x',
        createdAt: '2020-01-01T00:00:00.000Z',
        auditCallId: null,
        active: true,
      },
    ]);
    failing.listActive.mockRejectedValueOnce(new Error('boom'));
    const source = createPolledRuntimeFlagSource(failing as never, {
      onError: (e) => errors.push(e),
    });
    await source.refreshNow();
    expect(source.activeFlags()).toHaveLength(1);

    await source.refreshNow(); // this one throws
    expect(errors).toHaveLength(1);
    expect(source.activeFlags()).toHaveLength(1); // unchanged, not cleared
  });
});
