// MCPForge — W0-J19: `/` — a worklist, not a dashboard (03 §5.3 "Home").
import * as React from 'react';
import Link from 'next/link';
import { fixtureHomeSource } from './fixtures';
import type { HomeSource, HomeWorklist, MyQueueItem, WhatBrokeItem, WhatChangedItem } from './types';

function myQueueLabel(item: MyQueueItem): string {
  switch (item.kind) {
    case 'runtime_approval':
      return item.entry.kind === 'runtime' ? `Approve ${item.entry.approval.toolId}` : 'Approve';
    case 'definitional_approval':
      return item.entry.kind === 'definitional' ? item.entry.title : 'Review change';
    case 'open_draft':
      return `Draft: ${item.draft.title}`;
    case 'request_awaiting_verdict':
      return `Request awaiting triage: "${item.askText}"`;
  }
}

function whatBrokeLabel(item: WhatBrokeItem): string {
  switch (item.kind) {
    case 'probe_disabled':
      return `${item.tool.manifest.id} — ${item.tool.probeStatus.replace(/_/g, ' ')}`;
    case 'guardrail_refusal':
      return `Guardrail refusal — ${item.call.toolId}`;
    case 'chain_break':
      return item.detail;
  }
}

function whatChangedLabel(item: WhatChangedItem): string {
  switch (item.kind) {
    case 'deployed_tool':
      return `${item.tool.manifest.id} deployed`;
    case 'role_scope_change':
      return item.summary;
  }
}

function Column({
  title,
  items,
  label,
  emptyText,
  testId,
}: {
  readonly title: string;
  readonly items: readonly (MyQueueItem | WhatBrokeItem | WhatChangedItem)[];
  readonly label: (item: MyQueueItem | WhatBrokeItem | WhatChangedItem) => string;
  readonly emptyText: string;
  readonly testId: string;
}): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-line bg-bg-surface p-3">
      <h2 className="font-display text-[14px] text-text-1">{title}</h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-text-2">{emptyText}</p>
      ) : (
        <ul data-testid={testId} className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li key={i}>
              <Link href={item.href} className="text-[12.5px] text-accent underline">
                {label(item)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiStrip({ kpis }: { readonly kpis: HomeWorklist['kpis'] }): React.ReactElement {
  return (
    <div data-testid="home-kpi-strip" className="mb-6 grid grid-cols-4 gap-3">
      <div className="rounded-lg border border-line bg-bg-surface p-3">
        <div className="font-display text-xl text-text-1">
          {kpis.toolsResolved}/{kpis.toolsTotal}
        </div>
        <div className="text-[11px] text-text-2">Tools resolved</div>
      </div>
      <div className="rounded-lg border border-line bg-bg-surface p-3">
        <div className="font-display text-xl text-text-1">{kpis.approvalsOpen}</div>
        <div className="text-[11px] text-text-2">Approvals open</div>
      </div>
      <div className="rounded-lg border border-line bg-bg-surface p-3">
        <div className="font-display text-xl text-text-1">{kpis.writesExecuted7d}</div>
        <div className="text-[11px] text-text-2">Writes executed (7d)</div>
      </div>
      <div className="rounded-lg border border-line bg-bg-surface p-3">
        <div className="font-display text-xl text-text-1">{kpis.reversals7d}</div>
        <div className="text-[11px] text-text-2">Reversals (7d)</div>
      </div>
    </div>
  );
}

function isEmpty(w: HomeWorklist): boolean {
  return w.myQueue.length === 0 && w.whatBroke.length === 0 && w.whatChanged.length === 0;
}

/** `source` is test-injectable — same seam every J-track page follows; the App Router route always uses the default (fixtures.ts's `fixtureHomeSource`). */
export default function HomePage({
  source = fixtureHomeSource,
}: {
  readonly source?: HomeSource;
} = {}): React.ReactElement {
  const worklist = source();

  return (
    <main className="bg-canvas px-6 py-6 text-text-1">
      <h1 className="mb-1 font-display text-xl text-text-1">Home</h1>
      <p className="mb-4 max-w-[70ch] text-[13px] text-text-2">
        What needs you today. If you open nothing else, you have still not missed anything.
      </p>

      <KpiStrip kpis={worklist.kpis} />

      {isEmpty(worklist) ? (
        <div data-testid="home-empty-state" className="rounded-lg border border-line bg-bg-surface p-6">
          <p className="mb-2 font-display text-[15px] text-text-1">Nothing is waiting on you</p>
          <p className="mb-1 text-[12.5px] text-text-2">Three things to do first:</p>
          <ul className="list-disc pl-5 text-[12.5px] text-text-2">
            <li>
              Run the probe — <Link href="/environments" className="text-accent underline">Environments</Link>
            </li>
            <li>
              Open the catalog — <Link href="/catalog" className="text-accent underline">Catalog</Link>
            </li>
            <li>Read the architecture doc</li>
          </ul>
        </div>
      ) : (
        <div className="flex gap-3">
          <Column
            title="My queue"
            items={worklist.myQueue}
            label={(i) => myQueueLabel(i as MyQueueItem)}
            emptyText="Nothing waiting on you here."
            testId="home-my-queue"
          />
          <Column
            title="What broke"
            items={worklist.whatBroke}
            label={(i) => whatBrokeLabel(i as WhatBrokeItem)}
            emptyText="Nothing broken."
            testId="home-what-broke"
          />
          <Column
            title="What changed"
            items={worklist.whatChanged}
            label={(i) => whatChangedLabel(i as WhatChangedItem)}
            emptyText="Nothing changed recently."
            testId="home-what-changed"
          />
        </div>
      )}
    </main>
  );
}
