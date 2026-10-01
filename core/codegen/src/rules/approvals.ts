// MCPForge — W0-P22: `policy.approval-not-self-approved`.
//
// W0-P4 §4 item 3: "an approval record whose `approver` equals its
// `requestedBy` fails validation. This is the one that matters most: approval
// records are git files, and a person can write one by hand without the
// portal." The portal's gates decide who may approve when the portal is used;
// this rule is what still holds when it is not.
//
// Owner decisions this rule implements, verbatim:
//   - W0-P4 §9 decision 3 (25-26 Sep 2026): "Admin can do though as both",
//     narrowed on 30 Sep 2026 (W0-P31/P32) from the `admin` persona to a super
//     admin: a persona is a lens, never a grant.
//   - 1 Oct 2026: "A: superAdminSubjects list (Recommended)". Group
//     membership lives in the identity provider, not in git, so this rule
//     cannot check `superAdmins:` (groups) against a record. It checks the
//     git-held `superAdminSubjects:` list in the overlay mappings instead.
//   - 1 Oct 2026: "The 17 existing record ids (Recommended)". The records
//     committed before this rule are grandfathered BY ID (not by date, which a
//     hand-written record could simply backdate) and report a warning.
//
// Outcomes for a record that names an approver (a record with no approver is
// a request, not an approval, and is not this rule's business):
//   - grandfathered id                                       -> WARNING
//   - approver or requestedBy is not a Principal.subject     -> FAIL
//   - approver == requestedBy, selfApproved: true, and the
//     approver is in a superAdminSubjects list               -> WARNING naming them
//   - approver == requestedBy otherwise                      -> FAIL
//   - selfApproved: true while approver != requestedBy       -> FAIL (the record contradicts itself)
//   - otherwise                                              -> clean
//
// requestedBy must be a subject too: comparing a subject with an email would
// let one person approve their own request under two spellings.

import { basename, dirname, join, relative } from 'node:path';
import type { RepoContext, ValidationFailure, ValidationRule } from '../validate/types.js';
import { fail, isRecord, readYaml, walkYamlFiles } from './helpers.js';

export const APPROVAL_NOT_SELF_APPROVED = 'policy.approval-not-self-approved';

/**
 * Every record under `approvals/` when this rule was introduced (1 Oct 2026),
 * by file basename. Closed: a record is never added here. They predate the
 * rule, so most name a display label (`Admin`) as approver and an email as
 * requester, which the rule cannot compare as identities.
 */
export const GRANDFATHERED_APPROVAL_IDS: ReadonlySet<string> = new Set([
  '2026-09-15-consumer-portal-local-register',
  '2026-09-15-hg6-jde-ap-voucher-cancel',
  '2026-09-15-hg6-jde-ap-voucher-create',
  '2026-09-15-hg6-jde-ap-voucher-get',
  '2026-09-15-hg6-jde-ap-voucher-search',
  '2026-09-15-hg6-jde-fin-batch-get_status',
  '2026-09-15-hg6-jde-fin-gl_journal-search',
  '2026-09-15-hg6-jde-fin-journal-create',
  '2026-09-15-hg6-jde-fin-journal-submit',
  '2026-09-15-hg6-jde-scm-purchase_order-approve',
  '2026-09-15-hg6-jde-scm-purchase_order-create',
  '2026-09-15-hg6-jde-scm-purchase_order-get_receipt_status',
  '2026-09-15-p2p-function-grant',
  '2026-09-15-p2p-function-standing',
  '2026-09-27-consumer-portal-local-rotate-credential-schedule',
  '2026-09-30-super-admin-function-grant',
  '2026-09-30-super-admin-function-standing',
]);

/**
 * A `Principal.subject`: `<provider>:<id>`. `local:` + UUIDv7 for the local
 * store; issuer-qualified `<providerId>:<sub>` for every other provider (W0-P4
 * §9 decision 1). A display label ("Admin", "Jane Doe") or a bare email is not
 * one.
 */
export const PRINCIPAL_SUBJECT_RE = /^[a-z][a-z0-9._-]*:\S+$/;

/**
 * The union of every `superAdminSubjects:` list in `overlays/<d>/mappings/`.
 * The gateway's mapping reader validates the field's shape (and refuses to
 * start on a malformed one); here anything that is not a non-empty string is
 * simply not a super admin, the fail-closed direction.
 */
export function loadSuperAdminSubjects(repoRoot: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const absPath of walkYamlFiles(join(repoRoot, 'overlays'))) {
    if (basename(dirname(absPath)) !== 'mappings') continue;
    const doc = readYaml(absPath);
    if (!isRecord(doc) || doc['kind'] !== 'GroupRoleMapping') continue;
    const list = doc['superAdminSubjects'];
    if (!Array.isArray(list)) continue;
    for (const s of list) if (typeof s === 'string' && s.length > 0) out.add(s);
  }
  return out;
}

function str(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  return typeof v === 'string' ? v.trim() : '';
}

function warn(file: string, path: string, message: string, fix: string): ValidationFailure {
  return { ...fail(APPROVAL_NOT_SELF_APPROVED, file, path, message, fix), severity: 'warning' };
}

const approvalNotSelfApproved: ValidationRule = {
  id: APPROVAL_NOT_SELF_APPROVED,
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    const superAdmins = loadSuperAdminSubjects(ctx.repoRoot);
    for (const absPath of walkYamlFiles(join(ctx.repoRoot, 'approvals')).sort()) {
      const file = relative(ctx.repoRoot, absPath).split(/[\\/]/).join('/');
      const base = basename(absPath).replace(/\.ya?ml$/, '');
      const doc = readYaml(absPath);
      if (!isRecord(doc)) continue;
      const approver = str(doc, 'approver');
      if (approver.length === 0) continue;
      const requestedBy = str(doc, 'requestedBy');
      const selfApproved = doc['selfApproved'] === true;

      if (GRANDFATHERED_APPROVAL_IDS.has(base)) {
        out.push(
          warn(
            file,
            '/approver',
            `Approval record ${base} predates ${APPROVAL_NOT_SELF_APPROVED} (W0-P22) and is grandfathered: approver ${JSON.stringify(approver)}, requestedBy ${JSON.stringify(requestedBy)}${selfApproved ? ', marked selfApproved' : ''}. The rule cannot compare these as identities.`,
            'No action needed to pass. To bring it under the rule, re-approve the change with a new record whose approver and requestedBy are Principal.subject values.',
          ),
        );
        continue;
      }

      if (!PRINCIPAL_SUBJECT_RE.test(approver)) {
        out.push(
          fail(
            APPROVAL_NOT_SELF_APPROVED,
            file,
            '/approver',
            `approver ${JSON.stringify(approver)} is not a Principal.subject (<provider>:<id>, e.g. local:<uuid>). A display label or an email cannot be compared with the requester, so the record cannot show it was not self-approved.`,
            "Write the approver's Principal.subject (forge identity bootstrap-admin prints it; the portal's Approve writes it), or approve the change in the portal.",
          ),
        );
        continue;
      }
      if (!PRINCIPAL_SUBJECT_RE.test(requestedBy)) {
        out.push(
          fail(
            APPROVAL_NOT_SELF_APPROVED,
            file,
            '/requestedBy',
            `requestedBy ${JSON.stringify(requestedBy)} is not a Principal.subject (<provider>:<id>). Comparing a subject with any other spelling would let one person approve their own request.`,
            "Write the requester's Principal.subject in requestedBy (the portal's Propose writes it), then have someone else approve.",
          ),
        );
        continue;
      }

      if (approver === requestedBy) {
        if (selfApproved && superAdmins.has(approver)) {
          out.push(
            warn(
              file,
              '/selfApproved',
              `Approval record ${base} is SELF-APPROVED by super admin ${approver} (allowed by owner decision W0-P32, always flagged).`,
              'No action needed to pass. If a second pair of eyes is wanted, have another approver re-approve it with a new record.',
            ),
          );
          continue;
        }
        out.push(
          fail(
            APPROVAL_NOT_SELF_APPROVED,
            file,
            selfApproved ? '/approver' : '/selfApproved',
            selfApproved
              ? `Approval record ${base} is self-approved by ${approver}, who is not listed in any superAdminSubjects: mapping. Only a super admin may approve their own request.`
              : `Approval record ${base} is approved by its own requester ${approver} and does not say so (no selfApproved: true).`,
            selfApproved
              ? 'Have a different approver approve the change (Approve in the portal), or add this subject to superAdminSubjects in overlays/<deployment>/mappings/groups-to-roles.yaml through a reviewed change if they are a super admin.'
              : 'Have a different approver approve the change (Approve in the portal). A super admin approving their own request must say so: the portal writes selfApproved: true.',
          ),
        );
        continue;
      }

      if (selfApproved) {
        out.push(
          fail(
            APPROVAL_NOT_SELF_APPROVED,
            file,
            '/selfApproved',
            `Approval record ${base} says selfApproved: true, but its approver ${approver} is not its requester ${requestedBy}. The record contradicts itself.`,
            'Remove selfApproved (a different approver approved it), or correct approver/requestedBy to the subjects who actually requested and approved.',
          ),
        );
      }
    }
    return out;
  },
};

export const APPROVAL_RULES: readonly ValidationRule[] = [approvalNotSelfApproved];
