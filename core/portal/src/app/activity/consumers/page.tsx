// MCPForge — W0-N13: `/activity/consumers` — per-consumer usage, quota
// headroom, the detector table and the anomaly-event list (03 §16.3).
// W0-P3b: live. Usage and anomaly events come from `/api/v1/consumers/usage`
// (runtime state); each consumer's display label comes from its git record
// (definitional, W0-P2 §7).

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readConsumerUsage } from '@/lib/gateway-client/read-client';

import { loadConsumerSources } from '../../governance/consumers/_lib/repo-consumers';
import { ConsumersView } from './consumers-view';
import { toUsageOverview } from './live';

export const dynamic = 'force-dynamic';

function labels(): ReadonlyMap<string, string> {
  try {
    return new Map(loadConsumerSources().map((c) => [c.consumerId, c.label]));
  } catch {
    // A label is presentation only; the id is always shown beside it.
    return new Map();
  }
}

export default async function ActivityConsumersPage(): Promise<React.ReactElement> {
  const usage = await readConsumerUsage('24h');
  if (usage.kind !== 'ok') {
    return (
      <main className="flex flex-col gap-6 px-6 py-6">
        <h1 className="mb-1 font-display text-xl text-text-1">Activity — Consumers</h1>
        <LiveStateNotice state={usage} subject="Consumer usage" />
      </main>
    );
  }
  const names = labels();
  const overviews = usage.data.consumers.map((c) =>
    toUsageOverview(c, names.get(c.consumerId) ?? c.consumerId, usage.data.asOf),
  );
  return <ConsumersView overviews={overviews} />;
}
