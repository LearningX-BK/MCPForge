// MCPForge — the probe orchestrator. 02 §4.5. W0-H4.
//
// "a TypeScript orchestrator that, for every tool in the deployed catalogue,
//  generates a probe plan from the manifest's binding type and executes it."
//
// Three properties this file exists to hold:
//
//  1. EVERY tool in the catalogue is reported. The loop is over the catalogue
//     index (W0-G1's artefact), not over the tools an executor happened to
//     handle, and there is no `continue` that drops a tool. A binding type with
//     no executor produces `disabled_missing_binding` with a check naming the
//     gap — never an absent entry.
//  2. EXACTLY ONE status per tool, from `reduceStatus`, whose totality argument
//     is written out in `report/reduce.ts`.
//  3. NO MUTATING CHECK EVER RUNS. Plans are non-mutating by type (`plan/types.ts`),
//     and this runner adds a second, runtime guard that refuses a mutating check
//     outright and refuses it BY NAME against a `prod` target — belt and braces,
//     because the type guarantee vanishes the moment a plan crosses a JSON
//     boundary or an `as` cast.

import type { BindingType } from '@mcpforge/shared/manifest';
import { assessIdentity, identityCarriesBoolean } from '../identity/assess.js';
import type { IdentityCarriage } from '../identity/carriage.js';
import { buildProbePlan } from '../plan/build.js';
import type {
  CheckClassification,
  ProbeCheckContext,
  ProbeCheckExecutor,
  ProbeCheckResult,
  ProbeCheckSpec,
} from '../plan/types.js';
import { isMutating } from '../plan/types.js';
import { agentMessageFor, remediationFor } from '../report/messages.js';
import { reduceStatus } from '../report/reduce.js';
import { buildValidatePairReport } from '../report/validate-pair.js';
import type { ProbeReport, ProbeReportSummary, ProbeToolReport } from '../report/types.js';
import { PROBE_REPORT_API_VERSION, PROBE_REPORT_KIND } from '../report/types.js';
import {
  reconcileBindingGrants,
  reconciliationDetail,
  type CompiledBindingGrant,
  type DatabaseGrantSource,
} from '../reconcile/binding-grants.js';
import { PROBE_STATUSES, type ProbeStatus } from '../status.js';
import { isProductionTarget, type ProbeTarget } from '../target.js';

/**
 * Raised when a mutating check reaches the runner. It is an error, not a
 * skipped check: a probe run that silently dropped a mutating check would
 * report a green tool that was never fully probed.
 */
export class MutatingCheckRefused extends Error {
  constructor(
    public readonly toolId: string,
    public readonly checkName: string,
    public readonly target: ProbeTarget,
  ) {
    super(
      `Probe check "${checkName}" for ${toolId} is classified mutating and was refused against target ` +
        `"${target.id}" (environment class: ${target.environmentClass}). ` +
        (isProductionTarget(target)
          ? 'The probe runner never runs a mutating check against a production target (02 §4.5; 02 §7.1: "prod — probe runs in read-only mode only").'
          : 'Wave 0 probe plans are read-only or validate-only by construction; a mutating check reached the runner, which means a plan was built outside `buildProbePlan`.'),
    );
    this.name = 'MutatingCheckRefused';
  }
}

/** One tool of the deployed catalogue, as the probe reads it. */
export interface ProbeToolInput {
  readonly toolId: string;
  readonly bindingType: BindingType;
  readonly write: boolean;
  /** `binding.ref` — the allowlisted target name. Manifest-derived only. */
  readonly ref: string;
  readonly refVersion: string | null;
  /** The owning module server's `owner`. Non-empty by manifest schema. */
  readonly owningTeam: string;
  /** The compiled gateway `bindingGrants` that reach this tool (W0-B8). */
  readonly bindingGrants?: readonly CompiledBindingGrant[];
  /**
   * W0-H5. The manifest's `binding.identity.onServiceAccount`. Absent or
   * unrecognised falls back to `block` — the strict direction — and the
   * fallback is reported in the identity block's `detail`, never silently.
   */
  readonly onNonCarriage?: string | null;
  /** W0-H5. The manifest's `sensitivity`; gates `readonly-lowsens`. */
  readonly sensitivity?: string | null;
  /**
   * W0-H5. The designated test user the probe authenticated as, echoed into
   * the report so the verdict is self-describing. It is NOT the value the
   * comparison uses — that one lives in the executor that actually
   * authenticated — so a mismatch here cannot manufacture a `verified`.
   */
  readonly testIdentity?: string | null;
}

export interface ProbeRunInput {
  readonly target: ProbeTarget;
  /** Every tool in the deployed catalogue. Order does not matter; output is sorted. */
  readonly tools: readonly ProbeToolInput[];
  /** One executor per binding type. A missing one is reported, not skipped. */
  readonly executors: ReadonlyMap<BindingType, ProbeCheckExecutor>;
  /** Kill-switch reason for a tool, or `null`. 02 §4.7. */
  readonly killReasonFor?: (toolId: string) => string | null;
  /** [P5] Wave 0: a fixture source, or absent. Wave 2: the live one. */
  readonly databaseGrants?: DatabaseGrantSource | null;
  /** Injected so a report is reproducible in tests. */
  readonly now?: () => Date;
  readonly correlationId?: string;
}

/** The synthetic check reported when no executor exists for a binding type. */
const EXECUTOR_CHECK_NAME = 'probe_executor_registered';

const UNKNOWN_TEAM_FALLBACK = 'UNASSIGNED — no owning team on the module server manifest';

/** W0-H5. The synthetic check that carries 02 §3.5's automatic constraint. */
export const IDENTITY_CONSTRAINT_CHECK = 'identity_carriage_constraint';

/**
 * W0-H5. Reduce a tool's identity checks to one carriage verdict.
 *
 * Ordered, and the order is the argument:
 *
 *  1. An EXPLICIT `no` wins over everything. It is the only positively
 *     OBSERVED failure — the target named an identity and it was the wrong one
 *     — and 02 §3.5 gives it its own consequence (`onServiceAccount`). Losing
 *     it under a co-occurring `unverified` would report an absence where there
 *     is a finding.
 *  2. `verified` requires EVERY identity check to have PASSED — never a
 *     majority, never "the important one". Under no branch is `verified`
 *     reached without an identity check actually having run and passed, which
 *     is 01 §8 R1's "the gateway must refuse to mark any tool
 *     identity-carrying without probe evidence".
 *  3. On a `function` binding, `verified` ADDITIONALLY requires an explicit
 *     `verified` carriage — i.e. `MCPFORGE_PROBE_WHOAMI` itself answered and
 *     matched. 02 §3.5 mandates the probe binding for exactly this binding
 *     type, so a `function` tool whose other identity checks pass while the
 *     probe binding is missing or silent is `unverified` and auto-disabled, not
 *     resolved. Other binding types have no whoami equivalent; their identity
 *     evidence is their own catalogue check (`identity_me_resource`,
 *     `set_identifier_propagates`, `probe_context`), which is still probe
 *     evidence and still must pass.
 *  4. Everything else — including "no identity check ran at all" — is
 *     `unverified`. Fail-closed, with no third state.
 */
export function deriveCarriage(
  identityChecks: readonly ProbeCheckResult[],
  requireExplicitCarriage: boolean,
): IdentityCarriage {
  if (identityChecks.some((c) => c.identityCarriage === 'no')) return 'no';
  const allPassed = identityChecks.length > 0 && identityChecks.every((c) => c.result === 'pass');
  if (!allPassed) return 'unverified';
  if (requireExplicitCarriage && !identityChecks.some((c) => c.identityCarriage === 'verified')) {
    return 'unverified';
  }
  return 'verified';
}

/**
 * Guard 2 of 2. Guard 1 is the type of `ProbePlan.checks`; this one survives a
 * JSON boundary or an `as` cast, which the type does not. Exported so it can be
 * tested directly — the frozen check catalogue makes it impossible to smuggle a
 * mutating check in through `buildProbePlan`, so the only honest way to prove
 * the runtime guard exists is to call it.
 */
export function assertNonMutating(
  toolId: string,
  spec: ProbeCheckSpec<CheckClassification>,
  target: ProbeTarget,
): void {
  if (isMutating(spec.classification)) {
    throw new MutatingCheckRefused(toolId, spec.name, target);
  }
}

async function runOneCheck(
  tool: ProbeToolInput,
  spec: ProbeCheckSpec,
  executor: ProbeCheckExecutor,
  correlationId: string,
): Promise<ProbeCheckResult> {
  const context: ProbeCheckContext = {
    toolId: tool.toolId,
    bindingType: tool.bindingType,
    write: tool.write,
    ref: tool.ref,
    refVersion: tool.refVersion,
    // Narrowed by `assertNonMutating` before this call; the executor only ever
    // sees a non-mutating spec.
    check: spec as ProbeCheckSpec<'read-only' | 'validate-only'>,
    correlationId,
  };
  try {
    const result = await executor.run(context);
    if (result.detail.trim().length === 0) {
      return {
        name: result.name,
        result: 'fail',
        detail: `executor for binding type "${tool.bindingType}" returned an empty detail for check "${spec.name}"; a result with no detail is treated as a failure rather than a pass`,
      };
    }
    return result;
  } catch (err) {
    return {
      name: spec.name,
      result: 'fail',
      detail: `executor threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function emptyCounts(): Record<ProbeStatus, number> {
  const counts = {} as Record<ProbeStatus, number>;
  for (const s of PROBE_STATUSES) counts[s] = 0;
  return counts;
}

/**
 * Run the probe over the whole catalogue and build the report. Never throws for
 * a tool-level failure — a failure is a status. It throws only for the one
 * thing that must not be turned into a report row: a mutating check.
 */
export async function runProbe(input: ProbeRunInput): Promise<ProbeReport> {
  const now = input.now ?? ((): Date => new Date());
  const correlationId = input.correlationId ?? 'probe';
  const killReasonFor = input.killReasonFor ?? ((): string | null => null);
  const startedAt = now().toISOString();

  const tools: ProbeToolReport[] = [];

  for (const tool of input.tools) {
    const plan = buildProbePlan({
      toolId: tool.toolId,
      bindingType: tool.bindingType,
      write: tool.write,
    });

    // Guard 2 of 2 (guard 1 is the type of `plan.checks`). Runs for every check
    // of every tool, before any executor is reached, and refuses by name.
    for (const spec of plan.checks) assertNonMutating(tool.toolId, spec, input.target);

    const specsByName = new Map<string, ProbeCheckSpec>(plan.checks.map((c) => [c.name, c]));
    const executor = input.executors.get(tool.bindingType) ?? null;

    let checks: ProbeCheckResult[];
    if (executor === null) {
      // Not a skip. Every declared check for this binding type is reported as
      // failed with the reason, so the tool still carries exactly one status
      // and the report still says what was not verified.
      const gapSpec: ProbeCheckSpec = {
        name: EXECUTOR_CHECK_NAME,
        classification: 'read-only',
        bindingType: tool.bindingType,
        // The CAUSE is the absent executor, so the status names that rather
        // than whichever declared check happened to sort first. Without this,
        // a `function` tool with no executor would report
        // `disabled_identity_unverified`, which is true but not the reason.
        failureStatus: 'disabled_missing_binding',
        writeOnly: false,
        describe: `A probe executor is registered for binding type "${tool.bindingType}"`,
      };
      specsByName.set(gapSpec.name, gapSpec);
      checks = [
        {
          name: EXECUTOR_CHECK_NAME,
          result: 'fail' as const,
          detail: `no probe executor is registered for binding type "${tool.bindingType}", so nothing was verified against target "${input.target.id}"`,
        },
        ...plan.checks.map((spec) => ({
          name: spec.name,
          result: 'fail' as const,
          detail: `no probe executor is registered for binding type "${tool.bindingType}", so "${spec.describe}" was not verified against target "${input.target.id}"`,
        })),
      ];
    } else {
      checks = [];
      for (const spec of plan.checks) {
        checks.push(await runOneCheck(tool, spec, executor, correlationId));
      }
    }

    // [P5] 02 §11.4.3 — plsql only.
    let reconciliation: ProbeToolReport['bindingGrantReconciliation'];
    if (tool.bindingType === 'plsql') {
      reconciliation = reconcileBindingGrants(
        tool.toolId,
        tool.bindingGrants ?? [],
        input.databaseGrants ?? null,
      );
      const detail = reconciliationDetail(reconciliation);
      const idx = checks.findIndex((c) => c.name === 'binding_grant_reconciliation');
      const outcome: ProbeCheckResult = {
        name: 'binding_grant_reconciliation',
        result: reconciliation.reconciled ? 'pass' : 'fail',
        detail,
      };
      if (idx >= 0) checks[idx] = outcome;
      else checks.push(outcome);
    }

    // --- W0-H5: identity carriage and the AUTOMATIC constraint -------------
    //
    // Non-negotiable #2's field, decided HERE and only here. The tri-state is
    // computed in `identity/`, never at this layer; this block only chooses
    // WHICH check's verdict governs, then lets the constraint reach the status
    // through the ordinary reducer. It runs BEFORE `reduceStatus`, so the
    // constraint is an input to the single status decision rather than an
    // override applied after it.
    const identityChecks = checks.filter((c) => {
      const spec = specsByName.get(c.name);
      return spec?.failureStatus === 'disabled_identity_unverified';
    });
    const carriage = deriveCarriage(identityChecks, tool.bindingType === 'function');
    const observedIdentity =
      identityChecks.find((c) => typeof c.observedIdentity === 'string')?.observedIdentity ?? null;

    const identity = assessIdentity({
      toolId: tool.toolId,
      write: tool.write,
      carries: carriage,
      testIdentity: tool.testIdentity ?? null,
      observedIdentity,
      onNonCarriage: tool.onNonCarriage ?? null,
      sensitivity: tool.sensitivity ?? null,
      evidence: identityChecks.find((c) => c.identityCarriage !== undefined)?.detail ?? null,
    });
    const identityCarries = identityCarriesBoolean(carriage);

    // The constraint reaches the STATUS the same way every other finding does:
    // a check with a declared `failureStatus`, run through `reduceStatus`. No
    // second status path and no post-hoc override of the reducer's answer —
    // which is what keeps "exactly one status, from one place" true.
    const constraintSpec: ProbeCheckSpec = {
      name: IDENTITY_CONSTRAINT_CHECK,
      classification: 'read-only',
      bindingType: tool.bindingType,
      failureStatus: identity.constrainedTo ?? 'disabled_identity_unverified',
      writeOnly: false,
      describe:
        "The probe-reported identity carriage permits this tool to be published (02 §3.5's automatic constraint)",
    };
    specsByName.set(constraintSpec.name, constraintSpec);

    // The catalogue declares `disabled_identity_unverified` as the DEFAULT
    // reading of a failed identity check. When the verdict is `no` and the
    // manifest's `onServiceAccount` is `readonly-lowsens` on a low-sensitivity
    // read, 02 §3.5's own answer to that failure is `degraded_readonly` — so
    // the identity checks that produced the verdict are re-registered at the
    // constraint's status rather than left at the default, which would outrank
    // it in `STATUS_PRECEDENCE` and disable a tool the document publishes.
    //
    // This ONLY ever relaxes toward the constraint the document names, and only
    // in the one branch where the constraint is non-disabling: `constrainedTo`
    // is `degraded_readonly` in exactly that case and `disabled_*` in every
    // other, so there is no combination of manifest values that turns a failed
    // identity check into a pass.
    if (identity.constrainedTo === 'degraded_readonly') {
      for (const c of identityChecks) {
        const spec = specsByName.get(c.name);
        if (spec) specsByName.set(c.name, { ...spec, failureStatus: 'degraded_readonly' });
      }
    }

    checks = [
      ...checks,
      {
        name: IDENTITY_CONSTRAINT_CHECK,
        result: identity.constrainedTo === null ? ('pass' as const) : ('fail' as const),
        detail: identity.detail,
      },
    ];

    const reduced = reduceStatus({
      checks,
      specsByName,
      killReason: killReasonFor(tool.toolId),
    });

    // The kill-switch fact is not a plan check, so it is not in `checks` — but
    // it IS the failing check the report must show, with the flag's own reason
    // verbatim (02 §4.7). Prepend it rather than leave the report saying
    // "kill-switched" with no row explaining why.
    if (reduced.status === 'disabled_kill_switch' && reduced.failingCheck !== null) {
      checks = [reduced.failingCheck, ...checks];
    }

    const owningTeam =
      tool.owningTeam.trim().length > 0 ? tool.owningTeam.trim() : UNKNOWN_TEAM_FALLBACK;

    const messageInput = {
      toolId: tool.toolId,
      status: reduced.status,
      owningTeam,
      failingCheck: reduced.failingCheck,
      failingCheckDescription: reduced.failingCheckDescription,
    };

    // W0-H2 — validate-pair presence, per write tool, for the enablement
    // backlog. `function` write tools only: `X_EXECUTE`/`X_VALIDATE` is 02
    // §3.5's convention for this binding type, and an absent block on any other
    // tool is "not applicable" rather than "pair missing". Built AFTER the
    // checks ran and read only from their results — this block never decides a
    // status and never overrides one.
    const validatePair =
      tool.bindingType === 'function' && tool.write
        ? buildValidatePairReport({
            toolId: tool.toolId,
            ref: tool.ref,
            sensitivity: tool.sensitivity ?? null,
            owningTeam,
            checks,
          })
        : undefined;

    const commitCheck = checks.find((c) => c.name === 'probe_commit_behaviour');
    const commitsInternally =
      commitCheck === undefined || commitCheck.result !== 'pass'
        ? null
        : /commitsInternally\s*[:=]\s*true/i.test(commitCheck.detail);

    tools.push({
      toolId: tool.toolId,
      status: reduced.status,
      bindingType: tool.bindingType,
      checks,
      identityCarries,
      identity,
      commitsInternally,
      owningTeam,
      remediation: remediationFor(messageInput),
      agentMessage: agentMessageFor(messageInput),
      ...(reconciliation ? { bindingGrantReconciliation: reconciliation } : {}),
      ...(validatePair ? { validatePair } : {}),
    });
  }

  tools.sort((a, b) => (a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0));

  const byStatus = emptyCounts();
  for (const t of tools) byStatus[t.status] += 1;
  const summary: ProbeReportSummary = { toolCount: tools.length, byStatus };

  return {
    apiVersion: PROBE_REPORT_API_VERSION,
    kind: PROBE_REPORT_KIND,
    target: {
      id: input.target.id,
      environmentClass: input.target.environmentClass,
      deploymentId: input.target.deploymentId,
      mutatingChecksRefused: true,
    },
    startedAt,
    finishedAt: now().toISOString(),
    tools,
    summary,
  };
}
