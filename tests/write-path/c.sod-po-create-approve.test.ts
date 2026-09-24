// MCPForge — W0-I5, the CALL-TIME half of the segregation-of-duties
// demonstration, and the W0-F7(c) policy-refusal demonstration applied to the
// pair the SoD mechanism was designed around: `create` and `approve` on ONE
// entity (02 §3.1.3, §4.3).
//
// WHY THIS IS A SECOND TEST AND NOT A DUPLICATE OF `c.policy-refusal.test.ts`.
// That file proves the guardrail engine refuses a hand-built `sodConflict`
// declaration. This one proves the refusal for the guardrail
// `manifests/jde/scm/po/purchase_order.approve.tool.yaml` ACTUALLY DECLARES —
// it reads the declaration out of the generated artefact rather than restating
// it — so a manifest that quietly lost its `sodConflict` entry would fail here
// even though the engine still worked.
//
// WHY IT IS A SEPARATE TEST FROM THE ROLE-COMPILE ONE
// (`core/codegen/src/compile/sod.repo.test.ts`). 02 §4.3: "the role check
// catches design-time mistakes, the call check catches a caller who
// legitimately holds two roles that are individually fine." The second case is
// structurally invisible to codegen — no single role is wrong — so a build that
// only ran the design-time check would ship an SoD control with a hole in it.
//
// The world here is built locally rather than from `support/light-world.ts`
// because the shared scope fixtures' catalogue and compiled role scopes do not
// carry `jde.scm.purchase_order.approve`, and widening a fixture set that eight
// other suites assert against is not this task's to do.

import { describe, expect, it } from 'vitest';
import type { Guardrail } from '@mcpforge/shared';
import { runPolicyChain } from '../../core/gateway/policy/chain.js';
import {
  call,
  functionGrant,
  role,
  runtime,
} from '../../core/gateway/policy/policy.fixtures.js';
import type {
  PolicyCall,
  PolicyCatalogueEntry,
  PolicyContext,
  PolicyRoleView,
} from '../../core/gateway/policy/types.js';
import { guardrailEvaluator } from '../../core/gateway/policy/guardrails/gate.js';
import { consumer, consumerSession, principal } from '../../core/gateway/scope/scope.fixtures.js';
import { inMemoryRuntimeFlags, staticProbeStatuses } from '../../core/gateway/scope/sources.js';
import type { ProbeStatus, ToolId } from '../../core/gateway/scope/types.js';
import { toolRegistration as approveTool } from '../../generated/tools/jde.scm.purchase_order.approve/tool.js';
import { withEvidence } from './support/evidence.js';

const PO_CREATE = 'jde.scm.purchase_order.create';
const PO_APPROVE = 'jde.scm.purchase_order.approve';

const NOW = new Date('2026-09-07T09:00:00.000Z');

/** The guardrails the MANIFEST declares, read from what codegen emitted. */
const DECLARED_GUARDRAILS = approveTool.writeSafety.guardrails as readonly Guardrail[];

function entry(toolId: string, guardrails: readonly Guardrail[]): PolicyCatalogueEntry {
  return {
    toolId,
    serverId: 'jde-scm-po',
    bindingType: 'function',
    sensitivity: 'financial',
    write: true,
    toolVersion: '1.0.0',
    bindingRef: toolId === PO_APPROVE ? 'PO_APPROVE' : 'PO_CREATE',
    policyException: null,
    humanApprovalRequired: false,
    guardrails,
  };
}

/**
 * A caller holding `buyer` (which grants create) and `approver` (which grants
 * approve). Neither role is badly designed on its own — this is exactly the
 * case 02 §4.3 says the design-time check cannot see.
 */
function twoRoleContext(options: {
  readonly heldRoleIds: readonly string[];
  readonly guardrails: readonly Guardrail[];
}): PolicyContext {
  const roleScopes = new Map<string, ReadonlySet<ToolId>>([
    ['buyer', new Set<ToolId>([PO_CREATE])],
    ['approver', new Set<ToolId>([PO_APPROVE])],
  ]);
  const allTools: readonly ToolId[] = [PO_CREATE, PO_APPROVE];
  const roles = new Map<string, PolicyRoleView>([
    ['buyer', role({ roleId: 'buyer', bindingGrants: [functionGrant({ names: ['PO_CREATE'] })] })],
    [
      'approver',
      role({ roleId: 'approver', bindingGrants: [functionGrant({ names: ['PO_APPROVE'] })] }),
    ],
  ]);

  return {
    scope: {
      deployment: { deploymentId: 'ltm-dev', packageIds: ['jde-scm'] },
      packageSelections: new Map([['jde-scm', new Set<ToolId>(allTools)]]),
      roleScopes,
      session: {
        principal: principal(),
        heldRoleIds: [...options.heldRoleIds],
        consumer: consumer({
          authorizations: { roles: ['buyer', 'approver'], packages: ['jde-scm'] },
        }),
        consumerSession: consumerSession(),
        activation: { mode: 'default' },
      },
      probe: staticProbeStatuses(new Map(allTools.map((id) => [id, 'resolved' as ProbeStatus]))),
      flags: inMemoryRuntimeFlags([]),
      now: NOW,
    },
    catalogue: [entry(PO_CREATE, []), entry(PO_APPROVE, options.guardrails)],
    roles,
    consumerBindingGrants: [],
    runtime: runtime({ guardrails: guardrailEvaluator({ now: () => NOW }) }),
  };
}

function approveCall(): PolicyCall {
  return {
    ...call(PO_APPROVE, { po_number: '0000451', company: '00100' }),
    entryPoint: 'tools/call' as const,
  };
}

describe('W0-I5 — the manifest declares the create/approve sodConflict', () => {
  it('purchase_order.approve names purchase_order.create on the sameEntityChain', () => {
    const sod = DECLARED_GUARDRAILS.filter((g) => g.kind === 'sodConflict');
    expect(sod).toHaveLength(1);
    expect(sod[0]!.with).toBe(PO_CREATE);
    expect(sod[0]!.scope).toBe('sameEntityChain');
  });
});

describe('W0-I5 / W0-F7(c) — refused at call time when one caller holds both halves', () => {
  it('refuses purchase_order.approve for a caller whose roles also grant purchase_order.create', async () => {
    await withEvidence(
      'c',
      '(c) A correct refusal at policy — a write was refused for breaching a declared business guardrail (amount ceiling, or an SoD conflict between create and approve on the same entity).',
      'refuses purchase_order.approve for a caller whose roles also grant purchase_order.create',
      async () => {
        const ctx = twoRoleContext({
          heldRoleIds: ['buyer', 'approver'],
          guardrails: DECLARED_GUARDRAILS,
        });

        const decision = await runPolicyChain(approveCall(), ctx);

        expect(decision.outcome).toBe('refused');
        if (decision.outcome !== 'refused') throw new Error('unreachable');
        expect(decision.stage).toBe('6f');
        expect(decision.error.code).toBe('POLICY_GUARDRAIL_BREACH');
        expect(decision.error.message).toContain(PO_CREATE);
        // The refusal names the role the conflicting grant actually came from.
        expect(decision.error.message).toContain('buyer');
        // Non-negotiable #5: agent-actionable, and never "try again".
        expect(decision.error.next.length).toBeGreaterThan(0);
        expect(decision.error.next.toLowerCase()).not.toMatch(/try again/);
        // 6f sits before 6g: no plan token is ever minted for this call.
        expect(decision.stagesRun).not.toContain('6g');

        return {
          toolId: PO_APPROVE,
          conflictingToolId: PO_CREATE,
          guardrailKind: 'sodConflict',
          scope: 'sameEntityChain',
          guardrailSource:
            'read from generated/tools/jde.scm.purchase_order.approve/tool.ts — the guardrail the manifest declares, not a restatement',
          callerHeldRoles: ['buyer', 'approver'],
          conflictingGrantFromRole: 'buyer',
          refusalCode: decision.error.code,
          refusalStage: decision.stage,
          refusalMessage: decision.error.message,
          refusalNext: decision.error.next,
          stagesRun: decision.stagesRun,
        };
      },
    );
  });

  it('admits the same call for a caller who holds ONLY the approver role', async () => {
    // The control must refuse the conflicted caller and nobody else — a
    // guardrail that refuses everyone is not a segregation of duties.
    const ctx = twoRoleContext({
      heldRoleIds: ['approver'],
      guardrails: DECLARED_GUARDRAILS,
    });

    const decision = await runPolicyChain(approveCall(), ctx);

    expect(decision.outcome).not.toBe('refused');
    expect(decision.stagesRun).toContain('6f');
  });
});
