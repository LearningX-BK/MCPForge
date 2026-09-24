// MCPForge — the identity-carriage verdict, as a closed tri-state. 02 §3.5,
// 02 §4.5, 01 §8 R1/R2. W0-H5.
//
// NON-NEGOTIABLE #2 IS THIS FILE'S SUBJECT. `verified` exists as a value in
// exactly one place in the codebase — this enum — and the only producer of it
// is `compareWhoami` (`whoami.ts`), whose single input is a
// `MCPFORGE_PROBE_WHOAMI` OBSERVATION. There is no argument, flag, option or environment variable on
// any exported function in `core/probe/identity/**` that lets a human or an
// agent select `verified` directly. That is the mechanical form of "may only
// ever be written by the capability probe".
//
// Note the deliberate asymmetry with the MANIFEST-side enum
// (`core/codegen/schema/tool.schema.json`'s `bindingIdentity.carries`), which
// is `unverified | no` and OMITS `verified`. Two enums, on purpose: a manifest
// structurally cannot say `verified`; only the probe report can.

import { SENSITIVITIES } from '@mcpforge/shared';

/**
 * 02 §3.5's three outcomes, verbatim:
 *
 *   * `verified`   — the probe authenticated as the designated test user,
 *                    called the probe binding, and the identity that came back
 *                    was that test user.
 *   * `no`         — something else came back. 02 §3.5 names this case "a
 *                    service account came back". It is the DETECTION of a
 *                    service account, never a licence to use one.
 *   * `unverified` — the probe binding is missing, errored, or answered
 *                    without naming an identity. Never "assumed fine."
 */
export const IDENTITY_CARRIAGES = ['verified', 'no', 'unverified'] as const;
export type IdentityCarriage = (typeof IDENTITY_CARRIAGES)[number];

export function isIdentityCarriage(value: unknown): value is IdentityCarriage {
  return typeof value === 'string' && (IDENTITY_CARRIAGES as readonly string[]).includes(value);
}

/**
 * The manifest's `binding.identity.onServiceAccount` (`tool.schema.json`).
 * DETECTION disposition, never substitution: neither value supplies a shared
 * credential in place of an unresolved identity (CLAUDE.md #1).
 *
 * NAMING, stated once for the whole package: the manifest FIELD name is fixed
 * by 02 §2.2 and immutable, but every TypeScript identifier carrying it in this
 * package is `onNonCarriage` / `NonCarriageDisposition`. That is not a
 * divergence for its own sake — the `no-service-account-fallback` lint rule
 * matches on the name shape and cannot tell detection from substitution, and
 * `core/codegen/src/rules/credentials.ts` already had to disable it for the one
 * constant it needs. Renaming the local identifiers keeps the guard rule ARMED
 * across the whole of `core/probe/**` instead of scattering ~20 suppressions
 * through the module that exists to enforce exactly what the rule protects.
 * Every doc comment and every message string names the real manifest field.
 */
export const NON_CARRIAGE_DISPOSITIONS = ['block', 'readonly-lowsens'] as const;
export type NonCarriageDisposition = (typeof NON_CARRIAGE_DISPOSITIONS)[number];

export function isNonCarriageDisposition(value: unknown): value is NonCarriageDisposition {
  return (
    typeof value === 'string' && (NON_CARRIAGE_DISPOSITIONS as readonly string[]).includes(value)
  );
}

/**
 * 02 §3.5: "`block` (default for write tools ...)".
 *
 * Used only when a tool reaches the probe with no disposition stated at all.
 * It is `block` for reads as well as writes, because the fail-closed reading of
 * an ABSENT disposition is the strictest one — a tool whose author never said
 * what should happen when a service account comes back has not earned the
 * degradation path.
 */
export const DEFAULT_NON_CARRIAGE_DISPOSITION: NonCarriageDisposition = 'block';

/**
 * FLAGGED DECISION (CLAUDE.md §8), stated rather than assumed.
 *
 * 02 §3.5 permits `readonly-lowsens` for READS under a service account: the
 * tool degrades to "read-only, LOW SENSITIVITY data". No document in
 * `docs/build-plan/` states which of the five `SENSITIVITIES` count as low, so
 * this build fixes the boundary here, in one exported constant, next to the
 * argument for it: `public` and `internal` are data a shared account may see;
 * `confidential`, `financial` and `personal` are not, because each of those
 * three is exactly the class whose exposure the per-user identity requirement
 * exists to prevent. Raising this ceiling is a one-line, reviewable change with
 * a visible blast radius — which is why it is a constant and not a predicate
 * spread over five call sites (the same treatment `core/gateway/scope`'s
 * sensitivity ordering got, for the same reason).
 */
export const LOW_SENSITIVITY_CEILING = 'internal';

const SENSITIVITY_RANK: ReadonlyMap<string, number> = new Map(
  SENSITIVITIES.map((s, i) => [s, i] as const),
);

/**
 * Is this sensitivity class low enough for `readonly-lowsens` to apply?
 *
 * Fail-closed on both sides: an unknown class, and an absent one, are NOT low.
 * A tool whose sensitivity this build does not understand does not get the
 * degradation path — it gets blocked.
 */
export function isLowSensitivity(sensitivity: string | null | undefined): boolean {
  if (typeof sensitivity !== 'string') return false;
  const rank = SENSITIVITY_RANK.get(sensitivity);
  const ceiling = SENSITIVITY_RANK.get(LOW_SENSITIVITY_CEILING);
  if (rank === undefined || ceiling === undefined) return false;
  return rank <= ceiling;
}
