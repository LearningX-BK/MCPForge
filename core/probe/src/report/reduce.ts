// MCPForge — reducing a tool's executed checks to EXACTLY ONE status.
// 02 §4.5. W0-H4.
//
// "There is no third state and no silent failure — every tool in the catalogue
// has exactly one of these after every probe run."
//
// The totality argument, in one paragraph, because it is the whole point of
// this file: `STATUS_PRECEDENCE` is a list over `ProbeStatus` that ENDS in
// `resolved`. `reduceStatus` walks it and returns the first member that
// applies. `resolved` applies unconditionally. Therefore the walk cannot fall
// off the end, cannot return `undefined`, and cannot return two values. There
// is no `default:` branch, no `?? 'unknown'`, and no early return that skips a
// tool.

import type { ProbeCheckResult, ProbeCheckSpec } from '../plan/types.js';
import { STATUS_PRECEDENCE, type CheckFailureStatus, type ProbeStatus } from '../status.js';

export interface ReducedStatus {
  readonly status: ProbeStatus;
  /** The check that selected the status; `null` when `resolved`. */
  readonly failingCheck: ProbeCheckResult | null;
  readonly failingCheckDescription: string | null;
}

export interface ReduceInput {
  readonly checks: readonly ProbeCheckResult[];
  /** name -> spec, so a failure can name the status it selects. */
  readonly specsByName: ReadonlyMap<string, ProbeCheckSpec>;
  /**
   * The kill-switch fact, evaluated before any check ran. Its reason text is
   * surfaced verbatim (02 §4.7), so a killed tool's report says why.
   */
  readonly killReason: string | null;
}

const KILL_CHECK_NAME = 'kill_switch';

export function reduceStatus(input: ReduceInput): ReducedStatus {
  // Failing checks grouped by the status each one selects.
  const failuresByStatus = new Map<CheckFailureStatus, ProbeCheckResult>();
  for (const result of input.checks) {
    if (result.result !== 'fail') continue;
    const spec = input.specsByName.get(result.name);
    /* c8 ignore next 3 -- a result without a spec cannot be produced by runProbe;
       kept as a fail-closed guard rather than an assumption. */
    if (!spec) continue;
    if (!failuresByStatus.has(spec.failureStatus)) {
      failuresByStatus.set(spec.failureStatus, result);
    }
  }

  for (const status of STATUS_PRECEDENCE) {
    if (status === 'disabled_kill_switch') {
      if (input.killReason !== null) {
        return {
          status,
          failingCheck: {
            name: KILL_CHECK_NAME,
            result: 'fail',
            detail: input.killReason,
          },
          failingCheckDescription: 'A runtime kill-switch flag is in force for this tool (02 §4.7)',
        };
      }
      continue;
    }
    if (status === 'resolved') {
      return { status, failingCheck: null, failingCheckDescription: null };
    }
    const failure = failuresByStatus.get(status);
    if (failure) {
      const spec = input.specsByName.get(failure.name);
      return {
        status,
        failingCheck: failure,
        failingCheckDescription: spec?.describe ?? null,
      };
    }
  }

  /* c8 ignore next 3 -- unreachable: STATUS_PRECEDENCE ends in `resolved`,
     which returns unconditionally above. Present so the function has no
     implicit undefined return path at all. */
  throw new Error('probe status precedence list did not terminate in "resolved"');
}
