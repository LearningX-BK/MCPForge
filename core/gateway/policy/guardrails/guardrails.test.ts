// MCPForge — W0-F4's proofs. 02 §3.1.3, 02 §4.3.
//
// The four the `done:` clause names, plus the fail-closed cases the
// OPUS_GUARDED_PATHS review demands:
//
//   1. All five kinds are implemented and each one refuses through the REAL
//      policy chain at stage 6f — maxNumeric/minNumeric, allowedValues,
//      rateLimit, sodConflict, timeWindow.
//   2. A guardrail that PASSES at plan and would breach at execute is caught at
//      EXECUTE. The state genuinely changes in between: a second, concurrent
//      execute by the same human consumes the last slot of the rate-limit
//      window while the human is reading the plan.
//   3. `sodConflict` is evaluated against the caller's RESOLVED ROLE SCOPE, not
//      just the current call, and names the conflicting grant and the roles
//      that produced it.
//   4. Every breach is `POLICY_GUARDRAIL_BREACH` carrying the guardrail's own
//      `message` and a non-empty, actionable `next`.
//   5. Fail-closed: a malformed declaration, an unimplemented kind and an
//      unconfigured source all REFUSE.

import { describe, expect, it } from 'vitest';
import { GUARDRAIL_KINDS, type Guardrail } from '@mcpforge/shared';
import { runPolicyChain } from '../chain.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../policy.fixtures.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from '../confirm/gate.js';
import { generateConfirmSigningKey, singleKeyKeyring } from '../confirm/token.js';
import { guardrailEvaluator } from './gate.js';
import type { ExecuteCountSource, GuardrailDeps, TimeWindowSource } from './types.js';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-guardrail-test'));

const BUSINESS_ARGS = {
  supplier_number: 4242,
  amount: 18_400,
  currency: 'GBP',
  company: '00100',
} as const;

const VOUCHER_CREATE: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} for {amount} {currency}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: {
    class: 'compensating-tool',
    tool: TOOLS.voucherCancel,
    windowHours: 720,
    preconditions: 'Voucher must be unpaid.',
  },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

/** The catalogue, with the guardrails under test declared on `voucher.create`. */
function catalogueWith(guardrails: readonly Guardrail[]): readonly PolicyCatalogueEntry[] {
  const base = entry(TOOLS.voucherCreate);
  return [{ ...base, guardrails }];
}

function ctxFor(
  guardrails: readonly Guardrail[],
  deps: GuardrailDeps = {},
  overrides: { readonly heldRoleIds?: readonly string[] } = {},
): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({
    heldRoleIds: overrides.heldRoleIds ?? ['p2p'],
    roles,
    catalogue: catalogueWith(guardrails),
    runtime: {
      guardrails: guardrailEvaluator({ now: () => NOW, ...deps }),
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => (toolId === TOOLS.voucherCreate ? VOUCHER_CREATE : undefined),
        dryRun: DRY_RUN,
        keyring: KEYRING,
        now: () => NOW,
        nonce: () => 'nonce-guardrail-0001',
      }),
    },
  });
}

function policyCall(args: Record<string, unknown>): PolicyCall {
  return { ...call(TOOLS.voucherCreate, args), entryPoint: 'tools/call' as const };
}

/** Run one call and return the decision. */
function run(
  guardrails: readonly Guardrail[],
  args: Record<string, unknown>,
  deps?: GuardrailDeps,
) {
  return runPolicyChain(policyCall(args), ctxFor(guardrails, deps));
}

function expectBreach(decision: Awaited<ReturnType<typeof run>>) {
  expect(decision.outcome).toBe('refused');
  if (decision.outcome !== 'refused') throw new Error('unreachable');
  expect(decision.stage).toBe('6f');
  expect(decision.error.code).toBe('POLICY_GUARDRAIL_BREACH');
  expect(decision.error.next.length).toBeGreaterThan(0);
  expect(decision.error.next).not.toMatch(/try again/i);
  // 6f sits before 6g, so a breached guardrail never mints a plan token.
  expect(decision.stagesRun).not.toContain('6g');
  return decision;
}

// --- 1: the five kinds -----------------------------------------------------

describe('W0-F4 — all five guardrail kinds, through the real chain at stage 6f', () => {
  it("maxNumeric refuses above the ceiling with the guardrail's own message", async () => {
    const guardrail: Guardrail = {
      kind: 'maxNumeric',
      field: 'amount',
      value: 250_000,
      message: 'Voucher amount exceeds the MCPForge ceiling for this tool.',
    };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS, amount: 250_001 }));
    expect(decision.error.message).toBe(
      'Voucher amount exceeds the MCPForge ceiling for this tool.',
    );
  });

  it('maxNumeric admits a value exactly at the ceiling', async () => {
    const guardrail: Guardrail = { kind: 'maxNumeric', field: 'amount', value: 250_000 };
    const decision = await run([guardrail], { ...BUSINESS_ARGS, amount: 250_000 });
    // Not a breach: the plan is produced, which is 6g's answer, not 6f's.
    expect(decision.outcome).toBe('responded');
  });

  it('minNumeric refuses below the floor and names the limit and the actual value', async () => {
    const guardrail: Guardrail = { kind: 'minNumeric', field: 'amount', value: 100 };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS, amount: 5 }));
    expect(decision.error.message).toContain('5');
    expect(decision.error.message).toContain('100');
  });

  it('allowedValues refuses a company outside the permitted list', async () => {
    const guardrail: Guardrail = {
      kind: 'allowedValues',
      field: 'company',
      value: ['00100', '00200'],
    };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS, company: '00900' }));
    expect(decision.error.message).toContain('00900');
    expect(decision.error.next).toContain('00100');
  });

  it('allowedValues admits a permitted value', async () => {
    const guardrail: Guardrail = {
      kind: 'allowedValues',
      field: 'company',
      value: ['00100', '00200'],
    };
    const decision = await run([guardrail], { ...BUSINESS_ARGS });
    expect(decision.outcome).toBe('responded');
  });

  it('rateLimit refuses once the caller has spent the window', async () => {
    const guardrail: Guardrail = { kind: 'rateLimit', limit: 3, windowSeconds: 3600 };
    const executes: ExecuteCountSource = { countExecutes: () => 3 };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS }, { executes }));
    expect(decision.error.message).toContain('3');
  });

  it('rateLimit counts only this caller and this tool, inside the declared window', async () => {
    const guardrail: Guardrail = { kind: 'rateLimit', limit: 3, windowSeconds: 3600 };
    const seen: unknown[] = [];
    const executes: ExecuteCountSource = {
      countExecutes: (q) => {
        seen.push(q);
        return 0;
      },
    };
    await run([guardrail], { ...BUSINESS_ARGS }, { executes });
    expect(seen).toEqual([
      {
        toolId: TOOLS.voucherCreate,
        subject: 'u-0001',
        since: new Date(NOW.getTime() - 3_600_000),
        now: NOW,
      },
    ]);
  });

  it('timeWindow refuses outside the window, from the precondition read', async () => {
    const guardrail: Guardrail = { kind: 'timeWindow', ref: 'gl_open_period' };
    const timeWindows: TimeWindowSource = {
      isOpen: () => ({ open: false, detail: 'GL period 2026-08 for company 00100 is closed.' }),
    };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS }, { timeWindows }));
    expect(decision.error.message).toContain('GL period 2026-08');
    expect(decision.error.next).toContain('gl_open_period');
  });

  it('timeWindow admits an open window', async () => {
    const guardrail: Guardrail = { kind: 'timeWindow', ref: 'gl_open_period' };
    const timeWindows: TimeWindowSource = { isOpen: () => ({ open: true }) };
    const decision = await run([guardrail], { ...BUSINESS_ARGS }, { timeWindows });
    expect(decision.outcome).toBe('responded');
  });
});

// --- 2: passes at plan, breaches at execute --------------------------------
//
// The `done:` clause's central proof. The state that changes between the two
// calls is REAL: a second execute of the same tool by the same human — a
// concurrent agent turn, a colleague's session under the same subject — lands
// while the human is reading the plan, and takes the last slot of the window.
// Nothing is toggled; a counter is incremented by an event that genuinely
// happens in this system.

describe('W0-F4 — a guardrail that passes at plan and breaches at execute', () => {
  it('is caught at EXECUTE, at stage 6f, before 6g re-verifies the token', async () => {
    const guardrail: Guardrail = {
      kind: 'rateLimit',
      limit: 3,
      windowSeconds: 3600,
      message: 'This tool allows 3 vouchers per person per hour.',
    };

    // The caller's executes of this tool inside the window, as the audit trail
    // would report them. Two so far.
    const executed: Date[] = [
      new Date(NOW.getTime() - 1_800_000),
      new Date(NOW.getTime() - 600_000),
    ];
    const executes: ExecuteCountSource = {
      countExecutes: ({ since }) => executed.filter((t) => t >= since).length,
    };
    const ctx = ctxFor([guardrail], { executes });

    // PLAN. Two executes against a limit of three: 6f passes, and 6g mints the
    // token. The guardrail was evaluated — the plan proves it did not refuse.
    const plan = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctx);
    expect(plan.outcome).toBe('responded');
    if (plan.outcome !== 'responded') throw new Error('unreachable');
    expect(plan.stagesRun).toContain('6f');
    const token = String(plan.response['confirmToken']);
    expect(token.length).toBeGreaterThan(0);

    // BETWEEN THE TWO CALLS the same human executes this tool once more, from
    // another session. The window is now full.
    executed.push(new Date(NOW.getTime() - 1_000));

    // EXECUTE. Identical arguments, a valid unexpired token — 6g would happily
    // admit it. 6f runs FIRST and refuses, because it asks the world as it is
    // now rather than trusting what it answered at plan time.
    const execute = await runPolicyChain(policyCall({ ...BUSINESS_ARGS, confirm: token }), ctx);

    expect(execute.outcome).toBe('refused');
    if (execute.outcome !== 'refused') throw new Error('unreachable');
    expect(execute.stage).toBe('6f');
    expect(execute.error.code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(execute.error.message).toBe('This tool allows 3 vouchers per person per hour.');
    expect(execute.error.next.length).toBeGreaterThan(0);
    // The chain stopped at 6f: no token re-verification, no idempotency claim,
    // and nothing downstream of the chain ran.
    expect(execute.stagesRun).toEqual(['6a', '6a′', '6b', '6c', '6d', '6e', '6e′', '6f']);
    expect(execute.stagesRun).not.toContain('6g');
    expect(execute.stagesRun).not.toContain('6h');
  });

  it('evaluates guardrails on BOTH calls — the plan call runs 6f too', async () => {
    // The converse of the case above, and the reason it is not enough to test
    // execute alone: a guardrail that breached at plan must refuse the plan,
    // not mint a token the human is then asked to confirm.
    const guardrail: Guardrail = { kind: 'rateLimit', limit: 1, windowSeconds: 3600 };
    const executes: ExecuteCountSource = { countExecutes: () => 1 };
    const decision = expectBreach(await run([guardrail], { ...BUSINESS_ARGS }, { executes }));
    expect(decision.stagesRun).toContain('6f');
    expect(JSON.stringify(decision.error)).not.toContain('confirmToken');
  });
});

// --- 3: sodConflict against the resolved role scope ------------------------

describe("W0-F4 — sodConflict, against the caller's resolved role scope", () => {
  const SOD: Guardrail = {
    kind: 'sodConflict',
    with: TOOLS.poCreate,
    scope: 'sameEntityChain',
  };

  it('refuses and names the conflicting grant and the roles that produced it', async () => {
    // p2p's compiled scope grants BOTH jde.ap.voucher.create and
    // jde.scm.purchase_order.create, so this caller holds the conflicting grant.
    const decision = expectBreach(await run([SOD], { ...BUSINESS_ARGS }));
    expect(decision.error.message).toContain(TOOLS.poCreate);
    expect(decision.error.message).toContain('p2p');
    expect(decision.error.message).toContain('sameEntityChain');
    expect(decision.error.next).toContain(TOOLS.poCreate);
    expect(decision.error.next).toContain('p2p');
  });

  it("is a property of the ROLE SCOPE, not of the current call's arguments", async () => {
    // Nothing about these arguments mentions a purchase order. The breach comes
    // entirely from what the caller holds — which is the whole distinction
    // between this check and W0-B8's compile-time one.
    const decision = expectBreach(await run([SOD], { supplier_number: 1, amount: 1 }));
    expect(decision.error.message).toContain(TOOLS.poCreate);
  });

  it('admits a caller whose held roles do not grant the conflicting tool', async () => {
    const guardrail: Guardrail = {
      kind: 'sodConflict',
      with: TOOLS.salesOrderCreate,
      scope: 'sameEntityChain',
    };
    // The caller holds p2p only; jde.o2c.sales_order.create is granted by o2c.
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxFor([guardrail], {}, { heldRoleIds: ['p2p'] }),
    );
    expect(decision.outcome).toBe('responded');
  });

  it('refuses the same call once the caller also holds the conflicting role', async () => {
    const guardrail: Guardrail = { kind: 'sodConflict', with: TOOLS.salesOrderCreate };
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxFor([guardrail], {}, { heldRoleIds: ['p2p', 'o2c'] }),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(decision.error.message).toContain('o2c');
  });

  it('names the human subject, so the refusal is about who is calling', async () => {
    const decision = expectBreach(await run([SOD], { ...BUSINESS_ARGS }));
    expect(decision.error.message).toContain('u-0001');
  });
});

// --- 4 + 5: shape and fail-closed ------------------------------------------

describe('W0-F4 — fail-closed', () => {
  it('refuses a maxNumeric that names no field, rather than skipping it', async () => {
    const decision = expectBreach(await run([{ kind: 'maxNumeric', value: 10 }], BUSINESS_ARGS));
    expect(decision.error.message).toContain('names no field');
  });

  it('refuses a maxNumeric whose value is not a number', async () => {
    const guardrail: Guardrail = { kind: 'maxNumeric', field: 'amount', value: 'lots' };
    expectBreach(await run([guardrail], BUSINESS_ARGS));
  });

  it('refuses when the argument under a numeric ceiling is not a number', async () => {
    const guardrail: Guardrail = { kind: 'maxNumeric', field: 'amount', value: 10 };
    expectBreach(await run([guardrail], { ...BUSINESS_ARGS, amount: 'lots' }));
  });

  it('admits an ABSENT optional argument — 6d already ruled on required ones', async () => {
    const guardrail: Guardrail = { kind: 'maxNumeric', field: 'discount', value: 10 };
    const decision = await run([guardrail], { ...BUSINESS_ARGS });
    expect(decision.outcome).toBe('responded');
  });

  it('refuses a sodConflict that names no conflicting tool', async () => {
    const decision = expectBreach(await run([{ kind: 'sodConflict' }], BUSINESS_ARGS));
    expect(decision.error.message).toContain('names no conflicting tool');
  });

  it('refuses a declared rateLimit when the gateway has no execute counter', async () => {
    const guardrail: Guardrail = { kind: 'rateLimit', limit: 3, windowSeconds: 60 };
    const decision = expectBreach(await run([guardrail], BUSINESS_ARGS));
    expect(decision.error.message).toContain('execute counter');
  });

  it('refuses a declared timeWindow when the gateway has no time-window source', async () => {
    const guardrail: Guardrail = { kind: 'timeWindow', ref: 'gl_open_period' };
    const decision = expectBreach(await run([guardrail], BUSINESS_ARGS));
    expect(decision.error.message).toContain('time-window source');
  });

  // [W0-F8] `requiresField` is retired: it is no longer a `GuardrailKind` and no
  // longer a legal `kind` in tool.schema.json, so a manifest can no longer
  // declare it at all. What must still hold — and is what this test now asserts
  // — is the property its named case existed to provide: a kind this gateway has
  // no evaluator for FAILS CLOSED. A retired or future kind that reached the
  // runtime must refuse, never silently admit, because a guardrail that is
  // present in the manifest and does nothing is worse than no guardrail at all.
  it('fails closed on a guardrail kind this gateway has no evaluator for (incl. the retired requiresField)', async () => {
    const retired = { kind: 'requiresField', field: 'po_number' } as unknown as Guardrail;
    const decision = expectBreach(await run([retired], BUSINESS_ARGS));
    expect(decision.error.message).toContain('no evaluator for guardrail kind requiresField');
    expect(decision.error.next.length).toBeGreaterThan(0);
  });

  it('rejects `requiresField` as a declarable kind — it is not in GUARDRAIL_KINDS', () => {
    expect(GUARDRAIL_KINDS).not.toContain('requiresField');
    expect([...GUARDRAIL_KINDS].sort()).toEqual(
      [
        'allowedValues',
        'maxNumeric',
        'minNumeric',
        'rateLimit',
        'sodConflict',
        'timeWindow',
      ].sort(),
    );
  });

  it("a throwing source denies rather than admits (the chain's fail-closed rule)", async () => {
    const guardrail: Guardrail = { kind: 'timeWindow', ref: 'gl_open_period' };
    const timeWindows: TimeWindowSource = {
      isOpen: () => {
        throw new Error('target unreachable');
      },
    };
    const decision = await run([guardrail], BUSINESS_ARGS, { timeWindows });
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('INTERNAL');
  });

  it('evaluates in declaration order and returns the FIRST breach', async () => {
    const first: Guardrail = { kind: 'maxNumeric', field: 'amount', value: 1, message: 'FIRST' };
    const second: Guardrail = {
      kind: 'minNumeric',
      field: 'amount',
      value: 1e9,
      message: 'SECOND',
    };
    const decision = expectBreach(await run([first, second], BUSINESS_ARGS));
    expect(decision.error.message).toBe('FIRST');
  });

  it('a tool with no declared guardrails passes 6f untouched', async () => {
    const decision = await run([], BUSINESS_ARGS);
    expect(decision.outcome).toBe('responded');
  });

  it('ignores `confirm` when evaluating fields, exactly as the canonical hash does', async () => {
    // `confirm` is not a business argument. A guardrail on it would be
    // meaningless, and including it would make the engine and W0-F2's token
    // disagree about what "the arguments" are.
    const guardrail: Guardrail = { kind: 'allowedValues', field: 'confirm', value: ['x'] };
    const decision = await run([guardrail], { ...BUSINESS_ARGS });
    expect(decision.outcome).toBe('responded');
  });
});
