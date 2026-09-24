// MCPForge — two-phase confirm. W0-F1, 02 §3.1.1, 03 §7.1.
//
// The plan/execute state machine that fills stage 6g's `WriteGate` seam. There
// is one of these and only one: `confirmWriteGate` is the sole plan/confirm
// mechanism in the codebase and it is reached only through the policy chain.
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

export {
  ARGS_HASH_ALGORITHM,
  CONFIRM_FIELD,
  argsCanonicalHash,
  argumentWitness,
  businessArgs,
  canonicalJson,
  changedArgumentNames,
  changedArgumentNamesFromWitness,
  planCanonicalHash,
} from './hash.js';
export {
  CONFIRM_SIGNING_KEY_BYTES,
  CONFIRM_TOKEN_ALGORITHM,
  CONFIRM_TOKEN_PREFIX,
  DEFAULT_CONFIRM_TTL_SECONDS,
  confirmSigningKeyFrom,
  generateConfirmSigningKey,
  mintConfirmToken,
  singleKeyKeyring,
  verifyConfirmToken,
  type ConfirmKeyring,
  type ConfirmSigningKey,
  type ConfirmTokenBinding,
  type ConfirmTokenFailure,
  type ConfirmTokenPayload,
  type ConfirmTokenVerification,
} from './token.js';
export {
  buildPlanBody,
  declaredEffect,
  renderPlanText,
  type DryRunOutcome,
  type PlanBody,
  type PlanEffect,
  type PlanReversal,
} from './plan.js';
export {
  confirmWriteGate,
  type ConfirmGateDeps,
  type DryRunner,
  type WriteSafetyView,
} from './gate.js';
