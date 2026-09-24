// MCPForge — the human-approval gate's vocabulary. W0-F6, 02 §3.1.1, 03 §7.4.
//
// 02 §3.1.1 draws the line this module sits on: *"No `confirmToken` is minted
// until a human approves in the portal. Phase 3 owns that queue's UX; the
// gateway owns the state machine."* W0-C3 built the queue's PERSISTENCE and
// said, in so many words, that who may approve — and whether an approver may
// approve their own request — is a policy question for the chain above. This
// module is that chain above.
//
// FOUR PROPERTIES THE TYPES HERE EXIST TO MAKE UNAMBIGUOUS:
//
//  1. **A raise never yields a token.** `RaiseOutcome` has no `confirmToken`
//     field at all, in any variant. The plan-time branch of stage 6g therefore
//     cannot mint one even by accident — there is nowhere to put it.
//  2. **A minted token names the REQUESTER.** Every mint goes through one
//     function (`./mint.ts`) whose only source of `callerSubject` is the stored
//     request's own `callerSubject`. The approver's subject is not a parameter
//     of it, so "the approver executes" is not a rule that has to be remembered
//     — it is a value that does not exist at the mint site (03 §7.4).
//  3. **Expired is a reported state, not an absence.** Every outcome union
//     carries an explicit `expired` variant. 03 §7.4: *"an expired approval is
//     shown as expired rather than silently disappearing."*
//  4. **Every refusal carries a `next`.** Non-negotiable #5. The `next` is part
//     of the type on every refusing variant, not an optional afterthought.

import type { ApprovalRequest, ApprovalStatus } from '../../store/runtime/types.js';
import type { ConfirmKeyring } from '../confirm/token.js';

export type { ApprovalRequest, ApprovalStatus };

/**
 * The slice of W0-C3's `ApprovalRepository` this gate uses. Declared as a port
 * rather than taking the whole `RuntimeStore` so the gate depends on the four
 * operations it actually performs, and so a test can hold the real SQLite
 * repository (it does) without the gate reaching anything else in the store.
 *
 * There is no second approval table and no parallel schema: these signatures are
 * W0-C3's, verbatim.
 */
export interface ApprovalQueue {
  create(input: {
    readonly planHash: string;
    readonly argsCanonicalHash: string;
    readonly planSummary?: string;
    readonly callerSubject: string;
    readonly consumerId?: string;
    readonly toolId: string;
    readonly toolVersion?: string;
    readonly expiresAt: string;
    readonly now?: string;
  }): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  listPending(limit?: number): Promise<ApprovalRequest[]>;
  decide(input: {
    readonly id: string;
    readonly status: 'approved' | 'rejected';
    readonly approverSubject: string;
    readonly reason?: string;
    readonly now?: string;
  }): Promise<ApprovalRequest>;
}

/**
 * The approval window, in seconds, when nothing else declares one.
 *
 * **A judgment call, flagged in the task report.** The manifest schema has a
 * `writeSafety.confirm.tokenTtlSeconds` (300 s by default) and no field for the
 * approval window, but the two cannot be the same number: five minutes is the
 * right ceiling for a token an agent already holds and the wrong one for a
 * human being asked to read a plan. One working day is the default here, and it
 * is overridable per gate — it is NOT invented per call and never extended
 * after the fact, because "approvals expire with their plan" (03 §7.4) is only
 * a guarantee if the window is fixed when the plan is made.
 */
export const DEFAULT_APPROVAL_TTL_SECONDS = 86_400;

/** How an `apr_…` id becomes the link 02 §3.1.1 returns and 03 §7.4 routes to. */
export type ApprovalUrlBuilder = (approvalId: string) => string;

export interface ApprovalGateDeps {
  readonly queue: ApprovalQueue;
  /** The same keyring stage 6g mints and verifies confirm tokens with. */
  readonly keyring: ConfirmKeyring;
  /** Defaults to the portal-relative `/approvals/<id>` (see ./url.ts). */
  readonly approvalUrl?: ApprovalUrlBuilder;
  readonly approvalTtlSeconds?: number;
  /** Injected so tests pin expiry, exactly as `ConfirmGateDeps.now` is. */
  now?(): Date;
}

/** What stage 6g knows about the call when it must raise an approval. */
export interface RaiseApprovalInput {
  readonly toolId: string;
  readonly toolVersion: string;
  readonly callerSubject: string;
  readonly consumerId?: string;
  /** W0-F2's hash, from `argsCanonicalHash(call.args)`. Never a second scheme. */
  readonly argsCanonicalHash: string;
  /** W0-F2's `planCanonicalHash(planBody)` — the exact plan being approved. */
  readonly planHash: string;
  /** The rendered plan sentence the approver will read. */
  readonly planSummary: string;
  /** The tool's own `writeSafety.confirm.tokenTtlSeconds`, for the post-approval window. */
  readonly tokenTtlSeconds: number;
}

/**
 * The result of raising. One variant, deliberately: a raise produces a pending
 * request and nothing else. **There is no `confirmToken` in this type.**
 */
export interface RaiseOutcome {
  readonly kind: 'awaiting';
  readonly approvalId: string;
  readonly approvalUrl: string;
  /** ISO-8601. The approval — and therefore the plan — dies here. */
  readonly expiresAt: string;
  readonly next: string;
  /** True when an identical pending request already existed and was resumed. */
  readonly resumed: boolean;
}

export interface DecideApprovalCommand {
  readonly approvalId: string;
  /** `Principal.subject` of the human deciding. Never the requester's. */
  readonly approverSubject: string;
  readonly decision: 'approved' | 'rejected';
  /** Required for a decline — 03 §7.4 returns it to the agent as the `next`. */
  readonly reason?: string;
}

/**
 * A refusal, in the closed taxonomy (02 §3.1.5). Self-approval refuses with
 * `POLICY_GUARDRAIL_BREACH` because that is the code 02 §3.1.3 already assigns
 * to `sodConflict`, and approving one's own request is the same separation-of-
 * duties claim: the grant that lets you ask is not the grant that lets you say
 * yes. Inventing a new code for it would put one SoD idea behind two codes.
 */
export interface ApprovalRefusal {
  readonly kind: 'refuse';
  readonly code: 'POLICY_GUARDRAIL_BREACH' | 'APPROVAL_REQUIRED' | 'INTERNAL';
  readonly message: string;
  readonly next: string;
}

/** The outcome of a decision. `expired` is explicit — never a missing row. */
export type DecisionOutcome =
  | {
      readonly kind: 'approved';
      readonly request: ApprovalRequest;
      /**
       * Minted here and only here, at the moment of approval (03 §7.4: *"On
       * approve, the gateway mints the confirm token"*), and bound to
       * `request.callerSubject` — the REQUESTER. Handing it to the approver's
       * portal session is safe precisely because it authorises nothing in that
       * session: stage 6g refuses it for any caller but the requester.
       */
      readonly confirmToken: string;
      readonly expiresAt: string;
    }
  | { readonly kind: 'rejected'; readonly request: ApprovalRequest; readonly next: string }
  | { readonly kind: 'expired'; readonly request: ApprovalRequest; readonly next: string }
  | ApprovalRefusal;

/** The outcome of a status poll — what `forge.approval.status` answers with. */
export type StatusOutcome =
  | { readonly kind: 'pending'; readonly request: ApprovalRequest; readonly next: string }
  | {
      readonly kind: 'approved';
      readonly request: ApprovalRequest;
      /** Released ONLY to the requester. Absent for anyone else. */
      readonly confirmToken?: string;
      readonly expiresAt: string;
      readonly next: string;
    }
  | { readonly kind: 'rejected'; readonly request: ApprovalRequest; readonly next: string }
  | { readonly kind: 'expired'; readonly request: ApprovalRequest; readonly next: string }
  | { readonly kind: 'unknown'; readonly approvalId: string; readonly next: string };

/** The gate itself. Stage 6g holds one of these; the portal holds the same one. */
export interface ApprovalGate {
  raise(input: RaiseApprovalInput): Promise<RaiseOutcome>;
  decide(command: DecideApprovalCommand): Promise<DecisionOutcome>;
  status(input: { readonly approvalId: string; readonly subject: string }): Promise<StatusOutcome>;
}
