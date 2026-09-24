// MCPForge — `forge.invoke`. W0-G4, 02 §5.2 tool 4, §11.4.6.
//
// This file is four lines of code and that is the deliverable.
//
// "Executes any tool the caller is granted, through the **identical** policy
// chain, two-phase confirm, guardrails and audit path as a direct call"
// (02 §5.2). CLAUDE.md #7: "`forge.invoke` is not a way around it — it runs the
// identical chain." W0-E3 built `callThroughToolsCall` and
// `invokeThroughForgeInvoke` as two functions differing in exactly one field
// that no stage reads, and said in its own header that this task would call
// the second one "and inherit the property rather than re-deriving it".
//
// So there is no chain call here, no stage list here, no re-check here, and no
// convenience short-circuit here. Any of those would be a second path, and a
// second path is the thing 02 §11.4.6 calls "the sharpest test". The proof is
// `meta.identical-chain.test.ts`, which drives the same cases through
// `tools/call` and through this function and diffs the outcomes.
//
// THE CONFIRM TOKEN IS AN ORDINARY ARGUMENT. 02 §5.2's input shape carries
// `confirm` beside `arguments`, and the confirm stage (6g) reads it from the
// call's arguments — the canonical argument hash is taken over the arguments
// EXCLUDING `confirm` (W0-F1/F2). So `confirm` is merged into the argument map
// rather than travelling separately: a second channel for it would be a second
// place the plan-binding rules could drift.

import { invokeThroughForgeInvoke, type PolicyDecision } from '../policy/index.js';
import type { MetaContext } from './types.js';

export interface InvokeInput {
  readonly toolId: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly confirm?: string | null;
}

export function forgeInvoke(
  ctx: MetaContext,
  input: InvokeInput,
  correlationId: string,
): Promise<PolicyDecision> {
  const args =
    input.confirm === undefined || input.confirm === null
      ? input.arguments
      : { ...input.arguments, confirm: input.confirm };

  return invokeThroughForgeInvoke({ toolId: input.toolId, args, correlationId }, ctx.policy);
}
