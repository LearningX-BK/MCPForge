// MCPForge — validate-pair presence, per write tool, in the enablement backlog.
// W0-H2, the probe half. 02 §3.5, 01 §10.5 item 2.
//
// The probe already RUNS the check (`validate_sibling`, in the frozen check
// catalogue, dispatched by `run/function-executor.ts`). What this file adds is
// the REPORT of it: a per-tool block that says which sibling was looked for,
// whether it was found, what the dry run therefore degrades to, whether human
// approval is consequently forced, and — the clause that makes it a backlog
// entry rather than a diagnostic — what the owning team must do about it.
//
// One rule governs every branch here: `present` is true ONLY on a passed check.
// A failed check, a check that never ran because no executor is registered, and
// a check whose executor errored all report `present: false`. The consumer is
// `adapters/function`'s ladder, which degrades on anything that is not a
// positive confirmation — so an optimistic value here would be the one place a
// missing pair could silently become a present one.

import type { ProbeCheckResult } from '../plan/types.js';
import { VALIDATE_SUFFIX } from '../run/function-executor.js';
import type { ValidatePairReport } from './types.js';

// 02 §3.5's sibling naming convention is imported, not restated: the name this
// block REPORTS must be the name `run/function-executor.ts` actually
// DISPATCHED. Two copies of the suffix would let the report and the check drift.
export { VALIDATE_SUFFIX };

/** The check whose outcome this block reports. From the frozen catalogue. */
export const VALIDATE_SIBLING_CHECK = 'validate_sibling';

/** The sensitivity for which a missing pair forces human approval. 02 §3.5. */
export const APPROVAL_FORCING_SENSITIVITY = 'financial';

export interface ValidatePairInput {
  readonly toolId: string;
  /** `binding.ref`. Empty when the caller supplied no manifest detail. */
  readonly ref: string;
  readonly sensitivity: string | null;
  readonly owningTeam: string;
  /** The executed checks for this tool. */
  readonly checks: readonly ProbeCheckResult[];
}

export function buildValidatePairReport(input: ValidatePairInput): ValidatePairReport {
  const expectedRef =
    input.ref.trim().length > 0 ? `${input.ref.trim()}${VALIDATE_SUFFIX}` : null;
  const check = input.checks.find((c) => c.name === VALIDATE_SIBLING_CHECK);

  // `=== 'pass'` and nothing looser. `not_applicable` is not a presence claim.
  const present = check?.result === 'pass';
  const evidence: ValidatePairReport['evidence'] = check === undefined ? 'not_probed' : 'probe_check';

  const detail =
    check?.detail ??
    `the ${VALIDATE_SIBLING_CHECK} check did not run for ${input.toolId}, so the existence of its dry-run sibling is UNKNOWN and is treated as absent`;

  const humanApprovalForced = !present && input.sensitivity === APPROVAL_FORCING_SENSITIVITY;

  return {
    expectedRef,
    present,
    evidence,
    detail,
    effectiveDryRunStrategy: present ? 'validate-pair' : 'precondition-read',
    humanApprovalForced,
    enablementAction: present
      ? null
      : `${input.owningTeam}: author the ${expectedRef ?? `${input.toolId} dry-run`} sibling orchestration — the same form-service validations as the EXECUTE form with the final submit step branched out, returning the same error structure (02 §3.5) — then re-run \`forge probe\`. ` +
        `Until it exists, ${input.toolId}'s dry run degrades to precondition-read` +
        (humanApprovalForced
          ? ` and human approval is FORCED for every execution because this tool is sensitivity "${APPROVAL_FORCING_SENSITIVITY}".`
          : `.`),
  };
}
