// MCPForge — stage 6h's `IdempotencyGate`, filled for real. W0-F3, 02 §3.1.2.
//
// This is the implementation of the seam W0-E3 left named at stage 6h, filled
// the same way W0-F1 filled 6g's `WriteGate`: one object, reached only through
// the frozen stage list, with no second entry point beside it.
//
// WHAT THIS STAGE DOES AND DOES NOT DO.
//
//  - It LOOKS UP. `findReplay` is read-only, so a call that never reaches the
//    executor — a refusal at a later gate, a dropped connection — leaves no
//    `pending` record behind to block the caller's next honest attempt.
//  - It does NOT claim. The claim is a `UNIQUE`-constrained INSERT that must
//    happen immediately before the binding runs, and that is ./dispatch.ts's
//    job, in ./dispatch.ts's file, next to the invocation it guards.
//
// The two are not redundant. This stage answers the common case — a retry after
// the original finished — without opening a write transaction, and refuses the
// case where a previous attempt is still `pending`. The dispatcher's claim is
// what makes the guarantee atomic under concurrency.
//
// A read tool reaches 6h with no confirmed call and therefore no key material:
// four of the five parts exist but `confirmToken` does not, and inventing a
// substitute would compose a key the spec does not define. It proceeds. Reads
// are not what 02 §3.1.2 protects.

import type { IdempotencyGate, IdempotencyVerdict } from '../types.js';
import { idempotencyKeyForCall } from './key.js';
import type { ScopeHoursLookup, WritePathStore } from './types.js';

export interface IdempotencyGateDeps {
  readonly store: Pick<WritePathStore, 'idempotency'>;
  /** `writeSafety.idempotency.scopeHours` per tool. Omitted, the row's own window governs. */
  scopeHoursFor?: ScopeHoursLookup;
  /** Injected so tests pin the window boundary. Defaults to `ctx.scope.now`. */
  now?(): Date;
}

/**
 * A record still `pending` inside its window: an identical call is executing
 * right now, or a previous attempt died between the record and its outcome.
 * Neither "proceed" nor "replay" is honest — there is no result yet, and
 * proceeding is precisely the duplicate this mechanism exists to prevent.
 *
 * `RATE_LIMITED` is the code, chosen deliberately from the closed taxonomy (02
 * §3.1.5): it is the only refusal whose contract is "the identical call may
 * succeed later without any change by the caller", which is exactly true here —
 * re-presenting the SAME token once the original settles returns the original
 * result as a replay. The stage supplies its own `condition` and `next`, so
 * nothing in the response claims a rate limit was exceeded.
 */
function inFlightRefusal(toolId: string): IdempotencyVerdict {
  return {
    kind: 'refuse',
    code: 'RATE_LIMITED',
    message: `An identical call to ${toolId} — same caller, same arguments, same confirm token — is already in progress and has not yet recorded an outcome.`,
    next: `Do not re-send with a new plan: that would create a second record. Wait for the first call to finish and present the SAME confirm token again to receive its original result; if it never settles, use ${toolId.replace(/\.[^.]+$/, '')}.get or .get_status to establish what happened at the target before doing anything else.`,
  };
}

/** Build the gate. The returned object is what a composition root passes as `PolicyRuntime.idempotency`. */
export function idempotencyGate(deps: IdempotencyGateDeps): IdempotencyGate {
  return {
    async lookup(call, entry, ctx, confirmed): Promise<IdempotencyVerdict> {
      if (confirmed === null) return { kind: 'proceed' };

      const key = idempotencyKeyForCall(entry, ctx, confirmed);
      const now = (deps.now?.() ?? ctx.scope.now).toISOString();
      const scopeHours = deps.scopeHoursFor?.(entry.toolId);
      const options = scopeHours === undefined ? { now } : { now, scopeHours };

      const settled = await deps.store.idempotency.findReplay(key, options);
      if (settled !== undefined) {
        // 02 §3.1.2: the ORIGINAL result. A `failed` record replays its recorded
        // error rather than re-running the binding — W0-C3's deliberate,
        // conservative reading, because a binding that returned an error may
        // still have committed at the target.
        return { kind: 'replay', previousResult: settled.result };
      }

      const existing = await deps.store.idempotency.get(key);
      if (existing !== undefined && existing.status === 'pending' && now < existing.expiresAt) {
        return inFlightRefusal(call.toolId);
      }

      return { kind: 'proceed' };
    },
  };
}
