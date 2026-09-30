// MCPForge — W0-P3b: `/api/v1` responses -> the Activity view shapes.
//
// The view types mirror `AuditCallRecord` with optional fields; the wire
// contract carries explicit nulls. This file is the only place that converts
// between them, so a component never branches on "fixture or live".

import type { CallDetail, CallSummary, ChainVerification } from '@mcpforge/shared/api/v1';

import type {
  ActivityArgEntryView,
  ActivityCallDetail,
  ActivityCallSummary,
  IntegrityView,
} from './types';

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export function toCallSummaryView(c: CallSummary): ActivityCallSummary {
  return {
    id: c.id,
    ts: c.ts,
    callerSubject: c.callerSubject,
    callerDisplay: opt(c.callerDisplay),
    toolId: c.toolId,
    verb: opt(c.verb),
    isWrite: c.isWrite,
    phase: c.phase,
    outcome: c.outcome,
    targetEnv: opt(c.targetEnv),
    latencyMsTotal: opt(c.latencyMsTotal),
    resultKeys: c.resultKeys,
    reversedByCallId: opt(c.reversedByCallId),
    reversesCallId: opt(c.reversesCallId),
    deploymentId: c.deploymentId,
  };
}

export function toIntegrityView(v: ChainVerification): IntegrityView {
  return {
    deploymentId: v.deploymentId,
    status: v.status,
    rowsChecked: v.rowsChecked,
    origin:
      v.origin === null
        ? null
        : {
            kind: v.origin.kind,
            firstRowId: v.origin.firstRowId,
            attestation:
              v.origin.attestationCallId === null
                ? undefined
                : { callId: v.origin.attestationCallId },
          },
    firstBreak:
      v.firstBreak === null
        ? null
        : {
            rowId: v.firstBreak.rowId,
            reason: v.firstBreak.reason,
            message: v.firstBreak.message,
            next: v.firstBreak.next,
          },
  };
}

/**
 * `argsRedacted` is stored with each redacted field's value ALREADY replaced
 * by its `sha256(value)[:12]` (W0-P17), with no separate marker. A 12-hex
 * string is therefore shown as a hash, never as a value: the safe reading.
 */
const REDACTION_HASH = /^[0-9a-f]{12}$/;

export function toArgEntries(argsRedacted: unknown): ActivityArgEntryView[] {
  if (argsRedacted === null || typeof argsRedacted !== 'object' || Array.isArray(argsRedacted)) {
    return [];
  }
  return Object.entries(argsRedacted as Record<string, unknown>).map(([field, value]) =>
    typeof value === 'string' && REDACTION_HASH.test(value)
      ? { field, redacted: true, hash: value }
      : {
          field,
          redacted: false,
          value: typeof value === 'string' ? value : JSON.stringify(value),
        },
  );
}

export function toCallDetailView(c: CallDetail): ActivityCallDetail {
  return {
    ...toCallSummaryView(c),
    correlationId: opt(c.correlationId),
    sessionId: opt(c.sessionId),
    consumerId: c.consumerId,
    humanInTheLoop: c.humanInTheLoop,
    toolVersion: opt(c.toolVersion),
    serverId: opt(c.serverId),
    bindingType: opt(c.bindingType),
    sensitivityClass: opt(c.sensitivityClass),
    targetSystem: opt(c.targetSystem),
    targetObject: opt(c.targetObject),
    // The audit row stores the plan's hash, not its text. The text the
    // approver saw lives on the approval request; nothing is re-derived.
    planAsShown: undefined,
    confirmTokenHash: opt(c.confirmTokenHash),
    planHash: opt(c.planHash),
    argsHash: opt(c.argsHash),
    idempotencyKey: opt(c.idempotencyKey),
    replayed: opt(c.replayed),
    args: toArgEntries(c.argsRedacted),
    errorCode: opt(c.errorCode),
    errorMessageAgent: opt(c.errorMessageAgent),
    deniedByRule: opt(c.deniedByRule),
    identityCarrying: opt(c.identityCarrying),
    targetIdentityObserved: c.targetIdentityObserved,
    identityMatch: opt(c.identityMatch),
    compensatingControl: opt(c.compensatingControl),
    identityProbeRef: undefined,
    identityProbedAt: undefined,
    identityBindingType: opt(c.bindingType),
    approval:
      c.approval === null
        ? undefined
        : {
            approvalId: c.approval.approvalId,
            href: `/approvals/${encodeURIComponent(c.approval.approvalId)}`,
            state: c.approval.status,
            decidedBy: opt(c.approval.approverSubject),
            ...(c.approval.selfApproved ? { selfApproved: true } : {}),
          },
    reversalClass: opt(c.reversalClass),
    reversalToolId: opt(c.reversalToolId),
    replayOf: opt(c.replayOf),
    prevHash: c.prevHash,
    rowHash: c.rowHash,
    chainPosition: undefined,
    credentialRefs: c.credentialRefs.map((r) => ({ secretRef: r.secretRef, version: r.version })),
  };
}
