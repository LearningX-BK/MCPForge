// MCPForge — `POST /api/v1/admin/probe`: a super admin runs the capability
// probe from the portal, in a `local` deployment only. W0-P33d.
//
// Decision D of the approved W0-P33 design note (owner, 30 Sep 2026: "Local
// and dev only (Recommended)"), docs/build-plan/w0-p33-portal-merge.md §2.5:
// "a super admin may trigger `forge probe` from the portal for environment
// class `local` and `dev` only. For `staging` and `prod` it stays a CLI act,
// because the probe runs checks against a real instance." 02 §7.1's "dev" row
// is the `local` class; `probe`, `staging` and `prod` are refused with a `next`
// that names the CLI command (`mayProbeFromPortal`, `@mcpforge/probe`).
//
// WHO MAY PROBE. The same two halves as the catalogue reload (W0-P33c), after
// the read API's front door has resolved a registered consumer AND a human:
//
//  1. The consumer allows writes AND attests a human in its loop. A probe run
//     changes which tools every session is served, and it is a human's act.
//  2. The human holds a `superAdmins:` group of this deployment's git mapping.
//
// WHAT RUNS. `probeDeployment`, the one implementation `forge probe` also
// runs: the definitions root is probed, the report is written under the
// install root. The probe itself writes nothing to a target (its plans are
// read-only or validate-only by construction, 02 §4.5) and nothing to git:
// `identityCarries` reaches the probe report and nowhere else (non-negotiable 2).
//
// EVIDENCE BEFORE EFFECT. Every attempt that passed the front door appends one
// hash-chained `probe` audit row. For a run that completes, the row (carrying
// the report's sha256 and its status counts) is appended BEFORE the report is
// written, so a report the trail does not record is never served. Then the
// catalogue is reloaded (W0-P33c, its own `catalogue` row) so the gateway
// serves the new statuses: "the report updates enablement". A refused reload
// leaves the previous statuses serving, and the response says so.
//
// The request takes no body: it cannot name a target, an environment class, a
// deployment or a path. All of those are the gateway's own.

import { createHash } from 'node:crypto';
import { PROBE_RUN_PATH } from '@mcpforge/shared/api/v1';
import type { ProbeRunResponse } from '@mcpforge/shared/api/v1';
import {
  mayProbeFromPortal,
  type DeploymentProbeOutcome,
  type EnvironmentClass,
  type ProbeReport,
} from '@mcpforge/probe';
import type { EstablishedSession } from '../../assembly/session.js';
import type { AppendAuditCallInput, AuditCallRecord } from '../../store/audit/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import { ApiRefusal } from './refusal.js';

/** The tool id a `probe` audit row names: a probe run touches every tool, not one. */
export const PROBE_PSEUDO_TOOL_ID = 'forge.probe.run';

/** The API-only refusal for an environment class the portal may not probe. HTTP 403. */
export const PROBE_ENVIRONMENT_REFUSED = 'PROBE_ENVIRONMENT_REFUSED';

/** True when `pathname` is the portal-probe path. */
export function isProbeRunPath(pathname: string): boolean {
  return pathname === PROBE_RUN_PATH;
}

/** The probe seam the launch assembly provides. */
export interface ProbeRunSource {
  /** This deployment's environment class (`MCPFORGE_ENV` at launch). */
  readonly environmentClass: EnvironmentClass;
  /** The probe target's name, as `forge probe --target` would give it. */
  readonly targetId: string;
  /** Probe the definitions root. Never writes. */
  run(): Promise<DeploymentProbeOutcome>;
  /** Write the report under the install root (`writeProbeReport`). */
  write(report: ProbeReport): void;
}

/** What the reload after a run did. */
export type ProbeReloadResult =
  | { readonly served: true; readonly generation: number; readonly auditCallId: string }
  | {
      readonly served: false;
      /** The generation still serving the previous statuses. */
      readonly generation: number;
      readonly auditCallId: string | null;
      /** Why, and what to do: the reload refusal's own `next`. */
      readonly reloadNext: string;
    };

export interface ProbeRunDeps {
  readonly store: Pick<RuntimeStore, 'audit' | 'transaction'>;
  readonly prober: ProbeRunSource;
  /** The `superAdmins:` groups, as the generation serving this request holds them. */
  readonly superAdminGroups: readonly string[];
  /** Reload the catalogue as the same actor, so the new report is served. */
  reload(): Promise<ProbeReloadResult>;
  readonly gatewayVersion: string;
  readonly now: () => Date;
}

export interface ProbeActor {
  readonly session: EstablishedSession;
  readonly subject: string;
  readonly correlationId: string;
}

type DeniedRule =
  | 'probe.consumer_not_authorized'
  | 'probe.not_super_admin'
  | 'probe.environment_not_portal'
  | 'probe.unconfigured'
  | 'probe.failed';

/** sha256 over the report exactly as `writeProbeReport` serialises it. */
export function probeReportSha256(report: ProbeReport): string {
  return createHash('sha256')
    .update(`${JSON.stringify(report, null, 2)}\n`)
    .digest('hex');
}

/**
 * Run the probe as `actor`. Resolves with the run that happened, or throws an
 * `ApiRefusal`. Either way exactly one `probe` audit row was committed.
 */
export async function runPortalProbe(
  deps: ProbeRunDeps,
  actor: ProbeActor,
): Promise<ProbeRunResponse> {
  const environmentClass = deps.prober.environmentClass;
  const deploymentId = actor.session.scopeAt(deps.now()).deployment.deploymentId;

  // 1. The consumer half.
  const consumer = actor.session.scopeSession.consumer;
  if (!consumer.authorizations.writeAllowed || !consumer.attestation.humanInTheLoop) {
    await appendRow(
      deps,
      refusedRow(deps, actor, 'probe.consumer_not_authorized', 'CONSUMER_NOT_AUTHORIZED', {
        message: 'The consumer may not run the capability probe.',
      }),
    );
    throw new ApiRefusal(
      'CONSUMER_NOT_AUTHORIZED',
      `Consumer ${consumer.consumerId} may not run the capability probe: that needs a registration that allows writes and attests a human in the loop.`,
      'Run the probe from the MCPForge portal, whose registration allows writes with a human in the loop, or run forge probe on the gateway host. A consumer registration is widened only through a reviewed change proposal.',
    );
  }

  // 2. The human half.
  const groups = actor.session.principal.groups;
  if (!groups.some((g) => deps.superAdminGroups.includes(g))) {
    await appendRow(
      deps,
      refusedRow(deps, actor, 'probe.not_super_admin', 'TOOL_NOT_IN_SCOPE', {
        message: 'Only a super admin may run the capability probe from the portal.',
      }),
    );
    throw new ApiRefusal(
      'TOOL_NOT_IN_SCOPE',
      'Running the capability probe from the portal is limited to super admins, and none of your groups is one.',
      'Ask a super admin (a member of a superAdmins group in the git mapping) to run the probe, or an operator to run forge probe on the gateway host.',
    );
  }

  // 3. The environment class: the portal probes `local` deployments only.
  if (!mayProbeFromPortal(environmentClass)) {
    await appendRow(
      deps,
      refusedRow(deps, actor, 'probe.environment_not_portal', PROBE_ENVIRONMENT_REFUSED, {
        message: `The portal does not run the probe in a ${environmentClass} deployment.`,
      }),
    );
    throw new ApiRefusal(
      PROBE_ENVIRONMENT_REFUSED,
      `This deployment's environment class is ${environmentClass}. The portal runs the capability probe only in a local deployment, because elsewhere the probe runs its checks against a real instance.`,
      `Run it from the CLI on the gateway host: forge probe --env ${environmentClass} --deployment ${deploymentId}. Then reload the catalogue from the portal (or restart the gateway) so the new statuses are served.`,
    );
  }

  // 4. The run: read-only and validate-only checks; nothing is written yet.
  let outcome: DeploymentProbeOutcome;
  try {
    outcome = await deps.prober.run();
  } catch (error) {
    await appendRow(deps, {
      ...baseRow(deps, actor, { action: 'probe', environmentClass }),
      outcome: 'binding_error',
      errorCode: 'INTERNAL',
      errorMessageAgent: 'The capability probe failed before it produced a report.',
      deniedByRule: 'probe.failed' satisfies DeniedRule,
    });
    throw error;
  }
  if (!outcome.ok) {
    await appendRow(deps, {
      ...baseRow(deps, actor, { action: 'probe', environmentClass }),
      outcome: 'business_error',
      errorCode: outcome.code,
      errorMessageAgent: outcome.message,
      deniedByRule: 'probe.unconfigured' satisfies DeniedRule,
    });
    throw new ApiRefusal(outcome.code, `The probe did not run: ${outcome.message}`, outcome.next);
  }

  // 5. Evidence, then effect: the row, then the report, then the reload.
  const report = outcome.report;
  const reportSha = probeReportSha256(report);
  const recorded = await appendRow(deps, {
    ...baseRow(deps, actor, {
      action: 'probe',
      environmentClass,
      targetId: report.target.id,
      toolCount: report.summary.toolCount,
      byStatus: { ...report.summary.byStatus },
    }),
    targetEnv: report.target.id,
    outcome: 'ok',
    resultKeys: [
      { keyName: 'probeReportSha256', keyValue: reportSha },
      { keyName: 'probeFinishedAt', keyValue: report.finishedAt },
    ],
  });
  deps.prober.write(report);
  const reload = await deps.reload();

  const resolved = report.summary.byStatus['resolved'] ?? 0;
  return {
    asOf: deps.now().toISOString(),
    deploymentId: report.target.deploymentId,
    environmentClass: report.target.environmentClass,
    targetId: report.target.id,
    finishedAt: report.finishedAt,
    toolCount: report.summary.toolCount,
    byStatus: { ...report.summary.byStatus },
    auditCallId: recorded.id,
    enablement: {
      served: reload.served,
      generation: reload.generation,
      reloadAuditCallId: reload.auditCallId,
    },
    next: reload.served
      ? `The probe report is written and catalogue generation ${reload.generation} serves it: ${resolved} of ${report.summary.toolCount} tools resolved. Every tool that is not resolved is on the enablement backlog with its failing check, remediation and owning team.`
      : `The probe report is written, but the catalogue reload was refused, so generation ${reload.generation} still serves the previous statuses. ${reload.reloadNext}`,
  };
}

// --- audit rows ------------------------------------------------------------------

function appendRow(deps: ProbeRunDeps, row: AppendAuditCallInput): Promise<AuditCallRecord> {
  return deps.store.transaction(() => deps.store.audit.append(row));
}

function refusedRow(
  deps: ProbeRunDeps,
  actor: ProbeActor,
  rule: DeniedRule,
  errorCode: string,
  detail: { readonly message: string },
): AppendAuditCallInput {
  return {
    ...baseRow(deps, actor, { action: 'probe', environmentClass: deps.prober.environmentClass }),
    outcome: 'policy_denied',
    errorCode,
    errorMessageAgent: detail.message,
    deniedByRule: rule,
  };
}

/** The columns every `probe` row carries, as `catalogue-reload.ts` writes them. */
function baseRow(
  deps: ProbeRunDeps,
  actor: ProbeActor,
  args: Readonly<Record<string, unknown>>,
): Omit<AppendAuditCallInput, 'outcome'> {
  const at = deps.now();
  const scope = actor.session.scopeAt(at);
  const session = actor.session.scopeSession;
  const principal = actor.session.principal;
  return {
    ts: at.toISOString(),
    correlationId: actor.correlationId,
    sessionId: actor.session.sessionId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId: PROBE_PSEUDO_TOOL_ID,
    // The probe's checks are read-only or validate-only by construction.
    isWrite: false,

    deploymentId: scope.deployment.deploymentId,
    gatewayVersion: deps.gatewayVersion,

    phase: 'probe',
    argsRedacted: { ...args },
  };
}
