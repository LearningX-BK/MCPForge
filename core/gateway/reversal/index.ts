// MCPForge — the reversal registry. W0-F5, 02 §3.1.4, 03 §7.5.
//
// 02 §3.1.4: "The registry is live, not documentation." At execute time the
// gateway freezes `reversal_class`, the reversing tool id and the extracted
// `result_keys` into the audit row (`../policy/idempotency/dispatch.ts`); here
// is where those are read back and turned into a real reversing call that runs
// the full plan -> confirm sequence.

export { constructReversingCall, contractForCall, resultKeyName } from './construct.js';
export { extractResultKeys, readJsonPath, resultKeyMap } from './result-keys.js';
export { EMPTY_REVERSAL_REGISTRY, reversalRegistry } from './registry.js';
export { reverseCall, type ReverseCallDeps } from './reverse.js';
export type {
  ConstructedReversal,
  ResultKeySpec,
  ReversalConstruction,
  ReversalContract,
  ReversalExecution,
  ReversalExecutor,
  ReversalRefusal,
  ReversalRefusalReason,
  ReversalRegistry,
  ReversalReport,
  ReversingCall,
} from './types.js';
