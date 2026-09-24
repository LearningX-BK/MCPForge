// MCPForge — step [7]: the guarded write dispatch. W0-F3, 02 §3.1.2 + §3.1.1.
//
// Everything between "the policy chain said proceed" and "the binding ran"
// lives here, in one function, because the ordering IS the safety property and
// an ordering spread across three call sites is an ordering nobody can review.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER, AND THE DECISION W0-C3 LEFT OPEN.
//
//   1. single-flight join      — an identical call already running in THIS
//                                process is joined, not duplicated.
//   2. idempotency `begin()`   — the record is CLAIMED AND COMMITTED here,
//                                BEFORE the execute transaction opens.
//   3. execute transaction     — { consume the confirm nonce · invoke the
//                                binding · settle the record } as ONE unit.
//
// **Step 2 commits before step 3 opens. That is W0-F3's decision, taken here
// and not deferred again.** W0-C3's `IdempotencyRepository.begin` docstring set
// out both options; the reasoning for this one:
//
//  - The case 02 §3.1.2 exists for is the AMBIGUOUS TIMEOUT — the attempt that
//    died after the target committed. No local transaction can be atomic with a
//    side effect in JD Edwards. If the record were enclosed by the execute
//    transaction, a crash between the target's commit and ours would roll the
//    record back, and the honest agent's retry would find nothing and create a
//    second payable. Committing first means the retry finds a `pending` record
//    and is refused (stage 6h's in-flight refusal) instead of duplicating.
//  - The cost is the mirror case: a claim whose execute transaction rolls back
//    leaves a record that outlives a call which did nothing. That is the
//    cheaper failure by a wide margin — it costs a refusal the caller can
//    resolve by looking at the target, where the other costs a duplicate
//    payable nobody sees. `fail()` below narrows it further: a rollback we
//    observe settles the record rather than leaving it pending.
//  - CLAUDE.md's stated bias (write safety) is to refuse a possible duplicate
//    rather than risk one, and W0-C3 called this ordering "the stronger of the
//    two" for the same reason. This task agrees with it explicitly rather than
//    inheriting it by accident.
//
// The nonce is the opposite way round and is NOT a choice: 02 §3.1.1 requires
// the `confirm_nonce` INSERT inside the same transaction as the execute, so a
// rolled-back execute leaves the token unspent and an executed call leaves it
// spent. **This is where a confirm token actually becomes single-use** — W0-F1
// and W0-F2 verified tokens but deliberately spent nothing, because stage 6g
// runs before the executor and consuming there would burn a plan on a crash
// that never reached the target.
// ─────────────────────────────────────────────────────────────────────────────
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

import { createHash } from 'node:crypto';
import { extractResultKeys } from '../../reversal/result-keys.js';
import type { AppendAuditCallInput, AuditResultKey } from '../../store/audit/types.js';
import { ConfirmNonceAlreadyConsumedError } from '../../store/runtime/types.js';
import type { ConfirmedCall, PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { businessArgs } from '../confirm/hash.js';
import { idempotencyKeyForCall } from './key.js';
import { replayedResponse } from './replay.js';
import type {
  ScopeHoursLookup,
  WriteDispatchOutcome,
  WritePathStore,
  WriteTargetInvoker,
} from './types.js';

export interface WriteDispatcherDeps {
  readonly store: WritePathStore;
  readonly invoker: WriteTargetInvoker;
  scopeHoursFor?: ScopeHoursLookup;
  /** Injected so tests pin the window. Defaults to `ctx.scope.now`. */
  now?(): Date;
  /**
   * Per-field argument redaction, for the `args_redacted` column. SEAM.
   *
   * 02 §4.6 defines the rule — redaction is driven by `sensitivity_class` plus
   * per-input `redact: true`, and a redacted value is replaced by
   * `sha256(value)[:12]` rather than removed — but the per-input `redact` flag
   * has no engine anywhere in this repo yet, so there is nothing here to call.
   * **This is flagged, not silently skipped** (see W0-F5's report): the default
   * below writes the BUSINESS arguments verbatim, which is correct for every
   * Wave 0 write tool because none of them declares `redact: true`, and would
   * be wrong the moment one does. Whichever task builds that engine wires it in
   * here, in one place.
   *
   * The confirm token is never part of what reaches this function: it is
   * stripped before the call and recorded as `confirm_token_hash` instead.
   */
  redactArgs?(
    args: Readonly<Record<string, unknown>>,
    entry: PolicyCatalogueEntry,
  ): Readonly<Record<string, unknown>>;
  readonly gatewayVersion?: string;
}

export interface DispatchWriteInput {
  readonly call: PolicyCall;
  readonly entry: PolicyCatalogueEntry;
  readonly ctx: PolicyContext;
  /** Stage 6g's verified token. A dispatch without one is a bug, and refuses. */
  readonly confirmed: ConfirmedCall | null;
  /**
   * W0-F5, 02 §3.1.4 — the audit call id this call REVERSES, when it is a
   * reversal. Set only by `core/gateway/reversal/`'s executor seam, and it is
   * the only field on this input that a reversal supplies and an ordinary write
   * does not: everything else about a reversal is an ordinary write, deliberately.
   */
  readonly reversesCallId?: string;
}

export interface WriteDispatcher {
  dispatch(input: DispatchWriteInput): Promise<WriteDispatchOutcome>;
}

/** A result body, as the response the agent sees. Non-objects are wrapped, never dropped. */
function responseOf(result: unknown): Readonly<Record<string, unknown>> {
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>) }
    : { result };
}

function targetTail(toolId: string): string {
  return toolId.replace(/\.[^.]+$/, '');
}

export function writeDispatcher(deps: WriteDispatcherDeps): WriteDispatcher {
  /**
   * Calls executing right now in THIS process, keyed by idempotency key.
   *
   * **Why this exists.** Two concurrent presentations of one confirmed token
   * must produce ONE target call and TWO answers, and the second answer must be
   * the first's result marked `replayed` (02 §3.1.2, Wave 0 exit criterion
   * 7(d)). The durable record cannot supply that on its own: the loser's
   * `begin()` sees `pending`, and `pending` has no result to return yet. So the
   * loser joins the winner's promise and is served from it.
   *
   * **What it is not.** It is not the safety mechanism, and nothing rests on it
   * being present. The `UNIQUE` INSERT is what makes the claim atomic and the
   * nonce's `UNIQUE` INSERT is what makes the token single-use; both hold with
   * this map empty, and a caller whose in-flight peer is in another process (or
   * died) is refused by stage 6h rather than joined. It is an in-process,
   * single-instance convenience for a single-instance gateway (02 §10.4 item
   * 6), and it must be read as one: it does not survive a restart and it does
   * not span replicas. When the store becomes Postgres and the gateway becomes
   * many, the refusal is what remains, and it is already correct.
   *
   * Entries are set SYNCHRONOUSLY before the first `await`, so two calls that
   * interleave cannot both miss the map.
   */
  const inFlight = new Map<string, Promise<WriteDispatchOutcome>>();

  /**
   * The `audit_call` row for one executed write, assembled from the call, the
   * catalogue entry and the context — never from anything the TARGET said about
   * itself except its result keys.
   *
   * The three W0-F5 fields are the last block: `reversal_class` and
   * `reversal_tool_id` are frozen from the manifest's `writeSafety.reversal` AS
   * IT WAS at execute time, and `result_keys` are extracted from the result.
   * Freezing rather than re-deriving is the point — `forge audit reverse` must
   * construct the call the tool declared when the write happened, not the one
   * its manifest declares after a later edit.
   */
  function auditInputFor(args: {
    readonly input: DispatchWriteInput;
    readonly confirmed: ConfirmedCall;
    readonly idempotencyKey: string;
    readonly result: unknown;
    readonly nowIso: string;
  }): AppendAuditCallInput {
    const { input, confirmed, idempotencyKey, result, nowIso } = args;
    const { call, entry, ctx } = input;
    const principal = ctx.scope.session.principal;
    const session = ctx.scope.session;
    const reversal = entry.reversal;

    const business = businessArgs(call.args);
    const redact = deps.redactArgs ?? ((a: Readonly<Record<string, unknown>>) => a);

    const resultKeys: readonly AuditResultKey[] = extractResultKeys(
      result,
      entry.resultKeys ?? [],
    );

    return {
      ts: nowIso,
      correlationId: call.correlationId,
      callerSubject: principal.subject,
      ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
      ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
      ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
      callerRoles: [...session.heldRoleIds],

      consumerId: session.consumer.consumerId,
      // W0-N10, 02 §11.3 — the three provenance columns, taken from what
      // `[2a]` froze when this session was authenticated
      // (`../../transport/consumer-auth/provenance.ts`) and NOT re-derived
      // here. `consumerRecordSha` is therefore the version of the consumer's
      // authorizations that was in force at THIS call, not the version the
      // record happens to hold when someone reads the row back.
      consumerRecordSha: session.consumerSession.recordSha,
      consumerAuthMethod: session.consumerSession.authMethod,
      consumerSessionId: session.consumerSession.consumerSessionId,
      // The consumer record decides whether a human is in the loop; the gateway
      // does not assume one (non-negotiable 6).
      humanInTheLoop: session.consumer.attestation.humanInTheLoop,

      toolId: entry.toolId,
      toolVersion: entry.toolVersion,
      serverId: entry.serverId,
      bindingType: entry.bindingType,
      sensitivityClass: entry.sensitivity,
      isWrite: true,

      targetObject: entry.bindingRef,
      deploymentId: ctx.scope.deployment.deploymentId,
      ...(deps.gatewayVersion === undefined ? {} : { gatewayVersion: deps.gatewayVersion }),

      phase: input.reversesCallId === undefined ? 'execute' : 'reverse',
      // The TOKEN never lands in the trail — only a hash of it, so two rows can
      // be shown to share a token without the token being readable from either
      // (non-negotiable 8's spirit, applied to a bearer value).
      confirmTokenHash: createHash('sha256').update(confirmed.confirmToken).digest('hex'),
      argsHash: confirmed.argsCanonicalHash,
      idempotencyKey,
      replayed: false,

      argsRedacted: redact(business, entry),
      resultKeys,

      outcome: 'ok',

      ...(reversal === undefined ? {} : { reversalClass: reversal.class }),
      ...(reversal?.tool === undefined ? {} : { reversalToolId: reversal.tool }),
      ...(input.reversesCallId === undefined ? {} : { reversesCallId: input.reversesCallId }),
    };
  }

  async function run(
    input: DispatchWriteInput,
    confirmed: ConfirmedCall,
    idempotencyKey: string,
  ): Promise<WriteDispatchOutcome> {
    const { call, entry, ctx } = input;
    const now = deps.now?.() ?? ctx.scope.now;
    const nowIso = now.toISOString();
    const scopeHours = deps.scopeHoursFor?.(entry.toolId);

    // --- 2. the claim, COMMITTED before the execute transaction opens -------
    const claim = await deps.store.idempotency.begin({
      callerSubject: ctx.scope.session.principal.subject,
      toolId: entry.toolId,
      toolVersion: entry.toolVersion,
      argsCanonicalHash: confirmed.argsCanonicalHash,
      confirmToken: confirmed.confirmToken,
      ...(scopeHours === undefined ? {} : { scopeHours }),
      now: nowIso,
    });

    if (claim.outcome === 'replayed') {
      return { kind: 'replayed', response: replayedResponse(claim.record.result) };
    }
    if (claim.outcome === 'in_flight') {
      // A `pending` record with no local promise: a previous attempt died
      // between its record and its outcome, or (Postgres era) it belongs to
      // another instance. Either way the binding must not run.
      return {
        kind: 'refused',
        code: 'RATE_LIMITED',
        message: `An identical call to ${call.toolId} was already recorded and has not yet reported an outcome, so this call was not sent to the target.`,
        next: `Do not create a new plan for this change. Use ${targetTail(call.toolId)}.get or .get_status to establish whether the earlier attempt completed at the target, and act on that answer; presenting the SAME confirm token again returns the original result once it settles.`,
      };
    }

    // --- 3. the execute transaction: nonce + binding + outcome + AUDIT ------
    let invoked = false;
    let auditCallId = '';
    try {
      const result = await deps.store.transaction(async () => {
        // 02 §3.1.1 — single-use, enforced by the UNIQUE constraint inside this
        // transaction. A rolled-back execute leaves the token unspent.
        await deps.store.nonces.consume({
          nonce: confirmed.nonce,
          callerSubject: ctx.scope.session.principal.subject,
          toolId: entry.toolId,
          toolVersion: entry.toolVersion,
          expiresAt: confirmed.tokenExpiresAt,
          now: nowIso,
        });

        invoked = true;
        const invocationResult = await deps.invoker.invoke({
          call,
          entry,
          ctx,
          confirmed,
          idempotencyKey,
        });

        await deps.store.idempotency.complete({
          idempotencyKey,
          result: invocationResult,
          now: (deps.now?.() ?? new Date()).toISOString(),
        });

        // 02 §3.1.4 — "The registry is live, not documentation. At execute time
        // the gateway writes `reversal_class`, the reversing tool id, and the
        // extracted `result_keys` into the audit record." Inside this
        // transaction, beside the nonce and the settle, for the reason
        // `WritePathStore.audit` states.
        const appended = await deps.store.audit.append(
          auditInputFor({
            input,
            confirmed,
            idempotencyKey,
            result: invocationResult,
            nowIso: (deps.now?.() ?? new Date()).toISOString(),
          }),
        );
        auditCallId = appended.id;
        return invocationResult;
      });

      return { kind: 'executed', response: responseOf(result), auditCallId };
    } catch (error) {
      if (error instanceof ConfirmNonceAlreadyConsumedError) {
        // Defensive, and reachable only if a token were presented under two
        // different idempotency keys — which the token's own HMAC binding to
        // caller, tool, version and argument hash already prevents. Settling the
        // claim keeps the refusal stable on every later repeat of this key.
        await settleFailure(idempotencyKey, 'PLAN_EXPIRED', error.message);
        return {
          kind: 'refused',
          code: 'PLAN_EXPIRED',
          message: `The confirm token presented to ${call.toolId} has already been used. A confirm token authorises exactly one execution.`,
          next: `Call ${call.toolId} again without confirm to obtain a fresh plan, show that plan to the human, and confirm it. If you did not intend a second change, check ${targetTail(call.toolId)}.get first — the first execution may already have made this one.`,
        };
      }

      const detail = error instanceof Error ? error.message : String(error);
      await settleFailure(idempotencyKey, 'TARGET_ERROR', detail);

      // The transaction rolled back, so the nonce is unspent and the audit unit
      // is undone — but the TARGET may or may not have committed, and this path
      // must never claim otherwise. `invoked` is the only honest distinction we
      // hold.
      return invoked
        ? {
            kind: 'refused',
            code: 'TARGET_ERROR',
            message: `${call.toolId} was sent to the target and the call did not complete: ${detail}. The outcome at the target is UNKNOWN.`,
            next: `Do NOT re-issue this write blindly. Use ${targetTail(call.toolId)}.get or .get_status to determine whether the operation completed, then act on that answer; report correlationId ${call.correlationId} to the MCPForge operator.`,
          }
        : {
            kind: 'refused',
            code: 'INTERNAL',
            message: `${call.toolId} was not sent to the target: ${detail}.`,
            next: `Report correlationId ${call.correlationId} to the MCPForge operator. Tell the human the request did not reach the target system, so no business record was created or changed.`,
          };
    }
  }

  /**
   * Settle a claim that will not produce a result. Best-effort by design: the
   * refusal the caller receives must not be replaced by a bookkeeping failure,
   * and an unsettled record simply stays `pending` — which refuses the next
   * attempt, the conservative direction.
   */
  async function settleFailure(
    idempotencyKey: string,
    errorCode: string,
    detail: string,
  ): Promise<void> {
    try {
      await deps.store.idempotency.fail({
        idempotencyKey,
        errorCode,
        result: { code: errorCode, message: detail },
        now: (deps.now?.() ?? new Date()).toISOString(),
      });
    } catch {
      // Swallowed deliberately. See above.
    }
  }

  return {
    async dispatch(input: DispatchWriteInput): Promise<WriteDispatchOutcome> {
      const { confirmed } = input;
      if (confirmed === null) {
        // Structurally unreachable through the chain: 6g refuses a write with
        // no verified token, and a read tool never reaches this dispatcher. A
        // caller that assembled one by hand is refused, never executed.
        return {
          kind: 'refused',
          code: 'INTERNAL',
          message: `${input.call.toolId} reached the write dispatcher with no verified confirm token and was not sent to the target.`,
          next: `Report correlationId ${input.call.correlationId} to the MCPForge operator. Tell the human the request did not reach the target system, so no business record was created or changed.`,
        };
      }

      const idempotencyKey = idempotencyKeyForCall(input.entry, input.ctx, confirmed);

      // --- 1. single-flight ---------------------------------------------------
      const joined = inFlight.get(idempotencyKey);
      if (joined !== undefined) {
        const outcome = await joined;
        // The winner's own answer, re-marked: a replay is what the second
        // presentation of one token gets (02 §3.1.2). A refusal is passed
        // through unchanged — there is no original result to replay.
        return outcome.kind === 'refused'
          ? outcome
          : { kind: 'replayed', response: replayedResponse(outcome.response) };
      }

      const running = run(input, confirmed, idempotencyKey);
      inFlight.set(idempotencyKey, running);
      try {
        return await running;
      } finally {
        inFlight.delete(idempotencyKey);
      }
    },
  };
}
