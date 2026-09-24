// MCPForge — W0-N3: the elevated-posture rule set, adversarially.
// 02 §11.4 (posture table, §11.4.6, §11.4.7) and 05 §3.3.
//
// W0-E3 landed stage 6e′ and its grant requirement, and
// `escalation.elevated-binding.test.ts` proves the grant check itself fails
// closed. This file proves the REST of the rule set, and it is written as an
// escalation suite rather than a feature suite: every case below is an attempt
// to reach an elevated write with something less than 02 §11.4 requires, and
// each one must be refused or narrowed rather than admitted.
//
// The five clauses of W0-N3's `done:`, one describe block each:
//
//   1. the posture classification itself — `plsql`, `function`,
//      write-classified `wrapped-vendor` and any `policyException` tool are
//      elevated; `rest`, read-only `database` and read-only `wrapped-vendor`
//      stay default-allow within scope;
//   2. no grant -> `ELEVATED_GRANT_REQUIRED` through BOTH entry points;
//   3. an elevated write with no `standingAuthorization` forces
//      `humanApprovalRequired: true` regardless of the tool's own setting;
//   4. `humanInTheLoop: false` refuses an elevated write outright;
//   5. `database` read-only-by-policy is UNTOUCHED — `write: true` +
//      `binding.type: database` still fails `forge validate`.
//
// The write gate here is a RECORDING SPY on the real seam: stage 6g is what
// consumes the forced flag, so the only honest way to assert "forced" is to
// read the entry 6g actually handed the gate. A test that re-read
// `authorizeBinding`'s return value would prove the function, not the chain.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRepo } from '@mcpforge/codegen/validate';
import {
  callThroughToolsCall,
  invokeThroughForgeInvoke,
} from '../../core/gateway/policy/entry-points.js';
import {
  call,
  consumer,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  standingAuthorization,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import { bindingPosture } from '../../core/gateway/policy/binding-auth/posture.js';
import type {
  CompiledBindingGrant,
  PolicyCatalogueEntry,
  PolicyContext,
  PolicyRoleView,
  WriteGate,
} from '../../core/gateway/policy/types.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

/** `jde.ap.voucher.create` — a `function` binding and a write: elevated posture. */
const ELEVATED_WRITE = TOOLS.voucherCreate;

/**
 * A live `function` grant with NO `standingAuthorization` — the shared fixture
 * carries one by default (see `policy.fixtures.ts`), and this suite is the one
 * that must be able to take it away, because "no standing authorization forces
 * approval" is the clause under test.
 */
function grantWithoutStanding(
  overrides: Partial<CompiledBindingGrant> = {},
): CompiledBindingGrant {
  const grant: Record<string, unknown> = { ...functionGrant(overrides) };
  delete grant['standingAuthorization'];
  return grant as unknown as CompiledBindingGrant;
}

/**
 * The default roles with a `function` grant on p2p, optionally standing-authorized.
 *
 * [W0-N4] The ref is wrapped into the RESOLVED block codegen now compiles — a
 * bare ref no longer stands anything down, so a helper that still passed one
 * would be asserting a contract this build deliberately dropped.
 */
function rolesWithGrant(ref?: string): ReadonlyMap<string, PolicyRoleView> {
  const roles = new Map(defaultRoles());
  const grant =
    ref === undefined
      ? grantWithoutStanding()
      : functionGrant({ standingAuthorization: standingAuthorization({ ref }) });
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [grant] }));
  return roles;
}

/**
 * A write gate that records the entry stage 6g handed it and then says
 * `not-a-write`, so the chain runs to completion and the assertion is about
 * what 6g SAW rather than about what it decided.
 */
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

// --- 1. the posture classification -----------------------------------------

describe('W0-N3 clause 1 — which bindings are elevated posture (02 §11.4)', () => {
  function fake(overrides: Partial<PolicyCatalogueEntry>): PolicyCatalogueEntry {
    return { ...entry(ELEVATED_WRITE), ...overrides };
  }

  it('plsql and function are elevated, read or write', () => {
    for (const bindingType of ['plsql', 'function'] as const) {
      for (const write of [true, false]) {
        expect(bindingPosture(fake({ bindingType, write })).posture).toBe('elevated');
      }
    }
  });

  it('wrapped-vendor is elevated when write-classified and standard when read-only', () => {
    expect(bindingPosture(fake({ bindingType: 'wrapped-vendor', write: true })).posture).toBe(
      'elevated',
    );
    expect(bindingPosture(fake({ bindingType: 'wrapped-vendor', write: false })).posture).toBe(
      'standard',
    );
  });

  it('a policyException makes ANY binding type elevated (02 §11.4.7)', () => {
    for (const bindingType of ['rest', 'database', 'wrapped-vendor'] as const) {
      const verdict = bindingPosture(
        fake({ bindingType, write: false, policyException: 'APP-2026-014' }),
      );
      expect(verdict.posture).toBe('elevated');
      expect(verdict.reason).toContain('APP-2026-014');
    }
  });

  it('rest, read-only database and read-only wrapped-vendor stay standard', () => {
    expect(bindingPosture(fake({ bindingType: 'rest', write: true })).posture).toBe('standard');
    expect(bindingPosture(fake({ bindingType: 'database', write: false })).posture).toBe(
      'standard',
    );
    expect(bindingPosture(fake({ bindingType: 'wrapped-vendor', write: false })).posture).toBe(
      'standard',
    );
  });

  it('an unrecognised binding type is elevated, never default-allow', () => {
    expect(
      bindingPosture(fake({ bindingType: 'grpc-someday' as never, write: false })).posture,
    ).toBe('elevated');
  });

  it('a standard-posture call is NOT given a forced approval by 6e′', async () => {
    // `jde.ap.voucher.search` — a rest read. It holds no bindingGrant of any
    // kind, and it must still proceed: standard posture is default-allow within
    // scope, and this stage must not have quietly become a universal gate.
    const { gate, seen } = recordingWriteGate();
    const decision = await callThroughToolsCall(
      call(TOOLS.voucherSearch, {}),
      context({ runtime: { writeGate: gate } }),
    );
    expectProceeds(decision);
    expect(seen[0]?.humanApprovalRequired).not.toBe(true);
  });
});

// --- 2. no grant, both entry points ----------------------------------------

describe('W0-N3 clause 2 — a role holding an elevated tool in scope with NO grant', () => {
  // Scope membership is proved by the baseline at the end of this block: the
  // same call with a grant proceeds, so the refusals below are the missing
  // grant and nothing else (CLAUDE.md #7 — scope is visibility, not permission).
  const ctx = (): PolicyContext => context({ runtime: { writeGate: recordingWriteGate().gate } });

  it('tools/call refuses with ELEVATED_GRANT_REQUIRED at 6e′', async () => {
    const refused = expectFailsClosed(
      await callThroughToolsCall(call(ELEVATED_WRITE, { amount: 100 }), ctx()),
      { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' },
    );
    expect(refused.error.next).toMatch(/bindingGrant/);
  });

  it('forge.invoke refuses identically — the identical chain, not a parallel one', async () => {
    const viaCall = await callThroughToolsCall(call(ELEVATED_WRITE, { amount: 100 }), ctx());
    const viaInvoke = await invokeThroughForgeInvoke(call(ELEVATED_WRITE, { amount: 100 }), ctx());

    const a = expectFailsClosed(viaCall, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
    const b = expectFailsClosed(viaInvoke, { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' });
    expect(b.error.code).toBe(a.error.code);
    expect(b.error.next).toBe(a.error.next);
    expect(b.stagesRun).toEqual(a.stagesRun);
  });

  it('a grant on a role the caller does NOT hold never covers the call, either way', async () => {
    // The grant exists — on r2r, which this caller does not hold.
    const roles = new Map(defaultRoles());
    roles.set('r2r', role({ roleId: 'r2r', bindingGrants: [grantWithoutStanding()] }));
    const ctxNotHeld = context({ roles, runtime: { writeGate: recordingWriteGate().gate } });

    expectFailsClosed(
      await callThroughToolsCall(call(ELEVATED_WRITE, { amount: 100 }), ctxNotHeld),
      { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' },
    );
    expectFailsClosed(
      await invokeThroughForgeInvoke(call(ELEVATED_WRITE, { amount: 100 }), ctxNotHeld),
      { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' },
    );
  });

  it('an EXPIRED grant fails closed rather than open, through both entry points', async () => {
    const roles = new Map(defaultRoles());
    roles.set(
      'p2p',
      role({ roleId: 'p2p', bindingGrants: [grantWithoutStanding({ expiresAt: '2020-01-01' })] }),
    );
    const expiredCtx = context({ roles, runtime: { writeGate: recordingWriteGate().gate } });

    for (const enter of [callThroughToolsCall, invokeThroughForgeInvoke]) {
      const refused = expectFailsClosed(
        await enter(call(ELEVATED_WRITE, { amount: 100 }), expiredCtx),
        { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' },
      );
      expect(refused.error.message).toMatch(/expired/i);
    }
  });

  it('BASELINE — the same call with a live held grant proceeds', async () => {
    expectProceeds(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, { amount: 100 }),
        context({ roles: rolesWithGrant(), runtime: { writeGate: recordingWriteGate().gate } }),
      ),
    );
  });
});

// --- 3. forced humanApprovalRequired ---------------------------------------

describe('W0-N3 clause 3 — an elevated write with no standingAuthorization', () => {
  it('forces humanApprovalRequired: true even though the tool declares false', async () => {
    // The tool's own setting, from the fixture catalogue, is explicitly false.
    expect(entry(ELEVATED_WRITE).humanApprovalRequired).toBe(false);

    const { gate, seen } = recordingWriteGate();
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles: rolesWithGrant(), runtime: { writeGate: gate } }),
    );

    expectProceeds(decision);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });

  it('forces it identically through forge.invoke', async () => {
    const { gate, seen } = recordingWriteGate();
    await invokeThroughForgeInvoke(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles: rolesWithGrant(), runtime: { writeGate: gate } }),
    );
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });

  it('a standingAuthorization on the grant restores the tool\'s own setting', async () => {
    const { gate, seen } = recordingWriteGate();
    const decision = await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        roles: rolesWithGrant('2026-08-27-p2p-function-standing'),
        runtime: { writeGate: gate },
      }),
    );
    expectProceeds(decision);
    expect(seen[0]?.humanApprovalRequired).toBe(false);
  });

  it('a BLANK standingAuthorization is not one — it still forces approval', async () => {
    const { gate, seen } = recordingWriteGate();
    await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ roles: rolesWithGrant('   '), runtime: { writeGate: gate } }),
    );
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });

  it('a standingAuthorization on an EXPIRED grant authorizes nothing at all', async () => {
    // The escalation: hang a standing authorization off a dead grant and hope
    // the approval rule is consulted before the grant rule. It is not — the
    // call never reaches the approval question.
    const roles = new Map(defaultRoles());
    roles.set(
      'p2p',
      role({
        roleId: 'p2p',
        bindingGrants: [
          functionGrant({
            expiresAt: '2020-01-01',
            standingAuthorization: standingAuthorization({ ref: 'ancient-standing' }),
          }),
        ],
      }),
    );
    const { gate, seen } = recordingWriteGate();
    expectFailsClosed(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, { amount: 100 }),
        context({ roles, runtime: { writeGate: gate } }),
      ),
      { code: 'ELEVATED_GRANT_REQUIRED', stage: '6e′' },
    );
    expect(seen).toHaveLength(0);
  });

  it('a standing authorization never LOWERS a tool that requires approval itself', async () => {
    const catalogue = [
      { ...entry(ELEVATED_WRITE), humanApprovalRequired: true },
      ...[...defaultCatalogueWithout(ELEVATED_WRITE)],
    ];
    const { gate, seen } = recordingWriteGate();
    await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({
        catalogue,
        roles: rolesWithGrant('2026-08-27-p2p-function-standing'),
        runtime: { writeGate: gate },
      }),
    );
    expect(seen[0]?.humanApprovalRequired).toBe(true);
  });

  it('a standard-posture WRITE is not forced — the rule is about elevated posture only', async () => {
    const catalogue = [
      { ...entry(ELEVATED_WRITE), bindingType: 'rest' as const },
      ...[...defaultCatalogueWithout(ELEVATED_WRITE)],
    ];
    const { gate, seen } = recordingWriteGate();
    await callThroughToolsCall(
      call(ELEVATED_WRITE, { amount: 100 }),
      context({ catalogue, runtime: { writeGate: gate } }),
    );
    expect(seen[0]?.humanApprovalRequired).toBe(false);
  });
});

// --- 4. humanInTheLoop: false ----------------------------------------------

describe('W0-N3 clause 4 — a consumer attesting humanInTheLoop: false', () => {
  const noHuman = () => consumer({ attestation: { humanInTheLoop: false } });

  it('is refused OUTRIGHT on an elevated write, through both entry points', async () => {
    for (const enter of [callThroughToolsCall, invokeThroughForgeInvoke]) {
      const { gate, seen } = recordingWriteGate();
      const refused = expectFailsClosed(
        await enter(
          call(ELEVATED_WRITE, { amount: 100 }),
          context({
            consumer: noHuman(),
            roles: rolesWithGrant(),
            runtime: { writeGate: gate },
          }),
        ),
        { code: 'CONSUMER_NOT_AUTHORIZED', stage: '6e′' },
      );
      // Refused OUTRIGHT means no plan and no approval hand-off: 6g never ran.
      expect(seen).toHaveLength(0);
      expect(refused.error.next).toMatch(/human/i);
    }
  });

  it('is refused even WITH a standingAuthorization — it is not a substitute for a human', async () => {
    const { gate, seen } = recordingWriteGate();
    expectFailsClosed(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, { amount: 100 }),
        context({
          consumer: noHuman(),
          roles: rolesWithGrant('2026-08-27-p2p-function-standing'),
          runtime: { writeGate: gate },
        }),
      ),
      { code: 'CONSUMER_NOT_AUTHORIZED', stage: '6e′' },
    );
    expect(seen).toHaveLength(0);
  });

  it('does NOT refuse an elevated READ — the rule is about writes', async () => {
    const catalogue = [
      { ...entry(ELEVATED_WRITE), write: false },
      ...[...defaultCatalogueWithout(ELEVATED_WRITE)],
    ];
    expectProceeds(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, {}),
        context({
          catalogue,
          consumer: noHuman(),
          roles: rolesWithGrant(),
          runtime: { writeGate: recordingWriteGate().gate },
        }),
      ),
    );
  });

  it('does NOT refuse a standard-posture write', async () => {
    const catalogue = [
      { ...entry(ELEVATED_WRITE), bindingType: 'rest' as const },
      ...[...defaultCatalogueWithout(ELEVATED_WRITE)],
    ];
    expectProceeds(
      await callThroughToolsCall(
        call(ELEVATED_WRITE, { amount: 100 }),
        context({
          catalogue,
          consumer: noHuman(),
          runtime: { writeGate: recordingWriteGate().gate },
        }),
      ),
    );
  });
});

// --- 5. `database` read-only by policy is untouched -------------------------

describe('W0-N3 clause 5 — the read-only rule sits ALONGSIDE the elevated posture', () => {
  // 02 §11.4.7: "The elevated-grant concept sits alongside the read-only rule.
  // It does not subsume it." The rule is validate-time and structural (W0-B3);
  // this is the regression that proves W0-N3 did not weaken it while adding a
  // runtime authorization stage next to it.
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = join(
    here,
    '..',
    '..',
    'core',
    'codegen',
    'src',
    'rules',
    'fixtures',
    'broken',
    'database-write',
  );

  it('write: true + binding.type: database still FAILS forge validate', () => {
    const failures = validateRepo(fixture).failures.filter(
      (f) => f.ruleId === 'policy.database-write',
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.message).toMatch(/read-only by policy/);
  });

  it('and is NOT downgraded to "elevated posture, needs a grant" at runtime either', () => {
    // A `database` entry that reached the gateway with `write: true` — which
    // validate rejects — is treated as ELEVATED, never as standard. Both
    // controls refuse it; neither defers to the other.
    const verdict = bindingPosture({ ...entry(ELEVATED_WRITE), bindingType: 'database' });
    expect(verdict.posture).toBe('elevated');
  });
});

/** Every fixture catalogue entry except the named one. */
function defaultCatalogueWithout(toolId: string): readonly PolicyCatalogueEntry[] {
  return context().catalogue.filter((e) => e.toolId !== toolId);
}
