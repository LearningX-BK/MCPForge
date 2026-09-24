// MCPForge — the validate-pair dry-run dispatch and the DEGRADATION LADDER.
// W0-H2. 02 §3.5 ("Dry-run — the validate-pair convention"), 01 §10.5 item 2.
//
// 02 §3.5, verbatim:
//
//   > Every write orchestration must be authored as a pair: `X_EXECUTE` and
//   > `X_VALIDATE`. The validate form runs the same form-service validations
//   > with the final submit step branched out, and returns the same error
//   > structure.
//
//   Where a steward cannot produce a validate form for a given orchestration:
//     * `dryRun.strategy` degrades to `precondition-read`, and
//     * `humanApprovalRequired` is forced to `true` for any tool with
//       `sensitivity: financial`,
//   so the product degrades safely rather than silently.
//
// THE THREE PROPERTIES THIS FILE EXISTS TO HOLD
//
//  1. The validate orchestration name is MANIFEST-DERIVED, never caller-derived.
//     It is `writeSafety.dryRun.ref` when the manifest names one, and otherwise
//     `binding.ref` + `_VALIDATE`. There is no argument, no option and no
//     override on this call path that can name an orchestration — the same cage
//     `descriptor.ts` puts around `binding.ref` for the EXECUTE side (W0-H1).
//
//  2. The ladder only ever moves TOWARD caution. `resolveDryRunPlan` can raise
//     `humanApprovalRequired` and never lower it; it can replace `validate-pair`
//     with `precondition-read` and never the other way round; and an UNKNOWN
//     validate-pair answer is treated exactly like a missing one. "We could not
//     tell" and "it is not there" produce the same, stricter, outcome — see
//     `validatePairPresent` below.
//
//  3. Degradation is decided from PROBE EVIDENCE, never from a runtime failure.
//     A `_VALIDATE` call that times out, errors or is refused propagates as the
//     ForgeError it is; it does NOT quietly turn into "no validate pair, degrade
//     and carry on". If a transient target error could demote a tool's dry-run
//     strategy, an attacker (or a bad afternoon on the AIS server) could remove
//     the dry run from a financial write by making it fail. It cannot.
//
// WAVE 0 HONESTY — the reason this task is the one 04 §4.3 calls the highest
// risk in the wave: the six `*_VALIDATE` JDE orchestrations named in
// `docs/build-plan/w0-hg2-validate-orchestrations.md` are SPECIFIED and NOT YET
// AUTHORED in any live instance, and no JDE AIS server is reachable from this
// environment. Everything below is built and tested against the in-process fake
// (`src/testing/`). The dispatch logic and the ladder are real; the claim "the
// pairs exist" is not made anywhere by this code — it is only ever read from
// probe evidence supplied by the caller, and absent evidence degrades.

import type { Sensitivity, ToolManifest, WriteDryRunStrategy } from '@mcpforge/shared/manifest';
import { buildFunctionBindingDescriptor } from './descriptor.js';
import type { FunctionExecutor } from './executor.js';
import type {
  FunctionBindingDescriptor,
  FunctionCallInput,
  FunctionCallResult,
} from './types.js';

/** 02 §3.5's sibling naming convention, stated once on the adapter side. */
export const VALIDATE_SIBLING_SUFFIX = '_VALIDATE';

/** The strategy a missing validate pair degrades to. 02 §3.5. */
export const DEGRADED_STRATEGY: WriteDryRunStrategy = 'precondition-read';

/**
 * The sensitivity for which a degraded dry run FORCES human approval. 02 §3.5
 * and 01 §10.5 item 2 both name exactly this one.
 */
export const APPROVAL_FORCING_SENSITIVITY: Sensitivity = 'financial';

/**
 * Everything the ladder needs about one write tool, built from its manifest and
 * frozen. There is no mutable field and no setter: a plan is resolved from this
 * descriptor plus probe evidence, and from nothing else.
 */
export interface DryRunDescriptor {
  readonly toolId: string;
  /** The EXECUTE-side descriptor, exactly as `execute()` would receive it. */
  readonly execute: FunctionBindingDescriptor;
  readonly declaredStrategy: WriteDryRunStrategy;
  /**
   * The `X_VALIDATE` sibling this tool would dispatch. Non-null only when the
   * declared strategy is `validate-pair`; manifest-derived in every case.
   */
  readonly validateRef: string | null;
  readonly sensitivity: Sensitivity;
  /** The manifest's own `writeSafety.humanApprovalRequired`. The FLOOR. */
  readonly declaredHumanApprovalRequired: boolean;
}

export class NotAWriteTool extends Error {
  constructor(toolId: string) {
    super(
      `${toolId} is not a write tool with a writeSafety block, so it has no dry run to dispatch. ` +
        `CLAUDE.md #4: every write tool carries a complete writeSafety block with a non-"none" dry-run strategy.`,
    );
    this.name = 'NotAWriteTool';
  }
}

/**
 * Build the dry-run descriptor from a manifest.
 *
 * `validateRef` resolution, in order, and there is no third source:
 *   1. `writeSafety.dryRun.ref`, when the manifest names one;
 *   2. `binding.ref` + `_VALIDATE`, 02 §3.5's convention.
 * A caller cannot supply either.
 */
export function buildDryRunDescriptor(manifest: ToolManifest): DryRunDescriptor {
  const writeSafety = manifest.writeSafety;
  if (manifest.write !== true || writeSafety === undefined) {
    throw new NotAWriteTool(manifest.id);
  }
  const execute = buildFunctionBindingDescriptor(manifest);
  const declaredStrategy = writeSafety.dryRun.strategy;

  let validateRef: string | null = null;
  if (declaredStrategy === 'validate-pair') {
    const declared = writeSafety.dryRun.ref?.trim() ?? '';
    validateRef = declared.length > 0 ? declared : `${execute.ref}${VALIDATE_SIBLING_SUFFIX}`;
  }

  return Object.freeze({
    toolId: manifest.id,
    execute,
    declaredStrategy,
    validateRef,
    sensitivity: manifest.sensitivity,
    declaredHumanApprovalRequired: writeSafety.humanApprovalRequired === true,
  });
}

/**
 * Probe evidence about which `*_VALIDATE` siblings actually exist on the target.
 *
 * The implementation the gateway wires is fed from `probe-report.json`'s
 * per-tool `validatePair` block (`core/probe/**`, the other half of W0-H2) —
 * i.e. from a run that actually dispatched the sibling and saw it answer. It is
 * deliberately NOT derived at call time from a live `_VALIDATE` response, for
 * the reason in property 3 at the top of this file.
 *
 * `isRegistered` returns `undefined` for "no evidence either way". Undefined and
 * `false` are treated identically by the ladder: both degrade.
 */
export interface ValidatePairRegistry {
  isRegistered(validateRef: string): boolean | undefined;
}

/**
 * A registry over a presence map, which is the shape the probe report reduces
 * to. Any name absent from the map is unknown, and unknown degrades.
 */
export function validatePairRegistry(
  presence: ReadonlyMap<string, boolean>,
): ValidatePairRegistry {
  return {
    isRegistered: (validateRef: string): boolean | undefined => presence.get(validateRef),
  };
}

/**
 * The registry a deployment has when no probe has run. It knows nothing, so
 * every validate-pair tool degrades — which is the correct reading of "we have
 * never verified that the sibling exists", and the reason the ladder's default
 * is not an empty optional argument that silently means "present".
 */
export const NO_PROBE_EVIDENCE: ValidatePairRegistry = Object.freeze({
  isRegistered: (): undefined => undefined,
});

/** The resolved ladder position for one tool. Every field is decided, none inferred later. */
export interface DryRunPlan {
  readonly toolId: string;
  readonly declaredStrategy: WriteDryRunStrategy;
  /** What will actually run. Equal to `declaredStrategy` unless degraded. */
  readonly effectiveStrategy: WriteDryRunStrategy;
  readonly degraded: boolean;
  readonly validateRef: string | null;
  /** `true` ONLY when probe evidence positively says the sibling exists. */
  readonly validatePairPresent: boolean;
  /**
   * What the gateway must enforce for this call. `declaredHumanApprovalRequired`
   * is the floor; a degraded financial write raises it to `true`.
   */
  readonly humanApprovalRequired: boolean;
  /** `true` when this plan RAISED approval above what the manifest declared. */
  readonly humanApprovalForced: boolean;
  /** Never empty — CLAUDE.md #5's discipline, applied to a degradation too. */
  readonly reason: string;
}

/**
 * Resolve the ladder. Pure, total, and monotone toward caution.
 *
 * The four branches, in full:
 *
 *   a. Declared strategy is not `validate-pair` → nothing to dispatch a sibling
 *      for; the plan is the declared one and approval is the declared one. This
 *      function is the validate-pair ladder and does not re-decide other
 *      strategies.
 *   b. `validate-pair` and probe evidence says the sibling EXISTS → dispatch it.
 *      Approval stays at the manifest's floor.
 *   c. `validate-pair` and probe evidence says it does NOT exist → degrade.
 *   d. `validate-pair` and there is NO evidence → degrade, identically to (c).
 *
 * (c) and (d) share one code path on purpose. There is no branch in which a
 * degraded financial write comes back with `humanApprovalRequired: false`, and
 * `forceApproval` below is the single expression that decides it.
 */
export function resolveDryRunPlan(
  descriptor: DryRunDescriptor,
  registry: ValidatePairRegistry = NO_PROBE_EVIDENCE,
): DryRunPlan {
  const floor = descriptor.declaredHumanApprovalRequired;

  if (descriptor.declaredStrategy !== 'validate-pair' || descriptor.validateRef === null) {
    return Object.freeze({
      toolId: descriptor.toolId,
      declaredStrategy: descriptor.declaredStrategy,
      effectiveStrategy: descriptor.declaredStrategy,
      degraded: false,
      validateRef: null,
      validatePairPresent: false,
      humanApprovalRequired: floor,
      humanApprovalForced: false,
      reason: `${descriptor.toolId} declares dry-run strategy "${descriptor.declaredStrategy}", which is not the validate-pair ladder; its dry run is dispatched by that strategy's own path.`,
    });
  }

  const validateRef = descriptor.validateRef;
  // `=== true` and not a truthiness test: `undefined` (no evidence) must fall to
  // the same side as `false` (evidence of absence).
  const present = registry.isRegistered(validateRef) === true;

  if (present) {
    return Object.freeze({
      toolId: descriptor.toolId,
      declaredStrategy: 'validate-pair' as const,
      effectiveStrategy: 'validate-pair' as const,
      degraded: false,
      validateRef,
      validatePairPresent: true,
      humanApprovalRequired: floor,
      humanApprovalForced: false,
      reason: `${descriptor.toolId} dry-runs through its validate-pair sibling ${validateRef}, which the capability probe found on the target.`,
    });
  }

  // The degradation. Approval is raised, never lowered: `floor || forced`.
  const forceApproval = descriptor.sensitivity === APPROVAL_FORCING_SENSITIVITY;
  const humanApprovalRequired = floor || forceApproval;

  return Object.freeze({
    toolId: descriptor.toolId,
    declaredStrategy: 'validate-pair' as const,
    effectiveStrategy: DEGRADED_STRATEGY,
    degraded: true,
    validateRef,
    validatePairPresent: false,
    humanApprovalRequired,
    humanApprovalForced: humanApprovalRequired && !floor,
    reason:
      `${descriptor.toolId} declares dry-run strategy "validate-pair", but the capability probe has no evidence that its sibling ${validateRef} exists on the target. ` +
      `The strategy degrades to "${DEGRADED_STRATEGY}" (02 §3.5)` +
      (forceApproval
        ? `, and because this tool is sensitivity "${APPROVAL_FORCING_SENSITIVITY}" human approval is FORCED to true for every execution until the sibling is authored and a probe run confirms it.`
        : `. Human approval remains as the manifest declares it (${String(floor)}); this tool is sensitivity "${descriptor.sensitivity}", not "${APPROVAL_FORCING_SENSITIVITY}".`),
  });
}

/**
 * The outcome of a dry run.
 *
 * `dispatched: false` is not a passed dry run and must never be read as one:
 * nothing reached the target, so nothing was validated by it. The gateway's
 * plan step reads `plan.effectiveStrategy` and runs the `precondition-read`
 * path (W0-F-track) instead — and, when `plan.humanApprovalRequired` is true,
 * mints no confirm token until the out-of-band approval exists.
 */
export type DryRunOutcome =
  | {
      readonly plan: DryRunPlan;
      readonly dispatched: true;
      /** Exactly what `execute()` returns, from the `_VALIDATE` sibling. */
      readonly result: FunctionCallResult;
    }
  | {
      readonly plan: DryRunPlan;
      readonly dispatched: false;
      readonly result: null;
    };

export interface DryRunDispatcher {
  /**
   * Resolve the ladder and, when it lands on `validate-pair`, dispatch the
   * sibling. Errors from the sibling propagate unchanged — same taxonomy, same
   * shape, same `next` as the EXECUTE call would have produced.
   */
  dryRun(descriptor: DryRunDescriptor, input: FunctionCallInput): Promise<DryRunOutcome>;
}

export interface DryRunDispatcherOptions {
  /**
   * The SAME executor the EXECUTE path uses. That is the whole mechanism behind
   * "returns the same error structure as `X_EXECUTE`": there is no second
   * dispatch path, no second validator, no second error mapper — only a
   * descriptor whose `ref` is the sibling.
   */
  readonly executor: FunctionExecutor;
  readonly registry?: ValidatePairRegistry;
}

/**
 * The `_VALIDATE` descriptor: the EXECUTE descriptor with `ref` replaced and
 * NOTHING else changed.
 *
 * `write` deliberately stays `true`. 02 §3.5 and the W0-HG2 content spec both
 * require the sibling to return "the identical error/return structure ... so the
 * gateway's dry-run path and its real-execute path can share one error mapper",
 * and `adapters/function/errors.ts` branches its `next` copy on `write`. Keeping
 * it true makes the dry run's errors byte-identical to the execute path's and
 * keeps the more cautious copy ("do NOT re-issue this write"). `identity` stays
 * too: `echoOn: write` therefore applies to the sibling, so a `_VALIDATE`
 * composed without its identity-echo step FAILS the dry run rather than passing
 * one whose executing identity nobody checked. Both choices err toward caution.
 */
export function validateSiblingDescriptor(
  descriptor: DryRunDescriptor,
  validateRef: string,
): FunctionBindingDescriptor {
  return Object.freeze({ ...descriptor.execute, ref: validateRef });
}

export function createDryRunDispatcher(options: DryRunDispatcherOptions): DryRunDispatcher {
  const registry = options.registry ?? NO_PROBE_EVIDENCE;

  return {
    async dryRun(
      descriptor: DryRunDescriptor,
      input: FunctionCallInput,
    ): Promise<DryRunOutcome> {
      const plan = resolveDryRunPlan(descriptor, registry);

      if (plan.effectiveStrategy !== 'validate-pair' || plan.validateRef === null) {
        // Nothing is dispatched. Not a call to the EXECUTE orchestration, not a
        // call to a sibling that may not exist, not a fabricated pass.
        return { plan, dispatched: false, result: null };
      }

      // Errors are NOT caught here. A failed `_VALIDATE` is a failed dry run and
      // propagates as the ForgeError the shared executor built; it never becomes
      // a degradation (property 3 at the top of this file).
      const result = await options.executor.execute(
        validateSiblingDescriptor(descriptor, plan.validateRef),
        input,
      );
      return { plan, dispatched: true, result };
    },
  };
}
