// MCPForge — W0-J19: the real `forge.find`-equivalent verdict.
//
// This is the load-bearing file for this task's done: criterion. It builds a
// real `CatalogueIndex` (`@mcpforge/registry/index`, W0-G1) from the same
// `CatalogData` the Catalog page renders, then runs the real six-stage
// ranking pipeline (`@mcpforge/registry/rank`'s `rankTools`, W0-G2/G3) over
// it. Nothing here re-implements scoring, tokenizing or fusion — every number
// this module returns is `RankedResult.score` untouched.
//
// VISIBILITY, A JUDGMENT CALL: Requests is business intake, not a scoped
// agent session — 03 §5.3 says "the human and the agent get the same answer
// to the same question," which is about using the SAME INDEX AND RANKER, not
// about running under one particular caller's `visible(session)` scope
// (there is no session to scope Requests against — it is reached by a
// business user asking in plain English, before any tool grant exists).
// `SessionVisibility.visibleToolIds` is therefore set to every tool id in the
// supplied `CatalogData`, i.e. stage 1's hard filter passes every entry
// through unfiltered, and stage 5's `activeRoleIds` is left empty so the
// active-role boost never fires (there is no active role to boost). This
// mirrors `role-simulator.ts`'s reuse of `CatalogData` directly rather than
// inventing a second data shape, and is flagged here (and in the task's
// final report) as a genuine choice a human should be free to revisit if
// Requests should instead be scoped to the asking user's own visible set.
//
// TIER BOUNDARIES, A JUDGMENT CALL: `RankedResult.score` is comparable across
// queries (`rank/types.ts`'s own comment on `RankedResult.score`) but W0-G3's
// CALIBRATED score floor and `no_tool`/`choose` verdict are not implemented
// yet (`W0-HG5` — the calibration sign-off — is still open in TASKS.md; see
// `rank/floor.ts`'s `PASS_THROUGH_FLOOR`). This module therefore applies its
// own documented, uncalibrated tier thresholds purely to decide EXISTS vs
// NEAR-MISS vs NEW bucketing — it never invents or overrides the score
// itself, which is always the real fused+boosted number and is always
// rendered verbatim next to whichever tier it landed in. Once W0-HG5 signs
// off the calibrated floor, these thresholds should be replaced with that
// floor and the top-2 margin `choose` policy — noted as an open flag in the
// final report.
import { buildCatalogueIndex } from '@mcpforge/registry/index';
import { rankTools } from '@mcpforge/registry/rank';
import type { CatalogueIndexToolInput } from '@mcpforge/registry/index';
import type { RankContext, RankedResult } from '@mcpforge/registry/rank';
import type { CatalogData, CatalogTool } from '../catalog/types';
import { NEW_DRAFT_TEMPLATE_YAML } from '../build/fixtures';
import type { BuildDraft } from '../build/types';
import type { RequestVerdict, RequestVerdictMatch } from './types';

/**
 * A tool's score above this is treated as "this already exists, here it is."
 * Uncalibrated (see file header) but not arbitrary: at Wave 0's normalised
 * fusion scale (`fusion.ts`) a perfect single-channel hit tops out at 1.0, so
 * anything above 1.0 only happens when stage 5's verb-match or entity-match
 * boost (each +0.25, `weights.ts`) ALSO fired — i.e. the query didn't just
 * share vocabulary with the tool, it named the tool's own verb or entity.
 * 1.1 is set just above that line, so "exists" requires a structured
 * boost, never lexical overlap alone.
 */
export const EXISTS_SCORE_THRESHOLD = 1.1;
/**
 * A tool's score above this (but below EXISTS) is a near miss, shown with its
 * real score — lexical overlap with the ask, but naming neither this tool's
 * verb nor its entity. Uncalibrated — see file header.
 */
export const NEAR_MISS_SCORE_THRESHOLD = 0.3;
/** How many near-miss candidates to surface. */
export const NEAR_MISS_LIMIT = 3;

function toIndexInput(tool: CatalogTool): CatalogueIndexToolInput {
  const m = tool.manifest;
  return {
    id: m.id,
    title: m.title,
    purpose: m.purpose,
    aliases: m.aliases ?? [],
    disambiguation: m.disambiguation ?? null,
    entity: m.entity,
    verb: m.verb,
    app: m.app,
    module: m.module,
    appLabel: m.app,
    moduleLabel: m.module,
    functionalArea: m.functionalArea,
    bindingType: m.binding.type,
    archetype: m.archetype,
    sensitivity: m.sensitivity,
    write: m.write,
    processTags: m.processTags ?? [],
    packageTags: tool.packages,
    roles: m.coreForRoles ?? [],
    status: tool.probeStatus,
  };
}

/** Build the real index + rank context from the same `CatalogData` the Catalog page reads. See file header re: visibility. */
export function buildRequestRankContext(data: CatalogData): {
  readonly index: ReturnType<typeof buildCatalogueIndex>;
  readonly context: RankContext;
  readonly byId: ReadonlyMap<string, CatalogTool>;
} {
  const inputs = data.tools.map(toIndexInput);
  const index = buildCatalogueIndex(inputs, new Set());
  const byId = new Map(data.tools.map((t) => [t.manifest.id, t]));
  const context: RankContext = {
    visibility: {
      visibleToolIds: new Set(data.tools.map((t) => t.manifest.id)),
      activeRoleIds: [],
    },
  };
  return { index, context, byId };
}

function toMatch(result: RankedResult, byId: ReadonlyMap<string, CatalogTool>): RequestVerdictMatch {
  const tool = byId.get(result.id);
  return {
    toolId: result.id,
    title: tool?.manifest.title ?? result.id,
    score: result.score,
    href: `/catalog/${encodeURIComponent(result.id)}`,
    disambiguation: tool?.manifest.disambiguation ?? null,
  };
}

/** A short, deterministic digest of `text` — stable across the server and
 * client renders of the SAME ask, unlike `Date.now()` (which produced a real
 * hydration mismatch here: this component is `'use client'`, so it renders
 * once during SSR and again on hydration, and a wall-clock-derived id
 * differs between the two). `verdictFor` is otherwise a pure function of
 * `askText`, so deriving the id from that same input keeps it pure too. */
function stableDigest(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Build the starter draft for a `new`-tier request, pre-filling whatever can be inferred from the ask text. */
function draftTemplateFor(askText: string): BuildDraft {
  const trimmed = askText.trim();
  const title = trimmed.length > 0 ? trimmed.slice(0, 60) : 'REPLACE ME';
  const yaml = NEW_DRAFT_TEMPLATE_YAML.replace('title: REPLACE ME', `title: ${title}`).replace(
    'purpose: REPLACE — what this tool does, verb-first, at most 14 words.',
    `purpose: REPLACE — ${trimmed.length > 0 ? trimmed : 'what this tool does, verb-first, at most 14 words.'}`,
  );
  return {
    id: `draft-request-${stableDigest(trimmed)}`,
    title: title === 'REPLACE ME' ? 'New capability request' : title,
    branch: 'forge/draft-request-new',
    state: 'draft',
    toolId: 'app.module.entity.verb',
    yaml,
  };
}

/**
 * Run the real ranker for one free-text ask and return the three-tier
 * verdict. `data` is the same `CatalogData` the Catalog page renders —
 * callers typically pass `fixtureCatalogSource()` today (see `fixtures.ts`).
 */
export function verdictFor(askText: string, data: CatalogData): RequestVerdict {
  const { index, context, byId } = buildRequestRankContext(data);
  const ranked = rankTools(index, { text: askText }, context);

  const top = ranked[0];
  if (top !== undefined && top.score >= EXISTS_SCORE_THRESHOLD) {
    return { tier: 'exists', match: toMatch(top, byId) };
  }

  const nearMisses = ranked.filter((r) => r.score >= NEAR_MISS_SCORE_THRESHOLD).slice(0, NEAR_MISS_LIMIT);
  if (nearMisses.length > 0) {
    return { tier: 'near_miss', matches: nearMisses.map((r) => toMatch(r, byId)) };
  }

  return { tier: 'new', draftTemplate: draftTemplateFor(askText) };
}
