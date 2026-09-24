// MCPForge — the `anomaly_event` repository. W0-N8, 02 §11.6.

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-anomaly-store-'));
let counter = 0;

async function openStore(): Promise<RuntimeStore> {
  counter += 1;
  return openRuntimeStore({ kind: 'sqlite', file: join(dir, `runtime-${counter}.db`) });
}

async function appendCall(store: RuntimeStore, consumerId: string): Promise<string> {
  const record = await store.audit.append({
    ts: new Date().toISOString(),
    callerSubject: 'alice',
    humanInTheLoop: true,
    consumerId,
    toolId: 'jde.ap.voucher.create',
    isWrite: true,
    deploymentId: 'dep-1',
    phase: 'execute',
    outcome: 'ok',
  });
  return record.id;
}

describe('anomalyEventRepository', () => {
  it("records 02 §11.6's full column list and joins its evidence back", async () => {
    const store = await openStore();
    try {
      const a = await appendCall(store, 'agent-x');
      const b = await appendCall(store, 'agent-x');

      const event = await store.anomalies.record({
        consumerId: 'agent-x',
        detectorId: 'burst-write',
        severity: 'high',
        window: '1h',
        observed: 41,
        threshold: 5,
        auditCallIds: [a, b],
        ts: '2026-09-07T10:00:00.000Z',
      });

      expect(event).toMatchObject({
        consumerId: 'agent-x',
        detectorId: 'burst-write',
        severity: 'high',
        window: '1h',
        observed: 41,
        threshold: 5,
        state: 'open',
        ts: '2026-09-07T10:00:00.000Z',
      });

      const read = await store.anomalies.get(event.id);
      expect(read?.auditCallIds).toEqual([a, b].sort());
      // Numbers survive the canonical-decimal-text column round trip.
      expect(read?.observed).toBe(41);
      expect(read?.threshold).toBe(5);
    } finally {
      await store.close();
    }
  });

  it('stores a ratio threshold losslessly — several patterns are not integers', async () => {
    const store = await openStore();
    try {
      const event = await store.anomalies.record({
        consumerId: 'agent-x',
        detectorId: 'plan-abandonment',
        severity: 'medium',
        window: '24h',
        observed: 12.5,
        threshold: 4.75,
        auditCallIds: [],
      });
      const read = await store.anomalies.get(event.id);
      expect(read?.observed).toBe(12.5);
      expect(read?.threshold).toBe(4.75);
    } finally {
      await store.close();
    }
  });

  it('is one hop from its evidence in BOTH directions', async () => {
    const store = await openStore();
    try {
      const a = await appendCall(store, 'agent-x');
      const event = await store.anomalies.record({
        consumerId: 'agent-x',
        detectorId: 'scope-probing',
        severity: 'high',
        window: '1h',
        observed: 12,
        threshold: 10,
        auditCallIds: [a, a], // duplicate collapses rather than violating the UNIQUE index
      });
      expect(event.auditCallIds).toEqual([a]);

      const byCall = await store.anomalies.listByAuditCall(a);
      expect(byCall.map((e) => e.id)).toEqual([event.id]);
    } finally {
      await store.close();
    }
  });

  it('refuses a severity or state outside the closed sets', async () => {
    const store = await openStore();
    try {
      await expect(
        store.anomalies.record({
          consumerId: 'agent-x',
          detectorId: 'burst-write',
          severity: 'catastrophic' as never,
          window: '1h',
          observed: 1,
          threshold: 1,
          auditCallIds: [],
        }),
      ).rejects.toThrow(/not an anomaly severity/);
      await expect(
        store.anomalies.record({
          consumerId: 'agent-x',
          detectorId: 'burst-write',
          severity: 'high',
          window: '1h',
          observed: Number.NaN,
          threshold: 1,
          auditCallIds: [],
        }),
      ).rejects.toThrow(/finite number/);
    } finally {
      await store.close();
    }
  });

  it('exposes exactly one mutation — the triage transition — and no way to rewrite what was observed', async () => {
    const store = await openStore();
    try {
      const event = await store.anomalies.record({
        consumerId: 'agent-x',
        detectorId: 'subject-fan-out',
        severity: 'medium',
        window: '24h',
        observed: 40,
        threshold: 25,
        auditCallIds: [],
      });
      const acked = await store.anomalies.setState(event.id, 'acknowledged');
      expect(acked?.state).toBe('acknowledged');
      expect(acked?.observed).toBe(40);

      // The interface itself carries no update/delete for the measured facts.
      const repo = store.anomalies as unknown as Record<string, unknown>;
      expect(Object.keys(repo).sort()).toEqual(
        ['get', 'list', 'listByAuditCall', 'record', 'setState'].sort(),
      );
    } finally {
      await store.close();
    }
  });

  it('filters and orders the triage queue most-recent-first', async () => {
    const store = await openStore();
    try {
      await store.anomalies.record({
        consumerId: 'agent-x',
        detectorId: 'burst-write',
        severity: 'high',
        window: '1h',
        observed: 9,
        threshold: 5,
        auditCallIds: [],
        ts: '2026-09-07T09:00:00.000Z',
      });
      const newer = await store.anomalies.record({
        consumerId: 'agent-y',
        detectorId: 'burst-write',
        severity: 'high',
        window: '1h',
        observed: 11,
        threshold: 5,
        auditCallIds: [],
        ts: '2026-09-07T11:00:00.000Z',
      });

      const all = await store.anomalies.list();
      expect(all[0]?.id).toBe(newer.id);
      const mine = await store.anomalies.list({ consumerId: 'agent-x' });
      expect(mine).toHaveLength(1);
      expect(await store.anomalies.list({ state: 'resolved' })).toHaveLength(0);
    } finally {
      await store.close();
    }
  });
});
