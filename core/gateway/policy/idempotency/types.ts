// MCPForge — the write dispatch's inputs and seams. W0-F3, 02 §3.1.2, §3.1.1.
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

import type { ConfirmedCall, PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import type { AuditRepository } from '../../store/audit/types.js';
import type { ConfirmNonceRepository, IdempotencyRepository } from '../../store/runtime/types.js';

/**
 * The two repositories the write path spends, plus the reentrant transaction
 * that makes them one unit. Structurally satisfied by `RuntimeStore` — named as
 * a narrow view so this module cannot reach the rest of the store, and so a
 * test can supply the two repositories without opening a database it does not
 * need.
 */
export interface WritePathStore {
  readonly idempotency: IdempotencyRepository;
  readonly nonces: ConfirmNonceRepository;
  /**
   * W0-F5. The audit append runs INSIDE the execute transaction, beside the
   * nonce consume and the idempotency settle — not beside it afterwards.
   *
   * W0-F3 left this seam open deliberately ("the dispatcher writes no audit row
   * yet; F5 should add it inside that same transaction rather than beside it"),
   * and the reason it belongs inside is the reason the nonce does: a rolled-back
   * execute must leave NO trace claiming the write happened, and a committed
   * execute must leave a trace that is already there. An append outside the
   * transaction would produce, on a crash between the two, either an audit row
   * for a call that did not settle or a settled call with no audit row — and the
   * second is the one that breaks the product's central claim, because a write
   * MCPForge cannot show you is a write nobody can reverse.
   */
  readonly audit: AuditRepository;
  /** Reentrant: an inner `transaction` joins this one as a savepoint (W0-C3). */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Per-tool `writeSafety.idempotency.scopeHours` (02 §3.1.2, default 24).
 * Returning `undefined` means "the tool declares none" and the store's default
 * governs — never "no idempotency", which is not an option on a write tool.
 */
export type ScopeHoursLookup = (toolId: string) => number | undefined;

/**
 * Step [7]: the binding executor. SEAM — W0-H owns the binding-type dispatch;
 * the mock target implements this in tests.
 *
 * **It is invoked exactly once per idempotency key inside its window.** That is
 * not this interface's promise to keep; it is `./dispatch.ts`'s, and the
 * implementor may assume it.
 */
export interface WriteTargetInvoker {
  invoke(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly ctx: PolicyContext;
    readonly confirmed: ConfirmedCall;
    /** The derived key, so the executor can echo it into an audit row (W0-C2). */
    readonly idempotencyKey: string;
  }): Promise<unknown>;
}

/** What a dispatched write ended up doing. */
export type WriteDispatchOutcome =
  /** The binding ran, once, and the record now carries its result. */
  | {
      readonly kind: 'executed';
      readonly response: Readonly<Record<string, unknown>>;
      /** The audit row written inside the execute transaction (W0-F5). */
      readonly auditCallId: string;
    }
  /**
   * The binding did NOT run: an identical call inside the window had already
   * produced this result. The response carries `"replayed": true` (02 §3.1.2).
   */
  | { readonly kind: 'replayed'; readonly response: Readonly<Record<string, unknown>> }
  /** Refused before or during execution, with a closed-taxonomy code. */
  | {
      readonly kind: 'refused';
      readonly code: 'RATE_LIMITED' | 'PLAN_EXPIRED' | 'TARGET_ERROR' | 'INTERNAL';
      readonly message: string;
      readonly next: string;
    };
