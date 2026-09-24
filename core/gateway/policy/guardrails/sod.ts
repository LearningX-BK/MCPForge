// MCPForge — the RUNTIME `sodConflict` guardrail. W0-F4, 02 §3.1.3, 02 §4.3.
//
// HOW THIS DIFFERS FROM W0-B8's `core/codegen/src/compile/sod.ts`, which is a
// different check with a different job and is deliberately not reused here:
//
//   compile time (W0-B8)          | call time (this file)
//   ------------------------------|--------------------------------------------
//   walks EVERY role in the repo  | walks the roles THIS CALLER holds
//   over the compiled scope file  | over `ctx.scope.roleScopes` at call time
//   answers "is this role badly   | answers "may THIS human execute THIS call,
//   designed?"                    |  given everything they hold?"
//   fails or warns THE BUILD      | refuses THE CALL, POLICY_GUARDRAIL_BREACH
//   detects the implicit          | enforces the tool's own declared
//   create/approve pattern too    | `sodConflict` guardrail only
//
// 02 §4.3 states plainly why both are needed and neither is redundant: "the
// role check catches design-time mistakes, the call check catches a caller who
// legitimately holds two roles that are individually fine." That second case is
// invisible to codegen — no single role is wrong, and the conflict exists only
// in a particular human's combination of grants. It is the case this file
// exists for.
//
// TWO DECISIONS, STATED.
//
// 1. **The check is against GRANTS, not against visibility.** The conflicting
//    tool counts if a role the caller holds grants it, even if that tool is
//    currently kill-switched, probe-disabled or outside the deployed package.
//    02 §3.1.3 says "if they also hold a grant for a conflicting tool", and the
//    weaker reading would mean an operator killing the conflicting tool for an
//    unrelated reason silently switches off a segregation-of-duties control. A
//    kill switch is an availability mechanism; it is not an SoD exception.
//
// 2. **`scope` is a label, not a filter.** The worked example in 02 §2.2 pairs
//    `jde.ap.voucher.create` with `jde.scm.purchase_order.approve` under
//    `scope: sameEntityChain` — two different entities, two different modules.
//    "Entity chain" is the business process chain, so nothing here infers a
//    conflict from an id prefix; the conflict is exactly the pair the manifest
//    names, and `scope` is echoed into the message so the human reading the
//    refusal knows which chain the author meant.

import type { Guardrail } from '@mcpforge/shared';
import type { PolicyContext } from '../types.js';
import { malformedDeclaration } from './field.js';
import { NOT_BREACHED, type GuardrailVerdict } from './types.js';

/**
 * The roles this caller holds whose compiled scope grants `toolId`, sorted so
 * the refusal message is stable. This is the caller's RESOLVED role scope —
 * `ctx.scope.roleScopes` is the loaded `generated/roles/<id>.scope.json`
 * artefact, the same one W0-E2's `Granted` predicate reads, so the guardrail and
 * the visibility rule can never disagree about what a role grants.
 */
export function rolesGranting(toolId: string, ctx: PolicyContext): readonly string[] {
  return [...ctx.scope.session.heldRoleIds]
    .filter((roleId) => ctx.scope.roleScopes.get(roleId)?.has(toolId) === true)
    .sort();
}

export function evaluateSodConflict(
  guardrail: Guardrail,
  toolId: string,
  ctx: PolicyContext,
): GuardrailVerdict {
  const conflicting = guardrail.with;
  // `ToolId` is a template-literal type, so an empty string cannot type-check
  // here; `undefined` is the whole of the malformed case.
  if (conflicting === undefined) {
    // Fail closed. An SoD guardrail that names no conflicting tool is not a
    // guardrail that found nothing — it is a guardrail nobody can evaluate.
    return malformedDeclaration(guardrail, toolId, 'it names no conflicting tool in `with`');
  }

  const roles = rolesGranting(conflicting, ctx);
  if (roles.length === 0) return NOT_BREACHED;

  const subject = ctx.scope.session.principal.subject;
  const chain = guardrail.scope === undefined ? '' : ` on the ${guardrail.scope} chain`;
  const roleList = roles.join(', ');

  return {
    breached: true,
    kind: guardrail.kind,
    message:
      guardrail.message ??
      `Segregation of duties: ${subject} may not execute ${toolId} while also holding a grant for ` +
        `${conflicting}${chain}. The conflicting grant comes from ${roles.length === 1 ? 'role' : 'roles'} ${roleList}.`,
    // Named grant, named roles, named human action. Never "try again": no
    // retry by this caller can pass, because the breach is a property of what
    // they hold, not of what they sent.
    next:
      `This call cannot succeed for ${subject} as currently granted. Hand the ${toolId} step to a colleague who does not hold ` +
      `${conflicting}, or ask your MCPForge operator to remove ${conflicting} from ${roleList} for this user — ` +
      `or, if the combination is genuinely intended, to record an sodException naming an approver. Do not retry as ${subject}.`,
  };
}
