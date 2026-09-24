// MCPForge — the AUTOMATIC constraint. 02 §3.5, 01 §8 R1. W0-H5.
//
// 01 §8 R1, the highest-severity inherited risk, states the hard constraint in
// one sentence: "any tool whose probe reports service-account execution is
// automatically constrained to read-only, low-sensitivity data or blocked."
//
// AUTOMATICALLY is the load-bearing word, and it is why this is a total
// function over the verdict rather than a policy a deployment configures. Its
// output is a `ProbeStatus`, which `report/io.ts` -> `probeStatusMap` ->
// `staticProbeStatuses` already turns into the gateway's `ProbeEnabled`
// predicate. So a `no` or `unverified` verdict removes the tool from
// `tools/list` on the next probe run with NO further wiring, no deploy and no
// human step — and the tool stays findable through `forge.find` with the
// owning team named (02 §4.5), which is the "visibly reported" half.
//
// THERE IS NO OVERRIDE PARAMETER IN THIS FILE, and there is none anywhere else
// in `core/probe/identity/**`. `constrainForCarriage` takes the verdict, the
// tool's write flag, its declared disposition and its sensitivity — four facts,
// all of them either probe-observed or manifest-declared, none of them a
// switch. A deployment that needs a tool published in spite of its verdict
// takes the governance route: a `policyException` on the manifest carrying an
// approval record in `approvals/`, reviewed and merged like every other grant
// here. See `docs` note in `identity/index.ts` and the structural test
// `no-override.test.ts`, which asserts this absence rather than trusting it.

import type { ProbeStatus } from '../status.js';

import {
  DEFAULT_NON_CARRIAGE_DISPOSITION,
  isLowSensitivity,
  isNonCarriageDisposition,
  LOW_SENSITIVITY_CEILING,
  type IdentityCarriage,
  type NonCarriageDisposition,
} from './carriage.js';

/**
 * The only two statuses an identity verdict can force. Narrowed from
 * `ProbeStatus` deliberately: 02 §3.5's automatic constraint is "read-only,
 * low-sensitivity, or blocked" and nothing else, so the type says so and a
 * fourth outcome does not compile. Both members are `CheckFailureStatus`, which
 * is what lets the constraint reach the report through `reduceStatus` rather
 * than around it.
 */
export type IdentityConstraintStatus = Extract<
  ProbeStatus,
  'disabled_identity_unverified' | 'degraded_readonly'
>;

export interface ConstraintInput {
  readonly toolId: string;
  readonly carries: IdentityCarriage;
  readonly write: boolean;
  /**
   * The manifest's `binding.identity.onServiceAccount`. An absent or
   * unrecognised value falls back to `block` — the strict direction — and the
   * fallback is REPORTED in `detail`, never silent.
   */
  readonly onNonCarriage?: string | null | undefined;
  /** The manifest's `sensitivity`. Absent or unknown is NOT low. */
  readonly sensitivity?: string | null | undefined;
}

export interface IdentityConstraint {
  /**
   * The status this verdict forces, or `null` when it forces nothing (the
   * `verified` case). `null` does NOT mean "resolved" — other checks may still
   * disable the tool; it means identity contributed no constraint.
   */
  readonly status: IdentityConstraintStatus | null;
  /** True when the tool may not be published at all on this verdict. */
  readonly disabled: boolean;
  /** The disposition actually applied, after the fail-closed fallback. */
  readonly disposition: NonCarriageDisposition;
  /** Never empty. Says what was applied and why. */
  readonly detail: string;
}

function resolveDisposition(value: string | null | undefined): {
  readonly disposition: NonCarriageDisposition;
  readonly defaulted: boolean;
} {
  if (isNonCarriageDisposition(value)) return { disposition: value, defaulted: false };
  return { disposition: DEFAULT_NON_CARRIAGE_DISPOSITION, defaulted: true };
}

/**
 * The whole of 02 §3.5's automatic constraint, as one total function.
 *
 * The branches, in the order the document states them:
 *
 *  1. `verified`   -> no constraint. The ONLY branch that publishes a write
 *                     tool on a `function` binding.
 *  2. `no` + write -> `disabled_identity_unverified`, ALWAYS. 02 §3.5: "a
 *                     write tool with `carries: no` is auto-disabled, full
 *                     stop." The disposition is not consulted for the outcome —
 *                     `readonly-lowsens` cannot make a write read-only, it can
 *                     only fail to say so. (`forge validate`'s
 *                     `policy.stored-credential-four-part-test` part 2 already
 *                     refuses that combination in a manifest; this is the
 *                     runtime half of the same rule, and the two are
 *                     deliberately redundant.)
 *  3. `no` + read + `block`           -> disabled.
 *  4. `no` + read + `readonly-lowsens` -> published as `degraded_readonly`
 *                     ONLY when the tool's sensitivity is at or below
 *                     `LOW_SENSITIVITY_CEILING`; otherwise disabled. "read-only,
 *                     low sensitivity, or blocked" is a conjunction, not a
 *                     menu.
 *  5. `unverified`  -> disabled, write or read. "Never 'assumed fine.'"
 */
export function constrainForCarriage(input: ConstraintInput): IdentityConstraint {
  const { disposition, defaulted } = resolveDisposition(input.onNonCarriage);
  const defaultNote = defaulted
    ? ` (binding.identity.onServiceAccount was absent or unrecognised, so the fail-closed default "${DEFAULT_NON_CARRIAGE_DISPOSITION}" was applied)`
    : '';

  if (input.carries === 'verified') {
    return {
      status: null,
      disabled: false,
      disposition,
      detail: `${input.toolId} carries the caller's identity, verified by the probe. No identity constraint applied.`,
    };
  }

  if (input.carries === 'unverified') {
    return {
      status: 'disabled_identity_unverified',
      disabled: true,
      disposition,
      detail:
        `${input.toolId} is auto-disabled: identity carriage is unverified, so nothing establishes that this ` +
        `binding acts as the caller. The owning team is named in this report's remediation (02 §3.5: never "assumed fine").`,
    };
  }

  // carries === 'no' — a service account came back.
  if (input.write) {
    return {
      status: 'disabled_identity_unverified',
      disabled: true,
      disposition,
      detail:
        `${input.toolId} is auto-disabled: it is a WRITE tool and the probe reports the target executed under a ` +
        `shared or service account (identity.carries: no). A write tool with carries: no is auto-disabled, full stop ` +
        `(02 §3.5), regardless of binding.identity.onServiceAccount${defaultNote ? ', which was ' + disposition : ''}.`,
    };
  }

  if (disposition === 'block') {
    return {
      status: 'disabled_identity_unverified',
      disabled: true,
      disposition,
      detail:
        `${input.toolId} is auto-disabled: the probe reports service-account execution (identity.carries: no) and ` +
        `binding.identity.onServiceAccount is "block"${defaultNote}.`,
    };
  }

  if (!isLowSensitivity(input.sensitivity)) {
    return {
      status: 'disabled_identity_unverified',
      disabled: true,
      disposition,
      detail:
        `${input.toolId} is auto-disabled: the probe reports service-account execution (identity.carries: no) and ` +
        `binding.identity.onServiceAccount is "readonly-lowsens", but the tool's sensitivity ` +
        `${JSON.stringify(input.sensitivity ?? null)} is above the low-sensitivity ceiling "${LOW_SENSITIVITY_CEILING}". ` +
        `01 §8 R1 constrains such a tool to read-only AND low-sensitivity data, or blocks it.`,
    };
  }

  return {
    status: 'degraded_readonly',
    disabled: false,
    disposition,
    detail:
      `${input.toolId} is constrained to read-only, low-sensitivity access: the probe reports service-account ` +
      `execution (identity.carries: no), the tool is a read, its sensitivity ${JSON.stringify(input.sensitivity)} is ` +
      `at or below "${LOW_SENSITIVITY_CEILING}", and binding.identity.onServiceAccount is "readonly-lowsens" (02 §3.5).`,
  };
}
