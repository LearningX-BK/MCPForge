// MCPForge — the human-approval gate. W0-F6, 02 §3.1.1, 03 §7.4.
//
// This fills the branch W0-F1 deliberately left refusing. Its own report said
// so: *"`humanApprovalRequired: true` is handled by REFUSING with
// `APPROVAL_REQUIRED` ... W0-F6 replaces this refusal with the
// `awaiting_human_approval` response and its approvalId."* That site is
// ../confirm/gate.ts, and it now calls this object.
//
// THE STATE MACHINE, in one place:
//
//   plan, humanApprovalRequired  ->  raise()      -> PENDING, no token minted
//   approver approves            ->  decide()     -> APPROVED, token minted for
//                                                    the REQUESTER (./mint.ts)
//   approver declines            ->  decide()     -> REJECTED, reason becomes
//                                                    the agent's `next`
//   window closes                ->  status()/decide() -> EXPIRED, reported as
//                                                    expired, never as absent
//   approver == requester        ->  refuse       -> POLICY_GUARDRAIL_BREACH
//
// WHERE THE PERSISTENCE ENDS AND THE POLICY BEGINS. W0-C3 owns the table and
// says of itself: *"This repository will store a self-approval if asked to; the
// chain above it is what must refuse to ask."* This file is that chain, and
// `selfApprovalRefusal` below is the refusal to ask. Nothing here re-implements
// a repository operation: expiry sweeping, the `where status = 'pending'`
// guard, and the two-approvers-at-once race are all W0-C3's, and are reached
// through `deps.queue`.
//
// WHY A RE-PLAN RESUMES RATHER THAN RAISING AGAIN. 02 §3.1.1's own `next`
// invites the agent to *"ask the human to approve and retry"*, and a retried
// plan is an ordinary second call through the whole chain. If each retry raised
// a new row, a polite agent polling every ten seconds would bury the approver's
// queue in identical requests and the human would approve an arbitrary one of
// them. So a raise first looks for a still-pending request from the SAME
// requester, for the SAME tool version, with the SAME `argsCanonicalHash` AND
// the SAME `planHash`, and resumes it. All four must match: a changed argument
// or a changed plan is a different thing to approve, and gets its own row.
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

import { mintApprovedToken } from './mint.js';
import { relativeApprovalUrl } from './url.js';
import {
  DEFAULT_APPROVAL_TTL_SECONDS,
  type ApprovalGate,
  type ApprovalGateDeps,
  type ApprovalRequest,
  type ApprovalRefusal,
  type DecideApprovalCommand,
  type DecisionOutcome,
  type RaiseApprovalInput,
  type RaiseOutcome,
  type StatusOutcome,
} from './types.js';

function ttlSeconds(deps: ApprovalGateDeps): number {
  const declared = deps.approvalTtlSeconds;
  return declared !== undefined && Number.isFinite(declared) && declared > 0
    ? declared
    : DEFAULT_APPROVAL_TTL_SECONDS;
}

/** Has this request's window closed by `now`? Reads the row, never a clock alone. */
function isPastWindow(request: ApprovalRequest, now: Date): boolean {
  return Date.parse(request.expiresAt) <= now.getTime();
}

/**
 * The `next` an agent reads while it waits. Non-negotiable #5: it names the
 * human action and the tool that reports on it, never "try again".
 */
function awaitingNext(toolId: string, approvalId: string, approvalUrl: string): string {
  return `A named approver must approve this in the MCPForge portal at ${approvalUrl}. Tell the human the change is waiting on that approval, then call forge.approval.status with approvalId=${approvalId} to learn the decision. Do not call ${toolId} again to make it happen sooner — once approved, that call returns the confirm token to you.`;
}

function approvedNext(toolId: string): string {
  return `The change was approved. Call ${toolId} again with the identical arguments plus confirm=<confirmToken> to execute it. The approver cannot execute it for you; the token is valid only for the requester who raised it.`;
}

function rejectedNext(toolId: string, request: ApprovalRequest): string {
  const reason =
    request.decisionReason === null || request.decisionReason.trim().length === 0
      ? 'The approver recorded no reason.'
      : `The approver's reason: ${request.decisionReason}`;
  return `${reason} Do not call ${toolId} again with these arguments. Tell the human it was declined and what the reason was; if they want a different change, plan that change instead.`;
}

function expiredNext(toolId: string, request: ApprovalRequest): string {
  return `This approval request expired at ${request.expiresAt} without a decision, so no confirm token was ever minted and nothing was executed. Call ${toolId} again without confirm to produce a fresh plan, and ask the named approver to decide it before it expires.`;
}

/**
 * Self-approval. 02 §3.1.3's `sodConflict` is the same claim in a different
 * costume — the grant that lets you ask is not the grant that lets you say yes
 * — so it refuses with that guardrail's own code rather than a new one.
 */
function selfApprovalRefusal(request: ApprovalRequest): ApprovalRefusal {
  return {
    kind: 'refuse',
    code: 'POLICY_GUARDRAIL_BREACH',
    message: `${request.callerSubject} raised this request for ${request.toolId} and may not also approve it; an approval is a second person's decision, not a second click by the same one.`,
    next: `Ask a different named approver — someone who holds the approval grant for ${request.toolId} and did not raise this request — to decide it in the MCPForge portal. The request stays pending until they do or until it expires.`,
  };
}

function notPendingRefusal(request: ApprovalRequest): ApprovalRefusal {
  return {
    kind: 'refuse',
    code: 'APPROVAL_REQUIRED',
    message: `Approval ${request.id} is already ${request.status}${request.approverSubject === null ? '' : ` (decided by ${request.approverSubject})`} and cannot be decided again.`,
    next: `Nothing further is needed on this request. If a new decision is wanted, the requester must plan ${request.toolId} again, which raises a fresh approval request for the fresh plan.`,
  };
}

/**
 * Build the gate. One object; the portal's approval routes and stage 6g hold
 * the SAME instance, so there is no second path by which an approval can be
 * recorded or a token minted.
 */
export function approvalGate(deps: ApprovalGateDeps): ApprovalGate {
  const urlFor = deps.approvalUrl ?? relativeApprovalUrl;
  const clock = (): Date => deps.now?.() ?? new Date();

  /**
   * Read a request and apply expiry to the value we return. The repository
   * sweeps the row on `decide()`; this makes a READ honest too, so a status
   * poll one second after the window closes says `expired` rather than
   * `pending` (03 §7.4 shows the countdown for exactly this reason).
   */
  async function readWithExpiry(
    approvalId: string,
    now: Date,
  ): Promise<ApprovalRequest | undefined> {
    const stored = await deps.queue.get(approvalId);
    if (stored === undefined) return undefined;
    if (stored.status === 'pending' && isPastWindow(stored, now)) {
      return { ...stored, status: 'expired' };
    }
    return stored;
  }

  return {
    async raise(input: RaiseApprovalInput): Promise<RaiseOutcome> {
      const now = clock();
      const expiresAt = new Date(now.getTime() + ttlSeconds(deps) * 1000).toISOString();

      const pending = await deps.queue.listPending();
      const resumable = pending.find(
        (request) =>
          request.callerSubject === input.callerSubject &&
          request.toolId === input.toolId &&
          request.toolVersion === input.toolVersion &&
          request.argsCanonicalHash === input.argsCanonicalHash &&
          request.planHash === input.planHash &&
          !isPastWindow(request, now),
      );

      const request =
        resumable ??
        (await deps.queue.create({
          planHash: input.planHash,
          argsCanonicalHash: input.argsCanonicalHash,
          planSummary: input.planSummary,
          callerSubject: input.callerSubject,
          ...(input.consumerId === undefined ? {} : { consumerId: input.consumerId }),
          toolId: input.toolId,
          toolVersion: input.toolVersion,
          expiresAt,
          now: now.toISOString(),
        }));

      const approvalUrl = urlFor(request.id);
      return {
        kind: 'awaiting',
        approvalId: request.id,
        approvalUrl,
        expiresAt: request.expiresAt,
        next: awaitingNext(input.toolId, request.id, approvalUrl),
        resumed: resumable !== undefined,
      };
    },

    async decide(command: DecideApprovalCommand): Promise<DecisionOutcome> {
      const now = clock();
      const current = await readWithExpiry(command.approvalId, now);
      if (current === undefined) {
        return {
          kind: 'refuse',
          code: 'APPROVAL_REQUIRED',
          message: `There is no approval request ${command.approvalId} in this gateway's queue.`,
          next: `Check the approval id against the Approvals queue in the MCPForge portal. If the request is not there, the requester must plan the change again to raise a new one.`,
        };
      }

      // Order matters and is deliberate. **Self-approval is checked before
      // expiry** so the refusal names the real problem: telling a requester
      // their own approval "expired" when it would have been refused anyway
      // teaches them to approve faster next time, which is the opposite lesson.
      if (command.approverSubject === current.callerSubject) {
        return selfApprovalRefusal(current);
      }
      if (current.status === 'expired' || isPastWindow(current, now)) {
        return { kind: 'expired', request: { ...current, status: 'expired' }, next: expiredNext(current.toolId, current) };
      }
      if (current.status !== 'pending') {
        return notPendingRefusal(current);
      }

      let decided: ApprovalRequest;
      try {
        decided = await deps.queue.decide({
          id: command.approvalId,
          status: command.decision,
          approverSubject: command.approverSubject,
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          now: now.toISOString(),
        });
      } catch (cause) {
        // The repository guards the transition in SQL, so this is the losing
        // side of a genuine race (two approvers at once) or a row that expired
        // between the read above and the update. Re-read and report the state
        // that actually won, rather than the state we hoped for.
        const after = await readWithExpiry(command.approvalId, now);
        if (after === undefined) {
          return {
            kind: 'refuse',
            code: 'INTERNAL',
            message: `Approval ${command.approvalId} could not be decided: ${String((cause as Error).message ?? cause)}`,
            next: `Ask the MCPForge operator to check the gateway log for this approval id. The requester's change has NOT been executed; nothing was minted.`,
          };
        }
        if (after.status === 'expired') {
          return { kind: 'expired', request: after, next: expiredNext(after.toolId, after) };
        }
        return notPendingRefusal(after);
      }

      if (decided.status === 'rejected') {
        return { kind: 'rejected', request: decided, next: rejectedNext(decided.toolId, decided) };
      }

      return {
        kind: 'approved',
        request: decided,
        confirmToken: mintApprovedToken(decided, deps.keyring),
        expiresAt: decided.expiresAt,
      };
    },

    async status(input: {
      readonly approvalId: string;
      readonly subject: string;
    }): Promise<StatusOutcome> {
      const now = clock();
      const request = await readWithExpiry(input.approvalId, now);
      if (request === undefined) {
        return {
          kind: 'unknown',
          approvalId: input.approvalId,
          next: `There is no approval request with that id. Check the id with the human, or plan the change again to raise a new request.`,
        };
      }

      switch (request.status) {
        case 'pending':
          return {
            kind: 'pending',
            request,
            next: awaitingNext(request.toolId, request.id, urlFor(request.id)),
          };
        case 'rejected':
          return { kind: 'rejected', request, next: rejectedNext(request.toolId, request) };
        case 'expired':
          return { kind: 'expired', request, next: expiredNext(request.toolId, request) };
        case 'approved':
        default: {
          // **The token is released to the REQUESTER and to nobody else.** An
          // approver — or any other session that learned the approval id — gets
          // the state and no token. The token would not authorise their call
          // anyway (./mint.ts binds the requester's subject), so this is
          // defence in depth rather than the only control; it exists because a
          // token handed to the wrong party is a token in the wrong log.
          const mine = input.subject === request.callerSubject;
          return {
            kind: 'approved',
            request,
            ...(mine ? { confirmToken: mintApprovedToken(request, deps.keyring) } : {}),
            expiresAt: request.expiresAt,
            next: mine
              ? approvedNext(request.toolId)
              : `This request was approved and its confirm token belongs to ${request.callerSubject}, who raised it. Only they can execute it; an approver never executes the change they approved.`,
          };
        }
      }
    },
  };
}
