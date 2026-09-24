// MCPForge — W0-F7(b): a refusal at confirm because arguments changed.
// 01 §10.4 criterion 7(b).
//
// Drives the REAL policy chain through stage 6g's confirm gate, using the
// wiring `core/gateway/policy/confirm/confirm.test.ts` (W0-F1/F2) already
// proved field-by-field. This test asserts the one end-to-end shape a
// checkpoint needs: plan with one amount, present the token with a DIFFERENT
// amount, and get refused before anything mutating runs.

import { describe, expect, it } from 'vitest';
import {
  BUSINESS_ARGS,
  confirmCtx,
  policyCall,
  runPolicyChain,
} from './support/light-world.js';
import { withEvidence } from './support/evidence.js';

describe('W0-F7(b) — refused at confirm because arguments changed since the plan', () => {
  it('plans at amount 18400, presents the token at amount 25000, and is refused', async () => {
    await withEvidence(
      'b',
      '(b) A correct refusal at confirm — a write was refused because the arguments changed between the plan and the confirmation.',
      'plans at amount 18400, presents the token at amount 25000, and is refused',
      async () => {
        const ctx = confirmCtx();

        const plan = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctx);
        expect(plan.outcome).toBe('responded');
        if (plan.outcome !== 'responded') throw new Error('unreachable');
        const token = String(plan.response['confirmToken']);

        const changedArgs = { ...BUSINESS_ARGS, amount: 25_000 };
        const decision = await runPolicyChain(policyCall({ ...changedArgs, confirm: token }), ctx);

        expect(decision.outcome).toBe('refused');
        if (decision.outcome !== 'refused') throw new Error('unreachable');
        expect(decision.stage).toBe('6g');
        expect(decision.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
        expect(decision.error.message).toContain('amount');
        expect(decision.error.next.length).toBeGreaterThan(0);
        expect(decision.error.next.toLowerCase()).not.toMatch(/^try again\b/);
        // Nothing downstream of the refusing stage ran.
        expect(decision.stagesRun).not.toContain('6h');

        return {
          toolId: 'jde.ap.voucher.create',
          plannedAmount: BUSINESS_ARGS.amount,
          presentedAmount: changedArgs.amount,
          confirmToken: token,
          refusalCode: decision.error.code,
          refusalStage: decision.stage,
          refusalMessage: decision.error.message,
          refusalNext: decision.error.next,
          stagesRun: decision.stagesRun,
        };
      },
    );
  });
});
