// MCPForge — W0-P3f: the stored plan body is shown only if it IS the plan
// being approved.
//
// Owner decision, 30 Sep 2026: the approval request stores the whole plan
// body, and every read re-hashes it against the request's `planHash`. That hash
// is what the confirm token binds (02 §3.1.1) and what the approver approves,
// computed by `planCanonicalHash` over this exact object at raise time
// (`policy/confirm/gate.ts`). So a body that re-hashes to `planHash` is the
// approved plan, and one that does not has been altered (or corrupted) in the
// store: it is withheld and the request cannot be decided on it. On SQLite the
// store can be edited by anyone with the file (02 §10); this check makes such
// an edit visible rather than persuasive.

import { planBodySchema, type PlanBody } from '@mcpforge/shared/api/v1';
import { planCanonicalHash } from '../../policy/confirm/hash.js';
import type { ApprovalRequest } from '../../store/runtime/types.js';

export type PlanBodyCheck =
  | { readonly status: 'verified'; readonly body: PlanBody }
  | { readonly status: 'absent' }
  | { readonly status: 'mismatch' };

export function verifiedPlanBody(
  approval: Pick<ApprovalRequest, 'planBody' | 'planHash'>,
): PlanBodyCheck {
  if (approval.planBody === null || approval.planBody === undefined) return { status: 'absent' };
  // The hash is taken over the STORED value, before any parsing narrows it, so
  // an extra field smuggled into the row changes the hash too.
  if (planCanonicalHash(approval.planBody) !== approval.planHash) return { status: 'mismatch' };
  const parsed = planBodySchema.safeParse(approval.planBody);
  // A body that hashes correctly but does not fit the contract means the
  // gateway wrote a shape the portal was not built for: withheld, not guessed.
  return parsed.success ? { status: 'verified', body: parsed.data } : { status: 'mismatch' };
}
