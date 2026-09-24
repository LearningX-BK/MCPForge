// MCPForge — the gateway's error MAPPING: specific binding-level and
// policy-level failure conditions mapped onto core/shared's already-CLOSED
// 21-code taxonomy (W0-A4). 02 §3.1.5 + §3.2-§3.6.
//
// THIS MODULE DOES NOT DEFINE CODES. It never touches `core/shared/src/errors`
// (a foundational, widely-depended-on module — widening it is a blast-radius
// change per CLAUDE.md §8 and this task's own instructions). Every `code`
// value below is one of `ErrorCode` and every default `next`/`condition` is
// concrete, worked text — never a placeholder — because 03 §10.3 makes error
// `next` copy a first-class, budgeted part of the design system, reviewed like
// any other agent-facing string.
//
// WHY THIS TABLE EXISTS AS CODE, NOT ONLY AS PROSE (W0-E4's job): the POLICY
// layer already maps its own refusals inline, at each of the ten stages
// (core/gateway/policy/stages.ts) and at binding-authorization
// (core/gateway/policy/binding-auth/authorize.ts) and scope resolution
// (core/gateway/scope/predicates.ts) — this task does not re-map what those
// modules already map, and does not touch them beyond reading them. What
// genuinely has NO mapping anywhere yet is the BINDING layer: `adapters/{rest,
// vendor,oracle-worker}` are unbuilt (`.gitkeep` only) and `generated/tools`
// is empty, so 02 §3.2-§3.6's binding-type-specific failure conditions have
// never been written down as gateway-facing code. This table is that mapping,
// authored now so the adapters W0 leaves for later waves have a contract to
// implement against, and so `forge validate`/codegen's generic handler
// template (`core/codegen/src/templates/handler.ts`) — which today only knows
// the generic INPUT_INVALID / POLICY_GUARDRAIL_BREACH / PLAN_ARGUMENT_MISMATCH
// / TARGET_ERROR quartet via `mapUnknownError` — has a documented, tested
// target to grow into.
//
// HONEST SCOPE NOTE (CLAUDE.md §8): `function` binding (02 §3.5) is the only
// binding type actually in Wave 0 scope (all six write tools). The REST /
// database / plsql entries below are forward declarations for Wave 1 and
// Wave 2 — there is no adapter code today to wire them into. Flagged, not
// silently degraded: see this task's final report.

import { ERROR_TAXONOMY, type ErrorCode } from '@mcpforge/shared';

/** The five binding types 02 §2-§3 defines. `vendor` = wrapped MCP server (Mode B). */
export type BindingLayerType = 'rest' | 'database' | 'plsql' | 'function' | 'vendor';

export interface BindingErrorMappingEntry {
  readonly bindingType: BindingLayerType;
  /** A short machine-stable id for this condition, unique within its binding type. */
  readonly conditionId: string;
  readonly code: ErrorCode;
  /** The concrete, worked condition text — 02's own docs for that binding type. */
  readonly condition: string;
  /** The concrete, worked `next` — agent-actionable, never "try again" (non-negotiable #5). */
  readonly next: string;
  readonly retryable: boolean;
  /** The 02 section this condition is drawn from, for the reviewer who wants the source. */
  readonly source: string;
}

/**
 * The binding-layer mapping. One entry per distinct failure condition named in
 * 02 §3.2-§3.6. `function` entries are real Wave-0 targets for
 * `adapters/**`/`generated/tools/**` handler bodies once they exist; the
 * others are Wave-1/2 forward declarations (see file header).
 */
export const BINDING_ERROR_MAP: readonly BindingErrorMappingEntry[] = [
  // --- function / orchestration (02 §3.5) — Wave 0's ONLY binding type ------
  {
    bindingType: 'function',
    conditionId: 'function.identity.unresolved',
    code: 'IDENTITY_UNRESOLVED',
    condition:
      'The probe reports identity.carries: unverified (probe binding missing or erroring), or reports no — a shared service account came back — for a write orchestration, which the gateway auto-disables per onServiceAccount: block. There is no fallback identity for a write.',
    next: 'This orchestration cannot resolve your identity on the target and there is no fallback. Ask the owning team named in the probe report to configure SSO/token-provider identity carriage (02 §3.5), then re-run forge probe.',
    retryable: false,
    source: '02 §3.5 — identity carriage table + probe classification',
  },
  {
    bindingType: 'function',
    conditionId: 'function.identity.echo-mismatch',
    code: 'TARGET_ERROR',
    condition:
      "binding.identity.echoOn returned an executing user that does not match the caller's identity on a write call — the SSO/token-provider configuration has drifted since the last probe.",
    next: 'Do not retry this call. Report the correlationId to the MCPForge operator and the JDE/Siebel/Essbase CNC team named on the probe report — the target instance is executing under the wrong identity.',
    retryable: false,
    source: '02 §3.5 — binding.identity.echoOn runtime check',
  },
  {
    bindingType: 'function',
    conditionId: 'function.orchestration.precondition-failed',
    code: 'TARGET_PRECONDITION_FAILED',
    condition:
      'The X_VALIDATE (or the branched-out validation half of X_EXECUTE) returned a business-validation failure — the object does not satisfy a precondition the orchestration checks.',
    next: 'Read the named object with its .get or .get_status tool to confirm the stated condition, then either satisfy it or call a tool whose preconditions this object meets.',
    retryable: false,
    source: '02 §3.5 — the X_EXECUTE / X_VALIDATE pair',
  },
  {
    bindingType: 'function',
    conditionId: 'function.orchestration.timeout',
    code: 'TARGET_TIMEOUT',
    condition:
      'The AIS/business-service call exceeded binding.execution.timeoutMs. Outcome is UNKNOWN — a write orchestration may have executed on the target.',
    next: "Do NOT re-issue a write blindly. Use the tool's .get or .get_status counterpart to determine whether the operation completed, then act on that answer.",
    retryable: false,
    source: '02 §3.1.5 general TARGET_TIMEOUT rule, applied to §3.5 orchestration',
  },
  {
    bindingType: 'function',
    conditionId: 'function.orchestration.server-unavailable',
    code: 'TARGET_UNAVAILABLE',
    condition:
      'The AIS server / business-service endpoint / Essbase session refused the connection or is unreachable.',
    next: 'Retry once after the stated interval; if it persists, tell the human the named target system is down and report the correlationId to its owning team.',
    retryable: true,
    source: '02 §3.5 — "AIS servers are easy to overwhelm"',
  },
  {
    bindingType: 'function',
    conditionId: 'function.orchestration.concurrency-limited',
    code: 'RATE_LIMITED',
    condition: 'binding.execution.maxConcurrency for this orchestration was exceeded.',
    next: 'Wait briefly and call again; if this workload genuinely needs higher concurrency, ask the module steward to raise maxConcurrency for this orchestration.',
    retryable: true,
    source: '02 §3.5 — per-orchestration concurrency limit',
  },
  {
    bindingType: 'function',
    conditionId: 'function.orchestration.application-error',
    code: 'TARGET_ERROR',
    condition: 'The orchestration returned an application-level error structure (non-zero status, an error message stack).',
    next: 'Report the correlationId to the named owning team; if the message names a field, correct it and call again. Do not repeat the identical call.',
    retryable: false,
    source: '02 §3.1.5 general TARGET_ERROR rule',
  },

  // --- REST / OAuth (02 §3.2) — Wave 1 forward declaration -------------------
  {
    bindingType: 'rest',
    conditionId: 'rest.identity.token-exchange-failed',
    code: 'IDENTITY_UNRESOLVED',
    condition:
      "OAuth 2.1 token exchange (RFC 8693) for the caller's subject at the target authorization server failed or returned no per-user token, and the manifest may not fall back to a shared token.",
    next: "Ask your MCPForge operator to check this deployment's OAuth trusted-client registration and the caller's UPN mapping; this call cannot proceed without a per-user token.",
    retryable: false,
    source: '02 §3.2 — auth/identity, "prohibited, structurally: a shared service-account token"',
  },
  {
    bindingType: 'rest',
    conditionId: 'rest.response.error-status',
    code: 'TARGET_ERROR',
    condition: 'The target returned a 4xx/5xx HTTP status outside the tool\'s declared success set.',
    next: 'Report the correlationId to the named owning team; if the message names a field, correct it and call again. Do not repeat the identical call.',
    retryable: false,
    source: '02 §3.2 — audit shape (HTTP method, response status)',
  },
  {
    bindingType: 'rest',
    conditionId: 'rest.response.size-cap-exceeded',
    code: 'ROW_CAP_EXCEEDED',
    condition: 'The response exceeded binding.execution.responseBytesMax.',
    next: 'Narrow the query with additional filter arguments and call again; the cap is enforced at the gateway and cannot be raised per call.',
    retryable: false,
    source: '02 §3.2 — sandboxing, response size cap',
  },
  {
    bindingType: 'rest',
    conditionId: 'rest.connection.timeout-or-unreachable',
    code: 'TARGET_UNAVAILABLE',
    condition: 'The connect or read timeout elapsed, or the allowlisted host refused the connection.',
    next: 'Retry once after the stated interval; if it persists, tell the human the named target system is down and report the correlationId to its owning team.',
    retryable: true,
    source: '02 §3.2 — sandboxing, connect + read timeouts',
  },

  // --- Database / SQL (02 §3.3) — Wave 1 forward declaration -----------------
  {
    bindingType: 'database',
    conditionId: 'database.identity.mapping-missing',
    code: 'IDENTITY_UNRESOLVED',
    condition:
      "No caller-to-database-identity mapping exists in overlays/<deployment>/mappings/db-identity.yaml for this subject. There is no service-account fallback.",
    next: 'Ask your MCPForge operator to add your database-identity mapping (forge identity remap) for this target; this call cannot proceed without one.',
    retryable: false,
    source: '02 §3.3 — "a missing mapping is a hard failure. There is no service-account fallback"',
  },
  {
    bindingType: 'database',
    conditionId: 'database.rowcap.exceeded',
    code: 'ROW_CAP_EXCEEDED',
    condition: 'The mandatory FETCH FIRST :__rowcap ROWS ONLY cap (or the worker\'s independent second cap) was hit.',
    next: 'Narrow the query with additional filter arguments (date range, company, status) and call again; the cap is enforced twice and cannot be raised per call.',
    retryable: false,
    source: '02 §3.3 — "exceeding it is ROW_CAP_EXCEEDED with a next that names the narrowing parameter"',
  },
  {
    bindingType: 'database',
    conditionId: 'database.resource-manager.limit-exceeded',
    code: 'TARGET_TIMEOUT',
    condition: 'The Oracle Resource Manager consumer group CPU/elapsed-time cap for the MCPForge user was hit.',
    next: 'Narrow the query (add filters, a date range) and call again; if this workload legitimately needs more time, ask the DBA to review the MCPForge consumer group\'s cap.',
    retryable: false,
    source: '02 §3.3 — Resource Manager consumer group cap',
  },
  {
    bindingType: 'database',
    conditionId: 'database.statement.error',
    code: 'TARGET_ERROR',
    condition: 'The bound statement (loaded by hash, never concatenated) returned an Oracle error.',
    next: 'Report the correlationId to the named owning team; if the message names a field, correct it and call again. Do not repeat the identical call.',
    retryable: false,
    source: '02 §3.3 — audit shape (statement id + hash)',
  },

  // --- PL/SQL package (02 §3.4) — Wave 2 forward declaration -----------------
  {
    bindingType: 'plsql',
    conditionId: 'plsql.identity.mapping-missing',
    code: 'IDENTITY_UNRESOLVED',
    condition:
      "No (LTM identity) -> (EBS FND user id, responsibility, org) mapping exists in overlays/<deployment>/mappings/ebs-identity.yaml, or the mapping is ambiguous. There is no service-account fallback and no default responsibility.",
    next: 'Ask your MCPForge operator to add or disambiguate your EBS identity mapping (forge identity remap) for this target; this call cannot proceed without one.',
    retryable: false,
    source: '02 §3.4 — "a missing or ambiguous mapping is a hard failure with IDENTITY_UNRESOLVED"',
  },
  {
    bindingType: 'plsql',
    conditionId: 'plsql.commit-behaviour.unknown',
    code: 'TOOL_DISABLED',
    condition: 'binding.commitsInternally is unknown — the capability probe has not yet classified whether the wrapped API commits internally.',
    next: 'Ask the module steward to run forge probe against this binding so PROBE_COMMIT_BEHAVIOUR can classify it; this write tool cannot be enabled until it does. Do not retry it until then.',
    retryable: false,
    source: '02 §3.4 — "unknown -> the tool cannot be enabled for write at all"',
  },
  {
    bindingType: 'plsql',
    conditionId: 'plsql.wrapper.validation-failed',
    code: 'TARGET_PRECONDITION_FAILED',
    condition: "The wrapper's validate-only form (p_validate_only or the sibling _VALIDATE procedure) returned a non-success x_return_status.",
    next: 'Read the named object with its .get or .get_status tool to confirm the stated condition, then either satisfy it or call a tool whose preconditions this object meets.',
    retryable: false,
    source: '02 §3.4 — the validate-only convention',
  },
  {
    bindingType: 'plsql',
    conditionId: 'plsql.wrapper.application-error',
    code: 'TARGET_ERROR',
    condition: 'The wrapper package raised an unhandled exception, or the wrapped APPS API returned an application error.',
    next: 'Report the correlationId to the named owning team; if the message names a field, correct it and call again. Do not repeat the identical call.',
    retryable: false,
    source: '02 §3.4 — audit shape, MCPFORGE_WRAP.CALL_LOG',
  },
] as const;

/**
 * Cross-check helper: every mapping entry's `code` must exist in the closed
 * taxonomy and its `next`/`condition` must match that code's own contract
 * (non-empty, agent-actionable). Called by mapping.test.ts and by the
 * repo-wide enumeration test so both suites exercise the SAME assertion, not
 * two independently-drifting ones.
 */
export function assertMappingEntryIsWellFormed(entry: BindingErrorMappingEntry): void {
  const spec = ERROR_TAXONOMY[entry.code];
  if (spec === undefined) {
    throw new Error(`${entry.bindingType}.${entry.conditionId} maps to unknown code ${entry.code}`);
  }
  if (entry.next.trim().length === 0) {
    throw new Error(`${entry.bindingType}.${entry.conditionId} carries an empty next — dead end`);
  }
  if (entry.condition.trim().length === 0) {
    throw new Error(`${entry.bindingType}.${entry.conditionId} carries an empty condition`);
  }
  if (typeof entry.retryable !== 'boolean') {
    throw new Error(`${entry.bindingType}.${entry.conditionId} retryable must be boolean`);
  }
}

/** Look up every mapping entry declared for one binding type. */
export function mappingFor(bindingType: BindingLayerType): readonly BindingErrorMappingEntry[] {
  return BINDING_ERROR_MAP.filter((e) => e.bindingType === bindingType);
}
