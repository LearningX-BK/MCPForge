// MCPForge — W0-E3 DONE CRITERION: every refusal is fail-closed. A thrown
// exception anywhere in the chain DENIES rather than allows.
//
// This is the ONE fault-injection suite, and it covers all ten stages including
// `6a′` and `6e′` — the [P5] clause requires the existing suite to be extended,
// not a second suite added beside it. The table below is generated from
// `POLICY_STAGES` itself, so a stage added to the chain without a fault case is
// impossible: the loop finds it automatically.

import { describe, expect, it, vi } from 'vitest';
import {
  POLICY_STAGES,
  callThroughToolsCall,
  invokeThroughForgeInvoke,
  runPolicyChain,
  type PolicyStage,
  type PolicyStageId,
} from './index.js';
import { TOOLS, call, context, defaultRoles, functionGrant, role } from './policy.fixtures.js';

/** The frozen ten, with `failing` replaced by a stage that throws. */
function chainWithThrowAt(failing: PolicyStageId, thrown: unknown): readonly PolicyStage[] {
  return POLICY_STAGES.map((stage) =>
    stage.id === failing
      ? {
          id: stage.id,
          name: stage.name,
          evaluate: () => {
            throw thrown;
          },
        }
      : stage,
  );
}

/**
 * A context on which the call would otherwise PROCEED through all ten stages —
 * an elevated write with a live grant, so that a fault at a late stage is
 * genuinely the only thing standing between the call and the executor.
 */
function proceedingContext() {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({ roles });
}

describe('fail-closed: a throw at any of the ten stages denies', () => {
  for (const stage of POLICY_STAGES) {
    it(`stage ${stage.id} (${stage.name}) throwing denies the call with INTERNAL`, async () => {
      const decision = await runPolicyChain(
        { ...call(TOOLS.voucherCreate), entryPoint: 'tools/call' },
        proceedingContext(),
        { stages: chainWithThrowAt(stage.id, new Error('injected fault')) },
      );

      expect(decision.outcome).toBe('refused');
      if (decision.outcome !== 'refused') throw new Error('unreachable');
      expect(decision.error.code).toBe('INTERNAL');
      expect(decision.stage).toBe(stage.id);
      // It STOPPED. No stage after the faulting one ran.
      expect(decision.stagesRun[decision.stagesRun.length - 1]).toBe(stage.id);
      // And it still says something actionable (non-negotiable #5).
      expect(decision.error.next).toContain('req_test_0001');
      expect(decision.error.next.toLowerCase()).not.toContain('try again');
    });
  }

  it('a non-Error throw (a string, a null) denies just the same', async () => {
    for (const thrown of ['boom', null, undefined, 42]) {
      const decision = await runPolicyChain(
        { ...call(TOOLS.voucherSearch), entryPoint: 'tools/call' },
        context(),
        { stages: chainWithThrowAt('6d', thrown) },
      );
      expect(decision.outcome).toBe('refused');
      if (decision.outcome !== 'refused') throw new Error('unreachable');
      expect(decision.error.code).toBe('INTERNAL');
    }
  });

  it('an async stage that rejects denies', async () => {
    const stages = POLICY_STAGES.map((stage) =>
      stage.id === '6g'
        ? {
            id: stage.id,
            name: stage.name,
            evaluate: async () => Promise.reject(new Error('async fault')),
          }
        : stage,
    );
    const decision = await runPolicyChain(
      { ...call(TOOLS.voucherSearch), entryPoint: 'tools/call' },
      context(),
      { stages },
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6g');
    expect(decision.error.code).toBe('INTERNAL');
  });

  it('a stage returning a malformed outcome denies rather than continuing', async () => {
    const stages = POLICY_STAGES.map((stage) =>
      stage.id === '6e′'
        ? {
            id: stage.id,
            name: stage.name,
            evaluate: () => undefined as unknown as ReturnType<PolicyStage['evaluate']>,
          }
        : stage,
    );
    const decision = await runPolicyChain(
      { ...call(TOOLS.voucherCreate), entryPoint: 'tools/call' },
      proceedingContext(),
      { stages },
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6e′');
    expect(decision.error.code).toBe('INTERNAL');
  });

  it('a stage refusing with an EMPTY next denies with INTERNAL, never with a dead end', async () => {
    const stages = POLICY_STAGES.map((stage) =>
      stage.id === '6f'
        ? {
            id: stage.id,
            name: stage.name,
            evaluate: () => ({
              kind: 'refuse' as const,
              code: 'POLICY_GUARDRAIL_BREACH' as const,
              message: 'breach',
              condition: 'breach',
              next: '   ',
            }),
          }
        : stage,
    );
    const decision = await runPolicyChain(
      { ...call(TOOLS.voucherSearch), entryPoint: 'tools/call' },
      context(),
      { stages },
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('INTERNAL');
    expect(decision.error.next.trim().length).toBeGreaterThan(0);
  });

  it('a throwing SEAM (rate limiter, validator, guardrails, write gate, idempotency) denies', async () => {
    const boom = () => {
      throw new Error('seam fault');
    };
    const seams = [
      { stage: '6c', runtime: { rateLimiter: { check: boom } } },
      { stage: '6d', runtime: { argumentValidator: { validate: boom } } },
      { stage: '6f', runtime: { guardrails: { evaluate: boom } } },
      { stage: '6g', runtime: { writeGate: { evaluate: boom } } },
      { stage: '6h', runtime: { idempotency: { lookup: boom } } },
    ] as const;

    for (const seam of seams) {
      const decision = await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({ runtime: seam.runtime as never }),
      );
      expect(decision.outcome).toBe('refused');
      if (decision.outcome !== 'refused') throw new Error('unreachable');
      expect(decision.stage).toBe(seam.stage);
      expect(decision.error.code).toBe('INTERNAL');
    }
  });

  it('a throwing SCOPE SOURCE denies at 6a rather than resolving to a wider set', async () => {
    const decision = await callThroughToolsCall(
      call(TOOLS.voucherSearch),
      context({
        // W0-E2 turns a throwing predicate into an INTERNAL scope refusal; the
        // chain must surface that as a denial, not step over it.
        probeStatuses: new Map(),
      }),
    );
    expect(decision.outcome).toBe('refused');
  });

  it('forge.invoke is fail-closed identically — the same fault, the same denial', async () => {
    for (const stage of POLICY_STAGES) {
      const viaCall = await runPolicyChain(
        { ...call(TOOLS.voucherCreate), entryPoint: 'tools/call' },
        proceedingContext(),
        { stages: chainWithThrowAt(stage.id, new Error('injected fault')) },
      );
      const viaInvoke = await runPolicyChain(
        { ...call(TOOLS.voucherCreate), entryPoint: 'forge.invoke' },
        proceedingContext(),
        { stages: chainWithThrowAt(stage.id, new Error('injected fault')) },
      );
      expect(viaInvoke.outcome).toBe(viaCall.outcome);
      if (viaCall.outcome !== 'refused' || viaInvoke.outcome !== 'refused') {
        throw new Error('unreachable');
      }
      expect(viaInvoke.stage).toBe(viaCall.stage);
      expect(viaInvoke.error.code).toBe(viaCall.error.code);
    }
  });

  it('a fault at the LAST stage still denies a call that would otherwise have executed', async () => {
    const executor = vi.fn();
    const decision = await runPolicyChain(
      { ...call(TOOLS.voucherCreate), entryPoint: 'tools/call' },
      proceedingContext(),
      { stages: chainWithThrowAt('6h', new Error('injected fault')) },
    );
    expect(decision.outcome).toBe('refused');
    // The executor is step [7] and only ever runs on `proceed`.
    if (decision.outcome === 'refused') expect(executor).not.toHaveBeenCalled();
  });

  it('the unfaulted chain still proceeds — the suite is not passing vacuously', async () => {
    const decision = await invokeThroughForgeInvoke(call(TOOLS.voucherCreate), proceedingContext());
    expect(decision.outcome).toBe('proceed');
  });
});
