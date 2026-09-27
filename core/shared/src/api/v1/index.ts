// MCPForge — the `/api/v1/**` wire contract. W0-P3a.
//
// W0-P2 §7 (owner decision, 25 Sep 2026): a READ-ONLY governance API on the
// gateway, serving runtime state only. Definitional reads (roles, consumers,
// manifests, approvals records) stay on git. It never serves tool discovery,
// tool invocation or any write; a change towards any of those is the REST
// facade CLAUDE.md §3 forbids and needs a fresh decision.
//
// W0-P3 (owner decision, 27 Sep 2026) approved these eight endpoints, and
// "response types live once in core/shared as zod schemas, used by both the
// portal and the gateway". This file is that one place. The gateway parses
// every response it sends through these schemas in its tests; the portal
// parses every response it receives through them at runtime.
//
// Every call needs BOTH a registered consumer (`mcpforge-consumer-assertion`)
// AND a signed-in human (`Authorization: Bearer`), exactly as `/mcp` does
// (non-negotiable 6). What a response contains is filtered by the READ
// AUTHORITY (owner decision, 27 Sep 2026): a row is visible when its tool is
// in the viewer's scope (Deployed ∩ Granted ∩ ConsumerAuthorized: the
// consumer's authorizations intersected with the human's roles), or when the
// viewer made it. Integrity verification and usage are counts, visible to any
// signed-in viewer, and carry no row contents.

import { z } from 'zod';

export const API_V1_PREFIX = '/api/v1';

/** The eight approved paths. Nothing else under the prefix exists. */
export const API_V1_PATHS = {
  calls: '/api/v1/calls',
  call: (callId: string) => `/api/v1/calls/${encodeURIComponent(callId)}`,
  auditVerify: '/api/v1/audit/verify',
  approvals: '/api/v1/approvals',
  approval: (approvalId: string) => `/api/v1/approvals/${encodeURIComponent(approvalId)}`,
  consumerUsage: '/api/v1/consumers/usage',
  enablement: '/api/v1/enablement',
  deployment: '/api/v1/deployment',
} as const;

/** Default and ceiling for `?limit=` on list endpoints. */
export const API_V1_PAGE_DEFAULT = 50;
export const API_V1_PAGE_MAX = 200;

// --- errors ------------------------------------------------------------------

/** Every refusal. `next` is never empty (non-negotiable 5). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    next: z.string().min(1),
    correlationId: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- calls -------------------------------------------------------------------

export const AUDIT_PHASES = ['plan', 'execute', 'reject', 'reverse'] as const;
export const AUDIT_OUTCOMES = [
  'ok',
  'business_error',
  'policy_denied',
  'binding_error',
  'timeout',
] as const;

const resultKeySchema = z.object({ keyName: z.string(), keyValue: z.string() });

/** One row of the calls list. Field names are `AuditCallRecord`'s. */
export const callSummarySchema = z.object({
  id: z.string(),
  ts: z.string(),
  callerSubject: z.string(),
  callerDisplay: z.string().nullable(),
  consumerId: z.string(),
  toolId: z.string(),
  verb: z.string().nullable(),
  isWrite: z.boolean(),
  phase: z.enum(AUDIT_PHASES),
  outcome: z.enum(AUDIT_OUTCOMES),
  targetEnv: z.string().nullable(),
  latencyMsTotal: z.number().nullable(),
  resultKeys: z.array(resultKeySchema),
  reversesCallId: z.string().nullable(),
  reversedByCallId: z.string().nullable(),
  deploymentId: z.string(),
});
export type CallSummary = z.infer<typeof callSummarySchema>;

export const callsPageSchema = z.object({
  asOf: z.string(),
  items: z.array(callSummarySchema),
  /** Pass as `?cursor=` for the next (older) page; `null` on the last page. */
  nextCursor: z.string().nullable(),
});
export type CallsPage = z.infer<typeof callsPageSchema>;

/** The full audit record. `argsRedacted` is already redacted at write time. */
export const callDetailSchema = callSummarySchema.extend({
  correlationId: z.string().nullable(),
  sessionId: z.string().nullable(),
  parentCallId: z.string().nullable(),
  callerIdp: z.string().nullable(),
  callerAmr: z.string().nullable(),
  callerRoles: z.array(z.string()),
  onBehalfOf: z.string().nullable(),
  consumerRecordSha: z.string().nullable(),
  consumerAuthMethod: z.string().nullable(),
  consumerSessionId: z.string().nullable(),
  humanInTheLoop: z.boolean(),
  toolVersion: z.string().nullable(),
  manifestSha: z.string().nullable(),
  serverId: z.string().nullable(),
  packageId: z.string().nullable(),
  bindingType: z.string().nullable(),
  archetype: z.string().nullable(),
  entity: z.string().nullable(),
  sensitivityClass: z.string().nullable(),
  targetSystem: z.string().nullable(),
  targetObject: z.string().nullable(),
  gatewayVersion: z.string().nullable(),
  bundleVersion: z.string().nullable(),
  confirmTokenHash: z.string().nullable(),
  planHash: z.string().nullable(),
  argsHash: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  replayed: z.boolean().nullable(),
  argsRedacted: z.unknown(),
  rowCount: z.number().nullable(),
  bytesOut: z.number().nullable(),
  errorCode: z.string().nullable(),
  errorMessageAgent: z.string().nullable(),
  deniedByRule: z.string().nullable(),
  identityCarrying: z.boolean().nullable(),
  targetIdentityObserved: z.string().nullable(),
  identityMatch: z.boolean().nullable(),
  compensatingControl: z.enum(['client_identifier', 'wrapper_schema', 'none']).nullable(),
  reversalClass: z.string().nullable(),
  reversalToolId: z.string().nullable(),
  latencyMsGateway: z.number().nullable(),
  latencyMsTarget: z.number().nullable(),
  prevHash: z.string(),
  rowHash: z.string(),
  /** References only — `secretRef://…` and a version. Never a value (non-negotiable 8). */
  credentialRefs: z.array(z.object({ secretRef: z.string(), version: z.string().nullable() })),
  /** The runtime approval this call went through, if any, and its current state. */
  approval: z
    .object({
      approvalId: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'expired']),
      approverSubject: z.string().nullable(),
    })
    .nullable(),
});
export type CallDetail = z.infer<typeof callDetailSchema>;

export const callDetailResponseSchema = z.object({ asOf: z.string(), call: callDetailSchema });
export type CallDetailResponse = z.infer<typeof callDetailResponseSchema>;

// --- audit integrity ---------------------------------------------------------

/** One deployment chain's verification. Counts and positions only, never row contents. */
export const chainVerificationSchema = z.object({
  deploymentId: z.string(),
  status: z.string(),
  rowsChecked: z.number(),
  origin: z.object({ kind: z.enum(['genesis', 'retention_boundary']) }).nullable(),
  firstBreak: z
    .object({
      position: z.number(),
      reason: z.string(),
      message: z.string(),
      next: z.string(),
    })
    .nullable(),
});
export type ChainVerification = z.infer<typeof chainVerificationSchema>;

export const auditVerifyResponseSchema = z.object({
  asOf: z.string(),
  chains: z.array(chainVerificationSchema),
});
export type AuditVerifyResponse = z.infer<typeof auditVerifyResponseSchema>;

// --- approvals (runtime) -----------------------------------------------------

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

/** One `approval_request` row. Field names are `ApprovalRequest`'s. */
export const runtimeApprovalSchema = z.object({
  id: z.string(),
  planHash: z.string(),
  argsCanonicalHash: z.string(),
  /** The exact plan string shown to the approver — rendered verbatim. */
  planSummary: z.string().nullable(),
  callerSubject: z.string(),
  consumerId: z.string().nullable(),
  toolId: z.string(),
  toolVersion: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  approverSubject: z.string().nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type RuntimeApproval = z.infer<typeof runtimeApprovalSchema>;

export const approvalsResponseSchema = z.object({
  asOf: z.string(),
  status: z.enum(['pending', 'decided']),
  items: z.array(runtimeApprovalSchema),
});
export type ApprovalsResponse = z.infer<typeof approvalsResponseSchema>;

export const approvalDetailResponseSchema = z.object({
  asOf: z.string(),
  approval: runtimeApprovalSchema,
});
export type ApprovalDetailResponse = z.infer<typeof approvalDetailResponseSchema>;

// --- consumer usage ----------------------------------------------------------

export const USAGE_WINDOWS = ['24h', '7d'] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export const usageBucketSchema = z.object({
  bucketStart: z.string(),
  calls: z.number(),
  writes: z.number(),
  plansMinted: z.number(),
  plansConfirmed: z.number(),
  plansNeverConfirmed: z.number(),
  refusals: z.array(z.object({ errorCode: z.string(), count: z.number() })),
  distinctTools: z.number(),
  distinctSubjects: z.number(),
  p95LatencyMs: z.number().nullable(),
  identityMismatches: z.number(),
});
export type UsageBucket = z.infer<typeof usageBucketSchema>;

export const anomalyEventSchema = z.object({
  id: z.string(),
  ts: z.string(),
  detectorId: z.string(),
  severity: z.string(),
  window: z.string(),
  observed: z.number(),
  threshold: z.number(),
  state: z.string(),
  /** Evidence. Each id opens only if the viewer may read that call. */
  auditCallIds: z.array(z.string()),
});
export type AnomalyEventView = z.infer<typeof anomalyEventSchema>;

export const consumerUsageSchema = z.object({
  consumerId: z.string(),
  granularity: z.enum(['hour', 'day']),
  /** Oldest first; a bucket with no traffic is present with zero counts. */
  buckets: z.array(usageBucketSchema),
  limits: z.object({ callsPerMinute: z.number(), writesPerDay: z.number() }),
  events: z.array(anomalyEventSchema),
});
export type ConsumerUsage = z.infer<typeof consumerUsageSchema>;

export const consumerUsageResponseSchema = z.object({
  asOf: z.string(),
  window: z.enum(USAGE_WINDOWS),
  consumers: z.array(consumerUsageSchema),
});
export type ConsumerUsageResponse = z.infer<typeof consumerUsageResponseSchema>;

// --- enablement --------------------------------------------------------------

export const enablementToolSchema = z.object({
  toolId: z.string(),
  /** `null` when no probe report names this tool: unprobed, and so not enabled. */
  status: z.string().nullable(),
  bindingType: z.string(),
  failingCheck: z.string().nullable(),
  remediation: z.string().nullable(),
  owningTeam: z.string().nullable(),
});
export type EnablementTool = z.infer<typeof enablementToolSchema>;

export const enablementResponseSchema = z.object({
  asOf: z.string(),
  /** The report the statuses come from; `null` when no probe has run here. */
  probe: z
    .object({
      deploymentId: z.string(),
      environmentClass: z.string(),
      finishedAt: z.string(),
      toolCount: z.number(),
    })
    .nullable(),
  tools: z.array(enablementToolSchema),
});
export type EnablementResponse = z.infer<typeof enablementResponseSchema>;

// --- deployment --------------------------------------------------------------

export const killFlagSchema = z.object({
  id: z.string(),
  scope: z.string(),
  target: z.string(),
  reason: z.string(),
  until: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type KillFlag = z.infer<typeof killFlagSchema>;

export const deploymentResponseSchema = z.object({
  asOf: z.string(),
  deploymentId: z.string(),
  packageIds: z.array(z.string()),
  gatewayVersion: z.string(),
  /** sha256 over the served catalogue's sorted tool ids and manifest hashes. */
  catalogueDigest: z.string(),
  toolCount: z.number(),
  store: z.object({
    kind: z.enum(['sqlite', 'postgres']),
    label: z.string(),
    ephemeral: z.boolean(),
  }),
  identityProviderKind: z.string(),
  killFlags: z.array(killFlagSchema),
});
export type DeploymentResponse = z.infer<typeof deploymentResponseSchema>;
