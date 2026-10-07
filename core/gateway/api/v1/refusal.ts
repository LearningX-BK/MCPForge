// MCPForge — the one refusal shape `/api/v1/**` answers with. W0-P3a, W0-P25.
//
// Shared by the read handlers (./read-api.ts), the decision write
// (./approval-decision.ts), user administration (./user-admin.ts, W0-P28)
// the catalogue reload (./catalogue-reload.ts, W0-P33c) and the portal's
// probe run (./probe-run.ts, W0-P33d) and model-assisted authoring
// (./authoring.ts, W0-Q9b),
// so all three render through the same `ApiError` body
// and the same status table. `next` is a constructor argument, never optional
// (non-negotiable 5).

export class ApiRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly next: string,
  ) {
    super(message);
  }
}

/** Status per refusal code, matching `/mcp`'s front door (`transport/http.ts`). */
export const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  CONSUMER_UNREGISTERED: 401,
  CONSUMER_SUSPENDED: 403,
  CONSUMER_NOT_AUTHORIZED: 403,
  AUTH_REQUIRED: 401,
  IDENTITY_UNRESOLVED: 403,
  POLICY_GUARDRAIL_BREACH: 403,
  TOOL_NOT_IN_SCOPE: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  APPROVAL_REQUIRED: 409,
  PLAN_EXPIRED: 409,
  // W0-P33c: the definitions did not load; the old catalogue keeps serving.
  CATALOGUE_LOAD_REFUSED: 409,
  // W0-P33d: the portal probes a `local` deployment only; elsewhere it is the CLI's.
  PROBE_ENVIRONMENT_REFUSED: 403,
  // W0-P33d: the probe could not be set up (no index, no AIS target, no probe identity).
  CATALOGUE_UNAVAILABLE: 409,
  PROBE_TARGET_UNCONFIGURED: 409,
  INPUT_INVALID: 400,
  // W0-Q9b (D7) — model-assisted authoring (./authoring.ts). The codes are the
  // model adapter's closed taxonomy, plus the gateway's own suggestion binding.
  AUTHORING_NOT_CONFIGURED: 409,
  AUTHORING_FIELD_NOT_ALLOWED: 400,
  AUTHORING_SENSITIVITY_BLOCKED: 403,
  AUTHORING_PROVIDER_UNKNOWN: 400,
  AUTHORING_PROVIDER_UNAVAILABLE: 409,
  AUTHORING_KEY_MISSING: 409,
  AUTHORING_PROVIDER_FAILED: 502,
  AUTHORING_RESPONSE_UNRECOGNISED: 502,
  AUTHORING_GATE_REFUSED: 422,
  AUTHORING_SUGGESTION_UNKNOWN: 409,
  // W0-Q9b (D7.3): suggest at the consumer's callsPerMinute, per subject.
  RATE_LIMITED: 429,
};
