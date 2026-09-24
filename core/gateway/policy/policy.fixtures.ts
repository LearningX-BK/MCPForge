// MCPForge — fixtures for the W0-E3 policy-chain suites.
//
// Built ON TOP of W0-E2's scope fixtures rather than beside them: the chain's
// first three stages re-run the same resolver over the same shapes, and a
// second, subtly different catalogue would let a chain test pass against a world
// scope resolution never sees.

import {
  CATALOGUE,
  TOOLS,
  context as scopeContext,
  consumer as scopeConsumer,
  type ContextOverrides,
} from '../scope/scope.fixtures.js';
import type { ResultKeySpec, ReversalContract } from '../reversal/types.js';
import type {
  CompiledBindingGrant,
  CompiledStandingAuthorization,
  IdempotencyGate,
  PolicyCatalogueEntry,
  PolicyContext,
  PolicyRoleView,
  PolicyRuntime,
  WriteGate,
} from './types.js';

export { TOOLS, scopeConsumer as consumer };

/** `binding.ref` per tool — the allowlisted target name (02 §2.2). */
const BINDING_REFS: Readonly<Record<string, string>> = {
  [TOOLS.voucherCreate]: 'ORCH_AP_VOUCHER_CREATE',
  [TOOLS.journalCreate]: 'ORCH_GL_JOURNAL_CREATE',
};

/**
 * `writeSafety.reversal` per write tool (W0-F5, 02 §3.1.4). `voucher.create`
 * carries the canonical `compensating-tool` contract 02 §3.1.4 names by
 * example: it is reversed by `voucher.cancel`, whose arguments are filled from
 * the business keys the CREATE actually recorded.
 */
const REVERSALS: Readonly<Record<string, ReversalContract>> = {
  [TOOLS.voucherCreate]: {
    class: 'compensating-tool',
    tool: TOOLS.voucherCancel,
    argMap: {
      document_number: '$.result.document_number',
      document_company: '$.result.document_company',
    },
    windowHours: 720,
  },
  // The reversal is itself a write, so it too declares one. `native-reverse`:
  // the cancellation is JDE's own first-class undo of the voucher.
  [TOOLS.voucherCancel]: { class: 'native-reverse' },
};

/** `output.resultKeys` per tool — the business keys that ARE the handle (02 §2.2). */
const RESULT_KEYS: Readonly<Record<string, readonly ResultKeySpec[]>> = {
  [TOOLS.voucherCreate]: [
    { name: 'document_number', path: '$.voucher.docNumber' },
    { name: 'document_type', path: '$.voucher.docType' },
    { name: 'document_company', path: '$.voucher.docCo' },
  ],
  [TOOLS.voucherCancel]: [{ name: 'document_number', path: '$.voucher.docNumber' }],
};

export const POLICY_CATALOGUE: readonly PolicyCatalogueEntry[] = CATALOGUE.map((entry) => ({
  ...entry,
  toolVersion: '1.0.0',
  bindingRef: BINDING_REFS[entry.toolId] ?? `REF_${entry.toolId}`,
  policyException: null,
  humanApprovalRequired: false,
  ...(REVERSALS[entry.toolId] === undefined ? {} : { reversal: REVERSALS[entry.toolId] }),
  ...(RESULT_KEYS[entry.toolId] === undefined ? {} : { resultKeys: RESULT_KEYS[entry.toolId] }),
}));

export function entry(toolId: string): PolicyCatalogueEntry {
  const found = POLICY_CATALOGUE.find((e) => e.toolId === toolId);
  if (found === undefined) throw new Error(`no fixture catalogue entry for ${toolId}`);
  return found;
}

/**
 * A live `function` grant on p2p, shaped exactly as codegen's `compileGrant`
 * writes it.
 *
 * **It carries a `standingAuthorization`, and that is the Wave 0 default rather
 * than a convenience (W0-N3, 02 §11.4.4).** Every Wave 0 binding is `function`,
 * so under the elevated posture every Wave 0 write would otherwise force a
 * per-call human approval — "a parade of approval dialogs", which §11.4.4 adds
 * `standingAuthorization` precisely to avoid. A fixture without one would make
 * every write-path suite exercise the approval queue instead of the thing it
 * was written to test.
 *
 * A suite testing the FORCING itself passes
 * `functionGrant({ standingAuthorization: undefined })` and gets the ungranted
 * behaviour back. See `tests/policy/escalation.elevated-posture.test.ts`.
 */
export function functionGrant(overrides: Partial<CompiledBindingGrant> = {}): CompiledBindingGrant {
  return {
    bindingType: 'function',
    names: ['ORCH_AP_VOUCHER_CREATE'],
    approvalRef: '2026-08-27-p2p-function',
    approver: 'a.steward@ltm.example',
    expiresAt: '2027-02-23',
    expired: false,
    // [W0-N4] The RESOLVED block codegen writes, not the bare ref it is
    // authored as. A bare ref no longer stands anything down.
    standingAuthorization: standingAuthorization(),
    ...overrides,
  };
}

/**
 * [W0-N4] A RESOLVED standing-authorization block, shaped exactly as codegen's
 * `compile/standing.ts` writes it into the compiled scope artefact. A suite
 * that wants an unresolvable, unapproved, unnamed or expired one overrides the
 * relevant field — that is the whole adversarial surface, and it is one object.
 */
export function standingAuthorization(
  overrides: Partial<CompiledStandingAuthorization> = {},
): CompiledStandingAuthorization {
  return {
    ref: '2026-08-27-p2p-function-standing',
    status: 'active',
    approver: 'a.approver@ltm.example',
    expiresAt: '2027-02-23',
    effective: true,
    ...overrides,
  };
}

export function role(overrides: Partial<PolicyRoleView> & { roleId: string }): PolicyRoleView {
  return {
    sensitivityCeiling: 'financial',
    writeAllowed: true,
    bindingGrants: [],
    ...overrides,
  };
}

export const ALLOW_RATE = { check: () => ({ allowed: true as const }) };
export const VALID_ARGS = { validate: () => ({ valid: true as const }) };
export const NO_GUARDRAIL_BREACH = { evaluate: () => ({ breached: false as const }) };
export const NOT_A_WRITE: WriteGate = { evaluate: () => ({ kind: 'not-a-write' as const }) };
export const NO_REPLAY: IdempotencyGate = { lookup: () => ({ kind: 'proceed' as const }) };

export function runtime(overrides: Partial<PolicyRuntime> = {}): PolicyRuntime {
  return {
    rateLimiter: ALLOW_RATE,
    argumentValidator: VALID_ARGS,
    guardrails: NO_GUARDRAIL_BREACH,
    writeGate: NOT_A_WRITE,
    idempotency: NO_REPLAY,
    ...overrides,
  };
}

export interface PolicyContextOverrides extends ContextOverrides {
  readonly roles?: ReadonlyMap<string, PolicyRoleView>;
  readonly consumerBindingGrants?: readonly CompiledBindingGrant[];
  readonly runtime?: Partial<PolicyRuntime>;
  readonly catalogue?: readonly PolicyCatalogueEntry[];
}

/** The default roles: p2p and o2c, both financial-ceiling, write-enabled, no grants. */
export function defaultRoles(): ReadonlyMap<string, PolicyRoleView> {
  return new Map<string, PolicyRoleView>([
    ['p2p', role({ roleId: 'p2p' })],
    ['o2c', role({ roleId: 'o2c' })],
    ['r2r', role({ roleId: 'r2r' })],
  ]);
}

export function context(overrides: PolicyContextOverrides = {}): PolicyContext {
  return {
    scope: scopeContext(overrides),
    catalogue: overrides.catalogue ?? POLICY_CATALOGUE,
    roles: overrides.roles ?? defaultRoles(),
    consumerBindingGrants: overrides.consumerBindingGrants ?? [],
    runtime: runtime(overrides.runtime ?? {}),
  };
}

/** A call shape for the entry-point helpers. */
export function call(toolId: string, args: Record<string, unknown> = {}) {
  return { toolId, args, correlationId: 'req_test_0001' };
}
