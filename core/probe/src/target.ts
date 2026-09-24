// MCPForge — the probe target and its environment class. 02 §4.5, 02 §7.1,
// 03 §11.1. W0-H4.
//
// JUDGMENT CALL, flagged in this task's report rather than decided silently:
// this repository had no environment-class representation before this file.
// `audit_call.target_env` is free text (a target instance name such as
// `py920`), the overlays hold no env field yet, and nothing in
// `core/gateway/**` classifies an environment. Rather than invent a private
// mechanism, this reuses the four classes 02 §7.1 states and 03 §11.1 renders
// verbatim ("Four classes, matching Phase 2 §7.1 exactly"), spelled as 03
// spells them — `local` for 02's "dev (local)" row. A later task giving the
// deployment fingerprint a real source (W0-J17) should read THIS enum rather
// than declaring a second one.
//
// 02 §4.5: "the probe runner refuses to run against a target flagged
// `production` for any check classified as mutating". `prod` is that flag.
// 02 §7.1 says the same thing from the other side — "prod: Probe runs in
// read-only mode only", and "all destructive classification happens [in
// `probe`], never in production".

export const ENVIRONMENT_CLASSES = ['local', 'probe', 'staging', 'prod'] as const;
export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number];

export function isEnvironmentClass(value: unknown): value is EnvironmentClass {
  return typeof value === 'string' && (ENVIRONMENT_CLASSES as readonly string[]).includes(value);
}

/** One target the probe runs against. */
export interface ProbeTarget {
  /** The target instance name — the value that reaches `audit_call.target_env`. */
  readonly id: string;
  readonly environmentClass: EnvironmentClass;
  /** The deployment this probe run belongs to. */
  readonly deploymentId: string;
}

/**
 * The single place "is this production" is decided. One predicate, one enum
 * member — so widening it is a one-line diff a reviewer cannot miss.
 */
export function isProductionTarget(target: ProbeTarget): boolean {
  return target.environmentClass === 'prod';
}
