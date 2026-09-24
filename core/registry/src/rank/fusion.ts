// MCPForge — 02 §5.4.2 STAGE 4: fusion.
//
//   "4. Fusion   reciprocal rank fusion; a tool ranked well by both wins."
//
// W0-G2. RRF combines ORDERINGS, never raw scores — which is exactly why the
// doc names it: a BM25 score and a cosine similarity are not on the same
// scale and averaging them would be meaningless.
//
//   RRF(d) = Σ_channels 1 / (k + rank_c(d))
//
// NORMALISATION, and why it is not cosmetic. Raw RRF output is bounded by
// C/(k+1) — with one channel and k = 60 a perfect hit scores 0.0164, and the
// gap between rank 1 and rank 2 is 0.00026. Stage 5's boosts and, more
// importantly, stage 6's ABSOLUTE score floor (02 §5.4.4, W0-G3) both need a
// scale a human can calibrate and reason about. So the fused score is divided
// by its theoretical maximum, putting it in (0, 1] where 1.0 means "ranked
// first by every enabled channel". The ordering RRF produces is unchanged —
// division by a positive constant is monotone — so this is a change of units,
// not of behaviour, and it holds identically when Wave 1 adds a second
// channel.

import type { ChannelScores, ToolId } from './types.js';

/** A channel's ordering: tool ids best-first. Ties are broken by id so the ranking is deterministic. */
export function rankOrder(scores: ChannelScores): readonly ToolId[] {
  return [...scores.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([id]) => id);
}

/**
 * Fuse the enabled channels. `channels` carries one entry per ENABLED
 * channel — at Wave 0 that is exactly one, the lexical channel, because
 * stage 3 is absent (./semantic.ts).
 *
 * A tool absent from a channel's output contributes nothing from that
 * channel; it is not given a notional bottom rank. Ids absent from every
 * channel do not appear in the result at all: they survived stage 1 but were
 * retrieved by nothing, and stage 5 will still consider them (a tool the
 * query names structurally but shares no vocabulary with must remain
 * reachable), entering the final ordering with a fusion component of 0.
 */
export function fuse(channels: readonly ChannelScores[], k: number): ReadonlyMap<ToolId, number> {
  const fused = new Map<ToolId, number>();
  if (channels.length === 0) return fused;

  for (const channel of channels) {
    const order = rankOrder(channel);
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i]!;
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }

  const maximum = channels.length / (k + 1);
  const normalised = new Map<ToolId, number>();
  for (const [id, raw] of fused) {
    normalised.set(id, raw / maximum);
  }
  return normalised;
}
