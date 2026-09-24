// MCPForge — `forge.find`. W0-G4, 02 §5.2 tool 1, §5.4.
//
// This is a wrapper and it is meant to be one. Stages 1–5 are `rankTools`
// (W0-G2); stage 6 — the calibrated floor, the `no_tool` verdict and the
// top-2 `choose` block — is `evaluateFloor` (W0-G3). Neither is re-implemented
// or second-guessed here. What this file adds is exactly two things the
// ranker cannot know because they are gateway facts: which set to rank over
// (`findable`, ./visibility.ts) and the per-result `access` annotation.
//
// THE LIMIT IS APPLIED BY `evaluateFloor`, NOT BY `rankTools`. The verdict must
// be computed from the FULL ranked list — `no_tool`'s `nearest` is drawn from
// the below-floor tail, which a truncated list no longer has. So `rankTools`
// runs unlimited and with its pass-through floor, and stage 6 does the
// truncating, exactly as W0-G3 documented.

import type { CatalogueIndexFilters } from '@mcpforge/registry/index';
import { evaluateFloor, rankTools, type RankFilters } from '@mcpforge/registry/rank';
import { resolveDiscovery } from './visibility.js';
import type { FindResponse, FindResultEntry, MetaContext, MetaToolCard } from './types.js';

/** 02 §5.2's `forge.find` input, verbatim. */
export interface FindInput {
  readonly query?: string;
  readonly app?: string;
  readonly module?: string;
  readonly entity?: string;
  readonly verb?: string;
  readonly write?: boolean;
  readonly bindingType?: string;
  readonly process?: string;
  readonly package?: string;
  /** Default 5, max 10 (02 §5.2). */
  readonly limit?: number;
}

export const FIND_DEFAULT_LIMIT = 5;
export const FIND_MAX_LIMIT = 10;

function filtersFrom(input: FindInput): RankFilters {
  const filters: {
    app?: string;
    module?: string;
    entity?: string;
    verb?: string;
    write?: boolean;
    bindingType?: string;
    processTags?: readonly string[];
    packageTags?: readonly string[];
  } = {};
  if (input.app !== undefined) filters.app = input.app;
  if (input.module !== undefined) filters.module = input.module;
  if (input.entity !== undefined) filters.entity = input.entity;
  if (input.verb !== undefined) filters.verb = input.verb;
  if (input.write !== undefined) filters.write = input.write;
  if (input.bindingType !== undefined) filters.bindingType = input.bindingType;
  if (input.process !== undefined) filters.processTags = [input.process];
  if (input.package !== undefined) filters.packageTags = [input.package];
  return filters;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return FIND_DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return FIND_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), FIND_MAX_LIMIT);
}

/**
 * A minimal card for a tool whose generated card is not loaded. The find
 * response must never drop a ranked result for want of an artefact — a silent
 * absence is the dead end 02 §4.5 exists to prevent — so the id and the
 * structured fields the index already holds are returned instead.
 */
function fallbackCard(id: string, filters: CatalogueIndexFilters): MetaToolCard {
  return {
    id,
    verb: filters.verb,
    entity: filters.entity,
    write: filters.write,
    binding: filters.bindingType,
    sensitivity: filters.sensitivity,
    roles: filters.roles,
    status: filters.status,
  };
}

export function forgeFind(ctx: MetaContext, input: FindInput = {}): FindResponse {
  const discovery = resolveDiscovery(ctx);
  const text = input.query ?? '';
  const limit = clampLimit(input.limit);

  const ranked = rankTools(
    ctx.index,
    { text, filters: filtersFrom(input) },
    {
      visibility: {
        visibleToolIds: discovery.findable,
        activeRoleIds: ctx.policy.scope.session.heldRoleIds,
      },
      ...(ctx.consumption === undefined ? {} : { consumption: ctx.consumption }),
    },
  );

  const verdict =
    ctx.floor === undefined
      ? evaluateFloor(ranked, { text, limit })
      : evaluateFloor(ranked, { text, limit }, ctx.floor);

  if (verdict.result === 'no_tool') return verdict;

  const tools: FindResultEntry[] = verdict.tools.map((r) => {
    const access = discovery.access.get(r.id) ?? { level: 'available' as const };
    const card = ctx.cards.cardFor(r.id) ?? fallbackCard(r.id, r.entry.filters);
    const entry: FindResultEntry = {
      card,
      score: r.score,
      access: access.level,
    };
    return access.agentMessage === undefined
      ? entry
      : { ...entry, agentMessage: access.agentMessage };
  });

  return verdict.choose === undefined
    ? { result: 'tools', tools }
    : { result: 'tools', tools, choose: verdict.choose };
}
