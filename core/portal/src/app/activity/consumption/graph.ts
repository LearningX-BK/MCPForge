// MCPForge — W0-Q1: the pure reducers behind `/activity/consumption`.
//
// The edge list is tool -> consumer, counted from `/api/v1/calls` (runtime,
// bounded by the viewer's read authority). The tool universe and each
// consumer's class and granted scope come from git (definitional, W0-P2 §7).
// A tool with no calls in the window is an edge-less NODE, shown as such:
// that is G9's sprawl signal (01 §2).

export const CONSUMPTION_WINDOWS = ['24h', '7d', '30d'] as const;
export type ConsumptionWindow = (typeof CONSUMPTION_WINDOWS)[number];
export type Pivot = 'tool' | 'consumer';

export const WINDOW_MS: Record<ConsumptionWindow, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** The slice of a call the graph needs. */
export interface GraphCall {
  readonly toolId: string;
  readonly consumerId: string;
  readonly ts: string;
}

/** What git says about a registered consumer. */
export interface ConsumerFacts {
  readonly consumerId: string;
  readonly label: string;
  readonly consumerClass: string;
  readonly scope: {
    readonly roles: readonly string[];
    readonly packages: readonly string[];
    readonly bindingTypes: readonly string[];
    readonly maxSensitivity: string;
    readonly writeAllowed: boolean;
  };
}

export interface Edge {
  readonly toolId: string;
  readonly consumerId: string;
  readonly calls: number;
  readonly lastCallAt: string;
  /** `null` when the id is not in `consumers/`: shown as unregistered, never dropped. */
  readonly consumer: ConsumerFacts | null;
}

export interface ToolNode {
  readonly toolId: string;
  readonly edges: readonly Edge[];
  readonly totalCalls: number;
}

export interface ConsumerNode {
  readonly consumerId: string;
  readonly consumer: ConsumerFacts | null;
  readonly edges: readonly Edge[];
  readonly totalCalls: number;
}

export function parseWindow(raw: string | undefined): ConsumptionWindow {
  return (CONSUMPTION_WINDOWS as readonly string[]).includes(raw ?? '')
    ? (raw as ConsumptionWindow)
    : '7d';
}

export function parsePivot(raw: string | undefined): Pivot {
  return raw === 'consumer' ? 'consumer' : 'tool';
}

/** Calls (newest first, as the API pages them) -> edges inside the window. */
export function buildEdges(
  calls: readonly GraphCall[],
  consumers: readonly ConsumerFacts[],
  since: number,
): readonly Edge[] {
  const facts = new Map(consumers.map((c) => [c.consumerId, c]));
  const acc = new Map<
    string,
    { toolId: string; consumerId: string; calls: number; last: string }
  >();
  for (const call of calls) {
    const t = Date.parse(call.ts);
    if (Number.isNaN(t) || t < since) continue;
    const key = `${call.toolId}\u0000${call.consumerId}`;
    const e = acc.get(key);
    if (e === undefined) {
      acc.set(key, { toolId: call.toolId, consumerId: call.consumerId, calls: 1, last: call.ts });
    } else {
      e.calls += 1;
      if (call.ts > e.last) e.last = call.ts;
    }
  }
  return [...acc.values()]
    .map((e) => ({
      toolId: e.toolId,
      consumerId: e.consumerId,
      calls: e.calls,
      lastCallAt: e.last,
      consumer: facts.get(e.consumerId) ?? null,
    }))
    .sort((a, b) => b.calls - a.calls || a.toolId.localeCompare(b.toolId));
}

/** Every known tool appears, with zero edges when nothing called it. */
export function toolNodes(
  edges: readonly Edge[],
  allToolIds: readonly string[],
): readonly ToolNode[] {
  const ids = new Set([...allToolIds, ...edges.map((e) => e.toolId)]);
  return [...ids]
    .sort()
    .map((toolId) => {
      const mine = edges.filter((e) => e.toolId === toolId);
      return { toolId, edges: mine, totalCalls: mine.reduce((n, e) => n + e.calls, 0) };
    })
    .sort(
      (a, b) =>
        Number(a.totalCalls > 0) - Number(b.totalCalls > 0) || a.toolId.localeCompare(b.toolId),
    );
}

/** Every registered consumer appears, with zero edges when it called nothing. */
export function consumerNodes(
  edges: readonly Edge[],
  consumers: readonly ConsumerFacts[],
): readonly ConsumerNode[] {
  const ids = new Set([...consumers.map((c) => c.consumerId), ...edges.map((e) => e.consumerId)]);
  const facts = new Map(consumers.map((c) => [c.consumerId, c]));
  return [...ids].sort().map((consumerId) => {
    const mine = edges.filter((e) => e.consumerId === consumerId);
    return {
      consumerId,
      consumer: facts.get(consumerId) ?? null,
      edges: mine,
      totalCalls: mine.reduce((n, e) => n + e.calls, 0),
    };
  });
}
