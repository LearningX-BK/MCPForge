// MCPForge — the runner: ordered, fail-closed. W0-E3, 02 §4.2 step [6].
//
// FAIL-CLOSED, stated as the three things that could go wrong and what each one
// does instead:
//
//  1. **A stage throws.** Caught here, turned into an `INTERNAL` denial naming
//     the stage, and the chain STOPS. It does not fall through to the next
//     stage, and it never reaches the binding executor. This is the same rule
//     W0-E2 applies to a throwing scope predicate, applied to an ordered
//     pipeline instead of a predicate set.
//  2. **A stage returns something the runner does not recognise.** Also an
//     `INTERNAL` denial. There is no `else -> continue` anywhere in this file:
//     the only way past a stage is an outcome that says `continue` in so many
//     words.
//  3. **The runner itself throws** — a bug in this file, a broken context.
//     `runPolicyChain` never rejects: the whole walk is inside one try/catch
//     whose catch denies. A caller cannot distinguish "the chain refused" from
//     "the chain broke" by whether it got an exception, because it never gets
//     one, and a caller that treats a thrown error as "no refusal was recorded"
//     is the failure mode this guarantees away.
//
// The proof is ./policy.fault-injection.test.ts, which injects a throw at each
// of the ten stages in turn and asserts a denial every time — including at the
// last stage, where "deny rather than allow" costs a call that would otherwise
// have succeeded. That is the correct trade and it is the whole point.

import { forgeError, type ForgeError } from '@mcpforge/shared';
import { POLICY_STAGES } from './stages.js';
import type {
  ConfirmedCall,
  PolicyCall,
  PolicyChainState,
  PolicyContext,
  PolicyStage,
  PolicyStageId,
  StageOutcome,
} from './types.js';

export type PolicyDecision =
  /** Every stage admitted the call. The binding executor (step [7]) may run. */
  | {
      readonly outcome: 'proceed';
      readonly stagesRun: readonly PolicyStageId[];
      /** 6g's verified token, or null for a read tool. The executor spends its nonce. */
      readonly confirmed: ConfirmedCall | null;
    }
  /** A stage refused. `error` is closed-taxonomy and carries a non-empty `next`. */
  | {
      readonly outcome: 'refused';
      readonly stage: PolicyStageId;
      readonly stagesRun: readonly PolicyStageId[];
      readonly error: ForgeError;
    }
  /** A stage produced a terminal NON-error response: a plan, an approval hand-off, a replay. */
  | {
      readonly outcome: 'responded';
      readonly stage: PolicyStageId;
      readonly stagesRun: readonly PolicyStageId[];
      readonly response: Readonly<Record<string, unknown>>;
    };

/** Injected throws, keyed by stage id. Test-only; production passes nothing. */
export interface PolicyChainOptions {
  /** The exact stage list to walk. Defaults to the frozen ten. */
  readonly stages?: readonly PolicyStage[];
}

function internalDenial(
  stage: PolicyStageId,
  call: PolicyCall,
  detail: string,
  stagesRun: readonly PolicyStageId[],
): PolicyDecision {
  return {
    outcome: 'refused',
    stage,
    stagesRun,
    error: forgeError(
      'INTERNAL',
      `Policy stage ${stage} failed while evaluating ${call.toolId}: ${detail}`,
      call.correlationId,
      {
        condition: `Policy chain stage ${stage} did not complete. The call was DENIED; no later stage ran and no target action was attempted.`,
        next: `Report correlationId ${call.correlationId} to the MCPForge operator. Tell the human the request did not reach the target system, so no business record was created or changed.`,
      },
    ),
  };
}

/**
 * Walk the chain. Never throws, never returns a rejected promise, and never
 * returns `proceed` unless every stage in the list said `continue`.
 */
export async function runPolicyChain(
  call: PolicyCall,
  ctx: PolicyContext,
  options: PolicyChainOptions = {},
): Promise<PolicyDecision> {
  const stages = options.stages ?? POLICY_STAGES;
  const stagesRun: PolicyStageId[] = [];
  const state: PolicyChainState = {};
  // The id of the stage currently being walked, so a throw in the runner's own
  // bookkeeping is still attributed somewhere truthful.
  let current: PolicyStageId = stages[0]?.id ?? '6a';

  try {
    for (const stage of stages) {
      current = stage.id;
      stagesRun.push(stage.id);

      let outcome: StageOutcome;
      try {
        outcome = await stage.evaluate(call, ctx, state);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return internalDenial(stage.id, call, `it threw (${detail})`, stagesRun);
      }

      if (outcome === null || typeof outcome !== 'object' || typeof outcome.kind !== 'string') {
        return internalDenial(stage.id, call, 'it returned no recognisable outcome', stagesRun);
      }

      if (outcome.kind === 'continue') continue;

      if (outcome.kind === 'refuse') {
        let error: ForgeError;
        try {
          error = forgeError(outcome.code, outcome.message, call.correlationId, {
            condition: outcome.condition,
            next: outcome.next,
          });
        } catch (cause) {
          // `forgeError` throws on an empty `next` (non-negotiable #5). A stage
          // that produced a dead-end refusal is a bug, and the answer is still a
          // denial — with a `next` — not a pass.
          const detail = cause instanceof Error ? cause.message : String(cause);
          return internalDenial(
            stage.id,
            call,
            `it refused with a malformed error (${detail})`,
            stagesRun,
          );
        }
        return { outcome: 'refused', stage: stage.id, stagesRun, error };
      }

      if (outcome.kind === 'respond') {
        return { outcome: 'responded', stage: stage.id, stagesRun, response: outcome.response };
      }

      // Unreachable for a well-typed outcome, and a denial if it ever is not.
      return internalDenial(stage.id, call, 'it returned an unknown outcome kind', stagesRun);
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return internalDenial(current, call, `the policy chain itself failed (${detail})`, stagesRun);
  }

  return { outcome: 'proceed', stagesRun, confirmed: state.confirmed ?? null };
}
