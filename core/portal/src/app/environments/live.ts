// MCPForge — W0-P3b: `/api/v1/deployment` + `/api/v1/enablement` -> the
// Environments view shapes. Runtime facts come from the gateway; the git
// remote comes from the ChangeHost (definitional). Anything neither source
// reports is left undefined or named as not reported, never fabricated.

import type { DeploymentResponse, EnablementResponse } from '@mcpforge/shared/api/v1';

import type { RemoteInfo } from '@/lib/change-host/types';

import type {
  DeploymentFingerprint,
  EnablementBacklogGroup,
  EnablementEntry,
  ProbeStatus,
} from './types';

/** Wave 0 runs local only (CLAUDE.md §3.1); `/api/v1` reports no environment class yet. */
const WAVE0_ENV_CLASS = 'local' as const;

export function toFingerprint(
  d: DeploymentResponse,
  enablement: EnablementResponse | null,
  remote: RemoteInfo,
): DeploymentFingerprint {
  return {
    envClass: WAVE0_ENV_CLASS,
    gatewayVersion: d.gatewayVersion,
    bundleVersion: 'not reported',
    deployedPackage: d.packageIds.length > 0 ? d.packageIds.join(', ') : 'none selected',
    catalogueDigest: d.catalogueDigest,
    store: {
      kind: d.store.kind,
      label: d.store.label,
      // The gateway does not publish its filesystem layout over HTTP.
      location: 'on the gateway host',
      ephemeral: d.store.ephemeral,
    },
    gitRemote: remote.configured ? { configured: true, name: remote.name } : { configured: false },
    identityProviderKind: d.identityProviderKind as DeploymentFingerprint['identityProviderKind'],
    identityProviderLabel:
      d.identityProviderKind === 'local' ? 'Local user store' : d.identityProviderKind,
    lastProbeRun:
      enablement?.probe == null
        ? null
        : {
            deploymentId: enablement.probe.deploymentId,
            environmentClass: enablement.probe
              .environmentClass as DeploymentFingerprint['envClass'],
            finishedAt: enablement.probe.finishedAt,
            toolCount: enablement.probe.toolCount,
          },
    killFlags: d.killFlags.map((f) => ({
      ...f,
      scope: f.scope as DeploymentFingerprint['killFlags'][number]['scope'],
    })),
    // `/api/v1` does not report secret-rotation posture yet: left undefined,
    // which the panel renders as "not reported" (never fabricated).
    secretPosture: undefined,
  };
}

/**
 * Every tool in the viewer's scope that is not `resolved`, grouped by owning
 * team. A tool with no probe report is in the backlog too: nobody has
 * confirmed it works, so it is not enabled (02 §4.5).
 */
export function toBacklog(e: EnablementResponse): readonly EnablementBacklogGroup[] {
  const byTeam = new Map<string, EnablementEntry[]>();
  for (const t of e.tools) {
    if (t.status === 'resolved') continue;
    const owningTeam = t.owningTeam ?? 'Not yet probed';
    const entry: EnablementEntry = {
      toolId: t.toolId,
      app: t.toolId.split('.')[0] ?? '',
      status: t.status as ProbeStatus | null,
      failingCheck: t.failingCheck ?? (t.status === null ? 'no probe report' : 'not reported'),
      remediation:
        t.remediation ??
        (t.status === null
          ? 'Run the capability probe (forge probe) against this deployment’s target.'
          : 'See the probe report for this tool.'),
      owningTeam,
    };
    byTeam.set(owningTeam, [...(byTeam.get(owningTeam) ?? []), entry]);
  }
  return [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owningTeam, entries]) => ({ owningTeam, entries }));
}
