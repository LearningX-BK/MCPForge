// MCPForge — stage 6f's `GuardrailEvaluator`, filled for real. W0-F4, 02 §3.1.3.
//
// This is the implementation of the seam W0-E3 named at stage 6f, filled the
// same way W0-F1 filled 6g's `WriteGate` and W0-F3 filled 6h's
// `IdempotencyGate`: one object, reached only through the frozen stage list, no
// second entry point beside it.
//
// "EVALUATED AT PLAN AND AGAIN AT EXECUTE" IS A PROPERTY OF THE CHAIN'S ORDER,
// NOT OF THIS FILE. 02 §3.1.3 requires guardrails to be evaluated "at plan time
// and again at execute time (never only at plan)". Stage 6f sits BEFORE stage
// 6g in `POLICY_STAGES`, and a plan and an execute are two separate tool calls
// that each walk the whole chain (`./confirm/gate.ts`: `confirm` absent returns
// the plan and stops; `confirm` present is a second call carrying the token).
// So the property holds by construction, with no second evaluation point, no
// re-entrant chain run and no "did we already check this" flag anywhere. Adding
// one would create exactly the divergence 02 §3.1.3 warns about — two places
// that can drift about what a guardrail means.
//
// ORDER WITHIN THE STAGE. Guardrails are evaluated in declaration order and the
// FIRST breach wins. The manifest author's order is therefore the order the
// human sees a refusal in, which is why nothing here sorts, and why the pure
// kinds are not run "first for speed": a caller must not be able to infer which
// guardrails exist from which one refuses first.

import { NOT_BREACHED, type GuardrailDeps, type GuardrailVerdict } from './types.js';
import { evaluateAllowedValues, evaluateNumeric, malformedDeclaration } from './field.js';
import { evaluateSodConflict } from './sod.js';
import { evaluateRateLimit, evaluateTimeWindow } from './stateful.js';
import type {
  GuardrailEvaluator,
  PolicyCall,
  PolicyCatalogueEntry,
  PolicyContext,
} from '../types.js';
import { businessArgs } from '../confirm/hash.js';

/**
 * Evaluate one tool's declared guardrails against one call. Exported for the
 * tests and for `forge validate`'s future use; the chain reaches it through
 * `guardrailEvaluator` below.
 *
 * The arguments evaluated are the BUSINESS arguments — `confirm` excluded, via
 * the same `businessArgs` helper W0-F2's canonical hash uses. Any other reading
 * would mean the guardrail engine and the confirm token disagree about what
 * "the arguments" are, and the token exists precisely to make that impossible.
 */
export async function evaluateGuardrails(
  call: PolicyCall,
  entry: PolicyCatalogueEntry,
  ctx: PolicyContext,
  deps: GuardrailDeps = {},
): Promise<GuardrailVerdict> {
  const declared = entry.guardrails ?? [];
  if (declared.length === 0) return NOT_BREACHED;

  const args = businessArgs(call.args);
  const now = deps.now?.() ?? ctx.scope.now;
  const subject = ctx.scope.session.principal.subject;

  for (const guardrail of declared) {
    let verdict: GuardrailVerdict;
    switch (guardrail.kind) {
      case 'maxNumeric':
      case 'minNumeric':
        verdict = evaluateNumeric(guardrail, entry.toolId, args);
        break;
      case 'allowedValues':
        verdict = evaluateAllowedValues(guardrail, entry.toolId, args);
        break;
      case 'sodConflict':
        verdict = evaluateSodConflict(guardrail, entry.toolId, ctx);
        break;
      case 'rateLimit':
        verdict = await evaluateRateLimit(guardrail, entry.toolId, subject, now, deps.executes);
        break;
      case 'timeWindow':
        verdict = await evaluateTimeWindow(guardrail, entry.toolId, args, now, deps.timeWindows);
        break;
      default: {
        // An unrecognised kind is a refusal, never a pass. A future kind added
        // to the schema without an evaluator here fails closed and visibly.
        //
        // [W0-F8] This branch used to carry a named `requiresField` case: W0-B1
        // put that kind in the schema, 02 §3.1.3 never defined it, and so every
        // call to a tool declaring one was refused here while `forge validate`
        // passed the manifest clean. The kind is now retired from the schema and
        // from `GuardrailKind`, so the refusal it needed is exactly this
        // fail-closed default and nothing special is written for it.
        const kind: never = guardrail.kind;
        verdict = malformedDeclaration(
          guardrail,
          entry.toolId,
          `this gateway has no evaluator for guardrail kind ${String(kind)}`,
        );
      }
    }
    if (verdict.breached) return verdict;
  }

  return NOT_BREACHED;
}

/**
 * Build the evaluator. The returned object is what a composition root passes as
 * `PolicyRuntime.guardrails`.
 */
export function guardrailEvaluator(deps: GuardrailDeps = {}): GuardrailEvaluator {
  return {
    evaluate(call, entry, ctx) {
      return evaluateGuardrails(call, entry, ctx, deps);
    },
  };
}
