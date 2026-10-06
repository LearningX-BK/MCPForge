// MCPForge — W0-Q1: `/activity/consumption` — the Consumption Graph (03 §5.2,
// roadmap G9: "every tool -> consuming agent, platform, scope, call count").
// Calls come from `/api/v1` as the signed-in viewer; a failed read renders its
// own notice, never an empty graph.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';

import { ConsumptionView } from './consumption-view';
import { parsePivot, parseWindow } from './graph';
import { loadConsumption } from './load';

export const dynamic = 'force-dynamic';

export default async function ActivityConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ pivot?: string; window?: string }>;
}): Promise<React.ReactElement> {
  const q = await searchParams;
  const window = parseWindow(q.window);
  const pivot = parsePivot(q.pivot);
  const data = await loadConsumption(window);
  if (data.kind === 'notice') {
    return (
      <main className="flex flex-col gap-6 px-6 py-6">
        <h1 className="mb-1 font-display text-xl text-text-1">Activity — Consumption</h1>
        <LiveStateNotice state={data.state} subject="Consumption" />
      </main>
    );
  }
  return <ConsumptionView {...data} window={window} pivot={pivot} />;
}
