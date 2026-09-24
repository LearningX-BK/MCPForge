// MCPForge — W0-J16: Activity view types (03 §5.3 "Activity", 02 §4.6).
//
// Judgment call, in the same spirit as `write-path/types.ts`'s header: no
// live gateway/API client exists in the portal at Wave 0, so these are
// presentational view shapes, prop- and fixture-driven, that mirror the real
// `AuditCallRecord` (`core/gateway/store/audit/types.ts`) field-for-field
// where a field is rendered directly. The one addition beyond a straight
// mirror is `ActivityArgEntryView.redacted`/`hash`: `AuditCallRecord.argsRedacted`
// is `unknown` — per `core/gateway/policy/idempotency/dispatch.ts`'s own
// comment, a redacted field's value IS ALREADY the `sha256(value)[:12]`
// string in the stored JSON, with no separate marker distinguishing "this
// field was redacted" from "this field's real value happens to be a
// 12-character hex string". That is a real gap in the stored shape, not
// something this task's `touches:` (`core/portal/src/app/activity/**`) may
// fix — it lives in `core/gateway/store/audit/**`, which this task does not
// touch. So the view layer carries the flag explicitly, exactly as
// `GuardrailResultView` widens its gateway mirror with `valueChecked`: when
// the real column gains a per-field redaction marker, only the adapter that
// builds this view from `AuditCallRecord` changes, not any component here.
import type {
  AuditChainVerification,
  AuditChainStatus,
  AuditCredentialRef,
  AuditOutcome,
  AuditPhase,
  AuditResultKey,
  CompensatingControl,
} from '@mcpforge/gateway/store';

export type { AuditChainVerification, AuditChainStatus };
export type { AuditOutcome, AuditPhase, AuditResultKey, AuditCredentialRef, CompensatingControl };

/** One row in the Calls table. Field names mirror `AuditCallRecord` exactly. */
export interface ActivityCallSummary {
  readonly id: string;
  readonly ts: string;
  readonly callerSubject: string;
  readonly callerDisplay?: string | undefined;
  readonly toolId: string;
  readonly verb?: string | undefined;
  readonly isWrite: boolean;
  readonly phase: AuditPhase;
  readonly outcome: AuditOutcome;
  readonly targetEnv?: string | undefined;
  readonly latencyMsTotal?: number | undefined;
  readonly resultKeys: readonly AuditResultKey[];
  /** Set only on a `phase: 'execute'` row that has since been reversed. */
  readonly reversedByCallId?: string | undefined;
  /** Set only on a `phase: 'reverse'` row. */
  readonly reversesCallId?: string | undefined;
  readonly deploymentId: string;
}

/** One argument entry as call detail renders it — see the file header. */
export interface ActivityArgEntryView {
  readonly field: string;
  /** `true` when this field's stored value is a redaction hash, not the real value. */
  readonly redacted: boolean;
  /** Rendered real value. Absent when `redacted`. */
  readonly value?: string | undefined;
  /** The `sha256(value)[:12]` hash. Present only when `redacted`. */
  readonly hash?: string | undefined;
}

export interface ActivityApprovalRefView {
  readonly approvalId: string;
  readonly href?: string | undefined;
  readonly state: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly decidedBy?: string | undefined;
}

/** The full record, as call detail renders it. Mirrors `AuditCallRecord`. */
export interface ActivityCallDetail extends ActivityCallSummary {
  readonly correlationId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly consumerId: string;
  readonly humanInTheLoop: boolean;
  readonly toolVersion?: string | undefined;
  readonly serverId?: string | undefined;
  readonly bindingType?: string | undefined;
  readonly sensitivityClass?: string | undefined;
  readonly targetSystem?: string | undefined;
  readonly targetObject?: string | undefined;

  /** The plan text AS SHOWN — rendered verbatim, never re-derived. */
  readonly planAsShown?: string | undefined;

  readonly confirmTokenHash?: string | undefined;
  readonly planHash?: string | undefined;
  readonly argsHash?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly replayed?: boolean | undefined;

  readonly args: readonly ActivityArgEntryView[];

  readonly errorCode?: string | undefined;
  readonly errorMessageAgent?: string | undefined;
  readonly deniedByRule?: string | undefined;

  // -- identity honesty (identity_carrying, target_identity_observed,
  // identity_match, compensating_control — 02 §4.6, reused from IdentityBlock
  // via the ProbeIdentityView shape).
  readonly identityCarrying?: boolean | undefined;
  readonly targetIdentityObserved?: string | null | undefined;
  readonly identityMatch?: boolean | undefined;
  readonly compensatingControl?: CompensatingControl | undefined;
  /** The probe report this honesty block is sourced from. Empty => nothing asserted. */
  readonly identityProbeRef?: string | undefined;
  readonly identityProbedAt?: string | undefined;
  readonly identityBindingType?: string | undefined;

  readonly approval?: ActivityApprovalRefView | undefined;

  readonly reversalClass?: string | undefined;
  readonly reversalToolId?: string | undefined;

  // -- hash-chain position
  readonly prevHash: string;
  readonly rowHash: string;
  /** 0-based position in the deployment's chain, oldest first, when known. */
  readonly chainPosition?: number | undefined;

  readonly credentialRefs: readonly AuditCredentialRef[];
}
