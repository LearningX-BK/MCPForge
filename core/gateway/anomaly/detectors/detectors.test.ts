// MCPForge — W0-N9: burst-write, scope-probing and identity-echo-mismatch,
// fire and stay-silent.
//
// Every fire case is run end-to-end through `../runner.ts` (`runDetector`),
// not just `evaluate()` directly, so the assertion is on the real
// `anomaly_event.auditCallIds` the runner records — the exact audit rows
// created in the fixture, never "some calls happened".

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../../store/store.js';
import type { RuntimeStore } from '../../store/repository.js';
import type { ConsumerUsageBucket } from '../../store/usage/types.js';
import { resolveEffectiveDetectorConfig } from '../config.js';
import { runDetector } from '../runner.js';
import type { DetectorObservation } from '../types.js';
import { burstWriteDetector } from './burst-write.js';
import { scopeProbingDetector } from './scope-probing.js';
import { identityEchoMismatchDetector } from './identity-echo-mismatch.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-anomaly-detectors-'));
let counter = 0;

// The compiled default ceiling (`../../caps/consumer-limits.ts`'s
// `CONSUMER_LIMIT_CEILINGS.writesPerDay`) — used as the "no special per-
// consumer ceiling configured" value in fixtures that are only exercising
// burst-write's baseline-ratio clause, so clause 2 never fires by accident.
const DEFAULT_WRITES_PER_DAY_CEILING = 5_000;

async function openStore(): Promise<RuntimeStore> {
  counter += 1;
  return openRuntimeStore({ kind: 'sqlite', file: join(dir, `runtime-${counter}.db`) });
}

async function appendCall(
  store: RuntimeStore,
  consumerId: string,
  overrides: { identityMatch?: boolean } = {},
): Promise<string> {
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
    ...(overrides.identityMatch !== undefined ? { identityMatch: overrides.identityMatch } : {}),
  });
  return record.id;
}

function bucket(overrides: Partial<ConsumerUsageBucket>): ConsumerUsageBucket {
  return {
    consumerId: 'agent-x',
    granularity: 'hour',
    bucketStart: '2026-09-07T09:00:00.000Z',
    calls: 0,
    writes: 0,
    plansMinted: 0,
    plansConfirmed: 0,
    plansNeverConfirmed: 0,
    refusals: [],
    distinctTools: 1,
    distinctBindingTypes: 1,
    distinctSubjects: 1,
    bytesOut: 0,
    p95LatencyMs: null,
    identityMismatches: 0,
    updatedAt: '2026-09-07T09:59:00.000Z',
    ...overrides,
  };
}

type Signal = Omit<DetectorObservation, 'threshold' | 'window' | 'writesPerDayCeiling'>;

function signal(
  consumerId: string,
  usage: ConsumerUsageBucket | null,
  baseline: readonly ConsumerUsageBucket[],
  auditCallIds: readonly string[],
): Signal {
  return {
    consumerId,
    windowStart: '2026-09-07T10:00:00.000Z',
    usage,
    baseline,
    auditCallIds,
  };
}

describe('burst-write', () => {
  it('fires on a crafted fixture: writes far above N× trailing baseline, evidence is the exact calls', async () => {
    const store = await openStore();
    try {
      const config = resolveEffectiveDetectorConfig(null)['burst-write']; // threshold = 5 (N)
      const callIds = [
        await appendCall(store, 'agent-x'),
        await appendCall(store, 'agent-x'),
        await appendCall(store, 'agent-x'),
      ];
      const usage = bucket({ writes: 40 }); // baseline mean 2 -> ratio 20, threshold 5
      const baseline = [bucket({ writes: 2 }), bucket({ writes: 2 })];

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: burstWriteDetector,
          config,
          signal: signal('agent-x', usage, baseline, callIds),
          writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
          deploymentId: 'dep-1',
        },
      );

      expect(result.event).not.toBeNull();
      expect(result.event!.detectorId).toBe('burst-write');
      expect(result.event!.observed).toBe(20);
      expect([...result.event!.auditCallIds].sort()).toEqual([...callIds].sort());
      expect(result.kill).toBeNull(); // default severity is 'high', not 'critical'
    } finally {
      await store.close();
    }
  });

  it('stays silent on a legitimate near-miss: a busy but proportionate day, ratio just at threshold', async () => {
    const config = resolveEffectiveDetectorConfig(null)['burst-write']; // threshold = 5
    const usage = bucket({ writes: 50 }); // baseline mean 10 -> ratio exactly 5, not ABOVE 5
    const baseline = [bucket({ writes: 8 }), bucket({ writes: 12 })];

    const observation: DetectorObservation = {
      ...signal('agent-x', usage, baseline, ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
    };

    expect(burstWriteDetector.evaluate(observation)).toBeNull();
  });

  it('stays silent with no trailing baseline history (cold start), however high the count — PROVIDED it stays under the writesPerDay ceiling', () => {
    const config = resolveEffectiveDetectorConfig(null)['burst-write'];
    const usage = bucket({ writes: 500 });
    const observation: DetectorObservation = {
      ...signal('agent-x', usage, [], ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: 5_000, // 500 writes is well under this ceiling
    };
    expect(burstWriteDetector.evaluate(observation)).toBeNull();
  });

  it('fires on the writesPerDay clause alone: cold start, no baseline, but over the consumer\'s declared ceiling', async () => {
    const store = await openStore();
    try {
      const config = resolveEffectiveDetectorConfig(null)['burst-write'];
      const callIds = [await appendCall(store, 'agent-new'), await appendCall(store, 'agent-new')];
      const usage = bucket({ consumerId: 'agent-new', writes: 120 }); // no baseline at all

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: burstWriteDetector,
          config,
          signal: signal('agent-new', usage, [], callIds),
          writesPerDayCeiling: 100, // this consumer's declared+overlay-resolved ceiling
          deploymentId: 'dep-1',
        },
      );

      expect(result.event).not.toBeNull();
      expect(result.event!.detectorId).toBe('burst-write');
      // Reported as a ratio against the ceiling: 120 / 100.
      expect(result.event!.observed).toBe(1.2);
      expect([...result.event!.auditCallIds].sort()).toEqual([...callIds].sort());
    } finally {
      await store.close();
    }
  });

  it('stays silent on a legitimate near-miss against the writesPerDay ceiling: exactly at the ceiling, not above it', () => {
    const config = resolveEffectiveDetectorConfig(null)['burst-write'];
    const usage = bucket({ writes: 100 });
    const observation: DetectorObservation = {
      ...signal('agent-new', usage, [], ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: 100, // AT the ceiling, not over it
    };
    expect(burstWriteDetector.evaluate(observation)).toBeNull();
  });

  it('a ceiling of 0 ("not configured") never trips the writesPerDay clause', () => {
    const config = resolveEffectiveDetectorConfig(null)['burst-write'];
    const usage = bucket({ writes: 999 });
    const observation: DetectorObservation = {
      ...signal('agent-new', usage, [], ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: 0,
    };
    expect(burstWriteDetector.evaluate(observation)).toBeNull();
  });
});

describe('scope-probing', () => {
  it('fires on a crafted fixture: a rising rate of the three scope-refusal codes, evidence is the exact calls', async () => {
    const store = await openStore();
    try {
      const config = resolveEffectiveDetectorConfig(null)['scope-probing']; // threshold = 10
      const callIds = [
        await appendCall(store, 'agent-x'),
        await appendCall(store, 'agent-x'),
      ];
      const usage = bucket({
        refusals: [
          { errorCode: 'TOOL_NOT_IN_SCOPE', count: 9 },
          { errorCode: 'ELEVATED_GRANT_REQUIRED', count: 4 },
          { errorCode: 'BINDING_UNRESOLVED', count: 100 }, // irrelevant code, must not count
        ],
      }); // scope-relevant total = 13, above threshold 10
      const baseline = [
        bucket({ refusals: [{ errorCode: 'TOOL_NOT_IN_SCOPE', count: 1 }] }),
        bucket({ refusals: [{ errorCode: 'CONSUMER_NOT_AUTHORIZED', count: 0 }] }),
      ]; // baseline mean = 0.5, well below the current 13: genuinely rising

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: scopeProbingDetector,
          config,
          signal: signal('agent-x', usage, baseline, callIds),
          writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
          deploymentId: 'dep-1',
        },
      );

      expect(result.event).not.toBeNull();
      expect(result.event!.detectorId).toBe('scope-probing');
      expect(result.event!.observed).toBe(13);
      expect([...result.event!.auditCallIds].sort()).toEqual([...callIds].sort());
    } finally {
      await store.close();
    }
  });

  it('stays silent on a legitimate near-miss: steady background refusals, not rising and at/under threshold', () => {
    const config = resolveEffectiveDetectorConfig(null)['scope-probing']; // threshold = 10
    // Current window: 10 scope-relevant refusals — AT threshold, not above it.
    const usage = bucket({ refusals: [{ errorCode: 'TOOL_NOT_IN_SCOPE', count: 10 }] });
    // Baseline: this consumer always sits around this level — not an escalation.
    const baseline = [
      bucket({ refusals: [{ errorCode: 'TOOL_NOT_IN_SCOPE', count: 11 }] }),
      bucket({ refusals: [{ errorCode: 'TOOL_NOT_IN_SCOPE', count: 12 }] }),
    ];

    const observation: DetectorObservation = {
      ...signal('agent-x', usage, baseline, ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
    };

    expect(scopeProbingDetector.evaluate(observation)).toBeNull();
  });

  it('stays silent when idle (no usage bucket for the window)', () => {
    const config = resolveEffectiveDetectorConfig(null)['scope-probing'];
    const observation: DetectorObservation = {
      ...signal('agent-x', null, [], []),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
    };
    expect(scopeProbingDetector.evaluate(observation)).toBeNull();
  });
});

describe('identity-echo-mismatch', () => {
  it('fires on a crafted fixture: a rising rate of identity_match = false, evidence is the exact calls', async () => {
    const store = await openStore();
    try {
      const config = resolveEffectiveDetectorConfig(null)['identity-echo-mismatch']; // threshold = 3
      const callIds = [
        await appendCall(store, 'agent-x', { identityMatch: false }),
        await appendCall(store, 'agent-x', { identityMatch: false }),
      ];
      const usage = bucket({ identityMismatches: 8 }); // above threshold 3
      const baseline = [
        bucket({ identityMismatches: 0 }),
        bucket({ identityMismatches: 1 }),
      ]; // baseline mean 0.5, well below current 8: genuinely rising

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: identityEchoMismatchDetector,
          config,
          signal: signal('agent-x', usage, baseline, callIds),
          writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
          deploymentId: 'dep-1',
        },
      );

      expect(result.event).not.toBeNull();
      expect(result.event!.detectorId).toBe('identity-echo-mismatch');
      expect(result.event!.observed).toBe(8);
      expect([...result.event!.auditCallIds].sort()).toEqual([...callIds].sort());
    } finally {
      await store.close();
    }
  });

  it('stays silent on a legitimate near-miss: a handful of mismatches, at threshold and not rising above the baseline', () => {
    const config = resolveEffectiveDetectorConfig(null)['identity-echo-mismatch']; // threshold = 3
    // Current window: exactly 3 — AT threshold, not above it.
    const usage = bucket({ identityMismatches: 3 });
    // Baseline: this consumer has always run at roughly this level.
    const baseline = [bucket({ identityMismatches: 4 }), bucket({ identityMismatches: 3 })];

    const observation: DetectorObservation = {
      ...signal('agent-x', usage, baseline, ['call-1']),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
    };

    expect(identityEchoMismatchDetector.evaluate(observation)).toBeNull();
  });

  it('stays silent when idle (no usage bucket for the window)', () => {
    const config = resolveEffectiveDetectorConfig(null)['identity-echo-mismatch'];
    const observation: DetectorObservation = {
      ...signal('agent-x', null, [], []),
      window: config.window,
      threshold: config.threshold,
      writesPerDayCeiling: DEFAULT_WRITES_PER_DAY_CEILING,
    };
    expect(identityEchoMismatchDetector.evaluate(observation)).toBeNull();
  });
});
