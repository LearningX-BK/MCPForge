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
// W0-P25 (owner decision, 30 Sep 2026, option (a)) adds exactly ONE write:
// `POST /api/v1/approvals/{id}/decision`, a human deciding a runtime approval
// request. It decides through the gateway's approval gate and nothing else, it
// never returns the confirm token (that belongs to the requester), and every
// decision and every refused attempt is a hash-chained `approve` audit row.
// Every other path under the prefix stays GET-only.
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

/**
 * The eight approved reads, the one decision write (W0-P25) and local user
 * administration (W0-P28). Nothing else under the prefix exists.
 */
export const API_V1_PATHS = {
  calls: '/api/v1/calls',
  call: (callId: string) => `/api/v1/calls/${encodeURIComponent(callId)}`,
  auditVerify: '/api/v1/audit/verify',
  approvals: '/api/v1/approvals',
  approval: (approvalId: string) => `/api/v1/approvals/${encodeURIComponent(approvalId)}`,
  /** W0-P25 — `POST` only. The single write under the prefix. */
  approvalDecision: (approvalId: string) =>
    `/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
  consumerUsage: '/api/v1/consumers/usage',
  enablement: '/api/v1/enablement',
  deployment: '/api/v1/deployment',
  /** W0-P28 — `GET` lists local users, `POST` creates one. Identity admins only. */
  adminUsers: '/api/v1/admin/users',
  /** W0-P28 — `POST` only: disable, enable, set groups, reset password. */
  adminUser: (subject: string) => `/api/v1/admin/users/${encodeURIComponent(subject)}`,
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

/** `approve` (W0-P25): a human deciding a runtime approval request, or a refused attempt to. */
/** `identity` (W0-P28): an identity admin changing a local user, or a refused attempt to. */
/** `catalogue` (W0-P33c): a super admin reloading the gateway catalogue, or a refused attempt to. */
/** `probe` (W0-P33d): a super admin running the capability probe from the portal, or a refused attempt to. */
export const AUDIT_PHASES = [
  'plan',
  'execute',
  'reject',
  'reverse',
  'approve',
  'identity',
  'catalogue',
  'probe',
] as const;
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
  /**
   * W0-P3d — set on a replayed call (`replayed: true`): the original execution
   * it returned the result of, from the idempotency record. `null` when this is
   * not a replay, or when the record has expired and the original can no
   * longer be named. Never guessed.
   */
  replayOf: z.object({ callId: z.string(), ts: z.string() }).nullable(),
  /** The runtime approval this call went through, if any, and its current state. */
  approval: z
    .object({
      approvalId: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'expired']),
      approverSubject: z.string().nullable(),
      /** W0-P32 — the requester decided it themselves, as super admin. */
      selfApproved: z.boolean(),
    })
    .nullable(),
});
export type CallDetail = z.infer<typeof callDetailSchema>;

export const callDetailResponseSchema = z.object({ asOf: z.string(), call: callDetailSchema });
export type CallDetailResponse = z.infer<typeof callDetailResponseSchema>;

// --- audit integrity ---------------------------------------------------------

export const AUDIT_CHAIN_STATUSES = [
  'empty',
  'intact',
  'intact_from_retention_boundary',
  'broken',
] as const;

/**
 * One deployment chain's verification: counts, positions and row IDS, never
 * row contents or hashes. An id is what the operator needs to investigate
 * ("inspect this call id"); opening it is still subject to the read authority.
 */
export const chainVerificationSchema = z.object({
  deploymentId: z.string(),
  status: z.enum(AUDIT_CHAIN_STATUSES),
  rowsChecked: z.number(),
  origin: z
    .object({
      kind: z.enum(['genesis', 'retention_boundary']),
      firstRowId: z.string(),
      /** The retention attestation row that accounts for a boundary origin. */
      attestationCallId: z.string().nullable(),
    })
    .nullable(),
  firstBreak: z
    .object({
      rowId: z.string(),
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
  /**
   * W0-P32 — the requester decided their own request (only a super admin may,
   * owner decision 30 Sep 2026). Derived from the row: approver === requester.
   * Always shown wherever the approval is.
   */
  selfApproved: z.boolean(),
});

/** W0-P32 — the one definition of "self-approved" every surface uses. */
export function isSelfApproved(a: {
  readonly approverSubject: string | null;
  readonly callerSubject: string;
}): boolean {
  return a.approverSubject !== null && a.approverSubject === a.callerSubject;
}
export type RuntimeApproval = z.infer<typeof runtimeApprovalSchema>;

export const approvalsResponseSchema = z.object({
  asOf: z.string(),
  status: z.enum(['pending', 'decided']),
  items: z.array(runtimeApprovalSchema),
});
export type ApprovalsResponse = z.infer<typeof approvalsResponseSchema>;

/**
 * W0-P3f — the plan body the requester was shown, as stored with the approval
 * request. Field names are the gateway's `PlanBody` (02 §3.1.1).
 */
export const planBodySchema = z.object({
  status: z.literal('confirm_required'),
  plan: z.string(),
  effects: z.array(
    z.object({
      system: z.string(),
      object: z.string(),
      action: z.string(),
      reversible: z.boolean(),
    }),
  ),
  warnings: z.array(z.string()),
  reversal: z.object({
    class: z.enum(['native-reverse', 'compensating-tool', 'transactional', 'irreversible']),
    tool: z.string().optional(),
    windowHours: z.number().optional(),
    preconditions: z.string().optional(),
  }),
});
export type PlanBody = z.infer<typeof planBodySchema>;

/**
 * `verified`: the stored body re-hashes to the approval's `planHash`, so it IS
 * the plan being approved. `absent`: the request predates stored bodies.
 * `mismatch`: the stored body does not hash to `planHash`; it is withheld
 * (`planBody: null`) and the request cannot be decided.
 */
export const PLAN_BODY_STATUSES = ['verified', 'absent', 'mismatch'] as const;

export const approvalDetailResponseSchema = z.object({
  asOf: z.string(),
  approval: runtimeApprovalSchema,
  /** Present only when `planBodyStatus` is `verified`. */
  planBody: planBodySchema.nullable(),
  planBodyStatus: z.enum(PLAN_BODY_STATUSES),
});
export type ApprovalDetailResponse = z.infer<typeof approvalDetailResponseSchema>;

// --- approval decision (W0-P25, the one write) ----------------------------------

/** Longest decline reason accepted. It is returned to the requester's agent as its `next`. */
export const APPROVAL_REASON_MAX = 2000;

/**
 * The request body. The approver is NEVER in it: the gateway takes the approver
 * from the signed-in human, so a body cannot name someone else as approver.
 * A decline needs a reason, because 03 §7.4 returns it to the agent as its `next`.
 */
export const approvalDecisionRequestSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(1).max(APPROVAL_REASON_MAX).optional(),
  })
  .strict()
  .refine((body) => body.decision !== 'rejected' || body.reason !== undefined, {
    message: 'A decline needs a reason.',
    path: ['reason'],
  });
export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionRequestSchema>;

/**
 * The response to a decision that was recorded. It carries NO confirm token:
 * the token belongs to the requester, who collects it with
 * `forge.approval.status` (03 §7.4, the approver never executes).
 */
export const approvalDecisionResponseSchema = z.object({
  asOf: z.string(),
  approval: runtimeApprovalSchema,
  /** The hash-chained `approve` audit row this decision wrote. */
  auditCallId: z.string(),
  next: z.string().min(1),
});
export type ApprovalDecisionResponse = z.infer<typeof approvalDecisionResponseSchema>;

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

// --- local user administration (W0-P28) --------------------------------------
//
// Owner decisions, 30 Sep 2026: local users are administered from the portal,
// through these endpoints, by members of the groups listed under
// `identityAdmins:` in the deployment's git-held group mapping. Every change
// and every refused attempt is a hash-chained `identity` audit row that never
// carries a password. A password travels only in a request body, is never
// returned, and is never echoed in a refusal.

/** Mirrors the gateway's floor (`identity/local/password.ts`). Length is the only rule. */
export const LOCAL_PASSWORD_MIN = 12;
export const LOCAL_PASSWORD_MAX = 1024;

const groupNameSchema = z.string().trim().min(1).max(256);
const groupListSchema = z.array(groupNameSchema).max(64);
const passwordSchema = z.string().min(LOCAL_PASSWORD_MIN).max(LOCAL_PASSWORD_MAX);

/** A local account as an identity admin sees it. No credential field exists on it. */
export const adminUserSchema = z.object({
  subject: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  active: z.boolean(),
  totpEnrolled: z.boolean(),
  lockedUntil: z.string().nullable(),
  lastAuthenticatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  groups: z.array(z.string()),
  /** Holds a group listed in `identityAdmins:`. */
  identityAdmin: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersResponseSchema = z.object({
  asOf: z.string(),
  /** The `identityAdmins:` groups, as git holds them for this deployment. */
  identityAdminGroups: z.array(z.string()),
  users: z.array(adminUserSchema),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

/** `POST /api/v1/admin/users`: create one account. */
export const adminCreateUserRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(256),
    email: z.string().trim().email().max(320).optional(),
    password: passwordSchema,
    groups: groupListSchema.default([]),
  })
  .strict();
export type AdminCreateUserRequest = z.input<typeof adminCreateUserRequestSchema>;

/** `POST /api/v1/admin/users/{subject}`: one change to one account. */
export const adminUserActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disable') }).strict(),
  z.object({ action: z.literal('enable') }).strict(),
  z.object({ action: z.literal('set_groups'), groups: groupListSchema }).strict(),
  z.object({ action: z.literal('reset_password'), password: passwordSchema }).strict(),
]);
export type AdminUserActionRequest = z.infer<typeof adminUserActionRequestSchema>;

export const ADMIN_USER_ACTIONS = [
  'create',
  'disable',
  'enable',
  'set_groups',
  'reset_password',
] as const;
export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

/** The answer to a change that was made. */
export const adminUserChangeResponseSchema = z.object({
  asOf: z.string(),
  action: z.enum(ADMIN_USER_ACTIONS),
  user: adminUserSchema,
  /** The hash-chained `identity` audit row this change wrote. */
  auditCallId: z.string(),
  next: z.string().min(1),
});
export type AdminUserChangeResponse = z.infer<typeof adminUserChangeResponseSchema>;

// --- catalogue reload (W0-P33c) ------------------------------------------------
//
// Decision C of the approved W0-P33 design note (owner, 30 Sep 2026): "Reload
// endpoint (Recommended)". A super admin, through a consumer that allows
// writes and has a human in its loop, asks the gateway to re-load its runtime
// catalogue from the definitions clone. The new catalogue is swapped in only
// if it loads cleanly; otherwise the old one keeps serving and the refusal
// says why. Every attempt is a hash-chained `catalogue` audit row.

export const CATALOGUE_RELOAD_PATH = `${API_V1_PREFIX}/admin/catalogue/reload`;

/** One reason a reload was refused, shaped like a `forge validate` failure. */
export const catalogueLoadFailureSchema = z.object({
  ruleId: z.string().min(1),
  file: z.string(),
  message: z.string().min(1),
  fix: z.string().min(1),
});
export type CatalogueLoadFailureView = z.infer<typeof catalogueLoadFailureSchema>;

/** `POST /api/v1/admin/catalogue/reload`, when the new catalogue is serving. */
export const catalogueReloadResponseSchema = z.object({
  asOf: z.string(),
  /** 1 at gateway start; +1 per successful reload. */
  generation: z.number().int().min(1),
  previousGeneration: z.number().int().min(1),
  /** sha256 over the served catalogue's tool ids and manifest bytes (as /deployment). */
  catalogueDigest: z.string(),
  toolCount: z.number().int().min(0),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
  /** The hash-chained `catalogue` audit row this reload wrote. */
  auditCallId: z.string(),
  next: z.string().min(1),
});
export type CatalogueReloadResponse = z.infer<typeof catalogueReloadResponseSchema>;

/**
 * The refusal when the definitions did not load: an ordinary `ApiError`
 * (code `CATALOGUE_LOAD_REFUSED`, HTTP 409) plus every failure, so the portal
 * can show why without a second request.
 */
export const catalogueReloadRefusalSchema = apiErrorSchema.extend({
  reload: z.object({
    /** The generation still serving: nothing changed. */
    generation: z.number().int().min(1),
    failures: z.array(catalogueLoadFailureSchema).min(1),
    auditCallId: z.string(),
  }),
});
export type CatalogueReloadRefusal = z.infer<typeof catalogueReloadRefusalSchema>;

// --- portal-triggered probe (W0-P33d) -------------------------------------------
//
// Decision D of the approved W0-P33 design note (owner, 30 Sep 2026: "Local and
// dev only (Recommended)"). A super admin, through a consumer that allows
// writes and has a human in its loop, asks the gateway to run the capability
// probe for its own deployment. Served only where the deployment's
// environment class allows it (`local`); everywhere else the probe stays a CLI
// act and the refusal says which command. Every attempt is a hash-chained
// `probe` audit row. A run that completes writes the report and then reloads
// the catalogue, so the new statuses are what the gateway serves.

export const PROBE_RUN_PATH = `${API_V1_PREFIX}/admin/probe`;

/** `POST /api/v1/admin/probe`, when the probe ran and its report was written. */
export const probeRunResponseSchema = z.object({
  asOf: z.string(),
  deploymentId: z.string(),
  environmentClass: z.string(),
  targetId: z.string(),
  finishedAt: z.string(),
  toolCount: z.number().int().min(0),
  /** Tools per probe status (02 §4.5's closed enum). */
  byStatus: z.record(z.string(), z.number().int().min(0)),
  /** The hash-chained `probe` audit row this run wrote. */
  auditCallId: z.string(),
  /** Whether the gateway now serves the new statuses (a catalogue reload ran). */
  enablement: z.object({
    served: z.boolean(),
    /** The catalogue generation serving after the run. */
    generation: z.number().int().min(1),
    /** The `catalogue` audit row of the reload, when one was recorded. */
    reloadAuditCallId: z.string().nullable(),
  }),
  next: z.string().min(1),
});
export type ProbeRunResponse = z.infer<typeof probeRunResponseSchema>;
