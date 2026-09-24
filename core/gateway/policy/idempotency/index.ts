// MCPForge — idempotency and the visible replay. W0-F3, 02 §3.1.2.
//
// Stage 6h's gate (./gate.ts) and the guarded write dispatch (./dispatch.ts),
// which is where a confirm token's nonce is actually spent (02 §3.1.1).
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

export { idempotencyKeyForCall } from './key.js';
export { replayedResponse } from './replay.js';
export { idempotencyGate, type IdempotencyGateDeps } from './gate.js';
export {
  writeDispatcher,
  type DispatchWriteInput,
  type WriteDispatcher,
  type WriteDispatcherDeps,
} from './dispatch.js';
export type {
  ScopeHoursLookup,
  WriteDispatchOutcome,
  WritePathStore,
  WriteTargetInvoker,
} from './types.js';
