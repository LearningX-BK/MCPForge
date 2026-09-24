// MCPForge — adapter-side translation of `function` binding failures onto the
// CLOSED error taxonomy (02 §3.1.5). This file may only IMPORT the taxonomy
// from @mcpforge/shared; it never adds a code and never edits
// core/gateway/errors/**.
//
// Every construction below goes through `forgeError`, which refuses an empty
// `next` — CLAUDE.md non-negotiable #5 is therefore structural here too.

import { ForgeError, forgeError, type ForgeErrorOverrides } from '@mcpforge/shared/errors';
import type { FunctionBindingDescriptor } from './types.js';

/** The `.get`/`.get_status` counterpart an agent should reach for. */
function statusCounterpart(descriptor: FunctionBindingDescriptor): string {
  const parts = descriptor.toolId.split('.');
  if (parts.length < 2) return `${descriptor.toolId} (get_status counterpart)`;
  parts[parts.length - 1] = 'get_status';
  return parts.join('.');
}

export function inputInvalid(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  detail: string,
): ForgeError {
  return forgeError(
    'INPUT_INVALID',
    `${descriptor.toolId}: arguments failed validation against the generated schema — ${detail}`,
    correlationId,
    {
      next: `Correct ${detail} and call ${descriptor.toolId} again; the generated schema is the contract and no argument outside it reaches the target.`,
    },
  );
}

export function targetTimeout(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
): ForgeError {
  return forgeError(
    'TARGET_TIMEOUT',
    `${descriptor.toolId}: orchestration ${descriptor.ref} exceeded binding.execution.timeoutMs (${descriptor.execution.timeoutMs} ms). The outcome is UNKNOWN.`,
    correlationId,
    {
      next: descriptor.write
        ? `Do NOT re-issue this write. Call ${statusCounterpart(descriptor)} to determine whether the orchestration completed, then act on that answer.`
        : `Call ${descriptor.toolId} again with a narrower request; if it times out again, report the correlationId to the owning team.`,
    },
  );
}

/**
 * The response size cap. `ROW_CAP_EXCEEDED` is the taxonomy's cap code ("the
 * result set exceeded the mandatory cap for this binding") — the condition and
 * next are overridden here to name the byte cap rather than a row cap, because
 * an AIS orchestration returns a document, not rows. JUDGMENT CALL, documented:
 * the taxonomy is closed and this is the code it closes over for a cap breach;
 * inventing a code would break that closure.
 */
export function responseTooLarge(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  bytes: number,
): ForgeError {
  return forgeError(
    'ROW_CAP_EXCEEDED',
    `${descriptor.toolId}: orchestration ${descriptor.ref} returned ${bytes} bytes, over binding.execution.responseBytesMax (${descriptor.execution.responseBytesMax}). The response was discarded, not truncated.`,
    correlationId,
    {
      condition: `The orchestration response exceeded binding.execution.responseBytesMax for this binding. It is discarded rather than truncated, because a truncated orchestration document cannot be distinguished from a complete one.`,
      next: descriptor.write
        ? `Do NOT re-issue this write. Call ${statusCounterpart(descriptor)} to determine whether the orchestration completed; the cap cannot be raised per call.`
        : `Narrow the request with additional filter arguments (date range, company, status) and call ${descriptor.toolId} again; the cap cannot be raised per call.`,
    },
  );
}

/**
 * Concurrency admission. The per-orchestration limit is an operational control
 * on the AIS server (02 §3.5), so a refusal is `RATE_LIMITED` — the caller is
 * being asked to wait, and the code's own `retryable: true` is correct.
 */
export function concurrencyRefused(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
): ForgeError {
  return forgeError(
    'RATE_LIMITED',
    `${descriptor.toolId}: orchestration ${descriptor.ref} is at its per-orchestration concurrency limit (${descriptor.execution.maxConcurrency}) and this call waited longer than binding.execution.timeoutMs for a slot. No call was made to the target.`,
    correlationId,
    {
      condition: `The per-orchestration concurrency limit for ${descriptor.ref} is saturated. AIS servers are easy to overwhelm, so calls queue rather than over-admit.`,
      next: `Wait and call ${descriptor.toolId} again; no business record was created because the call never reached the target. If this workload genuinely needs more parallelism, ask the module steward to raise binding.execution.maxConcurrency in the manifest.`,
    },
  );
}

export function targetError(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  message: string,
  precondition: boolean,
): ForgeError {
  if (precondition) {
    return forgeError(
      'TARGET_PRECONDITION_FAILED',
      `${descriptor.toolId}: ${descriptor.ref} refused — ${message}`,
      correlationId,
    );
  }
  return forgeError(
    'TARGET_ERROR',
    `${descriptor.toolId}: ${descriptor.ref} returned an application error — ${message}`,
    correlationId,
  );
}

export function targetUnavailable(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  message: string,
): ForgeError {
  return forgeError(
    'TARGET_UNAVAILABLE',
    `${descriptor.toolId}: the AIS server hosting ${descriptor.ref} is unreachable — ${message}`,
    correlationId,
  );
}

// --- W0-H3, the runtime identity echo (02 §3.5) -------------------------------

/**
 * The DISTINCT error class for a failed runtime identity echo.
 *
 * JUDGMENT CALL, documented, and the same discipline `responseTooLarge` above
 * took: the taxonomy is CLOSED (02 §3.1.5 + §11.7 = 21 codes) and this file may
 * not add a code. `IDENTITY_UNRESOLVED` is the code it closes over — "no
 * target-identity mapping exists for this subject on this target", which is
 * exactly what a mismatch proves empirically: the mapping the gateway believed
 * in did not survive to the target. Distinctness is therefore carried by a
 * subclass rather than by a new code, and the subclass also carries the two
 * values the audit row needs (`target_identity_observed`, `identity_match`) so
 * a caller never has to re-parse a message to record them.
 *
 * If a future taxonomy revision adds a dedicated code (an
 * `IDENTITY_ECHO_MISMATCH`), this is the single place that changes.
 */
export class FunctionIdentityEchoError extends ForgeError {
  /** `audit_call.target_identity_observed` — null when no echo came back. */
  readonly targetIdentityObserved: string | null;
  /** `audit_call.identity_match` — always false on this class. */
  readonly identityMatch: false;
  readonly expectedSubject: string | null;

  constructor(
    shape: ConstructorParameters<typeof ForgeError>[0],
    observed: string | null,
    expectedSubject: string | null,
  ) {
    super(shape);
    this.targetIdentityObserved = observed;
    this.identityMatch = false;
    this.expectedSubject = expectedSubject;
  }
}

function echoError(
  code: 'IDENTITY_UNRESOLVED',
  message: string,
  correlationId: string,
  // Spelled through `ForgeErrorOverrides` rather than as an inline literal so
  // this signature is not mistaken for a `next:` CONSTRUCTION site by the
  // no-dead-ends scanner in core/gateway/errors/enumeration.test.ts.
  overrides: Required<Pick<ForgeErrorOverrides, 'condition' | 'next'>>,
  observed: string | null,
  expectedSubject: string | null,
): FunctionIdentityEchoError {
  const base = forgeError(code, message, correlationId, overrides);
  return new FunctionIdentityEchoError(base.toJSON(), observed, expectedSubject);
}

/**
 * The target executed the orchestration as someone other than the caller. This
 * is the condition 02 §3.5 built the echo for — an instance whose SSO
 * configuration silently changed — and it is a FAILURE, not a warning: the call
 * never becomes a success, so nothing downstream records one.
 */
export function identityEchoMismatch(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  expectedSubject: string,
  observed: string,
): FunctionIdentityEchoError {
  return echoError(
    'IDENTITY_UNRESOLVED',
    `${descriptor.toolId}: ${descriptor.ref} executed as ${observed}, not as the caller ${expectedSubject}. The runtime identity echo failed and this call is NOT recorded as a success.`,
    correlationId,
    {
      condition: `The target reported executing under ${observed} while the caller is ${expectedSubject}. Identity did not carry to the target for this call (02 §3.5's runtime echo).`,
      next: descriptor.write
        ? `Do NOT re-issue this write. Tell the human the target executed as ${observed} rather than as them, report the correlationId to the ${descriptor.toolId} owning team, and ask the MCPForge operator to re-run forge probe — the instance's identity exchange has changed. Then call ${statusCounterpart(descriptor)} to establish whether anything was created.`
        : `Report the correlationId to the MCPForge operator and ask them to re-run forge probe against this instance; the identity exchange for ${descriptor.ref} has changed and results returned under ${observed} cannot be trusted as yours.`,
    },
    observed,
    expectedSubject,
  );
}

/**
 * The echo was required and the response carried no executing user. Treated as
 * a failure, not as a pass: an unanswerable identity question is never
 * "assumed fine" (02 §3.5's third probe outcome, applied at runtime).
 */
export function identityEchoMissing(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
): FunctionIdentityEchoError {
  return echoError(
    'IDENTITY_UNRESOLVED',
    `${descriptor.toolId}: ${descriptor.ref} returned no executing user, so the runtime identity echo could not be asserted. This call is NOT recorded as a success.`,
    correlationId,
    {
      condition: `binding.identity.echoOn requires the executing identity on this call, and the orchestration response carried no MCPFORGE_EXECUTING_USER field${descriptor.identity.probe === null ? '' : ` at the root or under the ${descriptor.identity.probe} step`}. An unanswerable identity question is never assumed fine.`,
      next: descriptor.write
        ? `Do NOT re-issue this write. Ask the ${descriptor.toolId} module steward to compose ${descriptor.ref} with its final identity-echo step, and call ${statusCounterpart(descriptor)} to establish whether anything was created.`
        : `Ask the ${descriptor.toolId} module steward to compose ${descriptor.ref} with its final identity-echo step; until then this tool cannot satisfy binding.identity.echoOn.`,
    },
    null,
    null,
  );
}

/**
 * A check was required and no `Principal.subject` reached the executor. There is
 * no fallback subject anywhere in this codebase (CLAUDE.md #1).
 */
export function identityUnresolvedForEcho(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
): FunctionIdentityEchoError {
  return echoError(
    'IDENTITY_UNRESOLVED',
    `${descriptor.toolId}: the runtime identity echo is required for this call and no caller subject was supplied to the executor.`,
    correlationId,
    {
      condition:
        'No Principal.subject reached the function executor, so there is nothing to compare the target-reported identity against. There is no fallback subject.',
      next: `Re-establish the session so a human identity is resolved, then call ${descriptor.toolId} again; ask your MCPForge operator to add your target-identity mapping if the session cannot resolve one.`,
    },
    null,
    null,
  );
}

export function internal(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  message: string,
): ForgeError {
  return forgeError(
    'INTERNAL',
    `${descriptor.toolId}: MCPForge failed before dispatching ${descriptor.ref} — ${message}`,
    correlationId,
  );
}

/**
 * W0-P9 — a dispatch without a valid execution grant: some code path reached
 * the executor without the gateway's policy chain. Nothing was sent to the
 * target. `INTERNAL` rather than a new code, because the closed taxonomy
 * (02 §3.1.5) is not this file's to extend and, from the agent's side, this is
 * an MCPForge defect, not something the agent did wrong.
 */
export function executionNotGranted(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  reason: string,
): ForgeError {
  return forgeError(
    'INTERNAL',
    `${descriptor.toolId}: refused to dispatch ${descriptor.ref} — the call carried no valid execution grant from the gateway policy chain (${reason}). Nothing was sent to the target.`,
    correlationId,
    {
      condition:
        'The binding executor was reached without the gateway policy chain authorizing this exact call.',
      next: `Call ${descriptor.toolId} through the MCPForge gateway (tools/call or forge.invoke), which runs the policy chain and issues the grant. If you already did, report correlationId ${correlationId} to the MCPForge operator; no business record was created or changed.`,
    },
  );
}
