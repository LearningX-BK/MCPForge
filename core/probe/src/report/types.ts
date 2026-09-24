// MCPForge — `probe-report.json`'s shape. 02 §4.5 ("a machine-readable
// artefact, not a log"), extended by 02 §11.4.3. W0-H4.
//
// The per-tool entry is field-for-field with 02 §4.5's worked example:
// toolId · status · bindingType · checks[] · identityCarries · commitsInternally
// · owningTeam · remediation · agentMessage. Nothing is renamed and nothing the
// example carries is dropped.
//
// NON-NEGOTIABLE #2 lives here and nowhere else. `identityCarries` is written
// by this package, into this artefact, and by no other writer — there is no
// exported function anywhere in this repo that writes `identity.carries` back
// into a manifest, and `core/probe/**` contains no `manifests/` write path at
// all. W0-H5 supplies the actual `whoami` comparison that decides the value;
// this task owns the field and its schema.

import type { BindingType } from '@mcpforge/shared/manifest';
import type { ToolIdentityReport } from '../identity/assess.js';
import type { ProbeCheckResult } from '../plan/types.js';
import type { ProbeStatus } from '../status.js';
import type { EnvironmentClass } from '../target.js';

export const PROBE_REPORT_API_VERSION = 'mcpforge/v1' as const;
export const PROBE_REPORT_KIND = 'ProbeReport' as const;

/**
 * 02 §11.4.3 — [P5]. The gateway's compiled `bindingGrants` and the
 * database-side `EXECUTE` grants are two independent statements of the same
 * fact; a name present on one side only is a probe finding.
 *
 * WAVE 0 HONESTY: no `plsql` binding and no live database exist yet, so
 * `evidence` is `fixture` in every run this repository can perform today, and
 * `unavailable` when no grant source was supplied at all. `live` is written
 * only by a source that actually queried `ALL_TAB_PRIVS`. The field exists so
 * the Wave 2 change is a new source implementation, not a schema migration.
 */
export type GrantEvidence = 'fixture' | 'live' | 'unavailable';

export interface BindingGrantReconciliation {
  readonly evidence: GrantEvidence;
  /** Wrapper package names named by the compiled gateway `bindingGrants`. */
  readonly gatewayGrants: readonly string[];
  /** Wrapper package names the database holds an EXECUTE grant on. */
  readonly databaseGrants: readonly string[];
  /** Gateway says yes, database says no. */
  readonly gatewayOnly: readonly string[];
  /** Database says yes, gateway says no. */
  readonly databaseOnly: readonly string[];
  readonly reconciled: boolean;
}

/**
 * W0-H2 — validate-pair presence, per write tool. 02 §3.5, 01 §10.5 item 2.
 *
 * "The probe reports validate-pair presence per write tool and a missing pair is
 * visible in the enablement backlog with its owning team named."
 *
 * The enablement backlog IS this artefact (02 §4.5: the portal's Application
 * Enablement page renders it, per app, with owners), so this block is a field on
 * the tool report rather than a second reporting channel. The owning team is the
 * report entry's own `owningTeam`, and `remediation` — which already names the
 * owner for every status — carries it into the human-facing backlog line.
 *
 * `present` is `true` ONLY when the `validate_sibling` check actually PASSED.
 * A check that failed, a check that never ran (no executor, no live target) and
 * a tool the probe could not reach all produce `false`, because the consumer of
 * this block — `adapters/function`'s degradation ladder — must treat "we could
 * not tell" exactly like "it is not there".
 */
export interface ValidatePairReport {
  /** The `X_VALIDATE` sibling looked for. `null` when `binding.ref` is unknown. */
  readonly expectedRef: string | null;
  /** True only on a PASSED `validate_sibling` check. Never on an absence. */
  readonly present: boolean;
  /** How `present` was established. `not_probed` is not evidence of presence. */
  readonly evidence: 'probe_check' | 'not_probed';
  /** Never empty. The check's own detail, or why no check ran. */
  readonly detail: string;
  /** What the dry run will actually do — 02 §3.5's ladder, reported not guessed. */
  readonly effectiveDryRunStrategy: 'validate-pair' | 'precondition-read';
  /**
   * 02 §3.5: `humanApprovalRequired` is forced to `true` for any tool with
   * `sensitivity: financial` whose pair is missing. Reported here so the
   * degradation is VISIBLE in the backlog rather than only enforced at runtime.
   */
  readonly humanApprovalForced: boolean;
  /** The enablement-backlog line. Names the action and the owning team. */
  readonly enablementAction: string | null;
}

/** One tool's probe result. Exactly one `status`, always. */
export interface ProbeToolReport {
  readonly toolId: string;
  readonly status: ProbeStatus;
  readonly bindingType: BindingType;
  readonly checks: readonly ProbeCheckResult[];
  /**
   * Non-negotiable #2's field. `true` only when a check proved the target saw
   * the human's identity; `null` when nothing established it either way.
   */
  readonly identityCarries: boolean | null;
  /**
   * W0-H5. The tri-state verdict of 02 §3.5 (`verified | no | unverified`) plus
   * the automatic constraint it forced, the designated test user, the identity
   * the target reported, and the `onServiceAccount` disposition applied.
   * `identityCarries` above is DERIVED from `identity.carries`
   * (`identityCarriesBoolean`), so the two cannot disagree.
   */
  readonly identity: ToolIdentityReport;
  /** 02 §3.4. `null` until PROBE_COMMIT_BEHAVIOUR has classified it. */
  readonly commitsInternally: boolean | null;
  /** From the owning module server manifest's `owner`. Never empty. */
  readonly owningTeam: string;
  /** For humans. Names an action and an owner. Never empty. */
  readonly remediation: string;
  /** For agents. Names whether to retry. Never empty. */
  readonly agentMessage: string;
  /** [P5] `plsql` tools only. Absent for every other binding type. */
  readonly bindingGrantReconciliation?: BindingGrantReconciliation;
  /**
   * W0-H2. `function`-binding WRITE tools only — the `X_EXECUTE`/`X_VALIDATE`
   * convention is 02 §3.5's and belongs to this binding type. Absent everywhere
   * else, so a reader cannot mistake "not applicable" for "pair missing".
   */
  readonly validatePair?: ValidatePairReport;
}

export interface ProbeReportTarget {
  readonly id: string;
  readonly environmentClass: EnvironmentClass;
  readonly deploymentId: string;
  /** True when the runner refused every mutating check for this target. */
  readonly mutatingChecksRefused: boolean;
}

export interface ProbeReport {
  readonly apiVersion: typeof PROBE_REPORT_API_VERSION;
  readonly kind: typeof PROBE_REPORT_KIND;
  readonly target: ProbeReportTarget;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Sorted by tool id, so two runs of the same catalogue diff cleanly. */
  readonly tools: readonly ProbeToolReport[];
  readonly summary: ProbeReportSummary;
}

export interface ProbeReportSummary {
  readonly toolCount: number;
  /** Every one of the seven statuses is a key, zero included — a status that
   *  vanishes when its count is zero makes "no silent failure" unauditable. */
  readonly byStatus: Readonly<Record<ProbeStatus, number>>;
}
