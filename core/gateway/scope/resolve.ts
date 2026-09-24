// MCPForge — the intersection itself. W0-E2, 02 §4.2 step [4], 02 §11.3.
//
//   visible(session) = Deployed ∩ Granted ∩ ConsumerAuthorized
//                    ∩ Activated ∩ ProbeEnabled ∩ ¬KillSwitched
//
// The set operation is trivial; the properties that matter are structural:
//
//  1. **A predicate can only remove.** The resolver starts from the catalogue
//     and admits a tool only when EVERY predicate admits it. There is no branch
//     in which a predicate adds a tool, so no predicate can widen the set and
//     no combination of them can produce a tool nobody granted.
//  2. **`resolveScope` always runs all six.** The subset-taking entry point,
//     `applyPredicates`, exists for the predicate-removal proof; production has
//     exactly one entry point and it passes the frozen `SCOPE_PREDICATES`.
//  3. **A throwing predicate denies.** An exception anywhere in evaluation
//     refuses the tool with `INTERNAL` rather than skipping the check. (W0-E3
//     owns fault injection across the policy chain; the same rule is applied
//     here because a scope resolver that fails open would make step 6a's
//     independent re-check the only thing standing between a bug and a leaked
//     catalogue.)

import { forgeError, type ForgeError } from '@mcpforge/shared';
import {
  SCOPE_PREDICATES,
  type PredicateRefusal,
  type ScopePredicate,
  type ScopePredicateName,
} from './predicates.js';
import type { ScopeCatalogueEntry, ScopeContext, ToolId } from './types.js';

export interface ScopeRefusal extends PredicateRefusal {
  /** Which predicate refused — the first, in `SCOPE_PREDICATES` precedence order. */
  readonly predicate: ScopePredicateName;
}

export interface ScopeResolution {
  /** The visible set, sorted, stable. This is what `tools/list` renders. */
  readonly visible: readonly ToolId[];
  /** Every catalogue tool that is NOT visible, with the reason it is not. */
  readonly refusals: ReadonlyMap<ToolId, ScopeRefusal>;
}

/**
 * Apply an explicit predicate set. **Not a production entry point** — it takes
 * a predicate list so `scope.predicates.test.ts` can resolve with one predicate
 * removed and prove the set widens. Production calls `resolveScope`.
 */
export function applyPredicates(
  catalogue: readonly ScopeCatalogueEntry[],
  ctx: ScopeContext,
  predicates: readonly ScopePredicate[],
): ScopeResolution {
  const visible: ToolId[] = [];
  const refusals = new Map<ToolId, ScopeRefusal>();

  for (const entry of catalogue) {
    let refusal: ScopeRefusal | null = null;
    for (const predicate of predicates) {
      let outcome;
      try {
        outcome = predicate.evaluate(entry, ctx);
      } catch (cause) {
        refusal = {
          admitted: false,
          predicate: predicate.name,
          code: 'INTERNAL',
          reason: `Scope predicate ${predicate.name} threw while evaluating ${entry.toolId}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          next: `Report this correlationId to the MCPForge operator. ${entry.toolId} is withheld because its ${predicate.name} check could not be completed; no target action was attempted.`,
        };
        break;
      }
      if (!outcome.admitted) {
        refusal = { ...outcome, predicate: predicate.name };
        break;
      }
    }
    if (refusal === null) visible.push(entry.toolId);
    else refusals.set(entry.toolId, refusal);
  }

  visible.sort();
  return { visible, refusals };
}

/** The production entry point. Always the full, frozen six. */
export function resolveScope(
  catalogue: readonly ScopeCatalogueEntry[],
  ctx: ScopeContext,
): ScopeResolution {
  return applyPredicates(catalogue, ctx, SCOPE_PREDICATES);
}

/**
 * The closed-taxonomy error for a tool id that is not in the resolved set —
 * the refusal a caller gets for naming an unlisted tool directly, through
 * either `tools/call` or `forge.invoke`.
 *
 * Returns `null` when the tool IS visible; deciding what happens next is the
 * policy chain's job (W0-E3), not this module's.
 *
 * A tool id that is in no catalogue at all is `TOOL_NOT_IN_SCOPE` and not
 * `INPUT_INVALID`: whether a tool exists elsewhere in the estate is not
 * something a caller outside its scope is entitled to learn.
 */
export function scopeRefusalError(
  toolId: ToolId,
  resolution: ScopeResolution,
  correlationId: string,
): ForgeError | null {
  if (resolution.visible.includes(toolId)) return null;

  const refusal = resolution.refusals.get(toolId);
  if (refusal === undefined) {
    return forgeError(
      'TOOL_NOT_IN_SCOPE',
      `${toolId} is not in the resolved scope of this session.`,
      correlationId,
      {
        condition: `${toolId} is in no catalogue this session can see.`,
        next: `Call forge.find to locate a tool your roles do grant for this task. You are not granted ${toolId}.`,
      },
    );
  }

  return forgeError(refusal.code, refusal.reason, correlationId, {
    condition: refusal.reason,
    next: refusal.next,
  });
}
