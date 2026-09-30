// MCPForge — stage 6e′'s decision, as a pure function. W0-E3, 02 §11.4.
//
// THE INTERSECTION, NOT THE UNION (CLAUDE.md non-negotiable #6). 02 §11.4 says
// "a role (or consumer) must name the binding type in `bindingGrants`". Read as
// a union — "either will do" — a consumer grant would let a client execute an
// elevated binding the human's roles never granted, which is exactly the
// substitution #6 forbids. So:
//
//   * a live grant on a role the caller HOLDS and which grants this tool is
//     REQUIRED, always; and
//   * when the consumer record declares any `bindingGrants` of its own, a live
//     consumer grant is required TOO — the client's own declaration narrows,
//     it never widens.
//
// A consumer that declares no `bindingGrants` at all is not thereby granted
// everything: its binding-type authorization is
// `authorizations.bindingTypes`, checked at stage 6a′, and that check has
// already run by the time this one does.
//
// **Flagged for a human (CLAUDE.md §8).** The union/intersection reading above
// is this task's, taken because #6 is unambiguous about intersections even
// though §11.4's parenthetical is not. W0-N3 owns the elevated-posture rule set
// and is the place to confirm or correct it; the choice here is the narrower of
// the two, so a correction can only widen deliberately.
//
// W0-N3 REVIEWED AND KEPT that reading unchanged: it is the narrower one, and
// nothing in 02 §11.4 or 05 §3.3 read for this task widens it.
//
// WHAT W0-N3 ADDS HERE. Two rules from 02 §11.4's posture table, both applying
// to an elevated WRITE only and both implemented in ./elevated.ts:
// `humanInTheLoop: false` refuses the write outright, and an elevated write
// with no `standingAuthorization` on its authorizing grant forces
// `humanApprovalRequired: true`. Neither can admit a call the grant check
// already refused — they run only on the authorized path, and each one can only
// narrow it.
//
// WHAT W0-N4 ADDS HERE. `standingAuthorization` now RESOLVES: ./standing.ts
// reads the compiled approval record — its named approver and its own expiry —
// and re-checks that expiry against `now`. It can only stand down the FORCED
// per-call approval the rule above imposes; it cannot admit a call, it cannot
// touch 6f's guardrails or SoD or 6g's plan -> confirm, and every one of its
// refusals lands on the stricter side.

import { findBindingGrant, type GrantMatch, type GrantSource } from './grants.js';
import { elevatedWriteApproval, elevatedWriteHumanInTheLoop } from './elevated.js';
import { bindingPosture, type BindingPosture } from './posture.js';
import type { CompiledBindingGrant, PolicyCatalogueEntry } from '../types.js';

export interface BindingAuthorizationInput {
  readonly entry: PolicyCatalogueEntry;
  /** Roles the caller holds AND which grant this tool, with their compiled grants. */
  readonly grantingRoles: readonly {
    readonly roleId: string;
    readonly grants: readonly CompiledBindingGrant[];
  }[];
  readonly consumerId: string;
  readonly consumerBindingGrants: readonly CompiledBindingGrant[];
  /** `consumer.attestation.humanInTheLoop` — 02 §11.4's "Consumer" row. */
  readonly humanInTheLoop: boolean;
  readonly now: Date;
}

export type BindingAuthorization =
  | {
      readonly authorized: true;
      readonly posture: BindingPosture;
      readonly why: string;
      /**
       * True only when 6e′ OVERRIDES the tool's own `humanApprovalRequired` to
       * `true`. False means 6e′ added nothing — the tool's own flag still
       * governs at 6g. It never means "no approval needed".
       */
      readonly forcedHumanApproval: boolean;
      /** The approval reference that substituted for a per-call approval, if any. */
      readonly standingAuthorization: string | null;
    }
  | {
      readonly authorized: false;
      readonly posture: 'elevated';
      /**
       * The refusal's taxonomy code. `ELEVATED_GRANT_REQUIRED` for a missing or
       * dead grant — the code 02 §11.4.2 assigns this stage — and
       * `CONSUMER_NOT_AUTHORIZED` for the `humanInTheLoop: false` refusal,
       * because that one is "the client may not, regardless of what the human
       * may" (02 §11.3), which is exactly what that code is worded for. Telling
       * the two apart matters to the agent: one is fixed by an approver issuing
       * a grant, the other cannot be fixed from this client at all.
       */
      readonly code: 'ELEVATED_GRANT_REQUIRED' | 'CONSUMER_NOT_AUTHORIZED' | 'TOOL_DISABLED';
      readonly reason: string;
      readonly next: string;
    };

export function authorizeBinding(input: BindingAuthorizationInput): BindingAuthorization {
  const { entry, now } = input;

  // W0-P12, CLAUDE.md #8 / 02 §11.5.1 (owner decision, 30 Sep 2026: fail closed
  // until built). A stored module credential is legitimate only when all four
  // parts of the test hold, and two of them (probe-reported non-carriage, the
  // compensating control echoed into audit) can only be proven at call time by
  // an executor that presents the credential. This gateway builds no such
  // executor: `function` exchanges a PER-USER token and never a stored one. So
  // no call to a `module-scoped-stored` binding can be shown legitimate here,
  // and every one is refused, FIRST, before any grant is consulted. A grant
  // cannot admit what the four-part test cannot prove. The four-part runtime
  // evaluation lands with the first stored-credential executor (W0-P27).
  if (entry.credentialClass === 'module-scoped-stored') {
    return {
      authorized: false,
      posture: 'elevated',
      code: 'TOOL_DISABLED',
      reason: `${entry.toolId} declares binding.credentialClass: module-scoped-stored, and this gateway has no executor that can present a stored credential while proving the four-part test (probe-reported non-carriage, a resolved per-user identity, a compensating control echoed into audit, and a credential scoped to one module and environment). An unprovable stored credential is a service-account fallback, which is forbidden.`,
      next: `Do not retry ${entry.toolId}; it cannot run in this deployment. Tell the human it is unavailable and name its owner. Its steward must either rebind it with binding.credentialClass: per-user-exchanged, or wait for a stored-credential executor that enforces the four-part test at call time.`,
    };
  }

  const posture = bindingPosture(entry);

  if (posture.posture === 'standard') {
    // Standard posture is default-allow WITHIN SCOPE — and "within scope" is
    // stages 6a/6a′/6e, which have already run. This stage adds nothing to it,
    // and in particular adds no forced approval: 02 §11.4's "Approval" row
    // leaves the tool's own `humanApprovalRequired` governing here.
    return {
      authorized: true,
      posture: 'standard',
      why: posture.reason,
      forcedHumanApproval: false,
      standingAuthorization: null,
    };
  }

  const roleSources: GrantSource[] = input.grantingRoles.map((r) => ({
    holder: `role:${r.roleId}`,
    grants: r.grants,
  }));

  const roleLookup = findBindingGrant(roleSources, entry, now);
  if (!roleLookup.found) {
    return refuse(
      entry,
      `${posture.reason} No role grant covers it: ${roleLookup.reason}.`,
      'role',
    );
  }

  if (input.consumerBindingGrants.length > 0) {
    const consumerLookup = findBindingGrant(
      [{ holder: `consumer:${input.consumerId}`, grants: input.consumerBindingGrants }],
      entry,
      now,
    );
    if (!consumerLookup.found) {
      return refuse(
        entry,
        `${posture.reason} The role grant ${roleLookup.match.grant.approvalRef} covers it but the consumer's own grants do not: ${consumerLookup.reason}.`,
        'consumer',
      );
    }
  }

  // From here the CALL is authorized by a live, recorded, correctly-named grant.
  // The two rules below can only narrow that, never restore anything the checks
  // above refused.
  const hitl = elevatedWriteHumanInTheLoop(entry, input.consumerId, input.humanInTheLoop);
  if (!hitl.permitted) {
    return {
      authorized: false,
      posture: 'elevated',
      code: 'CONSUMER_NOT_AUTHORIZED',
      reason: hitl.reason,
      next: hitl.next,
    };
  }

  const approval = elevatedWriteApproval(entry, roleLookup.match.grant, now);

  return {
    authorized: true,
    posture: 'elevated',
    why: `${posture.reason} ${grantedBy(roleLookup.match)} ${approval.reason}`,
    forcedHumanApproval: approval.forcedHumanApproval,
    standingAuthorization: approval.standingAuthorization,
  };
}

function grantedBy(match: GrantMatch): string {
  return `Authorized by ${match.holder} under approval ${match.grant.approvalRef} (approver ${match.grant.approver}, expires ${match.grant.expiresAt}).`;
}

function refuse(
  entry: PolicyCatalogueEntry,
  reason: string,
  missing: 'role' | 'consumer',
): BindingAuthorization {
  const grantName =
    entry.bindingType === 'plsql' || entry.bindingType === 'function'
      ? `a ${entry.bindingType} bindingGrant naming ${entry.bindingRef}`
      : `a ${entry.bindingType} bindingGrant covering ${entry.toolId}`;
  const holder = missing === 'role' ? 'the role that grants you this tool' : 'this client';
  return {
    authorized: false,
    posture: 'elevated',
    code: 'ELEVATED_GRANT_REQUIRED',
    reason,
    next: `This tool requires an elevated binding grant (${grantName}) on ${holder}. Ask the approver named on the grant's approval record to issue or renew it in approvals/; role scope alone does not cover it, and no plan was created for this call.`,
  };
}
