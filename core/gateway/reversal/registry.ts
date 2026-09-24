// MCPForge — the reversal registry, built from the catalogue. W0-F5, 02 §3.1.4.
//
// A map, deliberately: "the registry" in 02 §3.1.4 is not a service and not a
// second source of truth. Every contract in it comes from a tool manifest's
// `writeSafety.reversal` block, so a reversal a reviewer cannot see in the
// change proposal cannot exist at runtime.

import type { ReversalContract, ReversalRegistry } from './types.js';

/** toolId -> its manifest's `writeSafety.reversal`. Unknown ids answer `undefined`. */
export function reversalRegistry(
  contracts: Readonly<Record<string, ReversalContract>> | ReadonlyMap<string, ReversalContract>,
): ReversalRegistry {
  const map =
    contracts instanceof Map
      ? contracts
      : new Map(Object.entries(contracts as Record<string, ReversalContract>));
  return { contractFor: (toolId: string) => map.get(toolId) };
}

/** A registry that knows nothing — for a deployment with no write tools loaded. */
export const EMPTY_REVERSAL_REGISTRY: ReversalRegistry = { contractFor: () => undefined };
