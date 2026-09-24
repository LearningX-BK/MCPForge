// MCPForge — 02 §5.4.2 STAGE 3: the semantic channel.
//
//   "3. Semantic channel   cosine over embeddings (when enabled, §5.4.3)."
//
// **THERE IS NO IMPLEMENTATION IN THIS FILE, AND THAT IS THE DELIVERABLE.**
// W0-G2's `done:` reads: "the semantic channel is a pluggable interface left
// unimplemented at Wave 0 (Wave 1 conditional, 02 §5.4.3)". 02 §5.4.3 is
// explicit that the decision is *staged* and gated on a measurement that has
// not been taken yet:
//
//   Wave 0 — lexical only. Measure SA@1 on the benchmark. Record it.
//   Wave 1 — IF SA@1 is below 90% on the lexical channel alone, enable the
//            embedding channel: bge-small/gte-small class, ~130 MB, in-process
//            via `onnxruntime-node`, vectors precomputed at codegen time.
//   Never  — an external embedding API.
//
// Building it now would pre-empt that gate, add a ~130 MB model and an
// `onnxruntime-node` dependency to a Wave 0 that must install from a clean
// clone with no Docker, and — worst — it would make the Wave 1 decision
// unmeasurable, because the lexical-only SA@1 number the gate reads is
// produced by a pipeline with no semantic channel in it.
//
// The interface itself lives in `./types.ts` (`SemanticChannel`) so that the
// pipeline's stage 3 is a real, ordered, typed stage today rather than a
// comment promising one later.

import type { SemanticChannel } from './types.js';

/**
 * The Wave 0 binding for stage 3: explicitly `null`, not a no-op object.
 *
 * The distinction is load-bearing. A no-op implementation would appear in
 * fusion as a channel that retrieved nothing, and a future reader could not
 * tell "disabled" from "enabled and returning no hits" — nor could a
 * benchmark record which of the two produced its number. `null` means the
 * channel is ABSENT: `rankTools` skips stage 3 entirely and fusion runs over
 * one channel.
 *
 * Wave 1 replaces this value; it does not add a branch anywhere else.
 */
export const WAVE0_SEMANTIC_CHANNEL: SemanticChannel | null = null;

/** Is a semantic channel enabled for this call? Wave 0: always false, because `RankContext.semanticChannel` defaults to `WAVE0_SEMANTIC_CHANNEL`. */
export function isSemanticChannelEnabled(channel: SemanticChannel | null | undefined): boolean {
  return channel !== null && channel !== undefined;
}
