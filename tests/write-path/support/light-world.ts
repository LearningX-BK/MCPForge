// MCPForge — W0-F7. The store-free world shared by criteria (b) and (c).
// Both refusals happen INSIDE the policy chain, before any dispatch is
// attempted, so nothing here opens the SQLite store — same posture as
// `core/gateway/policy/confirm/confirm.test.ts` and
// `core/gateway/policy/guardrails/guardrails.test.ts`, whose exact wiring
// this reuses rather than re-deriving.

import type { Guardrail } from '@mcpforge/shared';
import { runPolicyChain } from '../../../core/gateway/policy/chain.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../../../core/gateway/policy/policy.fixtures.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../../../core/gateway/policy/types.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from '../../../core/gateway/policy/confirm/gate.js';
import { generateConfirmSigningKey, singleKeyKeyring } from '../../../core/gateway/policy/confirm/token.js';
import { guardrailEvaluator } from '../../../core/gateway/policy/guardrails/gate.js';
import type { GuardrailDeps } from '../../../core/gateway/policy/guardrails/types.js';

export { TOOLS, runPolicyChain };

export const NOW = new Date('2026-09-04T09:00:00.000Z');
export const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-f7-light'));

export const BUSINESS_ARGS = {
  supplier_number: 4242,
  amount: 18_400,
  currency: 'GBP',
  company: '00100',
} as const;

export const VOUCHER_CREATE: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} for {amount} {currency}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: { class: 'compensating-tool', tool: TOOLS.voucherCancel, windowHours: 720 },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

export const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

export function policyCall(args: Record<string, unknown>): PolicyCall {
  return { ...call(TOOLS.voucherCreate, args), entryPoint: 'tools/call' as const };
}

/** Context for criterion (b): plain p2p, real confirm gate, no guardrails. */
export function confirmCtx(): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({
    heldRoleIds: ['p2p'],
    roles,
    runtime: {
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => (toolId === VOUCHER_CREATE.toolId ? VOUCHER_CREATE : undefined),
        dryRun: DRY_RUN,
        keyring: KEYRING,
        now: () => NOW,
      }),
    },
  });
}

/** Context for criterion (c): the same catalogue entry, carrying declared guardrails. */
export function guardrailCtx(guardrails: readonly Guardrail[], deps: GuardrailDeps = {}): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  const base = entry(TOOLS.voucherCreate);
  const catalogue: readonly PolicyCatalogueEntry[] = [{ ...base, guardrails }];
  return context({
    heldRoleIds: ['p2p'],
    roles,
    catalogue,
    runtime: {
      guardrails: guardrailEvaluator({ now: () => NOW, ...deps }),
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => (toolId === VOUCHER_CREATE.toolId ? VOUCHER_CREATE : undefined),
        dryRun: DRY_RUN,
        keyring: KEYRING,
        now: () => NOW,
        nonce: () => 'nonce-f7-guardrail',
      }),
    },
  });
}
