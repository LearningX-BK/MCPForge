// MCPForge — the call-time kill-switch check. W0-E5.
//
// `../scope/predicates.ts`'s `notKillSwitchedPredicate` already IS this
// check — it is one of the six predicates `resolveScope` runs to build
// `tools/list`. This module exists only so a caller that already knows
// EXACTLY which tool it is about to invoke (the policy chain's step 6a′,
// 02 §4.2 — the independent re-check at call time, not the listing step) can
// ask the same question about one entry without assembling a full
// `ScopeContext` catalogue walk, and get back a real `ForgeError` — carrying
// `TOOL_DISABLED` or `CONSUMER_SUSPENDED` with the flag's own reason text and
// a non-empty `next` — rather than a bare predicate outcome.
//
// This is NOT a second implementation of the kill-switch rule. It calls the
// one predicate that owns it.

import { forgeError, type ForgeError } from '@mcpforge/shared';
import { notKillSwitchedPredicate } from '../scope/predicates.js';
import type { ScopeCatalogueEntry, ScopeContext } from '../scope/types.js';

/**
 * Returns the closed-taxonomy error if `entry` is kill-switched at any of the
 * five granularities right now, or `null` if it is not. `ctx.flags` should be
 * the real, store-backed source (`./poller.ts`) in production — this
 * function does not care which `RuntimeFlagSource` it is given, which is
 * exactly what makes it usable identically in a unit test against
 * `inMemoryRuntimeFlags` and in the gateway against the live poll.
 */
export function killSwitchRefusalError(
  entry: ScopeCatalogueEntry,
  ctx: ScopeContext,
  correlationId: string,
): ForgeError | null {
  const outcome = notKillSwitchedPredicate.evaluate(entry, ctx);
  if (outcome.admitted) return null;
  return forgeError(outcome.code, outcome.reason, correlationId, {
    condition: outcome.reason,
    next: outcome.next,
  });
}
