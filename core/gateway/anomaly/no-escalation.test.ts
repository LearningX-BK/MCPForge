// MCPForge — a detector CANNOT mutate any authorization, scope or threshold,
// and the single permitted action is loud, audited and human-reversible.
// W0-N8, 02 §11.6.
//
// Every test below is written from the attacker's chair: a hostile detector
// implementation that plugs into the sanctioned interface and then tries to do
// exactly what 02 §11.6 forbids. The point is not that nothing currently does
// these things — it is that a Wave 1/2/3 detector plugging into this same
// interface still CANNOT.

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { DETECTOR_DEFAULTS, resolveEffectiveDetectorConfig } from './config.js';
import { runDetector, DETECTOR_ACTOR_PREFIX, DETECTOR_ACTOR_CONSUMER_ID } from './runner.js';
import type { AnomalyDetector, DetectorObservation } from './types.js';
import { KILL_TOOL_ID } from '../flags/kill.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-anomaly-run-'));
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

function signal(consumerId: string, auditCallIds: readonly string[]) {
  return {
    consumerId,
    windowStart: '2026-09-07T10:00:00.000Z',
    usage: null,
    baseline: [],
    auditCallIds,
  } satisfies Omit<DetectorObservation, 'threshold' | 'window'>;
}

/** A well-behaved detector: fires, names its evidence, says nothing else. */
function firingDetector(): AnomalyDetector {
  return {
    id: 'burst-write',
    window: DETECTOR_DEFAULTS['burst-write'].window,
    describes: 'test',
    evaluate: (o) => ({ observed: o.threshold + 36, auditCallIds: o.auditCallIds }),
  };
}

describe('a detector is handed data, not capability', () => {
  it('sees no store, no repository, no consumer record, no scope set and no function', async () => {
    const store = await openStore();
    try {
      let captured: DetectorObservation | null = null;
      const spy: AnomalyDetector = {
        ...firingDetector(),
        evaluate: (o) => {
          captured = o;
          return null;
        },
      };
      await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: spy,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );

      const observation = captured as unknown as Record<string, unknown>;
      expect(observation).not.toBeNull();
      // Nothing callable reaches a detector: no repository method, no
      // `applyKill`, no store handle — there is nothing in its hand to
      // escalate WITH.
      for (const [key, value] of Object.entries(observation)) {
        expect(typeof value, `observation.${key} must not be callable`).not.toBe('function');
      }
      // W0-N9: `writesPerDayCeiling` widens the observation the same way
      // `threshold` already does — a resolved, read-only number, never a
      // capability. Updated deliberately here (CLAUDE.md §8 / task note) the
      // same way W0-N7 updated `driver-isolation.test.ts` for its own
      // schema-shape change; every other assertion in this file — freeze,
      // throw-on-mutate, ignore-what-a-detector-returns, single-sanctioned-
      // action — is unchanged.
      expect(Object.keys(observation).sort()).toEqual(
        [
          'auditCallIds',
          'baseline',
          'consumerId',
          'threshold',
          'usage',
          'window',
          'windowStart',
          'writesPerDayCeiling',
        ].sort(),
      );
    } finally {
      await store.close();
    }
  });

  it('cannot mutate its own threshold, scope or evidence — the observation is deep-frozen and THROWS', async () => {
    const store = await openStore();
    try {
      const attempts: string[] = [];
      const hostile: AnomalyDetector = {
        ...firingDetector(),
        evaluate: (o) => {
          const mutable = o as unknown as Record<string, unknown>;
          for (const [label, act] of [
            ['threshold', () => (mutable['threshold'] = 0)],
            ['consumerId', () => (mutable['consumerId'] = 'some-other-consumer')],
            ['auditCallIds', () => (mutable['auditCallIds'] as string[]).push('fabricated')],
            ['window', () => (mutable['window'] = '24h')],
            ['newField', () => (mutable['grantedScopes'] = ['*'])],
          ] as const) {
            try {
              act();
              attempts.push(`${label}: SUCCEEDED`);
            } catch {
              attempts.push(`${label}: threw`);
            }
          }
          return { observed: o.threshold + 1, auditCallIds: [] };
        },
      };

      await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: hostile,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );

      expect(attempts).toEqual([
        'threshold: threw',
        'consumerId: threw',
        'auditCallIds: threw',
        'window: threw',
        'newField: threw',
      ]);
    } finally {
      await store.close();
    }
  });

  it('cannot promote itself to critical: severity and threshold on the EVENT come from config, never from the finding', async () => {
    const store = await openStore();
    try {
      const selfPromoting: AnomalyDetector = {
        ...firingDetector(),
        evaluate: (o) =>
          ({
            observed: o.threshold + 1,
            auditCallIds: [],
            // Everything below is ignored by construction — the finding type
            // has no such fields and the runner reads only the two it names.
            severity: 'critical',
            threshold: 0,
            consumerId: 'victim-consumer',
            state: 'resolved',
            action: 'kill',
          }) as never,
      };

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: selfPromoting,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );

      expect(result.event?.severity).toBe(DETECTOR_DEFAULTS['burst-write'].severity);
      expect(result.event?.severity).not.toBe('critical');
      expect(result.event?.threshold).toBe(DETECTOR_DEFAULTS['burst-write'].threshold);
      expect(result.event?.consumerId).toBe('agent-x');
      expect(result.event?.state).toBe('open');
      // The only sanctioned action was NOT taken, because the CONFIGURED
      // severity is not critical.
      expect(result.kill).toBeNull();
      expect(await store.runtimeFlags.listActive()).toHaveLength(0);
    } finally {
      await store.close();
    }
  });

  it('cannot attach an alert to evidence it was never shown', async () => {
    const store = await openStore();
    try {
      const real = await appendCall(store, 'agent-x');
      const fabricating: AnomalyDetector = {
        ...firingDetector(),
        evaluate: (o) => ({
          observed: o.threshold + 1,
          auditCallIds: [...o.auditCallIds, 'not-a-real-audit-row', 'another-invention'],
        }),
      };

      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: fabricating,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: signal('agent-x', [real]),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );

      expect(result.event?.auditCallIds).toEqual([real]);
    } finally {
      await store.close();
    }
  });

  it('a silent detector writes nothing at all', async () => {
    const store = await openStore();
    try {
      const quiet: AnomalyDetector = { ...firingDetector(), evaluate: () => null };
      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: quiet,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );
      expect(result).toEqual({ event: null, kill: null });
      expect(await store.anomalies.list()).toHaveLength(0);
      expect(await store.runtimeFlags.listActive()).toHaveLength(0);
    } finally {
      await store.close();
    }
  });

  it('cannot be handed a threshold that bypassed the tighten-only merge — the runner supplies it', async () => {
    const store = await openStore();
    try {
      let seen = -1;
      const detector: AnomalyDetector = {
        ...firingDetector(),
        evaluate: (o) => {
          seen = o.threshold;
          return null;
        },
      };
      // A caller trying to smuggle a loosened threshold in through `signal`
      // does not typecheck (`Omit<…, 'threshold' | 'window'>`), and at runtime
      // the runner's own spread wins.
      await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector,
          config: resolveEffectiveDetectorConfig(null)['burst-write'],
          signal: { ...signal('agent-x', []), threshold: 999_999 } as never,
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );
      expect(seen).toBe(DETECTOR_DEFAULTS['burst-write'].threshold);
    } finally {
      await store.close();
    }
  });

  it('a detector/config mismatch is refused rather than silently run under the wrong severity', async () => {
    const store = await openStore();
    try {
      await expect(
        runDetector(
          { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
          {
            detector: firingDetector(),
            config: resolveEffectiveDetectorConfig(null)['scope-probing'],
            signal: signal('agent-x', []),
            writesPerDayCeiling: 5_000,
            deploymentId: 'dep-1',
          },
        ),
      ).rejects.toThrow(/was handed the configuration for/);
    } finally {
      await store.close();
    }
  });
});

describe('the single permitted action — a critical detector trips the CONSUMER kill switch', () => {
  const criticalConfig = () =>
    resolveEffectiveDetectorConfig({ 'burst-write': { severity: 'critical' } })['burst-write'];

  it("kills the consumer through §4.7's existing mechanism, with a visible audited reason", async () => {
    const store = await openStore();
    try {
      const evidence = await appendCall(store, 'agent-x');
      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: firingDetector(),
          config: criticalConfig(),
          signal: signal('agent-x', [evidence]),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
          now: new Date('2026-09-07T11:00:00.000Z'),
        },
      );

      expect(result.event?.severity).toBe('critical');
      expect(result.kill).not.toBeNull();

      // The flag is an ordinary runtime_flags row at `consumer` granularity,
      // against the observed consumer and no one else.
      const flag = await store.runtimeFlags.get(result.kill!.flagId);
      expect(flag).toMatchObject({ scope: 'consumer', target: 'agent-x', active: true });
      expect(flag?.reason).toContain('burst-write');
      expect(flag?.reason).toContain('severity critical');
      expect(flag?.createdBy).toBe(`${DETECTOR_ACTOR_PREFIX}burst-write`);

      // The audit record: SAME path, SAME tool id, SAME chain as `forge kill`.
      const record = await store.audit.get(result.kill!.auditCallId);
      expect(record?.toolId).toBe(KILL_TOOL_ID);
      expect(record?.outcome).toBe('ok');
      const keys = Object.fromEntries(
        (record?.resultKeys ?? []).map((k) => [k.keyName, k.keyValue]),
      );
      expect(keys['kill_scope']).toBe('consumer');
      expect(keys['kill_target']).toBe('agent-x');
      // One hop from the kill to the event, and from the event to its evidence.
      expect(keys['anomaly_event_id']).toBe(result.event?.id);
      expect(keys['anomaly_detector_id']).toBe('burst-write');
      const event = await store.anomalies.get(keys['anomaly_event_id']!);
      expect(event?.auditCallIds).toEqual([evidence]);

      // The chain still verifies with an automated row in it.
      const verified = await store.audit.verifyChain('dep-1');
      expect(verified.status).toBe('intact');
      expect(verified.firstBreak).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('is traceable exactly like a human kill, differing ONLY in actor identity and human-in-the-loop', async () => {
    const store = await openStore();
    try {
      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: firingDetector(),
          config: criticalConfig(),
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );
      const record = await store.audit.get(result.kill!.auditCallId);
      expect(record?.callerSubject).toBe(`${DETECTOR_ACTOR_PREFIX}burst-write`);
      expect(record?.consumerId).toBe(DETECTOR_ACTOR_CONSUMER_ID);
      // The one fact an automated kill must NOT claim.
      expect(record?.humanInTheLoop).toBe(false);
    } finally {
      await store.close();
    }
  });

  it('is human-reversible: an operator lifts it with the ordinary soft-clear, and the history survives', async () => {
    const store = await openStore();
    try {
      const result = await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: firingDetector(),
          config: criticalConfig(),
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );
      expect((await store.runtimeFlags.listActive()).map((f) => f.target)).toContain('agent-x');

      const cleared = await store.runtimeFlags.clear(result.kill!.flagId);
      expect(cleared?.active).toBe(false);
      expect(await store.runtimeFlags.listActive()).toHaveLength(0);

      // Soft-clear, never delete: who killed it, when and why is still readable
      // after the lift — the same property a human kill has.
      const after = await store.runtimeFlags.get(result.kill!.flagId);
      expect(after?.reason).toContain('burst-write');
      expect(after?.createdBy).toBe(`${DETECTOR_ACTOR_PREFIX}burst-write`);
      // And the event itself is untouched by the lift — it is evidence, not state.
      const event = await store.anomalies.get(result.event!.id);
      expect(event?.severity).toBe('critical');
    } finally {
      await store.close();
    }
  });

  it('kills the observed consumer and NOTHING else — not a tool, not a binding type, not a deployment', async () => {
    const store = await openStore();
    try {
      await runDetector(
        { anomalies: store.anomalies, flags: store.runtimeFlags, audit: store.audit },
        {
          detector: firingDetector(),
          config: criticalConfig(),
          signal: signal('agent-x', []),
          writesPerDayCeiling: 5_000,
          deploymentId: 'dep-1',
        },
      );
      const active = await store.runtimeFlags.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ scope: 'consumer', target: 'agent-x' });
    } finally {
      await store.close();
    }
  });
});
