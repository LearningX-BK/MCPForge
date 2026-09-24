// MCPForge — the write path's runtime state, as types. W0-C3.
//
// Three repositories, one per table in `../schema/spec.ts`'s W0-C3 block:
// idempotency records (02 §3.1.2), single-use confirm nonces (02 §3.1.1) and
// the `awaiting_human_approval` queue's state machine (02 §3.1.1).
//
// **What this module is not.** It does not sign or verify a confirm token
// (W0-F2), does not canonicalise arguments (W0-F2), does not dispatch a plan or
// an execute (W0-F1/F3), does not evaluate a guardrail (W0-E-track) and owns no
// UX (Phase 3). It is persistence and the atomicity guarantees that make the
// write path's safety claims true, and every hash it stores arrives already
// computed by the layer that owns the computing.

/** 02 §3.1.2 — the lifecycle of one idempotency record. */
export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

/** One `idempotency_record` row. Times are ISO-8601 UTC (schema/spec.ts). */
export interface IdempotencyRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsCanonicalHash: string;
  readonly confirmTokenHash: string;
  readonly status: IdempotencyStatus;
  /** The original result, replayed verbatim. Null until the outcome is known. */
  readonly result: unknown;
  readonly errorCode: string | null;
  readonly callId: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly scopeHours: number;
  readonly expiresAt: string;
}

/**
 * The five parts 02 §3.1.2 composes into the key, plus the window.
 *
 * `confirmToken` is taken raw and hashed here — it is a part of the key's
 * preimage, so the key cannot be derived without it, but it is never stored in
 * that form (see `../schema/spec.ts`).
 */
export interface BeginIdempotentInput {
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsCanonicalHash: string;
  readonly confirmToken: string;
  /** `writeSafety.idempotency.scopeHours`. 02 §3.1.2's default is 24. */
  readonly scopeHours?: number;
  /** Injectable clock, so the contract suite does not depend on wall time. */
  readonly now?: string;
}

/**
 * What `begin` found. The three outcomes are genuinely different and a caller
 * that collapses them would be wrong in a way that matters:
 *
 *  - `started` — this record is new. **The binding has not run.** Invoke it,
 *    then call `complete` or `fail`.
 *  - `replayed` — a record for this key already reached an outcome inside its
 *    window. **Do not invoke the binding.** Return `record.result` with
 *    `"replayed": true` (02 §3.1.2).
 *  - `in_flight` — a record exists and is still `pending`: the same call is
 *    executing right now, or a previous attempt died between writing the record
 *    and reaching an outcome. **Do not invoke the binding** — that is precisely
 *    the duplicate-payable case the whole mechanism exists to prevent. The
 *    caller's job is to say so, not to guess.
 */
export type BeginIdempotentOutcome = 'started' | 'replayed' | 'in_flight';

export interface BeginIdempotentResult {
  readonly outcome: BeginIdempotentOutcome;
  readonly record: IdempotencyRecord;
  /** The derived key, so the caller can pass it to the audit row unchanged. */
  readonly idempotencyKey: string;
}

export interface CompleteIdempotentInput {
  readonly idempotencyKey: string;
  /** The result to replay verbatim on a later repeat inside the window. */
  readonly result: unknown;
  readonly callId?: string;
  readonly now?: string;
}

export interface FailIdempotentInput {
  readonly idempotencyKey: string;
  /** From the closed error taxonomy (02 §3.1.5). */
  readonly errorCode: string;
  /** The error payload returned to the agent, replayed verbatim on a repeat. */
  readonly result?: unknown;
  readonly callId?: string;
  readonly now?: string;
}

export interface IdempotencyLookupOptions {
  readonly now?: string;
  /**
   * Override the window recorded on the row. Supplied when the caller holds the
   * tool's current `writeSafety.idempotency.scopeHours` and wants that value to
   * govern rather than the one in force when the record was written. Omitted,
   * the row's own `expires_at` governs — which is the auditable behaviour and
   * the default for a reason.
   */
  readonly scopeHours?: number;
}

/**
 * 02 §3.1.2. Written **before** the binding is invoked, completed after.
 *
 * There is no `update` beyond `complete`/`fail` and no way to rewrite a record
 * that already reached an outcome: a replayed result that could be edited would
 * not be the original result.
 */
export interface IdempotencyRepository {
  /**
   * Claim the key, or discover it is already claimed. Atomic: the claim is a
   * `UNIQUE`-constrained `INSERT`, not a read followed by a write, so two
   * concurrent attempts cannot both start. **On one node** — 02 §10.4 item 6;
   * multi-replica is a Postgres-era property.
   *
   * **Where to call it, which is a real decision and not a detail.** 02 §3.1.2
   * says the record is written *before the binding is invoked*, and the point
   * of that ordering is the ambiguous timeout: the retry of a call that died
   * mid-binding must find something. No local transaction can be atomic with a
   * side effect in JD Edwards, so for the record to protect that case it must
   * be **committed before** the execute transaction opens, not enclosed by it —
   * a record that rolls back with the unit leaves the crash-after-target-commit
   * window open. Calling `begin` inside the unit is supported and coherent (a
   * rolled-back unit spent no nonce and wrote no audit row, so a retry is a
   * genuinely fresh attempt), but it is the weaker of the two and the choice
   * belongs to the policy chain (W0-F3), which is why the store does not make
   * it here. The nonce is the opposite way round and is not a choice: 02 §3.1.1
   * requires it inside the unit.
   */
  begin(input: BeginIdempotentInput): Promise<BeginIdempotentResult>;
  /** Record the outcome of a successful invocation. */
  complete(input: CompleteIdempotentInput): Promise<IdempotencyRecord>;
  /** Record the outcome of a failed invocation. */
  fail(input: FailIdempotentInput): Promise<IdempotencyRecord>;
  get(idempotencyKey: string): Promise<IdempotencyRecord | undefined>;
  /**
   * The record to replay for this key, or undefined if there is none inside the
   * window. Read-only — `begin` is the path that claims.
   */
  findReplay(
    idempotencyKey: string,
    options?: IdempotencyLookupOptions,
  ): Promise<IdempotencyRecord | undefined>;
  /** Retention. Returns the number of rows removed. */
  deleteExpired(nowIso?: string): Promise<number>;
}

/**
 * Thrown when an outcome is written onto a record that is not `pending` — a
 * second `complete`, or a `fail` after a `complete`.
 *
 * A refusal rather than a silent no-op because the two callers it can come from
 * are both bugs worth surfacing: a write path that settled twice, or one that
 * settled a record another attempt had already settled. The original result is
 * left exactly as it was either way — 02 §3.1.2 says a replay returns the
 * ORIGINAL result, and one that could be edited afterwards would not be it.
 */
export class IdempotencyNotPendingError extends Error {
  readonly idempotencyKey: string;
  readonly status: IdempotencyStatus;

  constructor(idempotencyKey: string, status: IdempotencyStatus) {
    super(`Idempotency record ${idempotencyKey} is ${status}, not pending, and cannot be settled.`);
    this.name = 'IdempotencyNotPendingError';
    this.idempotencyKey = idempotencyKey;
    this.status = status;
  }
}

/** One `confirm_nonce` row — the record that a nonce has been spent. */
export interface ConfirmNonceConsumption {
  readonly id: string;
  readonly nonce: string;
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string | null;
  readonly planHash: string | null;
  readonly consumedAt: string;
  readonly expiresAt: string;
  readonly callId: string | null;
}

export interface ConsumeNonceInput {
  /** The `nonce` field of the verified confirm-token payload (02 §3.1.1). */
  readonly nonce: string;
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion?: string;
  readonly planHash?: string;
  /** The token's own `exp`. Spent nonces are swept only after this. */
  readonly expiresAt: string;
  readonly callId?: string;
  readonly now?: string;
}

/**
 * Thrown when a nonce has already been spent — a replayed confirm token.
 *
 * A distinct type rather than a bare `Error` because the caller must be able to
 * tell "this token was already used" from "the store is broken" without reading
 * a message string: the first is a refusal the agent gets an actionable `next`
 * for, the second is `INTERNAL`. Mapping this onto the closed taxonomy (02
 * §3.1.5) belongs to the policy chain, not to the store.
 */
export class ConfirmNonceAlreadyConsumedError extends Error {
  readonly nonce: string;
  /** The consumption that won, so the refusal can say when and by whom. */
  readonly existing: ConfirmNonceConsumption;

  constructor(existing: ConfirmNonceConsumption) {
    super(
      `Confirm nonce ${existing.nonce} was already consumed at ${existing.consumedAt} for ${existing.toolId}.`,
    );
    this.name = 'ConfirmNonceAlreadyConsumedError';
    this.nonce = existing.nonce;
    this.existing = existing;
  }
}

/**
 * 02 §3.1.1 — "Tokens are single-use (a nonce table, consumed atomically)".
 *
 * There is no `issue`: a row exists if and only if the nonce has been spent.
 * The token's validity is carried by its HMAC signature and its `exp`, both of
 * which are W0-F2's, so the store holds the one fact a signature cannot — that
 * this particular token has now been used.
 */
export interface ConfirmNonceRepository {
  /**
   * Spend a nonce. **Call this inside the same transaction as the execute** —
   * that is the atomicity 02 §3.1.1 requires, and consuming outside it would
   * leave a nonce spent on a call that rolled back, or a call committed on a
   * nonce that was never spent.
   *
   * Throws `ConfirmNonceAlreadyConsumedError` if the nonce is already spent.
   * The refusal comes from the `UNIQUE` constraint — the database, not a
   * read-then-write — so a concurrent second attempt loses deterministically.
   */
  consume(input: ConsumeNonceInput): Promise<ConfirmNonceConsumption>;
  /** Read-only. Never a substitute for `consume`: checking is not claiming. */
  find(nonce: string): Promise<ConfirmNonceConsumption | undefined>;
  /**
   * Retention. Removes spent nonces whose token can no longer be presented,
   * i.e. `expires_at < now`. Sweeping earlier would make a token reusable.
   */
  deleteExpired(nowIso?: string): Promise<number>;
}

/** 02 §3.1.1 — the states an approval request can be in. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** One `approval_request` row. */
export interface ApprovalRequest {
  readonly id: string;
  readonly planHash: string;
  readonly argsCanonicalHash: string;
  readonly planSummary: string | null;
  readonly callerSubject: string;
  readonly consumerId: string | null;
  readonly toolId: string;
  readonly toolVersion: string | null;
  readonly status: ApprovalStatus;
  readonly approverSubject: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateApprovalInput {
  readonly planHash: string;
  readonly argsCanonicalHash: string;
  /** The exact `plan` string shown to the approver. */
  readonly planSummary?: string;
  readonly callerSubject: string;
  readonly consumerId?: string;
  readonly toolId: string;
  readonly toolVersion?: string;
  readonly expiresAt: string;
  readonly now?: string;
}

export interface DecideApprovalInput {
  readonly id: string;
  /** Only a decision — a request cannot be moved back to pending. */
  readonly status: 'approved' | 'rejected';
  /** `Principal.subject` of the human who decided. Required, always. */
  readonly approverSubject: string;
  readonly reason?: string;
  readonly now?: string;
}

/**
 * Thrown when a request is decided twice, or decided after expiry.
 *
 * The transition is guarded in SQL (`… where status = 'pending'`) rather than
 * by reading the row first, so two approvers clicking at once produce one
 * decision and one refusal rather than a lost update.
 */
export class ApprovalNotPendingError extends Error {
  readonly approvalId: string;
  readonly status: ApprovalStatus;

  constructor(approvalId: string, status: ApprovalStatus) {
    super(`Approval ${approvalId} is ${status}, not pending, and cannot be decided again.`);
    this.name = 'ApprovalNotPendingError';
    this.approvalId = approvalId;
    this.status = status;
  }
}

/**
 * 02 §3.1.1: *"Phase 3 owns that queue's UX; the gateway owns the state
 * machine."* This is the state machine's persistence.
 *
 * What is deliberately NOT here, because it is policy and not storage: who may
 * approve, whether an approver may approve their own request (a `sodConflict`
 * question, 02 §3.1.3), and the minting of the confirm token that follows an
 * approval (W0-F2). This repository will store a self-approval if asked to; the
 * chain above it is what must refuse to ask.
 */
export interface ApprovalRepository {
  create(input: CreateApprovalInput): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  /** The queue: pending requests, oldest first. */
  listPending(limit?: number): Promise<ApprovalRequest[]>;
  /**
   * Decide a pending request. Throws `ApprovalNotPendingError` if it has
   * already been decided or has expired.
   */
  decide(input: DecideApprovalInput): Promise<ApprovalRequest>;
  /**
   * Move every pending request past its `expires_at` to `expired`. Returns the
   * number moved. A separate, explicit sweep rather than a computed status: an
   * expiry that only ever existed as a `WHERE` clause would be invisible to the
   * portal's queue and to anyone auditing what happened to a request.
   */
  expireDue(nowIso?: string): Promise<number>;
}
