// MCPForge — W0-B3 write-safety policy rules. CLAUDE.md non-negotiable #4,
// 02 §2.2's validate list, 02 §3.1.
//
//   policy.write-safety-incomplete  — write: true requires a COMPLETE writeSafety
//                                     block with a non-`none` dry-run strategy
//                                     and a reversal.class.
//   policy.irreversible-approval    — reversal.class: irreversible forces
//                                     humanApprovalRequired: true AND
//                                     governance.reviewPath: standard.

import type { RepoContext, ValidationFailure, ValidationRule } from '../validate/types.js';
import { fail, get, isRecord, tools } from './helpers.js';

/**
 * A write tool that can be fired in one call is a bug (CLAUDE.md #4). The
 * block must exist and must carry both halves of the round trip that make a
 * write reviewable: a dry run that really runs, and a declared reversal class.
 *
 * `none` is checked explicitly even though the schema's `dryRun.strategy`
 * enum omits it — the schema can be edited, and this rule is the statement of
 * the policy rather than a restatement of the schema.
 */
const writeSafetyComplete: ValidationRule = {
  id: 'policy.write-safety-incomplete',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (m.doc['write'] !== true) continue;
      const ws = m.doc['writeSafety'];
      if (!isRecord(ws)) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety',
            'write: true with no writeSafety block. Every write tool goes through plan/dry-run -> confirm bound to a canonical argument hash -> execute -> immutable audit -> a declared reversal (CLAUDE.md #4).',
            'Add a complete writeSafety block: dryRun.strategy (never "none"), confirm.required: true with a tokenTtlSeconds and a planTemplate naming the business consequence, humanApprovalRequired, reversal.class, and idempotency.scopeHours.',
          ),
        );
        continue;
      }

      const strategy = get(ws, 'dryRun', 'strategy');
      if (typeof strategy !== 'string' || strategy.length === 0) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety/dryRun/strategy',
            'write: true with no dry-run strategy. The plan step is what the confirmation is bound to; without it the tool can be fired in one call.',
            'Set writeSafety.dryRun.strategy to one of native | validate-pair | precondition-read | shadow-write | transactional, per the binding type (02 §3.1, §3.5).',
          ),
        );
      } else if (strategy === 'none') {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety/dryRun/strategy',
            'dryRun.strategy: none on a write tool. A write tool\'s dry-run strategy may never be "none" (CLAUDE.md #4).',
            'Choose a real strategy: validate-pair where the steward can author an X_VALIDATE form, otherwise precondition-read (and note that precondition-read forces humanApprovalRequired: true for sensitivity: financial — 02 §3.5).',
          ),
        );
      }

      const reversalClass = get(ws, 'reversal', 'class');
      if (typeof reversalClass !== 'string' || reversalClass.length === 0) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety/reversal/class',
            'write: true with no reversal.class. A write with no declared reversal is a write nobody can undo.',
            'Set writeSafety.reversal.class to native-reverse | compensating-tool | transactional | irreversible. compensating-tool additionally requires reversal.tool naming the reversing tool id.',
          ),
        );
      }
    }
    return out;
  },
};

/**
 * 02 §2.2: `reversal.class: irreversible` requires `humanApprovalRequired: true`
 * and `reviewPath: standard`. An irreversible write is exactly the case where
 * the expedited path must not exist.
 */
const irreversibleForcesApprovalAndStandardReview: ValidationRule = {
  id: 'policy.irreversible-approval',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (get(m.doc, 'writeSafety', 'reversal', 'class') !== 'irreversible') continue;

      if (get(m.doc, 'writeSafety', 'humanApprovalRequired') !== true) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety/humanApprovalRequired',
            'reversal.class: irreversible without humanApprovalRequired: true. Nothing undoes this call, so a human must approve it out of band before a confirm token is minted (02 §2.2).',
            'Set writeSafety.humanApprovalRequired: true, or declare a real reversal class (native-reverse, compensating-tool or transactional) if one genuinely exists.',
          ),
        );
      }

      const reviewPath = get(m.doc, 'governance', 'reviewPath');
      if (reviewPath !== undefined && reviewPath !== 'standard') {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/governance/reviewPath',
            `reversal.class: irreversible with governance.reviewPath: ${String(reviewPath)}. Expedited review is structurally unavailable for irreversible writes (02 §2.2).`,
            'Set governance.reviewPath: standard and take this manifest through the full review.',
          ),
        );
      }
    }
    return out;
  },
};

export const WRITE_SAFETY_RULES: readonly ValidationRule[] = [
  writeSafetyComplete,
  irreversibleForcesApprovalAndStandardReview,
];
