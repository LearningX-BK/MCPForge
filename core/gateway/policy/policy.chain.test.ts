// MCPForge — W0-E3 DONE CRITERION: the ten stages execute in the documented
// order and each one refuses with its correct error code.
//
// 02 §4.2 step [6] as extended by 02 §11.4.2.

import { describe, expect, it, vi } from 'vitest';
import {
  POLICY_STAGES,
  callThroughToolsCall,
  invokeThroughForgeInvoke,
  type PolicyDecision,
  type WriteGate,
} from './index.js';
import {
  TOOLS,
  call,
  consumer,
  context,
  defaultRoles,
  functionGrant,
  role,
} from './policy.fixtures.js';

function refusal(decision: PolicyDecision) {
  if (decision.outcome !== 'refused') {
    throw new Error(`expected a refusal, got ${decision.outcome}`);
  }
  return decision;
}

function responded(decision: PolicyDecision) {
  if (decision.outcome !== 'responded') {
    throw new Error(`expected a terminal response, got ${decision.outcome}`);
  }
  return decision;
}

// --- the order itself ------------------------------------------------------

describe('the chain is ten ordered stages (02 §11.4.2)', () => {
  it('lists 6a 6a′ 6b 6c 6d 6e 6e′ 6f 6g 6h, in that order', () => {
    expect(POLICY_STAGES.map((s) => s.id)).toEqual([
      '6a',
      '6a′',
      '6b',
      '6c',
      '6d',
      '6e',
      '6e′',
      '6f',
      '6g',
      '6h',
    ]);
  });

  it('places 6e′ immediately after 6e and before 6f (02 §11.4)', () => {
    const ids = POLICY_STAGES.map((s) => s.id);
    expect(ids.indexOf('6e′')).toBe(ids.indexOf('6e') + 1);
    expect(ids.indexOf('6e′')).toBeLessThan(ids.indexOf('6f'));
  });

  it('places 6e′ before 6g, so no plan token can be minted for an unauthorized binding', () => {
    const ids = POLICY_STAGES.map((s) => s.id);
    expect(ids.indexOf('6e′')).toBeLessThan(ids.indexOf('6g'));
  });
});

// --- one refusal per stage, each with its documented code ------------------

describe('each stage refuses with its own closed-taxonomy code', () => {
  it('6a — a tool in no catalogue at all: TOOL_NOT_IN_SCOPE', async () => {
    const d = refusal(await callThroughToolsCall(call('jde.hcm.employee.get'), context()));
    expect(d.stage).toBe('6a');
    expect(d.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('6a — a catalogued tool no held role grants: TOOL_NOT_IN_SCOPE', async () => {
    const d = refusal(await callThroughToolsCall(call(TOOLS.journalCreate), context()));
    expect(d.stage).toBe('6a');
    expect(d.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('6a′ — a suspended consumer: CONSUMER_SUSPENDED', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({ consumer: consumer({ effectiveStatus: 'suspended' }) }),
      ),
    );
    expect(d.stage).toBe('6a′');
    expect(d.error.code).toBe('CONSUMER_SUSPENDED');
  });

  it('6a′ — a consumer not authorized for the binding type: CONSUMER_NOT_AUTHORIZED', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({ consumer: consumer({ authorizations: { bindingTypes: ['rest'] } }) }),
      ),
    );
    expect(d.stage).toBe('6a′');
    expect(d.error.code).toBe('CONSUMER_NOT_AUTHORIZED');
    // 02 §11.3: the two refusals must never share wording.
    expect(d.error.next).not.toEqual(expect.stringContaining('forge.find'));
  });

  it('6b — the probe reports the tool disabled: TOOL_DISABLED', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          probeStatuses: new Map([[TOOLS.voucherSearch, 'disabled_missing_binding' as const]]),
        }),
      ),
    );
    expect(d.stage).toBe('6b');
    expect(d.error.code).toBe('TOOL_DISABLED');
  });

  it('6b — a kill switch on the tool: TOOL_DISABLED, carrying the flag reason', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          flags: [{ scope: 'tool', target: TOOLS.voucherSearch, reason: 'AIS outage 2026-09-03' }],
        }),
      ),
    );
    expect(d.stage).toBe('6b');
    expect(d.error.code).toBe('TOOL_DISABLED');
    expect(d.error.next).toContain('AIS outage 2026-09-03');
  });

  it('6c — over the declared limit: RATE_LIMITED', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          runtime: {
            rateLimiter: { check: () => ({ allowed: false, reason: '61 calls in a 60s window' }) },
          },
        }),
      ),
    );
    expect(d.stage).toBe('6c');
    expect(d.error.code).toBe('RATE_LIMITED');
  });

  it('6d — arguments that fail the compiled schema: INPUT_INVALID', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch, { supplier: 42 }),
        context({
          runtime: {
            argumentValidator: {
              validate: () => ({ valid: false, errors: '/supplier must be string' }),
            },
          },
        }),
      ),
    );
    expect(d.stage).toBe('6d');
    expect(d.error.code).toBe('INPUT_INVALID');
    expect(d.error.message).toContain('/supplier');
  });

  it('6e — sensitivity above every granting role ceiling: POLICY_GUARDRAIL_BREACH', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({
          roles: new Map([['p2p', role({ roleId: 'p2p', sensitivityCeiling: 'internal' })]]),
        }),
      ),
    );
    expect(d.stage).toBe('6e');
    expect(d.error.code).toBe('POLICY_GUARDRAIL_BREACH');
  });

  it('6e — a write tool granted only by a read-only role: POLICY_GUARDRAIL_BREACH', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCancel),
        context({
          roles: new Map([['p2p', role({ roleId: 'p2p', writeAllowed: false })]]),
        }),
      ),
    );
    expect(d.stage).toBe('6e');
    expect(d.error.code).toBe('POLICY_GUARDRAIL_BREACH');
  });

  it('6e — a granting role with no readable view fails closed rather than open', async () => {
    const d = refusal(
      await callThroughToolsCall(call(TOOLS.voucherSearch), context({ roles: new Map() })),
    );
    expect(d.stage).toBe('6e');
    expect(d.error.code).toBe('POLICY_GUARDRAIL_BREACH');
  });

  it('6e′ — an elevated binding with no grant: ELEVATED_GRANT_REQUIRED', async () => {
    const d = refusal(await callThroughToolsCall(call(TOOLS.voucherCreate), context()));
    expect(d.stage).toBe('6e′');
    expect(d.error.code).toBe('ELEVATED_GRANT_REQUIRED');
    expect(d.error.next.length).toBeGreaterThan(0);
  });

  it('6f — a declared guardrail breach: POLICY_GUARDRAIL_BREACH', async () => {
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          runtime: {
            guardrails: {
              evaluate: () => ({ breached: true, message: 'company 00200 is not allowed' }),
            },
          },
        }),
      ),
    );
    expect(d.stage).toBe('6f');
    expect(d.error.code).toBe('POLICY_GUARDRAIL_BREACH');
  });

  it('6g — a write called with no confirm token: PLAN_REQUIRED', async () => {
    const writeGate: WriteGate = {
      evaluate: () => ({ kind: 'refuse', code: 'PLAN_REQUIRED', message: 'no confirm token' }),
    };
    const d = refusal(
      await callThroughToolsCall(call(TOOLS.voucherCancel), context({ runtime: { writeGate } })),
    );
    expect(d.stage).toBe('6g');
    expect(d.error.code).toBe('PLAN_REQUIRED');
    expect(d.error.next).toContain(TOOLS.voucherCancel);
  });

  it('6g — a plan response is terminal and does not reach the executor', async () => {
    const writeGate: WriteGate = {
      evaluate: () => ({
        kind: 'respond',
        response: { status: 'confirm_required', confirmToken: 'cnf_test' },
      }),
    };
    const decision = responded(
      await callThroughToolsCall(call(TOOLS.voucherCancel), context({ runtime: { writeGate } })),
    );
    expect(decision.stage).toBe('6g');
    expect(decision.stagesRun).not.toContain('6h');
  });

  it('6h — a repeat within the window replays instead of executing (02 §3.1.2)', async () => {
    const decision = responded(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          runtime: {
            idempotency: {
              lookup: () => ({ kind: 'replay', previousResult: { document_number: 4242 } }),
            },
          },
        }),
      ),
    );
    expect(decision.stage).toBe('6h');
    expect(decision.response).toEqual({ document_number: 4242, replayed: true });
  });
});

// --- every refusal carries a real `next` (non-negotiable #5) ---------------

describe('no dead ends', () => {
  it('every stage refusal carries a non-empty, non-"try again" next', async () => {
    const decisions = [
      await callThroughToolsCall(call('jde.hcm.employee.get'), context()),
      await callThroughToolsCall(call(TOOLS.voucherCreate), context()),
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({ consumer: consumer({ effectiveStatus: 'retired' }) }),
      ),
    ];
    for (const decision of decisions) {
      const d = refusal(decision);
      expect(d.error.next.trim().length).toBeGreaterThan(0);
      expect(d.error.next.toLowerCase()).not.toContain('try again');
    }
  });
});

// --- 6a is an INDEPENDENT re-check, and forge.invoke is not a way around it -

describe('DONE: step 6a re-checks scope at call time, independently of step 4', () => {
  it('refuses an unlisted tool named directly through forge.invoke: TOOL_NOT_IN_SCOPE', async () => {
    const d = refusal(await invokeThroughForgeInvoke(call(TOOLS.journalCreate), context()));
    expect(d.stage).toBe('6a');
    expect(d.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('refuses a tool that is in no catalogue through forge.invoke too', async () => {
    const d = refusal(await invokeThroughForgeInvoke(call('ebs.gl.journal.create'), context()));
    expect(d.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('re-resolves from the CURRENT context: a tool listed a moment ago and killed since is refused', async () => {
    const listed = await callThroughToolsCall(call(TOOLS.voucherSearch), context());
    expect(listed.outcome).toBe('proceed');

    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({ flags: [{ scope: 'tool', target: TOOLS.voucherSearch, reason: 'killed' }] }),
      ),
    );
    expect(d.stage).toBe('6b');
  });

  it('gives the identical verdict through both entry points (02 §11.4.6)', async () => {
    for (const toolId of [TOOLS.voucherSearch, TOOLS.voucherCreate, TOOLS.journalCreate]) {
      const viaCall = await callThroughToolsCall(call(toolId), context());
      const viaInvoke = await invokeThroughForgeInvoke(call(toolId), context());
      expect(viaInvoke.outcome).toBe(viaCall.outcome);
      expect(viaInvoke.stagesRun).toEqual(viaCall.stagesRun);
      if (viaCall.outcome === 'refused' && viaInvoke.outcome === 'refused') {
        expect(viaInvoke.error.code).toBe(viaCall.error.code);
      }
    }
  });
});

// --- DONE: 6e′ runs before 6g, so no plan token is ever minted -------------

describe('DONE: 6e′ runs before 6g — no plan token for a call lacking an elevated grant', () => {
  const mintingWriteGate = () => {
    const mint = vi.fn(() => ({
      kind: 'respond' as const,
      response: { status: 'confirm_required', confirmToken: 'cnf_should_never_exist' },
    }));
    return { mint, gate: { evaluate: mint } satisfies WriteGate };
  };

  it('refuses at 6e′ and never reaches the write gate, through tools/call', async () => {
    const { mint, gate } = mintingWriteGate();
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({ runtime: { writeGate: gate } }),
      ),
    );
    expect(d.stage).toBe('6e′');
    expect(d.error.code).toBe('ELEVATED_GRANT_REQUIRED');
    expect(d.stagesRun).not.toContain('6g');
    expect(mint).not.toHaveBeenCalled();
  });

  it('refuses at 6e′ and never reaches the write gate, through forge.invoke', async () => {
    const { mint, gate } = mintingWriteGate();
    const d = refusal(
      await invokeThroughForgeInvoke(
        call(TOOLS.voucherCreate),
        context({ runtime: { writeGate: gate } }),
      ),
    );
    expect(d.stage).toBe('6e′');
    expect(d.error.code).toBe('ELEVATED_GRANT_REQUIRED');
    expect(mint).not.toHaveBeenCalled();
  });

  it('an EXPIRED grant does not mint a plan either — renewal is a re-approval', async () => {
    const { mint, gate } = mintingWriteGate();
    const roles = new Map(defaultRoles());
    roles.set(
      'p2p',
      role({ roleId: 'p2p', bindingGrants: [functionGrant({ expiresAt: '2026-01-01' })] }),
    );
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({ roles, runtime: { writeGate: gate } }),
      ),
    );
    expect(d.error.code).toBe('ELEVATED_GRANT_REQUIRED');
    expect(mint).not.toHaveBeenCalled();
  });

  it('a live, named, approval-recorded grant lets the call through to 6g', async () => {
    const { mint, gate } = mintingWriteGate();
    const roles = new Map(defaultRoles());
    roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
    const decision = responded(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({ roles, runtime: { writeGate: gate } }),
      ),
    );
    expect(decision.stage).toBe('6g');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('a role grant the consumer does not also hold is refused — intersection, not union', async () => {
    const roles = new Map(defaultRoles());
    roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
    const d = refusal(
      await callThroughToolsCall(
        call(TOOLS.voucherCreate),
        context({
          roles,
          consumerBindingGrants: [functionGrant({ bindingType: 'plsql' })],
        }),
      ),
    );
    expect(d.stage).toBe('6e′');
    expect(d.error.code).toBe('ELEVATED_GRANT_REQUIRED');
  });
});

// --- the happy path --------------------------------------------------------

describe('a standard-posture read tool walks all ten stages', () => {
  it('proceeds, having run every stage in order', async () => {
    const decision = await callThroughToolsCall(call(TOOLS.voucherSearch), context());
    expect(decision.outcome).toBe('proceed');
    expect(decision.stagesRun).toEqual(POLICY_STAGES.map((s) => s.id));
  });
});
