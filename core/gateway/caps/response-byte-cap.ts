// MCPForge — response-byte-cap enforcement, re-checked after fetch/serialization. W0-E6, 02 §4.7.
//
// No dedicated error code exists for "response too large" in the closed
// taxonomy (core/shared/src/errors/codes.ts has ROW_CAP_EXCEEDED but nothing
// byte-shaped) — this is exactly the honest-gap case CLAUDE.md §8 calls a
// "spec silent on something with a blast radius": widening the 21-code
// taxonomy is out of this task's touches (`core/gateway/caps/**` only) and is
// a foundational change several other modules assume is closed. Reusing
// `ROW_CAP_EXCEEDED` for a byte overflow would misname the condition to every
// caller reading the code. So this module raises `ROW_CAP_EXCEEDED` ONLY for
// row overflows (row-cap.ts) and, for a byte overflow, raises `INTERNAL` with
// a `next` that names the concrete narrowing action AND flags the missing
// code by name — see this task's final report for the human decision needed
// (a new `RESPONSE_TOO_LARGE` code, or folding byte caps under
// `ROW_CAP_EXCEEDED`'s wording) rather than silently picking one.

import { forgeError, type ForgeError } from '@mcpforge/shared/errors';
import type { CapValues } from './ceilings.js';

export interface ResponseByteCapCheckInput {
  readonly toolId: string;
  readonly correlationId: string;
  /** The serialized response body's byte length, measured AFTER extraction — never estimated. */
  readonly byteLength: number;
  /** The tool's own declared byte cap, if its manifest declares one tighter than the ceiling. */
  readonly manifestResponseByteCap?: number;
  readonly effectiveCaps: CapValues;
  readonly narrowingParams: readonly string[];
}

export function effectiveResponseByteCap(
  manifestCap: number | undefined,
  effectiveCaps: CapValues,
): number {
  return manifestCap === undefined
    ? effectiveCaps.responseByteCap
    : Math.min(manifestCap, effectiveCaps.responseByteCap);
}

/**
 * Throws when `byteLength` exceeds the effective cap; otherwise returns the
 * effective cap that was checked against.
 */
export function enforceResponseByteCap(input: ResponseByteCapCheckInput): number {
  if (input.narrowingParams.length === 0) {
    throw new Error(
      `Response-byte-capped tool ${input.toolId} declares no narrowingParams to name in a refusal.`,
    );
  }
  const cap = effectiveResponseByteCap(input.manifestResponseByteCap, input.effectiveCaps);
  if (input.byteLength <= cap) return cap;

  throw responseByteCapExceededError(
    input.toolId,
    input.correlationId,
    cap,
    input.narrowingParams.join(', '),
  );
}

function responseByteCapExceededError(
  toolId: string,
  correlationId: string,
  cap: number,
  narrowingParamList: string,
): ForgeError {
  // See the file header: no dedicated code exists yet, so this fails closed
  // under INTERNAL rather than mislabel the condition. `INTERNAL`'s `next`
  // is overridden here with a concrete, agent-actionable action, per
  // non-negotiable #5 — never the generic "report to the operator" default.
  return forgeError(
    'INTERNAL',
    `${toolId}'s response exceeded the response-byte cap of ${cap} bytes.`,
    correlationId,
    {
      condition: `serialized response byte length exceeded the effective response-byte cap of ${cap} for ${toolId}`,
      next: `Narrow your call to ${toolId} using ${narrowingParamList} and call it again; the response-byte cap (${cap}) is enforced after fetch and cannot be raised per call. (Flagged for a human: the closed error taxonomy has no dedicated code for a byte-cap refusal — see W0-E6's final report.)`,
      retryable: false,
    },
  );
}
