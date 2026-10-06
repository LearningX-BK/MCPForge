// MCPForge — W0-Q1: the data behind `/activity/consumption`. Server-only.
//
// Runtime half: `/api/v1/calls` as the signed-in viewer, paged and capped, so
// every count is "calls you may read" and says so. Definitional half: tool
// manifests and consumer records from git. Nothing is a fixture.

import { loadConsumerRegistry } from '@mcpforge/gateway/consumer/records';

import { resolveRepoRoot } from '@/app/build/_lib/repo-root';
import { loadCatalogDefinitions } from '@/app/catalog/load-catalog';
import { readCalls, type ReadResult } from '@/lib/gateway-client/read-client';
import type { CallsPage } from '@mcpforge/shared/api/v1';

import {
  WINDOW_MS,
  buildEdges,
  type ConsumerFacts,
  type ConsumptionWindow,
  type Edge,
  type GraphCall,
} from './graph';

export const GRAPH_PAGE_CAP = 10;
const PAGE_SIZE = 200;

export type ConsumptionData =
  | {
      readonly kind: 'ok';
      readonly edges: readonly Edge[];
      readonly toolIds: readonly string[];
      readonly consumers: readonly ConsumerFacts[];
      /** True when paging stopped at the cap: counts are a lower bound. */
      readonly atLeast: boolean;
      readonly asOf: string;
    }
  | { readonly kind: 'notice'; readonly state: Exclude<ReadResult<CallsPage>, { kind: 'ok' }> };

export function loadConsumerFacts(repoRoot: string = resolveRepoRoot()): readonly ConsumerFacts[] {
  return loadConsumerRegistry(repoRoot).consumers.map(({ record }) => ({
    consumerId: record.id,
    label: record.label,
    consumerClass: record.class,
    scope: {
      roles: record.authorizations.roles,
      packages: record.authorizations.packages,
      bindingTypes: record.authorizations.bindingTypes,
      maxSensitivity: record.authorizations.maxSensitivity,
      writeAllowed: record.authorizations.writeAllowed,
    },
  }));
}

export async function loadConsumption(
  window: ConsumptionWindow,
  deps: {
    readonly calls?: typeof readCalls;
    readonly now?: () => Date;
    readonly repoRoot?: string;
  } = {},
): Promise<ConsumptionData> {
  const read = deps.calls ?? readCalls;
  const since = (deps.now?.() ?? new Date()).getTime() - WINDOW_MS[window];
  const calls: GraphCall[] = [];
  let cursor: string | undefined;
  let atLeast = false;
  let asOf = '';

  for (let page = 0; page < GRAPH_PAGE_CAP; page++) {
    const result = await read({ limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) });
    if (result.kind !== 'ok') {
      // A failure on page 0 is the page's notice; later, we keep what we have.
      if (page === 0) return { kind: 'notice', state: result };
      atLeast = true;
      break;
    }
    asOf = result.data.asOf;
    let reachedOlder = false;
    for (const c of result.data.items) {
      if (Date.parse(c.ts) < since) {
        reachedOlder = true;
        break;
      }
      calls.push({ toolId: c.toolId, consumerId: c.consumerId, ts: c.ts });
    }
    if (reachedOlder || result.data.nextCursor === null) break;
    cursor = result.data.nextCursor;
    if (page === GRAPH_PAGE_CAP - 1) atLeast = true;
  }

  const repoRoot = deps.repoRoot ?? resolveRepoRoot();
  const consumers = loadConsumerFacts(repoRoot);
  return {
    kind: 'ok',
    edges: buildEdges(calls, consumers, since),
    toolIds: loadCatalogDefinitions(repoRoot).tools.map((t) => t.manifest.id),
    consumers,
    atLeast,
    asOf,
  };
}
