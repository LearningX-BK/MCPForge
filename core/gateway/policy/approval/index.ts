// MCPForge — the human-approval gate. W0-F6, 02 §3.1.1, 03 §7.4.
//
// The `awaiting_human_approval` fork of stage 6g's state machine: raise,
// decide, poll, expire. **No `confirmToken` is minted until a named approver
// approves**, and the token that approval unlocks names the REQUESTER, never
// the approver (./mint.ts).
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

export { approvalGate } from './gate.js';
export { epochSeconds, mintApprovedToken } from './mint.js';
export { APPROVAL_ROUTE, absoluteApprovalUrl, relativeApprovalUrl } from './url.js';
export {
  DEFAULT_APPROVAL_TTL_SECONDS,
  type ApprovalGate,
  type ApprovalGateDeps,
  type ApprovalQueue,
  type ApprovalRefusal,
  type ApprovalUrlBuilder,
  type DecideApprovalCommand,
  type DecisionOutcome,
  type RaiseApprovalInput,
  type RaiseOutcome,
  type StatusOutcome,
} from './types.js';
