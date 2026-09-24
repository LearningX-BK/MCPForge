// MCPForge — the six predicates of `visible(session)`. W0-E2.
// 02 §4.2 step [4], 02 §5.1, 02 §11.3.
//
// Each predicate is INDEPENDENT: it reads the context and one catalogue entry,
// and it answers only its own question. None of them consults another, none of
// them short-circuits another, and none of them can widen the set — a predicate
// can only ever remove a tool, because the resolver intersects their verdicts.
// That structure is what makes the required proof meaningful: remove any one
// predicate from the set and the resolved list gets strictly larger
// (./scope.predicates.test.ts).
//
// Every refusal carries a closed-taxonomy code and a non-empty, agent-actionable
// `next` (CLAUDE.md non-negotiable #5). Two codes in particular are NOT
// interchangeable, per 02 §11.3:
//
//   TOOL_NOT_IN_SCOPE        "you are not granted this tool"        — the HUMAN is too narrow
//   CONSUMER_NOT_AUTHORIZED  "your client is not authorized ..."    — the CLIENT is too narrow
//
// Collapsing them would tell an operator to widen the wrong thing.

import type { ErrorCode } from '@mcpforge/shared';
import { sensitivityWithinCeiling } from './sensitivity.js';
import { isFlagActive } from './sources.js';
import { PROBE_ENABLED_STATUSES, type ScopeCatalogueEntry, type ScopeContext } from './types.js';

export const SCOPE_PREDICATE_NAMES = [
  'Deployed',
  'Granted',
  'ConsumerAuthorized',
  'Activated',
  'ProbeEnabled',
  'NotKillSwitched',
] as const;
export type ScopePredicateName = (typeof SCOPE_PREDICATE_NAMES)[number];

export interface PredicateRefusal {
  readonly admitted: false;
  readonly code: ErrorCode;
  /** What was true, for the audit trail and the portal. */
  readonly reason: string;
  /** Overrides the taxonomy default so the message names THIS tool and THIS grant. */
  readonly next: string;
}

export type PredicateOutcome = { readonly admitted: true } | PredicateRefusal;

const ADMIT: PredicateOutcome = { admitted: true };

export interface ScopePredicate {
  readonly name: ScopePredicateName;
  evaluate(entry: ScopeCatalogueEntry, ctx: ScopeContext): PredicateOutcome;
}

/** The union of the compiled scopes of the roles a set of role ids names. */
function unionRoleScopes(ctx: ScopeContext, roleIds: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const roleId of roleIds) {
    const scope = ctx.roleScopes.get(roleId);
    // A role id with no compiled scope contributes NOTHING. It is never an
    // error that widens: an unknown role cannot grant.
    if (scope === undefined) continue;
    for (const toolId of scope) out.add(toolId);
  }
  return out;
}

/** Is `toolId` in the compiled selection of any of the named packages? */
function inAnyPackage(ctx: ScopeContext, packageIds: readonly string[], toolId: string): boolean {
  for (const packageId of packageIds) {
    // A package id with no compiled selection contributes NOTHING, exactly as
    // an unknown role does: an unresolvable selection can never admit.
    if (ctx.packageSelections.get(packageId)?.has(toolId) === true) return true;
  }
  return false;
}

/**
 * 1. **Deployed** — is this tool part of any package selected into this
 * deployment (02 §5.1 axis 1, 02 §6.1)? A slice is a *selection*: a tool whose
 * manifest exists in git but which no deployed package selects is not here.
 */
export const deployedPredicate: ScopePredicate = {
  name: 'Deployed',
  evaluate(entry, ctx) {
    if (inAnyPackage(ctx, ctx.deployment.packageIds, entry.toolId)) return ADMIT;
    return {
      admitted: false,
      code: 'TOOL_NOT_IN_SCOPE',
      reason: `${entry.toolId} is in no package deployed to ${ctx.deployment.deploymentId}.`,
      next: `Call forge.find to locate a tool this deployment does carry; if ${entry.toolId} is needed here, ask your MCPForge operator to add its package to this deployment's selection.`,
    };
  },
};

/**
 * 2. **Granted** — is this tool in the union of the compiled scopes of the
 * roles this human holds (02 §4.3)? There is no other grant mechanism: no
 * per-user grants, no ad-hoc allowlists, no "admin sees everything".
 *
 * Membership only. The role's `sensitivityCeiling` and `writeAllowed` are
 * policy-chain stage 6e (W0-E3), not visibility — 02 §4.2 places them there and
 * this module does not move them.
 */
export const grantedPredicate: ScopePredicate = {
  name: 'Granted',
  evaluate(entry, ctx) {
    const granted = unionRoleScopes(ctx, ctx.session.heldRoleIds);
    if (granted.has(entry.toolId)) return ADMIT;
    return {
      admitted: false,
      code: 'TOOL_NOT_IN_SCOPE',
      reason: `${entry.toolId} is in the compiled scope of none of the roles held by ${ctx.session.principal.subject}.`,
      next: `Call forge.find to locate a tool your roles do grant for this task, or ask your MCPForge operator for the role that includes ${entry.toolId}. You are not granted this tool.`,
    };
  },
};

/**
 * 3. **ConsumerAuthorized** ([P5], 02 §11.3) — the software holding the session
 * has its own grants, and authorization is their INTERSECTION with the human's,
 * never their union (CLAUDE.md non-negotiable #6).
 *
 * Five independent narrowings, exactly as 02 §11.3 enumerates them: binding
 * type, sensitivity ceiling, write flag, declared roles, declared packages.
 *
 * FAIL-CLOSED ON EMPTY. An empty `bindingTypes`, `roles` or `packages` list
 * authorizes NOTHING, not everything. A consumer record that forgot to declare
 * what it may do has declared that it may do nothing — the opposite reading
 * would make an omission the widest possible grant.
 */
export const consumerAuthorizedPredicate: ScopePredicate = {
  name: 'ConsumerAuthorized',
  evaluate(entry, ctx) {
    const { consumer } = ctx.session;
    const auth = consumer.authorizations;

    const refuse = (code: ErrorCode, reason: string, next: string): PredicateRefusal => ({
      admitted: false,
      code,
      reason,
      next,
    });

    if (consumer.effectiveStatus !== 'active') {
      return refuse(
        'CONSUMER_SUSPENDED',
        `Consumer ${consumer.consumerId} is ${consumer.effectiveStatus}, not active.`,
        `This client's registration is ${consumer.effectiveStatus}. Ask the consumer's steward to reinstate or renew the registration record for ${consumer.consumerId}; no tool is visible to it until then.`,
      );
    }

    const notAuthorized = (reason: string, remedy: string): PredicateRefusal =>
      refuse(
        'CONSUMER_NOT_AUTHORIZED',
        reason,
        `Your client is not authorized for this tool: ${remedy} Request a broader consumer authorization for ${consumer.consumerId} from its owner — this is a client registration limit, not a role limit, so a role change will not fix it.`,
      );

    if (!auth.bindingTypes.includes(entry.bindingType)) {
      return notAuthorized(
        `Consumer ${consumer.consumerId} is not authorized for binding type ${entry.bindingType}.`,
        `binding type ${entry.bindingType} is not in its authorized binding types.`,
      );
    }

    if (!sensitivityWithinCeiling(entry.sensitivity, auth.maxSensitivity)) {
      return notAuthorized(
        `${entry.toolId} is sensitivity ${entry.sensitivity}, above consumer ${consumer.consumerId}'s maxSensitivity ${auth.maxSensitivity}.`,
        `its sensitivity (${entry.sensitivity}) is above the client's ceiling (${auth.maxSensitivity}).`,
      );
    }

    if (entry.write && !auth.writeAllowed) {
      return notAuthorized(
        `${entry.toolId} is a write tool and consumer ${consumer.consumerId} has writeAllowed: false.`,
        'it is a write tool and this client may not write.',
      );
    }

    // "May act only within these roles even if the human holds more" (02 §11.2).
    // This predicate asks ONLY what the consumer may do; what the human may do
    // is `Granted`'s question. The intersection 02 §11.2 requires is produced by
    // the conjunction of the two predicates — deliberately, because a predicate
    // that read both would make it impossible to prove either one load-bearing,
    // and because the two refusals must stay distinguishable
    // (CONSUMER_NOT_AUTHORIZED vs TOOL_NOT_IN_SCOPE, 02 §11.3).
    if (!unionRoleScopes(ctx, auth.roles).has(entry.toolId)) {
      return notAuthorized(
        `${entry.toolId} is outside the roles consumer ${consumer.consumerId} may act within (${auth.roles.join(', ') || 'none declared'}).`,
        'it falls outside the roles this client may act within.',
      );
    }

    if (!inAnyPackage(ctx, auth.packages, entry.toolId)) {
      return notAuthorized(
        `${entry.toolId} is in none of the packages consumer ${consumer.consumerId} declares (${auth.packages.join(', ') || 'none declared'}).`,
        'it is outside the packages this client is registered for.',
      );
    }

    return ADMIT;
  },
};

/**
 * 4. **Activated** — what this session is currently working on (02 §5.1 axis 3),
 * set by `forge.activate`. The only predicate whose default narrows nothing,
 * because activation is a caller-chosen lens rather than a statement of
 * authority. `forge.activate` itself refuses any activation exceeding the
 * caller's grants (02 §5.2), so this can only ever be a subset of `Granted`.
 */
export const activatedPredicate: ScopePredicate = {
  name: 'Activated',
  evaluate(entry, ctx) {
    const activation = ctx.session.activation;
    if (activation.mode === 'default') return ADMIT;
    if (activation.toolIds.has(entry.toolId)) return ADMIT;
    return {
      admitted: false,
      code: 'TOOL_NOT_IN_SCOPE',
      reason: `${entry.toolId} is outside this session's activated set.`,
      next: `Call forge.activate with the role, package or tool ids covering ${entry.toolId} to bring it into this session's working scope, then call again.`,
    };
  },
};

/**
 * 5. **ProbeEnabled** — what actually works right now (02 §4.5, 02 §5.1 axis 4).
 * Only `resolved` and `degraded_readonly` are enabled. A missing status is NOT
 * enabled: nobody has confirmed the binding, and an unconfirmed binding is not
 * one a session may see.
 */
export const probeEnabledPredicate: ScopePredicate = {
  name: 'ProbeEnabled',
  evaluate(entry, ctx) {
    const status = ctx.probe.statusFor(entry.toolId);
    if (status !== null && PROBE_ENABLED_STATUSES.has(status)) return ADMIT;
    return {
      admitted: false,
      code: 'TOOL_DISABLED',
      reason:
        status === null
          ? `${entry.toolId} has no capability-probe result; its binding is unconfirmed.`
          : `The capability probe reports ${entry.toolId} as ${status}.`,
      next: `Call forge.find for an enabled alternative for this task. ${entry.toolId} returns only when its owning team clears the reported condition and forge probe re-runs; do not retry it until then.`,
    };
  },
};

/**
 * 6. **¬KillSwitched** — the kill switch, at all five granularities: tool ·
 * module server · binding type · consumer · deployment (02 §4.7 as extended by
 * 02 §11.2). The flag's own reason text is surfaced verbatim, as 02 §4.7
 * requires.
 */
export const notKillSwitchedPredicate: ScopePredicate = {
  name: 'NotKillSwitched',
  evaluate(entry, ctx) {
    for (const flag of ctx.flags.activeFlags()) {
      if (!isFlagActive(flag, ctx.now)) continue;
      const hit =
        (flag.scope === 'tool' && flag.target === entry.toolId) ||
        (flag.scope === 'moduleServer' && flag.target === entry.serverId) ||
        (flag.scope === 'bindingType' && flag.target === entry.bindingType) ||
        (flag.scope === 'consumer' && flag.target === ctx.session.consumer.consumerId) ||
        (flag.scope === 'deployment' && flag.target === ctx.deployment.deploymentId);
      if (!hit) continue;

      if (flag.scope === 'consumer') {
        return {
          admitted: false,
          code: 'CONSUMER_SUSPENDED',
          reason: `Consumer ${flag.target} is kill-switched: ${flag.reason}`,
          next: `This client's registration is suspended (reason: ${flag.reason}). Ask the consumer's steward to clear the kill switch for ${flag.target}; no tool is visible to it until then.`,
        };
      }
      return {
        admitted: false,
        code: 'TOOL_DISABLED',
        reason: `A ${flag.scope} kill switch on ${flag.target} disables ${entry.toolId}: ${flag.reason}`,
        next: `Call forge.find for an enabled alternative for this task. The named owner must clear the ${flag.scope} kill switch on ${flag.target} (reason: ${flag.reason}) before ${entry.toolId} returns.`,
      };
    }
    return ADMIT;
  },
};

/**
 * The six, in **refusal-precedence** order — the order in which a refused tool's
 * code is chosen (the intersection itself is order-independent).
 *
 * The order follows the policy chain's own (02 §11.4.2: 6a, then 6a′, then 6b),
 * with one deliberate placement: **ConsumerAuthorized is evaluated before
 * Activated**. Activation is a caller-chosen lens that the caller can widen
 * itself with one `forge.activate` call, whereas a consumer authorization is a
 * grant that only its owner can widen — and 02 §11.3 requires that a tool a
 * consumer is too narrow for refuses with `CONSUMER_NOT_AUTHORIZED` and never
 * with `TOOL_NOT_IN_SCOPE`, so the consumer's verdict must not be able to hide
 * behind the session's own lens.
 *
 * FROZEN, and the only value `resolveScope` ever passes. A subset is reachable
 * only through `applyPredicates`, which exists for the predicate-removal proof
 * and has no production call site.
 */
export const SCOPE_PREDICATES: readonly ScopePredicate[] = Object.freeze([
  deployedPredicate,
  grantedPredicate,
  consumerAuthorizedPredicate,
  activatedPredicate,
  probeEnabledPredicate,
  notKillSwitchedPredicate,
]);
