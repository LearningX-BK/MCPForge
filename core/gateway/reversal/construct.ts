// MCPForge — constructing the reversing call. W0-F5, 02 §3.1.4, 03 §7.5.
//
// 02 §3.1.4: "`forge audit reverse <callId>` … constructs the reversing call by
// applying `reversal.argMap` to the original call's result keys. That is how
// Wave 0 exit criterion 7(a) is demonstrated: **it is a one-command operation,
// not an improvised script.**"
//
// This file is the "applying" in that sentence, and nothing more. It does not
// execute, it does not mint, it does not touch the store. It turns an audit row
// plus a declared contract into a `{toolId, args}` — or into a refusal that
// names what a human must do instead.
//
// THE DIRECTION OF `argMap`, stated once so it is never read backwards:
//
//     argMap: { document_number: "$.result.document_number", … }
//              ^ the REVERSING tool's argument
//                            ^ a path into the ORIGINAL call's result keys
//
// So `jde.ap.voucher.create`'s argMap fills `jde.ap.voucher.cancel`'s arguments
// from the voucher that was actually created. W0-B7's generated contract test
// resolves the same map in the same direction against a real execute result;
// this is the runtime half of that same round trip.

import type { AuditCallRecord } from '../store/audit/types.js';
import { resultKeyMap } from './result-keys.js';
import type {
  ReversalConstruction,
  ReversalContract,
  ReversalRefusal,
  ReversalRegistry,
} from './types.js';

/** `"$.result.document_number"` -> `document_number`. Anything else -> null. */
export function resultKeyName(path: string): string | null {
  const matched = /^\$\.result\.([A-Za-z0-9_]+)$/.exec(path);
  return matched === null ? null : matched[1]!;
}

// The parameter is `nextAction`, not `next`, on purpose: `errors/site-scan.ts`
// reads a bare `next: string,` in a parameter list as a `next:` VALUE site and
// would report this signature as an unclassified construction. Naming it apart
// keeps the one real site — the object literal below — the only thing the
// enumeration sees, and the enumeration is the thing that guarantees every one
// of the nine refusal reasons carries an actionable `next` (non-negotiable 5).
function refuse(
  reason: ReversalRefusal['reason'],
  message: string,
  nextAction: string,
): ReversalRefusal {
  // One property per line, deliberately: `errors/site-scan.ts` enumerates a
  // `next:` value site only when the key starts its own line, and this helper
  // is the single site through which all nine refusal reasons pass. Collapsing
  // this object onto one line would hide the whole module from the no-dead-ends
  // enumeration.
  return {
    ok: false,
    reason,
    message,
    next: nextAction,
  };
}

/**
 * The contract to reverse a recorded call by.
 *
 * **The row wins over the registry, and that is deliberate.** `reversal_tool_id`
 * and `reversal_class` were frozen into the audit row at execute time; a
 * manifest edited since then declares a reversal for the tool as it is TODAY,
 * not for the call that was actually made. Where the row carries no frozen
 * class at all (a row written before W0-F5, or by a path that recorded none),
 * the registry is the only source there is and is used with that understood.
 */
export function contractForCall(
  record: AuditCallRecord,
  registry: ReversalRegistry,
): ReversalContract | undefined {
  const declared = registry.contractFor(record.toolId);
  if (record.reversalClass === null) {
    return declared;
  }
  const frozenClass = record.reversalClass as ReversalContract['class'];
  const frozenTool = record.reversalToolId;
  if (declared === undefined) {
    return frozenTool === null ? { class: frozenClass } : { class: frozenClass, tool: frozenTool };
  }
  return {
    ...declared,
    class: frozenClass,
    ...(frozenTool === null ? {} : { tool: frozenTool }),
  };
}

/**
 * Construct the reversing call for one recorded call, or refuse with a reason a
 * human can act on.
 *
 * `now` and `alreadyReversedBy` are parameters rather than lookups because this
 * function performs no I/O: the caller (`./reverse.ts`) has already read the
 * store and is the only place that should.
 */
export function constructReversingCall(input: {
  readonly record: AuditCallRecord;
  readonly contract: ReversalContract | undefined;
  readonly now: Date;
  /** From `AuditRepository.reversalLinks` — non-null means this was reversed already. */
  readonly alreadyReversedBy: string | null;
}): ReversalConstruction {
  const { record, contract, now, alreadyReversedBy } = input;

  if (!record.isWrite) {
    return refuse(
      'not_a_write',
      `Call ${record.id} is a read of ${record.toolId}. A read changed nothing, so there is nothing to reverse.`,
      `No action is needed. If you meant to reverse a change, find the write call instead: search the audit trail for the business key you are trying to undo.`,
    );
  }

  if (record.phase !== 'execute' || record.outcome !== 'ok') {
    return refuse(
      'not_executed',
      `Call ${record.id} of ${record.toolId} is recorded as phase "${record.phase}" with outcome "${record.outcome}", so no change was committed at the target and there is nothing to reverse.`,
      `Do not construct a reversal for this call. If you are unsure whether the target committed anything, use ${targetTail(record.toolId)}.get or .get_status to establish the current state, and act on that answer.`,
    );
  }

  if (alreadyReversedBy !== null) {
    return refuse(
      'already_reversed',
      `Call ${record.id} of ${record.toolId} was already reversed by call ${alreadyReversedBy}.`,
      `No action is needed. Open call ${alreadyReversedBy} in the audit trail to see the reversal that was made; do not reverse the same write twice.`,
    );
  }

  if (contract === undefined) {
    return refuse(
      'no_reversing_tool',
      `No reversal contract is recorded for call ${record.id} of ${record.toolId}, so the way back cannot be constructed.`,
      `Ask the MCPForge operator to check that ${record.toolId}'s manifest declares a writeSafety.reversal block and that this deployment's catalogue was regenerated. Meanwhile, undo the change directly in the target system and record what was done.`,
    );
  }

  if (contract.class === 'irreversible') {
    // 03 §7.5: the reason goes IN PLACE OF a tooltip. The same words that
    // disable the portal button are the words returned here.
    return refuse(
      'irreversible',
      `${record.toolId} declares reversal.class: irreversible. Nothing in MCPForge undoes call ${record.id} — the effect has left the system.`,
      `Do not attempt a reversal through MCPForge. Tell the human this change cannot be undone by a tool, and that unwinding it is a manual action in ${record.targetSystem ?? 'the target system'} by whoever owns that process.`,
    );
  }

  if (contract.class === 'transactional') {
    return refuse(
      'no_reversing_tool',
      `${record.toolId} declares reversal.class: transactional — the wrapper rolls the unit of work back BEFORE commit, so once call ${record.id} committed there is no separate reversing call to make.`,
      `Do not construct a reversal call. Establish the committed state with ${targetTail(record.toolId)}.get, and if it must be undone, ask the module steward for the compensating action in ${record.targetSystem ?? 'the target system'}.`,
    );
  }

  const reversingToolId = contract.tool;
  if (reversingToolId === undefined || reversingToolId.length === 0) {
    return refuse(
      'no_reversing_tool',
      `${record.toolId} declares reversal.class: ${contract.class} but names no reversing tool, so call ${record.id} cannot be reversed automatically.`,
      `Ask the MCPForge operator to add writeSafety.reversal.tool to ${record.toolId}'s manifest and re-run forge validate. Until then, undo the change in ${record.targetSystem ?? 'the target system'} directly.`,
    );
  }

  const argMap = contract.argMap ?? {};
  const argNames = Object.keys(argMap);
  if (argNames.length === 0) {
    return refuse(
      'no_arg_map',
      `${record.toolId} names ${reversingToolId} as its reversing tool but declares no reversal.argMap, so the business keys from call ${record.id} cannot be turned into that tool's arguments.`,
      `Ask the MCPForge operator to add writeSafety.reversal.argMap to ${record.toolId}'s manifest, mapping each of ${reversingToolId}'s arguments to a "$.result.<key>" path. Then run forge audit reverse ${record.id} again.`,
    );
  }

  const keys = resultKeyMap(record.resultKeys);
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const argName of argNames) {
    const path = argMap[argName]!;
    const keyName = resultKeyName(path);
    // A path shape this repo's manifests do not use is treated as missing
    // rather than guessed at: constructing a write out of a value we are not
    // sure we read correctly is the one thing this module must never do.
    const value = keyName === null ? undefined : keys[keyName];
    if (value === undefined) {
      missing.push(`${argName} <- ${path}`);
      continue;
    }
    args[argName] = value;
  }

  if (missing.length > 0) {
    return refuse(
      'missing_result_key',
      `Call ${record.id} did not record the business key(s) ${reversingToolId} needs: ${missing.join(', ')}. Without them the reversing call would be constructed from guesses.`,
      `Do not call ${reversingToolId} with invented arguments. Find the record in ${record.targetSystem ?? 'the target system'} using the keys call ${record.id} DID record (${Object.keys(keys).join(', ') || 'none'}), and reverse it with the values you read there.`,
    );
  }

  const windowHours = contract.windowHours;
  if (windowHours !== undefined && windowHours > 0) {
    const deadline = new Date(new Date(record.ts).getTime() + windowHours * 3600 * 1000);
    if (now.getTime() > deadline.getTime()) {
      return refuse(
        'window_expired',
        `The reversal window for ${record.toolId} is ${windowHours} hours and closed at ${deadline.toISOString()}; call ${record.id} was made at ${record.ts}.`,
        `Do not call ${reversingToolId} — it will be refused by the target. Tell the human the automatic reversal window has closed and that unwinding this change is now a manual action in ${record.targetSystem ?? 'the target system'}.`,
      );
    }
  }

  return { ok: true, call: { toolId: reversingToolId, args, reversesCallId: record.id, contract } };
}

/** `jde.ap.voucher.create` -> `jde.ap.voucher`, so a `next` can name a sibling. */
function targetTail(toolId: string): string {
  return toolId.replace(/\.[^.]+$/, '');
}
