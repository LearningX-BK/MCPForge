// MCPForge — `POST /api/v1/approvals/{id}/decision`: a human decides a runtime
// approval request. W0-P25.
//
// THE ONE WRITE UNDER `/api/v1`. W0-P2 §7 made the prefix read-only and said a
// write endpoint would need a fresh decision. The owner took it on 30 Sep 2026
// (option (a) of W0-P25), together with two rules the spec had left open:
//
//  1. WHO MAY DECIDE. Anyone other than the requester whose OWN authority
//     includes the tool: the read authority (Deployed ∩ Granted ∩
//     ConsumerAuthorized, `scope/resolve.ts`), i.e. their roles intersected
//     with this consumer's authorizations, AND a consumer whose registration
//     allows writes. Nobody decides for a tool outside their own grants.
//  2. EVIDENCE. Every decision, and every refused attempt, appends one
//     hash-chained `approve` audit row, in the same transaction as the
//     decision itself. A decision the trail does not record cannot commit.
//
// WHAT THIS MODULE DOES NOT DO, deliberately:
//
//  - It never touches the approval repository's `decide`. It calls the
//    approval gate's `decide()` (`policy/approval/gate.ts`), which owns
//    self-approval, expiry and the SQL-guarded transition. The gate is the
//    SAME instance stage 6g raises through (`launch.ts`).
//  - It never returns the confirm token. The gate mints one on approval and
//    binds it to the REQUESTER (`policy/approval/mint.ts`); the requester's
//    agent collects it with `forge.approval.status`. Here it is hashed into the
//    audit row, which links this decision to the execute that spends it, and
//    then dropped (03 §7.4: the approver never executes).
//  - It never reads the approver from the request body. The approver is the
//    signed-in human, and only that.
//
// Refusals follow the read API's rule: an approval the actor may not read is
// a 404, identical to one that does not exist, and the audit row for that
// attempt names a pseudo tool id rather than the real one, because the row is
// the actor's own and they may read it back.

import { API_V1_PREFIX, approvalDecisionRequestSchema } from '@mcpforge/shared/api/v1';
import type { ApprovalDecisionResponse, RuntimeApproval } from '@mcpforge/shared/api/v1';
import type { EstablishedSession } from '../../assembly/session.js';
import type { RuntimeCatalogue } from '../../assembly/catalogue.js';
import type { ApprovalGate, DecisionOutcome } from '../../policy/approval/index.js';
import { confirmTokenHash } from '../../policy/idempotency/audit-row.js';
import type { AppendAuditCallInput } from '../../store/audit/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import type { ApprovalRequest } from '../../store/runtime/types.js';
import { verifiedPlanBody } from './plan-body.js';
import { ApiRefusal } from './refusal.js';

/**
 * The tool id an `approve` audit row names when the actor may not learn the
 * real one: the approval does not exist, lies outside their authority, or was
 * never looked up because their consumer may not write.
 */
export const DECISION_PSEUDO_TOOL_ID = 'forge.approval.decide';

/** The request body is a verdict and an optional reason, nothing more. */
export const DECISION_BODY_MAX_BYTES = 16 * 1024;

const DECISION_PATH = new RegExp(`^${API_V1_PREFIX}/approvals/([^/]+)/decision$`);

/** The approval id when `pathname` is the decision path, otherwise `undefined`. */
export function decisionPathApprovalId(pathname: string): string | undefined {
  const match = DECISION_PATH.exec(pathname);
  if (match === null || match[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** Who is deciding: the front door's result, as the read API holds it. */
export interface DecisionActor {
  readonly session: EstablishedSession;
  readonly subject: string;
  /** The actor's read authority: Deployed ∩ Granted ∩ ConsumerAuthorized. */
  readonly visible: ReadonlySet<string>;
  readonly correlationId: string;
}

export interface ApprovalDecisionDeps {
  readonly store: Pick<RuntimeStore, 'approvals' | 'audit' | 'transaction'>;
  readonly catalogue: Pick<RuntimeCatalogue, 'entryFor'>;
  /** The gateway's ONE approval gate, shared with stage 6g. */
  readonly gate: ApprovalGate;
  readonly gatewayVersion: string;
  readonly now: () => Date;
}

/** The audit rule each refused attempt is recorded under. */
type DeniedRule =
  | 'approval.consumer_write_not_allowed'
  | 'approval.not_approver'
  | 'approval.self_approval'
  | 'approval.not_pending'
  | 'approval.expired'
  | 'approval.plan_body_mismatch'
  | 'approval.internal';

interface Attempt {
  readonly approvalId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | undefined;
}

/**
 * Decide one approval as `actor`. Resolves with the decided approval, or
 * throws an `ApiRefusal`. Either way, when an attempt got past input
 * validation, exactly one `approve` audit row has been committed.
 */
export async function decideApproval(
  deps: ApprovalDecisionDeps,
  actor: DecisionActor,
  approvalId: string,
  rawBody: unknown,
): Promise<ApprovalDecisionResponse> {
  const parsed = approvalDecisionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    // Nothing was attempted, so nothing is audited: the body never named a
    // verdict the gate could act on.
    throw new ApiRefusal(
      'INPUT_INVALID',
      `The decision body is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}.`,
      'Send {"decision":"approved"} or {"decision":"rejected","reason":"<why>"}; a decline needs a reason, because it is returned to the requester. Do not send an approver: it is always you.',
    );
  }
  const attempt: Attempt = {
    approvalId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
  };

  // 1. The consumer half of the intersection: a consumer whose registration
  //    does not allow writes may not record a decision for anyone.
  const consumer = actor.session.scopeSession.consumer;
  if (!consumer.authorizations.writeAllowed) {
    await deps.store.transaction(() =>
      deps.store.audit.append(
        refusedRow(
          deps,
          actor,
          attempt,
          undefined,
          'approval.consumer_write_not_allowed',
          'CONSUMER_NOT_AUTHORIZED',
          'The consumer is not authorized to write.',
        ),
      ),
    );
    throw new ApiRefusal(
      'CONSUMER_NOT_AUTHORIZED',
      `Consumer ${consumer.consumerId} is not authorized to write, and deciding an approval is a write.`,
      'Decide this approval in the MCPForge portal, whose registration allows writes. A consumer registration is widened only through a reviewed change proposal.',
    );
  }

  // 2. The human half: the approval must be one the actor may read, which for
  //    anyone but the requester means the tool is in their own authority.
  //    The requester passes this line only to be refused by the gate below,
  //    which is the one place self-approval is decided.
  const current = await deps.store.approvals.get(approvalId);
  const readable =
    current !== undefined &&
    (actor.visible.has(current.toolId) || current.callerSubject === actor.subject);
  if (current === undefined || !readable) {
    await deps.store.transaction(() =>
      deps.store.audit.append(
        refusedRow(
          deps,
          actor,
          attempt,
          undefined,
          'approval.not_approver',
          'NOT_FOUND',
          'No approval the actor may decide.',
        ),
      ),
    );
    throw new ApiRefusal(
      'NOT_FOUND',
      `No approval ${approvalId} that you may decide.`,
      `Open the queue at ${API_V1_PREFIX}/approvals to see the requests you may decide. You may decide only requests for tools within your own roles and this consumer's authorizations; ask an approver who holds that scope.`,
    );
  }

  // 3. W0-P3f: nobody decides on a stored plan that is not the plan being
  //    approved. A body that fails its hash has been altered in the store;
  //    deciding on it would approve something the approver never saw.
  if (verifiedPlanBody(current).status === 'mismatch') {
    await deps.store.transaction(() =>
      deps.store.audit.append(
        refusedRow(
          deps,
          actor,
          attempt,
          current,
          'approval.plan_body_mismatch',
          'APPROVAL_REQUIRED',
          'The stored plan body does not hash to the approved planHash.',
        ),
      ),
    );
    throw new ApiRefusal(
      'APPROVAL_REQUIRED',
      `Approval ${approvalId} cannot be decided: its stored plan does not match the plan hash it was raised with, so what would be shown to you is not what would be approved.`,
      'Do not decide it. Report the approval id to the MCPForge operator so the runtime store can be inspected (forge audit verify), and ask the requester to plan the change again, which raises a fresh request.',
    );
  }

  // 4. The gate decides, and the audit row commits with it or not at all.
  const { outcome, row } = await deps.store.transaction(async () => {
    const decided = await deps.gate.decide({
      approvalId,
      approverSubject: actor.subject,
      decision: attempt.decision,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    });
    const written = await deps.store.audit.append(rowFor(deps, actor, attempt, current, decided));
    return { outcome: decided, row: written };
  });

  switch (outcome.kind) {
    case 'approved':
      return {
        asOf: deps.now().toISOString(),
        approval: toApproval(outcome.request),
        auditCallId: row.id,
        next: `Approved. ${outcome.request.callerSubject} raised this request and executes it: their agent collects the confirm token with forge.approval.status and calls ${outcome.request.toolId} again with the identical arguments. You do not execute it, and the token is valid only for them until ${outcome.expiresAt}.`,
      };
    case 'rejected':
      return {
        asOf: deps.now().toISOString(),
        approval: toApproval(outcome.request),
        auditCallId: row.id,
        next: `Declined. The requester's agent is told your reason and told not to repeat the call with these arguments; nothing was executed. No further action is needed from you.`,
      };
    case 'expired':
      throw new ApiRefusal(
        'PLAN_EXPIRED',
        `Approval ${approvalId} expired at ${outcome.request.expiresAt} before it was decided, so it can no longer be approved or declined.`,
        'Nothing was executed and nothing needs undoing. If the change is still wanted, the requester must plan it again, which raises a fresh request; decide that one before it expires.',
      );
    case 'refuse':
    default:
      throw new ApiRefusal(outcome.code, outcome.message, outcome.next);
  }
}

// --- audit rows ------------------------------------------------------------------

function rowFor(
  deps: ApprovalDecisionDeps,
  actor: DecisionActor,
  attempt: Attempt,
  approval: ApprovalRequest,
  outcome: DecisionOutcome,
): AppendAuditCallInput {
  switch (outcome.kind) {
    case 'approved':
      return {
        ...baseRow(deps, actor, attempt, outcome.request),
        outcome: 'ok',
        // The requester's token, hashed: the same hash the execute row that
        // spends it will carry. The token itself is never written.
        confirmTokenHash: confirmTokenHash(outcome.confirmToken),
      };
    case 'rejected':
      return { ...baseRow(deps, actor, attempt, outcome.request), outcome: 'ok' };
    case 'expired':
      return refusedRow(
        deps,
        actor,
        attempt,
        approval,
        'approval.expired',
        'PLAN_EXPIRED',
        `Approval expired at ${approval.expiresAt}.`,
      );
    case 'refuse':
    default:
      return refusedRow(
        deps,
        actor,
        attempt,
        approval,
        outcome.code === 'POLICY_GUARDRAIL_BREACH'
          ? 'approval.self_approval'
          : outcome.code === 'APPROVAL_REQUIRED'
            ? 'approval.not_pending'
            : 'approval.internal',
        outcome.code,
        outcome.message,
      );
  }
}

function refusedRow(
  deps: ApprovalDecisionDeps,
  actor: DecisionActor,
  attempt: Attempt,
  approval: ApprovalRequest | undefined,
  rule: DeniedRule,
  errorCode: string,
  message: string,
): AppendAuditCallInput {
  return {
    ...baseRow(deps, actor, attempt, approval),
    outcome: 'policy_denied',
    errorCode,
    errorMessageAgent: message,
    deniedByRule: rule,
  };
}

/**
 * The columns every `approve` row carries: the same who / which consumer /
 * which deployment columns as `policy/idempotency/audit-row.ts` builds for the
 * chain's rows, so an approval reads like any other act in the trail.
 * `approval` is `undefined` exactly when the actor may not learn which tool
 * the request was for.
 */
function baseRow(
  deps: ApprovalDecisionDeps,
  actor: DecisionActor,
  attempt: Attempt,
  approval: ApprovalRequest | undefined,
): Omit<AppendAuditCallInput, 'outcome'> {
  const at = deps.now();
  const scope = actor.session.scopeAt(at);
  const session = actor.session.scopeSession;
  const principal = actor.session.principal;
  const entry = approval === undefined ? undefined : deps.catalogue.entryFor(approval.toolId);
  return {
    ts: at.toISOString(),
    correlationId: actor.correlationId,
    sessionId: actor.session.sessionId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId: approval?.toolId ?? DECISION_PSEUDO_TOOL_ID,
    ...(approval?.toolVersion == null ? {} : { toolVersion: approval.toolVersion }),
    ...(entry === undefined
      ? {}
      : {
          serverId: entry.serverId,
          bindingType: entry.bindingType,
          sensitivityClass: entry.sensitivity,
          targetObject: entry.bindingRef,
        }),
    // Deciding changes no target system. The write it unlocks is audited when
    // the requester executes it.
    isWrite: false,

    deploymentId: scope.deployment.deploymentId,
    gatewayVersion: deps.gatewayVersion,

    phase: 'approve',
    ...(approval === undefined
      ? {}
      : { planHash: approval.planHash, argsHash: approval.argsCanonicalHash }),
    argsRedacted: {
      approvalId: attempt.approvalId,
      decision: attempt.decision,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    },
    // Indexed, so "every attempt on apr_…" is one lookup (02 §4.6 query 2).
    resultKeys: [{ keyName: 'approvalId', keyValue: attempt.approvalId }],
  };
}

function toApproval(a: ApprovalRequest): RuntimeApproval {
  return {
    id: a.id,
    planHash: a.planHash,
    argsCanonicalHash: a.argsCanonicalHash,
    planSummary: a.planSummary,
    callerSubject: a.callerSubject,
    consumerId: a.consumerId,
    toolId: a.toolId,
    toolVersion: a.toolVersion,
    status: a.status,
    approverSubject: a.approverSubject,
    decisionReason: a.decisionReason,
    decidedAt: a.decidedAt,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
  };
}
