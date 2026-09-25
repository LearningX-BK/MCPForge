// MCPForge — the ONE place an `audit_call` row's common columns are assembled.
// W0-P17, 02 §4.6 as extended by §11.3.
//
// Three writers append rows through the store's single audit repository: the
// write dispatcher (./dispatch.ts, inside its execute transaction), the read
// dispatcher (./read.ts) and the decision recorder (./record.ts, for plans,
// refusals and replays). They differ in phase, outcome and a handful of
// phase-specific columns. They must NOT differ in who, which consumer, which
// tool or which deployment a row names, so those columns are built here and
// nowhere else. "Never a second audit writer" (TASKS.md W0-P17) is read as:
// one repository, one row shape, one redaction rule.

import { createHash } from 'node:crypto';
import type {
  AppendAuditCallInput,
  AuditOutcome,
  AuditPhase,
  AuditResultKey,
} from '../../store/audit/types.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';

/**
 * 02 §4.6 redaction, as the owner decided for Wave 0 (25 Sep 2026, W0-P17):
 * a `personal` tool's argument values are ALL replaced by `sha256(value)[:12]`,
 * so equality can still be reasoned about without exposing the value; every
 * other sensitivity class records arguments verbatim. Per-input `redact: true`
 * has no manifest field yet, and when it lands it joins this function.
 *
 * Applied to what the AUDIT ROW records only. The result returned to the
 * agent is not altered: the caller is entitled to what scope admitted.
 */
export const REDACTED_SENSITIVITIES: ReadonlySet<string> = new Set(['personal']);

export function redactedValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256')
    .update(text ?? 'null', 'utf8')
    .digest('hex')
    .slice(0, 12);
}

export function redactArgsForAudit(
  args: Readonly<Record<string, unknown>>,
  sensitivity: string | undefined,
): Readonly<Record<string, unknown>> {
  if (sensitivity === undefined || !REDACTED_SENSITIVITIES.has(sensitivity)) return args;
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, redactedValue(v)]));
}

/** The token never lands in the trail; a hash of it does. */
export function confirmTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AuditRowInput {
  readonly call: PolicyCall;
  /** Absent when the tool id resolved to no catalogue entry (a 6a refusal). */
  readonly entry: PolicyCatalogueEntry | undefined;
  readonly ctx: PolicyContext;
  readonly phase: AuditPhase;
  readonly outcome: AuditOutcome;
  /** The business arguments (the confirm token already stripped). */
  readonly businessArgs: Readonly<Record<string, unknown>>;
  readonly ts: string;
  readonly resultKeys?: readonly AuditResultKey[];
  readonly gatewayVersion?: string;
}

/** The columns every row carries, whichever writer appends it. */
export function auditRowBase(input: AuditRowInput): AppendAuditCallInput {
  const { call, entry, ctx } = input;
  const session = ctx.scope.session;
  const principal = session.principal;
  const sensitivity = entry?.sensitivity;
  return {
    ts: input.ts,
    correlationId: call.correlationId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    // W0-N10, 02 §11.3 — the provenance `[2a]` froze for THIS session.
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId: call.toolId,
    ...(entry === undefined
      ? {}
      : {
          toolVersion: entry.toolVersion,
          serverId: entry.serverId,
          bindingType: entry.bindingType,
          sensitivityClass: entry.sensitivity,
          targetObject: entry.bindingRef,
        }),
    isWrite: entry?.write === true,

    deploymentId: ctx.scope.deployment.deploymentId,
    ...(input.gatewayVersion === undefined ? {} : { gatewayVersion: input.gatewayVersion }),

    phase: input.phase,
    argsRedacted: redactArgsForAudit(input.businessArgs, sensitivity),
    resultKeys: input.resultKeys ?? [],
    outcome: input.outcome,
  };
}
