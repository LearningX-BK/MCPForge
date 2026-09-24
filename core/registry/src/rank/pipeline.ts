// MCPForge — the six-stage ranking pipeline of 02 §5.4.2, in order. W0-G2.
//
//   1. Hard filters       ./filter.ts    structured fields + visible(session)
//   2. Lexical channel    ./bm25.ts      BM25 over the search document
//   3. Semantic channel   ./semantic.ts  ABSENT at Wave 0 (02 §5.4.3)
//   4. Fusion             ./fusion.ts    reciprocal rank fusion, normalised
//   5. Boosts             ./boosts.ts    verb · entity · active role · capped consumption · status penalty
//   6. Floor + margin     W0-G3          pass-through here, by design
//
// The stages appear below in that order and each consumes only the previous
// one's output. That is not a stylistic choice: stage 1's guarantee — "a tool
// the caller cannot reach is never ranked, never returned" — is only true
// because nothing downstream ever sees the full index. `rankTools` reads
// `index.tools` exactly once, at stage 1, and every later stage works from
// `survivors`.

import { applyHardFilters } from './filter.js';
import { applyBoosts, totalScore, type BoostInput } from './boosts.js';
import { fuse } from './fusion.js';
import { scoreBm25 } from './bm25.js';
import { WAVE0_SEMANTIC_CHANNEL, isSemanticChannelEnabled } from './semantic.js';
import { resolveWeights } from './weights.js';
import type { CatalogueIndex } from '../index/types.js';
import type { ChannelScores, FloorPolicy, RankContext, RankQuery, RankedResult } from './types.js';

/**
 * The Wave 0 stage 6. **Not a floor of zero — the explicit absence of one.**
 * W0-G3 owns the calibrated floor, the `no_tool` verdict and the top-2 margin
 * `choose` block (02 §5.4.4, §5.5) and replaces this value; 02 §5.4.4 is
 * emphatic that the floor is "a committed configuration value with the
 * calibration run that produced it", so guessing a number here would be
 * exactly the failure that section warns against.
 */
export const PASS_THROUGH_FLOOR: FloorPolicy = {
  id: 'pass-through',
  apply: (ranked) => ranked,
};

/**
 * Rank the catalogue for one query and one session.
 *
 * Deterministic: a pure function of (index, query, context). Equal scores are
 * broken by tool id so two runs over the same inputs produce byte-identical
 * output — the property `forge bench --json` needs to produce reproducible
 * CI numbers.
 */
export function rankTools(
  index: CatalogueIndex,
  query: RankQuery,
  context: RankContext,
): readonly RankedResult[] {
  const weights = resolveWeights(context.weights);

  // ---- Stage 1: hard filters + visible(session). ---------------------------
  // Everything after this point sees `survivors` and never `index.tools`.
  const survivors = applyHardFilters(index.tools, context.visibility, query.filters);
  if (survivors.length === 0) return [];

  // ---- Stage 2: lexical channel. ------------------------------------------
  const channels: ChannelScores[] = [scoreBm25(query.text, survivors)];

  // ---- Stage 3: semantic channel — absent at Wave 0 (02 §5.4.3). ----------
  const semantic = context.semanticChannel ?? WAVE0_SEMANTIC_CHANNEL;
  if (semantic !== null && isSemanticChannelEnabled(semantic)) {
    channels.push(semantic.score(query.text, survivors));
  }

  // ---- Stage 4: reciprocal rank fusion. -----------------------------------
  const fused = fuse(channels, weights.rrfK);

  // ---- Stage 5: deterministic boosts. -------------------------------------
  // `exactOptionalPropertyTypes` is on: an absent consumption map is an
  // ABSENT property, never a present `undefined`.
  const boostInput: BoostInput =
    context.consumption === undefined
      ? { queryText: query.text, visibility: context.visibility, weights }
      : {
          queryText: query.text,
          visibility: context.visibility,
          consumption: context.consumption,
          weights,
        };
  const scored: RankedResult[] = survivors.map((entry) => {
    const breakdown = applyBoosts(entry, fused.get(entry.id) ?? 0, boostInput);
    return { id: entry.id, score: totalScore(breakdown), breakdown, entry };
  });
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));

  // ---- Stage 6: floor + margin — W0-G3. -----------------------------------
  const floor = context.floor ?? PASS_THROUGH_FLOOR;
  const final = floor.apply(scored, query);

  const limit = query.limit;
  if (limit !== undefined && limit >= 0 && limit < final.length) return final.slice(0, limit);
  return final;
}
