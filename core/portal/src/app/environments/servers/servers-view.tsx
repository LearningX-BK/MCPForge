// MCPForge — W0-P6: the `/environments/servers` body. Pure props, so the page
// and the tests render the same thing. Every state is distinct: a server with
// no tools, a probe nobody has run, a probe that could not be read, and a
// kill-switch that is not set are different sentences.

import * as React from 'react';
import { PROBE_STATUS, type BindingType, type ProbeStatus } from '@mcpforge/shared';

import { BindingChip, ProbeStatusChip } from '@/components/chips';
import { LiveStateNotice, type LiveNotice } from '@/components/live/live-state-notice';

import { EnvNav } from '../_components/env-nav';
import type { ServerInventoryRow } from './load-servers';

export interface ServersViewProps {
  readonly servers: readonly ServerInventoryRow[];
  /** Set when a runtime read failed; the git half is still shown. */
  readonly runtimeNotice?: undefined | { readonly state: LiveNotice; readonly subject: string };
}

const MODE_LABEL = { A: 'A — in-process', B: 'B — own process' } as const;

const isProbeStatus = (s: string): s is ProbeStatus => s in PROBE_STATUS;

/** The Catalog filtered to one server (any query param skips the default status facets). */
export function catalogLinkFor(serverId: string): string {
  return `/catalog?${new URLSearchParams({ server: serverId }).toString()}`;
}

function ProbeCell({ row }: { row: ServerInventoryRow }): React.ReactElement {
  if (row.probe.kind === 'unknown') {
    return (
      <span data-testid={`probe-unknown-${row.id}`} className="text-text-2">
        Unknown — probe status could not be read
      </span>
    );
  }
  const { byStatus, notProbed } = row.probe.summary;
  if (row.toolIds.length === 0) return <span className="text-text-2">No tools to probe</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {byStatus.map(({ status, count }) => (
        <span key={status} className="inline-flex items-center gap-1">
          {isProbeStatus(status) ? (
            <ProbeStatusChip status={status} />
          ) : (
            <span className="text-text-1">{status}</span>
          )}
          <span className="text-text-2">×{count}</span>
        </span>
      ))}
      {notProbed > 0 ? <span className="text-text-2">{notProbed} not probed</span> : null}
      {byStatus.length === 0 && notProbed === 0 ? (
        <span className="text-text-2">Not reported to you</span>
      ) : null}
    </span>
  );
}

function KillCell({ row }: { row: ServerInventoryRow }): React.ReactElement {
  if (row.kill.kind === 'unknown') {
    return (
      <span data-testid={`kill-unknown-${row.id}`} className="text-text-2">
        Unknown — kill-switch state could not be read
      </span>
    );
  }
  const { serverFlags, killedToolCount } = row.kill;
  if (serverFlags.length === 0 && killedToolCount === 0) {
    return <span className="text-text-1">Not killed</span>;
  }
  return (
    <span className="flex flex-col gap-0.5 text-status-danger-strong">
      {serverFlags.map((f, i) => (
        <span key={i}>
          Killed ({f.scope === 'deployment' ? 'whole deployment' : 'this server'}): {f.reason}
        </span>
      ))}
      {killedToolCount > 0 ? (
        <span>
          {killedToolCount} {killedToolCount === 1 ? 'tool' : 'tools'} killed individually
        </span>
      ) : null}
    </span>
  );
}

export function ServersView({ servers, runtimeNotice }: ServersViewProps): React.ReactElement {
  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Environments</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          Which module servers exist, who owns them, and what is in each. A new tool belongs in the
          server whose application and module it extends.
        </p>
      </div>

      <EnvNav />

      {runtimeNotice === undefined ? null : (
        <LiveStateNotice state={runtimeNotice.state} subject={runtimeNotice.subject} />
      )}

      {servers.length === 0 ? (
        <p data-testid="servers-empty" className="text-[13px] text-text-2">
          No module servers are defined. A server is a <code>*.server.yaml</code> file in{' '}
          <code>manifests/_servers/</code>; add one through a change proposal.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {servers.map((s) => (
            <section
              key={s.id}
              aria-labelledby={`server-${s.id}`}
              data-testid={`server-${s.id}`}
              className="rounded-lg border border-line bg-surface p-4"
            >
              <h2 id={`server-${s.id}`} className="font-display text-lg text-text-1">
                <a
                  href={`/catalog/servers/${encodeURIComponent(s.id)}`}
                  className="font-mono text-accent underline"
                  data-testid={`server-detail-link-${s.id}`}
                >
                  {s.id}
                </a>
                <span className="ml-2 text-[13px] font-normal text-text-2">{s.label}</span>
              </h2>
              <dl className="mt-3 grid grid-cols-[160px_1fr] gap-x-3 gap-y-1 text-[13px]/[1.5]">
                <dt className="text-text-2">Mode</dt>
                <dd className="text-text-1">{MODE_LABEL[s.mode]}</dd>
                <dt className="text-text-2">Version</dt>
                <dd className="font-mono text-text-1">{s.version}</dd>
                <dt className="text-text-2">Owner</dt>
                <dd className="text-text-1">{s.owner}</dd>
                <dt className="text-text-2">Tools</dt>
                <dd className="text-text-1">
                  <a
                    href={catalogLinkFor(s.id)}
                    className="text-accent underline"
                    aria-label={`${s.toolIds.length} ${s.toolIds.length === 1 ? 'tool' : 'tools'} in ${s.id}, open in Catalog`}
                  >
                    {s.toolIds.length} {s.toolIds.length === 1 ? 'tool' : 'tools'}
                  </a>
                </dd>
                <dt className="text-text-2">Binding types in use</dt>
                <dd className="flex flex-wrap gap-1 text-text-1">
                  {s.bindingTypes.length === 0 ? (
                    <span className="text-text-2">None — no tools yet</span>
                  ) : (
                    s.bindingTypes.map((t) => <BindingChip key={t} type={t as BindingType} />)
                  )}
                </dd>
                <dt className="text-text-2">Probe status</dt>
                <dd className="text-text-1">
                  <ProbeCell row={s} />
                </dd>
                <dt className="text-text-2">Kill switch</dt>
                <dd className="text-text-1">
                  <KillCell row={s} />
                </dd>
              </dl>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
