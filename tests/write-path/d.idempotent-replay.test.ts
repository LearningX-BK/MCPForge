// MCPForge — W0-F7(d): an idempotent replay returning the original result.
// 01 §10.4 criterion 7(d).
//
// Drives the REAL chain, the REAL confirm gate, the REAL idempotency gate,
// the REAL write dispatcher and a REAL SQLite store — the wiring
// `core/gateway/policy/idempotency/idempotency.test.ts` (W0-F3) already
// proved field-by-field. This test asserts the checkpoint-level shape:
// confirm once, execute, then present the SAME confirmed call again and get
// the ORIGINAL result back with `replayed: true`, with the target invoked
// exactly once.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeStore } from '../../core/gateway/store/repository.js';
import { runPolicyChain } from '../../core/gateway/policy/chain.js';
import {
  CREATE_ARGS,
  TOOLS,
  cleanupStoreDir,
  ctxFor,
  dispatcherFor,
  entryFor,
  mockTarget,
  openStore,
  policyCall,
} from './support/store-world.js';
import { withEvidence } from './support/evidence.js';

let store: RuntimeStore;

beforeEach(async () => {
  store = await openStore();
});
afterEach(async () => {
  await store.close();
});
afterAll(() => {
  cleanupStoreDir();
});

describe('W0-F7(d) — idempotent replay returns the original result', () => {
  it('a repeat presentation of the confirmed call replays the original result; the target runs once', async () => {
    await withEvidence(
      'd',
      '(d) Idempotent replay — replaying a confirmed write returned the original result instead of executing a second time.',
      'a repeat presentation of the confirmed call replays the original result; the target runs once',
      async () => {
        const target = mockTarget();
        const dispatcher = dispatcherFor(store, target);
        const ctx = ctxFor(store);

        const plan = await runPolicyChain(policyCall(TOOLS.voucherCreate, { ...CREATE_ARGS }), ctx);
        if (plan.outcome !== 'responded') throw new Error('plan phase did not respond');
        const token = String(plan.response['confirmToken']);
        const args = { ...CREATE_ARGS, confirm: token };

        const confirmed = await runPolicyChain(policyCall(TOOLS.voucherCreate, args), ctx);
        if (confirmed.outcome !== 'proceed') throw new Error('confirm phase did not proceed');

        const first = await dispatcher.dispatch({
          call: policyCall(TOOLS.voucherCreate, args),
          entry: entryFor(TOOLS.voucherCreate),
          ctx,
          confirmed: confirmed.confirmed,
        });
        expect(first.kind).toBe('executed');
        if (first.kind !== 'executed') throw new Error('unreachable');

        // The SAME confirmed call, presented again — a real second `tools/call`
        // with identical arguments and the identical (still within-TTL) token.
        const replayDecision = await runPolicyChain(policyCall(TOOLS.voucherCreate, args), ctx);
        expect(replayDecision.outcome).toBe('responded');
        if (replayDecision.outcome !== 'responded') throw new Error('unreachable');
        expect(replayDecision.stage).toBe('6h');
        expect(replayDecision.response['replayed']).toBe(true);
        expect(replayDecision.response['document_number']).toBe(first.response['document_number']);
        expect(replayDecision.response['status']).toBe(first.response['status']);

        expect(target.invocations).toHaveLength(1);

        return {
          toolId: TOOLS.voucherCreate,
          idempotencyKeyParts: 'sha256(callerSubject | toolId | toolVersion | argsCanonicalHash | confirmToken)',
          originalAuditCallId: first.auditCallId,
          originalResponse: first.response,
          replayResponse: replayDecision.response,
          replayStage: replayDecision.stage,
          targetInvocationCount: target.invocations.length,
        };
      },
    );
  });
});
