// MCPForge — the closed probe status enum. 02 §4.5. W0-H4.
//
// "Status is a closed enum ... There is no third state and no silent failure —
// every tool in the catalogue has exactly one of these after every probe run."
//
// This list is declared here, in the package that WRITES the status, and a
// drift test (`status.test.ts`) asserts it is identical to the list
// `core/gateway/scope/types.ts` READS. Two independent statements of the same
// closed set, checked against each other, rather than one package importing
// the other's runtime at boot.

export const PROBE_STATUSES = [
  'resolved',
  'degraded_readonly',
  'disabled_missing_binding',
  'disabled_no_grant',
  'disabled_identity_unverified',
  'disabled_schema_drift',
  'disabled_kill_switch',
] as const;

export type ProbeStatus = (typeof PROBE_STATUSES)[number];

export const PROBE_STATUS_SET: ReadonlySet<string> = new Set<string>(PROBE_STATUSES);

export function isProbeStatus(value: unknown): value is ProbeStatus {
  return typeof value === 'string' && PROBE_STATUS_SET.has(value);
}

/**
 * 02 §5.1 / 02 §4.5: a tool that is not `resolved` or `degraded_readonly` is
 * excluded from `tools/list` (it stays findable through `forge.find`). Mirrors
 * `core/gateway/scope`'s `PROBE_ENABLED_STATUSES`; the same drift test covers it.
 */
export const PROBE_ENABLED_STATUSES: ReadonlySet<ProbeStatus> = new Set<ProbeStatus>([
  'resolved',
  'degraded_readonly',
]);

/**
 * A status a FAILING CHECK may itself ask for. `disabled_kill_switch` is
 * deliberately absent: it is not a check outcome, it is a runtime-flag fact
 * evaluated before any check runs (02 §4.7). `resolved` is absent because it is
 * the residue when nothing failed, never something a failure can select.
 */
export const CHECK_FAILURE_STATUSES = [
  'disabled_missing_binding',
  'disabled_no_grant',
  'disabled_identity_unverified',
  'disabled_schema_drift',
  'degraded_readonly',
] as const;

export type CheckFailureStatus = (typeof CHECK_FAILURE_STATUSES)[number];

/**
 * The single, fixed precedence order used to reduce a set of failing checks to
 * exactly one status. Most-disabling first, so a tool whose binding is missing
 * AND whose identity is unverified reports the fact that comes first in the
 * causal chain rather than whichever check happened to be listed first.
 *
 * `resolved` is last and is reached only when nothing above it applies. That is
 * what makes "exactly one status, never undefined" a property of the reducer
 * rather than a convention: the list is total over `ProbeStatus`.
 */
export const STATUS_PRECEDENCE: readonly ProbeStatus[] = [
  'disabled_kill_switch',
  'disabled_missing_binding',
  'disabled_no_grant',
  'disabled_identity_unverified',
  'disabled_schema_drift',
  'degraded_readonly',
  'resolved',
];
