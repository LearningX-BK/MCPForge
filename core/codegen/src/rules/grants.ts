// MCPForge — W0-B3 [P5] binding-grant and consumer rules. CLAUDE.md
// non-negotiables #6, #7 and #8; 02 §11.2, §11.4.3, §11.4.4, §11.5.
//
//   policy.plsql-grant-wrapper-package — a bindingGrant on plsql must name a
//        wrapper package matching ^MCPFORGE_WRAP\.[A-Z0-9_]+$
//   policy.standing-authorization      — a standingAuthorization without a
//        resolvable approvalRef and an expiresAt is rejected
//   policy.consumer-credential-ref     — a Consumer credential.ref that is not
//        a secretRef:// URI is rejected
//
// Being in scope is not permission to execute an elevated binding. Catalogue
// membership is discovery; scope is visibility; neither is permission.

import type {
  IndexedManifest,
  RepoContext,
  ValidationFailure,
  ValidationRule,
} from '../validate/types.js';
import { fail, isRecord, manifestsOfKind } from './helpers.js';
import { loadApprovalRecords } from '../compile/standing.js';

/** 02 §11.4.3 — for plsql the grant names the wrapper PACKAGE, the same unit the database EXECUTE grant uses. */
export const WRAPPER_PACKAGE_RE = /^MCPFORGE_WRAP\.[A-Z0-9_]+$/;

/**
 * Approval records committed under `approvals/` (02 §2.5). A record is
 * resolvable by its file basename or by an explicit `id:` inside it — the same
 * convention loadEnumNames uses for enums/. This is an implementation detail
 * the plan leaves open; it is chosen here to match the existing precedent.
 */
export function loadApprovalRefs(repoRoot: string): Set<string> {
  // [W0-N4] ONE reader of `approvals/`, shared with compilation
  // (compile/standing.ts). Two readers of one artefact is how a validate rule
  // and a compiler come to disagree about whether a ref resolves — and the
  // disagreement that matters here is "validate passed, so the standing
  // authorization is real", which must never be true while the compiler
  // silently resolved it to nothing.
  return new Set(loadApprovalRecords(repoRoot).keys());
}

/** Every bindingGrant on a Role or a Consumer, with its JSON pointer. */
function bindingGrants(
  ctx: RepoContext,
): { manifest: IndexedManifest; grant: Record<string, unknown>; pointer: string }[] {
  const out: { manifest: IndexedManifest; grant: Record<string, unknown>; pointer: string }[] = [];
  for (const kind of ['Role', 'Consumer'] as const) {
    for (const manifest of manifestsOfKind(ctx, kind)) {
      const grants = manifest.doc['bindingGrants'];
      if (!Array.isArray(grants)) continue;
      grants.forEach((grant, i) => {
        if (!isRecord(grant)) return;
        out.push({ manifest, grant, pointer: `/bindingGrants/${i}` });
      });
    }
  }
  return out;
}

const plsqlGrantNamesWrapperPackage: ValidationRule = {
  id: 'policy.plsql-grant-wrapper-package',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const { manifest, grant, pointer } of bindingGrants(ctx)) {
      if (grant['bindingType'] !== 'plsql') continue;
      const names = grant['names'];
      if (!Array.isArray(names) || names.length === 0) {
        out.push(
          fail(
            this.id,
            manifest.file.file,
            `${pointer}/names`,
            'A plsql bindingGrant names no wrapper package. An unnamed elevated grant is a grant over every wrapper package at once, which is the escalation CLAUDE.md #7 exists to prevent (02 §11.4.3).',
            'Add names: [MCPFORGE_WRAP.<PACKAGE>] naming exactly the wrapper packages this grant covers — the same unit the database-side EXECUTE grant uses, so the two are independent statements of one fact.',
          ),
        );
        continue;
      }
      names.forEach((name, i) => {
        if (typeof name === 'string' && WRAPPER_PACKAGE_RE.test(name)) return;
        out.push(
          fail(
            this.id,
            manifest.file.file,
            `${pointer}/names/${i}`,
            `plsql bindingGrant name ${JSON.stringify(name)} does not match ^MCPFORGE_WRAP\\.[A-Z0-9_]+$. A gateway grant must name a wrapper package, never an APPS-owned package (02 §11.4.3, §3.4).`,
            'Rewrite the entry as MCPFORGE_WRAP.<PACKAGE>. If the database holds no EXECUTE grant on that wrapper, the probe will report the mismatch per tool with its owning team — fix the grant, do not widen it.',
          ),
        );
      });
    }
    return out;
  },
};

/**
 * 02 §11.4.4. The standing authorization is what stops the elevated posture
 * forcing per-call human approval on all six Wave 0 write tools — and the two
 * named failure modes are forgetting it entirely, and shipping it without the
 * recorded, expiring approval that keeps it from being decoration.
 */
const standingAuthorizationIsRecordedAndExpires: ValidationRule = {
  id: 'policy.standing-authorization',
  check(ctx: RepoContext): ValidationFailure[] {
    const approvals = loadApprovalRefs(ctx.repoRoot);
    const out: ValidationFailure[] = [];
    for (const { manifest, grant, pointer } of bindingGrants(ctx)) {
      const standing = grant['standingAuthorization'];
      if (standing === undefined) continue;

      if (typeof standing !== 'string' || !approvals.has(standing.trim())) {
        out.push(
          fail(
            this.id,
            manifest.file.file,
            `${pointer}/standingAuthorization`,
            `standingAuthorization ${JSON.stringify(standing)} does not resolve to a committed approval record under approvals/. A standing authorization to execute elevated writes without per-call approval is exactly the decision that must be recorded with a named approver (02 §11.4.4).`,
            'Commit the approval record as approvals/<ref>.yaml with its named approver and its expiry, then name it here. If nobody has approved it, the answer is a per-call approval, not an unrecorded standing one.',
          ),
        );
      }

      const expiresAt = grant['expiresAt'];
      if (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
        out.push(
          fail(
            this.id,
            manifest.file.file,
            `${pointer}/expiresAt`,
            `A grant carrying a standingAuthorization has expiresAt ${JSON.stringify(expiresAt)}. Grants expire — default 180 days — and renewal is a fresh approval, never a rollover (02 §11.4.4). A standing authorization that never expires is a permanent bypass of per-call approval.`,
            "Set expiresAt to an ISO date (YYYY-MM-DD) no more than 180 days out, matching the approval record's own expiry.",
          ),
        );
      }
    }
    return out;
  },
};

/**
 * 02 §11.5 / CLAUDE.md #8. A credential is a secretRef://. No secret value ever
 * appears in git, and a consumer record is git. The schema already types this
 * field as a secretRef; the rule states the policy independently so that it
 * still fires on a document the schema pass could not fully read.
 */
const consumerCredentialIsASecretRef: ValidationRule = {
  id: 'policy.consumer-credential-ref',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of manifestsOfKind(ctx, 'Consumer')) {
      const credential = m.doc['credential'];
      if (!isRecord(credential)) continue;
      const ref = credential['ref'];
      if (typeof ref === 'string' && ref.startsWith('secretRef://')) continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/credential/ref',
          `Consumer credential.ref is ${JSON.stringify(ref)}, which is not a secretRef:// URI. A credential is a REFERENCE, never a value — not in git, not in a consumer record, not in a log line, not in a portal screen (CLAUDE.md #8, 02 §11.5).`,
          'Replace it with secretRef://consumer/<consumer-id>/client and put the value in the SecretStore (forge consumer issue-credential <id> prints it once). If a real secret was ever committed here, rotate it with forge secrets rotate before anything else.',
        ),
      );
    }
    return out;
  },
};

export const GRANT_RULES: readonly ValidationRule[] = [
  plsqlGrantNamesWrapperPackage,
  standingAuthorizationIsRecordedAndExpires,
  consumerCredentialIsASecretRef,
];
