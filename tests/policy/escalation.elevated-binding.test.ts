// MCPForge — W0-E8 [P5] case 7: an elevated-binding tool called with NO
// `bindingGrant`, through BOTH `tools/call` and `forge.invoke`.
//
// CLAUDE.md non-negotiable #7: "Being in scope is not permission to execute an
// elevated binding. Catalogue membership is discovery; scope is visibility;
// neither is permission. … `forge.invoke` is not a way around it — it runs the
// identical chain."
//
// The escalation being attempted is precisely the one #7 names: the caller IS
// granted the tool, the consumer IS authorized for the binding type, every
// other stage says yes — and the call must still be refused, because no role
// and no consumer holds a live `bindingGrant` for it. The real
// `core/gateway/policy/binding-auth/**` (posture.ts + grants.ts + authorize.ts)
// makes that decision; this file only drives it and checks the answer.
//
// The 6g spy is the "mint is never called" proof 02 §11.4 demands ("6e′ must
// sit before 6g so an unauthorized binding type can never mint a plan token").
// It is a recording spy on the real seam, not a replacement for it.

import { describe, expect, it, vi } from 'vitest';
import {
  callThroughToolsCall,
  invokeThroughForgeInvoke,
} from '../../core/gateway/policy/entry-points.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  POLICY_CATALOGUE,
  role,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import { bindingPosture } from '../../core/gateway/policy/binding-auth/posture.js';
import type { PolicyRoleView } from '../../core/gateway/policy/types.js';
import { resolveScope } from '../../core/gateway/scope/resolve.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

// `jde.ap.voucher.create` — a `function` binding, which 02 §11.4 classes as
// elevated posture. It is in p2p, which the caller holds.
const ELEVATED = TOOLS.voucherCreate;

/** The p2p/r2r/o2c roles with a live `function` grant added to p2p. */
function rolesWithGrant(): ReadonlyMap<string, PolicyRoleView> {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return roles;
}

describe('W0-E8 [P5] case 7 — elevated binding, no bindingGrant, through BOTH entry points', () => {
  it('the tool really is elevated posture, and really is visible to this caller', () => {
    expect(bindingPosture(entry(ELEVATED)).posture).toBe('elevated');
    // Visibility is what makes this an escalation rather than a scope miss:
    // the caller can SEE it in tools/list and still may not execute it.
    expect(resolveScope(POLICY_CATALOGUE, context().scope).visible).toContain(ELEVATED);
  });

  it('tools/call FAILS CLOSED with ELEVATED_GRANT_REQUIRED at 6e′', async () => {
    const decision = await callThroughToolsCall(call(ELEVATED, { amount: 100 }), context());

    const refused = expectFailsClosed(decision, {
      code: 'ELEVATED_GRANT_REQUIRED',
      stage: '6e′',
    });
    expect(refused.error.next).toMatch(/bindingGrant/);
    // The refusal must not send the operator to a role scope change, which is
    // exactly the confusion #7 exists to prevent.
    expect(refused.error.next).toMatch(/role scope alone does not cover it/);
  });

  it('forge.invoke FAILS CLOSED identically — same stage, same code, same next', async () => {
    const viaToolsCall = await callThroughToolsCall(call(ELEVATED, { amount: 100 }), context());
    const viaForgeInvoke = await invokeThroughForgeInvoke(call(ELEVATED, { amount: 100 }), context());

    expectFailsClosed(viaForgeInvoke, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
    expect(viaForgeInvoke).toEqual(viaToolsCall);
  });

  it('NO plan token is minted through either entry point — 6g is never reached', async () => {
    for (const entryPoint of [callThroughToolsCall, invokeThroughForgeInvoke]) {
      const writeGate = { evaluate: vi.fn(() => ({ kind: 'not-a-write' as const })) };
      const idempotency = { lookup: vi.fn(() => ({ kind: 'proceed' as const })) };
      const ctx = context({ runtime: { writeGate, idempotency } });

      const decision = await entryPoint(call(ELEVATED, { amount: 100 }), ctx);

      expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
      expect(writeGate.evaluate).not.toHaveBeenCalled();
      expect(idempotency.lookup).not.toHaveBeenCalled();
      expect(decision.stagesRun).not.toContain('6g');
      expect(decision.stagesRun).not.toContain('6h');
    }
  });

  it('an EXPIRED grant is not a grant — both entry points still fail closed', async () => {
    const roles = new Map(defaultRoles());
    roles.set(
      'p2p',
      role({
        roleId: 'p2p',
        bindingGrants: [functionGrant({ expiresAt: '2026-01-01', expired: false })],
      }),
    );
    // `expired: false` is deliberate: the compiled artefact says "live", and the
    // gateway must still refuse on its OWN clock (02 §11.4 — a process running
    // since before an expiry may not keep honouring the grant).
    for (const entryPoint of [callThroughToolsCall, invokeThroughForgeInvoke]) {
      const decision = await entryPoint(call(ELEVATED, { amount: 100 }), context({ roles }));
      expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
    }
  });

  it('a grant naming a DIFFERENT target is not a grant for this one', async () => {
    const roles = new Map(defaultRoles());
    roles.set(
      'p2p',
      role({ roleId: 'p2p', bindingGrants: [functionGrant({ names: ['ORCH_SOMETHING_ELSE'] })] }),
    );
    const decision = await callThroughToolsCall(call(ELEVATED, { amount: 100 }), context({ roles }));
    expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
  });

  it('a grant held by a role the caller does NOT hold never authorizes the call', async () => {
    const roles = new Map(defaultRoles());
    // r2r holds the grant; the caller holds p2p and o2c.
    roles.set('r2r', role({ roleId: 'r2r', bindingGrants: [functionGrant()] }));
    const decision = await callThroughToolsCall(call(ELEVATED, { amount: 100 }), context({ roles }));
    expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
  });

  it('with a LIVE grant on a held role the same call proceeds — the refusals above are the grant, not a broken fixture', async () => {
    const decision = await callThroughToolsCall(
      call(ELEVATED, { amount: 100 }),
      context({ roles: rolesWithGrant() }),
    );
    expectProceeds(decision);
    expect(decision.stagesRun).toHaveLength(10);
  });
});
