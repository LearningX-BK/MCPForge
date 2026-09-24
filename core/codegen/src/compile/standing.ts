// MCPForge — resolving a `standingAuthorization` to its committed approval
// record, at COMPILE time. W0-N4, 02 §11.4.4 / 05 §3.3.4.
//
// 02 §11.4.4 states four properties, and this file owns two of them:
//
//   * "It is an **approval record in `approvals/`**, committed, with a named
//     approver" — so the ref must RESOLVE, and the record it resolves to must
//     carry an approver and an approval decision. A ref that names nothing is
//     not a standing authorization; it is a string.
//   * "It **expires** (default 180 days); renewal is a fresh approval" — so the
//     record carries its OWN `expiresAt`, separate from the grant's. The grant
//     expiring kills the grant (W0-E3's `grantIsLive`); the record expiring
//     kills only the standing authorization, and the call reverts to a per-call
//     approval rather than failing.
//
// The other two — "it appears in the compiled scope diff" and "it removes
// nothing else" — are owned by `compileGrant` (which embeds the block this
// file returns) and by the gateway's `binding-auth/standing.ts` respectively.
//
// **WHY THE RESOLUTION HAPPENS HERE AND NOT AT CALL TIME.** `approvals/` is
// git, and 02 §10.3's definitional/runtime split puts git-resident definitions
// on the codegen side: the gateway reads compiled artefacts, not the working
// tree. Resolving here also means granting a standing authorization changes
// `generated/roles/<id>.scope.json` — which is the third property, and it is
// only true if the resolved approver and expiry are IN the artefact rather
// than behind a string a reviewer must go and look up.
//
// The gateway does NOT trust `effective` blindly: it re-checks the expiry
// against the call's own clock (see `core/gateway/policy/binding-auth/standing.ts`),
// because a process running since before the expiry must not keep honouring
// it. Compile-time `effective: false` is authoritative when false; `true` is
// a claim the gateway re-tests.
//
// **NEEDS_HUMAN, restated rather than resolved (CLAUDE.md §8).** There is still
// no `approval.schema.json` and `Approval` is not one of the MANIFEST_KINDS —
// flagged by W0-B8 and again by W0-N1's `core/gateway/consumer/approval.ts`.
// This file therefore invents NO schema. It reads only fields that already
// exist in committed records in this repository (`id`, `approver`,
// `expiresAt`, `decision` / `status`) and it is fail-closed on every field it
// cannot read, so a later schema can only tighten what is accepted here.

import { join } from 'node:path';
import { isRecord, readYaml, walkYamlFiles } from '../rules/helpers.js';
import type { IsoDate } from './role.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The subset of a committed approval record this resolution needs. Everything
 * is optional because a record that omits a field must produce a REFUSAL, not
 * a parse error — a malformed record is a governance fact worth compiling
 * visibly, not a build crash.
 */
export interface ApprovalRecordView {
  readonly ref: string;
  readonly approver: string;
  readonly expiresAt: string;
  /** `decision:` (the committed-record convention) or `status:` (W0-N1's builder). */
  readonly decision: string;
}

function readString(doc: Record<string, unknown>, key: string): string {
  const v = doc[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Every approval record under `approvals/`, keyed by every ref that resolves to
 * it — its file basename and its explicit `id:`, exactly the convention
 * `rules/grants.ts` established for `policy.standing-authorization`. One
 * reader, so the validate rule and the compiler can never disagree about what
 * "resolvable" means.
 */
export function loadApprovalRecords(repoRoot: string): Map<string, ApprovalRecordView> {
  const out = new Map<string, ApprovalRecordView>();
  for (const absPath of walkYamlFiles(join(repoRoot, 'approvals'))) {
    const base = absPath
      .split(/[\\/]/)
      .pop()!
      .replace(/\.ya?ml$/, '');
    const doc = readYaml(absPath);
    const record = isRecord(doc) ? doc : {};
    const id = readString(record, 'id');
    const view: ApprovalRecordView = {
      ref: id.length > 0 ? id : base,
      approver: readString(record, 'approver'),
      expiresAt: readString(record, 'expiresAt'),
      // `decision:` is what the committed records use; `status:` is what
      // W0-N1's builder writes (as `pending`). Neither present -> '' -> refused.
      decision: readString(record, 'decision') || readString(record, 'status'),
    };
    out.set(base, view);
    if (id.length > 0) out.set(id, view);
  }
  return out;
}

/** Why a standing authorization is or is not in force. A closed set, so the artefact diffs cleanly. */
export type StandingStatus =
  /** Resolved to an approved record with a named approver and an unexpired own expiry. */
  | 'active'
  /** The ref names no committed record under `approvals/`. */
  | 'unresolved'
  /** The record carries no named approver. */
  | 'no-approver'
  /** The record carries no usable ISO `expiresAt`. */
  | 'no-expiry'
  /** The record is not an approval — pending, rejected, or silent about its decision. */
  | 'not-approved'
  /** The record's own `expiresAt` has passed. */
  | 'expired';

/** The block `compileGrant` embeds in the compiled artefact. */
export interface CompiledStandingAuthorization {
  readonly ref: string;
  readonly status: StandingStatus;
  /** '' when the record could not be read or names nobody. Never a placeholder. */
  readonly approver: string;
  /** The RECORD's own expiry, not the grant's. '' when unreadable. */
  readonly expiresAt: string;
  /**
   * True only for `status: 'active'`. The gateway re-checks `expiresAt` against
   * the call clock as well; `false` here is authoritative, `true` is a claim.
   */
  readonly effective: boolean;
}

/**
 * Resolve one `standingAuthorization` ref against the loaded records.
 *
 * FAIL-CLOSED AT EVERY BRANCH, and the fallback is never an open one: an
 * ineffective standing authorization means the elevated write reverts to a
 * FORCED PER-CALL APPROVAL (02 §11.4's "Approval" row), which is strictly
 * stricter than the tool's own default. There is no path through this function
 * that weakens anything.
 */
export function resolveStandingAuthorization(
  ref: string,
  records: ReadonlyMap<string, ApprovalRecordView>,
  today: IsoDate,
): CompiledStandingAuthorization {
  const key = ref.trim();
  const record = records.get(key);
  if (record === undefined) {
    return { ref: key, status: 'unresolved', approver: '', expiresAt: '', effective: false };
  }
  const base = { ref: key, approver: record.approver, expiresAt: record.expiresAt };
  if (record.approver.length === 0) {
    return { ...base, status: 'no-approver', effective: false };
  }
  if (record.decision !== 'approved') {
    return { ...base, status: 'not-approved', effective: false };
  }
  if (!ISO_DATE.test(record.expiresAt)) {
    return { ...base, status: 'no-expiry', effective: false };
  }
  if (record.expiresAt < today) {
    return { ...base, status: 'expired', effective: false };
  }
  return { ...base, status: 'active', effective: true };
}
