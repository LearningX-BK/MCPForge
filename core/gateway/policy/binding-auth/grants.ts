// MCPForge — is there a live, named, expiring, approval-recorded bindingGrant
// for this call? W0-E3 (stage 6e′), 02 §11.4.
//
// Every property below is fail-closed, and each one is fail-closed for a stated
// reason rather than as a habit:
//
//  * **An absent grant refuses.** Scope membership is never a grant (#7).
//  * **An unparseable or absent `expiresAt` refuses.** A grant that cannot say
//    when it ends has already ended — the same reading codegen's
//    `grantIsExpired` takes at compile time, applied again at call time because
//    a long-running process must not keep honouring a grant that expired while
//    it was up.
//  * **An expired grant refuses**, including one the artefact already marked
//    `expired: true` (W0-B8 emits dead grants rather than dropping them, so an
//    auditor can see them; the gateway must not honour them).
//  * **A grant with no `approvalRef` or no `approver` refuses.** "Named,
//    approval-recorded" is part of what a grant IS (#7), not metadata about it.
//  * **The grant must come from a role the caller HOLDS and which grants this
//    tool.** A grant on a role the human does not hold is not the human's.
//
// FLAGGED INFERENCE (CLAUDE.md §8). 02 §11.4 says a `plsql` grant "additionally
// names the wrapper package (`MCPFORGE_WRAP.<PKG>`); for `function`, the
// orchestration family", and W0-B3's `policy.plsql-grant-wrapper-package` rule
// enforces that shape on the grant. **No document states which TOOL field the
// name is matched against.** This module matches `bindingGrant.names` against
// the tool's `binding.ref` — the allowlisted target name (02 §2.2), which for a
// `plsql` binding IS the wrapper package (02 §3.4) and for a `function` binding
// is the orchestration. It is the only field that carries that value, so the
// inference is narrow, but it is an inference on the security spine and it is
// named in this task's report for a human to confirm.
//
// A grant with an EMPTY `names` list authorizes the binding type without naming
// a target. That is permitted for binding types whose grants carry no name
// (W0-B3 requires the name for `plsql` only), and it is deliberately NOT read
// as a wildcard for a `plsql` grant: a `plsql` grant with no names matches
// nothing here.

import type { CompiledBindingGrant, PolicyCatalogueEntry } from '../types.js';

export interface GrantSource {
  /** `role:<id>` or `consumer:<id>` — named so the refusal can say whose grant is missing. */
  readonly holder: string;
  readonly grants: readonly CompiledBindingGrant[];
}

export interface GrantMatch {
  readonly holder: string;
  readonly grant: CompiledBindingGrant;
}

export type GrantLookup =
  | { readonly found: true; readonly match: GrantMatch }
  | { readonly found: false; readonly reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this grant live at `now`? Mirrors codegen's `grantIsExpired` exactly, and
 * treats a malformed or absent date as expired.
 */
export function grantIsLive(grant: CompiledBindingGrant, now: Date): boolean {
  if (grant.expired === true) return false;
  const expiresAt = grant.expiresAt;
  if (typeof expiresAt !== 'string' || !ISO_DATE.test(expiresAt)) return false;
  return expiresAt >= now.toISOString().slice(0, 10);
}

/** Is this grant recorded — a named approver and a resolvable approval record? */
export function grantIsRecorded(grant: CompiledBindingGrant): boolean {
  return (
    typeof grant.approvalRef === 'string' &&
    grant.approvalRef.trim().length > 0 &&
    typeof grant.approver === 'string' &&
    grant.approver.trim().length > 0
  );
}

/**
 * Does this grant name the target this tool binds to? `plsql` grants MUST name
 * it (02 §11.4.3); for every other elevated type an unnamed grant covers the
 * binding type.
 */
export function grantNamesTarget(
  grant: CompiledBindingGrant,
  entry: PolicyCatalogueEntry,
): boolean {
  const names = Array.isArray(grant.names) ? grant.names : [];
  if (names.length === 0) return entry.bindingType !== 'plsql';
  return names.includes(entry.bindingRef);
}

/** The first live, recorded, correctly-named grant for this entry, or why there is none. */
export function findBindingGrant(
  sources: readonly GrantSource[],
  entry: PolicyCatalogueEntry,
  now: Date,
): GrantLookup {
  let sawBindingType = false;
  let sawExpired = false;
  let sawUnrecorded = false;
  let sawWrongName = false;

  for (const source of sources) {
    for (const grant of source.grants) {
      if (grant.bindingType !== entry.bindingType) continue;
      sawBindingType = true;
      if (!grantIsLive(grant, now)) {
        sawExpired = true;
        continue;
      }
      if (!grantIsRecorded(grant)) {
        sawUnrecorded = true;
        continue;
      }
      if (!grantNamesTarget(grant, entry)) {
        sawWrongName = true;
        continue;
      }
      return { found: true, match: { holder: source.holder, grant } };
    }
  }

  if (!sawBindingType) {
    return {
      found: false,
      reason: `no bindingGrant for binding type ${entry.bindingType} is held by ${describeHolders(sources)}`,
    };
  }
  if (sawWrongName) {
    return {
      found: false,
      reason: `a bindingGrant for ${entry.bindingType} exists but names no target matching ${entry.bindingRef}`,
    };
  }
  if (sawExpired) {
    return {
      found: false,
      reason: `every bindingGrant for ${entry.bindingType} held here has expired; renewal is a re-approval, not a rollover`,
    };
  }
  if (sawUnrecorded) {
    return {
      found: false,
      reason: `a bindingGrant for ${entry.bindingType} exists but carries no approval record and named approver, so it is not a grant`,
    };
  }
  return {
    found: false,
    reason: `no usable bindingGrant for binding type ${entry.bindingType}`,
  };
}

function describeHolders(sources: readonly GrantSource[]): string {
  const holders = sources.map((s) => s.holder);
  return holders.length === 0 ? 'this session' : holders.join(', ');
}
