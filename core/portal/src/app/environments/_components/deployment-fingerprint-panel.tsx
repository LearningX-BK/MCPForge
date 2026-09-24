'use client';

// MCPForge — W0-J17: the deployment fingerprint (03 §5.3 "This deployment",
// §11.1). "One screen that answers 'what am I actually looking at.'"
import { EnvChip } from '../../../components/chips';
import { DataClassChip } from './data-class-chip';
import { asOfLabel, isStale } from '../staleness';
import { STALE_AFTER_HOURS } from '../fixtures';
import { NO_REMOTE_LABEL } from '../../../components/shell/branch-chip';
import type { DeploymentFingerprint } from '../types';

export interface DeploymentFingerprintPanelProps {
  fingerprint: DeploymentFingerprint;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1 border-b border-line py-2 text-[13px]/[1.5] last:border-b-0">
      <dt className="text-text-2">{label}</dt>
      <dd className="text-text-1">{children}</dd>
    </div>
  );
}

export function DeploymentFingerprintPanel({ fingerprint: fp }: DeploymentFingerprintPanelProps) {
  const remoteLabel = fp.gitRemote.configured ? fp.gitRemote.name : NO_REMOTE_LABEL;
  const probeStale = fp.lastProbeRun ? isStale(fp.lastProbeRun.finishedAt, STALE_AFTER_HOURS) : true;

  return (
    <section
      aria-labelledby="deployment-fingerprint-heading"
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="deployment-fingerprint-heading" className="font-display text-lg text-text-1">
          This deployment
        </h2>
        <EnvChip envClass={fp.envClass} />
        <DataClassChip store={fp.store} />
      </div>

      <dl>
        <Row label="Environment class">{fp.envClass}</Row>
        <Row label="Gateway version">
          <span className="font-mono">{fp.gatewayVersion}</span>
        </Row>
        <Row label="Bundle version">
          <span className="font-mono">{fp.bundleVersion}</span>
        </Row>
        <Row label="Deployed package">{fp.deployedPackage}</Row>
        <Row label="Catalogue artefact digest">
          <span className="font-mono">{fp.catalogueDigest}</span>
        </Row>
        <Row label="Datastore">
          {fp.store.label} — <span className="font-mono">{fp.store.location}</span>
        </Row>
        <Row label="Git remote">{remoteLabel}</Row>
        <Row label="Identity provider">{fp.identityProviderLabel}</Row>
        <Row label="Last probe run">
          {fp.lastProbeRun ? (
            <span className="inline-flex items-center gap-2">
              <span>{fp.lastProbeRun.toolCount} tools probed</span>
              <span
                data-testid="last-probe-staleness"
                className={
                  probeStale
                    ? 'rounded-full border border-status-write-border bg-status-write-bg px-2 py-0.5 text-[10.5px] font-bold text-status-write-strong'
                    : 'text-text-2'
                }
              >
                {asOfLabel(fp.lastProbeRun.finishedAt)}
                {probeStale ? ' — stale' : ''}
              </span>
            </span>
          ) : (
            <span className="text-text-2">No probe has run yet. Run <code className="font-mono">forge probe</code>.</span>
          )}
        </Row>
        <Row label="Kill flags in force">
          {fp.killFlags.length === 0 ? (
            <span className="text-text-2">None</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {fp.killFlags.map((flag) => (
                <li key={flag.id}>
                  <span className="font-mono">{flag.scope}:{flag.target}</span> — {flag.reason} (by{' '}
                  {flag.createdBy})
                </li>
              ))}
            </ul>
          )}
        </Row>
        {fp.secretPosture && (
          <Row label="Secret store">
            {fp.secretPosture.storeKind} — {fp.secretPosture.overdueCount} of{' '}
            {fp.secretPosture.totalCount} credential(s) past their rotation window
            {fp.secretPosture.criticalCount > 0
              ? ` (${fp.secretPosture.criticalCount} critical)`
              : ''}
          </Row>
        )}
      </dl>
    </section>
  );
}
