// MCPForge — W0-Q1: the Consumption Graph view (03 §5.2, roadmap G9).
// Server-renderable: the pivot and window are links, not client state.

import Link from 'next/link';
import * as React from 'react';

import {
  CONSUMPTION_WINDOWS,
  consumerNodes,
  toolNodes,
  type ConsumerFacts,
  type ConsumptionWindow,
  type Edge,
  type Pivot,
} from './graph';

export interface ConsumptionViewProps {
  readonly edges: readonly Edge[];
  readonly toolIds: readonly string[];
  readonly consumers: readonly ConsumerFacts[];
  readonly window: ConsumptionWindow;
  readonly pivot: Pivot;
  readonly atLeast: boolean;
  readonly asOf: string;
}

const href = (pivot: Pivot, window: ConsumptionWindow): string =>
  `/activity/consumption?pivot=${pivot}&window=${window}`;

function ScopeCell({ c }: { readonly c: ConsumerFacts | null }): React.ReactElement {
  if (c === null) return <span className="text-text-2">Not in consumers/ (unregistered)</span>;
  const s = c.scope;
  return (
    <span>
      roles {s.roles.join(', ') || 'none'} · packages {s.packages.join(', ') || 'none'} ·{' '}
      {s.bindingTypes.join(', ') || 'no binding types'} · up to {s.maxSensitivity} ·{' '}
      {s.writeAllowed ? 'writes allowed' : 'read-only'}
    </span>
  );
}

function EdgeRows({
  edges,
  by,
  window,
}: {
  readonly edges: readonly Edge[];
  readonly by: Pivot;
  readonly window: ConsumptionWindow;
}): React.ReactElement {
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">
        {by === 'tool' ? 'Consumers of this tool' : 'Tools this consumer called'}
      </caption>
      <thead>
        <tr className="border-b border-line text-left text-text-2">
          <th scope="col" className="py-1 pr-2 font-medium">
            {by === 'tool' ? 'Consumer' : 'Tool'}
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            Class
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            Granted scope
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            Calls
          </th>
          <th scope="col" className="py-1 font-medium">
            Last call
          </th>
        </tr>
      </thead>
      <tbody>
        {edges.map((e) => (
          <tr
            key={`${e.toolId}|${e.consumerId}`}
            data-testid="edge-row"
            className="border-b border-line last:border-0"
          >
            <td className="py-1 pr-2 font-mono">
              <Link
                href={`${href(by === 'tool' ? 'consumer' : 'tool', window)}#${by === 'tool' ? 'consumer' : 'tool'}-node-${by === 'tool' ? e.consumerId : e.toolId}`}
                className="underline decoration-dotted"
              >
                {by === 'tool' ? e.consumerId : e.toolId}
              </Link>
            </td>
            <td className="py-1 pr-2">{e.consumer?.consumerClass ?? 'unregistered'}</td>
            <td className="py-1 pr-2">
              <ScopeCell c={e.consumer} />
            </td>
            <td className="py-1 pr-2">{e.calls}</td>
            <td className="py-1">{e.lastCallAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ConsumptionView(p: ConsumptionViewProps): React.ReactElement {
  const tools = toolNodes(p.edges, p.toolIds);
  const consumers = consumerNodes(p.edges, p.consumers);
  const orphans = tools.filter((t) => t.totalCalls === 0).length;

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Activity — Consumption</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          Which registered consumers call which tools, over the chosen window. Counts are calls{' '}
          <em>you may read</em>
          {p.atLeast ? ', and paging stopped at its cap, so they are at least these numbers' : ''}.
          {p.asOf === '' ? '' : ` As of ${p.asOf}.`}
        </p>
      </div>

      <nav aria-label="Consumption controls" className="flex flex-wrap gap-6 text-[13px]">
        <ul className="flex gap-3" aria-label="Pivot">
          {(['tool', 'consumer'] as const).map((v) => (
            <li key={v}>
              <Link
                href={href(v, p.window)}
                aria-current={p.pivot === v ? 'page' : undefined}
                data-testid={`pivot-${v}`}
                className={
                  p.pivot === v ? 'font-semibold underline' : 'underline decoration-dotted'
                }
              >
                {v === 'tool' ? 'By tool' : 'By consumer'}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="flex gap-3" aria-label="Window">
          {CONSUMPTION_WINDOWS.map((w) => (
            <li key={w}>
              <Link
                href={href(p.pivot, w)}
                aria-current={p.window === w ? 'page' : undefined}
                data-testid={`window-${w}`}
                className={
                  p.window === w ? 'font-semibold underline' : 'underline decoration-dotted'
                }
              >
                {w}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {p.pivot === 'tool' ? (
        <>
          <p data-testid="zero-consumer-count" className="text-[13px] text-text-1">
            {orphans} of {tools.length} tools had no consumer in this window.
          </p>
          <ul className="flex flex-col gap-4">
            {tools.map((t) => (
              <li key={t.toolId} id={`tool-node-${t.toolId}`} data-testid={`tool-node-${t.toolId}`}>
                <h2 className="font-mono text-[14px] text-text-1">
                  <Link
                    href={`/catalog/${encodeURIComponent(t.toolId)}`}
                    className="underline decoration-dotted"
                  >
                    {t.toolId}
                  </Link>
                </h2>
                {t.edges.length === 0 ? (
                  <p data-testid={`zero-consumers-${t.toolId}`} className="text-[13px] text-text-2">
                    No consumer called this tool in the last {p.window}. A deployed tool nobody uses
                    is a sprawl signal.
                  </p>
                ) : (
                  <EdgeRows edges={t.edges} by="tool" window={p.window} />
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="flex flex-col gap-4">
          {consumers.map((c) => (
            <li
              key={c.consumerId}
              id={`consumer-node-${c.consumerId}`}
              data-testid={`consumer-node-${c.consumerId}`}
            >
              <h2 className="font-mono text-[14px] text-text-1">
                {c.consumerId}{' '}
                <span className="font-sans text-text-2">
                  {c.consumer === null
                    ? '(unregistered)'
                    : `${c.consumer.label} · ${c.consumer.consumerClass}`}
                </span>
              </h2>
              {c.edges.length === 0 ? (
                <p data-testid={`zero-tools-${c.consumerId}`} className="text-[13px] text-text-2">
                  This consumer called no tool you may read in the last {p.window}.
                </p>
              ) : (
                <EdgeRows edges={c.edges} by="consumer" window={p.window} />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
