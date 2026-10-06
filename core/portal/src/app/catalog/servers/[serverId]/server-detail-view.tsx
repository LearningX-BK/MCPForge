// MCPForge — W0-Q2: the module-server detail (03 §5.2). Server-renderable.
// Drill-down: entity -> tool -> binding -> target.

import Link from 'next/link';
import * as React from 'react';

import { LiveStateNotice, type LiveNotice } from '@/components/live/live-state-notice';

import type { ServerInventoryRow } from '../../../environments/servers/load-servers';
import {
  SPLIT_TOOL_COUNT_HIGH,
  SPLIT_TOOL_COUNT_LOW,
  toolCountPosition,
  type ServerDetailDefinition,
} from './load-detail';

export interface ServerDetailViewProps {
  readonly detail: ServerDetailDefinition;
  readonly runtime: ServerInventoryRow;
  readonly runtimeNotice?: { readonly state: LiveNotice; readonly subject: string } | undefined;
}

const POSITION_COPY = {
  below: 'below the 15–20 range',
  'in-range': 'inside the 15–20 range: the count input is close to firing',
  above: 'above 20: the tool-count input of the split rule has fired',
} as const;

function RuntimeRow({ runtime }: { readonly runtime: ServerInventoryRow }): React.ReactElement {
  const probe =
    runtime.probe.kind === 'unknown'
      ? 'runtime state unavailable'
      : [
          ...runtime.probe.summary.byStatus.map((s) => `${s.count} ${s.status}`),
          `${runtime.probe.summary.notProbed} not probed`,
        ].join(' · ');
  const kill =
    runtime.kill.kind === 'unknown'
      ? 'runtime state unavailable'
      : runtime.kill.serverFlags.length === 0 && runtime.kill.killedToolCount === 0
        ? 'Not killed'
        : [
            ...runtime.kill.serverFlags.map((f) => `${f.scope} kill: ${f.reason}`),
            ...(runtime.kill.killedToolCount > 0
              ? [`${runtime.kill.killedToolCount} tool(s) killed individually`]
              : []),
          ].join(' · ');
  return (
    <>
      <dt className="text-text-2">Probe status</dt>
      <dd data-testid="detail-probe">{probe}</dd>
      <dt className="text-text-2">Kill switch</dt>
      <dd data-testid="detail-kill">{kill}</dd>
    </>
  );
}

export function ServerDetailView({
  detail,
  runtime,
  runtimeNotice,
}: ServerDetailViewProps): React.ReactElement {
  const n = detail.def.toolIds.length;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
      <Link
        href="/environments/servers"
        className="text-[13px] text-text-2 underline decoration-dotted underline-offset-2"
      >
        ← Server inventory
      </Link>
      <h1 className="font-display text-xl text-text-1">
        <span className="font-mono">{detail.def.id}</span>
        <span className="ml-2 text-[13px] font-normal text-text-2">{detail.def.label}</span>
      </h1>

      <section aria-labelledby="srv-facts">
        <h2 id="srv-facts" className="mb-2 font-display text-lg text-text-1">
          Server
        </h2>
        <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
          <dt className="text-text-2">Mode</dt>
          <dd>{detail.def.mode === 'A' ? 'A — in-process' : 'B — own process'}</dd>
          {detail.promotionReason === undefined ? null : (
            <>
              <dt className="text-text-2">Promotion reason</dt>
              <dd>{detail.promotionReason}</dd>
            </>
          )}
          <dt className="text-text-2">Version</dt>
          <dd>{detail.def.version}</dd>
          <dt className="text-text-2">App · module</dt>
          <dd>
            {detail.app} · {detail.module}
          </dd>
          <dt className="text-text-2">Owner</dt>
          <dd>{detail.def.owner}</dd>
          <dt className="text-text-2">Steward</dt>
          <dd>{detail.steward}</dd>
          <RuntimeRow runtime={runtime} />
        </dl>
        {runtimeNotice === undefined ? null : (
          <div className="mt-3">
            <LiveStateNotice state={runtimeNotice.state} subject={runtimeNotice.subject} />
          </div>
        )}
      </section>

      <section aria-labelledby="srv-split">
        <h2 id="srv-split" className="mb-2 font-display text-lg text-text-1">
          Split-rule inputs
        </h2>
        <p className="mb-2 max-w-[70ch] text-[13px] text-text-2">
          A server is split when any two of five inputs hold (01 §2). These are the facts this
          server's own tools declare; this page does not decide.
        </p>
        <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
          <dt className="text-text-2">Tool count</dt>
          <dd data-testid="split-count">
            {n} of {SPLIT_TOOL_COUNT_LOW}–{SPLIT_TOOL_COUNT_HIGH}:{' '}
            {POSITION_COPY[toolCountPosition(n)]}
          </dd>
          <dt className="text-text-2">Auth boundary</dt>
          <dd data-testid="split-auth">
            {detail.def.bindingTypes.join(', ') || 'none'} via{' '}
            {detail.technologies.join(', ') || 'none'}
          </dd>
          <dt className="text-text-2">Sensitivity class</dt>
          <dd data-testid="split-sensitivity">
            {detail.sensitivityClasses.join(', ') || 'none declared'}
          </dd>
          <dt className="text-text-2">Owning team</dt>
          <dd>{detail.def.owner}</dd>
        </dl>
      </section>

      <section aria-labelledby="srv-tools">
        <h2 id="srv-tools" className="mb-2 font-display text-lg text-text-1">
          Entity → tool → binding → target
        </h2>
        {detail.entities.length === 0 ? (
          <p data-testid="detail-no-tools" className="text-[13px] text-text-2">
            No committed tool manifest names this server.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {detail.entities.map((e) => (
              <li key={e.entity} data-testid={`entity-${e.entity}`}>
                <h3 className="font-mono text-[14px] text-text-1">{e.entity}</h3>
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Tools on {e.entity}</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-text-2">
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Tool
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Access
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Binding
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        Target
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.tools.map((t) => (
                      <tr
                        key={t.toolId}
                        data-testid="tool-row"
                        className="border-b border-line last:border-0"
                      >
                        <td className="py-1 pr-2 font-mono">
                          <Link
                            href={`/catalog/${encodeURIComponent(t.toolId)}`}
                            className="underline decoration-dotted"
                          >
                            {t.toolId}
                          </Link>
                        </td>
                        <td className="py-1 pr-2">{t.write ? 'write' : 'read'}</td>
                        <td className="py-1 pr-2">
                          {t.bindingType} · {t.technology}
                        </td>
                        <td className="py-1 font-mono">{t.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
