// MCPForge — the probe plan's type model. 02 §4.5. W0-H4.
//
// "Probe plans are read-only or validate-only BY CONSTRUCTION."
//
// The construction is in the types, not in a convention:
//
//   * `ProbePlan.checks` is typed `ProbeCheckSpec<NonMutatingClassification>`.
//     `NonMutatingClassification` is `Exclude<CheckClassification, 'mutating'>`,
//     so a plan carrying a mutating check does not TYPE-CHECK. `buildProbePlan`
//     returns that type and there is no other plan constructor exported.
//   * The check catalogue (`checks.ts`) is a frozen table of literal specs.
//     There is no code path that synthesises a check from a caller argument, so
//     a caller cannot introduce one — exactly the shape `adapters/function`'s
//     "the orchestration name comes from binding.ref only" cage takes.
//   * `mutating` still EXISTS as a classification, because 02 §7.1 says
//     destructive classification is a real thing that happens in the `probe`
//     environment. It is refused outright by the Wave 0 runner and refused
//     first, by name, against a `prod` target — see `run/runner.ts`.

import type { BindingType } from '@mcpforge/shared/manifest';
import type { IdentityCarriage } from '../identity/carriage.js';
import type { CheckFailureStatus } from '../status.js';

export const CHECK_CLASSIFICATIONS = ['read-only', 'validate-only', 'mutating'] as const;
export type CheckClassification = (typeof CHECK_CLASSIFICATIONS)[number];

/** The only classifications a plan may contain. Enforced by the type system. */
export type NonMutatingClassification = Exclude<CheckClassification, 'mutating'>;

export const NON_MUTATING_CLASSIFICATIONS: readonly NonMutatingClassification[] = [
  'read-only',
  'validate-only',
];

export function isMutating(classification: CheckClassification): boolean {
  return classification === 'mutating';
}

/**
 * One check, as declared in the catalogue. `failureStatus` is declared per
 * check rather than inferred at run time, so "which status does this failure
 * produce" is reviewable as data next to the check itself.
 */
export interface ProbeCheckSpec<C extends CheckClassification = CheckClassification> {
  readonly name: string;
  readonly classification: C;
  readonly bindingType: BindingType;
  /** The status this check selects when it fails. */
  readonly failureStatus: CheckFailureStatus;
  /**
   * `true` when the check runs for every tool of this binding type; `false`
   * when it applies only to write tools (e.g. `function`'s `*_VALIDATE`
   * sibling, 02 §4.5).
   */
  readonly writeOnly: boolean;
  /** Human-readable statement of what is checked — reaches `remediation`. */
  readonly describe: string;
}

/** The plan for one tool. Structurally incapable of carrying a mutating check. */
export interface ProbePlan {
  readonly toolId: string;
  readonly bindingType: BindingType;
  readonly write: boolean;
  readonly checks: readonly ProbeCheckSpec<NonMutatingClassification>[];
}

export type CheckOutcome = 'pass' | 'fail' | 'not_applicable';

/** One executed check. Shape matches 02 §4.5's worked `checks[]` entry. */
export interface ProbeCheckResult {
  readonly name: string;
  readonly result: CheckOutcome;
  /** Never empty — a bare "fail" names no action (the discipline of #5). */
  readonly detail: string;
  /**
   * W0-H5. Present ONLY on a check that actually established identity carriage
   * — at Wave 0 that is the `function` binding's `whoami` check and nothing
   * else. It exists because `pass | fail` cannot distinguish 02 §3.5's two
   * different failures: `no` (a service account came back — a finding) and
   * `unverified` (the probe binding is missing or errored — an absence). Both
   * are `fail`, and they have different remediations and different owners.
   *
   * This field is the ONLY channel by which the value `verified` travels
   * anywhere in this codebase, and it is produced solely by
   * `identity/whoami.ts`'s `compareWhoami`.
   */
  readonly identityCarriage?: IdentityCarriage;
  /** The identity the target reported executing under, when the check read one. */
  readonly observedIdentity?: string | null;
}

/** What an executor is handed for one check. Read-only, by shape. */
export interface ProbeCheckContext {
  readonly toolId: string;
  readonly bindingType: BindingType;
  readonly write: boolean;
  /** The allowlisted target name from `binding.ref`. Never caller-supplied. */
  readonly ref: string;
  readonly refVersion: string | null;
  readonly check: ProbeCheckSpec<NonMutatingClassification>;
  readonly correlationId: string;
}

/**
 * The transport seam, one per binding type. Wave 0 ships a `function`
 * implementation over `AisClient` (which the in-process fake at
 * `@mcpforge/adapter-function/testing` satisfies) and nothing else — there is
 * no live Oracle instance in this environment (02 §7.1). A binding type with
 * no executor is NOT silently skipped: `runProbe` reports
 * `disabled_missing_binding` with a check naming the absent executor.
 */
export interface ProbeCheckExecutor {
  readonly bindingType: BindingType;
  run(context: ProbeCheckContext): Promise<ProbeCheckResult>;
}
