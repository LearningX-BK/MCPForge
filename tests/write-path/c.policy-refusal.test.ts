// MCPForge — W0-F7(c): a refusal at policy for a guardrail or SoD breach.
// 01 §10.4 criterion 7(c).
//
// Uses the SAME sodConflict shape `core/gateway/policy/guardrails/guardrails.test.ts`
// (W0-F4) proved: a caller whose resolved role scope grants BOTH
// jde.ap.voucher.create and jde.scm.purchase_order.create is refused at
// stage 6f — before a plan token is ever minted — for holding the
// conflicting grant on the same entity chain.
//
// W0-I5 NOTE — this file no longer writes the criterion (c) evidence file.
// 01 §10.4(c) names "an SoD conflict between `create` and `approve` on the same
// entity", and TASKS.md W0-I5 states that the
// jde.scm.purchase_order.create / .approve pair IS the W0-F7(c) demonstration.
// `c.sod-po-create-approve.test.ts` proves exactly that pair, from the guardrail
// the manifest actually declares, so it is the evidence source and this file is
// the engine-level test that a hand-built sodConflict declaration is enforced.
// Both wrote `.evidence/c.json`; whichever worker finished last won, which is
// not an acceptable property for checkpoint evidence.

import { describe, expect, it } from 'vitest';
import type { Guardrail } from '@mcpforge/shared';
import { BUSINESS_ARGS, TOOLS, guardrailCtx, policyCall, runPolicyChain } from './support/light-world.js';

describe('W0-F7(c) — refused at policy for a segregation-of-duties conflict', () => {
  it('refuses jde.ap.voucher.create for a caller whose scope also grants jde.scm.purchase_order.create', async () => {
    const guardrail: Guardrail = {
      kind: 'sodConflict',
      with: TOOLS.poCreate,
      scope: 'sameEntityChain',
    };
    const ctx = guardrailCtx([guardrail]);

    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctx);

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6f');
    expect(decision.error.code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(decision.error.message).toContain(TOOLS.poCreate);
    expect(decision.error.message).toContain('p2p');
    expect(decision.error.next.length).toBeGreaterThan(0);
    expect(decision.error.next.toLowerCase()).not.toMatch(/^try again\b/);
    // 6f sits before 6g: the breach is caught before a plan token is minted.
    expect(decision.stagesRun).not.toContain('6g');
  });
});
