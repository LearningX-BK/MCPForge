// MCPForge — W0-N4: `standingAuthorization` — the record, its expiry, and its
// enforcement, adversarially. 02 §11.4.4 / 05 §3.3.4.
//
// This is the file that has to be paranoid, because a standing authorization is
// the ONE mechanism in the elevated posture that makes a check do less. 02
// §11.4.4 names the exact failure mode: "implement the standing authorization
// and forget that it must be recorded and expire, and the gate is decoration."
//
// So every case here is one of two shapes:
//
//   A. **It removes nothing else.** With a standing authorization fully in
//      force, plan -> confirm still runs, guardrails still run, SoD still runs,
//      and the identity requirement is untouched. One test each, and each one
//      asserts the OTHER control still fires — not merely that the call
//      proceeded.
//   B. **It fails closed in every direction.** A standing authorization that is
//      unresolved, unapproved, unnamed, undated, expired, malformed or merely a
//      bare unresolved ref reverts to a FORCED PER-CALL APPROVAL. Never to a
//      free pass, and never to a hard refusal either — reverting to the
//      stricter path is the correct behaviour, and a test that only asserted
//      "it did not proceed" would pass on a bug that broke the write path.
//
// The write gate is the same RECORDING SPY the W0-N3 suite uses, and for the
// same reason: stage 6g is what consumes the forced flag, so the honest
// assertion is about the entry 6g was handed, not about a return value read
// back out of the function under test.
//
// No fixture is read from disk in this file, so there is no `process.cwd()`
// hazard; the two suites that do read fixtures resolve them from
// `import.meta.url`.

import { describe, expect, it } from 'vitest';
import { ForgeError } from '@mcpforge/shared/errors';
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
  role,
  standingAuthorization,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import { standingAuthorizationInForce } from '../../core/gateway/policy/binding-auth/standing.js';
import { generateLocalSigningKey, localTokenIssuer } from '../../core/gateway/identity/jwt.js';
import {
  localIdentityProvider,
  staticLocalPrincipalSource,
} from '../../core/gateway/identity/local.js';
import type { Principal } from '../../core/gateway/identity/types.js';
import type {
  CompiledBindingGrant,
  CompiledStandingAuthorization,
  GuardrailEvaluator,
  PolicyCatalogueEntry,
  PolicyRoleView,
  WriteGate,
} from '../../core/gateway/policy/types.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

/** `jde.ap.voucher.create` — a `function` binding and a write: elevated posture. */
const ELEVATED_WRITE = TOOLS.voucherCreate;

/** The fixture session clock. Every "advance the clock" case moves relative to it. */
const NOW = new Date('2026-09-03T09:00:00Z');

/** p2p holding a live `function` grant whose standing authorization is `standing`. */
function rolesWith(
  standing: CompiledStandingAuthorization | string | undefined,
  grantOverrides: Partial<CompiledBindingGrant> = {},
): ReadonlyMap<string, PolicyRoleView> {
  const roles = new Map(defaultRoles());
  const base: Record<string, unknown> = { ...functionGrant(grantOverrides) };
  if (standing === undefined) delete base['standingAuthorization'];
  else base['standingAuthorization'] = standing;
  roles.set(
    'p2p',
    role({ roleId: 'p2p', bindingGrants: [base as unknown as CompiledBindingGrant] }),
  );
  return roles;
}

/** Records the entry stage 6g was handed, then says `not-a-write` so the chain completes. */
function recordingWriteGate(): { gate: WriteGate; seen: PolicyCatalogueEntry[] } {
  const seen: PolicyCatalogueEntry[] = [];
  return {
    seen,
    gate: {
      evaluate: (_call, e) => {
        seen.push(e);
        return { kind: 'not-a-write' as const };
      },
    },
  };
}

/** Was the per-call human approval FORCED on this call? */
async function forcedApprovalFor(
  standing: CompiledStandingAuthorization | string | undefined,
  now: Date = NOW,
): Promise<boolean> {
  const { gate, seen } = recordingWriteGate();
  const decision = await callThroughToolsCall(
    call(ELEVATED_WRITE, { amount: 100 }),
    context({ roles: rolesWith(standing), runtime: { writeGate: gate }, now }),
  );
  // Reverting to a forced approval is a NARROWING, not a refusal: the call must
  // still reach 6g. A refusal here would be its own bug.
  expectProceeds(decision);
  expect(seen).toHaveLength(1);
  return seen[0]?.humanApprovalRequired === true;
}

// ---------------------------------------------------------------------------
// 1. It resolves — and it substitutes the standing approval for the per-call one
// ---------------------------------------------------------------------------

describe('W0-N4 clause 1 — a resolved, named, unexpired standing authorization', () => {
  it("stands down the forced per-call approval, restoring the tool's own setting", async () => {
    expect(entry(ELEVATED_WRITE).humanApprovalRequired).toBe(false);
    expect(await forcedApprovalFor(standingAuthorization())).toBe(false);
  });

  it('does so identically through forge.invoke — the identical chain, not a parallel one', async () => {
    const { gate, seen } = recordingWriteGate();
    await invokeThroughForgeInvoke(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWith(standingAuthorization()),
        runtime: { writeGate: gate },
        now: NOW,
      }),
    );
    expect(seen[0]?.humanApprovalRequired).toBe(false);
  });

  it('carries the RESOLVED approver and expiry, so an audit row can name who stood it down', () => {
    const grant = functionGrant({ standingAuthorization: standingAuthorization() });
    const verdict = standingAuthorizationInForce(grant, NOW);
    expect(verdict.inForce).toBe(true);
    if (verdict.inForce) {
      expect(verdict.approver).toBe('a.approver@ltm.example');
      expect(verdict.expiresAt).toBe('2027-02-23');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. IT REMOVES NOTHING ELSE — one test per control 02 §11.4.4 names
// ---------------------------------------------------------------------------

describe('W0-N4 clause 2 — it removes NOTHING else (02 §11.4.4)', () => {
  it('PLAN -> CONFIRM still runs: 6g is still consulted and can still demand a plan', async () => {
    // The escalation: hope that "no per-call approval" was implemented as "skip
    // the write gate". If 6g were bypassed this call would proceed straight to
    // execution with no plan token at all.
    const demandsAPlan: WriteGate = {
      evaluate: () => ({
        kind: 'refuse' as const,
        code: 'PLAN_REQUIRED' as const,
        message: 'this write must be planned before it is executed',
        next: `Call ${ELEVATED_WRITE} with dry_run: true, show the plan to the human, then confirm it.`,
      }),
    };
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWith(standingAuthorization()),
        runtime: { writeGate: demandsAPlan },
        now: NOW,
      }),
    );
    expectFailsClosed(decision, { code: 'PLAN_REQUIRED', stage: '6g' });
  });

  it('GUARDRAILS still run: a breached guardrail still refuses with the standing authorization in force', async () => {
    const breaches: GuardrailEvaluator = {
      evaluate: () => ({
        breached: true as const,
        message: 'amount 100 exceeds the declared maxAmount guardrail',
        next: 'Reduce amount below the declared ceiling and call the tool again.',
      }),
    };
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWith(standingAuthorization()),
        runtime: { guardrails: breaches },
        now: NOW,
      }),
    );
    expectFailsClosed(decision, { code: 'POLICY_GUARDRAIL_BREACH', stage: '6f' });
  });

  it('SEGREGATION OF DUTIES still runs: an SoD breach at 6f refuses, standing authorization or not', async () => {
    // SoD is evaluated by 6f (02 §3.1.3 — SoD is a declared guardrail), so the
    // claim under test is that 6f still runs and its verdict is still honoured
    // on a standing-authorized call. Stage 6e′ writes nothing 6f reads.
    const sodBreach: GuardrailEvaluator = {
      evaluate: () => ({
        breached: true as const,
        message: `segregation of duties: the caller already approved the purchase order this ${ELEVATED_WRITE} vouchers against`,
        next: 'Ask a second approver to voucher this purchase order; the caller may not both approve and voucher it.',
      }),
    };
    const refusal = expectFailsClosed(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, { amount: 100 }),
        context({
          roles: rolesWith(standingAuthorization()),
          runtime: { guardrails: sodBreach },
          now: NOW,
        }),
      ),
      { code: 'POLICY_GUARDRAIL_BREACH', stage: '6f' },
    );
    expect(refusal.error.message).toContain('segregation of duties');
  });

  it('the ORDER is unchanged: 6f runs BEFORE 6g even when the approval was stood down', async () => {
    const { gate, seen } = recordingWriteGate();
    const breaches: GuardrailEvaluator = {
      evaluate: () => ({ breached: true as const, message: 'guardrail breach', next: 'lower it' }),
    };
    await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWith(standingAuthorization()),
        runtime: { guardrails: breaches, writeGate: gate },
        now: NOW,
      }),
    );
    // 6f refused, so 6g never saw the call. A standing authorization that
    // resequenced the chain would show up here and nowhere else.
    expect(seen).toHaveLength(0);
  });

  it('the IDENTITY requirement is untouched: an unresolvable subject still fails hard', async () => {
    // The identity requirement lives before the policy chain and has no input
    // from it — which is exactly the claim. A standing authorization is a
    // property of a role's grant; there is no path by which it can reach the
    // identity provider, and a deployment that does not know the subject still
    // refuses with IDENTITY_UNRESOLVED and no fallback (CLAUDE.md #1).
    const tokens = localTokenIssuer({
      issuer: 'https://mcpforge.local/identity',
      audience: 'mcpforge-gateway',
      signingKey: generateLocalSigningKey('kid-active'),
      now: () => NOW,
    });
    const provider = localIdentityProvider({
      issuer: tokens,
      // Nobody is registered in this deployment.
      source: staticLocalPrincipalSource([]),
      issuerUrl: 'https://mcpforge.local/identity',
      audience: 'mcpforge-gateway',
      now: () => NOW,
    });
    const ghost: Principal = {
      subject: 'local:nobody',
      displayName: 'Ghost',
      groups: [],
      idp: 'local',
      authTime: NOW,
      amr: ['pwd'],
    };
    const error = await provider.resolveGroups(ghost).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).code).toBe('IDENTITY_UNRESOLVED');
    expect((error as ForgeError).retryable).toBe(false);
  });

  it('a standing authorization never LOWERS a tool that requires approval itself', async () => {
    const { gate, seen } = recordingWriteGate();
    const requiresApproval = {
      ...entry(ELEVATED_WRITE),
      humanApprovalRequired: true,
    };
    const catalogue = context().catalogue.map((e) =>
      e.toolId === ELEVATED_WRITE ? requiresApproval : e,
    );
    await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        catalogue,
        roles: rolesWith(standingAuthorization()),
        runtime: { writeGate: gate },
        now: NOW,
      }),
    );
    // Stood down means "6e′ adds nothing", never "6g's own answer is overruled".
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. EXPIRY — the clock-advance case, and it reverts rather than failing open
// ---------------------------------------------------------------------------

describe('W0-N4 clause 3 — an EXPIRED standing authorization reverts to a per-call approval', () => {
  it('is in force the day it expires and forced the day after — a clock advance, same grant', async () => {
    const standing = standingAuthorization({ expiresAt: '2026-09-03' });
    // Same context, same grant, same record; only the clock moves.
    expect(await forcedApprovalFor(standing, new Date('2026-09-03T23:59:59Z'))).toBe(false);
    expect(await forcedApprovalFor(standing, new Date('2026-09-04T00:00:01Z'))).toBe(true);
  });

  it('reverts to a FORCED APPROVAL rather than failing open OR refusing the call', async () => {
    const expired = standingAuthorization({ expiresAt: '2020-01-01' });
    const { gate, seen } = recordingWriteGate();
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles: rolesWith(expired), runtime: { writeGate: gate }, now: NOW }),
    );
    // Not a refusal — the elevated posture's answer to an expired standing
    // authorization is "ask a human", which is exactly the state the posture is
    // in when no standing authorization was ever granted.
    expectProceeds(decision);
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });

  it('a process running since BEFORE the expiry does not keep honouring it', () => {
    // The compiled artefact still says `effective: true` — it was compiled
    // while the record was live. The call clock is what decides.
    const stale = standingAuthorization({ expiresAt: '2026-09-01', effective: true });
    const grant = functionGrant({ standingAuthorization: stale });
    expect(standingAuthorizationInForce(grant, new Date('2026-08-31T00:00:00Z')).inForce).toBe(
      true,
    );
    expect(standingAuthorizationInForce(grant, NOW).inForce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. FAIL CLOSED — every way a standing authorization can be less than one
// ---------------------------------------------------------------------------

describe('W0-N4 clause 4 — anything less than a recorded, named, unexpired record forces approval', () => {
  const cases: readonly {
    readonly why: string;
    readonly standing: CompiledStandingAuthorization | string | undefined;
  }[] = [
    { why: 'no standing authorization at all', standing: undefined },
    {
      why: 'the approval record does not exist (compiled status: unresolved)',
      standing: standingAuthorization({
        status: 'unresolved',
        approver: '',
        expiresAt: '',
        effective: false,
      }),
    },
    {
      why: 'the record names no approver',
      standing: standingAuthorization({ approver: '' }),
    },
    {
      why: 'the record names no approver but claims to be active and effective',
      standing: standingAuthorization({ approver: '   ' }),
    },
    {
      why: 'the record carries no expiry',
      standing: standingAuthorization({ expiresAt: '' }),
    },
    {
      why: 'the record carries an unparseable expiry',
      standing: standingAuthorization({ expiresAt: 'whenever' }),
    },
    {
      why: 'the record is pending rather than approved',
      standing: standingAuthorization({ status: 'not-approved', effective: false }),
    },
    {
      why: 'the compiled status is one this build does not recognise',
      standing: standingAuthorization({ status: 'probably-fine' }),
    },
    {
      why: 'status says active but effective says false',
      standing: standingAuthorization({ effective: false }),
    },
    {
      why: 'a BARE REF from a stale pre-W0-N4 artefact, which resolves to nothing checkable',
      standing: '2026-08-27-p2p-function-standing',
    },
    { why: 'a blank bare ref', standing: '   ' },
  ];

  for (const { why, standing } of cases) {
    it(`forces the per-call approval when ${why}`, async () => {
      expect(await forcedApprovalFor(standing)).toBe(true);
    });
  }

  it('a malformed block — an object with no readable ref — forces approval, it does not throw', async () => {
    const malformed = {
      status: 'active',
      effective: true,
    } as unknown as CompiledStandingAuthorization;
    expect(await forcedApprovalFor(malformed)).toBe(true);
  });

  it('an array masquerading as a block forces approval', async () => {
    const nonsense = [
      { ref: 'x', status: 'active', effective: true },
    ] as unknown as CompiledStandingAuthorization;
    expect(await forcedApprovalFor(nonsense)).toBe(true);
  });

  it('a null block forces approval', async () => {
    expect(await forcedApprovalFor(null as unknown as CompiledStandingAuthorization)).toBe(true);
  });

  it('an unreadable call clock forces approval rather than standing one down', () => {
    const grant = functionGrant({ standingAuthorization: standingAuthorization() });
    expect(standingAuthorizationInForce(grant, new Date('not a date')).inForce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. IT CANNOT REVIVE A DEAD GRANT — the ordering escalation
// ---------------------------------------------------------------------------

describe('W0-N4 clause 5 — a standing authorization is not a grant', () => {
  it('a perfect standing authorization on an EXPIRED grant still refuses at 6e′', async () => {
    // The escalation: hang a flawless standing authorization off a dead grant
    // and hope the approval question is asked before the grant question. It is
    // not — the grant check runs first and the call never reaches the approval
    // question at all.
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWith(standingAuthorization(), { expiresAt: '2020-01-01', expired: true }),
        now: NOW,
      }),
    );
    expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
  });

  it('a perfect standing authorization on a grant with NO approver still refuses at 6e′', async () => {
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles: rolesWith(standingAuthorization(), { approver: '' }), now: NOW }),
    );
    expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
  });

  it('a standing authorization never widens SCOPE — a role the caller does not hold grants nothing', async () => {
    const roles = new Map(defaultRoles());
    roles.set(
      'treasury',
      role({
        roleId: 'treasury',
        bindingGrants: [functionGrant({ standingAuthorization: standingAuthorization() })],
      }),
    );
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles, heldRoleIds: ['p2p', 'o2c'], now: NOW }),
    );
    expectFailsClosed(decision, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
  });
});
