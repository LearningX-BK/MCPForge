// MCPForge — the two ELEVATED-WRITE rules that hang off stage 6e′. W0-N3.
// 02 §11.4's posture table, rows "Approval" and "Consumer"; 05 §3.3.2 states
// both in the same words.
//
// W0-E3 landed the stage, the posture test and the grant requirement. This file
// lands the rest of the rule set, and both rules apply ONLY to an elevated
// WRITE — a read through an elevated binding needs its grant (W0-E3) and
// nothing more, because neither row of the table speaks about reads:
//
//   * **Approval.** "`humanApprovalRequired` is forced true for every write,
//     overriding the tool's own default — *unless* the grant carries a
//     `standingAuthorization`." Forcing is a NARROWING and never a widening: a
//     tool that already declares `humanApprovalRequired: true` keeps it, and a
//     standing authorization restores the tool's own setting rather than
//     switching approval off. `forcedHumanApproval: false` therefore never
//     means "no approval needed" — it means "6e′ added nothing", and 6g still
//     reads the tool's own flag.
//
//   * **Consumer.** "Additionally requires `attestation.humanInTheLoop: true`,
//     or the write is refused outright." Refused OUTRIGHT — not downgraded to
//     a plan, not queued for approval. A client that attests no human is in its
//     loop cannot satisfy a forced human approval, so admitting the call to 6g
//     would only produce an approval nobody is present to give.
//
// **W0-N4 HAS NOW LANDED THAT RESOLUTION.** 02 §11.4.4 requires a
// `standingAuthorization` to resolve to a committed approval record with a
// named approver and its own `expiresAt`. W0-N3 could only check that the ref
// was syntactically present; `./standing.ts` now checks that it RESOLVED — at
// compile time, against `approvals/` — and re-checks the record's own expiry
// against the call clock. Every refusal it can produce reverts this function to
// `forcedHumanApproval: true`, so the change is a pure narrowing of W0-N3: a
// standing authorization that would have been honoured before and is not
// honoured now costs a human approval, never an admitted call.

import { standingAuthorizationInForce } from './standing.js';
import type { CompiledBindingGrant, PolicyCatalogueEntry } from '../types.js';

export interface ElevatedWriteVerdict {
  /**
   * True when 6e′ overrides the tool's own `humanApprovalRequired` to `true`.
   * False means 6e′ said nothing — NOT that approval is unnecessary.
   */
  readonly forcedHumanApproval: boolean;
  /** The approval reference that substituted for the per-call approval, if any. */
  readonly standingAuthorization: string | null;
  /** Why, in words, for the audit trail. */
  readonly reason: string;
}

/**
 * 02 §11.4's "Approval" row. `grant` is the live, recorded, correctly-named
 * ROLE grant that authorized the call — a standing authorization is a property
 * of "a role × binding-type grant" (02 §11.4.4), so a consumer grant never
 * supplies one.
 */
export function elevatedWriteApproval(
  entry: PolicyCatalogueEntry,
  grant: CompiledBindingGrant,
  now: Date,
): ElevatedWriteVerdict {
  if (!entry.write) {
    return {
      forcedHumanApproval: false,
      standingAuthorization: null,
      reason: `${entry.toolId} is a read tool; the elevated posture's forced approval applies to writes only (02 §11.4).`,
    };
  }

  // [W0-N4] The ONLY thing a standing authorization may do is stand down the
  // forced per-call approval this stage would otherwise impose. Every other
  // check — the grant itself (already made, above this call), 6f's guardrails
  // and SoD, 6g's plan -> confirm, and the identity resolved at stage 2 — runs
  // identically whether it is in force or not, because nothing here writes to
  // any of them.
  const standing = standingAuthorizationInForce(grant, now);
  if (standing.inForce) {
    return {
      forcedHumanApproval: false,
      standingAuthorization: standing.ref,
      reason: `${entry.toolId} is an elevated write, and grant ${grant.approvalRef} carries standing authorization ${standing.ref} — approved by ${standing.approver}, expiring ${standing.expiresAt}. The forced per-call approval is stood down; the tool's own humanApprovalRequired still governs, and plan -> confirm, guardrails and SoD all still run (02 §11.4.4).`,
    };
  }

  // FAIL-CLOSED FALLBACK. Missing, unresolved, unapproved, unnamed, undated,
  // expired or malformed all arrive here, and all arrive at the SAME stricter
  // outcome: a forced human approval on the write.
  return {
    forcedHumanApproval: true,
    standingAuthorization: null,
    reason: `${entry.toolId} is an elevated write and ${standing.reason}, so humanApprovalRequired is forced true regardless of the tool's own setting (02 §11.4, §11.4.4).`,
  };
}

export type HumanInTheLoopVerdict =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly reason: string; readonly next: string };

/**
 * 02 §11.4's "Consumer" row. Applies to an elevated WRITE only, and reads the
 * consumer's ATTESTATION — which grants nothing and withholds nothing on its
 * own (see `ConsumerAuthorizationView`), except here, where the document makes
 * a false attestation a refusal.
 *
 * Fail-closed on the unstated: only the literal boolean `true` permits. An
 * absent or non-boolean attestation refuses, because "a human is in this
 * client's loop" is a claim that must be made, never one that may be inferred.
 */
export function elevatedWriteHumanInTheLoop(
  entry: PolicyCatalogueEntry,
  consumerId: string,
  humanInTheLoop: boolean,
): HumanInTheLoopVerdict {
  if (!entry.write) return { permitted: true };
  if (humanInTheLoop === true) return { permitted: true };
  return {
    permitted: false,
    reason: `${entry.toolId} is an elevated write and consumer ${consumerId} attests attestation.humanInTheLoop: false, so the write is refused outright (02 §11.4).`,
    next: `Do not retry ${entry.toolId} from this client. An elevated write requires a client that attests a human is in its loop; run this write from an interactive client that does, or ask the owner of ${consumerId} to propose a registration change — a change of attestation is a reviewed, approved git change, not a per-call flag.`,
  };
}
