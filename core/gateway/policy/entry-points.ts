// MCPForge — the two entry points into the policy chain. W0-E3.
//
// 02 §11.4.6 calls `forge.invoke` "the sharpest test": it lets a client name a
// tool id directly, so it is the path by which an unlisted tool would be reached
// if step 6a ever trusted what `tools/list` returned. CLAUDE.md #7: "`forge.invoke`
// is not a way around it — it runs the identical chain."
//
// SCOPE, stated plainly (CLAUDE.md §8). The four meta-tools — `forge.find`,
// `forge.describe`, `forge.activate`, `forge.invoke` — are **W0-G4's** task,
// with their own resident token budget and their own `tools/list` semantics.
// This file is NOT that task. It is the call path only: the two functions below
// differ in exactly one field, `entryPoint`, which no stage reads. That is the
// implementation of "identical chain" — not a claim about it, but the reason it
// cannot be otherwise. When W0-G4 builds the meta-tool, it calls
// `invokeThroughForgeInvoke` and inherits the property rather than re-deriving it.

import { runPolicyChain, type PolicyChainOptions, type PolicyDecision } from './chain.js';
import type { PolicyContext } from './types.js';

export interface EntryPointCall {
  readonly toolId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

/** The ordinary MCP `tools/call` path (02 §4.2 step [5]). */
export function callThroughToolsCall(
  call: EntryPointCall,
  ctx: PolicyContext,
  options?: PolicyChainOptions,
): Promise<PolicyDecision> {
  return runPolicyChain({ ...call, entryPoint: 'tools/call' }, ctx, options);
}

/** The `forge.invoke` fallback path (02 §5.2, §11.4.6). The identical chain. */
export function invokeThroughForgeInvoke(
  call: EntryPointCall,
  ctx: PolicyContext,
  options?: PolicyChainOptions,
): Promise<PolicyDecision> {
  return runPolicyChain({ ...call, entryPoint: 'forge.invoke' }, ctx, options);
}
