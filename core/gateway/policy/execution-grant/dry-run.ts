// MCPForge — the confirm gate's `DryRunner` for `function` writes. W0-P17,
// 02 §3.5 ("Dry-run — the validate-pair convention"), 02 §3.1.1.
//
// Stage 6g's plan phase calls this. It resolves the adapter's degradation
// ladder (`resolveDryRunPlan`) and, only when the ladder lands on
// `validate-pair` with probe evidence that the `_VALIDATE` sibling exists,
// dispatches that sibling through the SAME function executor the execute path
// uses. The executor refuses anything without an execution grant (W0-P9), so
// this module mints one, with `purpose: 'dry-run'`, bound to the SIBLING's ref
// and this call's business arguments, caller and correlation id. It lives in
// `core/gateway/policy/**` because that is the only place a grant may be
// minted (tests/policy/escalation.trust-boundary.test.ts).
//
// WHAT IT REPORTS BACK. The ladder's `humanApprovalRequired`: a degraded
// `financial` write forces approval, and the gate takes the union with the
// tool's own flag, so this can raise the requirement and never lower it. A
// degraded plan also carries the ladder's reason as a plan WARNING, so the
// human reads that the dry run did not reach the target.
//
// WHAT IT NEVER DOES. Decide the strategy from a runtime failure: an error
// from the sibling propagates, stage 6g throws, and the chain denies (02 §3.5
// property 3: a failing `_VALIDATE` must not quietly remove the dry run).

import {
  createDryRunDispatcher,
  NO_PROBE_EVIDENCE,
  resolveDryRunPlan,
  type CompiledSchemaValidator,
  type DryRunDescriptor,
  type FunctionExecutor,
  type ValidatePairRegistry,
} from '@mcpforge/adapter-function';
import type { DryRunner } from '../confirm/gate.js';
import type { DryRunOutcome } from '../confirm/plan.js';
import { mintExecutionGrant, type ExecutionGrantKeyring } from './grant.js';

export interface FunctionDryRunnerDeps {
  readonly executor: FunctionExecutor;
  /** The SAME key the chain signs execute grants with. */
  readonly keyring: ExecutionGrantKeyring;
  descriptorFor(toolId: string): DryRunDescriptor | undefined;
  validatorFor(toolId: string): CompiledSchemaValidator | undefined;
  /** Probe evidence of which `_VALIDATE` siblings exist. Absent: none, and every write degrades. */
  readonly registry?: ValidatePairRegistry;
}

export function functionDryRunner(deps: FunctionDryRunnerDeps): DryRunner {
  const registry = deps.registry ?? NO_PROBE_EVIDENCE;
  const dispatcher = createDryRunDispatcher({ executor: deps.executor, registry });

  return {
    async plan({ call, entry, businessArgs, ctx }): Promise<DryRunOutcome> {
      if (entry.bindingType !== 'function') {
        throw new Error(
          `${call.toolId} is a ${entry.bindingType} write; no dry-run dispatcher is wired for that binding type.`,
        );
      }
      const descriptor = deps.descriptorFor(call.toolId);
      const validate = deps.validatorFor(call.toolId);
      if (descriptor === undefined || validate === undefined) {
        throw new Error(`${call.toolId} has no dry-run descriptor or compiled schema loaded.`);
      }

      const plan = resolveDryRunPlan(descriptor, registry);
      const warnings = plan.degraded ? [plan.reason] : [];

      if (plan.effectiveStrategy === 'validate-pair' && plan.validateRef !== null) {
        const executionGrant = mintExecutionGrant(
          {
            purpose: 'dry-run',
            toolId: call.toolId,
            bindingRef: plan.validateRef,
            args: businessArgs,
            callerSubject: ctx.scope.session.principal.subject,
            consumerId: ctx.scope.session.consumer.consumerId,
            correlationId: call.correlationId,
            now: ctx.scope.now,
          },
          deps.keyring,
        );
        await dispatcher.dryRun(descriptor, {
          args: businessArgs,
          correlationId: call.correlationId,
          validate,
          principalSubject: ctx.scope.session.principal.subject,
          executionGrant,
        });
      }

      return { warnings, humanApprovalRequired: plan.humanApprovalRequired };
    },
  };
}
