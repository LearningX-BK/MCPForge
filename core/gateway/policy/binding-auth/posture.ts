// MCPForge — the two postures. W0-E3 (stage 6e′), 02 §11.4.
//
// CLAUDE.md non-negotiable #7: "Being in scope is not permission to execute an
// elevated binding. Catalogue membership is discovery; scope is visibility;
// NEITHER is permission."
//
// SCOPE OF THIS FILE UNDER W0-E3. This task owns the STAGE — that `6e′` exists,
// that it sits after `6e` and before `6f`, and that it refuses with
// `ELEVATED_GRANT_REQUIRED` before any plan token can be minted at `6g`.
// **W0-N3 owns the full rule set** that hangs off it (forced
// `humanApprovalRequired` on elevated writes, the `humanInTheLoop: false`
// refusal) and **W0-N4 owns `standingAuthorization`**. Neither is implemented
// here, and neither is stubbed in a way that would let an elevated call through:
// the posture test and the grant requirement are complete and fail-closed, and
// what W0-N3/N4 add can only ever narrow further.

import type { PolicyCatalogueEntry } from '../types.js';

/** 02 §11.4's two postures. */
export type BindingPosture = 'standard' | 'elevated';

export interface PostureVerdict {
  readonly posture: BindingPosture;
  /** Why, in words, for the refusal message and the audit trail. */
  readonly reason: string;
}

/**
 * 02 §11.4's table, read literally:
 *
 *   ELEVATED — `plsql`; `function`; any write-classified `wrapped-vendor` tool;
 *              any tool carrying a `policyException` (§11.4.7's one extension,
 *              regardless of binding type).
 *   STANDARD — `rest`; `database` (read-only by policy, §11.4.7); read-only
 *              `wrapped-vendor`.
 *
 * FAIL-CLOSED ON THE UNKNOWN. A binding type this build does not recognise is
 * ELEVATED. A new binding type must not become default-allow by the accident of
 * not appearing in a list written before it existed.
 */
export function bindingPosture(entry: PolicyCatalogueEntry): PostureVerdict {
  const exception = entry.policyException;
  if (typeof exception === 'string' && exception.trim().length > 0) {
    return {
      posture: 'elevated',
      reason: `${entry.toolId} carries policyException ${exception}; 02 §11.4.7 makes any tool with a policy exception elevated posture regardless of its binding type.`,
    };
  }

  switch (entry.bindingType) {
    case 'plsql':
    case 'function':
      return {
        posture: 'elevated',
        reason: `${entry.toolId} is a ${entry.bindingType} binding, which is elevated posture (02 §11.4).`,
      };
    case 'wrapped-vendor':
      return entry.write
        ? {
            posture: 'elevated',
            reason: `${entry.toolId} is a write-classified wrapped-vendor tool, which is elevated posture (02 §11.4).`,
          }
        : {
            posture: 'standard',
            reason: `${entry.toolId} is a read-only wrapped-vendor tool: standard posture, default-allow within scope (02 §11.4).`,
          };
    case 'rest':
      return {
        posture: 'standard',
        reason: `${entry.toolId} is a rest binding: standard posture, default-allow within scope (02 §11.4).`,
      };
    case 'database':
      // 02 §11.4.7: `database` stays standard posture because it has no write
      // path at all — the read-only rule is validate-time and structural
      // (W0-B3), and layering a grant model over a binding that cannot write is
      // ceremony this plan does not do. A `database` entry arriving here with
      // `write: true` is nevertheless treated as elevated: `forge validate`
      // should have rejected it, and a runtime that trusts validate to have run
      // is a runtime with a gap.
      return entry.write
        ? {
            posture: 'elevated',
            reason: `${entry.toolId} is a database binding marked write: true, which forge validate rejects (CLAUDE.md #3). It is treated as elevated posture here rather than trusted.`,
          }
        : {
            posture: 'standard',
            reason: `${entry.toolId} is a read-only database binding: standard posture (02 §11.4.7).`,
          };
    default:
      return {
        posture: 'elevated',
        reason: `${entry.toolId} declares binding type "${String(entry.bindingType)}", which this build does not recognise. An unrecognised binding type is elevated posture, never default-allow.`,
      };
  }
}
