// MCPForge — deriving 02 §3.1.2's key from a call. W0-F3.
//
// The composition itself is W0-C3's `idempotencyKeyFor` and is imported, never
// re-implemented: 02 §3.1.2 defines exactly one key, and a second sha256 over
// "roughly the same parts" would make every in-window record unfindable, which
// presents as a duplicate payable rather than as an error. This file only maps
// a `PolicyCall` onto those five parts.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CONSUMER QUESTION, RESOLVED EXPLICITLY (CLAUDE.md §1, §8).
//
// 02 §3.1.2 names FIVE parts and `consumerId` is not among them, and TASKS.md's
// own `done:` clause for W0-F3 writes the same five literally. `consumer_id` is
// nonetheless NOT NULL on `audit_call` (non-negotiable #6), so two different
// registered consumers acting for the SAME human with identical arguments and
// the SAME confirm token would compose the same key and the second would be
// served the first's result as a replay.
//
// The literal five parts are what is implemented, for two reasons and one
// observation:
//
//  1. A documented decision is not re-opened because a sixth part looks safer
//     (CLAUDE.md §1). Silently adding a key component would also be invisible:
//     nothing in a manifest, a portal screen or an audit row would say the key
//     had six parts, and W0-C3's `idempotencyKeyFor` — which is what the store,
//     `tests/policy/escalation.confirm-mismatch.test.ts` and this file all
//     share — would have to grow an argument that no document asks for.
//  2. The collision is not reachable through the product's own write path. The
//     confirm token is minted per plan call, is single-use from this task
//     onward, and is bound by HMAC to `callerSubject`, `toolId`, `toolVersion`
//     and `argsCanonicalHash`. For two consumers to collide, one would have to
//     hand its unspent confirm token to the other — and the second presentation
//     of that token is refused as a spent nonce, not served as a replay. So the
//     collision requires a token handoff that is itself a refusal.
//
// The observation, recorded rather than fixed: the token is what disambiguates,
// so the property rests on token single-use rather than on the key. Should a
// future wave let two consumers legitimately share one confirm token, the key
// would need a sixth part and 02 §3.1.2 would need to say so first. That is a
// `needs_human`, not a patch.
// ─────────────────────────────────────────────────────────────────────────────

import { idempotencyKeyFor } from '../../store/runtime/idempotency.js';
import type { ConfirmedCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';

/** The five parts, read off the call the chain already verified. */
export function idempotencyKeyForCall(
  entry: PolicyCatalogueEntry,
  ctx: PolicyContext,
  confirmed: ConfirmedCall,
): string {
  return idempotencyKeyFor({
    // `Principal.subject` is the only identity value that reaches a key or an
    // audit row (CLAUDE.md §3, "Identity is pluggable").
    callerSubject: ctx.scope.session.principal.subject,
    toolId: entry.toolId,
    toolVersion: entry.toolVersion,
    // 6g's canonical hash, verbatim. Recomputing it here would be the second
    // canonicaliser CLAUDE.md forbids.
    argsCanonicalHash: confirmed.argsCanonicalHash,
    confirmToken: confirmed.confirmToken,
  });
}
