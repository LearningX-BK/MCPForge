// MCPForge — is this grant's `standingAuthorization` IN FORCE for this call?
// W0-N4. 02 §11.4.4 / 05 §3.3.4.
//
// 02 §11.4.4, in full, because every clause of it is a rule here:
//
//   > A role × binding-type grant may carry `standingAuthorization: <approvalRef>`
//   > — a recorded, expiring, named-approver decision that this role may execute
//   > this binding type's writes through the ordinary plan → confirm path
//   > without a per-call approval.
//
//   * It is an approval record in `approvals/`, committed, with a named approver.
//   * It appears in the compiled scope diff.
//   * It expires (default 180 days); renewal is a fresh approval.
//   * **It removes nothing else.** Plan → confirm, guardrails, SoD and the
//     identity requirement all still run.
//
// WHAT THIS FILE DOES, AND THE EXACT SIZE OF IT. It answers ONE question — may
// the elevated posture's FORCED per-call human approval be stood down for this
// call? — and it answers it `false` unless every property above holds. It
// touches no other stage: 6f (guardrails, SoD) and 6g (plan → confirm) run
// identically either way, and identity resolution happened at stage 2 long
// before this code is reached. The only value it can produce is a `false` in
// `PolicyChainState.forcedHumanApproval`, which is the state the chain is
// already in when 6e′ says nothing at all.
//
// THE FALLBACK IS NEVER OPEN. Every refusal below reverts to
// `forcedHumanApproval: true` — a HUMAN APPROVAL on the write, which is
// stricter than the tool's own default and strictly stricter than the standing
// authorization it failed to honour. There is no branch here that can admit a
// call, weaken a check, or produce a verdict a caller could mistake for one.
//
// WHY THE COMPILED BLOCK AND NOT `approvals/` DIRECTLY. The gateway reads
// compiled artefacts, never the working tree (02 §10.3's definitional/runtime
// split). Codegen resolves the ref to its record at compile time
// (`core/codegen/src/compile/standing.ts`) and writes the approver and the
// record's own expiry into `generated/roles/<id>.scope.json`. So the resolution
// a reviewer read in the change proposal is byte-for-byte the resolution the
// gateway enforces — and granting one is visible in the diff, which is the
// second of the four properties.
//
// AND THE CLOCK IS RE-READ HERE. Compile-time `effective: true` is a claim, not
// a licence: a gateway process that has been up since before the record's
// expiry must not keep standing down approvals on a dead authorization. The
// expiry is therefore re-tested against the call's own `now`, and compile-time
// `effective: false` is honoured as authoritative. Both directions can only
// narrow.

import type { CompiledBindingGrant, CompiledStandingAuthorization } from '../types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type StandingAuthorizationVerdict =
  | {
      /** A recorded, named-approver, unexpired standing authorization is in force. */
      readonly inForce: true;
      readonly ref: string;
      readonly approver: string;
      /** The RECORD's own expiry, which is not the grant's. */
      readonly expiresAt: string;
    }
  | {
      readonly inForce: false;
      /** Non-null when something was authored and rejected; null when nothing was authored. */
      readonly ref: string | null;
      /** Why, in words, for the audit trail and the forced-approval reason string. */
      readonly reason: string;
    };

function isRecordObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read the compiled block off a grant, defensively.
 *
 * A BARE STRING IS REFUSED, deliberately. Before W0-N4 the compiled artefact
 * carried `standingAuthorization` as the raw ref, and a raw ref is precisely
 * what cannot be checked — it names an approval record this process cannot
 * read, with an approver and an expiry it cannot see. A stale artefact must
 * therefore fall back to a per-call approval, not be trusted on its say-so.
 * That is the whole difference between the recorded thing 02 §11.4.4 describes
 * and the decoration §11.4.4 names as its second failure mode.
 */
export function compiledStandingAuthorization(
  grant: CompiledBindingGrant,
): CompiledStandingAuthorization | null {
  const raw: unknown = grant.standingAuthorization;
  if (!isRecordObject(raw)) return null;
  const ref = raw['ref'];
  if (typeof ref !== 'string' || ref.trim().length === 0) return null;
  return {
    ref: ref.trim(),
    status: typeof raw['status'] === 'string' ? raw['status'] : '',
    approver: typeof raw['approver'] === 'string' ? raw['approver'].trim() : '',
    expiresAt: typeof raw['expiresAt'] === 'string' ? raw['expiresAt'].trim() : '',
    effective: raw['effective'] === true,
  };
}

/**
 * Is this grant's standing authorization in force at `now`?
 *
 * `grant` has ALREADY been proved live, recorded and correctly named by
 * `findBindingGrant` before this is reached (see ./authorize.ts). Nothing here
 * can restore a grant that check refused — this function is only ever asked
 * about a grant that already authorized the call.
 */
export function standingAuthorizationInForce(
  grant: CompiledBindingGrant,
  now: Date,
): StandingAuthorizationVerdict {
  const raw: unknown = grant.standingAuthorization;
  if (raw === undefined || raw === null) {
    return { inForce: false, ref: null, reason: 'the grant carries no standingAuthorization' };
  }

  if (typeof raw === 'string') {
    return {
      inForce: false,
      ref: raw.trim().length === 0 ? null : raw.trim(),
      reason: `standingAuthorization ${JSON.stringify(raw)} is an unresolved reference rather than a resolved approval record. Re-run forge codegen so the compiled scope artefact carries the record's named approver and its expiry; an unresolved reference stands nothing down`,
    };
  }

  const block = compiledStandingAuthorization(grant);
  if (block === null) {
    return {
      inForce: false,
      ref: null,
      reason:
        'the grant carries a malformed standingAuthorization block with no readable ref, which resolves to no approval record at all',
    };
  }

  // Compile-time refusal is authoritative. `status` is the closed set codegen
  // writes; anything other than 'active' — including a value this build does
  // not recognise — refuses.
  if (block.status !== 'active' || !block.effective) {
    return {
      inForce: false,
      ref: block.ref,
      reason: `standingAuthorization ${block.ref} compiled with status "${block.status}" and is not in force`,
    };
  }
  if (block.approver.length === 0) {
    return {
      inForce: false,
      ref: block.ref,
      reason: `standingAuthorization ${block.ref} names no approver. A standing authorization is a NAMED person's recorded decision (02 §11.4.4); an unnamed one is not one`,
    };
  }
  if (!ISO_DATE.test(block.expiresAt)) {
    return {
      inForce: false,
      ref: block.ref,
      reason: `standingAuthorization ${block.ref} carries no readable expiry (${JSON.stringify(block.expiresAt)}). A standing authorization that cannot say when it ends has already ended`,
    };
  }
  // An unreadable clock is not a reason to stand down an approval.
  if (Number.isNaN(now.getTime())) {
    return {
      inForce: false,
      ref: block.ref,
      reason: `standingAuthorization ${block.ref} could not be checked against the call clock, which is not a valid date`,
    };
  }
  // The clock, re-read at call time. `>=` because a record expiring TODAY is
  // still in force today, matching `grantIsLive`'s reading exactly.
  const today = now.toISOString().slice(0, 10);
  if (block.expiresAt < today) {
    return {
      inForce: false,
      ref: block.ref,
      reason: `standingAuthorization ${block.ref} expired on ${block.expiresAt} (today is ${today}); renewal is a fresh approval, never a rollover`,
    };
  }

  return {
    inForce: true,
    ref: block.ref,
    approver: block.approver,
    expiresAt: block.expiresAt,
  };
}
