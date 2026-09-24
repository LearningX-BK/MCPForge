// MCPForge — the CLOSED error taxonomy. 02 §3.1.5 (17 codes) + 02 §11.7 (4 more).
//
// "No dead ends" as code, not as a wish: every code carries a non-empty,
// agent-actionable `next`. Never "try again" — a `next` names a tool id or a
// human action (CLAUDE.md non-negotiable #5).
//
// The `next` values below are DEFAULTS. At runtime the handler substitutes a
// specific one naming the actual tool, reason, steward or approver — the four
// Phase 5 codes' defaults are the worked strings from 02 §11.7's table, with
// their <reason>/<steward>/<owner>/<approver>/<grant name> placeholders intact
// because those are the values the call site fills.

/** 02 §3.1.5 — the original seventeen, in the document's order. */
export const BASE_ERROR_CODES = [
  'INPUT_INVALID',
  'AUTH_REQUIRED',
  'IDENTITY_UNRESOLVED',
  'TOOL_NOT_IN_SCOPE',
  'TOOL_DISABLED',
  'POLICY_GUARDRAIL_BREACH',
  'APPROVAL_REQUIRED',
  'PLAN_REQUIRED',
  'PLAN_EXPIRED',
  'PLAN_ARGUMENT_MISMATCH',
  'TARGET_PRECONDITION_FAILED',
  'TARGET_ERROR',
  'TARGET_TIMEOUT',
  'TARGET_UNAVAILABLE',
  'ROW_CAP_EXCEEDED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

/** 02 §11.7 — the taxonomy grows from 17 codes to 21. */
export const CONSUMER_ERROR_CODES = [
  'CONSUMER_UNREGISTERED',
  'CONSUMER_SUSPENDED',
  'CONSUMER_NOT_AUTHORIZED',
  'ELEVATED_GRANT_REQUIRED',
] as const;

export const ERROR_CODES = [...BASE_ERROR_CODES, ...CONSUMER_ERROR_CODES] as const;

export type BaseErrorCode = (typeof BASE_ERROR_CODES)[number];
export type ConsumerErrorCode = (typeof CONSUMER_ERROR_CODES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorCodeSpec {
  readonly code: ErrorCode;
  /** The machine-readable statement of what was true. */
  readonly condition: string;
  /** Non-empty and agent-actionable. Never "try again". */
  readonly next: string;
  readonly retryable: boolean;
}

/**
 * The closed table. Exactly 21 entries, one per code.
 * `retryable` means "the identical call may succeed later without any change by
 * the caller" — a rate limit or a target outage. A refusal that needs a
 * different argument, a grant, a plan or a human is NOT retryable.
 */
export const ERROR_TAXONOMY: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  INPUT_INVALID: {
    code: 'INPUT_INVALID',
    condition: 'Arguments failed the tool schema at policy-chain stage 6d.',
    next: 'Call forge.describe on this tool for the parameter contract and examples, correct the named argument, and call again.',
    retryable: false,
  },
  AUTH_REQUIRED: {
    code: 'AUTH_REQUIRED',
    condition: 'The session presented no valid authentication.',
    next: 'Authenticate the session with the configured identity provider and re-establish it; if you hold no account, ask your MCPForge operator to onboard you.',
    retryable: false,
  },
  IDENTITY_UNRESOLVED: {
    code: 'IDENTITY_UNRESOLVED',
    condition:
      'No target-identity mapping exists for this subject on this target. There is no fallback.',
    next: 'Ask your MCPForge operator to add your target-identity mapping (forge identity remap) for this target; this call cannot proceed without one.',
    retryable: false,
  },
  TOOL_NOT_IN_SCOPE: {
    code: 'TOOL_NOT_IN_SCOPE',
    condition: 'The tool is not in the resolved scope of any role you hold.',
    next: 'Call forge.find to locate a tool your roles do grant for this task, or request the owning role from your MCPForge operator. You are not granted this tool.',
    retryable: false,
  },
  TOOL_DISABLED: {
    code: 'TOOL_DISABLED',
    condition: 'The tool is kill-switched, or the probe reports it unresolved.',
    next: 'Call forge.find for an enabled alternative for this task; the named owner must clear the kill switch or re-run forge probe before this tool returns.',
    retryable: false,
  },
  POLICY_GUARDRAIL_BREACH: {
    code: 'POLICY_GUARDRAIL_BREACH',
    condition:
      'A declared guardrail refused the call — value ceiling, segregation of duties, or sensitivity above the role ceiling.',
    next: 'Reduce the offending argument below the stated ceiling and call again, or ask the named approver to record a policy exception. The breached guardrail is named in the message.',
    retryable: false,
  },
  APPROVAL_REQUIRED: {
    code: 'APPROVAL_REQUIRED',
    condition: 'The write requires an out-of-band human approval before a confirm token is minted.',
    next: 'Ask the named approver to approve this plan in the portal Approvals queue, then call again with the same arguments to obtain the confirm token.',
    retryable: false,
  },
  PLAN_REQUIRED: {
    code: 'PLAN_REQUIRED',
    condition: 'A write tool was called without a confirm token. A write is never one call.',
    next: 'Call this tool with dry_run: true to obtain the plan and its confirm token, show the plan to the human, then call again with that token.',
    retryable: false,
  },
  PLAN_EXPIRED: {
    code: 'PLAN_EXPIRED',
    condition: 'The confirm token is past its TTL.',
    next: 'Call this tool again with dry_run: true to obtain a fresh plan and token, re-show the plan to the human, then confirm within the stated TTL.',
    retryable: false,
  },
  PLAN_ARGUMENT_MISMATCH: {
    code: 'PLAN_ARGUMENT_MISMATCH',
    condition:
      'The arguments do not match the canonical argument hash the confirm token was bound to.',
    next: 'The arguments changed after the human read the plan. Call this tool with dry_run: true to produce a new plan for the new arguments and have the human confirm that one.',
    retryable: false,
  },
  TARGET_PRECONDITION_FAILED: {
    code: 'TARGET_PRECONDITION_FAILED',
    condition: 'The target system refused because a business precondition does not hold.',
    next: 'Read the named object with its .get or .get_status tool to confirm the stated condition, then either satisfy it or call a tool whose preconditions this object meets.',
    retryable: false,
  },
  TARGET_ERROR: {
    code: 'TARGET_ERROR',
    condition: 'The target system returned an application error.',
    next: 'Report the correlationId to the named owning team; if the message names a field, correct it and call again. Do not repeat the identical call.',
    retryable: false,
  },
  TARGET_TIMEOUT: {
    code: 'TARGET_TIMEOUT',
    condition: 'The target exceeded binding.execution.timeoutMs. The outcome is UNKNOWN.',
    next: "Do NOT re-issue a write blindly. Use the tool's .get or .get_status counterpart to determine whether the operation completed, then act on that answer.",
    retryable: false,
  },
  TARGET_UNAVAILABLE: {
    code: 'TARGET_UNAVAILABLE',
    condition: 'The target system is unreachable or refusing connections.',
    next: 'Retry once after the stated interval; if it persists, tell the human the named target system is down and report the correlationId to its owning team.',
    retryable: true,
  },
  ROW_CAP_EXCEEDED: {
    code: 'ROW_CAP_EXCEEDED',
    condition: 'The result set exceeded the mandatory row cap for this binding.',
    next: 'Narrow the query with additional filter arguments (date range, company, status) and call again; the cap is enforced twice and cannot be raised per call.',
    retryable: false,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    condition: 'The consumer or session exceeded its declared calls/writes limit for the window.',
    next: 'Wait until the stated window resets, then call again; if this workload needs a higher limit, ask the consumer owner to raise its declared limits.',
    retryable: true,
  },
  INTERNAL: {
    code: 'INTERNAL',
    condition: 'MCPForge itself failed. No target action was attempted.',
    next: 'Report the correlationId to the MCPForge operator. Tell the human the request did not reach the target system so no business record was created.',
    retryable: false,
  },

  // --- Phase 5, 02 §11.7 -----------------------------------------------------
  CONSUMER_UNREGISTERED: {
    code: 'CONSUMER_UNREGISTERED',
    condition:
      'The presenting consumer has no registration record, or none matching its credential.',
    next: "Register this client via the portal's Consumers registration flow before retrying; see the operator for onboarding.",
    retryable: false,
  },
  CONSUMER_SUSPENDED: {
    code: 'CONSUMER_SUSPENDED',
    condition: 'The consumer is registered but currently suspended, expired or retired.',
    next: "This client's registration is suspended (reason: <reason>). Contact <steward> to resolve, or wait for reinstatement.",
    retryable: false,
  },
  CONSUMER_NOT_AUTHORIZED: {
    code: 'CONSUMER_NOT_AUTHORIZED',
    condition:
      "The consumer's own declared authorizations (binding type, sensitivity, write flag, roles, packages) do not permit this call — the client may not, regardless of what the human may.",
    next: 'Your client is not authorized for this binding type / sensitivity / write. Request a broader consumer authorization from <owner>, not a role change.',
    retryable: false,
  },
  ELEVATED_GRANT_REQUIRED: {
    code: 'ELEVATED_GRANT_REQUIRED',
    condition:
      "The tool is elevated posture and the caller's role/consumer holds no bindingGrant for it.",
    next: 'This tool requires an elevated binding grant (<grant name>). Request it from <approver>; it is not covered by role scope alone.',
    retryable: false,
  },
};
