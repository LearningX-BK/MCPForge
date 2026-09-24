// MCPForge — `forge audit reverse <callId>`'s mechanism. W0-F5, 02 §3.1.4,
// 03 §7.5. Wave 0 exit criterion 7(a).
//
// The whole operation, in order, with nothing skipped:
//
//   1. read the ORIGINAL audit row (and its reversal links);
//   2. resolve the reversal contract — the row's frozen class and tool first,
//      the registry second (./construct.ts says why);
//   3. construct the reversing call by applying `argMap` to the original call's
//      recorded result keys, or refuse with a `next` a human can act on;
//   4. run that call through the FULL plan -> confirm sequence, via the
//      `ReversalExecutor` seam;
//   5. re-read the links so the report carries BOTH directions.
//
// Step 4 is the one that is easiest to get wrong and the one 03 §7.5 is most
// explicit about: **"A reversal is itself a write, so it runs the full plan ->
// confirm sequence. Same components, same rigour. It is not a shortcut, and the
// UI does not pretend it is."** There is no private path from here to the
// binding, no pre-minted token, and no way to reverse something the policy
// chain would refuse to let this caller do in the first place. The reversal is
// an ordinary call that happens to carry a `reverses_call_id`.

import type { ReversalClass } from '@mcpforge/shared';
import type { AuditRepository } from '../store/audit/types.js';
import { constructReversingCall, contractForCall } from './construct.js';
import { resultKeyMap } from './result-keys.js';
import type {
  ReversalRefusal,
  ReversalRegistry,
  ReversalReport,
  ReversalExecutor,
} from './types.js';

export interface ReverseCallDeps {
  readonly audit: AuditRepository;
  readonly registry: ReversalRegistry;
  /**
   * Absent means CONSTRUCT ONLY: the report carries the reversing call and its
   * arguments and nothing is executed. That is the honest Wave 0 default for a
   * CLI process that holds no gateway session, no binding executor and no
   * resolved human identity — and a constructed-but-unexecuted reversal is
   * useful on its own, because it is exactly what a human needs in order to
   * make the call themselves.
   */
  readonly executor?: ReversalExecutor;
  now?(): Date;
}

function notFound(callId: string): ReversalRefusal {
  return {
    ok: false,
    reason: 'call_not_found',
    message: `No audit call with id ${callId} exists in this store.`,
    next: `Check the call id. Use forge audit verify to confirm you are reading the right deployment's chain, or search the audit trail by the business key you are trying to reverse.`,
  };
}

function reportOf(
  overrides: Partial<ReversalReport> & Pick<ReversalReport, 'originalCallId' | 'originalToolId'>,
): ReversalReport {
  return {
    reversalClass: null,
    reversingToolId: null,
    resultKeys: {},
    reversingCall: null,
    executed: null,
    refusal: null,
    links: null,
    ...overrides,
  };
}

/**
 * Reverse one recorded call. Never throws for a business reason: a call that
 * cannot be reversed comes back as a `refusal` carrying a `next`, because
 * "there is no way back" is precisely the moment a caller most needs to be told
 * what to do instead (non-negotiable 5).
 */
export async function reverseCall(
  callId: string,
  deps: ReverseCallDeps,
): Promise<ReversalReport> {
  const now = deps.now?.() ?? new Date();
  const record = await deps.audit.get(callId);
  if (record === undefined) {
    return reportOf({
      originalCallId: callId,
      originalToolId: '(unknown)',
      refusal: notFound(callId),
    });
  }

  const links = await deps.audit.reversalLinks(callId);
  const contract = contractForCall(record, deps.registry);
  const keys = resultKeyMap(record.resultKeys);
  const base = reportOf({
    originalCallId: record.id,
    originalToolId: record.toolId,
    reversalClass: (record.reversalClass ?? contract?.class ?? null) as ReversalClass | null,
    reversingToolId: record.reversalToolId ?? contract?.tool ?? null,
    resultKeys: keys,
    links:
      links === undefined
        ? null
        : { reversesCallId: links.reversesCallId, reversedByCallId: links.reversedByCallId },
  });

  const constructed = constructReversingCall({
    record,
    contract,
    now,
    alreadyReversedBy: links?.reversedByCallId ?? null,
  });
  if (!constructed.ok) {
    return { ...base, refusal: constructed };
  }

  const reversingCall = { toolId: constructed.call.toolId, args: constructed.call.args };
  if (deps.executor === undefined) {
    return { ...base, reversingToolId: constructed.call.toolId, reversingCall };
  }

  const executed = await deps.executor.planAndConfirm({
    toolId: constructed.call.toolId,
    args: constructed.call.args,
    reversesCallId: record.id,
  });

  // Re-read AFTER the execute, so the report carries the edge as it now stands
  // in the trail rather than as it stood before the reversal existed.
  const after = await deps.audit.reversalLinks(callId);

  return {
    ...base,
    reversingToolId: constructed.call.toolId,
    reversingCall,
    executed,
    links:
      after === undefined
        ? base.links
        : { reversesCallId: after.reversesCallId, reversedByCallId: after.reversedByCallId },
  };
}
