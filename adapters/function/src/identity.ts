// MCPForge — the RUNTIME identity echo for the `function` binding. 02 §3.5:
//
//   "And at runtime, not only at install. `binding.identity.echoOn` controls a
//    runtime check: every write orchestration is composed with a final step
//    that returns the executing user, and the gateway asserts it matches the
//    caller before recording success. Reads are sampled (1 in N, default 20)."
//
// This is NOT the probe (02 §4.5, W0-H5). The probe is a one-time capability
// question — "does this binding carry identity at all?" — answered by a
// designated test user and written into the probe report as
// `identity.carries: verified`. Nothing here writes `carries`, nothing here
// writes a manifest, and nothing here decides `onServiceAccount`. This file
// asks a different, per-call question: "did the target execute THIS call as
// THIS caller?" — and it is what catches an instance whose SSO configuration
// silently changes on the next write rather than at the next quarterly probe.
//
// Layout note: TASKS.md names the file `adapters/function/identity.ts`. The
// package compiles with rootDir `src` (see descriptor.ts / rules/index.ts for
// the same note), so it sits at `adapters/function/src/identity.ts`.
//
// NOT PROVEN AGAINST A LIVE TARGET. There is no JDE AIS instance in this
// environment; every test runs against the in-process fake in `src/testing/`.

import * as adapterErrors from './errors.js';
import type { EchoSampler, FunctionBindingDescriptor, IdentityEchoObservation } from './types.js';

/**
 * The response key the composed final step writes the executing user into.
 *
 * JUDGMENT CALL, flagged in the task report. 02 §3.5 fixes the PROBE binding's
 * name (`MCPFORGE_PROBE_WHOAMI`) but is silent on the name of the field the
 * echo step returns, and the tool manifest schema has no field in which a
 * steward could declare one — `binding.identity` carries `carries`, `probe`,
 * `onServiceAccount` and `echoOn`, and nothing else. Rather than invent a
 * manifest field (a schema change with a blast radius, which CLAUDE.md §8 says
 * to stop on), this convention reuses the two names the manifest DOES carry:
 *
 *   * the value lives under the fixed key `MCPFORGE_EXECUTING_USER`, and
 *   * it is read at the response-document root, or one level down under the
 *     step named by `binding.identity.probe` — because an AIS orchestration
 *     response nests each step's output under that step's name, and the echo
 *     step is the probe binding invoked as the orchestration's final step.
 *
 * If a steward needs a different field name, that is a manifest-schema change
 * and a human decision, not a default this file should guess at.
 */
export const EXECUTING_USER_KEY = 'MCPFORGE_EXECUTING_USER';

/** 02 §3.5 — "Reads are sampled (1 in N, default 20)." */
export const DEFAULT_READ_SAMPLE_RATE = 20;

/**
 * Deterministic 1-in-N sampling, per orchestration.
 *
 * Deliberately NOT `Math.random()`: a security control whose firing rate cannot
 * be asserted in a test is a control nobody can show works. A counter gives an
 * exact rate — calls 1, N+1, 2N+1 … are checked — and is trivially injectable,
 * so the gateway may substitute a jittered sampler later without this module
 * changing. Counters are per key so a chatty read tool cannot starve a quiet
 * one out of ever being sampled.
 */
export function createDeterministicSampler(rate: number = DEFAULT_READ_SAMPLE_RATE): EchoSampler {
  if (!Number.isInteger(rate) || rate < 1) {
    throw new Error(`identity echo sample rate must be a positive integer; got ${String(rate)}`);
  }
  const counts = new Map<string, number>();
  return {
    rate,
    shouldSample(key: string): boolean {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n % rate === 1 % rate;
    },
  };
}

/** Every call is checked. For a deployment that wants no sampling at all. */
export function createAlwaysSampler(): EchoSampler {
  return { rate: 1, shouldSample: () => true };
}

/**
 * Whether this call must carry the echo check, from `binding.identity.echoOn`.
 *
 *   never   — no check on any call.
 *   write   — every write is checked; reads are not. (The mandatory value for a
 *             `function` write tool — `policy.function-write-echo`.)
 *   sampled — every write is checked, reads 1-in-N. A write is NEVER sampled
 *             out: 02 §3.5 says *every* write orchestration is checked, and a
 *             probabilistic assurance on a write is not the property the
 *             document describes.
 *   always  — every call, read or write, is checked.
 */
export function decideEchoCheck(
  descriptor: FunctionBindingDescriptor,
  sampler: EchoSampler,
): { readonly required: boolean; readonly sampled: boolean } {
  const echoOn = descriptor.identity.echoOn;
  if (echoOn === 'never') return { required: false, sampled: false };
  if (echoOn === 'always') return { required: true, sampled: false };
  if (descriptor.write) return { required: true, sampled: false };
  if (echoOn === 'write') return { required: false, sampled: false };
  // `sampled`, on a read.
  return { required: sampler.shouldSample(descriptor.ref), sampled: true };
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return firstObject(value[0]);
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  return null;
}

function asIdentity(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Pull the executing user out of the orchestration response document.
 * Returns `null` when the step is absent — an absence, never a guess.
 */
export function extractExecutingUser(body: string, probeStep: string | null): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  const root = firstObject(doc);
  if (root === null) return null;

  const atRoot = asIdentity(root[EXECUTING_USER_KEY]);
  if (atRoot !== null) return atRoot;

  if (probeStep !== null && probeStep.length > 0) {
    const step = firstObject(root[probeStep]);
    if (step !== null) return asIdentity(step[EXECUTING_USER_KEY]);
  }
  return null;
}

/**
 * The comparison. Case- and whitespace-insensitive because JDE returns user ids
 * upper-cased while an IdP subject is typically lower-cased; nothing else is
 * normalised, so `bikash` never equals `bikash@ltm` and a domain change shows
 * up as the mismatch it is.
 */
export function identitiesMatch(callerSubject: string, observed: string): boolean {
  return callerSubject.trim().toLowerCase() === observed.trim().toLowerCase();
}

/**
 * Assert the target executed as the caller. Called by the executor AFTER the
 * response passed its size cap and target-error checks and BEFORE any result is
 * handed back — so a mismatched call can never be presented to the gateway as a
 * success, and therefore can never be recorded as one.
 *
 * Throws on: no caller subject (IDENTITY_UNRESOLVED — CLAUDE.md #1, there is no
 * fallback), a missing echo step, or a mismatch.
 */
export function assertIdentityEcho(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  callerSubject: string | undefined,
  body: string,
  sampled: boolean,
): IdentityEchoObservation {
  if (callerSubject === undefined || callerSubject.trim().length === 0) {
    throw adapterErrors.identityUnresolvedForEcho(descriptor, correlationId);
  }

  const observed = extractExecutingUser(body, descriptor.identity.probe);
  if (observed === null) {
    throw adapterErrors.identityEchoMissing(descriptor, correlationId);
  }

  const match = identitiesMatch(callerSubject, observed);
  if (!match) {
    throw adapterErrors.identityEchoMismatch(descriptor, correlationId, callerSubject, observed);
  }

  return { required: true, sampled, observed, match: true };
}

/** The observation for a call the policy did not require a check on. */
export function skippedEcho(sampled: boolean): IdentityEchoObservation {
  return { required: false, sampled, observed: null, match: null };
}
