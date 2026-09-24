// MCPForge — the one place an approved plan becomes a confirm token. W0-F6.
//
// THE WHOLE OF W0-F6's SECURITY CLAIM IS IN THIS FILE'S SIGNATURE. It takes an
// `ApprovalRequest` and a keyring. It does not take a subject, so there is no
// way to mint a token for anyone but `request.callerSubject` — the requester.
// 03 §7.4: *"The approver does not execute; the requester does. This separation
// is deliberate ... approval unlocks the token, it does not perform the write."*
// That separation is enforced here by the absence of a parameter, which is the
// only kind of enforcement that survives a careless edit three tasks from now.
//
// **The token is W0-F1/F2's token, not a second kind.** Same `mintConfirmToken`,
// same payload, same signature, same verifier. Stage 6g cannot tell an
// approval-minted token from a plan-minted one and must not: an approval
// unlocks the ordinary execute path rather than opening a second one.
//
// TWO VALUES THAT ARE DERIVED, NOT CHOSEN, AND WHY:
//
//  * **`nonce = request.id`.** The approval id is already unique (UUIDv7) and
//    already durable, and using it makes minting a PURE FUNCTION of the stored
//    record. That matters for one specific reason: the token is minted at the
//    moment of approval (03 §7.4) *and* handed to the requester again when they
//    poll `status`, and if those two mints produced different nonces then one
//    approval would yield two independently spendable tokens — one approval,
//    two vouchers. With the nonce fixed to the approval id, W0-F3's
//    `confirm_nonce` INSERT admits exactly one execution per approval, which is
//    what a human approving one plan means. The nonce is not a secret: it is
//    signed into the token and its job is single-use, not concealment.
//
//  * **`exp = request.expiresAt`.** The token expires with the approval, which
//    expires with the plan (03 §7.4). The tool's `tokenTtlSeconds` governs the
//    un-approved path, where the agent already holds the token and five minutes
//    is a reasonable ceiling; it is deliberately NOT re-applied at approval
//    time, because that would make the token's expiry depend on a value not
//    stored in the record and the two mint sites could then disagree. Flagged
//    in the task report as a judgment call.
//
// **The witness segment is empty on this path.** `argumentWitness()` is computed
// from plan-time argument VALUES (../confirm/hash.ts), and this module holds
// only their hash — by design: the approval queue is a durable table, and
// putting business argument values in it would create exactly the second
// business-data store ../confirm/hash.ts refuses to create. The consequence is
// bounded and stated: on the human-approval path a `PLAN_ARGUMENT_MISMATCH`
// still REFUSES with full force (`argsCanonicalHash` is in the payload), it
// simply cannot name which field changed.

import { mintConfirmToken, type ConfirmKeyring } from '../confirm/token.js';
import type { ApprovalRequest } from './types.js';

/** Epoch seconds for an ISO-8601 instant. */
export function epochSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Approval carries an unparseable timestamp: ${iso}`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Mint the confirm token an approved request unlocks. Refuses — loudly — to
 * mint for a request that is not `approved`: a mint on a pending, rejected or
 * expired record would be the one bug that makes the whole gate decorative.
 */
export function mintApprovedToken(request: ApprovalRequest, keyring: ConfirmKeyring): string {
  if (request.status !== 'approved') {
    throw new Error(
      `Refusing to mint a confirm token for approval ${request.id}: it is ${request.status}, not approved.`,
    );
  }
  if (request.approverSubject === null) {
    throw new Error(
      `Refusing to mint a confirm token for approval ${request.id}: it carries no approver.`,
    );
  }
  if (request.toolVersion === null) {
    // Stage 6g binds the token to a tool VERSION. A record without one could
    // only ever mint a token that fails verification, and failing here names
    // the real fault instead of surfacing it later as a bogus mismatch.
    throw new Error(
      `Refusing to mint a confirm token for approval ${request.id}: it records no tool version.`,
    );
  }
  return mintConfirmToken(
    {
      // The REQUESTER. Not a parameter, not an override, not a fallback.
      callerSubject: request.callerSubject,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      argsCanonicalHash: request.argsCanonicalHash,
      planHash: request.planHash,
      nonce: request.id,
      exp: epochSeconds(request.expiresAt),
    },
    keyring,
  );
}
