// MCPForge — W0-N13: per-consumer usage, quota headroom, the detector table
// and the anomaly-event list (03 §16.3). W0-P3b: the client half. `page.tsx`
// reads the snapshot on the server; this view picks a consumer and re-polls
// by asking the server to re-render (`router.refresh()`), never by streaming.
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import type { ConsumerUsageOverview } from './types';
import { QuotaMeter } from './_components/quota-meter';
import { DetectorTable } from './_components/detector-table';
import { AnomalyEventList } from './_components/anomaly-event-list';
import { UsagePanel } from './_components/usage-panel';
import { StalenessBar } from './_components/staleness-bar';

/** 03 §11.4 — "Approvals and Activity poll on a slow interval (30s) ... they do not stream." */
const POLL_INTERVAL_MS = 30_000;

export interface ConsumersViewProps {
  /** One snapshot per registered consumer, all taken at the same moment. */
  readonly overviews: readonly ConsumerUsageOverview[];
  /** Re-read the snapshot. Default: re-render the server page. */
  readonly onRefresh?: () => void;
}

export function ConsumersView({ overviews, onRefresh }: ConsumersViewProps): React.ReactElement {
  const router = useRouter();
  const [consumerId, setConsumerId] = React.useState(overviews[0]?.consumerId ?? '');
  const overview = overviews.find((o) => o.consumerId === consumerId) ?? overviews[0];

  const refresh = React.useCallback(() => {
    if (onRefresh) onRefresh();
    else router.refresh();
  }, [onRefresh, router]);

  // Polled, not streamed: a plain `setInterval` re-read on a fixed cadence,
  // never a subscription/WebSocket/SSE channel — 03 §11.4's explicit "must
  // not stream" line for this exact surface.
  React.useEffect(() => {
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (overview === undefined) {
    return (
      <p data-testid="consumers-empty-state" className="px-6 py-6 text-[13px] text-text-2">
        No consumer is registered in this repository, so there is no usage to show.
      </p>
    );
  }

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 font-display text-xl text-text-1">Activity — Consumers</h1>
          <p className="max-w-[70ch] text-[13px] text-text-2">
            Per-consumer usage, quota headroom against its declared limits, the anomaly detectors
            watching it, and every event they raised — each one click from the audit calls that
            triggered it.
          </p>
        </div>
        <StalenessBar generatedAt={overview.generatedAt} onRefresh={refresh} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="consumer-select" className="text-[12.5px] text-text-2">
          Consumer
        </label>
        <select
          id="consumer-select"
          data-testid="consumer-select"
          value={consumerId}
          onChange={(e) => setConsumerId(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[12.5px] text-text-1"
        >
          {overviews.map((c) => (
            <option key={c.consumerId} value={c.consumerId}>
              {c.label} ({c.consumerId})
            </option>
          ))}
        </select>
      </div>

      <section
        aria-labelledby="quota-headroom-heading"
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 id="quota-headroom-heading" className="font-display text-base text-text-1">
          Quota headroom
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {overview.quotas.map((quota) => (
            <QuotaMeter key={quota.name} quota={quota} />
          ))}
        </div>
      </section>

      <UsagePanel points={overview.points} />

      <DetectorTable rows={overview.detectors} />

      <AnomalyEventList events={overview.events} />
    </main>
  );
}
