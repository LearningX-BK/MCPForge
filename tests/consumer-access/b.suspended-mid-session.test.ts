// MCPForge — W0-N14(b): 01 §11.5 criterion 14(b).
//
// "A registered consumer suspended MID-SESSION is refused on its next call
// within the kill-switch poll interval, with CONSUMER_SUSPENDED."
//
// This is the real mechanism `tests/policy/escalation.consumer.test.ts` case 6
// (W0-E8 [P5]) already proves in depth: consumer suspension is one of the kill
// switch's five granularities (CLAUDE.md §3 — "tool · module server · binding
// type · consumer · deployment"), so `forge kill consumer:<id>` writes a real
// `runtime_flags` row and the SAME 5-second hot-reload poll (W0-E5,
// `DEFAULT_KILL_SWITCH_POLL_MS`) that disables a tool also disables a
// consumer. This file is the checkpoint-evidence assembly of that mechanism —
// same real store, real `applyKill`, real `createPolledRuntimeFlagSource`, one
// long-lived policy context reused across calls (which is what makes it
// "mid-session" rather than "on reconnect") — not a re-implementation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callThroughToolsCall } from '../../core/gateway/policy/entry-points.js';
import { call, context, TOOLS } from '../../core/gateway/policy/policy.fixtures.js';
import type { PolicyContext } from '../../core/gateway/policy/types.js';
import { applyKill } from '../../core/gateway/flags/kill.js';
import {
  createPolledRuntimeFlagSource,
  DEFAULT_KILL_SWITCH_POLL_MS,
} from '../../core/gateway/flags/poller.js';
import { openRuntimeStore } from '../../core/gateway/store/store.js';
import type { RuntimeStore } from '../../core/gateway/store/repository.js';
import { withEvidence } from './support/evidence.js';

// A read tool that otherwise passes every stage, so the ONLY variable across
// the two calls in this test is the consumer's kill-switch standing.
const PERMITTED = TOOLS.voucherSearch;

describe('W0-N14(b) — a consumer suspended mid-session is refused on its next call within the poll interval', () => {
  let store: RuntimeStore;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcpforge-w0n14-b-'));
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('forge kill consumer:<id> mid-session refuses the next call, within the real 5s poll, CONSUMER_SUSPENDED', async () => {
    await withEvidence(
      'b',
      '(b) A registered consumer suspended mid-session is refused on its next call within the kill-switch poll interval, with CONSUMER_SUSPENDED.',
      'forge kill consumer:<id> mid-session refuses the next call, within the real 5s poll, CONSUMER_SUSPENDED',
      async () => {
        // The real store-backed flag source the running gateway uses — W0-E5's
        // `createPolledRuntimeFlagSource`, not an in-memory test fixture — at
        // its documented default interval.
        const flags = createPolledRuntimeFlagSource(store.runtimeFlags, {
          intervalMs: DEFAULT_KILL_SWITCH_POLL_MS,
        });
        await flags.refreshNow();

        const base = context();
        // ONE long-lived session context, built once and reused across both
        // calls below — this is what makes the demonstration "mid-session"
        // rather than "refused on reconnect".
        const session: PolicyContext = { ...base, scope: { ...base.scope, flags } };
        const consumerId = session.scope.session.consumer.consumerId;

        const before = await callThroughToolsCall(call(PERMITTED), session);
        if (before.outcome !== 'proceed') {
          throw new Error(`expected the pre-kill call to proceed, got ${before.outcome}`);
        }

        // The real `forge kill consumer:<id>` business logic: a real row in the
        // real runtime_flags table and a real audit record.
        const killed = await applyKill(store.runtimeFlags, store.audit, {
          raw: `consumer:${consumerId}`,
          reason: 'W0-N14(b) checkpoint evidence — credential suspected compromised',
          actorSubject: 'ops-w0n14',
          deploymentId: 'ltm-dev',
        });
        expect(killed.scope).toBe('consumer');
        expect(killed.target).toBe(consumerId);

        // Still working until the poll ticks — a real, stated property of the
        // design (02 §4.7), not glossed over.
        const stillWorking = await callThroughToolsCall(call(PERMITTED), session);
        if (stillWorking.outcome !== 'proceed') {
          throw new Error('expected the call to still proceed before the poll ticks');
        }

        // One tick of the REAL poll — `refreshNow` is exactly what the
        // interval timer calls. No restart of anything, no new session.
        await flags.refreshNow();

        const after = await callThroughToolsCall(call(PERMITTED), session);
        if (after.outcome !== 'refused') {
          throw new Error(`expected the post-poll call to be refused, got ${after.outcome}`);
        }
        expect(after.error.code).toBe('CONSUMER_SUSPENDED');
        expect(after.stage).toBe('6b');
        expect(after.error.message).toContain('credential suspected compromised');
        expect(after.error.next).toContain('credential suspected compromised');
        expect(after.error.next.trim().length).toBeGreaterThan(0);

        return {
          consumerId,
          killScope: killed.scope,
          killTarget: killed.target,
          killAuditCallId: killed.auditCallId,
          pollIntervalMs: DEFAULT_KILL_SWITCH_POLL_MS,
          preKillOutcome: before.outcome,
          postKillPrePollOutcome: stillWorking.outcome,
          postPollOutcome: after.outcome,
          postPollRefusalCode: after.error.code,
          postPollRefusalStage: after.stage,
          postPollRefusalNext: after.error.next,
          realMechanism:
            'core/gateway/flags/kill.ts applyKill + core/gateway/flags/poller.ts createPolledRuntimeFlagSource (real SQLite-backed runtime_flags) + core/gateway/scope/predicates.ts notKillSwitchedPredicate (consumer scope) + core/gateway/policy/stages.ts stage6b — the same mechanism tests/policy/escalation.consumer.test.ts (W0-E8 case 6) exercises.',
        };
      },
    );
  });
});
